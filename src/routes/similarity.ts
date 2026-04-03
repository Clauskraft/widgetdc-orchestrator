/**
 * routes/similarity.ts — Client Similarity & Precedent Search API (LIN-574 Gap #4)
 *
 * POST /api/similarity/search     — Find similar clients/engagements
 * GET  /api/similarity/client/:id — Get client details with relationships
 */
import { Router, Request, Response } from 'express'
import {
  findSimilarClients,
  getClientDetails,
  type SimilarityRequest,
  type SimilarityDimension,
} from '../similarity-engine.js'
import { hookSimilarityPreference } from '../compound-hooks.js'
import { logger } from '../logger.js'

export const similarityRouter = Router()

const VALID_DIMENSIONS: SimilarityDimension[] = [
  'industry', 'service', 'challenge', 'domain', 'size', 'geography', 'deliverable',
]

// ─── POST /search — Find similar clients ────────────────────────────────────

similarityRouter.post('/search', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const query = body.query as string

  if (!query || typeof query !== 'string' || query.length < 3) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'query is required (min 3 chars)', status_code: 400 },
    })
    return
  }

  // Validate dimensions if provided
  const rawDimensions = body.dimensions as string[] | undefined
  let dimensions: SimilarityDimension[] | undefined
  if (rawDimensions && Array.isArray(rawDimensions)) {
    const invalid = rawDimensions.filter(d => !VALID_DIMENSIONS.includes(d as SimilarityDimension))
    if (invalid.length > 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Invalid dimensions: ${invalid.join(', ')}. Valid: ${VALID_DIMENSIONS.join(', ')}`, status_code: 400 },
      })
      return
    }
    dimensions = rawDimensions as SimilarityDimension[]
  }

  const rawWeight = body.structural_weight
  const structuralWeight = (typeof rawWeight === 'number' && rawWeight >= 0 && rawWeight <= 1)
    ? rawWeight : undefined

  const rawMax = body.max_results
  const maxResults = (typeof rawMax === 'number' && Number.isInteger(rawMax) && rawMax > 0)
    ? rawMax : undefined

  const request: SimilarityRequest = {
    query: query.slice(0, 500),
    dimensions,
    max_results: maxResults,
    structural_weight: structuralWeight,
  }

  logger.info({ query: query.slice(0, 80) }, 'Similarity search requested')

  try {
    const result = await findSimilarClients(request)

    res.json({
      success: true,
      data: {
        query: result.query,
        query_node_id: result.query_node_id,
        method: result.method,
        matches: result.matches,
        total_candidates: result.total_candidates,
        dimensions_used: result.dimensions_used,
        duration_ms: result.duration_ms,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({
      success: false,
      error: { code: 'SIMILARITY_FAILED', message, status_code: 500 },
    })
  }
})

// ─── POST /select — Log user preference (flywheel signal) ─────────────────

similarityRouter.post('/select', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const queryId = body.query_id as string
  const selectedMatchId = body.selected_match_id as string
  const rejectedMatchIds = body.rejected_match_ids as string[]

  if (!selectedMatchId || typeof selectedMatchId !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'selected_match_id is required', status_code: 400 },
    })
    return
  }

  if (!Array.isArray(rejectedMatchIds) || rejectedMatchIds.length === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'rejected_match_ids must be a non-empty array', status_code: 400 },
    })
    return
  }

  logger.info({ queryId, selected: selectedMatchId, rejected: rejectedMatchIds.length }, 'Similarity preference received')

  hookSimilarityPreference(queryId || 'unknown', selectedMatchId, rejectedMatchIds).catch(() => {})

  res.json({ success: true, data: { message: 'Preference logged', selected: selectedMatchId, rejected_count: rejectedMatchIds.length } })
})

// ─── GET /client/:id — Client details with relationships ───────────────────

similarityRouter.get('/client/:id', async (req: Request, res: Response) => {
  const clientId = decodeURIComponent(req.params.id)
  const details = await getClientDetails(clientId)

  if (!details) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Client not found', status_code: 404 },
    })
    return
  }

  res.json({ success: true, data: details })
})
