/**
 * routes/deliverables.ts — Automatic Deliverable Generation API (LIN-574 Gap #2)
 *
 * POST /api/deliverables/generate  — Generate report/deck from prompt
 * GET  /api/deliverables           — List generated deliverables
 * GET  /api/deliverables/:id       — Get single deliverable (incl. markdown)
 */
import { Router, Request, Response } from 'express'
import {
  generateDeliverable,
  getDeliverable,
  listDeliverables,
  type DeliverableRequest,
  type DeliverableType,
  type DeliverableFormat,
} from '../engagement/deliverable-engine.js'
import { logger } from '../logger.js'

export const deliverablesRouter = Router()

const VALID_TYPES: DeliverableType[] = ['analysis', 'roadmap', 'assessment']
const VALID_FORMATS: DeliverableFormat[] = ['pdf', 'markdown']

// ─── Rate limiting (in-memory, per-key) ─────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60_000

function isRateLimited(key: string): boolean {
  const now = Date.now()
  // Periodic cleanup: sweep expired entries every 100 calls
  if (rateLimitMap.size > 50) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.windowStart > RATE_WINDOW_MS * 2) rateLimitMap.delete(k)
    }
  }
  const entry = rateLimitMap.get(key)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT
}

// ─── POST /generate — Generate a deliverable ───────────────────────────────

deliverablesRouter.post('/generate', async (req: Request, res: Response) => {
  const apiKey = (req.headers.authorization ?? '').replace('Bearer ', '') || 'anon'
  if (isRateLimited(apiKey)) {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: `Rate limit exceeded (${RATE_LIMIT} req/min)`, status_code: 429 },
    })
    return
  }

  const body = req.body as Record<string, unknown>
  const prompt = body.prompt as string
  const type = body.type as string
  const format = (body.format as string) ?? 'markdown'
  const rawMaxSections = body.max_sections
  const maxSections = (typeof rawMaxSections === 'number' && Number.isInteger(rawMaxSections))
    ? rawMaxSections : undefined

  // Validation
  if (!prompt || typeof prompt !== 'string' || prompt.length < 10) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'prompt is required (min 10 chars)', status_code: 400 },
    })
    return
  }

  if (!type || !VALID_TYPES.includes(type as DeliverableType)) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: `type must be one of: ${VALID_TYPES.join(', ')}`, status_code: 400 },
    })
    return
  }

  if (format && !VALID_FORMATS.includes(format as DeliverableFormat)) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: `format must be one of: ${VALID_FORMATS.join(', ')}`, status_code: 400 },
    })
    return
  }

  const request: DeliverableRequest = {
    prompt: prompt.slice(0, 2000),
    type: type as DeliverableType,
    format: format as DeliverableFormat,
    max_sections: maxSections,
  }

  logger.info({ prompt: prompt.slice(0, 80), type, format }, 'Deliverable generation requested')

  try {
    const deliverable = await generateDeliverable(request)

    res.json({
      success: true,
      data: {
        deliverable_id: deliverable.$id,
        title: deliverable.title,
        status: deliverable.status,
        format: deliverable.format,
        sections_count: deliverable.metadata.sections_count,
        total_citations: deliverable.metadata.total_citations,
        avg_confidence: deliverable.metadata.avg_confidence,
        generation_ms: deliverable.metadata.generation_ms,
        url: `/api/deliverables/${encodeURIComponent(deliverable.$id)}`,
        markdown_url: `/api/deliverables/${encodeURIComponent(deliverable.$id)}/markdown`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('Too many concurrent') ? 429 : 500
    res.status(status).json({
      success: false,
      error: { code: status === 429 ? 'RATE_LIMITED' : 'GENERATION_FAILED', message, status_code: status },
    })
  }
})

// ─── GET / — List deliverables ──────────────────────────────────────────────

deliverablesRouter.get('/', async (_req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(_req.query.limit ?? '20')), 1), 100)
  const deliverables = await listDeliverables(limit)

  res.json({
    success: true,
    data: deliverables.map(d => ({
      deliverable_id: d.$id,
      title: d.title,
      type: d.type,
      status: d.status,
      sections_count: d.metadata.sections_count,
      total_citations: d.metadata.total_citations,
      generation_ms: d.metadata.generation_ms,
      created_at: d.created_at,
    })),
    total: deliverables.length,
  })
})

// ─── GET /:id — Single deliverable ─────────────────────────────────────────

deliverablesRouter.get('/:id', async (req: Request, res: Response) => {
  const deliverable = await getDeliverable(decodeURIComponent(req.params.id))
  if (!deliverable) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Deliverable not found', status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: deliverable })
})

// ─── GET /:id/markdown — Raw markdown download ─────────────────────────────

deliverablesRouter.get('/:id/markdown', async (req: Request, res: Response) => {
  const deliverable = await getDeliverable(decodeURIComponent(req.params.id))
  if (!deliverable) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Deliverable not found', status_code: 404 },
    })
    return
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${deliverable.title.replace(/[^a-zA-Z0-9-_ ]/g, '')}.md"`)
  res.send(deliverable.markdown)
})
