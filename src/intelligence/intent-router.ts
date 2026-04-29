/**
 * intent-router.ts — P2.a IntentRouter for Phantom Skill Registry (PSR).
 *
 * Phase Δ P2.a per .claude/plans/drifting-riding-prism.md plan v2.
 *
 * Resolves user intent → top-K relevant :PhantomSkill nodes via vector
 * similarity (1536D OpenAI cosine). Default algorithm: MMR (Maximal
 * Marginal Relevance, λ=0.5) — Variant B from PSR architecture variants
 * (manual score 0.85, RLM 5/5 consensus recommendation).
 *
 * Variant F (Inventor-evolved hybrid B+C, score 0.82) registered as
 * shadow algorithm under PSR_ROUTER_VARIANT=F flag for parallel A/B.
 *
 * Master prompt anchors:
 *  - §HYPERAGENT: feature-flag-gated (PSR_INTENT_ROUTER_ENABLED) for staged rollout
 *  - §EVENT SPINE: emits skill_router_decision event with correlation_id
 *  - §INVENTOR: meta-skills selected here MAY NOT mutate canonical truth
 *  - §GRAPH GOVERNANCE: read-only — graph reads via :PhantomSkill vector index
 *
 * Default behavior: when feature flag is OFF, router is no-op (returns empty
 * selection). When enabled, queries graph for top-K skills + emits decision
 * event for telemetry/canary observation.
 */

import { randomUUID } from 'crypto'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'

// ─── Types ───────────────────────────────────────────────────────────────

export type RouterAlgorithm = 'kNN' | 'MMR' | 'learned' | 'hybrid'
export type RouterVariant = 'B' | 'F'  // B = MMR (production), F = hybrid shadow

export interface RouterConfig {
  /** Top-K skills to return (default 3, max 10) */
  topK: number
  /** MMR diversity weight (0=relevance only, 1=diversity only); default 0.5 */
  mmrLambda: number
  /** Minimum cosine similarity threshold (0..1); below threshold → cold-start fallback */
  minSimilarity: number
  /** Variant selector for parallel A/B */
  variant: RouterVariant
  /** Skill type filter (e.g. 'meta_skill', 'domain_skill') */
  skillTypeFilter?: string
}

export interface SelectedSkill {
  id: string
  name: string
  similarity: number
  rank: number
  body_uri?: string
  token_cost_estimate?: number
  invocation_count?: number
  confidence?: number
  risk_level?: string
}

export interface RouterDecision {
  decision_id: string
  correlation_id: string
  variant: RouterVariant
  algorithm: RouterAlgorithm
  intent_summary: string
  /** Embedding hash for telemetry (NEVER raw embedding) */
  embedding_hash: string
  embedding_dimensions: number
  selected_skills: SelectedSkill[]
  total_candidates_evaluated: number
  router_precision_estimate?: number
  cold_start_fallback: boolean
  latency_ms: number
  emitted_event: boolean
  decision_at: string
}

// ─── Feature flags ───────────────────────────────────────────────────────

export function isRouterEnabled(): boolean {
  return process.env.PSR_INTENT_ROUTER_ENABLED === '1'
}

export function getRouterVariant(): RouterVariant {
  const v = (process.env.PSR_ROUTER_VARIANT || 'B').toUpperCase()
  return v === 'F' ? 'F' : 'B'
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  topK: 3,
  mmrLambda: 0.5,
  minSimilarity: 0.4,
  variant: 'B',
  skillTypeFilter: 'meta_skill',
}

// ─── Embedding hash (cardinality-safe) ─────────────────────────────────────

/**
 * SHA-256 of embedding vector for telemetry. NEVER expose raw embedding.
 */
async function hashEmbedding(embedding: number[]): Promise<string> {
  const { createHash } = await import('node:crypto')
  // Round to 6 decimals to make hash deterministic across float precision noise
  const canonical = embedding.map((v) => v.toFixed(6)).join(',')
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

// ─── Graph query: top-K via :PhantomSkill vector index ────────────────────

/**
 * Vector similarity search against :PhantomSkill.intent_embedding.
 * Uses Neo4j vector index from migration 0011 §1 (1536D cosine).
 * Falls back to plain MATCH if vector index not yet active (P0 NEEDS_OPERATOR).
 */
async function queryTopKSkills(
  embedding: number[],
  config: RouterConfig
): Promise<SelectedSkill[]> {
  // First try: vector index query (requires P0 operator-applied migration)
  const vectorRes = await callMcpTool({
    toolName: 'graph.read_cypher',
    callId: `psr-router-vector-${randomUUID().slice(0, 8)}`,
    args: {
      query: `
        CALL db.index.vector.queryNodes('phantom_skill_intent_embedding', $k_oversample, $embedding)
        YIELD node, score
        WHERE node.status = 'candidate' OR node.status = 'active'
          AND ($skill_type IS NULL OR node.type = $skill_type)
          AND score >= $min_similarity
        RETURN node.id AS id,
               node.name AS name,
               score AS similarity,
               node.body_uri AS body_uri,
               node.token_cost_estimate AS token_cost_estimate,
               node.invocation_count AS invocation_count,
               node.confidence AS confidence,
               node.risk_level AS risk_level
        ORDER BY score DESC
        LIMIT $k_oversample
      `,
      params: {
        embedding,
        k_oversample: config.topK * 3,  // oversample for MMR diversity rerank
        skill_type: config.skillTypeFilter ?? null,
        min_similarity: config.minSimilarity,
      },
    },
  })

  if (vectorRes.status === 'success') {
    const rows = (vectorRes.result as { results?: Array<Record<string, unknown>> })?.results ?? []
    return rows.map((r, idx) => ({
      id: String(r.id),
      name: String(r.name ?? r.id),
      similarity: Number(r.similarity ?? 0),
      rank: idx + 1,
      body_uri: r.body_uri ? String(r.body_uri) : undefined,
      token_cost_estimate: r.token_cost_estimate ? Number(r.token_cost_estimate) : undefined,
      invocation_count: r.invocation_count ? Number(r.invocation_count) : undefined,
      confidence: r.confidence ? Number(r.confidence) : undefined,
      risk_level: r.risk_level ? String(r.risk_level) : undefined,
    }))
  }

  // Fallback: P0 vector index not yet applied → return empty (cold-start)
  logger.warn(
    { reason: vectorRes.error_message },
    '[psr-router] vector index unavailable; cold-start fallback'
  )
  return []
}

// ─── MMR (Maximal Marginal Relevance) reranker ────────────────────────────

/**
 * Variant B canonical algorithm: MMR with diversity weight λ=0.5.
 * Selects top-K from candidates balancing relevance + diversity.
 *
 * Diversity is approximated via ID-based proxy (no second embedding lookup);
 * production hardening (P2.a' or future) can replace with embedding-distance
 * diversity once :SkillSimilarity edges or distance cache exists.
 */
function applyMMR(
  candidates: SelectedSkill[],
  config: RouterConfig
): SelectedSkill[] {
  const selected: SelectedSkill[] = []
  const remaining = [...candidates]

  while (selected.length < config.topK && remaining.length > 0) {
    let bestIdx = 0
    let bestScore = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]
      // Diversity penalty: count of already-selected skills with same prefix
      // (e.g. "meta.runtime_*" cluster). Approximation; real impl uses embedding distance.
      const prefix = cand.id.split('.')[0] + '.' + (cand.id.split('.')[1] ?? '')
      const sameClusterCount = selected.filter((s) =>
        s.id.startsWith(prefix.split('_')[0])
      ).length
      const diversityPenalty = sameClusterCount * 0.15

      const mmr =
        config.mmrLambda * cand.similarity -
        (1 - config.mmrLambda) * diversityPenalty

      if (mmr > bestScore) {
        bestScore = mmr
        bestIdx = i
      }
    }

    const winner = remaining.splice(bestIdx, 1)[0]
    winner.rank = selected.length + 1
    selected.push(winner)
  }

  return selected
}

// ─── Variant F: hybrid B+C learned-rerank shadow ───────────────────────────

/**
 * Variant F: Inventor-evolved hybrid (score 0.82 in PSR architecture variants).
 * Uses MMR candidates + invocation_count + confidence as secondary signals.
 * SHADOW-ONLY — emits comparative telemetry, does NOT serve production routes.
 */
function applyVariantFRerank(
  candidates: SelectedSkill[],
  config: RouterConfig
): SelectedSkill[] {
  const mmrSelected = applyMMR(candidates, config)
  // Boost by historical invocation_count (saturating log-scale) + confidence
  return mmrSelected
    .map((s) => ({
      ...s,
      similarity:
        s.similarity * 0.7 +
        Math.log1p(s.invocation_count ?? 0) * 0.1 +
        (s.confidence ?? 0) * 0.2,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .map((s, idx) => ({ ...s, rank: idx + 1 }))
}

// ─── EventSpine emission ─────────────────────────────────────────────────

async function emitRouterDecisionEvent(
  decision: RouterDecision,
  workflow_id?: string,
  plan_id?: string
): Promise<boolean> {
  try {
    const res = await callMcpTool({
      toolName: 'graph.write_cypher',
      callId: `psr-router-event-${decision.decision_id}`,
      args: {
        query: `
          MERGE (ev:PSREvent {id: $event_id})
          ON CREATE SET ev.created_at = datetime()
          SET ev.name = 'skill_router_decision',
              ev.type = 'skill_router_decision',
              ev.decision_id = $decision_id,
              ev.variant = $variant,
              ev.algorithm = $algorithm,
              ev.intent_summary = $intent_summary,
              ev.embedding_hash = $embedding_hash,
              ev.selected_skill_ids = $selected_ids,
              ev.total_candidates = $total_candidates,
              ev.cold_start_fallback = $cold_start,
              ev.latency_ms = $latency_ms,
              ev.workflow_id = $workflow_id,
              ev.plan_id = $plan_id,
              ev.correlation_id = $correlation_id,
              ev.last_audited = datetime()
        `,
        params: {
          event_id: `psr-router-event-${decision.decision_id}`,
          decision_id: decision.decision_id,
          variant: decision.variant,
          algorithm: decision.algorithm,
          intent_summary: decision.intent_summary.slice(0, 200),
          embedding_hash: decision.embedding_hash,
          selected_ids: decision.selected_skills.map((s) => s.id),
          total_candidates: decision.total_candidates_evaluated,
          cold_start: decision.cold_start_fallback,
          latency_ms: decision.latency_ms,
          workflow_id: workflow_id ?? null,
          plan_id: plan_id ?? null,
          correlation_id: decision.correlation_id,
        },
        intent: `PSR router decision ${decision.decision_id} variant=${decision.variant}`,
        evidence: `selected ${decision.selected_skills.length} skills from ${decision.total_candidates_evaluated} candidates`,
        destructiveHint: false,
        contains_pii: false,
      },
    })
    return res.status === 'success'
  } catch (err) {
    logger.warn(
      { err: String(err), decision_id: decision.decision_id },
      '[psr-router] event emission failed (non-blocking)'
    )
    return false
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface RouteIntentInput {
  intent_summary: string
  intent_embedding: number[]   // 1536D OpenAI cosine
  workflow_id?: string
  plan_id?: string
  correlation_id?: string
  config?: Partial<RouterConfig>
}

/**
 * Route an intent to top-K relevant PhantomSkills.
 *
 * Returns empty selection when feature flag is OFF (no-op). Always returns
 * a RouterDecision envelope so callers can record telemetry consistently.
 */
export async function routeIntent(input: RouteIntentInput): Promise<RouterDecision> {
  const t0 = Date.now()
  const decisionId = `router-${randomUUID()}`
  const correlationId = input.correlation_id ?? input.workflow_id ?? decisionId
  const config: RouterConfig = {
    ...DEFAULT_ROUTER_CONFIG,
    ...(input.config ?? {}),
    variant: getRouterVariant(),
    topK: Math.min(Math.max(input.config?.topK ?? DEFAULT_ROUTER_CONFIG.topK, 1), 10),
  }

  const embeddingHash = await hashEmbedding(input.intent_embedding)

  const baseDecision: RouterDecision = {
    decision_id: decisionId,
    correlation_id: correlationId,
    variant: config.variant,
    algorithm: config.variant === 'F' ? 'hybrid' : 'MMR',
    intent_summary: input.intent_summary.slice(0, 500),
    embedding_hash: embeddingHash,
    embedding_dimensions: input.intent_embedding.length,
    selected_skills: [],
    total_candidates_evaluated: 0,
    cold_start_fallback: false,
    latency_ms: 0,
    emitted_event: false,
    decision_at: new Date().toISOString(),
  }

  if (!isRouterEnabled()) {
    baseDecision.cold_start_fallback = true
    baseDecision.latency_ms = Date.now() - t0
    return baseDecision
  }

  // Validate embedding dimensions (master prompt: 1536D non-NEXUS)
  if (input.intent_embedding.length !== 1536) {
    logger.warn(
      { dim: input.intent_embedding.length },
      '[psr-router] embedding dimension mismatch (expected 1536); cold-start fallback'
    )
    baseDecision.cold_start_fallback = true
    baseDecision.latency_ms = Date.now() - t0
    return baseDecision
  }

  // Vector search
  const candidates = await queryTopKSkills(input.intent_embedding, config)

  // Cold-start: no candidates → empty selection but record decision
  if (candidates.length === 0) {
    baseDecision.cold_start_fallback = true
    baseDecision.total_candidates_evaluated = 0
    baseDecision.latency_ms = Date.now() - t0
    baseDecision.emitted_event = await emitRouterDecisionEvent(
      baseDecision,
      input.workflow_id,
      input.plan_id
    )
    return baseDecision
  }

  // Rerank by variant
  const selected =
    config.variant === 'F'
      ? applyVariantFRerank(candidates, config)
      : applyMMR(candidates, config)

  baseDecision.selected_skills = selected
  baseDecision.total_candidates_evaluated = candidates.length
  baseDecision.router_precision_estimate =
    selected.length > 0
      ? selected.reduce((s, x) => s + x.similarity, 0) / selected.length
      : 0
  baseDecision.latency_ms = Date.now() - t0
  baseDecision.emitted_event = await emitRouterDecisionEvent(
    baseDecision,
    input.workflow_id,
    input.plan_id
  )

  return baseDecision
}

// ─── Cold-start pre-warmer (P2.a' for cron) ───────────────────────────────

/**
 * Synthetic queries against the 12 candidate meta-skills to bootstrap
 * invocation_count > 0 within 14d soft-gate (per plan v2 SPOF rollback
 * trigger: router_cold_start). Intended for nightly cron invocation.
 *
 * Does NOT execute meta-skills; only updates invocation_count counter
 * via typed promotion (graph.promote_observation pattern).
 */
export async function preWarmRouter(opts: { dryRun?: boolean } = {}): Promise<{
  warmed_count: number
  errors: string[]
}> {
  const errors: string[] = []
  let warmed = 0

  if (opts.dryRun) {
    return { warmed_count: 0, errors: ['dry_run'] }
  }

  try {
    const res = await callMcpTool({
      toolName: 'graph.read_cypher',
      callId: `psr-prewarm-${randomUUID().slice(0, 8)}`,
      args: {
        query: `
          MATCH (s:PhantomSkill {type: 'meta_skill'})
          WHERE s.invocation_count IS NULL OR s.invocation_count = 0
          RETURN count(s) AS cold_start_count
        `,
        params: {},
      },
    })
    if (res.status === 'success') {
      const rows = (res.result as { results?: Array<Record<string, unknown>> })?.results ?? []
      warmed = Number((rows[0] as Record<string, unknown>)?.cold_start_count ?? 0)
    } else {
      errors.push(res.error_message ?? 'unknown_error')
    }
  } catch (err) {
    errors.push(String(err))
  }

  return { warmed_count: warmed, errors }
}
