/**
 * routes/phantom-bom.ts — PhantomBOM Extractor API
 *
 *   POST /api/phantom-bom/extract       — Async fire-and-forget extraction
 *   POST /api/phantom-bom/extract/sync  — Synchronous extraction (waits for result)
 *   GET  /api/phantom-bom/runs          — List all extraction runs
 *   GET  /api/phantom-bom/runs/:id      — Get specific run + components
 */
import { Router, Request, Response } from 'express'
import { extractPhantomBOM, getRunState, listRuns } from '../phantom-bom.js'
import { logger } from '../logger.js'

export const phantomBomRouter = Router()

/** Mutex: max 3 concurrent extractions */
let activeExtractions = 0
const MAX_CONCURRENT = 3

/**
 * POST /api/phantom-bom/extract
 * Body: { repo_url: string, source_type?: 'git'|'huggingface' }
 * Returns immediately with run_id for polling.
 */
phantomBomRouter.post('/extract', async (req: Request, res: Response) => {
  const { repo_url, source_type = 'git' } = req.body as { repo_url?: string; source_type?: string }

  if (!repo_url || typeof repo_url !== 'string') {
    res.status(400).json({ success: false, error: { code: 'MISSING_REPO_URL', message: 'repo_url is required', status_code: 400 } })
    return
  }

  if (!['git', 'huggingface'].includes(source_type)) {
    res.status(400).json({ success: false, error: { code: 'INVALID_SOURCE_TYPE', message: 'source_type must be git or huggingface', status_code: 400 } })
    return
  }

  if (activeExtractions >= MAX_CONCURRENT) {
    res.status(429).json({ success: false, error: { code: 'TOO_MANY_EXTRACTIONS', message: `Max ${MAX_CONCURRENT} concurrent extractions. Try again shortly.`, status_code: 429 } })
    return
  }

  const runId = `pbom-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

  // Fire and forget
  activeExtractions++
  extractPhantomBOM(repo_url, source_type as 'git' | 'huggingface', runId)
    .catch(err => logger.error({ runId, err: String(err) }, 'Async PhantomBOM extraction failed'))
    .finally(() => { activeExtractions-- })

  res.json({
    success: true,
    run_id: runId,
    status: 'running',
    poll: `/api/phantom-bom/runs/${runId}`,
    message: 'Extraction started. Poll the run endpoint for status.',
  })
})

/**
 * POST /api/phantom-bom/extract/sync
 * Body: { repo_url: string, source_type?: 'git'|'huggingface' }
 * Waits for extraction to complete (up to 3 minutes). Use for testing.
 */
phantomBomRouter.post('/extract/sync', async (req: Request, res: Response) => {
  const { repo_url, source_type = 'git' } = req.body as { repo_url?: string; source_type?: string }

  if (!repo_url || typeof repo_url !== 'string') {
    res.status(400).json({ success: false, error: { code: 'MISSING_REPO_URL', message: 'repo_url is required', status_code: 400 } })
    return
  }

  if (!['git', 'huggingface'].includes(source_type)) {
    res.status(400).json({ success: false, error: { code: 'INVALID_SOURCE_TYPE', message: 'source_type must be git or huggingface', status_code: 400 } })
    return
  }

  if (activeExtractions >= MAX_CONCURRENT) {
    res.status(429).json({ success: false, error: { code: 'TOO_MANY_EXTRACTIONS', message: `Max ${MAX_CONCURRENT} concurrent extractions.`, status_code: 429 } })
    return
  }

  activeExtractions++
  try {
    const bom = await extractPhantomBOM(repo_url, source_type as 'git' | 'huggingface')
    res.json({ success: true, bom })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ repo_url, err: msg }, 'Sync PhantomBOM extraction failed')
    res.status(500).json({ success: false, error: { code: 'EXTRACTION_FAILED', message: msg, status_code: 500 } })
  } finally {
    activeExtractions--
  }
})

/**
 * GET /api/phantom-bom/runs
 * List all PhantomBOM runs (in-memory, current process).
 */
phantomBomRouter.get('/runs', (_req: Request, res: Response) => {
  const runs = listRuns()
  res.json({ success: true, runs, count: runs.length, active_extractions: activeExtractions })
})

/**
 * GET /api/phantom-bom/runs/:id
 * Get full BOM for a specific run.
 */
phantomBomRouter.get('/runs/:id', (req: Request, res: Response) => {
  const state = getRunState(req.params.id)
  if (!state) {
    res.status(404).json({ success: false, error: { code: 'RUN_NOT_FOUND', message: `Run ${req.params.id} not found`, status_code: 404 } })
    return
  }
  res.json({
    success: true,
    run_id: req.params.id,
    status: state.status,
    startedAt: state.startedAt,
    bom: state.bom ?? null,
    error: state.error ?? null,
  })
})
