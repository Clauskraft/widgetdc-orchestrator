/**
 * routes/intelligence.ts — v3.0 Intelligence Engine API
 *
 * POST /api/intelligence/ingest     — Document ingestion (F2)
 * POST /api/intelligence/communities — Build community summaries (F3)
 * GET  /api/intelligence/health      — Graph health + intelligence metrics
 */
import { Router, Request, Response } from 'express'
import { ingestDocument, type DocumentIngestionRequest } from '../document-intelligence.js'
import { buildCommunitySummaries, searchCommunitySummaries } from '../hierarchical-intelligence.js'
import { runGraphHygiene } from '../graph-hygiene-cron.js'
import { getWriteGateStats } from '../write-gate.js'
import { getAdaptiveRAGDashboard, retrainRoutingWeights } from '../adaptive-rag.js'
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

// ─── GET /health — Intelligence metrics ─────────────────────────────────────

intelligenceRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const [hygiene, writeGate] = await Promise.allSettled([
      runGraphHygiene(),
      Promise.resolve(getWriteGateStats()),
    ])

    res.json({
      success: true,
      data: {
        graph_health: hygiene.status === 'fulfilled' ? hygiene.value : { error: 'unavailable' },
        write_gate: writeGate.status === 'fulfilled' ? writeGate.value : { error: 'unavailable' },
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'HEALTH_CHECK_FAILED', message: String(err), status_code: 500 } })
  }
})
