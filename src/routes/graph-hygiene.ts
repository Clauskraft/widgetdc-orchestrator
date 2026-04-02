/**
 * routes/graph-hygiene.ts — Knowledge Graph Hygiene endpoints (LIN-574).
 *
 *   POST /api/graph-hygiene/run     — Run all hygiene operations
 *   POST /api/graph-hygiene/fix/:op — Run a specific operation
 *   GET  /api/graph-hygiene/status  — Check graph health metrics
 */
import { Router, Request, Response } from 'express'
import {
  runGraphHygiene,
  fixFrameworkDomainRels,
  consolidateDomains,
  purgeGraphBloat,
} from '../graph-hygiene.js'
import { logger } from '../logger.js'

export const graphHygieneRouter = Router()

/** Mutex — prevent concurrent hygiene runs */
let hygieneInProgress = false

/**
 * POST /api/graph-hygiene/run — Run all hygiene operations (P0→P1→P2).
 */
graphHygieneRouter.post('/run', async (_req: Request, res: Response) => {
  if (hygieneInProgress) {
    res.status(429).json({
      success: false,
      error: { code: 'HYGIENE_IN_PROGRESS', message: 'A hygiene run is already in progress.', status_code: 429 },
    })
    return
  }

  hygieneInProgress = true
  try {
    const report = await runGraphHygiene()
    res.json({ success: true, data: report })
  } catch (err) {
    logger.error({ err: String(err) }, 'Graph hygiene run failed')
    res.status(500).json({ success: false, error: { code: 'HYGIENE_FAILED', message: 'Graph hygiene failed. Check server logs.', status_code: 500 } })
  } finally {
    hygieneInProgress = false
  }
})

/**
 * POST /api/graph-hygiene/fix/:op — Run a specific operation.
 * Valid ops: framework_domain_rels, domain_consolidation, graph_bloat_purge
 */
graphHygieneRouter.post('/fix/:op', async (req: Request, res: Response) => {
  const op = req.params.op

  const ops: Record<string, () => Promise<any>> = {
    framework_domain_rels: fixFrameworkDomainRels,
    domain_consolidation: consolidateDomains,
    graph_bloat_purge: purgeGraphBloat,
  }

  const fn = ops[op]
  if (!fn) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_OPERATION', message: `Valid ops: ${Object.keys(ops).join(', ')}`, status_code: 400 },
    })
    return
  }

  try {
    const result = await fn()
    res.json({ success: true, data: result })
  } catch (err) {
    logger.error({ err: String(err), op }, 'Graph hygiene operation failed')
    res.status(500).json({ success: false, error: { code: 'OPERATION_FAILED', message: 'Operation failed. Check server logs.', status_code: 500 } })
  }
})
