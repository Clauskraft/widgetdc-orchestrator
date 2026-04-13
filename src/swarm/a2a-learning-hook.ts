/**
 * a2a-learning-hook.ts — D2: A2A Learning Hook
 *
 * Extracts learning signals from agent-to-agent chat traffic and feeds them
 * to the fleet learning + pheromone systems.
 *
 * Two extraction modes:
 *   1. EXPLICIT — agent emits structured tag in message:
 *      "[eval taskType=X score=0.85 latency_ms=1200 cost_usd=0.01]"
 *      → high-confidence eval, exact metrics
 *
 *   2. IMPLICIT — sentiment heuristic on completion-typed messages:
 *      types 'TaskComplete' / 'StatusReport' with positive/negative keywords
 *      → low-confidence eval, score 0.7 (positive) or 0.3 (negative)
 *
 * Chitchat (no explicit tag, no completion type) is IGNORED — we don't pollute
 * the learning signal with arbitrary chat.
 *
 * Hook is fire-and-forget — never blocks chat broadcast.
 */
import type { AgentMessage } from '@widgetdc/contracts/orchestrator'
import { logger } from '../logger.js'

export interface A2ALearningSignal {
  agentId: string
  taskType: string
  score: number
  latency_ms: number
  cost: number
  success: boolean
  timestamp: string
  source: 'explicit' | 'implicit-positive' | 'implicit-negative'
}

const POSITIVE_PATTERN = /\u2705|shipped|passed|merged|completed|delivered|deployed|fixed|verified|works|success/i
const NEGATIVE_PATTERN = /\u274c|failed|blocked|crashed|broken|timeout|rejected|aborted|error\b/i
const TASK_REPORT_TYPES = new Set(['TaskComplete', 'StatusReport', 'OutcomeReport'])

function parseExplicitTag(text: string): Record<string, string> | null {
  const m = /\[eval\s+([^\]]+)\]/.exec(text)
  if (!m) return null
  const out: Record<string, string> = {}
  for (const pair of m[1].trim().split(/\s+/)) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    out[pair.slice(0, eq)] = pair.slice(eq + 1).replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * Extract a learning signal from an A2A message, or null if no signal.
 */
export function extractA2ALearningSignal(msg: AgentMessage): A2ALearningSignal | null {
  // Skip system / orchestrator-emitted messages — those don't represent agent work
  const fromLower = String(msg.from ?? '').toLowerCase()
  if (!msg.from || fromLower === 'orchestrator' || fromLower === 'system' || fromLower === 'cron') {
    return null
  }
  const text = String(msg.message ?? '').trim()
  if (!text) return null

  // Mode 1: Explicit tag (highest signal)
  const explicit = parseExplicitTag(text)
  if (explicit?.['taskType'] && explicit['score']) {
    const score = parseFloat(explicit['score'])
    if (!Number.isFinite(score) || score < 0 || score > 1) return null
    return {
      agentId: msg.from,
      taskType: explicit['taskType'],
      score,
      latency_ms: parseInt(explicit['latency_ms'] ?? '0', 10) || 0,
      cost: parseFloat(explicit['cost_usd'] ?? explicit['cost'] ?? '0') || 0,
      success: score >= 0.5,
      timestamp: msg.timestamp ?? new Date().toISOString(),
      source: 'explicit',
    }
  }

  // Mode 2: Implicit sentiment — only on messages explicitly typed as task reports
  const msgType = String(msg.type ?? '')
  if (!TASK_REPORT_TYPES.has(msgType)) return null

  const positive = POSITIVE_PATTERN.test(text)
  const negative = NEGATIVE_PATTERN.test(text)
  if (!positive && !negative) return null
  // If both, treat as negative (failure dominates)
  const isPositive = positive && !negative

  return {
    agentId: msg.from,
    taskType: `a2a-${msgType.toLowerCase()}`,
    score: isPositive ? 0.7 : 0.3,
    latency_ms: 0,
    cost: 0,
    success: isPositive,
    timestamp: msg.timestamp ?? new Date().toISOString(),
    source: isPositive ? 'implicit-positive' : 'implicit-negative',
  }
}

/**
 * Hook: process an A2A message for learning signal. Fire-and-forget.
 * Calls peer-eval (fleet stats) AND fleet-pheromone bridge (pheromone deposit).
 */
export function a2aLearningHook(msg: AgentMessage): void {
  const signal = extractA2ALearningSignal(msg)
  if (!signal) return

  // Fire both in parallel, never block, never throw
  Promise.all([
    import('./peer-eval.js').then(({ hookIntoExecution }) =>
      hookIntoExecution(signal.agentId, `a2a-${msg.id ?? Date.now()}`, {
        taskType: signal.taskType,
        success: signal.success,
        metrics: {
          latency_ms: signal.latency_ms,
          quality_score: signal.score,
          cost_usd: signal.cost,
        },
        insights: [`A2A signal source: ${signal.source}`],
      })
    ),
    import('./fleet-pheromone-bridge.js').then(({ fleetPheromoneHook }) =>
      fleetPheromoneHook(signal.taskType, signal.agentId, signal.score, signal.latency_ms, signal.cost)
    ),
  ]).then(() => {
    logger.info(
      { agentId: signal.agentId, taskType: signal.taskType, score: signal.score, source: signal.source },
      'A2A learning signal recorded'
    )
  }).catch(err => {
    logger.warn({ err: String(err), agentId: signal.agentId }, 'A2A learning hook failed (non-critical)')
  })
}
