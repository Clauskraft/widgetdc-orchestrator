/**
 * routes/intelligence.ts — v3.0 Intelligence Engine API
 *
 * POST /api/intelligence/ingest     — Document ingestion (F2)
 * POST /api/intelligence/communities — Build community summaries (F3)
 * GET  /api/intelligence/health      — Graph health + intelligence metrics
 */
import { Router, Request, Response } from 'express'
import { ingestDocument, type DocumentIngestionRequest } from '../engagement/document-intelligence.js'
import { buildCommunitySummaries, searchCommunitySummaries } from '../graph/hierarchical-intelligence.js'
import { runGraphHygiene } from '../graph/graph-hygiene-cron.js'
import { getWriteGateStats } from '../write-gate.js'
import { getAdaptiveRAGDashboard, retrainRoutingWeights } from '../memory/adaptive-rag.js'
import { generatePlan, matchPrecedents, listEngagements, PlanGateRejection } from '../engagement/engagement-engine.js'
import { logger } from '../logger.js'

export const intelligenceRouter = Router()

// ─── POST /ingest — Document Intelligence Pipeline ──────────────────────────

intelligenceRouter.post('/ingest', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const content = body.content as string
  const filename = body.filename as string

  if (!content || typeof content !== 'string' || content.length < 20) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'content is required (min 20 chars)', status_code: 400 },
    })
    return
  }
  if (!filename || typeof filename !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'filename is required', status_code: 400 },
    })
    return
  }

  const request: DocumentIngestionRequest = {
    content: content.slice(0, 500000),
    filename: filename.slice(0, 200),
    content_type: (body.content_type as any) ?? 'text/markdown',
    source_url: body.source_url as string,
    domain: body.domain as string,
    extract_entities: body.extract_entities !== false,
    generate_embeddings: body.generate_embeddings !== false,
  }

  try {
    const result = await ingestDocument(request)
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INGESTION_FAILED', message: String(err), status_code: 500 },
    })
  }
})

// ─── POST /communities — Build Hierarchical Summaries ───────────────────────

intelligenceRouter.post('/communities', async (_req: Request, res: Response) => {
  logger.info('Intelligence API: building community summaries')
  try {
    const result = await buildCommunitySummaries()
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'COMMUNITY_BUILD_FAILED', message: String(err), status_code: 500 },
    })
  }
})

// ─── GET /communities/search — Search community summaries ───────────────────

intelligenceRouter.get('/communities/search', async (req: Request, res: Response) => {
  const query = req.query.q as string
  if (!query) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'q parameter required', status_code: 400 } })
    return
  }
  const results = await searchCommunitySummaries(query, 10)
  res.json({ success: true, data: results })
})

// ─── GET /adaptive-rag — Adaptive RAG dashboard ─────────────────────────────

intelligenceRouter.get('/adaptive-rag', async (_req: Request, res: Response) => {
  try {
    const dashboard = await getAdaptiveRAGDashboard()
    res.json({ success: true, data: dashboard })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'DASHBOARD_FAILED', message: String(err), status_code: 500 } })
  }
})

// ─── POST /adaptive-rag/retrain — Trigger manual retraining ─────────────────

intelligenceRouter.post('/adaptive-rag/retrain', async (_req: Request, res: Response) => {
  try {
    const result = await retrainRoutingWeights()
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'RETRAIN_FAILED', message: String(err), status_code: 500 } })
  }
})

// ─── POST /extract-test — Debug entity extraction ───────────────────────────

intelligenceRouter.post('/extract-test', async (req: Request, res: Response) => {
  const { callMcpTool } = await import('../mcp-caller.js')
  const { v4: uuid } = await import('uuid')
  const content = (req.body as any)?.content ?? 'CSRD regulation, ATP pension fund, GRI framework'
  try {
    const llmResult = await callMcpTool({
      toolName: 'llm.generate',
      args: {
        prompt: `Extract entities. Reply ONLY as JSON: {"entities":[{"name":"...","type":"..."}]}\n\nContent: ${content.slice(0, 2000)}`,
      },
      callId: uuid(),
      timeoutMs: 30000,
    })
    const raw = llmResult.result as any
    res.json({
      mcp_status: llmResult.status,
      result_type: typeof raw,
      result_keys: raw && typeof raw === 'object' ? Object.keys(raw) : null,
      inner_success: raw?.success,
      content: raw?.content,
      content_type: typeof raw?.content,
      raw_preview: JSON.stringify(raw).slice(0, 500),
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─── GET /health — Intelligence metrics ─────────────────────────────────────

intelligenceRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const [hygiene, writeGate, engagements] = await Promise.allSettled([
      runGraphHygiene(),
      Promise.resolve(getWriteGateStats()),
      listEngagements(5),
    ])

    res.json({
      success: true,
      data: {
        graph_health: hygiene.status === 'fulfilled' ? hygiene.value : { error: 'unavailable' },
        write_gate: writeGate.status === 'fulfilled' ? writeGate.value : { error: 'unavailable' },
        engagement_intelligence: engagements.status === 'fulfilled' ? {
          active_engagements_sample: engagements.value.length,
          latest_engagement_ids: engagements.value.slice(0, 3).map(e => e.$id),
        } : { error: 'unavailable' },
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'HEALTH_CHECK_FAILED', message: String(err), status_code: 500 } })
  }
})

// ─── v4.0.4 — Engagement Intelligence endpoints (LIN-607) ─────────────────
// EIE joins the intelligence cohort alongside document-intelligence,
// hierarchical-intelligence, and adaptive-rag. These endpoints delegate to
// engagement-engine.ts — the canonical /api/engagements/* routes remain the
// primary surface, these mirror them under /api/intelligence/* for cohort
// consistency and discoverability.

intelligenceRouter.post('/engagement/match', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const objective = typeof body.objective === 'string' ? body.objective : ''
  const domain = typeof body.domain === 'string' ? body.domain : ''
  if (objective.length < 5 || domain.length === 0) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'objective (min 5) and domain required', status_code: 400 } })
    return
  }
  try {
    const result = await matchPrecedents({
      objective,
      domain,
      max_results: typeof body.max_results === 'number' ? body.max_results : undefined,
    })
    res.json({ success: true, data: result })
  } catch (err) {
    logger.warn({ error: String(err) }, 'intelligence/engagement/match failed')
    res.status(500).json({ success: false, error: { code: 'MATCH_FAILED', message: err instanceof Error ? err.message : String(err), status_code: 500 } })
  }
})

intelligenceRouter.post('/engagement/plan', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  if (typeof body.objective !== 'string' || typeof body.domain !== 'string'
      || typeof body.duration_weeks !== 'number' || typeof body.team_size !== 'number') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'objective, domain, duration_weeks, team_size required', status_code: 400 } })
    return
  }
  try {
    const plan = await generatePlan({
      objective: body.objective,
      domain: body.domain,
      duration_weeks: body.duration_weeks,
      team_size: body.team_size,
      budget_dkk: typeof body.budget_dkk === 'number' ? body.budget_dkk : undefined,
      engagement_id: typeof body.engagement_id === 'string' ? body.engagement_id : undefined,
    })
    res.json({ success: true, data: plan })
  } catch (err) {
    if (err instanceof PlanGateRejection) {
      res.status(422).json({ success: false, error: { code: err.code, message: err.reason, details: err.details, status_code: 422 } })
      return
    }
    logger.warn({ error: String(err) }, 'intelligence/engagement/plan failed')
    res.status(500).json({ success: false, error: { code: 'PLAN_FAILED', message: err instanceof Error ? err.message : String(err), status_code: 500 } })
  }
})
