/**
 * hyperagent.ts — Plan-based execution layer for HyperAgent (LIN-626, LIN-627, LIN-628).
 *
 * Wraps the existing chain-engine with:
 *   1. Goal → Plan decomposition (via cognitive proxy)
 *   2. Persistent approval gate (Redis-backed, 1h TTL)
 *   3. Plan execution (delegates to executeChain)
 *   4. Post-execution evaluation + KPI persistence (Neo4j)
 *
 * Zero changes to existing chain-engine, mcp-caller, or tool-executor.
 */
import { v4 as uuid } from 'uuid'
import { executeChain, type ChainDefinition, type ChainStep, type ChainExecution } from '../chain/chain-engine.js'
import { callCognitiveRaw } from '../cognitive-proxy.js'
import { callMcpTool } from '../mcp-caller.js'
import { getRedis } from '../redis.js'
import { broadcastMessage } from '../chat-broadcaster.js'
import type { AgentMessage } from '@widgetdc/contracts/orchestrator'
import { logger } from '../logger.js'
import { config } from '../config.js'
import * as crypto from 'crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExecutionMode = 'read_only' | 'staged_write' | 'production_write'

export interface PolicyProfile {
  id: string
  mode: ExecutionMode
  /** Tools blocked under this profile */
  blockedTools: string[]
  /** Whether human approval is required before execution */
  requiresApproval: boolean
  /** Max steps allowed in a single plan */
  maxSteps: number
  /** Approval TTL in seconds — shorter for destructive profiles (RLM insight) */
  approvalTtlSeconds: number
  /** Whether cognitive proxy failure should reject plan creation (vs fallback) */
  rejectOnCognitiveFailure: boolean
  /** DR18: Allowed LLM providers for this profile (empty = all allowed) */
  allowedProviders: string[]
}

export interface HyperPlan {
  planId: string
  sessionId: string
  goal: string
  profile: PolicyProfile
  steps: ChainStep[]
  chainDef: ChainDefinition
  createdAt: string
  status: 'pending_approval' | 'approved' | 'executing' | 'completed' | 'failed'
  // FR-4 governance fields (Neural Bridge v2)
  riskLevel: 'read_only' | 'staged_write' | 'production_write'
  budgetLane: 'micro' | 'standard' | 'deep'
  targetServices: string[]
  successMetrics: string
  premiumAllowed: boolean
  maxAgentFanout: number
  maxRecursionDepth: number
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'executed' | 'evaluated'
  approvedBy: string | null
  evaluatedAt: string | null
}

export interface Approval {
  planId: string
  approvedBy: string
  approvedAt: string
  expiresAt: string
  scope: string
}

export interface KpiSnapshot {
  traceId: string
  planId: string
  agentId: string
  score: number
  outcome: string
  stepsCompleted: number
  stepsTotal: number
  durationMs: number
}

// ─── Plan Lifecycle Events (FR-4) ─────────────────────────────────────────

export type PlanLifecycleEvent =
  | { event: 'plan.created'; planId: string; riskLevel: string; createdAt: string }
  | { event: 'plan.approved'; planId: string; approvedBy: string; approvedAt: string }
  | { event: 'plan.executed'; planId: string; durationMs: number; status: string }
  | { event: 'plan.evaluated'; planId: string; kpiImpact: number; success: boolean }

type PlanEventSubscriber = (event: PlanLifecycleEvent) => void

const planEventSubscribers = new Set<PlanEventSubscriber>()

export function onPlanEvent(fn: PlanEventSubscriber): () => void {
  planEventSubscribers.add(fn)
  return () => { planEventSubscribers.delete(fn) }
}

function emitPlanEvent(event: PlanLifecycleEvent): void {
  for (const fn of planEventSubscribers) {
    try { fn(event) } catch (err) {
      logger.warn({ err, event: event.event }, 'HyperAgent: event subscriber failed')
    }
  }
  // Also log for observability
  logger.info(event, `HyperAgent: plan lifecycle event — ${event.event}`)
}

// ─── Policy Profiles ────────────────────────────────────────────────────────

const WRITE_TOOLS = [
  'graph.write_cypher', 'graph.bulk_write', 'git.commit', 'git.push',
  'railway.deploy', 'file.write', 'linear.create_issue', 'linear.update_issue',
]

export const POLICY_PROFILES: Record<string, PolicyProfile> = {
  read_only: {
    id: 'read_only',
    mode: 'read_only',
    blockedTools: WRITE_TOOLS,
    requiresApproval: false,
    maxSteps: 25,
    approvalTtlSeconds: 3600,            // 1h (irrelevant — no approval needed)
    rejectOnCognitiveFailure: false,      // Safe to fallback to single-step analyze
    allowedProviders: [],                 // DR18: all providers OK for reads
  },
  staged_write: {
    id: 'staged_write',
    mode: 'staged_write',
    blockedTools: ['git.push', 'railway.deploy'],
    requiresApproval: true,
    maxSteps: 25,
    approvalTtlSeconds: 3600,            // 1h — reversible operations
    rejectOnCognitiveFailure: false,      // Fallback acceptable
    allowedProviders: ['anthropic', 'openrouter'], // DR18: no DeepSeek for writes
  },
  production_write: {
    id: 'production_write',
    mode: 'production_write',
    blockedTools: [],
    requiresApproval: true,
    maxSteps: 15,
    approvalTtlSeconds: 900,             // 15min — destructive operations (RLM insight)
    rejectOnCognitiveFailure: true,       // MUST have proper plan decomposition
    allowedProviders: ['anthropic'],      // DR18: production_write = Claude only
  },
}

// ─── Chain Mode Selection (DR15 tuning) ────────────────────────────────────
// Instead of hardcoding 'sequential', select mode based on step characteristics

type ChainMode = 'sequential' | 'parallel' | 'debate' | 'loop' | 'adaptive' | 'funnel'

function selectChainMode(steps: ChainStep[], goal: string): ChainMode {
  // Signal 1: Step dependency — if steps reference {{prev}}, they need sequential
  const hasDependencies = steps.some(s =>
    s.prompt?.includes('{{prev}}') || JSON.stringify(s.arguments ?? {}).includes('{{prev}}'),
  )
  if (hasDependencies) return 'sequential'

  // Signal 2: All steps are independent reads → parallel
  const allReads = steps.every(s => s.tool_name && !WRITE_TOOLS.includes(s.tool_name))
  const multiSource = steps.length >= 3 && new Set(steps.map(s => s.tool_name)).size >= 2
  if (allReads && multiSource) return 'parallel'

  // Signal 3: Goal contains debate/comparison keywords → debate
  const debateKeywords = /\b(compar|debate|versus|vs\.|pros.*cons|tradeoff|evaluate.*alternatives)\b/i
  if (debateKeywords.test(goal) && steps.length >= 2) return 'debate'

  // Signal 4: Goal contains iterative/refine keywords → loop
  const loopKeywords = /\b(iterat|refin|optimi[zs]|converg|improv.*until|repeat)\b/i
  if (loopKeywords.test(goal)) return 'loop'

  // Signal 5: Many steps with mixed types → funnel (synthesis pipeline)
  if (steps.length >= 5) return 'funnel'

  // Default: adaptive (let chain engine decide)
  return steps.length >= 3 ? 'adaptive' : 'sequential'
}

// ─── Session Circuit Breaker (RLM insight: re-plan backoff) ────────────────
// Mirrors openclaw.ts pattern — prevents runaway re-plan loops

interface SessionCircuit {
  consecutiveFailures: number
  circuitOpenUntil: number
  downgradedToReadOnly: boolean
}

const SESSION_CIRCUIT_THRESHOLD = 3     // failures before auto-downgrade
const SESSION_CIRCUIT_HARD_LIMIT = 5    // failures before circuit open
const SESSION_CIRCUIT_BASE_COOLDOWN_MS = 15_000  // DR20: exponential backoff starting at 15s (not flat 60s)

const sessionCircuits = new Map<string, SessionCircuit>()

function getSessionCircuit(sessionId: string): SessionCircuit {
  let c = sessionCircuits.get(sessionId)
  if (!c) {
    c = { consecutiveFailures: 0, circuitOpenUntil: 0, downgradedToReadOnly: false }
    sessionCircuits.set(sessionId, c)
  }
  return c
}

function recordSessionSuccess(sessionId: string): void {
  const c = getSessionCircuit(sessionId)
  if (c.consecutiveFailures > 0) {
    logger.info({ sessionId, previous_failures: c.consecutiveFailures }, 'HyperAgent: session circuit CLOSED — recovered')
  }
  c.consecutiveFailures = 0
  c.circuitOpenUntil = 0
  c.downgradedToReadOnly = false
}

function recordSessionFailure(sessionId: string): void {
  const c = getSessionCircuit(sessionId)
  c.consecutiveFailures++

  if (c.consecutiveFailures >= SESSION_CIRCUIT_HARD_LIMIT && c.circuitOpenUntil === 0) {
    // DR20 tuning: exponential backoff — 15s, 30s, 60s, 120s (capped)
    const backoffMultiplier = Math.min(8, Math.pow(2, c.consecutiveFailures - SESSION_CIRCUIT_HARD_LIMIT))
    const cooldownMs = SESSION_CIRCUIT_BASE_COOLDOWN_MS * backoffMultiplier
    c.circuitOpenUntil = Date.now() + cooldownMs
    logger.warn({ sessionId, failures: c.consecutiveFailures, cooldownMs }, 'HyperAgent: session circuit OPEN — exponential backoff')
  } else if (c.consecutiveFailures >= SESSION_CIRCUIT_THRESHOLD && !c.downgradedToReadOnly) {
    c.downgradedToReadOnly = true
    logger.warn({ sessionId, failures: c.consecutiveFailures }, 'HyperAgent: auto-downgraded session to read_only after 3 failures')
  }
}

function isSessionCircuitOpen(sessionId: string): boolean {
  const c = getSessionCircuit(sessionId)
  if (c.circuitOpenUntil === 0) return false
  if (Date.now() >= c.circuitOpenUntil) {
    c.circuitOpenUntil = 0
    c.consecutiveFailures = 0
    c.downgradedToReadOnly = false
    logger.info({ sessionId }, 'HyperAgent: session circuit auto-reset after cooldown')
    return false
  }
  return true
}

// ─── In-Memory Plan Store (+ Redis persistence) ────────────────────────────

const plans = new Map<string, HyperPlan>()

function persistPlan(plan: HyperPlan): void {
  plans.set(plan.planId, plan)
  const redis = getRedis()
  if (redis) {
    redis.hset('orchestrator:hyperplans', plan.planId, JSON.stringify(plan)).catch(() => {})
    redis.expire('orchestrator:hyperplans', 86400).catch(() => {})
  }
}

export function getPlan(planId: string): HyperPlan | undefined {
  return plans.get(planId)
}

export function listHyperPlans(): HyperPlan[] {
  return Array.from(plans.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
}

// ─── 1. Plan Creation (LIN-626) ────────────────────────────────────────────

export async function createPlan(
  goal: string,
  sessionId: string,
  profileId: string = 'read_only',
  opts?: {
    targetServices?: string[]
    successMetrics?: string
    premiumAllowed?: boolean
    maxAgentFanout?: number
    maxRecursionDepth?: number
  },
): Promise<HyperPlan> {
  // Circuit breaker: reject if session has too many consecutive failures (RLM insight)
  if (isSessionCircuitOpen(sessionId)) {
    throw new Error(`Session ${sessionId} circuit breaker OPEN — too many consecutive failures. Auto-resets in ≤60s.`)
  }

  // Auto-downgrade to read_only after 3+ failures in session (RLM insight)
  const circuit = getSessionCircuit(sessionId)
  const effectiveProfileId = circuit.downgradedToReadOnly ? 'read_only' : profileId
  if (circuit.downgradedToReadOnly && profileId !== 'read_only') {
    logger.info({ sessionId, requested: profileId }, 'HyperAgent: auto-downgraded to read_only due to consecutive failures')
  }

  const profile = POLICY_PROFILES[effectiveProfileId] ?? POLICY_PROFILES.read_only
  const planId = `hyp-${uuid().slice(0, 12)}`

  // Decompose goal into steps via RLM cognitive proxy
  let steps: ChainStep[] = []
  try {
    const cogResult = await callCognitiveRaw('plan', {
      prompt: goal,
      context: { sessionId, profile: profile.id, maxSteps: profile.maxSteps },
      agent_id: 'hyperagent',
    })

    // Parse execution_steps from cognitive response into ChainSteps
    const rawSteps = cogResult?.execution_steps
    if (Array.isArray(rawSteps)) {
      steps = rawSteps.slice(0, profile.maxSteps).map((s: unknown, i: number) => {
        if (typeof s === 'object' && s !== null) {
          const step = s as Record<string, unknown>
          return {
            id: `step-${i}`,
            agent_id: String(step.agent_id ?? 'qwen'),
            tool_name: typeof step.tool === 'string' ? step.tool : undefined,
            cognitive_action: typeof step.cognitive_action === 'string' ? step.cognitive_action : undefined,
            arguments: typeof step.arguments === 'object' ? (step.arguments as Record<string, unknown>) : undefined,
            prompt: typeof step.prompt === 'string' ? step.prompt : undefined,
          }
        }
        // Fallback: treat string step as a cognitive analyze action
        return {
          id: `step-${i}`,
          agent_id: 'qwen',
          cognitive_action: 'analyze',
          prompt: String(s),
        }
      })
    }
  } catch (err) {
    // RLM insight: production_write MUST have proper plan decomposition — no fallback
    if (profile.rejectOnCognitiveFailure) {
      throw new Error(`Cognitive proxy failed and profile "${profile.id}" requires plan decomposition. Cannot create plan without RLM Engine.`)
    }
    logger.warn({ err, goal, profile: profile.id }, 'HyperAgent: cognitive plan decomposition failed, using single-step fallback')
    steps = [{
      id: 'step-0',
      agent_id: 'qwen',
      cognitive_action: 'analyze',
      prompt: goal,
    }]
  }

  // Block tools not allowed by policy
  steps = steps.map(s => {
    if (s.tool_name && profile.blockedTools.includes(s.tool_name)) {
      logger.info({ tool: s.tool_name, profile: profile.id }, 'HyperAgent: tool blocked by policy, converting to analyze')
      return { ...s, tool_name: undefined, cognitive_action: 'analyze', prompt: `[BLOCKED] Cannot execute ${s.tool_name} under ${profile.id} profile. Analyze intent instead: ${s.prompt ?? ''}` }
    }
    return s
  })

  // DR15 tuning: select chain mode based on step characteristics instead of hardcoding sequential
  const chainMode = selectChainMode(steps, goal)

  const chainDef: ChainDefinition = {
    chain_id: planId,
    name: `hyperagent:${planId}`,
    description: goal,
    mode: chainMode,
    steps,
  }

  const budgetLane = profile.maxSteps <= 10 ? 'micro' : profile.maxSteps <= 25 ? 'standard' : 'deep'

  const plan: HyperPlan = {
    planId,
    sessionId,
    goal,
    profile,
    steps,
    chainDef,
    createdAt: new Date().toISOString(),
    status: profile.requiresApproval ? 'pending_approval' : 'approved',
    // FR-4 governance fields
    riskLevel: profile.mode,
    budgetLane,
    targetServices: opts?.targetServices ?? [],
    successMetrics: opts?.successMetrics ?? '',
    premiumAllowed: opts?.premiumAllowed ?? profile.allowedProviders.includes('anthropic'),
    maxAgentFanout: opts?.maxAgentFanout ?? (profile.mode === 'production_write' ? 1 : 3),
    maxRecursionDepth: opts?.maxRecursionDepth ?? (profile.mode === 'production_write' ? 1 : 3),
    approvalStatus: profile.requiresApproval ? 'pending' : 'approved',
    approvedBy: null,
    evaluatedAt: null,
  }

  persistPlan(plan)
  logger.info({ planId, goal, profile: profile.id, steps: steps.length }, 'HyperAgent: plan created')

  // FR-4: emit plan.created event
  emitPlanEvent({
    event: 'plan.created',
    planId,
    riskLevel: profile.mode,
    createdAt: plan.createdAt,
  })

  return plan
}

// ─── 2. Approval Gate (LIN-627) ────────────────────────────────────────────

const APPROVAL_PREFIX = 'orchestrator:approval:'

export async function approvePlan(
  planId: string,
  approvedBy: string,
): Promise<Approval> {
  const plan = plans.get(planId)
  if (!plan) throw new Error(`Plan ${planId} not found`)
  if (plan.status !== 'pending_approval') throw new Error(`Plan ${planId} is ${plan.status}, not pending_approval`)

  // Per-profile TTL: production_write gets 15min, staged_write gets 1h (RLM insight)
  const ttlSeconds = plan.profile.approvalTtlSeconds

  const approval: Approval = {
    planId,
    approvedBy,
    approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    scope: plan.profile.id,
  }

  const redis = getRedis()
  if (redis) {
    await redis.setex(`${APPROVAL_PREFIX}${planId}`, ttlSeconds, JSON.stringify(approval))
  }

  plan.status = 'approved'
  plan.approvalStatus = 'approved'
  plan.approvedBy = approvedBy
  persistPlan(plan)

  // Broadcast approval event for Command Center
  broadcastMessage({
    from: 'HyperAgent',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `Plan ${planId} approved by ${approvedBy}`,
  } as AgentMessage)

  logger.info({ planId, approvedBy }, 'HyperAgent: plan approved')

  // FR-4: emit plan.approved event
  emitPlanEvent({
    event: 'plan.approved',
    planId,
    approvedBy,
    approvedAt: approval.approvedAt,
  })

  return approval
}

export async function rejectPlan(planId: string, rejectedBy: string): Promise<void> {
  const plan = plans.get(planId)
  if (!plan) throw new Error(`Plan ${planId} not found`)

  const redis = getRedis()
  if (redis) {
    await redis.del(`${APPROVAL_PREFIX}${planId}`)
  }

  plan.status = 'failed'
  persistPlan(plan)

  broadcastMessage({
    from: 'HyperAgent',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `Plan ${planId} rejected by ${rejectedBy}`,
  } as AgentMessage)

  logger.info({ planId, rejectedBy }, 'HyperAgent: plan rejected')
}

async function checkApproval(planId: string): Promise<Approval | null> {
  const t0 = Date.now() // DR4: timing instrumentation
  const redis = getRedis()
  if (!redis) {
    // Fallback: check in-memory plan status
    const plan = plans.get(planId)
    return plan?.status === 'approved' ? {
      planId,
      approvedBy: 'in-memory',
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      scope: plan.profile.id,
    } : null
  }

  const raw = await redis.get(`${APPROVAL_PREFIX}${planId}`)
  if (!raw) return null

  const approval = JSON.parse(raw) as Approval
  if (new Date(approval.expiresAt) < new Date()) {
    await redis.del(`${APPROVAL_PREFIX}${planId}`)
    logger.warn({ planId, latencyMs: Date.now() - t0 }, 'HyperAgent: approval expired')
    return null
  }

  logger.debug({ planId, latencyMs: Date.now() - t0 }, 'HyperAgent: approval check completed') // DR4
  return approval
}

/** Validate webhook HMAC signature (if secret is configured) */
export function validateWebhookSignature(body: string, signature: string | undefined): boolean {
  const secret = process.env.APPROVAL_WEBHOOK_SECRET
  if (!secret) return true // Dev mode: skip validation
  if (!signature) return false

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

// ─── 3. Plan Execution (LIN-626) ───────────────────────────────────────────

export async function executePlan(planId: string): Promise<ChainExecution> {
  const plan = plans.get(planId)
  if (!plan) throw new Error(`Plan ${planId} not found`)

  // Check approval if required
  if (plan.profile.requiresApproval) {
    const approval = await checkApproval(planId)
    if (!approval) {
      throw new Error(`Plan ${planId} requires approval (profile: ${plan.profile.id})`)
    }
    logger.info({ planId, approvedBy: approval.approvedBy }, 'HyperAgent: approval validated')
  }

  plan.status = 'executing'
  persistPlan(plan)

  try {
    // Delegate to existing chain engine — zero duplication
    const execution = await executeChain(plan.chainDef)

    plan.status = execution.status === 'completed' ? 'completed' : 'failed'
    persistPlan(plan)

    // Session circuit breaker: track success/failure (RLM insight)
    if (execution.status === 'completed') {
      recordSessionSuccess(plan.sessionId)
    } else {
      recordSessionFailure(plan.sessionId)
    }

    // Fire-and-forget: persist trace to Neo4j (LIN-628)
    persistExecutionTrace(execution, planId).catch(err => {
      logger.warn({ err, planId }, 'HyperAgent: trace persistence failed (non-blocking)')
    })

    logger.info({
      planId,
      executionId: execution.execution_id,
      status: execution.status,
      duration: execution.duration_ms,
    }, 'HyperAgent: plan executed')

    plan.approvalStatus = execution.status === 'completed' ? 'executed' : 'rejected'
    persistPlan(plan)

    // FR-4: emit plan.executed event
    emitPlanEvent({
      event: 'plan.executed',
      planId,
      durationMs: execution.duration_ms ?? 0,
      status: execution.status,
    })

    return execution
  } catch (err) {
    plan.status = 'failed'
    persistPlan(plan)
    recordSessionFailure(plan.sessionId)
    throw err
  }
}

// ─── 4. Evaluation & KPI Persistence (LIN-628) ─────────────────────────────

async function persistExecutionTrace(exec: ChainExecution, planId: string): Promise<void> {
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (t:ExecutionTrace {executionId: $executionId})
                SET t.chainName = $chainName, t.mode = $mode,
                    t.planId = $planId, t.status = $status,
                    t.stepsCompleted = $stepsCompleted,
                    t.stepsTotal = $stepsTotal,
                    t.durationMs = $durationMs,
                    t.completedAt = datetime()`,
        params: {
          executionId: exec.execution_id,
          chainName: exec.name,
          mode: exec.mode,
          planId,
          status: exec.status,
          stepsCompleted: exec.steps_completed,
          stepsTotal: exec.steps_total,
          durationMs: exec.duration_ms ?? 0,
        },
      },
      callId: `hyp-trace-${exec.execution_id}`,
    })
  } catch (err) {
    logger.warn({ err, executionId: exec.execution_id }, 'HyperAgent: ExecutionTrace write failed')
  }
}

export async function evaluatePlan(
  executionId: string,
  planId: string,
  score: number,
  agentId: string = 'hyperagent',
): Promise<KpiSnapshot> {
  const plan = plans.get(planId)

  const snapshot: KpiSnapshot = {
    traceId: `kpi-${executionId}`,
    planId,
    agentId,
    score: Math.max(0, Math.min(100, score)),
    outcome: plan?.status ?? 'unknown',
    stepsCompleted: plan?.steps.length ?? 0,
    stepsTotal: plan?.steps.length ?? 0,
    durationMs: 0,
  }

  // Persist KpiSnapshot to Neo4j — parameterized, no interpolation
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (k:KpiSnapshot {traceId: $traceId})
                SET k.planId = $planId, k.agentId = $agentId,
                    k.score = $score, k.outcome = $outcome,
                    k.stepsCompleted = $stepsCompleted,
                    k.stepsTotal = $stepsTotal,
                    k.durationMs = $durationMs,
                    k.completedAt = datetime()`,
        params: {
          traceId: snapshot.traceId,
          planId: snapshot.planId,
          agentId: snapshot.agentId,
          score: snapshot.score,
          outcome: snapshot.outcome,
          stepsCompleted: snapshot.stepsCompleted,
          stepsTotal: snapshot.stepsTotal,
          durationMs: snapshot.durationMs,
        },
      },
      callId: `hyp-kpi-${executionId}`,
    })

    logger.info({ traceId: snapshot.traceId, score }, 'HyperAgent: KPI snapshot persisted to Neo4j')
  } catch (err) {
    logger.warn({ err, traceId: snapshot.traceId }, 'HyperAgent: KPI persistence failed (non-blocking)')
  }

  // FR-4: update plan governance state
  if (plan) {
    plan.approvalStatus = 'evaluated'
    plan.evaluatedAt = new Date().toISOString()
    persistPlan(plan)
  }

  // FR-4: emit plan.evaluated event
  const success = score >= 70
  emitPlanEvent({
    event: 'plan.evaluated',
    planId,
    kpiImpact: (score - 50) / 50, // normalize 0-100 to -1..1
    success,
  })

  return snapshot
}

/**
 * Get HyperAgent health/circuit state for /health endpoint.
 * Exports: active plans, session circuits, profile distribution.
 */
export function getHyperAgentHealth(): Record<string, unknown> {
  const allPlans = Array.from(plans.values())
  const circuits = Array.from(sessionCircuits.entries()).map(([sid, c]) => ({
    sessionId: sid,
    failures: c.consecutiveFailures,
    circuitOpen: c.circuitOpenUntil > Date.now(),
    downgraded: c.downgradedToReadOnly,
  })).filter(c => c.failures > 0)

  return {
    total_plans: allPlans.length,
    by_status: {
      pending_approval: allPlans.filter(p => p.status === 'pending_approval').length,
      approved: allPlans.filter(p => p.status === 'approved').length,
      executing: allPlans.filter(p => p.status === 'executing').length,
      completed: allPlans.filter(p => p.status === 'completed').length,
      failed: allPlans.filter(p => p.status === 'failed').length,
    },
    active_circuits: circuits,
  }
}

/** Fetch aggregated KPIs from Neo4j with in-memory fallback */
export async function getKpis(windowHours: number = 24): Promise<Record<string, unknown>> {
  try {
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `MATCH (k:KpiSnapshot)
                WHERE k.completedAt > datetime() - duration({hours: $hours})
                RETURN avg(k.score) AS avgScore,
                       count(k) AS totalPlans,
                       sum(CASE WHEN k.outcome = 'completed' THEN 1 ELSE 0 END) AS succeeded,
                       sum(CASE WHEN k.outcome = 'failed' THEN 1 ELSE 0 END) AS failed`,
        params: { hours: windowHours },
      },
      callId: `hyp-kpis-${Date.now()}`,
    })
    return { source: 'neo4j', window_hours: windowHours, ...(result as object) }
  } catch {
    // Fallback: compute from in-memory plans
    const cutoff = new Date(Date.now() - windowHours * 3600000)
    const recent = Array.from(plans.values()).filter(p => new Date(p.createdAt) > cutoff)
    return {
      source: 'in_memory_fallback',
      window_hours: windowHours,
      totalPlans: recent.length,
      succeeded: recent.filter(p => p.status === 'completed').length,
      failed: recent.filter(p => p.status === 'failed').length,
      pending: recent.filter(p => p.status === 'pending_approval').length,
    }
  }
}
