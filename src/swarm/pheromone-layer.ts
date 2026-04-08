/**
 * pheromone-layer.ts — Stigmergic Communication Substrate
 *
 * Pheromones are indirect agent-to-agent signals left in the environment
 * (Redis + Neo4j) that other agents sense and respond to — like ant trails.
 *
 * 5 Pheromone Types:
 *   1. ATTRACTION  — High-score success trails that draw traffic toward effective agents/strategies
 *   2. REPELLENT   — Failure/overload markers that deflect traffic from bad paths
 *   3. TRAIL       — Path-reinforcement: successful chain sequences strengthen for reuse
 *   4. EXTERNAL    — Signals from OSINT, research feeds, competitive crawl (outside-in)
 *   5. AMPLIFICATION — Cross-pillar compound signals (PeerEval + Cost + Adoption = strong)
 *
 * Lifecycle: deposit → sense → decay → amplify/evaporate → persist (to Neo4j)
 *
 * Redis keyspace: pheromone:* (with TTL-based natural decay)
 * Neo4j: (:Pheromone)-[:DEPOSITED_BY]->(:Agent), (:Pheromone)-[:REINFORCES]->(:Trail)
 */
import { v4 as uuid } from 'uuid'
import { getRedis } from '../redis.js'
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import { broadcastSSE } from '../sse.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type PheromoneType = 'attraction' | 'repellent' | 'trail' | 'external' | 'amplification'

export interface Pheromone {
  id: string
  type: PheromoneType
  agentId: string
  /** What this signal is about: e.g. 'research', 'inventor-trial', 'rate-limit' */
  domain: string
  /** Signal strength 0.0 – 1.0 (decays over time) */
  strength: number
  /** Human-readable description */
  label: string
  /** Arbitrary metrics payload */
  metrics: Record<string, number>
  /** Tags for filtering */
  tags: string[]
  depositedAt: string
  /** TTL in seconds (Redis expiry + logical decay) */
  ttlSeconds: number
  /** How many times this trail was reinforced */
  reinforcements: number
}

export interface PheromoneQuery {
  domain?: string
  type?: PheromoneType
  tags?: string[]
  minStrength?: number
  limit?: number
}

export interface TrailSummary {
  trailId: string
  domain: string
  totalStrength: number
  pheromoneCount: number
  avgStrength: number
  topContributors: string[]
  strongestType: PheromoneType
}

interface PheromoneState {
  totalDeposits: number
  totalDecays: number
  totalAmplifications: number
  activePheromones: number
  trailCount: number
  lastDecayAt: string | null
  lastPersistAt: string | null
}

// ─── State ──────────────────────────────────────────────────────────────────

const REDIS_PREFIX = 'pheromone:'
const REDIS_STATE_KEY = 'pheromone:state'
const REDIS_INDEX_KEY = 'pheromone:index' // sorted set by strength
const DEFAULT_TTL = 3600 // 1 hour default
const MAX_PHEROMONES = 2000
const PERSIST_THRESHOLD = 0.7 // persist to Neo4j if strength > this
const AMPLIFICATION_MULTIPLIER = 1.5
const DECAY_FACTOR = 0.85 // 15% per decay cycle

let state: PheromoneState = {
  totalDeposits: 0,
  totalDecays: 0,
  totalAmplifications: 0,
  activePheromones: 0,
  trailCount: 0,
  lastDecayAt: null,
  lastPersistAt: null,
}

// ─── Core Operations ────────────────────────────────────────────────────────

/**
 * Deposit a pheromone signal into the environment.
 * Agents call this after completing tasks, detecting anomalies, or receiving external signals.
 */
export async function deposit(
  agentId: string,
  type: PheromoneType,
  domain: string,
  strength: number,
  label: string,
  metrics: Record<string, number> = {},
  tags: string[] = [],
  ttlSeconds: number = DEFAULT_TTL,
): Promise<Pheromone> {
  const pheromone: Pheromone = {
    id: `ph-${uuid().slice(0, 12)}`,
    type,
    agentId,
    domain,
    strength: Math.max(0, Math.min(1, strength)),
    label,
    metrics,
    tags: [...tags, type, domain],
    depositedAt: new Date().toISOString(),
    ttlSeconds,
    reinforcements: 0,
  }

  const redis = getRedis()
  if (redis) {
    const key = `${REDIS_PREFIX}${pheromone.id}`
    await redis.set(key, JSON.stringify(pheromone), 'EX', ttlSeconds)
    // Index by strength for efficient querying
    await redis.zadd(REDIS_INDEX_KEY, pheromone.strength, pheromone.id)
    // Domain index for domain-scoped queries
    await redis.zadd(`${REDIS_PREFIX}domain:${domain}`, pheromone.strength, pheromone.id)
    // Type index
    await redis.zadd(`${REDIS_PREFIX}type:${type}`, pheromone.strength, pheromone.id)
  }

  state.totalDeposits++
  // activePheromones derived from Redis zcard in persistState — increment as best-effort estimate
  state.activePheromones++

  // Active cross-pillar amplification: check if multiple pheromone types
  // agree on this domain — if so, amplify immediately (don't wait for decay cron)
  if (type !== 'amplification') { // avoid recursive amplification
    tryActiveAmplification(domain).catch(() => {}) // fire-and-forget
  }

  broadcastSSE('pheromone', {
    event: 'deposit',
    pheromone: { id: pheromone.id, type, domain, strength: pheromone.strength, agentId },
  })

  logger.debug({ id: pheromone.id, type, domain, strength: pheromone.strength, agentId },
    'Pheromone deposited')

  return pheromone
}

/**
 * Sense pheromones in the environment matching a query.
 * Agents call this before making decisions (routing, strategy selection, etc.).
 */
export async function sense(query: PheromoneQuery): Promise<Pheromone[]> {
  const redis = getRedis()
  if (!redis) return []

  const limit = query.limit ?? 20
  const minStrength = query.minStrength ?? 0.1

  let candidateIds: string[]

  // Use most specific index available
  if (query.domain) {
    candidateIds = await redis.zrevrangebyscore(
      `${REDIS_PREFIX}domain:${query.domain}`, '+inf', String(minStrength),
      'LIMIT', '0', String(limit * 2),
    )
  } else if (query.type) {
    candidateIds = await redis.zrevrangebyscore(
      `${REDIS_PREFIX}type:${query.type}`, '+inf', String(minStrength),
      'LIMIT', '0', String(limit * 2),
    )
  } else {
    candidateIds = await redis.zrevrangebyscore(
      REDIS_INDEX_KEY, '+inf', String(minStrength),
      'LIMIT', '0', String(limit * 2),
    )
  }

  if (candidateIds.length === 0) return []

  // Batch fetch pheromone data
  const pipeline = redis.pipeline()
  for (const id of candidateIds) {
    pipeline.get(`${REDIS_PREFIX}${id}`)
  }
  const results = await pipeline.exec()
  if (!results) return []

  const pheromones: Pheromone[] = []
  for (const [err, raw] of results) {
    if (err || !raw) continue
    try {
      const p = JSON.parse(raw as string) as Pheromone
      // Apply tag filter
      if (query.tags && query.tags.length > 0) {
        if (!query.tags.some(t => p.tags.includes(t))) continue
      }
      // Apply type filter if not already index-filtered
      if (query.type && !query.domain && p.type !== query.type) continue
      pheromones.push(p)
    } catch { /* skip corrupt entries */ }
  }

  return pheromones.slice(0, limit)
}

/**
 * Reinforce a pheromone trail — called when a previously-deposited signal
 * proves correct (e.g. agent followed an attraction trail and succeeded).
 */
export async function reinforce(pheromoneId: string, boostFactor: number = 0.2): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false

  const key = `${REDIS_PREFIX}${pheromoneId}`
  const raw = await redis.get(key)
  if (!raw) return false

  try {
    const p = JSON.parse(raw) as Pheromone
    p.strength = Math.min(1.0, p.strength + boostFactor)
    p.reinforcements++

    // Extend TTL on reinforcement (successful trails live longer)
    const newTtl = Math.min(p.ttlSeconds * 1.5, 86400) // max 24h
    p.ttlSeconds = newTtl

    await redis.set(key, JSON.stringify(p), 'EX', Math.round(newTtl))
    await redis.zadd(REDIS_INDEX_KEY, p.strength, pheromoneId)

    if (p.type === 'trail' || p.type === 'attraction') {
      await redis.zadd(`${REDIS_PREFIX}domain:${p.domain}`, p.strength, pheromoneId)
    }

    state.totalAmplifications++
    return true
  } catch { return false }
}

/**
 * Run decay cycle — reduces all pheromone strengths by DECAY_FACTOR.
 * Pheromones below 0.05 are evaporated (removed).
 * Called by cron every 15 minutes.
 */
export async function runDecayCycle(): Promise<{ decayed: number; evaporated: number }> {
  const redis = getRedis()
  if (!redis) return { decayed: 0, evaporated: 0 }

  // Prevent overlapping decay cycles (manual trigger + cron)
  const LOCK_KEY = `${REDIS_PREFIX}decay-lock`
  const locked = await redis.set(LOCK_KEY, '1', 'EX', 60, 'NX')
  if (!locked) return { decayed: 0, evaporated: 0 }

  try {
  const allIds = await redis.zrangebyscore(REDIS_INDEX_KEY, '0', '+inf')
  let decayed = 0
  let evaporated = 0

  for (const id of allIds) {
    const key = `${REDIS_PREFIX}${id}`
    const raw = await redis.get(key)
    if (!raw) {
      // Already expired via TTL — clean up index
      await redis.zrem(REDIS_INDEX_KEY, id)
      evaporated++
      continue
    }

    try {
      const p = JSON.parse(raw) as Pheromone
      p.strength *= DECAY_FACTOR

      if (p.strength < 0.05) {
        // Evaporate — too weak to matter
        await redis.del(key)
        await redis.zrem(REDIS_INDEX_KEY, id)
        await redis.zrem(`${REDIS_PREFIX}domain:${p.domain}`, id)
        await redis.zrem(`${REDIS_PREFIX}type:${p.type}`, id)
        evaporated++
      } else {
        await redis.set(key, JSON.stringify(p), 'KEEPTTL')
        await redis.zadd(REDIS_INDEX_KEY, p.strength, id)
        decayed++
      }
    } catch {
      await redis.zrem(REDIS_INDEX_KEY, id)
      evaporated++
    }
  }

  state.totalDecays++
  state.activePheromones = Math.max(0, state.activePheromones - evaporated)
  state.lastDecayAt = new Date().toISOString()

  logger.info({ decayed, evaporated, remaining: state.activePheromones }, 'Pheromone decay cycle')
  return { decayed, evaporated }
  } finally {
    await redis.del(LOCK_KEY).catch(() => {})
  }
}

/**
 * Cross-pillar amplification — when multiple pillars agree on a signal,
 * create a compound amplification pheromone with boosted strength.
 */
export async function amplify(
  domain: string,
  contributingPheromones: Pheromone[],
  label: string,
): Promise<Pheromone | null> {
  if (contributingPheromones.length < 2) return null

  // Compound strength: geometric mean × multiplier
  const strengths = contributingPheromones.map(p => p.strength)
  const geoMean = Math.pow(strengths.reduce((a, b) => a * b, 1), 1 / strengths.length)
  const compoundStrength = Math.min(1.0, geoMean * AMPLIFICATION_MULTIPLIER)

  const allTags = [...new Set(contributingPheromones.flatMap(p => p.tags))]
  const allMetrics: Record<string, number> = {}
  for (const p of contributingPheromones) {
    for (const [k, v] of Object.entries(p.metrics)) {
      allMetrics[`${p.type}_${k}`] = v
    }
  }
  allMetrics.contributing_count = contributingPheromones.length
  allMetrics.compound_strength = compoundStrength

  const amplified = await deposit(
    'flywheel-coordinator',
    'amplification',
    domain,
    compoundStrength,
    label,
    allMetrics,
    [...allTags, 'cross-pillar', 'compound'],
    7200, // 2h TTL for compound signals
  )

  // Reinforce all contributing pheromones
  for (const p of contributingPheromones) {
    await reinforce(p.id, 0.1)
  }

  return amplified
}

/**
 * Active cross-pillar amplification — triggered on deposit when multiple
 * pheromone types agree on the same domain, without waiting for decay cron.
 */
async function tryActiveAmplification(domain: string): Promise<void> {
  const existing = await sense({ domain, limit: 20, minStrength: 0.3 })
  const types = new Set(existing.map(p => p.type))
  // Need at least 2 different pheromone types agreeing on this domain
  if (types.size >= 2 && !types.has('amplification')) {
    // Pick strongest from each type
    const byType = new Map<PheromoneType, Pheromone>()
    for (const p of existing) {
      const current = byType.get(p.type)
      if (!current || p.strength > current.strength) byType.set(p.type, p)
    }
    const contributors = [...byType.values()]
    if (contributors.length >= 2) {
      await amplify(domain, contributors, `Cross-pillar: ${[...types].join('+')} on ${domain}`)
    }
  }
}

/**
 * Persist strong/hot trails to Neo4j for long-term knowledge.
 * Called by cron periodically (e.g. every hour).
 */
export async function persistToGraph(): Promise<number> {
  const strong = await sense({ minStrength: PERSIST_THRESHOLD, limit: 50 })
  let persisted = 0

  for (const p of strong) {
    try {
      await callMcpTool({
        toolName: 'memory_store',
        args: {
          agent_id: 'pheromone-layer',
          key: `trail:${p.domain}:${p.id}`,
          value: JSON.stringify({
            type: p.type,
            domain: p.domain,
            strength: p.strength,
            label: p.label,
            metrics: p.metrics,
            reinforcements: p.reinforcements,
            agentId: p.agentId,
          }),
          metadata: {
            pheromone_type: p.type,
            domain: p.domain,
            strength: p.strength,
            reinforcements: p.reinforcements,
          },
        },
        callId: `ph-persist-${p.id}`,
      })
      // Verify persistence with read-back
      try {
        const verify = await callMcpTool({
          toolName: 'memory_retrieve',
          args: { agent_id: 'pheromone-layer', key: `trail:${p.domain}:${p.id}` },
          callId: `ph-verify-${p.id}`,
        })
        if (verify) persisted++
        else logger.warn({ id: p.id }, 'Pheromone persist verification failed')
      } catch {
        logger.warn({ id: p.id }, 'Pheromone persist verification error')
      }
    } catch { /* non-blocking */ }
  }

  state.lastPersistAt = new Date().toISOString()
  logger.info({ persisted, total: strong.length }, 'Pheromone trails persisted to memory')
  return persisted
}

// ─── Trail Aggregation ──────────────────────────────────────────────────────

/**
 * Get aggregated trail summary for a domain — used by routing engine
 * and cost optimizer to make decisions.
 */
export async function getTrailSummary(domain: string): Promise<TrailSummary | null> {
  const trails = await sense({ domain, limit: 50 })
  if (trails.length === 0) return null

  const totalStrength = trails.reduce((sum, p) => sum + p.strength, 0)
  const avgStrength = totalStrength / trails.length

  // Find strongest type
  const typeCounts = new Map<PheromoneType, number>()
  for (const p of trails) {
    typeCounts.set(p.type, (typeCounts.get(p.type) ?? 0) + p.strength)
  }
  const strongestType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'trail'

  // Top contributors
  const agentStrength = new Map<string, number>()
  for (const p of trails) {
    agentStrength.set(p.agentId, (agentStrength.get(p.agentId) ?? 0) + p.strength)
  }
  const topContributors = [...agentStrength.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id)

  return {
    trailId: `trail:${domain}`,
    domain,
    totalStrength,
    pheromoneCount: trails.length,
    avgStrength,
    topContributors,
    strongestType,
  }
}

/**
 * Get heatmap across all domains — for dashboard visualization.
 */
export async function getHeatmap(): Promise<TrailSummary[]> {
  const redis = getRedis()
  if (!redis) return []

  // Discover all domain indexes via SCAN (not KEYS — O(N) blocking on shared Redis)
  const domains: string[] = []
  let cursor = '0'
  do {
    const [next, found] = await redis.scan(cursor, 'MATCH', `${REDIS_PREFIX}domain:*`, 'COUNT', '50')
    cursor = next
    for (const k of found) domains.push(k.replace(`${REDIS_PREFIX}domain:`, ''))
  } while (cursor !== '0' && domains.length < 50)

  const summaries: TrailSummary[] = []
  for (const domain of domains.slice(0, 20)) {
    const summary = await getTrailSummary(domain)
    if (summary) summaries.push(summary)
  }

  return summaries.sort((a, b) => b.totalStrength - a.totalStrength)
}

// ─── Convenience Depositors (used by other modules) ─────────────────────────

/** Chain step completed successfully — deposit trail pheromone */
export async function onChainStepSuccess(
  agentId: string, toolName: string, durationMs: number, chainMode: string,
): Promise<void> {
  await deposit(
    agentId, 'trail', `chain:${toolName}`,
    Math.min(1.0, 0.5 + (1000 / Math.max(durationMs, 100)) * 0.5), // faster = stronger
    `${agentId} succeeded at ${toolName} in ${durationMs}ms`,
    { duration_ms: durationMs },
    [chainMode, toolName],
    3600, // 1h TTL
  )
}

/** Chain step failed — deposit repellent pheromone */
export async function onChainStepFailure(
  agentId: string, toolName: string, error: string,
): Promise<void> {
  await deposit(
    agentId, 'repellent', `chain:${toolName}`,
    0.7,
    `${agentId} failed at ${toolName}: ${error.slice(0, 100)}`,
    { failure: 1 },
    ['error', toolName],
    1800, // 30min TTL (failures fade faster)
  )
}

/** Inventor trial completed — deposit attraction/repellent based on score */
export async function onInventorTrial(
  nodeId: string, score: number, experiment: string, island: number,
): Promise<void> {
  if (score >= 0.7) {
    await deposit(
      'inventor', 'attraction', `inventor:${experiment}`,
      score,
      `Inventor trial ${nodeId} scored ${(score * 100).toFixed(1)}% on island ${island}`,
      { score, island },
      ['inventor', experiment, `island-${island}`],
      7200, // 2h for good trials
    )
  } else if (score < 0.3) {
    await deposit(
      'inventor', 'repellent', `inventor:${experiment}`,
      0.3 + (0.3 - score), // worse score = stronger repellent
      `Inventor trial ${nodeId} scored poorly: ${(score * 100).toFixed(1)}%`,
      { score, island },
      ['inventor', experiment, `island-${island}`],
      900, // 15min for bad trials
    )
  }
}

/** Anomaly detected — deposit repellent (negative) or attraction (positive) */
export async function onAnomaly(
  type: string, valence: 'negative' | 'positive', source: string, severity: string,
): Promise<void> {
  const pType: PheromoneType = valence === 'positive' ? 'attraction' : 'repellent'
  const strength = severity === 'critical' ? 0.9 : severity === 'warning' ? 0.6 : 0.3
  const ttl = valence === 'positive' ? 7200 : 1800 // positives persist longer

  await deposit(
    'anomaly-watcher', pType, `anomaly:${type}`,
    strength,
    `Anomaly ${type} (${valence}) from ${source} [${severity}]`,
    {},
    [valence, severity, source, type],
    ttl,
  )
}

/** External signal (OSINT, research, competitive) — deposit external pheromone */
export async function onExternalSignal(
  source: string, domain: string, label: string,
  strength: number, metrics: Record<string, number> = {},
): Promise<void> {
  await deposit(
    source, 'external', `external:${domain}`,
    strength,
    label,
    metrics,
    ['external', source, domain],
    14400, // 4h for external signals
  )
}

// ─── State & Getters ────────────────────────────────────────────────────────

export function getPheromoneState(): PheromoneState {
  return { ...state }
}

async function persistPheromoneState(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    // Update active count from index
    const count = await redis.zcard(REDIS_INDEX_KEY)
    state.activePheromones = count
    await redis.set(REDIS_STATE_KEY, JSON.stringify(state))
  } catch { /* */ }
}

async function loadPheromoneState(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const raw = await redis.get(REDIS_STATE_KEY)
    if (raw) {
      state = { ...state, ...JSON.parse(raw) }
      logger.info({ totalDeposits: state.totalDeposits, activePheromones: state.activePheromones },
        'Pheromone layer: restored state from Redis')
    }
  } catch { /* */ }
}

// ─── Combined Cron: decay + persist + amplify ───────────────────────────────

export async function runPheromoneCron(): Promise<{
  decayed: number; evaporated: number; persisted: number; amplified: number
}> {
  // 1. Decay all pheromones
  const { decayed, evaporated } = await runDecayCycle()

  // 2. Persist strong trails to long-term memory
  const persisted = await persistToGraph()

  // 3. Check for cross-pillar amplification opportunities
  let amplified = 0
  try {
    const heatmap = await getHeatmap()
    for (const trail of heatmap) {
      if (trail.pheromoneCount >= 3 && trail.avgStrength >= 0.5) {
        // Multiple agents depositing strong signals in same domain = amplify
        const pheromonesInDomain = await sense({ domain: trail.domain, minStrength: 0.4, limit: 5 })
        const uniqueTypes = new Set(pheromonesInDomain.map(p => p.type))
        if (uniqueTypes.size >= 2) {
          // Multiple pheromone types in same domain = cross-pillar convergence
          await amplify(
            trail.domain,
            pheromonesInDomain,
            `Cross-pillar convergence in ${trail.domain}: ${[...uniqueTypes].join('+')}`,
          )
          amplified++
        }
      }
    }
  } catch { /* non-blocking */ }

  await persistPheromoneState()

  broadcastSSE('pheromone', {
    event: 'cron_complete',
    decayed, evaporated, persisted, amplified,
    activePheromones: state.activePheromones,
  })

  return { decayed, evaporated, persisted, amplified }
}

// ─── Init ───────────────────────────────────────────────────────────────────

export async function initPheromoneLayer(): Promise<void> {
  await loadPheromoneState()
  logger.info({ totalDeposits: state.totalDeposits, activePheromones: state.activePheromones },
    'Pheromone layer initialized')
}
