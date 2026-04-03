/**
 * routes/governance.ts — Manifesto Governance endpoints (LIN-577).
 *
 * Exposes the 10 WidgeTDC Manifesto Principles as a living enforcement matrix.
 *
 *   GET  /api/governance/matrix      — Full 10-principle enforcement matrix
 *   GET  /api/governance/score       — Enforcement score summary
 *   GET  /api/governance/gaps        — Only principles with gaps
 *   POST /api/governance/sync-graph  — Write/update ManifestoPrinciple nodes to Neo4j
 */
import { Router, Request, Response } from 'express'
import {
  getEnforcementMatrix,
  getEnforcementScore,
  getGaps,
  generateGraphCypher,
  MANIFESTO_PRINCIPLES,
} from '../manifesto-governance.js'
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import { v4 as uuid } from 'uuid'

export const governanceRouter = Router()

/**
 * GET /api/governance/matrix — Full 10-principle enforcement matrix.
 */
governanceRouter.get('/matrix', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      principles: getEnforcementMatrix(),
      score: getEnforcementScore(),
      version: '1.0.0',
      source: 'manifesto-governance.ts',
      governance_model: 'Ambient Enforcement — additive, not subtractive',
    },
  })
})

/**
 * GET /api/governance/score — Enforcement score summary.
 */
governanceRouter.get('/score', (_req: Request, res: Response) => {
  const score = getEnforcementScore()
  res.json({ success: true, data: score })
})

/**
 * GET /api/governance/gaps — Only principles with gaps or partial enforcement.
 */
governanceRouter.get('/gaps', (_req: Request, res: Response) => {
  const gaps = getGaps()
  res.json({
    success: true,
    data: {
      count: gaps.length,
      gaps,
      remediation_available: gaps.filter(g => g.gap_remediation).length,
    },
  })
})

/**
 * POST /api/governance/sync-graph — Write ManifestoPrinciple nodes to Neo4j.
 * Uses MERGE (not CREATE) per governance rules.
 */
governanceRouter.post('/sync-graph', async (_req: Request, res: Response) => {
  try {
    const results: Array<{ principle: number; status: string }> = []

    for (const p of MANIFESTO_PRINCIPLES) {
      try {
        const result = await callMcpTool({
          toolName: 'graph.write_cypher',
          args: {
            query: `MERGE (p:ManifestoPrinciple {number: $number})
SET p.name = $name,
    p.description = $description,
    p.status = $status,
    p.enforcement_layer = $enforcement_layer,
    p.mechanism = $mechanism,
    p.mechanism_detail = $mechanism_detail,
    p.gap_remediation = $gap_remediation,
    p.updatedAt = datetime()
RETURN p.name as name, p.status as status`,
            params: {
              number: p.number,
              name: p.name,
              description: p.description,
              status: p.status,
              enforcement_layer: p.enforcement_layer,
              mechanism: p.mechanism,
              mechanism_detail: p.mechanism_detail,
              gap_remediation: p.gap_remediation ?? '',
            },
          },
          callId: uuid(),
          timeoutMs: 15000,
        })
        results.push({
          principle: p.number,
          status: result.status === 'success' ? 'synced' : 'failed',
        })
      } catch (err) {
        logger.warn({ principle: p.number, err: String(err) }, 'Failed to sync principle to graph')
        results.push({ principle: p.number, status: 'error' })
      }
    }

    const synced = results.filter(r => r.status === 'synced').length
    res.json({
      success: synced > 0,
      data: {
        synced,
        total: MANIFESTO_PRINCIPLES.length,
        results,
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'Governance graph sync failed')
    res.status(500).json({
      success: false,
      error: { code: 'GOVERNANCE_SYNC_ERROR', message: 'Failed to sync governance to graph', status_code: 500 },
    })
  }
})
