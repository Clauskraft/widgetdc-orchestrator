/**
 * token-telemetry.ts — Best-effort emission of :TokenTelemetry graph nodes
 * for PSR (Phantom Skill Registry) ROI measurement.
 *
 * Phase Δ P1.b per `.claude/plans/drifting-riding-prism.md`.
 *
 * Schema: 35 fields = Inventor v6 Variant E "balanced" (32 fields, score 0.85,
 * 1750 bytes/emission) + 3 RLM-mandated additions (compliance_gap_score,
 * rollback_trigger_state, meta_skill_invocation_latency_ms).
 *
 * Design principles:
 * - Best-effort (void-call, NEVER blocks LLM path)
 * - Feature-flag gated: PSR_TELEMETRY_ENABLED=1 to enable
 * - Fail-closed on emission errors → log warn + swallow
 * - Master prompt §EVENT SPINE: correlation_id always required
 * - Master prompt §GRAPH GOVERNANCE: typed promotion via :TokenTelemetry label
 *   (already exempt from write-gate B-5 per PR #96)
 * - Privacy posture: 11 public + 18 aggregate + 6 hashed (NO raw user content)
 * - Cost-of-emission target: <2KB per record (Variant E measured 1750 bytes)
 */

import { randomUUID } from 'crypto'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'

// ─── Schema (Inventor Variant E + 3 RLM additions) ──────────────────────────

export type BudgetLane = 'micro' | 'standard' | 'deep'
export type RouterAlgorithm = 'kNN' | 'MMR' | 'learned' | 'hybrid'
export type RollbackTriggerState =
  | 'none'
  | 'spof_active'
  | 'manual_demote'
  | 'canary_regression'

/**
 * TokenTelemetryRecord — canonical PSR telemetry envelope.
 *
 * Field privacy classes (master prompt §SECURITY):
 *  - public:    identifiers, no user content
 *  - aggregate: numeric metrics, never per-user
 *  - hashed:    sha256 / version-id, never raw embedding or content
 */
export interface TokenTelemetryRecord {
  // ── Core identity (8) ──────────────────────────────────────────────────
  /** UUID per emission */
  id: string
  /** Workflow session — falls back to runId if absent */
  session_id: string
  /** Per-LLM-call run id from llm-proxy */
  run_id: string
  /** Provider name (e.g. 'deepseek', 'anthropic', 'openai-compat') */
  provider: string
  /** Concrete model identifier */
  model: string
  /** prompt + completion tokens */
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number

  // ── Cost (2) ───────────────────────────────────────────────────────────
  estimated_cost_dkk: number
  budget_lane: BudgetLane

  // ── PSR runtime fields (Variant E additions, optional pre-IntentRouter) (6)
  /** PhantomSkill.id list (post-IntentRouter only) */
  selected_skills?: string[]
  router_algorithm?: RouterAlgorithm
  /** ROI baseline before JIT materialization */
  prompt_tokens_before_jit?: number
  /** Post-materialization */
  prompt_tokens_after_jit?: number
  /** Computed delta (pre - post) */
  context_saved_tokens?: number
  fold_triggered?: boolean

  // ── Variant E provenance chain (4) ────────────────────────────────────
  /** Causal chain bridging router → materialization → llm → settle */
  router_decision_id?: string
  materialization_id?: string
  llm_call_id?: string
  /** cost-governance settle id (existing :InferenceSpend bridge) */
  settle_id?: string

  // ── Variant E quality + drift signals (5) ─────────────────────────────
  /** sha256(embedding) — cardinality-safe; NEVER raw embedding */
  embedding_hash?: string
  /** Folding compression ratio (folded_tokens / pre_fold_tokens) */
  fold_compression_ratio?: number
  /** Router top-1 precision against held-out eval (0..1) */
  router_precision?: number
  /** Downstream task success (0..1) — PSR ROI correlation */
  downstream_task_success_rate?: number
  /** Drift marker (0..1, higher = more drift) */
  semantic_drift_score?: number
  cache_hit_rate?: number

  // ── Variant E creation-phase tracking (3) ─────────────────────────────
  meta_skill_invocation_id?: string
  /** sha256(reasoning_chain) — provenance, never raw chain */
  reasoning_chain_hash?: string
  invocation_count?: number

  // ── RLM-mandated additions (3, plan v2) ───────────────────────────────
  /** Compliance gap remediation status [0..1]; 0 = no gap, 1 = full gap */
  compliance_gap_score?: number
  /** Current rollback trigger state */
  rollback_trigger_state?: RollbackTriggerState
  /** P50/P99 invocation latency per meta-skill candidate */
  meta_skill_invocation_latency_ms?: number

  // ── Provenance (master prompt §EVENT SPINE) (4) ───────────────────────
  workflow_id?: string
  plan_id?: string
  /** Master prompt §EVENT SPINE: ALWAYS required */
  correlation_id: string
  /** ISO-8601 timestamp at emission */
  created_at: string
}

// ─── Field privacy classification (audit-ready) ────────────────────────────
/* eslint-disable @typescript-eslint/no-unused-vars */
const FIELD_PRIVACY_CLASSES: Record<keyof TokenTelemetryRecord, 'public' | 'aggregate' | 'hashed'> = {
  // public (identifiers + enums, never user content)
  id: 'public',
  session_id: 'public',
  run_id: 'public',
  provider: 'public',
  model: 'public',
  budget_lane: 'public',
  router_algorithm: 'public',
  fold_triggered: 'public',
  router_decision_id: 'public',
  materialization_id: 'public',
  llm_call_id: 'public',
  settle_id: 'public',
  meta_skill_invocation_id: 'public',
  rollback_trigger_state: 'public',
  workflow_id: 'public',
  plan_id: 'public',
  correlation_id: 'public',
  created_at: 'public',
  // aggregate (metrics, never per-user)
  prompt_tokens: 'aggregate',
  completion_tokens: 'aggregate',
  total_tokens: 'aggregate',
  estimated_cost_dkk: 'aggregate',
  prompt_tokens_before_jit: 'aggregate',
  prompt_tokens_after_jit: 'aggregate',
  context_saved_tokens: 'aggregate',
  fold_compression_ratio: 'aggregate',
  router_precision: 'aggregate',
  downstream_task_success_rate: 'aggregate',
  semantic_drift_score: 'aggregate',
  cache_hit_rate: 'aggregate',
  invocation_count: 'aggregate',
  compliance_gap_score: 'aggregate',
  meta_skill_invocation_latency_ms: 'aggregate',
  // hashed (provenance, never raw)
  selected_skills: 'hashed',
  embedding_hash: 'hashed',
  reasoning_chain_hash: 'hashed',
}
/* eslint-enable @typescript-eslint/no-unused-vars */

// ─── Emission ──────────────────────────────────────────────────────────────

/**
 * Whether telemetry emission is enabled at runtime.
 * Default OFF — must opt-in via PSR_TELEMETRY_ENABLED=1 env var.
 *
 * Per master prompt §HYPERAGENT: feature-flag-gated rollout for staged
 * canary observation before full enable.
 */
export function isTelemetryEnabled(): boolean {
  return process.env.PSR_TELEMETRY_ENABLED === '1'
}

/**
 * Emit a TokenTelemetry record to the graph as :TokenTelemetry node.
 *
 * **Best-effort.** This function MUST NEVER throw — it is called via `void`
 * after settle in the LLM proxy hot path. Failures log warn and swallow.
 *
 * The label `:TokenTelemetry` is already exempted in write-gate B-5
 * (orchestrator/src/write-gate.ts after PR #96).
 */
export async function emitTokenTelemetry(
  record: TokenTelemetryRecord
): Promise<void> {
  if (!isTelemetryEnabled()) return

  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      callId: `psr-telemetry-${record.run_id}`,
      args: {
        query: `MERGE (t:TokenTelemetry {id: $id})
                ON CREATE SET t.created_at = datetime($created_at)
                SET t.session_id                = $session_id,
                    t.run_id                    = $run_id,
                    t.provider                  = $provider,
                    t.model                     = $model,
                    t.prompt_tokens             = $prompt_tokens,
                    t.completion_tokens         = $completion_tokens,
                    t.total_tokens              = $total_tokens,
                    t.estimated_cost_dkk        = $estimated_cost_dkk,
                    t.budget_lane               = $budget_lane,
                    t.selected_skills           = $selected_skills,
                    t.router_algorithm          = $router_algorithm,
                    t.prompt_tokens_before_jit  = $prompt_tokens_before_jit,
                    t.prompt_tokens_after_jit   = $prompt_tokens_after_jit,
                    t.context_saved_tokens      = $context_saved_tokens,
                    t.fold_triggered            = $fold_triggered,
                    t.router_decision_id        = $router_decision_id,
                    t.materialization_id        = $materialization_id,
                    t.llm_call_id               = $llm_call_id,
                    t.settle_id                 = $settle_id,
                    t.embedding_hash            = $embedding_hash,
                    t.fold_compression_ratio    = $fold_compression_ratio,
                    t.router_precision          = $router_precision,
                    t.downstream_task_success_rate = $downstream_task_success_rate,
                    t.semantic_drift_score      = $semantic_drift_score,
                    t.cache_hit_rate            = $cache_hit_rate,
                    t.meta_skill_invocation_id  = $meta_skill_invocation_id,
                    t.reasoning_chain_hash      = $reasoning_chain_hash,
                    t.invocation_count          = $invocation_count,
                    t.compliance_gap_score      = $compliance_gap_score,
                    t.rollback_trigger_state    = $rollback_trigger_state,
                    t.meta_skill_invocation_latency_ms = $meta_skill_invocation_latency_ms,
                    t.workflow_id               = $workflow_id,
                    t.plan_id                   = $plan_id,
                    t.correlation_id            = $correlation_id,
                    t.last_audited              = datetime()`,
        params: normalizeRecord(record),
        intent: `PSR token telemetry emission for run=${record.run_id}`,
        evidence: `provider=${record.provider} model=${record.model} total_tokens=${record.total_tokens}`,
        destructiveHint: false,
        contains_pii: false,
      },
    })
  } catch (err) {
    logger.warn(
      { error: String(err), run_id: record.run_id },
      '[psr-telemetry] emit failed (non-blocking)'
    )
  }
}

/**
 * Build a TokenTelemetryRecord from minimal LLM-proxy context.
 * Optional PSR fields populate later when IntentRouter + JIT materializer ship.
 */
export function buildTelemetryRecord(input: {
  session_id?: string
  run_id: string
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  estimated_cost_dkk?: number
  budget_lane?: BudgetLane
  workflow_id?: string
  plan_id?: string
  correlation_id?: string
  // PSR runtime extensions (optional until IntentRouter + JIT ship):
  selected_skills?: string[]
  router_algorithm?: RouterAlgorithm
  prompt_tokens_before_jit?: number
  prompt_tokens_after_jit?: number
  context_saved_tokens?: number
  fold_triggered?: boolean
  router_decision_id?: string
  materialization_id?: string
  llm_call_id?: string
  settle_id?: string
  embedding_hash?: string
  fold_compression_ratio?: number
  router_precision?: number
  downstream_task_success_rate?: number
  semantic_drift_score?: number
  cache_hit_rate?: number
  meta_skill_invocation_id?: string
  reasoning_chain_hash?: string
  invocation_count?: number
  compliance_gap_score?: number
  rollback_trigger_state?: RollbackTriggerState
  meta_skill_invocation_latency_ms?: number
}): TokenTelemetryRecord {
  const correlation_id = input.correlation_id ?? input.workflow_id ?? input.run_id
  return {
    id: `telemetry-${input.run_id}-${randomUUID().slice(0, 8)}`,
    session_id: input.session_id ?? input.workflow_id ?? input.run_id,
    run_id: input.run_id,
    provider: input.provider,
    model: input.model,
    prompt_tokens: input.prompt_tokens,
    completion_tokens: input.completion_tokens,
    total_tokens: input.prompt_tokens + input.completion_tokens,
    estimated_cost_dkk: input.estimated_cost_dkk ?? 0,
    budget_lane: input.budget_lane ?? 'standard',
    selected_skills: input.selected_skills,
    router_algorithm: input.router_algorithm,
    prompt_tokens_before_jit: input.prompt_tokens_before_jit,
    prompt_tokens_after_jit: input.prompt_tokens_after_jit,
    context_saved_tokens: input.context_saved_tokens,
    fold_triggered: input.fold_triggered,
    router_decision_id: input.router_decision_id,
    materialization_id: input.materialization_id,
    llm_call_id: input.llm_call_id,
    settle_id: input.settle_id,
    embedding_hash: input.embedding_hash,
    fold_compression_ratio: input.fold_compression_ratio,
    router_precision: input.router_precision,
    downstream_task_success_rate: input.downstream_task_success_rate,
    semantic_drift_score: input.semantic_drift_score,
    cache_hit_rate: input.cache_hit_rate,
    meta_skill_invocation_id: input.meta_skill_invocation_id,
    reasoning_chain_hash: input.reasoning_chain_hash,
    invocation_count: input.invocation_count,
    compliance_gap_score: input.compliance_gap_score,
    rollback_trigger_state: input.rollback_trigger_state ?? 'none',
    meta_skill_invocation_latency_ms: input.meta_skill_invocation_latency_ms,
    workflow_id: input.workflow_id,
    plan_id: input.plan_id,
    correlation_id,
    created_at: new Date().toISOString(),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Coerce undefined fields to null for Cypher params.
 * Neo4j Cypher MERGE+SET handles null gracefully (sets field to null);
 * undefined values would otherwise be omitted by JSON.stringify and
 * cause "parameter not found" errors.
 */
function normalizeRecord(record: TokenTelemetryRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    out[k] = v === undefined ? null : v
  }
  return out
}

/**
 * Estimate emission size in bytes (for cost-of-emission monitoring).
 * Useful for observability dashboards: target Variant E's 1750 bytes/record.
 */
export function estimateEmissionBytes(record: TokenTelemetryRecord): number {
  return Buffer.byteLength(JSON.stringify(normalizeRecord(record)), 'utf-8')
}
