/**
 * state-machine.ts — LangGraph-inspired FSM with Redis checkpointing.
 *
 * Pattern sources:
 *   - LangGraph: Checkpointed state graph with conditional edges
 *   - GSD-2: agent-loop.ts accumulating messages + transformContext
 *   - AutoGen: Composable termination conditions
 *
 * States: research → plan → execute → verify → complete
 * Persistence: Redis checkpoints per transition
 * Recovery: Read last checkpoint, resume from there
 */
import { logger } from './logger.js'
import { getRedis } from './redis.js'
import { executeChain, type ChainDefinition } from './chain-engine.js'
import { fsmSaver } from './checkpoint-saver.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type FSMPhase = 'idle' | 'research' | 'plan' | 'execute' | 'verify' | 'complete' | 'failed'

export interface FSMState {
  plan_id: string
  name: string
  current_phase: FSMPhase
  iteration: number
  max_iterations: number
  /** Accumulated context from previous phases */
  context: Record<string, unknown>
  /** Checkpoint history */
  history: Array<{
    phase: FSMPhase
    timestamp: string
    result_summary: string
  }>
  /** Budget tracking (AutoGen pattern) */
  budget: {
    max_cost_usd: number
    spent_usd: number
    max_tool_calls: number
    tool_calls_used: number
  }
  created_at: string
  updated_at: string
}

export interface FSMTransition {
  from: FSMPhase
  to: FSMPhase
  condition?: (state: FSMState) => boolean
}

export interface FSMPlanConfig {
  plan_id: string
  name: string
  /** Chain to run in each phase */
  phases: Partial<Record<FSMPhase, ChainDefinition>>
  max_iterations?: number
  max_cost_usd?: number
  max_tool_calls?: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

const REDIS_FSM_PREFIX = 'orchestrator:fsm:'
const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_COST = 5.0
const DEFAULT_MAX_TOOL_CALLS = 200

/** Valid transitions */
const TRANSITIONS: FSMTransition[] = [
  { from: 'idle', to: 'research' },
  { from: 'research', to: 'plan' },
  { from: 'plan', to: 'execute' },
  { from: 'execute', to: 'verify' },
  { from: 'verify', to: 'complete', condition: (s) => s.context.verify_passed === true },
  { from: 'verify', to: 'execute', condition: (s) => s.context.verify_passed === false && s.iteration < s.max_iterations },
  { from: 'verify', to: 'failed', condition: (s) => s.context.verify_passed === false && s.iteration >= s.max_iterations },
  // Skip phases
  { from: 'idle', to: 'execute' },
  { from: 'research', to: 'execute' },
]

// ─── FSM Engine ─────────────────────────────────────────────────────────────

/**
 * Create a new FSM plan.
 */
export async function createPlan(config: FSMPlanConfig): Promise<FSMState> {
  const state: FSMState = {
    plan_id: config.plan_id,
    name: config.name,
    current_phase: 'idle',
    iteration: 0,
    max_iterations: config.max_iterations ?? DEFAULT_MAX_ITERATIONS,
    context: {},
    history: [],
    budget: {
      max_cost_usd: config.max_cost_usd ?? DEFAULT_MAX_COST,
      spent_usd: 0,
      max_tool_calls: config.max_tool_calls ?? DEFAULT_MAX_TOOL_CALLS,
      tool_calls_used: 0,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  await checkpoint(state)
  logger.info({ plan_id: state.plan_id, name: state.name }, 'FSM plan created')
  return state
}

/**
 * Advance the FSM to the next phase and execute the chain.
 */
export async function advance(
  planId: string,
  phases: Partial<Record<FSMPhase, ChainDefinition>>,
): Promise<FSMState> {
  let state = await loadCheckpoint(planId)
  if (!state) throw new Error(`FSM plan not found: ${planId}`)

  // Determine next phase
  const nextPhase = getNextPhase(state)
  if (!nextPhase) {
    logger.info({ plan_id: planId, phase: state.current_phase }, 'FSM: no valid transition, plan complete or failed')
    return state
  }

  // Budget check (AutoGen TokenUsageTermination pattern)
  if (state.budget.tool_calls_used >= state.budget.max_tool_calls) {
    logger.warn({ plan_id: planId }, 'FSM: budget exhausted (tool calls)')
    state.current_phase = 'failed'
    state.context.failure_reason = 'budget_exhausted'
    await checkpoint(state)
    return state
  }

  // Transition
  const previousPhase = state.current_phase
  state.current_phase = nextPhase
  state.iteration++
  state.updated_at = new Date().toISOString()

  logger.info({ plan_id: planId, from: previousPhase, to: nextPhase, iteration: state.iteration }, 'FSM transition')

  // Execute phase chain if defined
  const chain = phases[nextPhase]
  if (chain) {
    try {
      const result = await executeChain(chain)
      state.context[`${nextPhase}_result`] = result.results
      state.context[`${nextPhase}_status`] = result.status
      state.budget.tool_calls_used += result.results?.length ?? 0

      // For verify phase: check if verification passed
      if (nextPhase === 'verify') {
        state.context.verify_passed = result.status === 'completed'
      }

      state.history.push({
        phase: nextPhase,
        timestamp: new Date().toISOString(),
        result_summary: `${result.status}: ${result.results?.length ?? 0} steps`,
      })
    } catch (err) {
      logger.error({ plan_id: planId, phase: nextPhase, err: String(err) }, 'FSM phase execution failed')
      state.history.push({
        phase: nextPhase,
        timestamp: new Date().toISOString(),
        result_summary: `error: ${String(err).substring(0, 200)}`,
      })
    }
  }

  await checkpoint(state)
  return state
}

/**
 * Run the full FSM loop until completion or failure.
 */
export async function runToCompletion(
  config: FSMPlanConfig,
): Promise<FSMState> {
  let state = await loadCheckpoint(config.plan_id) ?? await createPlan(config)

  while (state.current_phase !== 'complete' && state.current_phase !== 'failed') {
    const before = state.current_phase
    state = await advance(config.plan_id, config.phases ?? {})
    // Prevent infinite loop if no transition happened
    if (state.current_phase === before && state.current_phase !== 'complete') {
      logger.warn({ plan_id: config.plan_id }, 'FSM: stuck, no transition')
      break
    }
  }

  logger.info({ plan_id: config.plan_id, final_phase: state.current_phase, iterations: state.iteration }, 'FSM run complete')
  return state
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextPhase(state: FSMState): FSMPhase | null {
  const valid = TRANSITIONS.filter(t => t.from === state.current_phase)
  for (const t of valid) {
    if (!t.condition || t.condition(state)) return t.to
  }
  return null
}

async function checkpoint(state: FSMState): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(`${REDIS_FSM_PREFIX}${state.plan_id}`, JSON.stringify(state), 'EX', 86400 * 7)
  } catch (err) {
    logger.warn({ plan_id: state.plan_id, err: String(err) }, 'FSM checkpoint failed')
  }
}

async function loadCheckpoint(planId: string): Promise<FSMState | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${REDIS_FSM_PREFIX}${planId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** List all active FSM plans */
export async function listPlans(): Promise<FSMState[]> {
  const redis = getRedis()
  if (!redis) return []
  try {
    const keys = await redis.keys(`${REDIS_FSM_PREFIX}*`)
    const plans: FSMState[] = []
    for (const key of keys) {
      const raw = await redis.get(key)
      if (raw) plans.push(JSON.parse(raw))
    }
    return plans.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  } catch {
    return []
  }
}
