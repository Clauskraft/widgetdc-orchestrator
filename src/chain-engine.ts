/**
 * chain-engine.ts — Agent chain/swarm execution engine.
 *
 * Supports:
 *   - Sequential chains: A → B → C (output pipes to next)
 *   - Parallel fan-out: A,B,C run simultaneously, results merged
 *   - Loops: repeat chain until exit condition or max iterations
 *   - Debate: two agents argue, third synthesizes
 *   - Cognitive delegation: forward to RLM Engine for deep reasoning
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from './mcp-caller.js'
import { callCognitive } from './cognitive-proxy.js'
import { broadcastMessage } from './chat-broadcaster.js'
import { logger } from './logger.js'
import { getRedis } from './redis.js'
import { resolveRoutingDecision } from './routing-engine.js'
import type {
  AgentWorkflowEnvelope,
  RoutingCapability,
  RoutingDecision,
} from '@widgetdc/contracts/orchestrator'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChainStep {
  id?: string
  agent_id: string
  /** Orchestrator-only capability hint for auto-routing */
  capability?: RoutingCapability
  /** MCP tool to call (mutually exclusive with cognitive_action) */
  tool_name?: string
  /** Cognitive action: analyze | plan | reason | fold | learn */
  cognitive_action?: string
  /** Arguments or prompt — {{prev}} is replaced with previous step output */
  arguments?: Record<string, unknown>
  prompt?: string
  timeout_ms?: number
}

/** Funnel stage names matching the LIN-165 synthesis funnel model */
export const FUNNEL_STAGES = [
  'signal', 'pattern', 'block', 'assembly', 'arbitration', 'decision', 'artifact',
] as const
export type FunnelStage = typeof FUNNEL_STAGES[number]

export interface ChainDefinition {
  chain_id?: string
  name: string
  description?: string
  mode: 'sequential' | 'parallel' | 'debate' | 'loop' | 'adaptive' | 'funnel'
  steps: ChainStep[]
  /** For loops: max iterations before forced exit */
  max_iterations?: number
  /** For loops: stop if output contains this string */
  exit_condition?: string
  /** For debate: agent_id of the judge */
  judge_agent?: string
  /** For adaptive: the query to classify complexity for */
  query?: string
  /** For debate/GVU: minimum confidence threshold (0-1) */
  confidence_threshold?: number
  /** For funnel: which stage to start at (defaults to 'signal') */
  funnel_entry?: FunnelStage
  /** For funnel: pre-loaded context for entry stage */
  funnel_context?: Record<string, unknown>
}

export interface ChainExecution {
  execution_id: string
  chain_id: string
  name: string
  mode: string
  status: 'running' | 'completed' | 'failed'
  steps_completed: number
  steps_total: number
  results: StepResult[]
  started_at: string
  completed_at?: string
  duration_ms?: number
  final_output?: unknown
  error?: string
  routing_decisions?: RoutingDecision[]
  workflow_envelope?: AgentWorkflowEnvelope
}

interface StepResult {
  step_id: string
  agent_id: string
  action: string
  status: 'success' | 'error' | 'timeout'
  output: unknown
  duration_ms: number
  /** GVU verification score (0-1) — set by verifier in debate/adaptive */
  confidence?: number
  /** Whether this result was verified (GVU pattern) */
  verified?: boolean
}

// ─── Execution Store ────────────────────────────────────────────────────────

const executions = new Map<string, ChainExecution>()

function persistExecution(exec: ChainExecution): void {
  executions.set(exec.execution_id, exec)
  const redis = getRedis()
  if (redis) {
    redis.hset('orchestrator:chains', exec.execution_id, JSON.stringify(exec)).catch(() => {})
    redis.expire('orchestrator:chains', 86400).catch(() => {}) // 24h TTL
  }
}

export function getExecution(id: string): ChainExecution | undefined {
  return executions.get(id)
}

export function listExecutions(): ChainExecution[] {
  return Array.from(executions.values())
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, 50) // last 50
}

// ─── Step Executor ──────────────────────────────────────────────────────────

async function executeStep(step: ChainStep, previousOutput: unknown): Promise<StepResult> {
  const stepId = step.id ?? uuid().slice(0, 8)
  const t0 = Date.now()

  // Replace {{prev}} in arguments/prompt with previous step output
  const prevStr = typeof previousOutput === 'string'
    ? previousOutput
    : JSON.stringify(previousOutput ?? '')

  try {
    let output: unknown

    if (step.cognitive_action) {
      // Delegate to RLM Engine
      const prompt = step.prompt?.replace(/\{\{prev\}\}/g, prevStr) ?? prevStr
      output = await callCognitive(step.cognitive_action, {
        prompt,
        context: step.arguments,
        agent_id: step.agent_id,
      }, step.timeout_ms)
    } else if (step.tool_name) {
      // Call MCP tool via backend
      const args = { ...step.arguments }
      // Replace {{prev}} in string argument values
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === 'string') {
          args[k] = v.replace(/\{\{prev\}\}/g, prevStr)
        }
      }
      const result = await callMcpTool({
        toolName: step.tool_name,
        args,
        callId: uuid(),
        timeoutMs: step.timeout_ms ?? 30000,
      })
      if (result.status !== 'success') {
        throw new Error(result.error_message ?? `Tool ${step.tool_name} failed: ${result.status}`)
      }
      output = result.result
    } else {
      throw new Error('Step must have either tool_name or cognitive_action')
    }

    return {
      step_id: stepId,
      agent_id: step.agent_id,
      action: step.tool_name ?? `cognitive:${step.cognitive_action}`,
      status: 'success',
      output,
      duration_ms: Date.now() - t0,
    }
  } catch (err) {
    return {
      step_id: stepId,
      agent_id: step.agent_id,
      action: step.tool_name ?? `cognitive:${step.cognitive_action}`,
      status: 'error',
      output: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - t0,
    }
  }
}

// ─── Chain Runners ──────────────────────────────────────────────────────────

async function runSequential(steps: ChainStep[]): Promise<StepResult[]> {
  const results: StepResult[] = []
  let previousOutput: unknown = null

  for (const step of steps) {
    const result = await executeStep(step, previousOutput)
    results.push(result)
    if (result.status === 'error') break
    previousOutput = result.output
  }
  return results
}

async function runParallel(steps: ChainStep[]): Promise<StepResult[]> {
  return Promise.all(steps.map(step => executeStep(step, null)))
}

async function runLoop(
  steps: ChainStep[],
  maxIterations: number,
  exitCondition?: string,
): Promise<StepResult[]> {
  const allResults: StepResult[] = []
  let previousOutput: unknown = null

  for (let i = 0; i < maxIterations; i++) {
    const iterResults = await runSequential(
      steps.map(s => ({ ...s, id: `${s.id ?? s.agent_id}-iter${i}` }))
    )
    allResults.push(...iterResults)

    const lastResult = iterResults[iterResults.length - 1]
    if (lastResult?.status === 'error') break

    previousOutput = lastResult?.output
    const outputStr = JSON.stringify(previousOutput)

    // Check exit condition
    if (exitCondition && outputStr.includes(exitCondition)) {
      logger.info({ iteration: i, exitCondition }, 'Loop exit condition met')
      break
    }
  }
  return allResults
}

async function runDebate(
  steps: ChainStep[],
  judgeAgent?: string,
): Promise<StepResult[]> {
  // Run all debaters in parallel
  const debateResults = await runParallel(steps)

  if (!judgeAgent) return debateResults

  // Judge synthesizes
  const positions = debateResults.map(r => ({
    agent: r.agent_id,
    position: r.output,
  }))
  const judgeResult = await executeStep({
    agent_id: judgeAgent,
    cognitive_action: 'analyze',
    prompt: `You are the judge. Evaluate these positions and synthesize the best answer:\n\n${JSON.stringify(positions, null, 2)}`,
  }, positions)

  return [...debateResults, judgeResult]
}

// ─── Adaptive Graph of Thoughts (AGoT) ──────────────────────────────────────

async function classifyComplexity(query: string): Promise<'simple' | 'medium' | 'complex'> {
  try {
    const result = await callCognitive('reason', {
      prompt: `Classify this query's complexity for a multi-agent system. Reply with ONLY one word: simple, medium, or complex.

Query: "${query}"

Rules:
- simple: direct lookup, single-hop, factual (→ sequential chain)
- medium: multi-step, requires 2-3 sources, some reasoning (→ parallel chain)
- complex: multi-hop reasoning, debate-worthy, ambiguous, strategic (→ debate+parallel)`,
      context: {},
      agent_id: 'orchestrator',
    }, 15000)
    const text = String(result ?? '').toLowerCase().trim()
    if (text.includes('complex')) return 'complex'
    if (text.includes('medium')) return 'medium'
    return 'simple'
  } catch {
    return 'medium' // default
  }
}

async function runAdaptive(
  steps: ChainStep[],
  query?: string,
  judgeAgent?: string,
  confidenceThreshold = 0.6,
): Promise<{ results: StepResult[]; chosen_topology: string }> {
  const complexity = query ? await classifyComplexity(query) : 'medium'
  logger.info({ complexity, query: query?.slice(0, 80) }, 'AGoT: classified complexity')

  let results: StepResult[]
  let topology: string

  switch (complexity) {
    case 'simple':
      topology = 'sequential'
      results = await runSequential(steps)
      break
    case 'medium':
      topology = 'parallel'
      results = await runParallel(steps)
      break
    case 'complex':
      topology = 'debate+verify'
      results = await runDebateGVU(steps, judgeAgent, confidenceThreshold)
      break
    default:
      topology = 'sequential'
      results = await runSequential(steps)
  }

  // Tag all results with topology
  results.forEach(r => { (r as any).topology = topology })
  return { results, chosen_topology: topology }
}

// ─── Funnel Pipeline (LIN-533) ─────────────────────────────────────────────
// 7-stage synthesis funnel: Signal → Pattern → Block → Assembly → Arbitration → Decision → Artifact
// Each stage persists intermediate state in Redis for resume capability.

interface FunnelState {
  execution_id: string
  current_stage: FunnelStage
  stage_outputs: Partial<Record<FunnelStage, unknown>>
  started_at: string
  last_updated: string
}

const FUNNEL_REDIS_PREFIX = 'orchestrator:funnel:'

async function persistFunnelState(state: FunnelState): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.set(
    `${FUNNEL_REDIS_PREFIX}${state.execution_id}`,
    JSON.stringify(state),
    'EX', 86400 * 7, // 7 day TTL
  ).catch(() => {})
}

async function loadFunnelState(executionId: string): Promise<FunnelState | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${FUNNEL_REDIS_PREFIX}${executionId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Map funnel stages to their step in the chain.
 * If fewer steps than 7 are provided, stages without a step are skipped.
 * Steps are mapped by index to FUNNEL_STAGES order.
 */
async function runFunnel(
  steps: ChainStep[],
  entryStage: FunnelStage = 'signal',
  preloadedContext?: Record<string, unknown>,
  executionId?: string,
): Promise<{ results: StepResult[]; funnel_state: FunnelState }> {
  const execId = executionId ?? uuid()
  const entryIndex = FUNNEL_STAGES.indexOf(entryStage)

  // Try to resume from existing state
  let state = await loadFunnelState(execId)
  if (!state) {
    state = {
      execution_id: execId,
      current_stage: entryStage,
      stage_outputs: {},
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    }
    // Inject preloaded context as previous stage output
    if (preloadedContext && entryIndex > 0) {
      const prevStage = FUNNEL_STAGES[entryIndex - 1]
      state.stage_outputs[prevStage] = preloadedContext
    }
  }

  const results: StepResult[] = []

  for (let i = entryIndex; i < FUNNEL_STAGES.length; i++) {
    const stage = FUNNEL_STAGES[i]
    const step = steps[i]

    // Skip stages without a defined step
    if (!step) {
      logger.info({ stage, index: i }, 'Funnel: no step defined for stage, skipping')
      continue
    }

    // Get output from previous stage as input
    const prevStage = i > 0 ? FUNNEL_STAGES[i - 1] : null
    const previousOutput = prevStage ? state.stage_outputs[prevStage] : (preloadedContext ?? null)

    state.current_stage = stage
    state.last_updated = new Date().toISOString()
    await persistFunnelState(state)

    logger.info({ stage, step_index: i, execution_id: execId }, 'Funnel: executing stage')

    // Tag step with funnel stage ID
    const taggedStep = { ...step, id: step.id ?? `funnel-${stage}` }
    const result = await executeStep(taggedStep, previousOutput)

    // Annotate result with stage info
    ;(result as any).funnel_stage = stage
    ;(result as any).stage_index = i
    results.push(result)

    // Persist stage output
    state.stage_outputs[stage] = result.output
    state.last_updated = new Date().toISOString()
    await persistFunnelState(state)

    // Stop on error — state is saved for resume
    if (result.status === 'error') {
      logger.warn({ stage, error: result.output }, 'Funnel: stage failed, state saved for resume')
      break
    }
  }

  return { results, funnel_state: state }
}

// ─── GVU (Generator-Verifier-Updater) Debate ────────────────────────────────

async function runDebateGVU(
  steps: ChainStep[],
  judgeAgent?: string,
  confidenceThreshold = 0.6,
): Promise<StepResult[]> {
  // Phase 1: GENERATE — all debaters run in parallel
  const debateResults = await runParallel(steps)

  if (!judgeAgent) return debateResults

  // Phase 2: VERIFY — judge scores each position
  const positions = debateResults.map(r => ({
    agent: r.agent_id,
    position: typeof r.output === 'string' ? r.output.slice(0, 500) : JSON.stringify(r.output).slice(0, 500),
    status: r.status,
  }))

  const verifyResult = await executeStep({
    agent_id: judgeAgent,
    cognitive_action: 'analyze',
    prompt: `You are the VERIFIER in a GVU (Generator-Verifier-Updater) loop.

Score each position on a 0-1 confidence scale and synthesize the best answer.
Only accept positions with confidence >= ${confidenceThreshold}.

Positions:
${JSON.stringify(positions, null, 2)}

Reply as JSON: {"synthesis": "best answer", "scores": [{"agent": "id", "confidence": 0.0-1.0, "accepted": true/false}], "overall_confidence": 0.0-1.0}`,
  }, positions)

  // Parse verification scores
  let verification: any = {}
  try {
    const raw = String(verifyResult.output ?? '')
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) verification = JSON.parse(match[0])
  } catch {
    verification = { synthesis: verifyResult.output, overall_confidence: 0.5, scores: [] }
  }

  // Phase 3: UPDATE — mark results with verification
  for (const r of debateResults) {
    const score = verification.scores?.find((s: any) => s.agent === r.agent_id)
    r.confidence = score?.confidence ?? 0.5
    r.verified = score?.accepted ?? (r.confidence >= confidenceThreshold)
  }

  // Add verifier result
  verifyResult.confidence = verification.overall_confidence ?? 0.5
  verifyResult.verified = true
  verifyResult.output = verification.synthesis ?? verifyResult.output

  return [...debateResults, verifyResult]
}

async function resolveAutoSteps(def: ChainDefinition): Promise<{
  steps: ChainStep[]
  routingDecisions: RoutingDecision[]
  workflowEnvelope?: AgentWorkflowEnvelope
}> {
  const routingDecisions: RoutingDecision[] = []
  let workflowEnvelope: AgentWorkflowEnvelope | undefined

  const resolvedSteps = def.steps.map((step, index) => {
    if (step.agent_id !== 'auto') return step

    const resolution = resolveRoutingDecision({
      message: step.prompt ?? def.query ?? def.name,
      capabilityHint: step.capability,
      routeScope: ['widgetdc-orchestrator', 'widgetdc-librechat'],
      operatorVisible: true,
      recentExecutions: listExecutions(),
      workflowId: def.chain_id ?? `adaptive-${index}-${Date.now().toString(36)}`,
    })

    routingDecisions.push(resolution.decision)
    workflowEnvelope = workflowEnvelope ?? resolution.workflowEnvelope

    return {
      ...step,
      agent_id: resolution.selectedAgentId,
    }
  })

  return { steps: resolvedSteps, routingDecisions, workflowEnvelope }
}

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function executeChain(def: ChainDefinition): Promise<ChainExecution> {
  const executionId = uuid()
  const chainId = def.chain_id ?? uuid().slice(0, 12)
  const t0 = Date.now()

  const execution: ChainExecution = {
    execution_id: executionId,
    chain_id: chainId,
    name: def.name,
    mode: def.mode,
    status: 'running',
    steps_completed: 0,
    steps_total: def.steps.length,
    results: [],
    started_at: new Date().toISOString(),
  }
  persistExecution(execution)

  logger.info({ execution_id: executionId, chain: def.name, mode: def.mode, steps: def.steps.length }, 'Chain execution started')

  // Broadcast chain start
  broadcastMessage({
    from: 'Orchestrator',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `Chain "${def.name}" started (${def.mode}, ${def.steps.length} steps)`,
    timestamp: new Date().toISOString(),
  })

  try {
    const { steps: resolvedSteps, routingDecisions, workflowEnvelope } =
      def.mode === 'adaptive' || def.steps.some(step => step.agent_id === 'auto')
        ? await resolveAutoSteps(def)
        : { steps: def.steps, routingDecisions: [], workflowEnvelope: undefined }

    execution.routing_decisions = routingDecisions
    execution.workflow_envelope = workflowEnvelope

    let results: StepResult[]

    switch (def.mode) {
      case 'sequential':
        results = await runSequential(resolvedSteps)
        break
      case 'parallel':
        results = await runParallel(resolvedSteps)
        break
      case 'loop':
        results = await runLoop(resolvedSteps, def.max_iterations ?? 5, def.exit_condition)
        break
      case 'debate':
        results = await runDebateGVU(resolvedSteps, def.judge_agent, def.confidence_threshold)
        break
      case 'adaptive': {
        const adaptive = await runAdaptive(resolvedSteps, def.query, def.judge_agent, def.confidence_threshold)
        results = adaptive.results
        ;(execution as any).chosen_topology = adaptive.chosen_topology
        break
      }
      case 'funnel': {
        const funnelResult = await runFunnel(
          resolvedSteps,
          def.funnel_entry,
          def.funnel_context,
          executionId,
        )
        results = funnelResult.results
        ;(execution as any).funnel_state = funnelResult.funnel_state
        break
      }
      default:
        throw new Error(`Unknown chain mode: ${def.mode}`)
    }

    const failed = results.some(r => r.status === 'error')
    execution.results = results
    execution.steps_completed = results.filter(r => r.status === 'success').length
    execution.status = failed ? 'failed' : 'completed'
    execution.final_output = results[results.length - 1]?.output
    execution.duration_ms = Date.now() - t0
    execution.completed_at = new Date().toISOString()
  } catch (err) {
    execution.status = 'failed'
    execution.error = err instanceof Error ? err.message : String(err)
    execution.duration_ms = Date.now() - t0
    execution.completed_at = new Date().toISOString()
  }

  persistExecution(execution)

  logger.info({
    execution_id: executionId,
    status: execution.status,
    steps: execution.steps_completed,
    ms: execution.duration_ms,
  }, 'Chain execution complete')

  // Broadcast completion
  broadcastMessage({
    from: 'Orchestrator',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `Chain "${def.name}" ${execution.status} (${execution.steps_completed}/${execution.steps_total} steps, ${execution.duration_ms}ms)`,
    timestamp: new Date().toISOString(),
  })

  return execution
}
