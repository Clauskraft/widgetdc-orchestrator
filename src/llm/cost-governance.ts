/**
 * cost-governance.ts — Phase 3 Cost Governance (FR-6, FR-9)
 *
 * Governs:
 *   - Budget lane classification (micro / standard / deep)
 *   - Claude/premium escalation policy
 *   - Max recursion depth enforcement
 *   - Max agent fan-out enforcement
 *   - Workflow cost trace telemetry
 *   - Context compaction enforcement
 *   - Model cost estimation
 *   - Model policy compliance checks
 *
 * Non-negotiable rules:
 *   - Cheapest adequate path is default
 *   - Claude is escalation-only, never default
 *   - All new functions have TypeScript types
 */

import { LlmMatrix, type ModelConfig, type ProviderId } from '@widgetdc/contracts/llm'
import { callCognitive, isRlmAvailable, callCognitiveRaw } from '../cognitive-proxy.js'
import { callMcpTool } from '../mcp-caller.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Budget lane token thresholds (FR-9) */
export const BUDGET_LANE_MICRO_MAX = 4000      // < 4K tokens
export const BUDGET_LANE_STANDARD_MAX = 16000  // 4K-16K tokens
// > 16K tokens = deep

/** Maximum chain recursion depth — prevents infinite/ runaway chains */
export const MAX_RECURSION_DEPTH = 3

/** Maximum agent fan-out for parallel chains */
export const MAX_AGENT_FANOUT_PARALLEL = 5

/** Maximum agent fan-out for debate mode */
export const MAX_AGENT_FANOUT_DEBATE = 3

/** Context size threshold that triggers automatic compaction */
export const CONTEXT_COMPACTION_THRESHOLD = 8000 // tokens (approx 32K chars at ~4 chars/token)

/** Redis TTL for cost traces: 24 hours */
const COST_TRACE_TTL_SECONDS = 86400

/** Redis key prefix for cost traces */
const COST_TRACE_PREFIX = 'orchestrator:cost-trace:'

/** Redis key prefix for premium escalation tracking */
const ESCALATION_PREFIX = 'orchestrator:escalation:'

/** Daily budget cap in DKK (can be overridden via env) */
const DAILY_BUDGET_CAP_DKK = parseFloat(process.env.DAILY_BUDGET_CAP_DKK ?? '100')

// ─── Types ────────────────────────────────────────────────────────────────────

export type BudgetLane = 'micro' | 'standard' | 'deep'

export interface BudgetLaneResult {
  lane: BudgetLane
  estimatedTokens: number
  recommendedMaxCostDKK: number
}

export interface ClaudeEscalationResult {
  allowed: boolean
  reason: string
  priorFailures: number
  requiresPremiumFlag: boolean
}

export interface WorkflowCostTrace {
  workflowId: string
  totalCostDKK: number
  totalTokens: number
  modelCalls: ModelCallRecord[]
  startedAt: string
  lastUpdatedAt: string
}

export interface ModelCallRecord {
  provider: string
  model: string
  tokensIn: number
  tokensOut: number
  costDKK: number
  timestamp: string
}

export interface CostEstimateResult {
  provider: string
  model: string
  estimatedTokens: number
  costPer1KInputDKK: number
  costPer1KOutputDKK: number
  totalCostDKK: number
  currency: 'DKK'
}

export interface PolicyCheckResult {
  pass: boolean
  reason: string
  provider: string
  model: string
  isEscalation: boolean
  budgetRemaining: boolean
}

// ─── Budget Lane Classification (FR-9) ────────────────────────────────────────

/**
 * Classify a task into a budget lane based on estimated token count.
 * - micro: < 4K tokens — simple routing, formatting, lookups
 * - standard: 4K-16K tokens — analysis, reasoning
 * - deep: > 16K tokens — deep investigation, complex synthesis
 *
 * When RLM is available, delegates to /cognitive/analyze for intelligent
 * task complexity classification using routing.cost and routing.domain.
 * Falls back to token-count heuristics when RLM is unavailable.
 */
export async function getBudgetLane(
  task: string,
  estimatedTokens?: number,
): Promise<BudgetLaneResult> {
  let lane: BudgetLane

  // Primary: RLM-based classification
  if (isRlmAvailable()) {
    try {
      // Enrich with SRAG cost knowledge if available
      const costKnowledge = await queryCostKnowledge(task)

      const raw = await callCognitiveRaw('analyze', {
        prompt: `Classify the cost budget lane for this task: ${task}${costKnowledge ? `\n\nRelevant cost knowledge from prior engagements: ${costKnowledge}` : ''}`,
        context: {
          task,
          estimatedTokens: estimatedTokens ?? 0,
          cost_knowledge: costKnowledge ?? null,
          classification_dimensions: ['cost_complexity', 'reasoning_depth', 'token_budget'],
        },
        agent_id: 'cost-governance',
      }, 15000)

      if (raw?.routing?.cost) {
        // RLM returned a cost estimate — use it
        const rlmCost = raw.routing.cost as number
        if (rlmCost < 0.10) lane = 'micro'
        else if (rlmCost < 1.0) lane = 'standard'
        else lane = 'deep'
      } else if (raw?.routing?.domain) {
        // RLM returned a domain hint — classify by domain complexity
        const domain = String(raw.routing.domain).toLowerCase()
        if (domain.includes('simple') || domain.includes('lookup') || domain.includes('format')) lane = 'micro'
        else if (domain.includes('deep') || domain.includes('complex') || domain.includes('strategic')) lane = 'deep'
        else lane = 'standard'
      } else if (typeof raw?.analysis?.budget_lane === 'string') {
        lane = raw.analysis.budget_lane as BudgetLane
      } else if (typeof raw?.result === 'string') {
        // Parse text result for lane keywords
        const text = raw.result.toLowerCase()
        if (/\b(micro|simple|trivial|lookup)\b/.test(text)) lane = 'micro'
        else if (/\b(deep|complex|investigation|strategic)\b/.test(text)) lane = 'deep'
        else lane = 'standard'
      } else {
        // RLM returned but no useful classification — fall back to token count
        lane = classifyByTokenCount(estimatedTokens ?? 0)
      }

      logger.info({ task: task.slice(0, 80), lane, rlmRouting: raw?.routing }, 'Budget lane classified (RLM)')
    } catch (err) {
      logger.warn({ error: String(err) }, 'RLM budget classification failed — falling back to heuristics')
      lane = classifyByTokenCount(estimatedTokens ?? 0)
    }
  } else {
    // RLM not available — use token count or keyword heuristics
    lane = estimatedTokens
      ? classifyByTokenCount(estimatedTokens)
      : inferBudgetLaneFromTask(task)
  }

  const tokens = estimatedTokens ?? 0
  const recommendedMaxCostDKK = lane === 'micro' ? 0.10 : lane === 'standard' ? 1.00 : 5.00

  return { lane, estimatedTokens: tokens, recommendedMaxCostDKK }
}

/** Token-count based lane classification — extracted as a helper for fallback use. */
function classifyByTokenCount(tokens: number): BudgetLane {
  if (tokens < BUDGET_LANE_MICRO_MAX) return 'micro'
  if (tokens <= BUDGET_LANE_STANDARD_MAX) return 'standard'
  return 'deep'
}

/**
 * Query SRAG for existing cost knowledge about similar tasks.
 * Returns findings that can inform budget lane decisions.
 */
async function queryCostKnowledge(task: string): Promise<string | null> {
  try {
    const result = await callMcpTool({
      toolName: 'srag.query',
      args: { query: `workflow cost estimates for task: ${task}`, max_results: 3 },
      callId: `cost-srag-${Date.now()}`,
      timeoutMs: 10000,
    })
    if (result.status === 'success' && result.result) {
      return typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result).slice(0, 2000)
    }
  } catch (err) {
    logger.debug({ error: String(err) }, 'SRAG cost knowledge query failed')
  }
  return null
}

/**
 * Infer a budget lane from the task description when no token estimate is available.
 * Uses keyword heuristics as a fallback when RLM is unavailable.
 */
export function inferBudgetLaneFromTask(task: string): BudgetLane {
  const lower = task.toLowerCase()

  // Deep signals
  if (/\b(investigate|deep|complex|synthesize|comprehensive|multi-hop|strategic|architecture)\b/.test(lower)) {
    return 'deep'
  }

  // Standard signals
  if (/\b(analyze|reason|explain|compare|evaluate|review|summary|report)\b/.test(lower)) {
    return 'standard'
  }

  // Micro signals
  if (/\b(format|list|count|lookup|route|classify|status|health|ping)\b/.test(lower)) {
    return 'micro'
  }

  // Default: standard
  return 'standard'
}

// ─── Claude Escalation Policy (FR-6) ─────────────────────────────────────────

/**
 * Check if Claude/premium model escalation is allowed.
 *
 * When RLM is available, delegates to /cognitive/analyze for structured
 * reasoning about whether premium escalation is truly justified, considering
 * task complexity, prior failures, and cost context.
 *
 * Falls back to the deterministic 3-condition check when RLM is unavailable.
 *
 * Rules (fallback):
 *   - Default: false for all providers
 *   - Only allow when ALL conditions met:
 *     (a) task requires premium reasoning (deep lane or explicit premium need)
 *     (b) at least 2 cheaper model attempts failed
 *     (c) explicit premium_allowed flag in plan
 */
export async function isClaudeEscalationAllowed(
  provider: string,
  task: string,
  opts?: {
    priorFailures?: number
    premiumAllowed?: boolean
    estimatedTokens?: number
  },
): Promise<ClaudeEscalationResult> {
  const providerLower = provider.toLowerCase()
  const isPremiumProvider = providerLower.includes('claude') || providerLower.includes('anthropic') || providerLower.includes('opus')

  if (!isPremiumProvider) {
    return {
      allowed: true,
      reason: 'Non-premium provider — no escalation check needed',
      priorFailures: opts?.priorFailures ?? 0,
      requiresPremiumFlag: false,
    }
  }

  // Primary: RLM-based escalation analysis
  if (isRlmAvailable()) {
    try {
      const priorFailures = opts?.priorFailures ?? await getPriorFailures(provider, task)
      const lane = opts?.estimatedTokens
        ? (await getBudgetLane(task, opts.estimatedTokens)).lane
        : inferBudgetLaneFromTask(task)

      const raw = await callCognitiveRaw('analyze', {
        prompt: `Evaluate whether premium model (Claude) escalation is justified for this task: ${task}. Budget lane: ${lane}. Prior failures: ${priorFailures}. Premium explicitly allowed: ${opts?.premiumAllowed ?? false}.`,
        context: {
          provider,
          task,
          budget_lane: lane,
          prior_failures: priorFailures,
          premium_explicitly_allowed: opts?.premiumAllowed ?? false,
          analysis_dimensions: ['cost_efficiency', 'necessity', 'alternative_availability'],
        },
        agent_id: 'cost-governance',
      }, 15000)

      if (raw) {
        // Check for structured analysis result
        const analysis = raw.analysis ?? raw.result
        const analysisStr = typeof analysis === 'string' ? analysis : JSON.stringify(analysis)
        const analysisLower = analysisStr.toLowerCase()

        // Look for explicit approval or rejection signals
        const approved = /\b(approved|justified|allowed|recommended)\b/.test(analysisLower) && !/\b(not\s+(approved|justified)|reject|denied|not\s+recommended|cheaper\s+first)\b/.test(analysisLower)
        const rejected = /\b(not\s+(approved|justified)|reject|denied|not\s+recommended|cheaper\s+first|retry\s+(with|using))\b/.test(analysisLower)

        if (rejected) {
          return {
            allowed: false,
            reason: `RLM analysis rejected escalation: ${analysisStr.slice(0, 300)}`,
            priorFailures,
            requiresPremiumFlag: !opts?.premiumAllowed,
          }
        }

        if (approved) {
          return {
            allowed: true,
            reason: `RLM analysis approved escalation: ${analysisStr.slice(0, 300)}`,
            priorFailures,
            requiresPremiumFlag: false,
          }
        }

        // Ambiguous RLM response — fall through to deterministic check
        logger.warn({ provider, task: task.slice(0, 80) }, 'RLM escalation analysis ambiguous — falling back to deterministic check')
      }
    } catch (err) {
      logger.warn({ error: String(err) }, 'RLM escalation analysis failed — falling back to deterministic check')
    }
  }

  // Fallback: deterministic 3-condition check
  const priorFailures = opts?.priorFailures ?? await getPriorFailures(provider, task)

  // Condition (a): task requires premium reasoning
  const lane = opts?.estimatedTokens
    ? (await getBudgetLane(task, opts.estimatedTokens)).lane
    : inferBudgetLaneFromTask(task)
  const requiresPremiumReasoning = lane === 'deep'

  // Condition (b): at least 2 cheaper model attempts failed
  const hasSufficientFailures = priorFailures >= 2

  // Condition (c): explicit premium_allowed flag
  const premiumAllowed = opts?.premiumAllowed ?? false

  if (!requiresPremiumReasoning) {
    return {
      allowed: false,
      reason: `Task does not require premium reasoning (budget lane: ${lane}). Use cheaper models first.`,
      priorFailures,
      requiresPremiumFlag: false,
    }
  }

  if (!hasSufficientFailures) {
    return {
      allowed: false,
      reason: `Insufficient cheaper model failures (${priorFailures}/2 required). Retry with deepseek/qwen/gemini first.`,
      priorFailures,
      requiresPremiumFlag: false,
    }
  }

  if (!premiumAllowed) {
    return {
      allowed: false,
      reason: 'Premium model not explicitly allowed in execution plan. Set premium_allowed=true.',
      priorFailures,
      requiresPremiumFlag: true,
    }
  }

  return {
    allowed: true,
    reason: `Escalation justified: deep lane task, ${priorFailures} cheaper model failures, premium explicitly allowed.`,
    priorFailures,
    requiresPremiumFlag: false,
  }
}

/** Record a failed cheaper model attempt for escalation tracking */
export async function recordPriorFailure(provider: string, task: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const key = `${ESCALATION_PREFIX}${provider}:${hashTask(task)}`
  try {
    const current = parseInt(await redis.get(key) ?? '0', 10)
    await redis.incr(key)
    await redis.expire(key, 3600) // 1h TTL for failure tracking
    logger.warn({ provider, failures: current + 1 }, 'Prior failure recorded for escalation tracking')
  } catch {
    // Non-critical — escalation tracking should never block execution
  }
}

/** Get the number of prior failures for a provider/task combo */
async function getPriorFailures(provider: string, task: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0

  const key = `${ESCALATION_PREFIX}${provider}:${hashTask(task)}`
  try {
    const val = await redis.get(key)
    return val ? parseInt(val, 10) : 0
  } catch {
    return 0
  }
}

/** Simple hash for task string — used in Redis keys */
function hashTask(task: string): string {
  let hash = 0
  const str = task.slice(0, 100)
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

// ─── Recursion Depth Enforcement (FR-6) ──────────────────────────────────────

/**
 * Validate that a chain execution does not exceed max recursion depth.
 * Callers should track depth and pass it here before starting a nested chain.
 */
export function enforceMaxRecursionDepth(currentDepth: number): { allowed: boolean; error?: string } {
  if (currentDepth >= MAX_RECURSION_DEPTH) {
    return {
      allowed: false,
      error: `Max recursion depth exceeded (${currentDepth}/${MAX_RECURSION_DEPTH}). Chain nesting must not exceed ${MAX_RECURSION_DEPTH} levels. Refactor to flatten chain structure.`,
    }
  }
  return { allowed: true }
}

// ─── Agent Fan-Out Enforcement (FR-6) ─────────────────────────────────────────

export interface FanOutCheckResult {
  allowed: boolean
  error?: string
  maxAllowed: number
  requested: number
}

/**
 * Check if a fan-out execution is within limits.
 * - Parallel chains: max 5 agents
 * - Debate mode: max 3 agents
 */
export function enforceMaxFanOut(
  parallelSteps: number,
  mode: 'parallel' | 'debate' | 'sequential' | 'loop' | 'adaptive' | 'funnel' = 'parallel',
  agentIds?: string[],
): FanOutCheckResult {
  const maxAllowed = mode === 'debate' ? MAX_AGENT_FANOUT_DEBATE : MAX_AGENT_FANOUT_PARALLEL

  if (parallelSteps > maxAllowed) {
    return {
      allowed: false,
      error: `Agent fan-out exceeded: requested ${parallelSteps}, max ${maxAllowed} for ${mode} mode. Reduce parallel steps or increase MAX_AGENT_FANOUT_PARALLEL/MAX_AGENT_FANOUT_DEBATE constant.`,
      maxAllowed,
      requested: parallelSteps,
    }
  }

  // Additional check: premium model calls within parallel fan-out
  if (agentIds && agentIds.length > maxAllowed) {
    return {
      allowed: false,
      error: `Agent list exceeds max fan-out: ${agentIds.length} > ${maxAllowed}`,
      maxAllowed,
      requested: agentIds.length,
    }
  }

  return { allowed: true, maxAllowed, requested: parallelSteps }
}

// ─── Cost Trace Telemetry (FR-6) ──────────────────────────────────────────────

/**
 * Record a model call's cost for a workflow. Stored in Redis with 24h TTL.
 * Integrates with updateCostProfile in flywheel/adoption-telemetry.
 */
export async function recordWorkflowCost(
  workflowId: string,
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  costDKK: number,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const key = `${COST_TRACE_PREFIX}${workflowId}`
  const callRecord: ModelCallRecord = {
    provider,
    model,
    tokensIn,
    tokensOut,
    costDKK,
    timestamp: new Date().toISOString(),
  }

  try {
    // Check if trace exists
    const existing = await redis.get(key)
    let trace: WorkflowCostTrace

    if (existing) {
      trace = JSON.parse(existing) as WorkflowCostTrace
      trace.totalCostDKK += costDKK
      trace.totalTokens += tokensIn + tokensOut
      trace.modelCalls.push(callRecord)
      trace.lastUpdatedAt = new Date().toISOString()
    } else {
      trace = {
        workflowId,
        totalCostDKK: costDKK,
        totalTokens: tokensIn + tokensOut,
        modelCalls: [callRecord],
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      }
    }

    await redis.set(key, JSON.stringify(trace), 'EX', COST_TRACE_TTL_SECONDS)
  } catch (err) {
    logger.warn({ workflowId, error: String(err) }, 'Cost trace recording failed (non-fatal)')
  }
}

/**
 * Retrieve the full cost trace for a workflow.
 */
export async function getWorkflowCostTrace(workflowId: string): Promise<WorkflowCostTrace | null> {
  const redis = getRedis()
  if (!redis) return null

  const key = `${COST_TRACE_PREFIX}${workflowId}`
  try {
    const raw = await redis.get(key)
    return raw ? (JSON.parse(raw) as WorkflowCostTrace) : null
  } catch {
    return null
  }
}

/**
 * Get aggregate cost across all workflows in the time window.
 */
export async function getAggregateWorkflowCosts(windowHours = 24): Promise<{
  totalCostDKK: number
  totalWorkflows: number
  totalModelCalls: number
  workflows: WorkflowCostTrace[]
}> {
  const redis = getRedis()
  if (!redis) {
    return { totalCostDKK: 0, totalWorkflows: 0, totalModelCalls: 0, workflows: [] }
  }

  try {
    const keys = await redis.keys(`${COST_TRACE_PREFIX}*`)
    const traces: WorkflowCostTrace[] = []

    for (const key of keys) {
      const raw = await redis.get(key)
      if (raw) {
        traces.push(JSON.parse(raw) as WorkflowCostTrace)
      }
    }

    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
    const filtered = traces.filter(t => t.startedAt >= cutoff)

    return {
      totalCostDKK: filtered.reduce((sum, t) => sum + t.totalCostDKK, 0),
      totalWorkflows: filtered.length,
      totalModelCalls: filtered.reduce((sum, t) => sum + t.modelCalls.length, 0),
      workflows: filtered,
    }
  } catch {
    return { totalCostDKK: 0, totalWorkflows: 0, totalModelCalls: 0, workflows: [] }
  }
}

// ─── Model Cost Estimation ───────────────────────────────────────────────────

/**
 * Estimate the cost of a model call given provider, model, and token count.
 * Uses canonical LlmMatrix pricing data as the single source of truth.
 * Falls back to provider-level heuristics only for models not in the matrix.
 * Returns cost in DKK (using USD-to-DKK rate of ~7.0).
 */
export function estimateModelCost(
  provider: string,
  model: string,
  estimatedTokens: number,
  outputRatio = 0.3,
): CostEstimateResult {
  const USD_TO_DKK = 7.0

  // Primary: canonical LlmMatrix pricing
  let modelConfig: ModelConfig | null = null
  try {
    modelConfig = LlmMatrix.getModel(model)
  } catch {
    modelConfig = null
  }

  let costPer1KInputUSD: number
  let costPer1KOutputUSD: number

  if (modelConfig) {
    costPer1KInputUSD = modelConfig.cost_per_1k_input_usd
    costPer1KOutputUSD = modelConfig.cost_per_1k_output_usd ?? modelConfig.cost_per_1k_input_usd
  } else {
    // Fallback: provider-level heuristic pricing for models not in the matrix.
    // These should be kept in sync with the canonical llm-matrix.json defaults.
    const providerLower = provider.toLowerCase()
    if (providerLower.includes('claude') || providerLower.includes('anthropic')) {
      costPer1KInputUSD = 0.015
      costPer1KOutputUSD = 0.075
    } else if (providerLower.includes('openai')) {
      costPer1KInputUSD = 0.010
      costPer1KOutputUSD = 0.030
    } else if (providerLower.includes('gemini')) {
      costPer1KInputUSD = 0.00125
      costPer1KOutputUSD = 0.00375
    } else if (providerLower.includes('deepseek')) {
      costPer1KInputUSD = 0.00027
      costPer1KOutputUSD = 0.0011
    } else {
      // Qwen, Groq, others — cheap defaults
      costPer1KInputUSD = 0.0005
      costPer1KOutputUSD = 0.0015
    }
  }

  const estimatedInputTokens = Math.ceil(estimatedTokens * (1 - outputRatio))
  const estimatedOutputTokens = Math.ceil(estimatedTokens * outputRatio)

  const inputCostDKK = (estimatedInputTokens / 1000) * costPer1KInputUSD * USD_TO_DKK
  const outputCostDKK = (estimatedOutputTokens / 1000) * costPer1KOutputUSD * USD_TO_DKK
  const totalCostDKK = inputCostDKK + outputCostDKK

  return {
    provider,
    model,
    estimatedTokens,
    costPer1KInputDKK: costPer1KInputUSD * USD_TO_DKK,
    costPer1KOutputDKK: costPer1KOutputUSD * USD_TO_DKK,
    totalCostDKK: Math.round(totalCostDKK * 10000) / 10000,
    currency: 'DKK',
  }
}

// ─── Model Policy Check ──────────────────────────────────────────────────────

/**
 * Check if a model call complies with cost governance policy.
 * Checks: Claude escalation rules, premium model limits, budget caps.
 */
export async function checkModelPolicy(
  provider: string,
  model: string,
  opts?: {
    isEscalation?: boolean
    estimatedTokens?: number
    task?: string
    currentDailySpendDKK?: number
  },
): Promise<PolicyCheckResult> {
  const providerLower = provider.toLowerCase()
  const isPremium = providerLower.includes('claude') || providerLower.includes('anthropic') || providerLower.includes('opus') || providerLower.includes('openai')

  // Budget cap check
  const dailySpend = opts?.currentDailySpendDKK ?? (await getAggregateWorkflowCosts(24)).totalCostDKK
  const budgetRemaining = dailySpend < DAILY_BUDGET_CAP_DKK

  if (!budgetRemaining) {
    return {
      pass: false,
      reason: `Daily budget cap exceeded (${dailySpend.toFixed(2)} DKK / ${DAILY_BUDGET_CAP_DKK} DKK). All model calls blocked until budget resets.`,
      provider,
      model,
      isEscalation: opts?.isEscalation ?? false,
      budgetRemaining: false,
    }
  }

  // Non-premium providers always pass
  if (!isPremium) {
    return {
      pass: true,
      reason: `Non-premium provider '${provider}' — allowed by default policy.`,
      provider,
      model,
      isEscalation: false,
      budgetRemaining: true,
    }
  }

  // Premium provider — escalation check required
  const isEscalation = opts?.isEscalation ?? false

  if (!isEscalation) {
    return {
      pass: false,
      reason: `Premium provider '${provider}' used without escalation flag. Set isEscalation=true and ensure cheaper models failed first.`,
      provider,
      model,
      isEscalation: false,
      budgetRemaining: true,
    }
  }

  // Escalation — verify it's justified
  const escalationCheck = await isClaudeEscalationAllowed(provider, opts?.task ?? '', {
    premiumAllowed: true, // If caller got here, they're claiming escalation
    estimatedTokens: opts?.estimatedTokens,
  })

  if (!escalationCheck.allowed) {
    return {
      pass: false,
      reason: `Claude escalation not justified: ${escalationCheck.reason}`,
      provider,
      model,
      isEscalation: true,
      budgetRemaining: true,
    }
  }

  return {
    pass: true,
    reason: `Premium escalation approved: ${escalationCheck.reason}`,
    provider,
    model,
    isEscalation: true,
    budgetRemaining: true,
  }
}

// ─── Context Compaction Enforcement ──────────────────────────────────────────

/**
 * Estimate token count from character count (~4 chars per token).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Check if context needs compaction before a delegate call.
 * Returns compaction recommendation if context exceeds threshold.
 */
export function shouldCompactContext(context: string): { needsCompaction: boolean; estimatedTokens: number } {
  const estimatedTokens = estimateTokenCount(context)
  return {
    needsCompaction: estimatedTokens > CONTEXT_COMPACTION_THRESHOLD,
    estimatedTokens,
  }
}

/**
 * Compact context using RLM Engine's /cognitive/fold endpoint.
 *
 * Primary path: delegates to RLM's cognitive folding for semantic-aware
 * compaction that preserves key information while removing redundancy.
 *
 * Fallback: simple truncation (not LLM call) when RLM is unavailable.
 * This avoids spending tokens on an LLM call just to save tokens.
 *
 * Logs compaction ratio for observability.
 */
export async function compactContext(
  context: string,
  targetTokens = 4000,
  query?: string,
  domain?: string,
): Promise<{ compacted: string; originalTokens: number; compactedTokens: number; ratio: number } | null> {
  const originalTokens = estimateTokenCount(context)

  if (originalTokens <= CONTEXT_COMPACTION_THRESHOLD) {
    return null // No compaction needed
  }

  // Primary: RLM cognitive fold
  if (isRlmAvailable()) {
    try {
      const result = await callCognitive('fold', {
        prompt: query ?? 'Compress and fold the following context while preserving key information',
        context: {
          text: context.slice(0, 30000), // Hard cap to avoid runaway costs
          budget: targetTokens,
          strategy: 'semantic',
        },
        agent_id: 'cost-governance',
      }, 30000)

      const compacted = typeof result === 'string' ? result : JSON.stringify(result)
      const compactedTokens = estimateTokenCount(compacted)
      const ratio = originalTokens / Math.max(compactedTokens, 1)

      logger.info(
        { originalTokens, compactedTokens, ratio: ratio.toFixed(2), method: 'rlm-fold' },
        'Context compaction complete (RLM)',
      )

      return { compacted, originalTokens, compactedTokens, ratio }
    } catch (err) {
      logger.warn({ error: String(err) }, 'RLM context compaction failed — falling back to truncation')
    }
  }

  // Fallback: simple truncation (not an LLM call — that would defeat the purpose)
  const targetChars = targetTokens * 4 // ~4 chars per token
  const compacted = context.slice(0, targetChars)
  const compactedTokens = estimateTokenCount(compacted)
  const ratio = originalTokens / Math.max(compactedTokens, 1)

  logger.warn(
    { originalTokens, compactedTokens, ratio: ratio.toFixed(2), method: 'truncation-fallback' },
    'Context compaction via truncation (RLM unavailable)',
  )

  return { compacted, originalTokens, compactedTokens, ratio }
}

// ─── Chain Verification Gate (topic 6/15) ────────────────────────────────────

export interface ChainVerificationResult {
  passed: boolean
  avgQualityScore: number
  stepCount: number
  lowQualitySteps: number
  verdict: 'pass' | 'warn' | 'fail'
  message: string
}

/**
 * Post-chain quality gate: evaluates aggregated step quality scores.
 * - pass:  avgScore >= 0.60
 * - warn:  avgScore 0.35-0.60 or >30% steps below 0.4
 * - fail:  avgScore < 0.35
 *
 * Called after chain execution completes. Does NOT abort the chain —
 * result is attached to execution for observability and pheromone signaling.
 */
export function chainVerificationGate(
  stepResults: Array<{ quality_score?: number; status: string }>,
): ChainVerificationResult {
  const scoredSteps = stepResults.filter(s => typeof s.quality_score === 'number')
  if (scoredSteps.length === 0) {
    return { passed: true, avgQualityScore: 0.5, stepCount: 0, lowQualitySteps: 0, verdict: 'pass', message: 'No scored steps' }
  }

  const avgQualityScore = scoredSteps.reduce((sum, s) => sum + (s.quality_score ?? 0), 0) / scoredSteps.length
  const lowQualitySteps = scoredSteps.filter(s => (s.quality_score ?? 0) < 0.4).length
  const lowQualityRatio = lowQualitySteps / scoredSteps.length

  let verdict: 'pass' | 'warn' | 'fail'
  let message: string

  if (avgQualityScore < 0.35) {
    verdict = 'fail'
    message = `Chain quality below threshold: avg ${avgQualityScore.toFixed(2)} < 0.35`
  } else if (avgQualityScore < 0.60 || lowQualityRatio > 0.30) {
    verdict = 'warn'
    message = `Chain quality degraded: avg ${avgQualityScore.toFixed(2)}, ${lowQualitySteps}/${scoredSteps.length} steps below 0.4`
  } else {
    verdict = 'pass'
    message = `Chain quality OK: avg ${avgQualityScore.toFixed(2)}`
  }

  return { passed: verdict !== 'fail', avgQualityScore, stepCount: scoredSteps.length, lowQualitySteps, verdict, message }
}

// ─── Module exports ──────────────────────────────────────────────────────────

export default {
  // Constants
  MAX_RECURSION_DEPTH,
  MAX_AGENT_FANOUT_PARALLEL,
  MAX_AGENT_FANOUT_DEBATE,
  CONTEXT_COMPACTION_THRESHOLD,

  // Budget lane classification
  getBudgetLane,
  inferBudgetLaneFromTask,

  // Claude escalation
  isClaudeEscalationAllowed,
  recordPriorFailure,

  // Recursion depth
  enforceMaxRecursionDepth,

  // Fan-out
  enforceMaxFanOut,

  // Cost trace
  recordWorkflowCost,
  getWorkflowCostTrace,
  getAggregateWorkflowCosts,

  // Cost estimation
  estimateModelCost,

  // Policy check
  checkModelPolicy,

  // Context compaction
  shouldCompactContext,
  compactContext,
  estimateTokenCount,
}
