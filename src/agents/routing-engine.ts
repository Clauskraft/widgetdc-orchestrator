import { v4 as uuid } from 'uuid'
import { AgentRegistry } from './agent-registry.js'
import type {
  AgentTrustProfile,
  AgentWorkflowEnvelope,
  OrchestratorTaskDomain,
  RoutingCapability,
  RoutingDecision,
  RoutingIntent,
  WorkflowPhase,
  WorkflowType,
} from '@widgetdc/contracts/orchestrator'

export type RouteScope = 'widgetdc-orchestrator' | 'widgetdc-librechat' | 'snout'

interface ExecutionLike {
  execution_id: string
  started_at: string
  results: Array<{
    agent_id: string
    status: 'success' | 'error' | 'timeout'
    verified?: boolean
  }>
}

interface RoutingResolutionInput {
  message: string
  capabilityHint?: RoutingCapability
  routeScope?: readonly RouteScope[]
  operatorVisible?: boolean
  recentExecutions?: ExecutionLike[]
  workflowId?: string
}

interface RoutingResolution {
  selectedAgentId: string
  intent: RoutingIntent
  trustProfiles: AgentTrustProfile[]
  decision: RoutingDecision
  workflowEnvelope: AgentWorkflowEnvelope
}

const CAPABILITY_CANDIDATES: Record<RoutingCapability, string[]> = {
  engagement_intake: ['the-snout', 'harvest', 'lc-harvester'],
  guided_decomposition: ['nexus', 'rlm', 'consulting'],
  verified_recommendation: ['omega', 'consulting', 'rlm'],
  learning_feedback: ['cma', 'nexus', 'rlm'],
  workflow_audit: ['omega', 'custodian', 'legal', 'lc-sentinel'],
}

const CAPABILITY_META: Record<RoutingCapability, {
  taskDomain: OrchestratorTaskDomain
  flowRef: 'core-flow-1' | 'core-flow-2' | 'core-flow-3'
  workflowType: WorkflowType
  workflowPhase: WorkflowPhase
  scorecardDimensions: RoutingIntent['scorecard_dimensions']
  trustDimension: AgentTrustProfile['scorecard_dimension']
}> = {
  engagement_intake: {
    taskDomain: 'intake',
    flowRef: 'core-flow-1',
    workflowType: 'research',
    workflowPhase: 'discover',
    scorecardDimensions: ['prioritization_quality', 'time_to_verified_decision'],
    trustDimension: 'prioritization_quality',
  },
  guided_decomposition: {
    taskDomain: 'decomposition',
    flowRef: 'core-flow-2',
    workflowType: 'delivery',
    workflowPhase: 'define',
    scorecardDimensions: ['decomposition_quality', 'decision_stability'],
    trustDimension: 'decomposition_quality',
  },
  verified_recommendation: {
    taskDomain: 'recommendation',
    flowRef: 'core-flow-3',
    workflowType: 'delivery',
    workflowPhase: 'deliver',
    scorecardDimensions: ['promotion_precision', 'decision_stability', 'time_to_verified_decision'],
    trustDimension: 'promotion_precision',
  },
  learning_feedback: {
    taskDomain: 'learning',
    flowRef: 'core-flow-3',
    workflowType: 'audit',
    workflowPhase: 'deliver',
    scorecardDimensions: ['operator_acceptance', 'decision_stability'],
    trustDimension: 'operator_acceptance',
  },
  workflow_audit: {
    taskDomain: 'audit',
    flowRef: 'core-flow-3',
    workflowType: 'audit',
    workflowPhase: 'deliver',
    scorecardDimensions: ['tri_source_arbitration_divergence', 'decision_stability'],
    trustDimension: 'decision_stability',
  },
}

const recentRoutingDecisions: RoutingDecision[] = []

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

function inferCapabilityFromMessage(message: string): RoutingCapability {
  const text = message.toLowerCase()
  if (text.includes('feedback') || text.includes('accept') || text.includes('reject') || text.includes('learning')) {
    return 'learning_feedback'
  }
  if (text.includes('audit') || text.includes('verify') || text.includes('compliance') || text.includes('policy')) {
    return 'workflow_audit'
  }
  if (text.includes('recommend') || text.includes('decision') || text.includes('promot') || text.includes('surface')) {
    return 'verified_recommendation'
  }
  if (text.includes('decompose') || text.includes('break down') || text.includes('plan') || text.includes('bridge')) {
    return 'guided_decomposition'
  }
  return 'engagement_intake'
}

function buildIntent(
  capability: RoutingCapability,
  routeScope: RouteScope[],
  operatorVisible: boolean,
): RoutingIntent {
  const meta = CAPABILITY_META[capability]
  return {
    intent_id: `intent-${uuid().slice(0, 8)}`,
    capability,
    task_domain: meta.taskDomain === 'routing' ? 'intake' : meta.taskDomain,
    flow_ref: meta.flowRef,
    route_scope: routeScope,
    operator_visible: operatorVisible,
    scorecard_dimensions: meta.scorecardDimensions,
  }
}

function getCandidateAgents(capability: RoutingCapability): string[] {
  return CAPABILITY_CANDIDATES[capability].filter(agentId => AgentRegistry.get(agentId))
}

function summarizeEvidence(agentId: string, executions: ExecutionLike[]): {
  successCount: number
  failCount: number
  evidenceRefs: string[]
} {
  const references: string[] = []
  let successCount = 0
  let failCount = 0

  for (const execution of executions.slice(0, 20)) {
    const step = execution.results.find(result => result.agent_id === agentId)
    if (!step) continue

    const verifiedSuccess = step.status === 'success' && step.verified !== false
    if (verifiedSuccess) {
      successCount += 1
    } else if (step.status !== 'success') {
      failCount += 1
    }
    references.push(`execution:${execution.execution_id}:${step.status}`)
  }

  return { successCount, failCount, evidenceRefs: references.slice(0, 5) }
}

function buildTrustProfile(
  agentId: string,
  capability: RoutingCapability,
  executions: ExecutionLike[],
): AgentTrustProfile {
  const meta = CAPABILITY_META[capability]
  const priorWeight = 3
  const defaultPriorScore = 0.6
  const { successCount, failCount } = summarizeEvidence(agentId, executions)
  const bayesianScore = roundScore(
    ((defaultPriorScore * priorWeight) + successCount) /
    (priorWeight + successCount + failCount)
  )

  return {
    agent_id: agentId,
    task_domain: meta.taskDomain,
    success_count: successCount,
    fail_count: failCount,
    bayesian_score: bayesianScore,
    prior_weight: priorWeight,
    default_prior_score: defaultPriorScore,
    evidence_source: successCount + failCount > 0 ? 'runtime_readback' : 'decision_quality_scorecard',
    scorecard_dimension: meta.trustDimension,
    scope_owner: 'widgetdc-orchestrator',
    last_verified_at: new Date().toISOString(),
  }
}

function sortProfiles(profiles: AgentTrustProfile[]): AgentTrustProfile[] {
  return [...profiles].sort((left, right) => {
    if (right.bayesian_score !== left.bayesian_score) {
      return right.bayesian_score - left.bayesian_score
    }
    return AgentRegistry.getActiveCalls(left.agent_id) - AgentRegistry.getActiveCalls(right.agent_id)
  })
}

function buildWorkflowEnvelope(
  workflowId: string,
  intent: RoutingIntent,
  selectedAgentId: string,
  routeScope: RouteScope[],
): AgentWorkflowEnvelope {
  const meta = CAPABILITY_META[intent.capability]
  const participants = Array.from(new Set(['master', selectedAgentId]))

  return {
    workflow_id: workflowId,
    workflow_type: meta.workflowType,
    current_phase: meta.workflowPhase,
    participants,
    primary_surface: routeScope.includes('widgetdc-librechat') ? 'widgetdc-librechat' : routeScope[0],
    flow_ref: meta.flowRef,
    scorecard_ref: 'LIN-261',
    reasoning_lineage_visible: intent.operator_visible,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function rememberDecision(decision: RoutingDecision): void {
  recentRoutingDecisions.unshift(decision)
  if (recentRoutingDecisions.length > 50) {
    recentRoutingDecisions.length = 50
  }
}

export function resolveRoutingDecision(input: RoutingResolutionInput): RoutingResolution {
  const routeScope: RouteScope[] = input.routeScope && input.routeScope.length > 0
    ? [...input.routeScope]
    : ['widgetdc-orchestrator']
  const operatorVisible = input.operatorVisible ?? true
  const capability = input.capabilityHint ?? inferCapabilityFromMessage(input.message)
  const recentExecutions = input.recentExecutions ?? []
  const intent = buildIntent(capability, routeScope, operatorVisible)
  const candidates = getCandidateAgents(capability)
  const fallbackAgents = candidates.length > 0 ? candidates : ['rlm']
  const trustProfiles = sortProfiles(
    fallbackAgents.map(agentId => buildTrustProfile(agentId, capability, recentExecutions))
  )
  const selectedProfile = trustProfiles[0]
  const workflowId = input.workflowId ?? `workflow-${uuid().slice(0, 8)}`
  const evidenceRefs = [
    ...summarizeEvidence(selectedProfile.agent_id, recentExecutions).evidenceRefs,
    `scorecard:LIN-261:${intent.capability}`,
  ]

  const decision: RoutingDecision = {
    decision_id: `route-${uuid().slice(0, 8)}`,
    intent,
    selected_agent_id: selectedProfile.agent_id,
    selected_capability: capability,
    trust_score: selectedProfile.bayesian_score,
    reason_code: candidates.length > 0 && selectedProfile.success_count + selectedProfile.fail_count > 0
      ? 'TRUST_WIN'
      : candidates.length > 0
        ? 'FLOW_SPECIALIZATION'
        : 'FALLBACK_ROUTE',
    evidence_refs: evidenceRefs.slice(0, 6),
    ...(candidates.length > 0 ? {} : { waiver_reason: 'No capability-specific agent was registered; defaulted to rlm.' }),
    decided_at: new Date().toISOString(),
  }

  rememberDecision(decision)

  return {
    selectedAgentId: selectedProfile.agent_id,
    intent,
    trustProfiles,
    decision,
    workflowEnvelope: buildWorkflowEnvelope(workflowId, intent, selectedProfile.agent_id, routeScope),
  }
}

export function getRecentRoutingDecisions(): RoutingDecision[] {
  return [...recentRoutingDecisions]
}

// ─── Complexity Escalation (Inventor complexity-routing-v2, score 0.78) ─────
//
// Decision table: given a query, determine the optimal chain mode and token
// budget. Target: push platform complexity KPI from 1.26 toward 3.0.
//
// Escalation triggers (ordered, first match wins):
//   1. Ambiguity > 0.70  → adaptive   (multi-perspective verification)
//   2. Debate signals     → debate     (two agents argue, third synthesizes)
//   3. Multi-task signals → parallel   (independent sub-tasks fan-out)
//   4. Default            → sequential (simple pipeline)

export type EscalatedChainMode = 'sequential' | 'parallel' | 'debate' | 'adaptive'

export interface ComplexityEscalation {
  mode: EscalatedChainMode
  ambiguityScore: number
  complexityBand: 'low' | 'medium' | 'high'
  tokenBudget: number
  escalationReason: string
  verificationStepsRecommended: number
}

/** Signals that a query contains multiple independent sub-tasks */
const PARALLEL_SIGNALS = [
  'and also', 'as well as', 'additionally', 'in parallel',
  'at the same time', 'simultaneously', 'both', 'all of the following',
]

/** Signals that a query requires argumentative evaluation */
const DEBATE_SIGNALS = [
  'compare', 'evaluate', 'pros and cons', 'trade-off', 'tradeoff',
  'best approach', 'vs', 'versus', 'which is better', 'should we',
  'recommend', 'decision', 'choose between', 'assess',
]

/** High-entropy words that raise the ambiguity score */
const AMBIGUITY_SIGNALS = [
  'might', 'could', 'unclear', 'unsure', 'complex', 'complicated',
  'depends', 'multiple', 'various', 'several', 'ambiguous',
  'uncertain', 'explore', 'investigate', 'analyze', 'deep',
  'comprehensive', 'thorough', 'all aspects', 'fully',
]

function scoreAmbiguity(message: string): number {
  const text = message.toLowerCase()
  const wordCount = text.split(/\s+/).length
  const hits = AMBIGUITY_SIGNALS.filter(s => text.includes(s)).length
  // Normalize: 3+ hits in a short message → near 1.0; scale down for long messages
  const rawScore = Math.min(hits / Math.max(wordCount / 15, 1), 1.0)
  return Math.round(rawScore * 100) / 100
}

export function resolveChainMode(message: string): ComplexityEscalation {
  const text = message.toLowerCase()
  const ambiguityScore = scoreAmbiguity(message)

  // Threshold 1: high ambiguity → adaptive
  if (ambiguityScore >= 0.70) {
    return {
      mode: 'adaptive',
      ambiguityScore,
      complexityBand: 'high',
      tokenBudget: 2000,
      escalationReason: `Ambiguity score ${ambiguityScore} ≥ 0.70 — adaptive multi-perspective verification`,
      verificationStepsRecommended: 3,
    }
  }

  // Threshold 2: debate signals → debate
  const hasDebateSignal = DEBATE_SIGNALS.some(s => text.includes(s))
  if (hasDebateSignal) {
    return {
      mode: 'debate',
      ambiguityScore,
      complexityBand: ambiguityScore >= 0.40 ? 'high' : 'medium',
      tokenBudget: 1500,
      escalationReason: `Debate signals detected — two-agent argument + synthesis`,
      verificationStepsRecommended: 2,
    }
  }

  // Threshold 3: parallel sub-tasks → parallel
  const hasParallelSignal = PARALLEL_SIGNALS.some(s => text.includes(s))
  if (hasParallelSignal) {
    return {
      mode: 'parallel',
      ambiguityScore,
      complexityBand: 'medium',
      tokenBudget: 1000,
      escalationReason: `Parallel sub-task signals detected — fan-out execution`,
      verificationStepsRecommended: 1,
    }
  }

  // Default: sequential
  return {
    mode: 'sequential',
    ambiguityScore,
    complexityBand: ambiguityScore >= 0.25 ? 'medium' : 'low',
    tokenBudget: 500,
    escalationReason: 'No escalation triggers — single-pass sequential chain',
    verificationStepsRecommended: 0,
  }
}

export function buildRoutingDashboardData(recentExecutions: ExecutionLike[]): {
  recentDecisions: RoutingDecision[]
  topTrustProfiles: AgentTrustProfile[]
} {
  const allProfiles = (Object.keys(CAPABILITY_CANDIDATES) as RoutingCapability[]).flatMap(capability => {
    const profiles = getCandidateAgents(capability).map(agentId => buildTrustProfile(agentId, capability, recentExecutions))
    return sortProfiles(profiles).slice(0, 2)
  })

  return {
    recentDecisions: getRecentRoutingDecisions().slice(0, 10),
    topTrustProfiles: allProfiles,
  }
}
