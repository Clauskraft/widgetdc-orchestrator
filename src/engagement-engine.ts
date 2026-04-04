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
  // Fire-and-forget: Neo4j node + raptor index (non-blocking)
  mergeEngagementNode(e).catch(() => {})
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

export async function matchPrecedents(req: MatchRequest): Promise<{
  matches: EngagementMatch[]
  query_ms: number
}> {
  const t0 = Date.now()
  const maxResults = Math.min(req.max_results ?? 5, 20)
  const query = `${req.domain} consulting engagement: ${req.objective}`

  let rag: Awaited<ReturnType<typeof dualChannelRAG>>
  try {
    rag = await dualChannelRAG(query, { maxResults: maxResults * 2, queryType: 'multi_hop' })
  } catch (err) {
    logger.warn({ error: String(err) }, 'Engagement match: dualChannelRAG failed')
    return { matches: [], query_ms: Date.now() - t0 }
  }

  // Filter results to engagements, then rank
  const matches: EngagementMatch[] = rag.results
    .filter(r => r.score >= 0.3)
    .slice(0, maxResults)
    .map(r => ({
      engagement_id: r.source,
      title: r.content.slice(0, 120),
      domain: req.domain,
      similarity: Number(r.score.toFixed(3)),
      match_reasoning: `Graph similarity ${(r.score * 100).toFixed(0)}% via ${r.source.startsWith('eng-') ? 'engagement precedent' : 'methodology knowledge'}`,
      stale: false, // TODO: compare against createdAt once outcome data exists
    }))

  logger.info({ query: req.objective.slice(0, 60), count: matches.length, ms: Date.now() - t0 }, 'Engagement: precedents matched')
  return { matches, query_ms: Date.now() - t0 }
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
    const folded = data?.compressed_text ?? data?.folded_text ?? data?.result
    return typeof folded === 'string' && folded.length > 50 ? folded : null
  } catch {
    return null
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

export async function generatePlan(req: PlanRequest): Promise<EngagementPlan> {
  const t0 = Date.now()
  const engagementId = req.engagement_id ?? `eng-${uuid()}`

  // Step 1: Deep retrieval (4 parallel channels — precedents + methodology + risks + kg_rag)
  // kg_rag.query adds multi-hop graph-augmented evidence with cross-namespace sources
  // (consulting-frameworks, regulatory-nis2, competitive-intel, etc. — 40 namespaces)
  const [precedents, methodologyBundle, riskBundle, kgRagBundle] = await Promise.all([
    matchPrecedents({ objective: req.objective, domain: req.domain, max_results: 5 }),
    dualChannelRAG(`consulting methodology framework for ${req.domain} ${req.objective}`, { maxResults: 5 }),
    dualChannelRAG(`risks challenges pitfalls for ${req.domain} consulting engagement ${req.objective}`, { maxResults: 5 }),
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
