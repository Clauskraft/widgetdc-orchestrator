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

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChainStep {
  id?: string
  agent_id: string
  /** MCP tool to call (mutually exclusive with cognitive_action) */
  tool_name?: string
  /** Cognitive action: analyze | plan | reason | fold | learn */
  cognitive_action?: string
  /** Arguments or prompt — {{prev}} is replaced with previous step output */
  arguments?: Record<string, unknown>
  prompt?: string
  timeout_ms?: number
}

export interface ChainDefinition {
  chain_id?: string
  name: string
  description?: string
  mode: 'sequential' | 'parallel' | 'debate' | 'loop'
  steps: ChainStep[]
  /** For loops: max iterations before forced exit */
  max_iterations?: number
  /** For loops: stop if output contains this string */
  exit_condition?: string
  /** For debate: agent_id of the judge */
  judge_agent?: string
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
}

interface StepResult {
  step_id: string
  agent_id: string
  action: string
  status: 'success' | 'error' | 'timeout'
  output: unknown
  duration_ms: number
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
    let results: StepResult[]

    switch (def.mode) {
      case 'sequential':
        results = await runSequential(def.steps)
        break
      case 'parallel':
        results = await runParallel(def.steps)
        break
      case 'loop':
        results = await runLoop(def.steps, def.max_iterations ?? 5, def.exit_condition)
        break
      case 'debate':
        results = await runDebate(def.steps, def.judge_agent)
        break
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
