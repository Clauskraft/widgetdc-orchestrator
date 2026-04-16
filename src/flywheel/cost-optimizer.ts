/**
 * cost-optimizer.ts — Dynamic cost-aware agent routing
 *
 * Tracks per-agent cost/quality/latency profiles across task types.
 * Exposes selectOptimalAgent() so chains can route to the cheapest
 * agent that still meets a minimum quality threshold.
 *
 * Storage: in-memory Map (hot path) + Redis (cross-restart persistence)
 *
 * Integration points:
 *   - chain-engine.ts: calls updateCostProfile() after each step
 *   - peer-eval.ts: shares quality signal via hookIntoExecution
 *   - flywheel-coordinator.ts: reads getCostSummary() for weekly report
 *
 * Redis keys:
 *   orchestrator:cost:profile:<agentId>:<taskType>  → JSON CostProfile
 *   orchestrator:cost:index                         → SET of "agentId:taskType" keys
 */

import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

const REDIS_PREFIX = 'orchestrator:cost:'
const REDIS_INDEX  = `${REDIS_PREFIX}index`
const MIN_SAMPLES_FOR_ROUTING = 5   // need at least N evals before trusting the profile
const MAX_PROFILES = 1000           // cap in-memory profiles

export interface CostProfile {
  agentId: string
  taskType: string
  totalTasks: number
  totalCostUsd: number
  totalLatencyMs: number
  totalQualityScore: number
  avgCostUsd: number
  avgLatencyMs: number
  avgQualityScore: number
  /** quality / (cost + 0.001) — higher is better */
  efficiencyRatio: number
  /** last 10 quality scores for trend detection */
  recentScores: number[]
  /** true if last 3 tasks averaged quality < 0.4 */
  degraded: boolean
  lastUpdatedAt: string
}

// ─── In-memory store ──────────────────────────────────────────────────────────
const profiles = new Map<string, CostProfile>()
let persistTimer: ReturnType<typeof setTimeout> | null = null

function profileKey(agentId: string, taskType: string): string {
  return `${agentId}:${taskType}`
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Record a completed step's cost/quality metrics.
 * Safe to call fire-and-forget (.catch(() => {})).
 */
export async function updateCostProfile(
  agentId: string,
  taskType: string,
  metrics: { latency_ms: number; quality_score: number; cost_usd?: number },
): Promise<void> {
  if (!agentId || !taskType) return
  const key = profileKey(agentId, taskType)
  const existing = profiles.get(key)
  const cost = metrics.cost_usd ?? 0
  const quality = Math.max(0, Math.min(1, metrics.quality_score))

  const p: CostProfile = existing
    ? {
        ...existing,
        totalTasks: existing.totalTasks + 1,
        totalCostUsd: existing.totalCostUsd + cost,
        totalLatencyMs: existing.totalLatencyMs + metrics.latency_ms,
        totalQualityScore: existing.totalQualityScore + quality,
        recentScores: [...existing.recentScores, quality].slice(-10),
        lastUpdatedAt: new Date().toISOString(),
      }
    : {
        agentId,
        taskType,
        totalTasks: 1,
        totalCostUsd: cost,
        totalLatencyMs: metrics.latency_ms,
        totalQualityScore: quality,
        avgCostUsd: cost,
        avgLatencyMs: metrics.latency_ms,
        avgQualityScore: quality,
        efficiencyRatio: quality / (cost + 0.001),
        recentScores: [quality],
        degraded: false,
        lastUpdatedAt: new Date().toISOString(),
      }

  // Recompute derived fields
  p.avgCostUsd = p.totalCostUsd / p.totalTasks
  p.avgLatencyMs = p.totalLatencyMs / p.totalTasks
  p.avgQualityScore = p.totalQualityScore / p.totalTasks
  p.efficiencyRatio = p.avgQualityScore / (p.avgCostUsd + 0.001)
  p.degraded = p.recentScores.length >= 3
    && p.recentScores.slice(-3).reduce((s, v) => s + v, 0) / 3 < 0.4

  // Evict oldest if over cap
  if (!existing && profiles.size >= MAX_PROFILES) {
    const firstKey = profiles.keys().next().value
    if (firstKey) profiles.delete(firstKey)
  }
  profiles.set(key, p)

  if (p.degraded) {
    logger.warn({ agentId, taskType, recent: p.recentScores.slice(-3) },
      '[CostOptimizer] Agent quality degradation detected')
  }

  // Debounced Redis persist
  schedulePersist()
}

/**
 * Return the best agent from a candidate list for a given task type.
 * Falls back to first candidate if insufficient data.
 */
export function selectOptimalAgent(
  taskType: string,
  candidates: string[],
  opts: { minQuality?: number; maxCostUsd?: number } = {},
): { agentId: string; profile: CostProfile | null; confidence: number } {
  const { minQuality = 0.5, maxCostUsd = Infinity } = opts
  const eligible: Array<{ agentId: string; profile: CostProfile; confidence: number }> = []

  for (const agentId of candidates) {
    const p = profiles.get(profileKey(agentId, taskType))
    if (!p || p.totalTasks < MIN_SAMPLES_FOR_ROUTING) continue
    if (p.avgQualityScore < minQuality) continue
    if (p.avgCostUsd > maxCostUsd) continue
    if (p.degraded) continue
    const confidence = Math.min(0.95, 0.5 + p.totalTasks * 0.02)
    eligible.push({ agentId, profile: p, confidence })
  }

  if (eligible.length === 0) {
    return { agentId: candidates[0] ?? 'default', profile: null, confidence: 0.3 }
  }

  eligible.sort((a, b) => b.profile.efficiencyRatio - a.profile.efficiencyRatio)
  const best = eligible[0]
  return { agentId: best.agentId, profile: best.profile, confidence: best.confidence }
}

export function getCostProfile(agentId: string, taskType: string): CostProfile | null {
  return profiles.get(profileKey(agentId, taskType)) ?? null
}

// ─── Adaptive Timeout (topic 5/15) ───────────────────────────────────────────

/** Static baseline timeouts per tool category (ms) */
const BASELINE_TIMEOUT: Record<string, number> = {
  graph:         15000,
  kg_rag:        20000,
  srag:          20000,
  adaptive_rag:  20000,
  rag_:          20000,
  linear:         8000,
  'rlm.':        30000,
  cognitive:     30000,
  reason:        30000,
  llm_:          25000,
  knowledge_:    12000,
  memory_:       10000,
  hyperagent:   120000,
  inventor:     120000,
  default:       30000,
}

/**
 * Return the optimal timeout (ms) for a tool call.
 * If the cost-optimizer has enough samples for agentId+toolName, uses
 * p95 latency (avgLatencyMs * 3, min 5s, max 120s).
 * Falls back to static baseline per tool category.
 */
export function adaptiveTimeout(toolName: string, agentId?: string): number {
  // Try profile-based timeout first
  if (agentId) {
    const profile = getCostProfile(agentId, toolName)
    if (profile && profile.totalTasks >= 5 && profile.avgLatencyMs > 0) {
      const p95 = Math.round(profile.avgLatencyMs * 3)
      return Math.max(5000, Math.min(120000, p95))
    }
  }

  // Static baseline lookup
  const lower = toolName.toLowerCase()
  for (const [prefix, ms] of Object.entries(BASELINE_TIMEOUT)) {
    if (prefix !== 'default' && lower.startsWith(prefix)) return ms
  }
  return BASELINE_TIMEOUT.default
}

export function getAllCostProfiles(): CostProfile[] {
  return [...profiles.values()]
}

export function getCostSummary(): {
  totalProfiles: number
  degradedAgents: string[]
  topEfficient: CostProfile[]
  avgPlatformCostPerTask: number
  taskTypesCovered: number
} {
  const all = getAllCostProfiles()
  const totalCost = all.reduce((s, p) => s + p.totalCostUsd, 0)
  const totalTasks = all.reduce((s, p) => s + p.totalTasks, 0)
  const taskTypes = new Set(all.map(p => p.taskType))
  return {
    totalProfiles: all.length,
    degradedAgents: all.filter(p => p.degraded).map(p => p.agentId),
    topEfficient: [...all].sort((a, b) => b.efficiencyRatio - a.efficiencyRatio).slice(0, 5),
    avgPlatformCostPerTask: totalTasks > 0 ? totalCost / totalTasks : 0,
    taskTypesCovered: taskTypes.size,
  }
}

// ─── Redis persistence ────────────────────────────────────────────────────────

function schedulePersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(async () => {
    persistTimer = null
    await persistToRedis()
  }, 5000)
}

async function persistToRedis(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const pipeline = redis.multi()
    for (const [key, profile] of profiles.entries()) {
      pipeline.set(`${REDIS_PREFIX}profile:${key}`, JSON.stringify(profile), { EX: 30 * 24 * 3600 })
    }
    pipeline.sadd(REDIS_INDEX, ...[...profiles.keys()])
    await pipeline.exec()
  } catch (err) {
    logger.warn({ error: String(err) }, '[CostOptimizer] Redis persist failed')
  }
}

/** Load profiles from Redis on startup. */
export async function loadFromRedis(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const keys = await redis.smembers(REDIS_INDEX)
    if (!keys.length) return
    const values = await redis.mGet(keys.map(k => `${REDIS_PREFIX}profile:${k}`))
    let loaded = 0
    for (const v of values) {
      if (!v) continue
      try {
        const p: CostProfile = JSON.parse(v)
        if (p.agentId && p.taskType) {
          profiles.set(profileKey(p.agentId, p.taskType), p)
          loaded++
        }
      } catch { /* skip malformed */ }
    }
    logger.info({ loaded }, '[CostOptimizer] Loaded cost profiles from Redis')
  } catch (err) {
    logger.warn({ error: String(err) }, '[CostOptimizer] Redis load failed')
  }
}
