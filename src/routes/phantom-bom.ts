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
import { config } from '../config.js'
import { recommendPhantomSkillLoop } from '../services/phantom-loop-selector.js'

export const phantomBomRouter = Router()

/** Mutex: max 3 concurrent extractions */
let activeExtractions = 0
const MAX_CONCURRENT = 3

/**
 * POST /api/phantom-bom/skills/route
 * Body: { intent: string, repo_or_domain: string }
 * Returns the recommended autonomous loop based on Phantom evidence.
 */
phantomBomRouter.post('/skills/route', async (req: Request, res: Response) => {
  const { intent, repo_or_domain } = req.body as { intent?: string; repo_or_domain?: string }

  if (!intent || typeof intent !== 'string' || intent.trim().length < 4) {
    res.status(400).json({ success: false, error: { code: 'MISSING_INTENT', message: 'intent is required (min 4 chars)', status_code: 400 } })
    return
  }

  if (!repo_or_domain || typeof repo_or_domain !== 'string' || repo_or_domain.trim().length < 2) {
    res.status(400).json({ success: false, error: { code: 'MISSING_REPO_OR_DOMAIN', message: 'repo_or_domain is required (min 2 chars)', status_code: 400 } })
    return
  }

  try {
    const recommendation = await recommendPhantomSkillLoop(intent.trim(), repo_or_domain.trim())
    res.json({ success: true, recommendation })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ intent, repo_or_domain, err: msg }, 'Phantom skill routing failed')
    res.status(500).json({ success: false, error: { code: 'PHANTOM_SKILL_ROUTING_FAILED', message: msg, status_code: 500 } })
  }
})

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
 * Debug: return raw provider query results from Neo4j via direct backend call.
 */
phantomBomRouter.get('/clusters/debug', async (_req: Request, res: Response) => {
  try {
    const backendRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({
        tool: 'graph.read_cypher',
        payload: {
          query: `MATCH (p:PhantomProvider) RETURN p.providerId as id, p.geoRestriction as geo, p.capabilities as caps, p.costModel as cost, p.confidence as conf, p.hitlRequired as hitl`,
        },
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await backendRes.json()
    const results = data?.result?.results ?? data?.results ?? []
    res.json({
      success: true,
      rawQuery: `MATCH (p:PhantomProvider) RETURN p.providerId as id, p.geoRestriction as geo, p.capabilities as caps, p.costModel as cost, p.confidence as conf, p.hitlRequired as hitl`,
      resultCount: results.length,
      sample: results.slice(0, 3),
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err), stack: err instanceof Error ? err.stack : undefined })
  }
})
