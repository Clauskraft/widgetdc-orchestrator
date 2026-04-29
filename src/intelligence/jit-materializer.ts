/**
 * jit-materializer.ts — P2.b JIT Materializer for Phantom Skill Registry (PSR).
 *
 * Phase Δ P2.b per .claude/plans/drifting-riding-prism.md plan v2.
 *
 * Consumes routeIntent() output (top-K selected PhantomSkills) and:
 *   1. Loads skill bodies via body_uri (or :PhantomSkill.body property)
 *   2. Returns assembled context block ready for LLM prompt injection
 *   3. Creates :SkillMaterialization node with provenance edges:
 *        (PhantomBOMRun)-[:MATERIALIZED_SKILL]->(SkillMaterialization)
 *        (SkillMaterialization)-[:USES_SKILL]->(PhantomSkill)         (per selected)
 *        (SkillMaterialization)-[:PRODUCES_CONTEXT]->(WorkArtifact)   (A6-v2 invariant)
 *
 * Master prompt anchors:
 *  - §HYPERAGENT: feature-flag-gated (PSR_JIT_MATERIALIZER_ENABLED) for staged rollout
 *  - §EVENT SPINE: emits skill_materialized event with correlation_id
 *  - §A6-v2 (PHANTOM PRINCIPLES.3): :PRODUCES_CONTEXT edge MUST be created
 *    for every materialization (extends A6-v2 invariant from BOMRun→WorkArtifact)
 *  - §INVENTOR: meta-skills materialized here MAY NOT mutate canonical truth
 *  - §SECURITY: skill body contents never logged at warn/info; hashes only
 *
 * Default behavior: when feature flag is OFF, no-op materialization (returns
 * empty context). When enabled, materializes skills + emits typed lineage.
 */

import { randomUUID, createHash } from 'crypto'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'
import type { SelectedSkill, RouterDecision } from './intent-router.js'

// ─── Types ───────────────────────────────────────────────────────────────

export interface MaterializerConfig {
  /** Maximum total tokens of materialized skill bodies (default 9000 = ~3K x 3 skills) */
  maxTotalTokens: number
  /** Per-skill body fetch timeout (ms) */
  perSkillFetchTimeoutMs: number
  /** Whether to emit :SkillMaterialization graph node (default true) */
  emitLineage: boolean
  /** Whether to emit skill_materialized EventSpine event (default true) */
  emitEvent: boolean
}

export interface MaterializedSkill {
  skill_id: string
  skill_name: string
  body: string                 // The skill body text
  body_token_estimate: number  // ceil(body.length / 4)
  body_hash: string            // sha256:16-char prefix (for telemetry, not raw)
  rank: number
  similarity: number
  fetched_from: 'graph_property' | 'body_uri' | 'fallback_empty'
  fetch_latency_ms: number
}

export interface MaterializationResult {
  materialization_id: string
  correlation_id: string
  workflow_id?: string
  plan_id?: string
  /** Bound to PhantomBOMRun if known */
  phantom_bom_run_id?: string
  /** Bound to WorkArtifact if known (A6-v2 invariant) */
  workartifact_id?: string
  /** Decision id from IntentRouter */
  router_decision_id: string
  router_variant: 'B' | 'F'
  /** Materialized skills (subset of router selection if budget exceeded) */
  materialized_skills: MaterializedSkill[]
  /** Skills excluded due to budget */
  excluded_skills: SelectedSkill[]
  /** Concatenated context block ready for LLM prompt */
  context_block: string
  /** Total tokens of materialized bodies */
  total_tokens: number
  /** Was budget exceeded forcing exclusions */
  budget_exhausted: boolean
  total_fetch_latency_ms: number
  total_materialization_latency_ms: number
  emitted_lineage: boolean
  emitted_event: boolean
  feature_flag_enabled: boolean
  materialized_at: string
}

// ─── Feature flags ─────────────────────────────────────────────────────────

export function isJITEnabled(): boolean {
  return process.env.PSR_JIT_MATERIALIZER_ENABLED === '1'
}

export const DEFAULT_MATERIALIZER_CONFIG: MaterializerConfig = {
  maxTotalTokens: 9000,
  perSkillFetchTimeoutMs: 5000,
  emitLineage: true,
  emitEvent: true,
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Estimate token count from text. Conservative: ceil(chars / 4).
 * Master prompt §COST GOVERNANCE: caller should also track this in
 * TokenTelemetry.context_saved_tokens.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function hashBody(body: string): string {
  return 'sha256:' + createHash('sha256').update(body).digest('hex').slice(0, 16)
}

// ─── Skill body fetcher ───────────────────────────────────────────────────

/**
 * Fetch skill body from PhantomSkill node. Strategy (priority order):
 *   1. node.body property (inline body, preferred for short skills)
 *   2. node.body_uri pointer (fs:// or vault://; resolved via lookup helper)
 *   3. fallback: empty body, log warn
 *
 * Returns the body + provenance + latency.
 */
async function fetchSkillBody(
  skillId: string,
  timeoutMs: number
): Promise<{ body: string; from: MaterializedSkill['fetched_from']; latencyMs: number }> {
  const t0 = Date.now()
  const res = await callMcpTool({
    toolName: 'graph.read_cypher',
    callId: `psr-jit-fetch-${skillId.slice(0, 16)}-${Date.now()}`,
    args: {
      query: `
        MATCH (s:PhantomSkill {id: $id})
        RETURN s.body AS body,
               s.body_uri AS body_uri,
               s.name AS name
      `,
      params: { id: skillId },
    },
  })
  const latencyMs = Date.now() - t0

  if (res.status !== 'success') {
    logger.warn(
      { skillId, error: res.error_message },
      '[psr-jit] failed to fetch skill body; using fallback empty'
    )
    return { body: '', from: 'fallback_empty', latencyMs }
  }

  const rows = (res.result as { results?: Array<Record<string, unknown>> })?.results ?? []
  const row = rows[0]
  if (!row) {
    return { body: '', from: 'fallback_empty', latencyMs }
  }

  // Prefer inline body
  if (typeof row.body === 'string' && row.body.length > 0) {
    return { body: row.body, from: 'graph_property', latencyMs }
  }

  // Fallback: body_uri pointer
  const bodyUri = typeof row.body_uri === 'string' ? row.body_uri : null
  if (bodyUri && bodyUri !== 'pending') {
    // P2.b' future: resolve fs://, vault:// URIs.
    // For v0, treat unresolved URI as fallback.
    logger.warn(
      { skillId, body_uri: bodyUri },
      '[psr-jit] body_uri resolution not implemented in v0; fallback empty'
    )
    return { body: '', from: 'fallback_empty', latencyMs }
  }

  return { body: '', from: 'fallback_empty', latencyMs }
}

// ─── Lineage emission (graph nodes + edges) ───────────────────────────────

/**
 * Create :SkillMaterialization node + USES_SKILL + PRODUCES_CONTEXT edges
 * (A6-v2 invariant). MATERIALIZED_SKILL edge from PhantomBOMRun is created
 * separately when the bom_run_id is known (via materializeContext caller).
 */
async function emitMaterializationLineage(
  result: MaterializationResult
): Promise<boolean> {
  if (!result.feature_flag_enabled) return false
  if (result.materialized_skills.length === 0) return false

  try {
    const res = await callMcpTool({
      toolName: 'graph.write_cypher',
      callId: `psr-jit-lineage-${result.materialization_id}`,
      args: {
        query: `
          MERGE (m:SkillMaterialization {id: $materialization_id})
          ON CREATE SET m.created_at = datetime()
          SET m.name                     = $materialization_id,
              m.session_id               = $correlation_id,
              m.workflow_id              = $workflow_id,
              m.plan_id                  = $plan_id,
              m.router_decision_id       = $router_decision_id,
              m.router_variant           = $router_variant,
              m.selected_skill_ids       = $skill_ids,
              m.total_tokens             = $total_tokens,
              m.budget_exhausted         = $budget_exhausted,
              m.materialization_latency_ms = $latency_ms,
              m.correlation_id           = $correlation_id,
              m.last_audited             = datetime()
          WITH m
          UNWIND $skill_ids AS skill_id
          MATCH (s:PhantomSkill {id: skill_id})
          MERGE (m)-[:USES_SKILL]->(s)
          WITH m
          MATCH (run:PhantomBOMRun {id: $phantom_bom_run_id})
          MERGE (run)-[:MATERIALIZED_SKILL]->(m)
          WITH m
          MATCH (wa:WorkArtifact {id: $workartifact_id})
          MERGE (m)-[:PRODUCES_CONTEXT]->(wa)
        `,
        params: {
          materialization_id: result.materialization_id,
          correlation_id: result.correlation_id,
          workflow_id: result.workflow_id ?? null,
          plan_id: result.plan_id ?? null,
          router_decision_id: result.router_decision_id,
          router_variant: result.router_variant,
          skill_ids: result.materialized_skills.map((s) => s.skill_id),
          total_tokens: result.total_tokens,
          budget_exhausted: result.budget_exhausted,
          latency_ms: result.total_materialization_latency_ms,
          phantom_bom_run_id: result.phantom_bom_run_id ?? '__no_run__',
          workartifact_id: result.workartifact_id ?? '__no_artifact__',
        },
        intent: `PSR JIT materialization ${result.materialization_id} for router=${result.router_decision_id}`,
        evidence: `materialized ${result.materialized_skills.length} skills, ${result.total_tokens} tokens`,
        destructiveHint: false,
        contains_pii: false,
      },
    })
    return res.status === 'success'
  } catch (err) {
    logger.warn(
      { err: String(err), materialization_id: result.materialization_id },
      '[psr-jit] lineage emission failed (non-blocking)'
    )
    return false
  }
}

async function emitSkillMaterializedEvent(
  result: MaterializationResult
): Promise<boolean> {
  try {
    const res = await callMcpTool({
      toolName: 'graph.write_cypher',
      callId: `psr-jit-event-${result.materialization_id}`,
      args: {
        query: `
          MERGE (ev:PSREvent {id: $event_id})
          ON CREATE SET ev.created_at = datetime()
          SET ev.name                = 'skill_materialized',
              ev.type                = 'skill_materialized',
              ev.materialization_id  = $materialization_id,
              ev.router_decision_id  = $router_decision_id,
              ev.router_variant      = $router_variant,
              ev.selected_skill_ids  = $skill_ids,
              ev.materialized_count  = $count,
              ev.excluded_count      = $excluded,
              ev.total_tokens        = $total_tokens,
              ev.budget_exhausted    = $budget_exhausted,
              ev.latency_ms          = $latency_ms,
              ev.feature_flag_enabled = $enabled,
              ev.workflow_id         = $workflow_id,
              ev.plan_id             = $plan_id,
              ev.correlation_id      = $correlation_id,
              ev.last_audited        = datetime()
        `,
        params: {
          event_id: `psr-jit-event-${result.materialization_id}`,
          materialization_id: result.materialization_id,
          router_decision_id: result.router_decision_id,
          router_variant: result.router_variant,
          skill_ids: result.materialized_skills.map((s) => s.skill_id),
          count: result.materialized_skills.length,
          excluded: result.excluded_skills.length,
          total_tokens: result.total_tokens,
          budget_exhausted: result.budget_exhausted,
          latency_ms: result.total_materialization_latency_ms,
          enabled: result.feature_flag_enabled,
          workflow_id: result.workflow_id ?? null,
          plan_id: result.plan_id ?? null,
          correlation_id: result.correlation_id,
        },
        intent: `PSR skill_materialized event for ${result.materialization_id}`,
        evidence: `${result.materialized_skills.length}/${result.materialized_skills.length + result.excluded_skills.length} skills materialized`,
        destructiveHint: false,
        contains_pii: false,
      },
    })
    return res.status === 'success'
  } catch (err) {
    logger.warn(
      { err: String(err), materialization_id: result.materialization_id },
      '[psr-jit] event emission failed (non-blocking)'
    )
    return false
  }
}

// ─── Public API: materializeContext ───────────────────────────────────────

export interface MaterializeContextInput {
  /** Decision from IntentRouter */
  decision: RouterDecision
  workflow_id?: string
  plan_id?: string
  correlation_id?: string
  phantom_bom_run_id?: string
  workartifact_id?: string
  config?: Partial<MaterializerConfig>
}

/**
 * Materialize the top-K skills from a RouterDecision into an injectable
 * context block. Honors PSR_JIT_MATERIALIZER_ENABLED feature flag (default OFF).
 *
 * Returns empty context_block when disabled (no-op safe default). Always
 * returns a MaterializationResult envelope for telemetry consistency.
 */
export async function materializeContext(
  input: MaterializeContextInput
): Promise<MaterializationResult> {
  const t0 = Date.now()
  const config: MaterializerConfig = {
    ...DEFAULT_MATERIALIZER_CONFIG,
    ...(input.config ?? {}),
  }
  const enabled = isJITEnabled()
  const materializationId = `materialization-${randomUUID()}`
  const correlationId = input.correlation_id ?? input.workflow_id ?? input.decision.correlation_id

  const baseResult: MaterializationResult = {
    materialization_id: materializationId,
    correlation_id: correlationId,
    workflow_id: input.workflow_id,
    plan_id: input.plan_id,
    phantom_bom_run_id: input.phantom_bom_run_id,
    workartifact_id: input.workartifact_id,
    router_decision_id: input.decision.decision_id,
    router_variant: input.decision.variant,
    materialized_skills: [],
    excluded_skills: [],
    context_block: '',
    total_tokens: 0,
    budget_exhausted: false,
    total_fetch_latency_ms: 0,
    total_materialization_latency_ms: 0,
    emitted_lineage: false,
    emitted_event: false,
    feature_flag_enabled: enabled,
    materialized_at: new Date().toISOString(),
  }

  // No-op when disabled
  if (!enabled) {
    baseResult.total_materialization_latency_ms = Date.now() - t0
    if (config.emitEvent) {
      // Still emit for visibility (records that JIT was reachable but disabled)
      baseResult.emitted_event = await emitSkillMaterializedEvent(baseResult)
    }
    return baseResult
  }

  // No skills selected (cold-start or empty router decision) → no-op
  if (input.decision.selected_skills.length === 0) {
    baseResult.total_materialization_latency_ms = Date.now() - t0
    if (config.emitEvent) {
      baseResult.emitted_event = await emitSkillMaterializedEvent(baseResult)
    }
    return baseResult
  }

  // Fetch bodies for each selected skill (sequential to respect AuraDB rate limits)
  const materialized: MaterializedSkill[] = []
  const excluded: SelectedSkill[] = []
  let totalTokens = 0
  let totalFetchMs = 0

  for (const sel of input.decision.selected_skills) {
    const fetched = await fetchSkillBody(sel.id, config.perSkillFetchTimeoutMs)
    totalFetchMs += fetched.latencyMs
    const tokens = estimateTokens(fetched.body)

    // Budget check
    if (totalTokens + tokens > config.maxTotalTokens) {
      excluded.push(sel)
      continue
    }

    materialized.push({
      skill_id: sel.id,
      skill_name: sel.name,
      body: fetched.body,
      body_token_estimate: tokens,
      body_hash: hashBody(fetched.body),
      rank: sel.rank,
      similarity: sel.similarity,
      fetched_from: fetched.from,
      fetch_latency_ms: fetched.latencyMs,
    })
    totalTokens += tokens
  }

  const budgetExhausted = excluded.length > 0

  // Assemble context block — clear delimiters per skill for prompt injection clarity
  const contextBlock = materialized
    .map(
      (m, idx) =>
        `\n--- skill ${idx + 1}/${materialized.length}: ${m.skill_name} (id=${m.skill_id}, rank=${m.rank}, sim=${m.similarity.toFixed(3)}) ---\n${m.body}`
    )
    .join('\n')

  baseResult.materialized_skills = materialized
  baseResult.excluded_skills = excluded
  baseResult.context_block = contextBlock
  baseResult.total_tokens = totalTokens
  baseResult.budget_exhausted = budgetExhausted
  baseResult.total_fetch_latency_ms = totalFetchMs
  baseResult.total_materialization_latency_ms = Date.now() - t0

  // Emit lineage + event (best-effort, non-blocking)
  if (config.emitLineage) {
    baseResult.emitted_lineage = await emitMaterializationLineage(baseResult)
  }
  if (config.emitEvent) {
    baseResult.emitted_event = await emitSkillMaterializedEvent(baseResult)
  }

  return baseResult
}

// ─── Optional: increment invocation_count on used skills ──────────────────

/**
 * Increment invocation_count counter on materialized PhantomSkills.
 * Called separately (not in materializeContext hot path) to avoid double-write
 * cost. Intended to be invoked from a deferred/batch process or from a
 * downstream success-path emission.
 *
 * Per master prompt §INVENTOR: this is a counter update, not a canonical
 * truth mutation. Counter is annotation, not promotion.
 */
export async function incrementSkillInvocationCounts(
  skillIds: string[]
): Promise<{ updated: number; errors: string[] }> {
  if (skillIds.length === 0) return { updated: 0, errors: [] }
  const errors: string[] = []
  try {
    const res = await callMcpTool({
      toolName: 'graph.write_cypher',
      callId: `psr-jit-incr-${randomUUID().slice(0, 8)}`,
      args: {
        query: `
          UNWIND $ids AS id
          MATCH (s:PhantomSkill {id: id})
          SET s.invocation_count = coalesce(s.invocation_count, 0) + 1,
              s.last_invoked_at = datetime()
          RETURN count(s) AS updated
        `,
        params: { ids: skillIds },
        intent: `PSR JIT invocation_count increment for ${skillIds.length} skills`,
        evidence: 'JIT materialization hot path',
        destructiveHint: false,
        contains_pii: false,
      },
    })
    if (res.status !== 'success') {
      errors.push(res.error_message ?? 'unknown_error')
      return { updated: 0, errors }
    }
    const rows = (res.result as { results?: Array<Record<string, unknown>> })?.results ?? []
    const updated = Number(rows[0]?.updated ?? 0)
    return { updated, errors }
  } catch (err) {
    return { updated: 0, errors: [String(err)] }
  }
}
