/**
 * engagement-engine.ts — v4.0 Engagement Intelligence Engine (EIE)
 *
 * First-class Engagement entities in the graph. Plans consulting projects from
 * precedent using the ~671 knowledge chunks enriched in v3/v4/v5/v6.
 *
 * Four capabilities:
 *   1. create  — Create an Engagement node (Neo4j MERGE + Redis cache + raptor.index)
 *   2. match   — Find similar past engagements via dualChannelRAG
 *   3. plan    — Generate a structured plan (phases, deliverables, risks, skills)
 *              citing graph evidence via the same pipeline as deliverable-engine
 *   4. outcome — Record completion outcome → feeds adaptive-rag Q-learning
 *
 * Synergy contract with StitchLive v4.0 (presentation layer in Open WebUI):
 *   - This engine returns data only. No rendering, no markdown theming.
 *   - StitchLive consumes these endpoints via MCP and renders with fmt_num,
 *     sparkline, DATA_BELOW envelope. Zero frontend work in this repo for MVP.
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from './mcp-caller.js'
import { callCognitiveRaw } from './cognitive-proxy.js'
import { dualChannelRAG } from './dual-rag.js'
import { getRedis } from './redis.js'
import { logger } from './logger.js'
import { sendQLearningReward } from './adaptive-rag.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type EngagementStatus = 'draft' | 'active' | 'completed' | 'cancelled'
export type OutcomeGrade = 'exceeded' | 'met' | 'partial' | 'missed'

export interface Engagement {
  $id: string
  $schema: string
  client: string
  domain: string
  objective: string
  start_date: string // ISO
  target_end_date: string // ISO
  budget_dkk?: number
  team_size?: number
  status: EngagementStatus
  methodology_refs: string[]
  created_at: string
  updated_at: string
}

export interface EngagementOutcome {
  engagement_id: string
  completed_at: string
  actual_end_date: string
  grade: OutcomeGrade
  deliverables_shipped: string[]
  what_went_well: string
  what_went_wrong: string
  precedent_match_accuracy: number // 0-1 — did the top precedent predict the outcome?
  recorded_by: string
}

export interface EngagementMatch {
  engagement_id: string
  title: string
  domain: string
  similarity: number
  match_reasoning: string
  precedent_outcome?: OutcomeGrade
  stale: boolean
}

export interface EngagementPlan {
  engagement_id: string
  generated_at: string
  phases: Array<{
    name: string
    duration_weeks: number
    deliverables: string[]
    methodology: string
  }>
  risks: Array<{
    description: string
    severity: 'high' | 'medium' | 'low'
    mitigation: string
  }>
  required_skills: string[]
  precedents_used: EngagementMatch[]
  total_citations: number
  avg_confidence: number
  generation_ms: number
  // v4.0.3: governance metadata for high-stakes plans
  high_stakes?: boolean
  consensus_proposal_id?: string
  consensus_quorum?: number
  rlm_mission_id?: string
  rlm_steps_executed?: number
  plan_source?: string
}

// ─── Storage ────────────────────────────────────────────────────────────────

const REDIS_PREFIX = 'orchestrator:engagement:'
const REDIS_INDEX = 'orchestrator:engagements:index'
const REDIS_PLAN_PREFIX = 'orchestrator:engagement:plan:'
const TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

const engagementCache = new Map<string, Engagement>()

async function saveEngagement(e: Engagement): Promise<void> {
  engagementCache.set(e.$id, e)
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(`${REDIS_PREFIX}${e.$id}`, JSON.stringify(e), 'EX', TTL_SECONDS)
      await redis.zadd(REDIS_INDEX, Date.now(), e.$id)
    } catch (err) {
      logger.warn({ error: String(err) }, 'Engagement: Redis save failed')
    }
  }
}

export async function getEngagement(id: string): Promise<Engagement | null> {
  const cached = engagementCache.get(id)
  if (cached) return cached
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${REDIS_PREFIX}${id}`)
    if (!raw) return null
    const e = JSON.parse(raw) as Engagement
    engagementCache.set(id, e)
    return e
  } catch {
    return null
  }
}

export async function listEngagements(limit = 20): Promise<Engagement[]> {
  const redis = getRedis()
  if (!redis) return Array.from(engagementCache.values()).slice(0, limit)
  try {
    const ids = await redis.zrevrange(REDIS_INDEX, 0, limit - 1)
    const out: Engagement[] = []
    for (const id of ids) {
      const e = await getEngagement(id)
      if (e) out.push(e)
    }
    return out
  } catch {
    return []
  }
}

// ─── Graph persistence (Neo4j) ──────────────────────────────────────────────

async function mergeEngagementNode(e: Engagement): Promise<void> {
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (eng:Engagement {id: $id})
SET eng.client = $client,
    eng.domain = $domain,
    eng.objective = $objective,
    eng.startDate = $startDate,
    eng.targetEndDate = $targetEndDate,
    eng.status = $status,
    eng.budgetDkk = $budgetDkk,
    eng.teamSize = $teamSize,
    eng.updatedAt = datetime(),
    eng.createdAt = coalesce(eng.createdAt, datetime())
WITH eng
UNWIND $methodologyRefs AS mref
MERGE (m {title: mref})
MERGE (eng)-[:USES_METHODOLOGY]->(m)`,
        params: {
          id: e.$id,
          client: e.client,
          domain: e.domain,
          objective: e.objective.slice(0, 500),
          startDate: e.start_date,
          targetEndDate: e.target_end_date,
          status: e.status,
          budgetDkk: e.budget_dkk ?? 0,
          teamSize: e.team_size ?? 0,
          methodologyRefs: (e.methodology_refs ?? []).slice(0, 10),
        },
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
  } catch (err) {
    logger.warn({ id: e.$id, error: String(err) }, 'Engagement: Neo4j MERGE failed (non-fatal)')
  }
}

async function mergeOutcomeNode(o: EngagementOutcome): Promise<void> {
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MATCH (eng:Engagement {id: $engId})
MERGE (out:EngagementOutcome {engagementId: $engId})
SET out.grade = $grade,
    out.completedAt = datetime($completedAt),
    out.actualEndDate = $actualEndDate,
    out.whatWentWell = $wellText,
    out.whatWentWrong = $wrongText,
    out.precedentAccuracy = $precAcc,
    out.recordedBy = $recordedBy,
    out.updatedAt = datetime()
MERGE (eng)-[:HAS_OUTCOME]->(out)
SET eng.status = 'completed'`,
        params: {
          engId: o.engagement_id,
          grade: o.grade,
          completedAt: o.completed_at,
          actualEndDate: o.actual_end_date,
          wellText: o.what_went_well.slice(0, 1000),
          wrongText: o.what_went_wrong.slice(0, 1000),
          precAcc: o.precedent_match_accuracy,
          recordedBy: o.recorded_by,
        },
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
  } catch (err) {
    logger.warn({ id: o.engagement_id, error: String(err) }, 'Engagement outcome: Neo4j MERGE failed')
  }
}

// ─── raptor.index for RAG-integrated precedent storage ──────────────────────

async function indexEngagementForPrecedent(e: Engagement): Promise<void> {
  const content = `Consulting engagement: ${e.objective}. Client domain: ${e.domain}. ` +
    `Duration: ${e.start_date} to ${e.target_end_date}. ` +
    `Team size: ${e.team_size ?? 'unspecified'}. ` +
    `Methodologies: ${(e.methodology_refs ?? []).join(', ') || 'none specified'}.`
  try {
    await callMcpTool({
      toolName: 'raptor.index',
      args: {
        content,
        metadata: {
          title: `Engagement: ${e.client} — ${e.objective.slice(0, 60)}`,
          domain: 'Engagement',
          engagement_id: e.$id,
          type: 'engagement',
        },
        orgId: 'default',
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 15000,
    })
  } catch (err) {
    logger.warn({ id: e.$id, error: String(err) }, 'Engagement: raptor.index failed (non-fatal)')
  }
}

// ─── Capability 1: create ────────────────────────────────────────────────────

export interface CreateEngagementRequest {
  client: string
  domain: string
  objective: string
  start_date: string
  target_end_date: string
  budget_dkk?: number
  team_size?: number
  methodology_refs?: string[]
}

export async function createEngagement(req: CreateEngagementRequest): Promise<Engagement> {
  const now = new Date().toISOString()
  const e: Engagement = {
    $id: `eng-${uuid()}`,
    $schema: 'https://widgetdc.io/schemas/engagement/v1',
    client: req.client.slice(0, 120),
    domain: req.domain.slice(0, 60),
    objective: req.objective.slice(0, 500),
    start_date: req.start_date,
    target_end_date: req.target_end_date,
    budget_dkk: req.budget_dkk,
    team_size: req.team_size,
    status: 'draft',
    methodology_refs: (req.methodology_refs ?? []).slice(0, 10),
    created_at: now,
    updated_at: now,
  }

  await saveEngagement(e)
  // Await Neo4j MERGE to prevent race condition where recordOutcome runs before
  // the engagement node exists — caused seed-script to lose 24/25 outcomes.
  // raptor.index remains fire-and-forget (non-critical, idempotent).
  try {
    await mergeEngagementNode(e)
  } catch (err) {
    logger.warn({ id: e.$id, error: String(err) }, 'Engagement: Neo4j MERGE await failed — non-blocking')
  }
  indexEngagementForPrecedent(e).catch(() => {})

  logger.info({ id: e.$id, client: e.client, domain: e.domain }, 'Engagement: created')
  return e
}

// ─── Capability 2: match (precedent search) ─────────────────────────────────

export interface MatchRequest {
  objective: string
  domain: string
  max_results?: number
}

const STALE_PRECEDENT_DAYS = 540 // ~18 months

export async function matchPrecedents(req: MatchRequest): Promise<{
  matches: EngagementMatch[]
  query_ms: number
}> {
  const t0 = Date.now()
  const maxResults = Math.min(req.max_results ?? 5, 20)

  // Step 1: Cypher query — actual :Engagement nodes filtered by domain + outcome.
  // Ranks by outcome grade (exceeded > met > partial > missed) and freshness.
  // This replaces the previous raw RAG filter that returned generic domain cards.
  const cypherMatches = await matchEngagementsViaCypher(req, maxResults * 2)

  // Step 2: Semantic RAG fallback if Cypher returns <maxResults (cold start or narrow domain).
  let ragMatches: EngagementMatch[] = []
  if (cypherMatches.length < maxResults) {
    try {
      const rag = await dualChannelRAG(
        `${req.domain} consulting engagement: ${req.objective}`,
        { maxResults: maxResults * 2, maxHops: 3 },
      )
      ragMatches = rag.results
        .filter(r => r.score >= 0.5 && !cypherMatches.some(c => c.engagement_id === r.source))
        .slice(0, maxResults - cypherMatches.length)
        .map(r => ({
          engagement_id: r.source,
          title: r.content.slice(0, 120),
          domain: req.domain,
          similarity: Number(r.score.toFixed(3)),
          match_reasoning: `Semantic similarity ${(r.score * 100).toFixed(0)}% (fallback — no direct engagement node matched)`,
          stale: false,
        }))
    } catch (err) {
      logger.warn({ error: String(err) }, 'Engagement match: RAG fallback failed')
    }
  }

  const matches = [...cypherMatches, ...ragMatches].slice(0, maxResults)
  logger.info(
    { query: req.objective.slice(0, 60), cypher: cypherMatches.length, rag: ragMatches.length, total: matches.length, ms: Date.now() - t0 },
    'Engagement: precedents matched',
  )
  return { matches, query_ms: Date.now() - t0 }
}

/**
 * Cypher-based precedent match — queries actual :Engagement nodes with outcomes.
 * Ranks by outcome grade and applies staleness penalty for engagements >18 months old.
 */
async function matchEngagementsViaCypher(req: MatchRequest, limit: number): Promise<EngagementMatch[]> {
  try {
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `MATCH (e:Engagement)
WHERE e.domain = $domain OR toLower(e.domain) CONTAINS toLower($domain)
OPTIONAL MATCH (e)-[:HAS_OUTCOME]->(o:EngagementOutcome)
OPTIONAL MATCH (e)-[:USES_METHODOLOGY]->(m)
WITH e, o, collect(DISTINCT coalesce(m.title, m.name)) AS methodologies
RETURN e.id AS id,
       e.client AS client,
       e.objective AS objective,
       e.domain AS domain,
       e.startDate AS startDate,
       e.status AS status,
       o.grade AS outcomeGrade,
       o.precedentAccuracy AS precedentAccuracy,
       methodologies
ORDER BY
  CASE o.grade WHEN 'exceeded' THEN 0 WHEN 'met' THEN 1 WHEN 'partial' THEN 2 WHEN 'missed' THEN 3 ELSE 4 END,
  e.startDate DESC
LIMIT ${Math.floor(limit)}`,
        params: { domain: req.domain },
      },
      callId: uuid(),
      timeoutMs: 15000,
    })
    if (result.status !== 'success') return []
    const data = result.result as Record<string, unknown> | null
    // Backend wraps as { success, results, count, query, _upgrade_hint }. Check inner success.
    if (!data || (data as Record<string, unknown>).success === false) {
      logger.warn({ error: (data as Record<string, unknown>)?.error }, 'Cypher precedent match: backend returned error')
      return []
    }
    const rows = (data?.results ?? data?.rows ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(rows) || rows.length === 0) return []

    const objectiveLower = req.objective.toLowerCase()
    const now = Date.now()
    return rows.map(row => {
      const client = String(row.client ?? 'Unknown')
      const objective = String(row.objective ?? '')
      const grade = (row.outcomeGrade ?? null) as string | null
      const methodologies = (Array.isArray(row.methodologies) ? row.methodologies : []) as string[]
      // Compute age client-side from ISO string startDate
      const startDateStr = row.startDate ? String(row.startDate) : null
      const startMs = startDateStr ? Date.parse(startDateStr) : now
      const ageDays = Math.max(0, Math.floor((now - startMs) / 864e5))
      const stale = ageDays > STALE_PRECEDENT_DAYS

      // Similarity: grade weight (0.3 base) + keyword overlap (up to 0.5) + freshness (0.2)
      const gradeWeight = grade === 'exceeded' ? 0.3 : grade === 'met' ? 0.25 : grade === 'partial' ? 0.15 : grade === 'missed' ? 0.05 : 0.1
      const objWords = new Set(objectiveLower.split(/\W+/).filter(w => w.length > 3))
      const targetWords = (objective + ' ' + methodologies.join(' ')).toLowerCase().split(/\W+/)
      const overlap = targetWords.filter(w => objWords.has(w)).length
      const overlapScore = Math.min(0.5, overlap * 0.08)
      const freshness = stale ? 0 : Math.max(0, 0.2 - (ageDays / STALE_PRECEDENT_DAYS) * 0.2)
      const similarity = Math.min(0.99, gradeWeight + overlapScore + freshness)

      return {
        engagement_id: String(row.id ?? 'unknown'),
        title: `${client} — ${objective.slice(0, 80)}`,
        domain: String(row.domain ?? req.domain),
        similarity: Number(similarity.toFixed(3)),
        match_reasoning: `Cypher match: ${grade ?? 'no outcome'} grade, ${methodologies.length} shared methodologies, ${ageDays}d old${stale ? ' (STALE)' : ''}`,
        precedent_outcome: (grade ?? undefined) as EngagementMatch['precedent_outcome'],
        stale,
      }
    })
  } catch (err) {
    logger.warn({ error: String(err) }, 'Cypher precedent match failed')
    return []
  }
}

// ─── kg_rag parallel retrieval channel (v4.0.1 enhancement) ─────────────────

/**
 * Query kg_rag.query for graph-augmented evidence. Returns synthesized answer
 * plus source array with scores across 40 Neo4j namespaces.
 * Complements dualChannelRAG which uses autonomous.graphrag.
 */
async function queryKgRag(query: string, maxEvidence = 10): Promise<{ answer: string; sources: Array<{ id: string; content: string; score: number }> }> {
  try {
    const result = await callMcpTool({
      toolName: 'kg_rag.query',
      args: { question: query, max_evidence: maxEvidence },
      callId: uuid(),
      timeoutMs: 45000,
    })
    if (result.status !== 'success') return { answer: '', sources: [] }
    const data = result.result as Record<string, unknown> | null
    if (!data) return { answer: '', sources: [] }
    const answer = typeof data.answer === 'string' ? data.answer : ''
    const sources = Array.isArray(data.sources)
      ? (data.sources as Array<Record<string, unknown>>).map(s => ({
          id: String(s.id ?? 'unknown'),
          content: String(s.content ?? ''),
          score: typeof s.score === 'number' ? s.score : 0.5,
        }))
      : []
    return { answer, sources }
  } catch (err) {
    logger.debug({ error: String(err) }, 'kg_rag.query failed')
    return { answer: '', sources: [] }
  }
}

// ─── Context folding (v4.0.1 enhancement) ───────────────────────────────────

/**
 * Compress large evidence via backend context_folding.fold MCP tool.
 * Auto-selects strategy (baseline/neural/deepseek) based on size.
 * Returns folded text or null if folding failed (fallback to original).
 */
async function foldContext(text: string, query: string, maxTokens = 1500): Promise<string | null> {
  if (!text || text.length < 500) return null // not worth folding
  try {
    const result = await callMcpTool({
      toolName: 'context_folding.fold',
      args: {
        task: query,
        context: { text },
        max_tokens: maxTokens,
        domain: 'consulting',
      },
      callId: uuid(),
      timeoutMs: 20000,
    })
    if (result.status !== 'success') return null
    const data = result.result as Record<string, unknown> | null
    if (!data || data.success === false) return null
    // Backend returns: { folded_context, summary, original_tokens, folded_tokens, compression_ratio, strategy }
    // Mirror the v4.0.5 fix that was applied to the context_fold tool-executor case.
    const summary = typeof data.summary === 'string' ? data.summary : null
    const foldedContext = data.folded_context as Record<string, unknown> | string | null
    const fallback = typeof foldedContext === 'string'
      ? foldedContext
      : (foldedContext && typeof (foldedContext as Record<string, unknown>).text === 'string'
          ? (foldedContext as Record<string, unknown>).text as string
          : null)
    const folded = summary ?? fallback
    return typeof folded === 'string' && folded.length > 50 ? folded : null
  } catch {
    return null
  }
}

// ─── Swarm consensus (v4.0.3) ────────────────────────────────────────────────

/**
 * High-stakes plan gate: budget > GATE_BUDGET_DKK OR team > GATE_TEAM_SIZE
 * OR duration > GATE_DURATION_WEEKS. These plans trigger consensus.propose +
 * self-vote via engagement-planner agent. Uses env-configurable thresholds
 * (defaults 20M DKK / 20 / 40w) so this stays consistent with generatePlan's
 * gates classification and the consensus gate enforcement.
 *
 * Fix v4.0.10: previously hardcoded — caused config drift when operators
 * set EIE_GATE_* env vars but isHighStakesPlan still used the old defaults.
 * NB: module-level GATE_* constants are declared below this function but
 * initialized before any call to generatePlan → isHighStakesPlan, so
 * lexical order is fine (TDZ is only an issue for invocation before init).
 */
function isHighStakesPlan(req: PlanRequest): boolean {
  return (
    (req.budget_dkk ?? 0) > GATE_BUDGET_DKK ||
    req.team_size > GATE_TEAM_SIZE ||
    req.duration_weeks > GATE_DURATION_WEEKS
  )
}

async function proposeViaConsensus(
  engagementId: string,
  req: PlanRequest,
  planSummary: string,
): Promise<{ proposalId: string | null; quorum: number }> {
  try {
    const result = await callMcpTool({
      toolName: 'consensus.propose',
      args: {
        title: `EIE plan: ${req.domain} — ${req.objective.slice(0, 80)}`,
        description: `${req.duration_weeks}w, team ${req.team_size}, budget ${req.budget_dkk ?? 'unspecified'} DKK. Plan summary: ${planSummary.slice(0, 400)}`,
        proposer: 'engagement-planner',
        severity: 'P2',
        metadata: {
          engagement_id: engagementId,
          domain: req.domain,
          duration_weeks: req.duration_weeks,
          team_size: req.team_size,
          budget_dkk: req.budget_dkk ?? 0,
        },
      },
      callId: uuid(),
      timeoutMs: 15000,
    })
    if (result.status !== 'success') return { proposalId: null, quorum: 0 }
    const data = result.result as Record<string, unknown> | null
    if (!data || data.success === false) return { proposalId: null, quorum: 0 }
    const proposalId = (data.proposalId as string) ?? null
    const quorum = Number(data.quorum ?? 3)
    logger.info({ proposalId, quorum, engagement_id: engagementId }, 'Engagement plan: consensus proposal created')
    return { proposalId, quorum }
  } catch (err) {
    logger.debug({ error: String(err) }, 'consensus.propose failed')
    return { proposalId: null, quorum: 0 }
  }
}

async function voteOnConsensus(
  proposalId: string,
  decision: 'approve' | 'reject',
  confidence: number,
  reasoning: string,
): Promise<boolean> {
  try {
    const result = await callMcpTool({
      toolName: 'consensus.vote',
      args: {
        proposalId,
        voter: 'engagement-planner',
        decision,
        confidence: Math.min(1, Math.max(0, confidence)),
        reasoning: reasoning.slice(0, 500),
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
    if (result.status !== 'success') return false
    const data = result.result as Record<string, unknown> | null
    return Boolean(data && data.success !== false)
  } catch (err) {
    logger.debug({ error: String(err) }, 'consensus.vote failed')
    return false
  }
}

// ─── RLM Mission for complex plans (v4.0.3) ─────────────────────────────────

/**
 * For engagements >40 weeks, use rlm.start_mission for multi-step reasoning.
 * Mission runs PEEK → ANALYZE → SYNTHESIZE steps with graph context per step.
 * Returns aggregated insights to enrich the cognitive analyze context.
 */
async function planViaRlmMission(
  engagementId: string,
  req: PlanRequest,
  maxSteps = 3,
): Promise<{ missionId: string | null; insights: string[]; stepsExecuted: number }> {
  try {
    const startResult = await callMcpTool({
      toolName: 'rlm.start_mission',
      args: {
        name: `eie-plan-${engagementId}`,
        objective: `Design ${req.duration_weeks}-week ${req.domain} consulting engagement: ${req.objective}`,
        maxSteps,
        maxDepth: 2,
      },
      callId: uuid(),
      timeoutMs: 20000,
    })
    if (startResult.status !== 'success') return { missionId: null, insights: [], stepsExecuted: 0 }
    const startData = startResult.result as Record<string, unknown> | null
    if (!startData || startData.success === false) return { missionId: null, insights: [], stepsExecuted: 0 }
    const missionId = (startData.missionId as string) ?? null
    if (!missionId) return { missionId: null, insights: [], stepsExecuted: 0 }

    const insights: string[] = []
    let stepsExecuted = 0
    for (let i = 0; i < maxSteps; i++) {
      const stepResult = await callMcpTool({
        toolName: 'rlm.execute_step',
        args: { missionId },
        callId: uuid(),
        timeoutMs: 60000,
      })
      if (stepResult.status !== 'success') break
      const stepData = stepResult.result as Record<string, unknown> | null
      if (!stepData || stepData.success === false) break
      stepsExecuted++
      // Extract summary from step result
      const step = stepData.result as Record<string, unknown> | null
      const summary = (step?.data as Record<string, unknown>)?.summary ?? step?.summary
      if (typeof summary === 'string' && summary.length > 20) {
        insights.push(summary.slice(0, 300))
      }
      // Stop if mission completed
      if (stepData.status === 'COMPLETED' || step === null) break
    }

    logger.info({ missionId, stepsExecuted, insights: insights.length, engagement_id: engagementId }, 'Engagement plan: RLM mission executed')
    return { missionId, insights, stepsExecuted }
  } catch (err) {
    logger.debug({ error: String(err) }, 'rlm.start_mission failed')
    return { missionId: null, insights: [], stepsExecuted: 0 }
  }
}

// ─── Capability 3: plan ──────────────────────────────────────────────────────

export interface PlanRequest {
  engagement_id?: string // if given, plan is attached to existing engagement
  objective: string
  domain: string
  duration_weeks: number
  team_size: number
  budget_dkk?: number
}

// ─── Gate thresholds (v4.0.3) — SMART, UPFRONT, FAIL-CLOSED ────────────────
// These gates run BEFORE any expensive retrieval or LLM calls.
// Fail-closed: if consensus infrastructure is unreachable, high-stakes plans
// are REJECTED unless EIE_GATE_REQUIRE_CONSENSUS=false is explicitly set.
const GATE_BUDGET_DKK = Number(process.env.EIE_GATE_BUDGET_DKK ?? 20_000_000)
const GATE_TEAM_SIZE = Number(process.env.EIE_GATE_TEAM_SIZE ?? 20)
const GATE_DURATION_WEEKS = Number(process.env.EIE_GATE_DURATION_WEEKS ?? 40)
const GATE_REQUIRE_CONSENSUS = process.env.EIE_GATE_REQUIRE_CONSENSUS !== 'false'
const GATE_CONSENSUS_TIMEOUT_MS = Number(process.env.EIE_GATE_CONSENSUS_TIMEOUT_MS ?? 30_000)
// Hard sanity limits — reject obviously insane requests upfront.
const GATE_MAX_BUDGET_DKK = Number(process.env.EIE_GATE_MAX_BUDGET_DKK ?? 500_000_000)
const GATE_MAX_TEAM_SIZE = Number(process.env.EIE_GATE_MAX_TEAM_SIZE ?? 100)
const GATE_MAX_DURATION_WEEKS = Number(process.env.EIE_GATE_MAX_DURATION_WEEKS ?? 260) // 5 years
const GATE_MIN_OBJECTIVE_LEN = 15

export class PlanGateRejection extends Error {
  constructor(
    public readonly code: string,
    public readonly reason: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(`Plan gate rejection: ${code} — ${reason}`)
    this.name = 'PlanGateRejection'
  }
}

/**
 * Gate 0: Input sanity validation — run BEFORE any expensive work.
 * Rejects obviously invalid/insane requests upfront.
 */
function enforceInputSanityGate(req: PlanRequest): void {
  if (!req.objective || req.objective.trim().length < GATE_MIN_OBJECTIVE_LEN) {
    throw new PlanGateRejection('INVALID_OBJECTIVE', `objective must be at least ${GATE_MIN_OBJECTIVE_LEN} chars`, { given: req.objective?.length ?? 0 })
  }
  if (!req.domain || req.domain.trim().length === 0) {
    throw new PlanGateRejection('INVALID_DOMAIN', 'domain required')
  }
  if (!Number.isFinite(req.duration_weeks) || req.duration_weeks < 1) {
    throw new PlanGateRejection('INVALID_DURATION', 'duration_weeks must be ≥1', { given: req.duration_weeks })
  }
  if (req.duration_weeks > GATE_MAX_DURATION_WEEKS) {
    throw new PlanGateRejection('DURATION_OVER_HARD_LIMIT', `duration >${GATE_MAX_DURATION_WEEKS} weeks rejected`, { given: req.duration_weeks, limit: GATE_MAX_DURATION_WEEKS })
  }
  if (!Number.isFinite(req.team_size) || req.team_size < 1) {
    throw new PlanGateRejection('INVALID_TEAM', 'team_size must be ≥1', { given: req.team_size })
  }
  if (req.team_size > GATE_MAX_TEAM_SIZE) {
    throw new PlanGateRejection('TEAM_OVER_HARD_LIMIT', `team_size >${GATE_MAX_TEAM_SIZE} rejected`, { given: req.team_size, limit: GATE_MAX_TEAM_SIZE })
  }
  if (req.budget_dkk !== undefined) {
    if (!Number.isFinite(req.budget_dkk) || req.budget_dkk < 0) {
      throw new PlanGateRejection('INVALID_BUDGET', 'budget_dkk must be ≥0', { given: req.budget_dkk })
    }
    if (req.budget_dkk > GATE_MAX_BUDGET_DKK) {
      throw new PlanGateRejection('BUDGET_OVER_HARD_LIMIT', `budget >${GATE_MAX_BUDGET_DKK} DKK rejected`, { given: req.budget_dkk, limit: GATE_MAX_BUDGET_DKK })
    }
  }
}

/**
 * Gate 1: Consensus gate for high-stakes plans — BLOCKING, fail-closed.
 * Opens a consensus proposal and self-votes. If infrastructure fails AND
 * GATE_REQUIRE_CONSENSUS=true (default), the plan is REJECTED.
 */
async function enforceConsensusGate(
  engagementId: string,
  req: PlanRequest,
): Promise<{ proposalId: string; quorum: number }> {
  const summary = `High-stakes plan: ${req.domain}, ${req.duration_weeks}w, team ${req.team_size}, budget ${req.budget_dkk ?? '?'} DKK. ${req.objective.slice(0, 200)}`
  const proposeResult = await Promise.race([
    proposeViaConsensus(engagementId, req, summary),
    new Promise<{ proposalId: null; quorum: 0 }>(resolve =>
      setTimeout(() => resolve({ proposalId: null, quorum: 0 }), GATE_CONSENSUS_TIMEOUT_MS),
    ),
  ])
  if (!proposeResult.proposalId) {
    if (GATE_REQUIRE_CONSENSUS) {
      throw new PlanGateRejection(
        'CONSENSUS_UNAVAILABLE',
        'High-stakes plan requires consensus proposal, but consensus.propose is unavailable or timed out. Set EIE_GATE_REQUIRE_CONSENSUS=false to override (not recommended).',
        { timeout_ms: GATE_CONSENSUS_TIMEOUT_MS },
      )
    }
    logger.warn({ engagementId }, 'EIE gate: consensus unavailable, proceeding under override flag')
    return { proposalId: '', quorum: 0 }
  }
  // Self-vote as engagement-planner (the proposing agent).
  await voteOnConsensus(
    proposeResult.proposalId,
    'approve',
    0.85,
    `Plan ${engagementId}: domain=${req.domain}, ${req.duration_weeks}w, team=${req.team_size}, budget=${req.budget_dkk ?? 0}. Self-vote as proposer.`,
  )
  return proposeResult
}

export async function generatePlan(req: PlanRequest): Promise<EngagementPlan> {
  const t0 = Date.now()
  const engagementId = req.engagement_id ?? `eng-${uuid()}`

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 0: UPFRONT GATES — run BEFORE any expensive retrieval or LLM call.
  // Fail-closed. Any gate rejection raises PlanGateRejection, caught by route.
  // ═══════════════════════════════════════════════════════════════════════

  // Gate 0: Input sanity — rejects malformed/insane requests immediately.
  enforceInputSanityGate(req)

  // Gate 1: High-stakes classification. Fail-closed consensus gate.
  const highStakes = isHighStakesPlan(req)
  const complex = req.duration_weeks > GATE_DURATION_WEEKS
  const gatesTriggered: string[] = []
  if ((req.budget_dkk ?? 0) > GATE_BUDGET_DKK) gatesTriggered.push(`budget>${GATE_BUDGET_DKK}`)
  if (req.team_size > GATE_TEAM_SIZE) gatesTriggered.push(`team>${GATE_TEAM_SIZE}`)
  if (req.duration_weeks > GATE_DURATION_WEEKS) gatesTriggered.push(`duration>${GATE_DURATION_WEEKS}w`)
  logger.info({ engagementId, gates: gatesTriggered, high_stakes: highStakes, complex }, 'EIE gates: classified')

  let consensusProposalId = ''
  let consensusQuorum = 0
  if (highStakes) {
    const gate = await enforceConsensusGate(engagementId, req)
    consensusProposalId = gate.proposalId
    consensusQuorum = gate.quorum
    logger.info({ engagementId, proposalId: consensusProposalId, quorum: consensusQuorum }, 'EIE gate: consensus opened')
  }

  // Gate 2: Complex plan → RLM mission for multi-step enrichment (not blocking, adds context).
  let rlmMissionId: string | null = null
  let rlmStepsExecuted = 0
  let rlmInsights: string[] = []
  if (complex) {
    const mission = await planViaRlmMission(engagementId, req, 3)
    rlmMissionId = mission.missionId
    rlmStepsExecuted = mission.stepsExecuted
    rlmInsights = mission.insights
    logger.info({ engagementId, missionId: rlmMissionId, steps: rlmStepsExecuted }, 'EIE gate: RLM mission completed')
  }

  // Step 1: Deep retrieval (4 parallel channels — precedents + methodology + risks + kg_rag)

  // Step 1: Deep retrieval (4 parallel channels — precedents + methodology + risks + kg_rag)
  // kg_rag.query adds multi-hop graph-augmented evidence with cross-namespace sources
  // (consulting-frameworks, regulatory-nis2, competitive-intel, etc. — 40 namespaces)
  // v4.0.2: maxHops=3 for deeper graph traversal on methodology + risk retrieval.
  // Complex engagements benefit from 3-hop reasoning (e.g., Framework -> Org -> Regulation -> Control).
  const [precedents, methodologyBundle, riskBundle, kgRagBundle] = await Promise.all([
    matchPrecedents({ objective: req.objective, domain: req.domain, max_results: 5 }),
    dualChannelRAG(`consulting methodology framework for ${req.domain} ${req.objective}`, { maxResults: 5, maxHops: 3 }),
    dualChannelRAG(`risks challenges pitfalls for ${req.domain} consulting engagement ${req.objective}`, { maxResults: 5, maxHops: 3 }),
    queryKgRag(`${req.domain} engagement approach: ${req.objective}`, 8),
  ])

  let methodologyEvidence = methodologyBundle.results.map(r => r.content).join('\n\n').slice(0, 3500)
  let riskEvidence = riskBundle.results.map(r => r.content).join('\n\n').slice(0, 2500)
  const kgRagEvidence = kgRagBundle.answer.slice(0, 2500)
  const precedentText = precedents.matches.map((m, i) => `[${i + 1}] ${m.title} (similarity: ${m.similarity})`).join('\n')

  // Context folding: if total evidence exceeds 6000 chars, compress via RLM /fold/context
  const totalEvidenceLen = methodologyEvidence.length + riskEvidence.length + kgRagEvidence.length
  if (totalEvidenceLen > 6000) {
    const foldedMethod = await foldContext(methodologyEvidence, `consulting methodology for ${req.domain}`, 1500)
    const foldedRisk = await foldContext(riskEvidence, `risks for ${req.domain} engagement`, 1000)
    if (foldedMethod) methodologyEvidence = foldedMethod
    if (foldedRisk) riskEvidence = foldedRisk
    logger.info({ original: totalEvidenceLen, folded: methodologyEvidence.length + riskEvidence.length }, 'Engagement plan: context folded')
  }

  const totalCitations =
    precedents.matches.length +
    methodologyBundle.results.length +
    riskBundle.results.length +
    kgRagBundle.sources.length

  const avgConfidence =
    ([
      ...methodologyBundle.results.map(r => r.score),
      ...riskBundle.results.map(r => r.score),
      ...precedents.matches.map(m => m.similarity),
    ].reduce((s, x) => s + x, 0) /
      Math.max(
        1,
        methodologyBundle.results.length + riskBundle.results.length + precedents.matches.length,
      )) || 0

  // Step 2: Plan generation via cognitive reasoning
  const planPrompt = `You are planning a ${req.duration_weeks}-week consulting engagement.

OBJECTIVE: ${req.objective}
DOMAIN: ${req.domain}
TEAM SIZE: ${req.team_size}
${req.budget_dkk ? `BUDGET: ${req.budget_dkk} DKK` : ''}

METHODOLOGY EVIDENCE FROM KNOWLEDGE GRAPH:
${methodologyEvidence || '[limited evidence]'}

RISK EVIDENCE FROM KNOWLEDGE GRAPH:
${riskEvidence || '[limited evidence]'}

GRAPH-AUGMENTED CONTEXT (kg_rag multi-hop synthesis):
${kgRagEvidence || '[no kg_rag context]'}

SIMILAR PRECEDENT ENGAGEMENTS:
${precedentText || '[no precedents — cold start]'}

OUTPUT STRICT JSON with this schema:
{
  "phases": [
    {"name": "...", "duration_weeks": N, "deliverables": ["...", "..."], "methodology": "..."}
  ],
  "risks": [
    {"description": "...", "severity": "high|medium|low", "mitigation": "..."}
  ],
  "required_skills": ["skill1", "skill2", ...]
}

Rules:
- Phase durations must sum to ${req.duration_weeks}
- Include 3-6 phases, 3-8 risks, 5-12 skills
- Be concrete and cite evidence where possible
- Return ONLY JSON, no markdown fences, no commentary`

  let phases: EngagementPlan['phases'] = []
  let risks: EngagementPlan['risks'] = []
  let skills: string[] = []
  let planSource: string = 'fallback-template'
  let platformConfidence = 0
  let routingMeta: Record<string, unknown> | null = null

  // TIER 1: RLM /cognitive/analyze via callCognitiveRaw — returns full structured response
  // including analysis.phase_breakdown, key_challenges_and_mitigations, resource_allocation,
  // insights, recommendations, confidence, quality self-score, routing metadata.
  // Uses the new raw wrapper (cognitive-proxy.ts::callCognitiveRaw) instead of the legacy
  // callCognitive() which unwraps to text (backward-compat for 8+ existing consumers).
  const analyzed = await callCognitiveRaw(
    'analyze',
    {
      prompt: `Design a ${req.duration_weeks}-week consulting engagement for: ${req.objective}`,
      context: {
        domain: req.domain,
        team_size: req.team_size,
        budget_dkk: req.budget_dkk,
        precedent_summaries: precedents.matches.slice(0, 3).map(m => m.title),
        methodology_evidence: methodologyEvidence.slice(0, 2000),
        risk_evidence: riskEvidence.slice(0, 1500),
        kg_rag_synthesis: kgRagEvidence.slice(0, 1500),
        rlm_mission_insights: rlmInsights.slice(0, 3),
      },
      agent_id: 'engagement-planner',
      // Custom fields consumed by callCognitiveRaw passthrough
      ...({
        task: `Design a ${req.duration_weeks}-week consulting engagement for: ${req.objective}`,
        analysis_dimensions: [
          'phase_breakdown',
          'resource_allocation',
          'methodology_integration',
          'key_challenges_and_mitigations',
        ],
        constraints: [
          `duration: ${req.duration_weeks} weeks`,
          `team: ${req.team_size} people`,
          req.budget_dkk ? `budget: ${req.budget_dkk} DKK` : '',
        ].filter(Boolean),
      } as Record<string, unknown>),
    },
    60000,
  )

  if (analyzed?.analysis) {
    const a = analyzed.analysis as Record<string, unknown>
    const phaseBreakdown = (a.phase_breakdown ?? a.phases) as Array<Record<string, unknown>> | undefined
    const challenges = (a.key_challenges_and_mitigations ?? a.risks) as Array<Record<string, unknown>> | undefined
    const resourceAlloc = a.resource_allocation as Record<string, unknown> | undefined

    if (Array.isArray(phaseBreakdown) && phaseBreakdown.length > 0) {
      phases = phaseBreakdown.slice(0, 10).map(p => ({
        name: String(p.phase_name ?? p.name ?? 'Unnamed phase'),
        duration_weeks: Number(p.duration_weeks ?? 1),
        deliverables: Array.isArray(p.deliverables) ? (p.deliverables as unknown[]).map(String).slice(0, 8) : [],
        methodology: String(p.objective ?? p.methodology ?? p.description ?? ''),
      }))
    }
    if (Array.isArray(challenges) && challenges.length > 0) {
      risks = challenges.slice(0, 10).map(c => ({
        description: String(c.challenge ?? c.description ?? c.name ?? ''),
        severity: (['high', 'medium', 'low'].includes(String(c.severity)) ? c.severity : 'medium') as 'high' | 'medium' | 'low',
        mitigation: String(c.mitigation ?? ''),
      }))
    }
    if (resourceAlloc && Array.isArray(resourceAlloc.roles)) {
      skills = (resourceAlloc.roles as unknown[]).map(String).slice(0, 15)
    } else if (Array.isArray(a.skills)) {
      skills = (a.skills as Array<Record<string, unknown>>).map(s => String(s.name ?? s)).slice(0, 15)
    }

    // Platform self-scored confidence (use the higher of analysis confidence or quality score)
    const analysisConfidence = typeof analyzed.confidence === 'number' ? analyzed.confidence : 0
    const qualityScore = typeof (analyzed.quality as Record<string, unknown>)?.overall_score === 'number'
      ? ((analyzed.quality as Record<string, unknown>).overall_score as number) : 0
    platformConfidence = Math.max(analysisConfidence, qualityScore)

    routingMeta = (analyzed.routing as Record<string, unknown>) ?? null
    if (phases.length > 0 || risks.length > 0) {
      planSource = 'rlm-cognitive-analyze'
      logger.info(
        {
          phases: phases.length,
          risks: risks.length,
          skills: skills.length,
          provider: routingMeta?.provider,
          model: routingMeta?.model,
          cost: routingMeta?.cost,
          platform_confidence: platformConfidence,
        },
        'Engagement plan: RLM /cognitive/analyze OK',
      )
    }
  }

  // TIER 2: Mercury llm.generate via backend MCP (graceful degradation only)
  if (phases.length === 0) {
    logger.warn({ engagementId }, 'Engagement plan: /cognitive/analyze returned empty, trying llm.generate fallback')
    try {
      const mercuryPrompt = `${planPrompt}\n\nReturn ONLY JSON matching the schema, no prose.`
      const r = await callMcpTool({
        toolName: 'llm.generate',
        args: { prompt: mercuryPrompt },
        callId: uuid(),
        timeoutMs: 30000,
      })
      if (r.status === 'success') {
        const raw = r.result as Record<string, unknown> | null
        const text = String(raw?.content ?? raw?.response ?? '')
        if (text.length > 20) {
          const parsed = parsePlanJSON(text)
          if (parsed.phases.length > 0) {
            phases = parsed.phases
            risks = parsed.risks
            skills = parsed.required_skills
            planSource = 'mercury-llm-generate-fallback'
            logger.info({ phases: phases.length }, 'Engagement plan: Mercury fallback OK')
          }
        }
      }
    } catch (err) {
      logger.debug({ error: String(err) }, 'Engagement plan: Mercury fallback failed')
    }
  }

  // Fallback: if LLM produced no phases, synthesize a minimal plan from methodology
  if (phases.length === 0) {
    phases = synthesizeFallbackPhases(req.duration_weeks)
  }
  if (risks.length === 0) {
    risks = [
      { description: 'Scope creep beyond initial objectives', severity: 'medium', mitigation: 'Weekly steering committee with change control board' },
      { description: 'Stakeholder alignment drift', severity: 'medium', mitigation: 'Bi-weekly alignment sessions with documented decisions' },
    ]
  }
  if (skills.length === 0) {
    skills = ['Strategic consulting', 'Stakeholder management', 'Data analysis', req.domain]
  }

  // Final confidence: prefer platform self-scored confidence when available,
  // fall back to retrieval-based avgConfidence. Platform score is more trustworthy.
  const finalConfidence = platformConfidence > 0
    ? Math.max(platformConfidence, avgConfidence)
    : avgConfidence

  const plan: EngagementPlan = {
    engagement_id: engagementId,
    generated_at: new Date().toISOString(),
    phases,
    risks,
    required_skills: skills,
    precedents_used: precedents.matches,
    total_citations: totalCitations,
    avg_confidence: Number(finalConfidence.toFixed(3)),
    generation_ms: Date.now() - t0,
    high_stakes: highStakes,
    consensus_proposal_id: consensusProposalId || undefined,
    consensus_quorum: consensusQuorum || undefined,
    rlm_mission_id: rlmMissionId || undefined,
    rlm_steps_executed: rlmStepsExecuted || undefined,
    plan_source: planSource,
  }

  // Cache the plan in Redis
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(`${REDIS_PLAN_PREFIX}${engagementId}`, JSON.stringify(plan), 'EX', TTL_SECONDS)
    } catch { /* non-fatal */ }
  }

  logger.info(
    {
      engagement_id: engagementId,
      phases: phases.length,
      risks: risks.length,
      skills: skills.length,
      citations: totalCitations,
      confidence: plan.avg_confidence,
      ms: plan.generation_ms,
      plan_source: planSource,
      provider: routingMeta?.provider ?? null,
      cost: routingMeta?.cost ?? null,
    },
    'Engagement: plan generated',
  )

  return plan
}

function parsePlanJSON(text: string): {
  phases: EngagementPlan['phases']
  risks: EngagementPlan['risks']
  required_skills: string[]
} {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  // Find JSON block — look for first { to matching last }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace < 0) {
    return { phases: [], risks: [], required_skills: [] }
  }
  const jsonSlice = cleaned.slice(firstBrace, lastBrace + 1)
  try {
    const obj = JSON.parse(jsonSlice) as Record<string, unknown>
    const phases = Array.isArray(obj.phases)
      ? (obj.phases as Array<Record<string, unknown>>).slice(0, 10).map(p => ({
          name: String(p.name ?? 'Unnamed phase'),
          duration_weeks: Number(p.duration_weeks ?? 1),
          deliverables: Array.isArray(p.deliverables) ? (p.deliverables as unknown[]).map(String).slice(0, 8) : [],
          methodology: String(p.methodology ?? ''),
        }))
      : []
    const risks = Array.isArray(obj.risks)
      ? (obj.risks as Array<Record<string, unknown>>).slice(0, 10).map(r => ({
          description: String(r.description ?? ''),
          severity: (['high', 'medium', 'low'].includes(String(r.severity)) ? r.severity : 'medium') as 'high' | 'medium' | 'low',
          mitigation: String(r.mitigation ?? ''),
        }))
      : []
    const skills = Array.isArray(obj.required_skills)
      ? (obj.required_skills as unknown[]).map(String).slice(0, 15)
      : []
    return { phases, risks, required_skills: skills }
  } catch {
    return { phases: [], risks: [], required_skills: [] }
  }
}

function synthesizeFallbackPhases(totalWeeks: number): EngagementPlan['phases'] {
  // Standard 4-phase consulting structure: Discover → Diagnose → Design → Deploy
  const w = Math.max(1, Math.floor(totalWeeks / 4))
  return [
    { name: 'Discover', duration_weeks: w, deliverables: ['Stakeholder map', 'Current state assessment'], methodology: 'McKinsey 7-step problem solving' },
    { name: 'Diagnose', duration_weeks: w, deliverables: ['Root cause analysis', 'Opportunity sizing'], methodology: 'MECE issue tree decomposition' },
    { name: 'Design', duration_weeks: w, deliverables: ['Target operating model', 'Implementation roadmap'], methodology: 'Capability-based planning' },
    { name: 'Deploy', duration_weeks: Math.max(1, totalWeeks - 3 * w), deliverables: ['Pilot rollout', 'Change management plan'], methodology: 'Kotter 8-step change' },
  ]
}

// ─── Capability 4: record outcome (feedback loop to adaptive RAG) ───────────

export interface RecordOutcomeRequest {
  engagement_id: string
  actual_end_date: string
  grade: OutcomeGrade
  deliverables_shipped: string[]
  what_went_well: string
  what_went_wrong: string
  precedent_match_accuracy?: number
  recorded_by: string
}

export async function recordOutcome(req: RecordOutcomeRequest): Promise<EngagementOutcome> {
  const engagement = await getEngagement(req.engagement_id)
  if (!engagement) {
    throw new Error(`Engagement ${req.engagement_id} not found`)
  }

  const outcome: EngagementOutcome = {
    engagement_id: req.engagement_id,
    completed_at: new Date().toISOString(),
    actual_end_date: req.actual_end_date,
    grade: req.grade,
    deliverables_shipped: req.deliverables_shipped.slice(0, 20),
    what_went_well: req.what_went_well.slice(0, 2000),
    what_went_wrong: req.what_went_wrong.slice(0, 2000),
    precedent_match_accuracy: Math.min(1, Math.max(0, req.precedent_match_accuracy ?? 0.5)),
    recorded_by: req.recorded_by,
  }

  // Update engagement status
  engagement.status = 'completed'
  engagement.updated_at = new Date().toISOString()
  await saveEngagement(engagement)

  // Persist outcome in Redis
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(`${REDIS_PREFIX}outcome:${req.engagement_id}`, JSON.stringify(outcome), 'EX', TTL_SECONDS)
    } catch { /* non-fatal */ }
  }

  // Write to Neo4j graph (non-blocking)
  mergeOutcomeNode(outcome).catch(() => {})

  // Feed adaptive RAG Q-learning — the precedent system IS the RAG strategy
  const reward = gradeToReward(outcome.grade) * outcome.precedent_match_accuracy
  sendQLearningReward(
    { query_type: 'multi_hop', channels_used: ['graphrag', 'srag', 'cypher'], result_count: 5 },
    { strategy: 'engagement-precedent-match', confidence_threshold: 0.4 },
    reward,
  ).catch(() => {})

  logger.info(
    { engagement_id: req.engagement_id, grade: req.grade, reward },
    'Engagement: outcome recorded, Q-learning reward sent',
  )
  return outcome
}

function gradeToReward(grade: OutcomeGrade): number {
  switch (grade) {
    case 'exceeded': return 1.0
    case 'met': return 0.8
    case 'partial': return 0.4
    case 'missed': return 0.1
  }
}

export async function getOutcome(engagementId: string): Promise<EngagementOutcome | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${REDIS_PREFIX}outcome:${engagementId}`)
    return raw ? (JSON.parse(raw) as EngagementOutcome) : null
  } catch {
    return null
  }
}

export async function getPlan(engagementId: string): Promise<EngagementPlan | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${REDIS_PLAN_PREFIX}${engagementId}`)
    return raw ? (JSON.parse(raw) as EngagementPlan) : null
  } catch {
    return null
  }
}
