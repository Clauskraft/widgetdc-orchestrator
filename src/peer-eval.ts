/**
 * peer-eval.ts — Fleet Learning Engine (Collective Intelligence)
 *
 * Every agent evaluates its own performance after each task.
 * Cross-agent reviews propagate learnings across the fleet.
 * High-novelty high-score patterns are broadcast as best practices.
 *
 * Pipeline: EXECUTE → SELF-ASSESS → PEER-REVIEW → BROADCAST → REMEMBER
 *
 * Integrations:
 *   - Pheromone Layer: deposits attraction (success) / repellent (failure) pheromones
 *   - Adaptive RAG: reward signals for routing weight updates
 *   - Memory: stores evaluations for future retrieval
 *   - Anomaly Watcher: triggers on extreme score deviations
 *   - Cost Optimizer: provides cost/quality ratio data
 */
import { v4 as uuid } from 'uuid'
import { getRedis } from './redis.js'
import { callMcpTool } from './mcp-caller.js'
import { callCognitiveRaw, isRlmAvailable } from './cognitive-proxy.js'
import { broadcastSSE } from './sse.js'
import { broadcastMessage } from './chat-broadcaster.js'
import { logger } from './logger.js'
import {
  deposit, reinforce, sense, onChainStepSuccess, onChainStepFailure,
  type PheromoneQuery,
} from './pheromone-layer.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EvalReport {
  id: string
  agentId: string
  taskId: string
  taskType: string
  chainId: string | null
  /** Self-assessed score 0.0 – 1.0 */
  selfScore: number
  /** Confidence in the self-score 0.0 – 1.0 */
  confidence: number
  /** Measured metrics */
  metrics: {
    cost_usd: number
    latency_ms: number
    quality_score: number
    token_count?: number
  }
  /** What the agent learned from this task */
  insights: string[]
  /** Was this a novel approach? (no prior pheromone trail) */
  novelty: number
  /** Upstream agent that provided input (if any) */
  upstreamAgentId: string | null
  /** Was the input from upstream useful? */
  upstreamQuality: number | null
  /** Status */
  success: boolean
  createdAt: string
}

interface FleetLearning {
  taskType: string
  totalEvals: number
  avgScore: number
  avgCost: number
  avgLatency: number
  bestAgent: string | null
  bestScore: number
  bestPractices: BestPractice[]
  lastUpdated: string
  reliable: boolean  // true when totalEvals >= 20 (enough data for EMA stability)
}

interface BestPractice {
  id: string
  agentId: string
  taskType: string
  score: number
  novelty: number
  insight: string
  discoveredAt: string
  reinforcements: number
}

interface PeerEvalState {
  totalEvals: number
  totalPeerReviews: number
  totalBestPracticesShared: number
  fleetLearnings: Map<string, FleetLearning>
  lastEvalAt: string | null
}

// ─── State ──────────────────────────────────────────────────────────────────

const REDIS_PREFIX = 'peer-eval:'
const REDIS_STATE_KEY = 'peer-eval:state'
const MAX_BEST_PRACTICES = 50
const NOVELTY_THRESHOLD = 0.6
const BROADCAST_THRESHOLD = 0.75 // score + novelty must exceed this

let state: PeerEvalState = {
  totalEvals: 0,
  totalPeerReviews: 0,
  totalBestPracticesShared: 0,
  fleetLearnings: new Map(),
  lastEvalAt: null,
}

// ─── Core: Self-Assessment Hook ─────────────────────────────────────────────

/**
 * Primary hook — called after every chain step or agent task completion.
 * This is the main entry point for the PeerEval system.
 */
export async function hookIntoExecution(
  agentId: string,
  taskId: string,
  context: {
    taskType: string
    chainId?: string
    inputs?: unknown
    outputs?: unknown
    success: boolean
    metrics: { cost_usd?: number; latency_ms: number; quality_score?: number; token_count?: number }
    upstreamAgentId?: string
    upstreamQuality?: number
    insights?: string[]
  },
): Promise<EvalReport> {
  const t0 = Date.now()

  // Calculate self-score based on available metrics
  const qualityScore = context.metrics.quality_score ?? (context.success ? 0.7 : 0.2)
  const latencyPenalty = context.metrics.latency_ms > 10000 ? 0.1 : 0
  const selfScore = Math.max(0, Math.min(1, qualityScore - latencyPenalty))

  // Calculate novelty by checking existing pheromone trails
  let novelty = 0.5 // default medium novelty
  try {
    const existingTrails = await sense({
      domain: `chain:${context.taskType}`,
      type: 'trail',
      minStrength: 0.3,
      limit: 5,
    })
    // Fewer existing trails = higher novelty
    novelty = existingTrails.length === 0 ? 1.0
      : existingTrails.length < 3 ? 0.7
      : existingTrails.length < 10 ? 0.4
      : 0.2
  } catch { /* default novelty */ }

  const evalReport: EvalReport = {
    id: `eval-${uuid().slice(0, 12)}`,
    agentId,
    taskId,
    taskType: context.taskType,
    chainId: context.chainId ?? null,
    selfScore,
    confidence: context.success ? 0.8 : 0.5,
    metrics: {
      cost_usd: context.metrics.cost_usd ?? 0,
      latency_ms: context.metrics.latency_ms,
      quality_score: qualityScore,
      token_count: context.metrics.token_count,
    },
    insights: context.insights ?? [],
    novelty,
    upstreamAgentId: context.upstreamAgentId ?? null,
    upstreamQuality: context.upstreamQuality ?? null,
    success: context.success,
    createdAt: new Date().toISOString(),
  }

  // ── 1. Deposit pheromones based on outcome ──
  if (context.success) {
    await onChainStepSuccess(agentId, context.taskType, context.metrics.latency_ms, 'evaluated')
  } else {
    await onChainStepFailure(agentId, context.taskType, 'Task failed')
  }

  // ── 2. Store evaluation in memory ──
  try {
    await callMcpTool({
      toolName: 'memory_store',
      args: {
        agent_id: 'peer-eval',
        key: `eval:${agentId}:${taskId}`,
        value: JSON.stringify({
          selfScore: evalReport.selfScore,
          taskType: evalReport.taskType,
          success: evalReport.success,
          metrics: evalReport.metrics,
          insights: evalReport.insights,
          novelty: evalReport.novelty,
        }),
        metadata: {
          agent_id: agentId,
          task_type: context.taskType,
          score: evalReport.selfScore,
          novelty: evalReport.novelty,
          success: evalReport.success,
        },
      },
      callId: `peereval-mem-${evalReport.id}`,
    })
  } catch { /* non-blocking */ }

  // ── 3. Send adaptive RAG reward ──
  try {
    await callMcpTool({
      toolName: 'adaptive_rag_reward',
      args: {
        query: context.taskType,
        reward: evalReport.selfScore,
        metadata: {
          source: 'peer-eval',
          agent_id: agentId,
          novelty: evalReport.novelty,
        },
      },
      callId: `peereval-rag-${evalReport.id}`,
    })
  } catch { /* non-blocking */ }

  // ── 4. Update fleet learning ──
  updateFleetLearning(evalReport)

  // ── 5. Check if this is a best practice worth broadcasting ──
  if (evalReport.selfScore >= BROADCAST_THRESHOLD && evalReport.novelty >= NOVELTY_THRESHOLD) {
    await broadcastBestPractice(evalReport)
  }

  // ── 6. Store in Redis for dashboard access ──
  const redis = getRedis()
  if (redis) {
    await redis.zadd(`${REDIS_PREFIX}recent`, Date.now(), JSON.stringify(evalReport))
    // Trim to last 200 evals
    await redis.zremrangebyrank(`${REDIS_PREFIX}recent`, 0, -201)
  }

  state.totalEvals++
  state.lastEvalAt = new Date().toISOString()

  broadcastSSE('peer-eval', {
    event: 'eval_complete',
    evalId: evalReport.id,
    agentId,
    taskType: context.taskType,
    selfScore: evalReport.selfScore,
    novelty: evalReport.novelty,
    success: evalReport.success,
    duration_ms: Date.now() - t0,
  })

  logger.debug({
    evalId: evalReport.id, agentId, taskType: context.taskType,
    score: evalReport.selfScore, novelty: evalReport.novelty,
  }, 'PeerEval: evaluation complete')

  return evalReport
}

// ─── Fleet Learning Aggregation ─────────────────────────────────────────────

function updateFleetLearning(eval_: EvalReport): void {
  let learning = state.fleetLearnings.get(eval_.taskType)
  if (!learning) {
    learning = {
      taskType: eval_.taskType,
      totalEvals: 0,
      avgScore: 0,
      avgCost: 0,
      avgLatency: 0,
      bestAgent: null,
      bestScore: 0,
      bestPractices: [],
      lastUpdated: new Date().toISOString(),
      reliable: false,
    }
    state.fleetLearnings.set(eval_.taskType, learning)
  }

  // Running averages (exponential moving average for recency bias)
  const alpha = 0.1 // EMA weight — recent evals matter more
  learning.totalEvals++
  learning.avgScore = learning.avgScore * (1 - alpha) + eval_.selfScore * alpha
  learning.avgCost = learning.avgCost * (1 - alpha) + eval_.metrics.cost_usd * alpha
  learning.avgLatency = learning.avgLatency * (1 - alpha) + eval_.metrics.latency_ms * alpha
  learning.lastUpdated = new Date().toISOString()

  if (eval_.selfScore > learning.bestScore) {
    learning.bestScore = eval_.selfScore
    learning.bestAgent = eval_.agentId
  }

  learning.reliable = learning.totalEvals >= 20
}

// ─── Best Practice Broadcasting ─────────────────────────────────────────────

async function broadcastBestPractice(eval_: EvalReport): Promise<void> {
  const insightText = eval_.insights.length > 0
    ? eval_.insights.join('; ')
    : `Agent ${eval_.agentId} scored ${(eval_.selfScore * 100).toFixed(1)}% on ${eval_.taskType} (novelty: ${(eval_.novelty * 100).toFixed(0)}%)`

  const bp: BestPractice = {
    id: `bp-${uuid().slice(0, 8)}`,
    agentId: eval_.agentId,
    taskType: eval_.taskType,
    score: eval_.selfScore,
    novelty: eval_.novelty,
    insight: insightText,
    discoveredAt: new Date().toISOString(),
    reinforcements: 0,
  }

  // Add to fleet learning
  const learning = state.fleetLearnings.get(eval_.taskType)
  if (learning) {
    learning.bestPractices.push(bp)
    if (learning.bestPractices.length > MAX_BEST_PRACTICES) {
      learning.bestPractices.sort((a, b) => b.score - a.score)
      learning.bestPractices = learning.bestPractices.slice(0, MAX_BEST_PRACTICES)
    }
  }

  // Deposit strong attraction pheromone for best practice
  await deposit(
    eval_.agentId, 'attraction', `best-practice:${eval_.taskType}`,
    Math.min(1.0, eval_.selfScore * 1.2),
    `Best practice: ${insightText.slice(0, 200)}`,
    { score: eval_.selfScore, novelty: eval_.novelty },
    ['best-practice', eval_.taskType, eval_.agentId],
    14400, // 4h TTL for best practices
  )

  // Broadcast to fleet
  broadcastMessage({
    from: 'PeerEval',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `New best practice from ${eval_.agentId}: ${insightText.slice(0, 200)}`,
  } as Record<string, unknown>)

  state.totalBestPracticesShared++

  logger.info({
    bpId: bp.id, agentId: eval_.agentId, taskType: eval_.taskType,
    score: eval_.selfScore, novelty: eval_.novelty,
  }, 'PeerEval: best practice broadcast')
}

// ─── Fleet Query API ────────────────────────────────────────────────────────

/**
 * Query what the fleet has learned about a task type.
 * Used by routing engine, cost optimizer, and agents themselves.
 */
export function getFleetLearning(taskType: string): FleetLearning | null {
  const learning = state.fleetLearnings.get(taskType)
  if (!learning) return null
  return {
    ...learning,
    bestPractices: [...learning.bestPractices],
  }
}

/**
 * Check if fleet learning data for a task type is reliable (>= 20 evals).
 * Used by routing engine to avoid premature optimization on sparse data.
 */
export function isFleetReliable(taskType: string): boolean {
  const learning = state.fleetLearnings.get(taskType)
  return learning?.reliable ?? false
}

/**
 * Get all fleet learnings — for dashboard overview.
 */
export function getAllFleetLearnings(): FleetLearning[] {
  return [...state.fleetLearnings.values()].map(l => ({
    ...l,
    bestPractices: [...l.bestPractices],
  }))
}

/**
 * Get what-works summary for a task type — pre-digested for routing.
 */
export async function getWhatWorks(taskType: string): Promise<{
  bestAgent: string | null
  avgEfficiency: number
  topStrategies: string[]
  pheromoneStrength: number
}> {
  const learning = state.fleetLearnings.get(taskType)
  const trails = await sense({ domain: `chain:${taskType}`, type: 'attraction', limit: 10 })

  const topStrategies = trails
    .filter(p => p.strength >= 0.5)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5)
    .map(p => p.label)

  const totalPheromoneStrength = trails.reduce((sum, p) => sum + p.strength, 0)

  return {
    bestAgent: learning?.bestAgent ?? null,
    avgEfficiency: learning ? (learning.avgScore / Math.max(learning.avgCost, 0.01)) : 0,
    topStrategies,
    pheromoneStrength: totalPheromoneStrength,
  }
}

/**
 * Get recent evaluations from Redis — for dashboard.
 */
export async function getRecentEvals(limit: number = 20): Promise<EvalReport[]> {
  const redis = getRedis()
  if (!redis) return []

  const raw = await redis.zrevrange(`${REDIS_PREFIX}recent`, 0, limit - 1)
  return raw.map(r => {
    try { return JSON.parse(r) as EvalReport } catch { return null }
  }).filter((e): e is EvalReport => e !== null)
}

// ─── RLM-Powered Fleet Reasoning (periodic) ─────────────────────────────────

/**
 * Use RLM to reason about fleet-wide patterns and generate strategic insights.
 * Called by cron weekly or on-demand.
 */
export async function runFleetAnalysis(): Promise<string> {
  if (!isRlmAvailable()) return 'RLM unavailable'

  const learnings = getAllFleetLearnings()
  if (learnings.length === 0) return 'No fleet learnings yet'

  try {
    const result = await callCognitiveRaw('reason', {
      prompt: `You are the Fleet Intelligence Analyst for WidgeTDC.

FLEET LEARNING SUMMARY (${learnings.length} task types tracked):
${learnings.map(l => `- ${l.taskType}: ${l.totalEvals} evals, avg score ${l.avgScore.toFixed(2)}, avg cost $${l.avgCost.toFixed(2)}, best agent: ${l.bestAgent || 'none'} (${l.bestScore.toFixed(2)}), ${l.bestPractices.length} best practices`).join('\n')}

TOP BEST PRACTICES:
${learnings.flatMap(l => l.bestPractices).sort((a, b) => b.score - a.score).slice(0, 10).map(bp => `- [${bp.taskType}] ${bp.agentId}: ${bp.insight.slice(0, 150)} (score: ${bp.score.toFixed(2)}, novelty: ${bp.novelty.toFixed(2)})`).join('\n') || '(none yet)'}

Analyze:
1. FLEET HEALTH: Which task types are well-served? Which are underperforming?
2. COST EFFICIENCY: Where is cost/quality ratio best? Worst?
3. LEARNING VELOCITY: Which areas are improving fastest?
4. STRATEGIC RECOMMENDATIONS: What should we double down on? What should we deprecate?
5. PHEROMONE STRATEGY: Which trails should be reinforced? Which should decay faster?`,
      agent_id: 'peer-eval',
      depth: 2,
    }, 20000)

    const analysis = String(result.answer || result.result || '')

    // Store analysis to memory
    if (analysis.length > 50) {
      try {
        await callMcpTool({
          toolName: 'memory_store',
          args: {
            agent_id: 'peer-eval',
            key: `fleet-analysis:${Date.now()}`,
            value: analysis.slice(0, 2000),
            metadata: {
              task_types: learnings.map(l => l.taskType),
              total_evals: learnings.reduce((s, l) => s + l.totalEvals, 0),
            },
          },
          callId: `fleet-analysis-${Date.now()}`,
        })
      } catch { /* non-blocking */ }
    }

    return analysis
  } catch (err) {
    logger.warn({ error: String(err) }, 'PeerEval: fleet analysis failed')
    return `Fleet analysis failed: ${err}`
  }
}

// ─── State Persistence ──────────────────────────────────────────────────────

export function getPeerEvalState(): {
  totalEvals: number
  totalPeerReviews: number
  totalBestPracticesShared: number
  taskTypesTracked: number
  lastEvalAt: string | null
} {
  return {
    totalEvals: state.totalEvals,
    totalPeerReviews: state.totalPeerReviews,
    totalBestPracticesShared: state.totalBestPracticesShared,
    taskTypesTracked: state.fleetLearnings.size,
    lastEvalAt: state.lastEvalAt,
  }
}

async function persistState(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const serializable = {
      ...state,
      fleetLearnings: Object.fromEntries(state.fleetLearnings),
    }
    await redis.set(REDIS_STATE_KEY, JSON.stringify(serializable))
  } catch { /* */ }
}

async function loadState(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const raw = await redis.get(REDIS_STATE_KEY)
    if (raw) {
      const loaded = JSON.parse(raw)
      state = {
        ...state,
        ...loaded,
        fleetLearnings: new Map(Object.entries(loaded.fleetLearnings ?? {})),
      }
      logger.info({ totalEvals: state.totalEvals, taskTypes: state.fleetLearnings.size },
        'PeerEval: restored state from Redis')
    }
  } catch { /* */ }
}

// ─── Init ───────────────────────────────────────────────────────────────────

export async function initPeerEval(): Promise<void> {
  await loadState()
  logger.info({ totalEvals: state.totalEvals, taskTypes: state.fleetLearnings.size },
    'PeerEval engine initialized')
}
