/**
 * anomaly-watcher.ts — Proactive Platform Anomaly Detection & Self-Healing
 *
 * Monitors the orchestrator + backend for anomalies (rate-limit storms,
 * circuit breaker flaps, timeout cascades, error spikes) and:
 *
 *   1. DETECT   — Observe health metrics, rate-limit state, circuit breakers
 *   2. LEARN    — Store anomaly patterns in memory + failure harvester
 *   3. REASON   — Use RLM to analyze root cause and propose remediation
 *   4. ACT      — Execute countermeasures (throttle, alert, queue loose ends)
 *   5. REMEMBER — Persist learnings to knowledge graph for future prevention
 *
 * Runs as a cron every 5 minutes. Also callable on-demand via
 * `POST /api/anomaly-watcher/scan`.
 */
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getRedis } from '../redis.js'
import { getBackendCircuitState, getRateLimitState } from '../mcp-caller.js'
import { callMcpTool } from '../mcp-caller.js'
import { callCognitiveRaw, isRlmAvailable } from '../cognitive-proxy.js'
import { broadcastSSE } from '../sse.js'
import { broadcastMessage } from '../chat-broadcaster.js'
import { onAnomaly } from './pheromone-layer.js'

// ─── Types ──────────────────────────────────────────────────────────────────

type AnomalyValence = 'negative' | 'positive'  // anomalies can be bad OR good

interface AnomalyEvent {
  id: string
  type: 'rate_limit_storm' | 'circuit_breaker_open' | 'timeout_cascade' | 'error_spike' | 'stagnation'
      | 'unexpected_success' | 'performance_spike' | 'edge_breakthrough' | 'pattern_emergence'
  valence: AnomalyValence
  severity: 'info' | 'warning' | 'critical'
  source: string
  description: string
  metrics: Record<string, number>
  detectedAt: string
  resolvedAt: string | null
  remediation: string | null
  learnings: string[]
}

interface WatcherState {
  lastScanAt: string | null
  totalScans: number
  anomaliesDetected: number
  anomaliesResolved: number
  activeAnomalies: AnomalyEvent[]
  patterns: AnomalyPattern[]
}

interface AnomalyPattern {
  type: string
  count: number
  lastSeen: string
  avgDurationMs: number
  knownFix: string | null
}

// ─── State ──────────────────────────────────────────────────────────────────

const REDIS_KEY = 'anomaly-watcher:state'
const MAX_ACTIVE_ANOMALIES = 50
const MAX_PATTERNS = 100

let state: WatcherState = {
  lastScanAt: null,
  totalScans: 0,
  anomaliesDetected: 0,
  anomaliesResolved: 0,
  activeAnomalies: [],
  patterns: [],
}

// ─── Health Probes ──────────────────────────────────────────────────────────

interface HealthSnapshot {
  timestamp: string
  backendCircuit: ReturnType<typeof getBackendCircuitState>
  rateLimitState: ReturnType<typeof getRateLimitState>
  backendReachable: boolean
  backendLatencyMs: number
  rlmReachable: boolean
  redisReachable: boolean
}

async function probeHealth(): Promise<HealthSnapshot> {
  const t0 = Date.now()

  // Probe backend
  let backendReachable = false
  let backendLatencyMs = 0
  try {
    const res = await fetch(`${config.backendUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    backendReachable = res.ok
    backendLatencyMs = Date.now() - t0
  } catch { backendLatencyMs = Date.now() - t0 }

  // Probe Redis
  let redisReachable = false
  try {
    const redis = getRedis()
    if (redis) {
      await redis.ping()
      redisReachable = true
    }
  } catch { /* */ }

  return {
    timestamp: new Date().toISOString(),
    backendCircuit: getBackendCircuitState(),
    rateLimitState: getRateLimitState(),
    backendReachable,
    backendLatencyMs,
    rlmReachable: isRlmAvailable(),
    redisReachable,
  }
}

// ─── Anomaly Detection ──────────────────────────────────────────────────────

async function detectAnomalies(health: HealthSnapshot): Promise<AnomalyEvent[]> {
  const anomalies: AnomalyEvent[] = []
  const now = new Date().toISOString()

  // 1. Rate-limit storm (the CANVAS pattern)
  if (health.rateLimitState.current_delay_ms > 0 || health.rateLimitState.hits_in_window >= 3) {
    anomalies.push({
      id: `rl-storm-${Date.now()}`,
      type: 'rate_limit_storm',
      valence: 'negative',
      severity: health.rateLimitState.current_delay_ms >= 5000 ? 'critical' : 'warning',
      source: 'mcp-caller',
      description: `Rate-limit backpressure active: ${health.rateLimitState.hits_in_window} hits in ${health.rateLimitState.window_ms}ms window, delay=${health.rateLimitState.current_delay_ms}ms`,
      metrics: {
        delay_ms: health.rateLimitState.current_delay_ms,
        hits_in_window: health.rateLimitState.hits_in_window,
      },
      detectedAt: now,
      resolvedAt: null,
      remediation: null,
      learnings: [],
    })
  }

  // 2. Circuit breaker open
  if (health.backendCircuit.open) {
    anomalies.push({
      id: `cb-open-${Date.now()}`,
      type: 'circuit_breaker_open',
      valence: 'negative',
      severity: 'critical',
      source: 'backend',
      description: `Backend circuit breaker OPEN: ${health.backendCircuit.failures} consecutive failures, cooldown=${health.backendCircuit.cooldown_remaining_ms}ms`,
      metrics: {
        failures: health.backendCircuit.failures,
        cooldown_remaining_ms: health.backendCircuit.cooldown_remaining_ms,
      },
      detectedAt: now,
      resolvedAt: null,
      remediation: null,
      learnings: [],
    })
  }

  // 3. Backend unreachable or high latency
  if (!health.backendReachable) {
    anomalies.push({
      id: `backend-down-${Date.now()}`,
      type: 'timeout_cascade',
      valence: 'negative',
      severity: 'critical',
      source: 'backend',
      description: `Backend unreachable (latency: ${health.backendLatencyMs}ms)`,
      metrics: { latency_ms: health.backendLatencyMs },
      detectedAt: now,
      resolvedAt: null,
      remediation: null,
      learnings: [],
    })
  } else if (health.backendLatencyMs > 5000) {
    anomalies.push({
      id: `backend-slow-${Date.now()}`,
      type: 'timeout_cascade',
      valence: 'negative',
      severity: 'warning',
      source: 'backend',
      description: `Backend high latency: ${health.backendLatencyMs}ms (threshold: 5000ms)`,
      metrics: { latency_ms: health.backendLatencyMs },
      detectedAt: now,
      resolvedAt: null,
      remediation: null,
      learnings: [],
    })
  }

  // 4. RLM unavailable (cognitive stagnation)
  if (!health.rlmReachable) {
    anomalies.push({
      id: `rlm-down-${Date.now()}`,
      type: 'stagnation',
      valence: 'negative',
      severity: 'warning',
      source: 'rlm-engine',
      description: 'RLM Engine unavailable — cognitive pipelines (reason, analyze, fold) will fail',
      metrics: {},
      detectedAt: now,
      resolvedAt: null,
      remediation: null,
      learnings: [],
    })
  }

  // 5. Redis unavailable (state loss risk)
  if (!health.redisReachable) {
    anomalies.push({
      id: `redis-down-${Date.now()}`,
      type: 'stagnation',
      valence: 'negative',
      severity: 'critical',
      source: 'redis',
      description: 'Redis unreachable — edge scores, totalCycles, agent state at risk of loss on restart',
      metrics: {},
      detectedAt: now,
      resolvedAt: null,
      remediation: null,
      learnings: [],
    })
  }

  // ── POSITIVE ANOMALY DETECTION ──────────────────────────────────────────

  // 6. Unexpectedly fast backend (performance spike)
  if (health.backendReachable && health.backendLatencyMs < 50 && health.backendLatencyMs > 0) {
    anomalies.push({
      id: `perf-spike-${Date.now()}`,
      type: 'performance_spike',
      valence: 'positive',
      severity: 'info',
      source: 'backend',
      description: `Backend responding exceptionally fast: ${health.backendLatencyMs}ms (normal 100-500ms)`,
      metrics: { latency_ms: health.backendLatencyMs },
      detectedAt: now,
      resolvedAt: null,
      remediation: null,
      learnings: [],
    })
  }

  // 7. Rate-limit backpressure fully resolved (clean window after storm)
  if (health.rateLimitState.current_delay_ms === 0 && health.rateLimitState.hits_in_window === 0) {
    const stormPattern = state.patterns.find(p => p.type === 'rate_limit_storm')
    if (stormPattern && stormPattern.count > 0) {
      const lastStorm = new Date(stormPattern.lastSeen).getTime()
      const timeSinceStorm = Date.now() - lastStorm
      // If a storm was resolved within the last hour — that's a positive recovery signal
      if (timeSinceStorm < 3600_000 && timeSinceStorm > 60_000) {
        anomalies.push({
          id: `recovery-${Date.now()}`,
          type: 'unexpected_success',
          valence: 'positive',
          severity: 'info',
          source: 'mcp-caller',
          description: `Rate-limit storm self-resolved in ${Math.round(timeSinceStorm / 1000)}s — backpressure system effective`,
          metrics: { recovery_ms: timeSinceStorm, prior_storms: stormPattern.count },
          detectedAt: now,
          resolvedAt: null,
          remediation: null,
          learnings: [],
        })
      }
    }
  }

  // 8. Edge breakthrough detection via HyperAgent status
  try {
    const hyperStatus = await callMcpTool({
      toolName: 'hyperagent_auto_status',
      args: {},
      callId: `anomaly-hyper-${Date.now()}`,
    }) as Record<string, unknown>

    if (hyperStatus && typeof hyperStatus === 'object') {
      const edges = hyperStatus.edge_scores as Record<string, number> | undefined
      if (edges) {
        for (const [edgeName, score] of Object.entries(edges)) {
          if (typeof score === 'number' && score >= 0.85) {
            anomalies.push({
              id: `edge-break-${edgeName}-${Date.now()}`,
              type: 'edge_breakthrough',
              valence: 'positive',
              severity: 'info',
              source: 'hyperagent',
              description: `Sovereign Edge "${edgeName}" reached breakthrough score: ${(score * 100).toFixed(1)}%`,
              metrics: { edge: 0, score },
              detectedAt: now,
              resolvedAt: null,
              remediation: null,
              learnings: [],
            })
          }
        }
      }

      // Detect rapid cycle progression (pattern emergence)
      const totalCycles = hyperStatus.totalCycles as number | undefined
      const phase = hyperStatus.phase as number | undefined
      if (typeof totalCycles === 'number' && typeof phase === 'number' && phase >= 2 && totalCycles > 10) {
        const cyclesPerPhase = totalCycles / (phase + 1)
        if (cyclesPerPhase < 5) {
          anomalies.push({
            id: `pattern-emerge-${Date.now()}`,
            type: 'pattern_emergence',
            valence: 'positive',
            severity: 'info',
            source: 'hyperagent',
            description: `Fast phase progression: ${totalCycles} cycles across ${phase + 1} phases (${cyclesPerPhase.toFixed(1)} cycles/phase) — platform learning accelerating`,
            metrics: { totalCycles, phase, cyclesPerPhase },
            detectedAt: now,
            resolvedAt: null,
            remediation: null,
            learnings: [],
          })
        }
      }
    }
  } catch { /* non-blocking — HyperAgent may not be running */ }

  // 9. Inventor high-score trial detection
  try {
    const inventorBest = await callMcpTool({
      toolName: 'run_evolution',
      args: { action: 'status' },
      callId: `anomaly-inventor-${Date.now()}`,
    }) as Record<string, unknown>

    if (inventorBest && typeof inventorBest === 'object') {
      const bestScore = inventorBest.best_score as number | undefined
      if (typeof bestScore === 'number' && bestScore > 0.9) {
        anomalies.push({
          id: `inventor-high-${Date.now()}`,
          type: 'unexpected_success',
          valence: 'positive',
          severity: 'info',
          source: 'inventor',
          description: `Inventor evolution reached high-quality trial: score ${(bestScore * 100).toFixed(1)}% — candidate for production adoption`,
          metrics: { best_score: bestScore },
          detectedAt: now,
          resolvedAt: null,
          remediation: null,
          learnings: [],
        })
      }
    }
  } catch { /* non-blocking — Inventor may not have active experiment */ }

  return anomalies
}

// ─── Learn & Reason ─────────────────────────────────────────────────────────

async function learnFromAnomalies(anomalies: AnomalyEvent[]): Promise<void> {
  if (anomalies.length === 0) return

  // Update pattern counts
  for (const a of anomalies) {
    let pattern = state.patterns.find(p => p.type === a.type)
    if (!pattern) {
      pattern = { type: a.type, count: 0, lastSeen: a.detectedAt, avgDurationMs: 0, knownFix: null }
      state.patterns.push(pattern)
    }
    pattern.count++
    pattern.lastSeen = a.detectedAt
  }

  // Trim patterns
  if (state.patterns.length > MAX_PATTERNS) {
    state.patterns.sort((a, b) => b.count - a.count)
    state.patterns = state.patterns.slice(0, MAX_PATTERNS)
  }

  // Deposit pheromones for each anomaly (attraction for positive, repellent for negative)
  for (const a of anomalies) {
    onAnomaly(a.type, a.valence, a.source, a.severity).catch(() => {})
  }

  // Store to memory layer — with valence tag
  for (const a of anomalies) {
    try {
      await callMcpTool({
        toolName: 'memory_store',
        args: {
          agent_id: 'anomaly-watcher',
          key: `anomaly:${a.valence}:${a.type}:${a.id}`,
          value: JSON.stringify({
            type: a.type,
            valence: a.valence,
            severity: a.severity,
            source: a.source,
            description: a.description,
            metrics: a.metrics,
          }),
          metadata: { severity: a.severity, source: a.source, type: a.type, valence: a.valence },
        },
        callId: `anomaly-mem-${a.id}`,
      })
    } catch { /* non-blocking */ }
  }

  // Store negatives to failure harvester for pattern analysis
  const negatives = anomalies.filter(a => a.valence === 'negative')
  if (negatives.length > 0) {
    try {
      await callMcpTool({
        toolName: 'failure_harvest',
        args: {
          failures: negatives.map(a => ({
            category: a.type,
            pattern: a.description,
            context: a.metrics,
            severity: a.severity,
          })),
        },
        callId: `anomaly-harvest-${Date.now()}`,
      })
    } catch { /* non-blocking */ }
  }

  // Queue negatives as loose ends to be closed; positives as opportunities
  try {
    const items = anomalies.map(a => ({
      title: a.valence === 'positive'
        ? `[OPPORTUNITY] ${a.type}: ${a.source}`
        : `[${a.severity.toUpperCase()}] ${a.type}: ${a.source}`,
      description: a.description,
      priority: a.valence === 'positive' ? 'P2' : (a.severity === 'critical' ? 'P0' : 'P1'),
      category: a.valence === 'positive' ? 'platform-opportunity' : 'platform-health',
    }))
    await callMcpTool({
      toolName: 'loose_ends_scan',
      args: { source: 'anomaly-watcher', items },
      callId: `anomaly-loose-${Date.now()}`,
    })
  } catch { /* non-blocking */ }
}

async function reasonAboutAnomalies(anomalies: AnomalyEvent[]): Promise<string> {
  if (anomalies.length === 0 || !isRlmAvailable()) return ''

  const negatives = anomalies.filter(a => a.valence === 'negative')
  const positives = anomalies.filter(a => a.valence === 'positive')
  const criticals = negatives.filter(a => a.severity === 'critical')

  // Reason if we have criticals OR notable positives
  if (criticals.length === 0 && positives.length === 0) return ''

  try {
    // Retrieve prior anomaly insights from memory
    let priorInsights = ''
    try {
      const allTypes = anomalies.map(a => a.type)
      const memResult = await callMcpTool({
        toolName: 'memory_retrieve',
        args: {
          agent_id: 'anomaly-watcher',
          query: `anomaly resolution amplification ${allTypes.join(' ')}`,
          top_k: 5,
        },
        callId: `anomaly-reason-mem-${Date.now()}`,
      }) as Record<string, unknown>
      const memories = Array.isArray(memResult.memories) ? memResult.memories : []
      priorInsights = (memories as Array<Record<string, unknown>>).map(m => String(m.value || '')).join('\n')
    } catch { /* non-blocking */ }

    const negativesSection = criticals.length > 0
      ? `\nCRITICAL ANOMALIES (negative — needs remediation):\n${criticals.map(a => `- [${a.severity}] ${a.type} from ${a.source}: ${a.description}\n  Metrics: ${JSON.stringify(a.metrics)}`).join('\n')}`
      : ''

    const positivesSection = positives.length > 0
      ? `\nPOSITIVE ANOMALIES (unexpected successes — worth amplifying):\n${positives.map(a => `- [${a.type}] from ${a.source}: ${a.description}\n  Metrics: ${JSON.stringify(a.metrics)}`).join('\n')}`
      : ''

    const result = await callCognitiveRaw('reason', {
      prompt: `You are the Anomaly Intelligence Agent for the WidgeTDC platform.
You analyze BOTH negative anomalies (to fix) AND positive anomalies (to amplify and learn from).
${negativesSection}${positivesSection}

HISTORICAL PATTERNS:
${state.patterns.filter(p => p.count > 1).map(p => `- ${p.type}: occurred ${p.count} times, last seen ${p.lastSeen}${p.knownFix ? `, fix: ${p.knownFix}` : ''}`).join('\n') || '(no prior patterns)'}

PRIOR LEARNINGS:
${priorInsights || '(no prior insights)'}

Provide:
${criticals.length > 0 ? `1. ROOT CAUSE ANALYSIS for negative anomalies (most likely cause)
2. IMMEDIATE REMEDIATION steps the orchestrator can take autonomously
3. PREVENTIVE MEASURES to add to the platform` : ''}
${positives.length > 0 ? `${criticals.length > 0 ? '4' : '1'}. AMPLIFICATION STRATEGY for positive anomalies — what's working well and how to reinforce it
${criticals.length > 0 ? '5' : '2'}. DEVELOPMENT IDEAS inspired by the positive patterns — new capabilities or optimizations to explore
${criticals.length > 0 ? '6' : '3'}. PATTERN CONNECTIONS — how positive signals relate to recent changes or experiments` : ''}
${criticals.length > 0 || positives.length > 0 ? `\nFINAL: One-liner insight to remember for next time` : ''}`,
      agent_id: 'anomaly-watcher',
      depth: 2,
    }, 20000)

    const analysis = String(result.answer || result.result || '')

    // Store the insight back to memory — tagged with valence
    if (analysis.length > 50) {
      const primaryType = criticals.length > 0 ? criticals[0].type : positives[0]?.type ?? 'mixed'
      const memKey = positives.length > 0 && criticals.length === 0
        ? `amplification:${primaryType}:${Date.now()}`
        : `remediation:${primaryType}:${Date.now()}`
      try {
        await callMcpTool({
          toolName: 'memory_store',
          args: {
            agent_id: 'anomaly-watcher',
            key: memKey,
            value: analysis.slice(0, 2000),
            metadata: {
              types: anomalies.map(a => a.type),
              valences: [...new Set(anomalies.map(a => a.valence))],
              scan: state.totalScans,
            },
          },
          callId: `anomaly-rem-store-${Date.now()}`,
        })
      } catch { /* non-blocking */ }
    }

    return analysis
  } catch (err) {
    logger.warn({ error: String(err) }, 'Anomaly-watcher: RLM reasoning failed')
    return ''
  }
}

// ─── Main Scan ──────────────────────────────────────────────────────────────

export async function runAnomalyScan(): Promise<{
  anomalies: AnomalyEvent[]
  health: HealthSnapshot
  analysis: string
  patterns: AnomalyPattern[]
}> {
  const t0 = Date.now()
  state.totalScans++
  state.lastScanAt = new Date().toISOString()

  broadcastSSE('anomaly-watcher', { event: 'scan_start', scan: state.totalScans })

  // 1. DETECT
  const health = await probeHealth()
  const anomalies = await detectAnomalies(health)

  // Check for resolved anomalies
  const activeTypes = new Set(anomalies.map(a => a.type))
  state.activeAnomalies = state.activeAnomalies.filter(a => {
    if (!activeTypes.has(a.type) && !a.resolvedAt) {
      a.resolvedAt = new Date().toISOString()
      state.anomaliesResolved++
      logger.info({ type: a.type, source: a.source }, 'Anomaly resolved')
      return false
    }
    return true
  })

  if (anomalies.length > 0) {
    state.anomaliesDetected += anomalies.length

    // Add to active (dedup by type)
    for (const a of anomalies) {
      if (!state.activeAnomalies.find(x => x.type === a.type)) {
        state.activeAnomalies.push(a)
      }
    }
    if (state.activeAnomalies.length > MAX_ACTIVE_ANOMALIES) {
      state.activeAnomalies = state.activeAnomalies.slice(-MAX_ACTIVE_ANOMALIES)
    }

    // 2. LEARN
    await learnFromAnomalies(anomalies)

    // 3. REASON (only for critical)
    const analysis = await reasonAboutAnomalies(anomalies)

    // 4. BROADCAST
    const critCount = anomalies.filter(a => a.severity === 'critical').length
    const positiveCount = anomalies.filter(a => a.valence === 'positive').length
    if (critCount > 0) {
      broadcastMessage({
        from: 'AnomalyWatcher',
        to: 'All',
        source: 'orchestrator',
        type: 'Alert',
        message: `${critCount} critical anomal${critCount === 1 ? 'y' : 'ies'} detected: ${anomalies.filter(a => a.severity === 'critical').map(a => `${a.type}(${a.source})`).join(', ')}`,
      } as Record<string, unknown>)
    }
    if (positiveCount > 0) {
      broadcastMessage({
        from: 'AnomalyWatcher',
        to: 'All',
        source: 'orchestrator',
        type: 'Message',
        message: `${positiveCount} positive signal${positiveCount === 1 ? '' : 's'}: ${anomalies.filter(a => a.valence === 'positive').map(a => `${a.type}(${a.source})`).join(', ')}`,
      } as Record<string, unknown>)
    }

    broadcastSSE('anomaly-watcher', {
      event: 'scan_complete',
      scan: state.totalScans,
      anomalies: anomalies.length,
      critical: critCount,
      positive: positiveCount,
      duration_ms: Date.now() - t0,
    })

    logger.info({
      scan: state.totalScans,
      anomalies: anomalies.length,
      critical: critCount,
      duration_ms: Date.now() - t0,
    }, 'Anomaly scan complete')

    // 5. PERSIST
    await persistState()

    return { anomalies, health, analysis, patterns: state.patterns }
  }

  broadcastSSE('anomaly-watcher', {
    event: 'scan_complete',
    scan: state.totalScans,
    anomalies: 0,
    critical: 0,
    duration_ms: Date.now() - t0,
  })

  await persistState()
  return { anomalies: [], health, analysis: '', patterns: state.patterns }
}

// ─── Persistence ────────────────────────────────────────────────────────────

async function persistState(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(REDIS_KEY, JSON.stringify({ ...state, _schemaVersion: 1 }), 'EX', 86400)
  } catch { /* */ }
}

async function loadState(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const raw = await redis.get(REDIS_KEY)
    if (raw) {
      const loaded = JSON.parse(raw) as WatcherState & { _schemaVersion?: number }
      if (loaded._schemaVersion !== 1) {
        logger.warn('Anomaly-watcher: schema version mismatch, using defaults')
        return
      }
      state = { ...state, ...loaded }
      logger.info({ totalScans: state.totalScans, patterns: state.patterns.length },
        'Anomaly-watcher: restored state from Redis')
    }
  } catch { /* */ }
}

// ─── Getters ────────────────────────────────────────────────────────────────

export function getWatcherState(): WatcherState {
  return { ...state }
}

export function getActiveAnomalies(): AnomalyEvent[] {
  return [...state.activeAnomalies]
}

export function getAnomalyPatterns(): AnomalyPattern[] {
  return [...state.patterns]
}

// ─── Init ───────────────────────────────────────────────────────────────────

export async function initAnomalyWatcher(): Promise<void> {
  await loadState()
  logger.info({ totalScans: state.totalScans, patterns: state.patterns.length },
    'Anomaly-watcher initialized')
}
