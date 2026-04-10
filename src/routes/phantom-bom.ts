/**
 * routes/phantom-bom.ts — PhantomBOM Extractor + Snout MRP API
 *
 *   POST /api/phantom-bom/extract         — Async fire-and-forget repo extraction
 *   POST /api/phantom-bom/extract/sync    — Synchronous repo extraction
 *   GET  /api/phantom-bom/runs            — List all extraction runs
 *   GET  /api/phantom-bom/runs/:id        — Get specific run + BOM
 *
 *   POST /api/phantom-bom/providers       — Ingest LLM provider (Snout MRP FR-01)
 *   GET  /api/phantom-bom/providers       — Provider registry (FR-07)
 *   POST /api/phantom-bom/clusters/generate — Generate PhantomClusters (MRP engine)
 */
import { Router, Request, Response } from 'express'
import { extractPhantomBOM, getRunState, listRuns, extractProvider, generatePhantomClusters, getProviderRegistry } from '../phantom-bom.js'
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

// ─── Snout MRP Routes ─────────────────────────────────────────────────────────

/**
 * POST /api/phantom-bom/providers
 * Ingest an LLM provider (Snout MRP FR-01).
 * Body: { name, source_url, source_type, geo_restriction?, primary_capability?, raw_docs }
 */
phantomBomRouter.post('/providers', async (req: Request, res: Response) => {
  const { name, source_url, source_type, geo_restriction, primary_capability, raw_docs } = req.body as Record<string, string>

  if (!name || !source_url || !raw_docs) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'name, source_url, raw_docs are required', status_code: 400 } })
    return
  }

  const validSourceTypes = ['github', 'huggingface', 'npm', 'manual']
  if (source_type && !validSourceTypes.includes(source_type)) {
    res.status(400).json({ success: false, error: { code: 'INVALID_SOURCE_TYPE', message: `source_type must be one of: ${validSourceTypes.join(', ')}`, status_code: 400 } })
    return
  }

  try {
    const result = await extractProvider({
      name,
      source_url,
      source_type: (source_type ?? 'manual') as 'github' | 'huggingface' | 'npm' | 'manual',
      geo_restriction: geo_restriction as 'global' | 'eu_only' | 'local_only' | 'cn_region' | undefined,
      primary_capability: primary_capability as 'reasoning' | 'code' | 'vision' | 'text_generation' | 'embedding' | 'multimodal' | undefined,
      raw_docs,
    })

    res.json({
      success: true,
      provider: result.provider,
      blocked: result.blocked,
      hitl_issue: result.hitl_issue ?? null,
      cve_count: result.cve_count,
      message: result.blocked
        ? `Provider blocked by HITL gate (confidence ${result.provider.confidence}% < 70%). Linear issue: ${result.hitl_issue ?? 'created'}`
        : `Provider ingested. CVEs linked: ${result.cve_count}`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ name, err: msg }, 'Provider extraction failed')
    res.status(500).json({ success: false, error: { code: 'PROVIDER_EXTRACTION_FAILED', message: msg, status_code: 500 } })
  }
})

/**
 * GET /api/phantom-bom/providers
 * Provider registry — all PhantomProvider nodes from Neo4j.
 */
phantomBomRouter.get('/providers', async (_req: Request, res: Response) => {
  try {
    const registry = await getProviderRegistry()
    res.json({ success: true, ...registry })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ success: false, error: { code: 'REGISTRY_FAILED', message: msg, status_code: 500 } })
  }
})

/**
 * POST /api/phantom-bom/clusters/generate
 * Run MRP clustering engine — groups PhantomProviders into PhantomClusters.
 */
phantomBomRouter.post('/clusters/generate', async (_req: Request, res: Response) => {
  try {
    const clusters = await generatePhantomClusters()
    res.json({
      success: true,
      clusters,
      count: clusters.length,
      message: clusters.length > 0
        ? `Generated ${clusters.length} PhantomCluster(s) and written to Neo4j`
        : 'No clusters generated — insufficient providers or none pass geo/cost/capability filters',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ success: false, error: { code: 'CLUSTER_GENERATION_FAILED', message: msg, status_code: 500 }, stack: err instanceof Error ? err.stack : undefined })
  }
})

/**
 * GET /api/phantom-bom/clusters/debug
 * Debug: return raw provider query results from Neo4j.
 */
phantomBomRouter.get('/clusters/debug', async (_req: Request, res: Response) => {
  try {
    const { callBackendMcp } = await import('../phantom-bom.js')
    const result = await callBackendMcp('graph.read_cypher', {
      query: `MATCH (p:PhantomProvider) RETURN p.providerId as id, p.geoRestriction as geo, p.capabilities as caps, p.costModel as cost, p.confidence as conf, p.hitlRequired as hitl`,
      params: {},
    })
    res.json({ success: true, rawResult: result, count: (result as any)?.results?.length ?? 0 })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err), stack: err instanceof Error ? err.stack : undefined })
  }
})
