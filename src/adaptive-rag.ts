/**
 * adaptive-rag.ts — F5: Adaptive RAG + Q-Learning Integration (LIN-574 v3.0)
 *
 * Self-improving retrieval through 3 mechanisms:
 *   1. Outcome logging — store (query, strategy, channels, confidence, result_count) per RAG call
 *   2. Periodic reclassification — weekly: analyze logged outcomes, adjust routing weights
 *   3. Q-learning reward wiring — feed compound metric to RLM /learn endpoint
 *
 * The system gets measurably smarter with every query.
 */
import { getRedis } from './redis.js'
import { callCognitive, isRlmAvailable } from './cognitive-proxy.js'
import { logger } from './logger.js'

// ─── Types ──────────────────────────────────────────────────────────────────

interface RAGOutcome {
  query: string
  strategy: string
  channels: string[]
  result_count: number
  confidence: number
  timestamp: number
}

interface StrategyStats {
  strategy: string
  total_queries: number
  avg_confidence: number
  avg_result_count: number
  zero_result_rate: number
}

export interface AdaptiveWeights {
  simple_channels: string[]
  multi_hop_channels: string[]
  structured_channels: string[]
  confidence_threshold: number
  updated_at: string
  training_samples: number
}

// ─── Default Weights (matching current dual-rag.ts) ─────────────────────────

const DEFAULT_WEIGHTS: AdaptiveWeights = {
  simple_channels: ['graphrag', 'srag'],
  multi_hop_channels: ['graphrag', 'cypher', 'community'],
  structured_channels: ['cypher', 'graphrag'],
  confidence_threshold: 0.4,
  updated_at: new Date().toISOString(),
  training_samples: 0,
}

const REDIS_WEIGHTS_KEY = 'orchestrator:adaptive-rag:weights'
const REDIS_OUTCOMES_KEY = 'orchestrator:rag-quality-signals'

// ─── Weight Loading ─────────────────────────────────────────────────────────

let cachedWeights: AdaptiveWeights = { ...DEFAULT_WEIGHTS }
let weightsCacheTime = 0
const CACHE_TTL_MS = 60_000 // refresh from Redis every 60s

/**
 * Get current adaptive weights. Used by dual-rag.ts for channel selection.
 */
export async function getAdaptiveWeights(): Promise<AdaptiveWeights> {
  const now = Date.now()
  if (now - weightsCacheTime < CACHE_TTL_MS) return cachedWeights

  const redis = getRedis()
  if (!redis) return cachedWeights

  try {
    const raw = await redis.get(REDIS_WEIGHTS_KEY)
    if (raw) {
      cachedWeights = JSON.parse(raw)
      weightsCacheTime = now
    }
  } catch { /* use cached */ }

  return cachedWeights
}

// ─── Outcome Analysis ───────────────────────────────────────────────────────

/**
 * Analyze recent RAG outcomes and compute per-strategy stats.
 */
async function analyzeOutcomes(windowHours = 168): Promise<StrategyStats[]> {
  const redis = getRedis()
  if (!redis) return []

  try {
    const cutoff = Date.now() - windowHours * 3600_000
    const raw = await redis.lrange(REDIS_OUTCOMES_KEY, 0, 9999)

    const outcomes: RAGOutcome[] = raw
      .map(r => { try { return JSON.parse(r) } catch { return null } })
      .filter((o): o is RAGOutcome => o !== null && o.timestamp > cutoff)

    if (outcomes.length < 10) return [] // Not enough data

    // Group by strategy
    const byStrategy = new Map<string, RAGOutcome[]>()
    for (const o of outcomes) {
      const existing = byStrategy.get(o.strategy) ?? []
      existing.push(o)
      byStrategy.set(o.strategy, existing)
    }

    return Array.from(byStrategy.entries()).map(([strategy, items]) => ({
      strategy,
      total_queries: items.length,
      avg_confidence: items.reduce((s, o) => s + o.confidence, 0) / items.length,
      avg_result_count: items.reduce((s, o) => s + o.result_count, 0) / items.length,
      zero_result_rate: items.filter(o => o.result_count === 0).length / items.length,
    }))
  } catch {
    return []
  }
}

// ─── Periodic Reclassification (weekly cron) ────────────────────────────────

/**
 * Analyze logged outcomes and adjust routing weights.
 * Called by cron scheduler weekly.
 */
export async function retrainRoutingWeights(): Promise<{
  weights: AdaptiveWeights
  stats: StrategyStats[]
  adjustments: string[]
}> {
  const t0 = Date.now()
  logger.info('Adaptive RAG: retraining routing weights')

  const stats = await analyzeOutcomes(168) // Last 7 days
  const adjustments: string[] = []

  if (stats.length === 0) {
    logger.info('Adaptive RAG: insufficient data for retraining (<10 samples)')
    return { weights: cachedWeights, stats, adjustments: ['No data — keeping defaults'] }
  }

  const newWeights = { ...cachedWeights }

  for (const s of stats) {
    // Rule 1: If a strategy has >30% zero-result rate, add srag as fallback
    if (s.zero_result_rate > 0.3) {
      const channelKey = `${s.strategy}_channels` as keyof AdaptiveWeights
      const channels = newWeights[channelKey]
      if (Array.isArray(channels) && !channels.includes('srag')) {
        (channels as string[]).push('srag')
        adjustments.push(`${s.strategy}: added srag fallback (${(s.zero_result_rate * 100).toFixed(0)}% zero-result rate)`)
      }
    }

    // Rule 2: If avg confidence < 0.3, add community channel for context
    if (s.avg_confidence < 0.3) {
      const channelKey = `${s.strategy}_channels` as keyof AdaptiveWeights
      const channels = newWeights[channelKey]
      if (Array.isArray(channels) && !channels.includes('community')) {
        (channels as string[]).push('community')
        adjustments.push(`${s.strategy}: added community channel (avg confidence ${s.avg_confidence.toFixed(2)})`)
      }
    }

    // Rule 3: If a strategy has high confidence (>0.7) and result count, consider removing weaker channels
    if (s.avg_confidence > 0.7 && s.avg_result_count > 5) {
      adjustments.push(`${s.strategy}: performing well (confidence ${s.avg_confidence.toFixed(2)}, ${s.avg_result_count.toFixed(0)} results avg)`)
    }
  }

  // Update confidence threshold based on overall quality
  const overallAvgConf = stats.reduce((s, st) => s + st.avg_confidence, 0) / stats.length
  if (overallAvgConf > 0.6) {
    newWeights.confidence_threshold = Math.min(0.6, overallAvgConf * 0.7)
    adjustments.push(`Confidence threshold → ${newWeights.confidence_threshold.toFixed(2)} (from avg ${overallAvgConf.toFixed(2)})`)
  }

  newWeights.updated_at = new Date().toISOString()
  newWeights.training_samples = stats.reduce((s, st) => s + st.total_queries, 0)

  // Persist to Redis
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(REDIS_WEIGHTS_KEY, JSON.stringify(newWeights))
    } catch { /* non-critical */ }
  }

  cachedWeights = newWeights
  weightsCacheTime = Date.now()

  logger.info({
    samples: newWeights.training_samples,
    adjustments: adjustments.length,
    ms: Date.now() - t0,
  }, 'Adaptive RAG: retraining complete')

  return { weights: newWeights, stats, adjustments }
}

// ─── Q-Learning Reward Wiring ───────────────────────────────────────────────

/**
 * Send compound reward signal to RLM Engine's Q-learning system.
 * Compound metric: accuracy × quality × coverage
 */
export async function sendQLearningReward(
  state: { query_type: string; channels_used: string[]; result_count: number },
  action: { strategy: string; confidence_threshold: number },
  reward: number, // 0-1 compound metric
): Promise<void> {
  if (!isRlmAvailable()) return

  try {
    await callCognitive('learn', {
      prompt: JSON.stringify({
        state: {
          query_type: state.query_type,
          channel_count: state.channels_used.length,
          result_density: state.result_count > 0 ? 1 : 0,
        },
        action: {
          strategy: action.strategy,
          threshold: action.confidence_threshold,
        },
        reward,
        agent_id: 'adaptive-rag',
        domain: 'rag-optimization',
      }),
      context: { source: 'adaptive-rag-f5', type: 'q-learning-reward' },
      agent_id: 'adaptive-rag',
    }, 10000)

    logger.debug({ reward: reward.toFixed(3), strategy: action.strategy }, 'Q-learning reward sent')
  } catch {
    // Q-learning is best-effort — never block RAG
  }
}

// ─── Compound Metric Calculator ─────────────────────────────────────────────

/**
 * Calculate compound intelligence metric from RAG outcomes.
 * Used as Q-learning reward and for dashboard display.
 *
 * Score = accuracy × quality × coverage
 *   accuracy  = avg confidence across queries (0-1)
 *   quality   = 1 - zero_result_rate (0-1)
 *   coverage  = avg_result_count / target_count (capped at 1)
 */
export function calculateCompoundMetric(stats: StrategyStats[]): {
  score: number
  accuracy: number
  quality: number
  coverage: number
} {
  if (stats.length === 0) return { score: 0, accuracy: 0, quality: 0, coverage: 0 }

  const totalQueries = stats.reduce((s, st) => s + st.total_queries, 0)

  // Weighted averages by query count
  const accuracy = stats.reduce((s, st) => s + st.avg_confidence * st.total_queries, 0) / totalQueries
  const quality = 1 - stats.reduce((s, st) => s + st.zero_result_rate * st.total_queries, 0) / totalQueries
  const coverage = Math.min(1, stats.reduce((s, st) => s + st.avg_result_count * st.total_queries, 0) / totalQueries / 5) // target: 5 results

  return {
    score: Math.round(accuracy * quality * coverage * 1000) / 1000,
    accuracy: Math.round(accuracy * 1000) / 1000,
    quality: Math.round(quality * 1000) / 1000,
    coverage: Math.round(coverage * 1000) / 1000,
  }
}

// ─── Dashboard Data ─────────────────────────────────────────────────────────

export async function getAdaptiveRAGDashboard(): Promise<{
  weights: AdaptiveWeights
  stats: StrategyStats[]
  compound_metric: ReturnType<typeof calculateCompoundMetric>
  outcome_count: number
}> {
  const weights = await getAdaptiveWeights()
  const stats = await analyzeOutcomes(168)
  const compound_metric = calculateCompoundMetric(stats)
  const outcome_count = stats.reduce((s, st) => s + st.total_queries, 0)

  return { weights, stats, compound_metric, outcome_count }
}
