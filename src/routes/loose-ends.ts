/**
 * routes/loose-ends.ts — Loose-End Detector API (LIN-535)
 *
 * Automated detection of unresolved dependencies, contradictions,
 * and orphaned blocks across the synthesis funnel.
 *
 * POST /api/loose-ends/scan     — Run full detection suite
 * GET  /api/loose-ends           — Get latest scan results
 * GET  /api/loose-ends/history   — Scan history
 */
import { Router, Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'
import { broadcastSSE } from '../sse.js'

export const looseEndsRouter = Router()

const REDIS_KEY = 'orchestrator:loose-ends:latest'
const REDIS_HISTORY = 'orchestrator:loose-ends:history'

/* ─── Types ──────────────────────────────────────────────────────────────── */

type FindingSeverity = 'critical' | 'warning' | 'info'

interface LooseEndFinding {
  id: string
  severity: FindingSeverity
  category: 'orphan_block' | 'contradictory_blocks' | 'missing_lineage' | 'dangling_assembly' | 'unresolved_decision' | 'disconnected_node'
  title: string
  description: string
  node_ids: string[]
  suggested_action: string
}

export interface LooseEndScanResult {
  scan_id: string
  scanned_at: string
  duration_ms: number
  findings: LooseEndFinding[]
  summary: {
    critical: number
    warning: number
    info: number
    total: number
  }
  auto_fixed: number
}

/* ─── Detection Queries ──────────────────────────────────────────────────── */

interface DetectionQuery {
  name: string
  category: LooseEndFinding['category']
  severity: FindingSeverity
  cypher: string
  buildFinding: (records: any[]) => LooseEndFinding[]
}

const DETECTION_QUERIES: DetectionQuery[] = [
  {
    name: 'Orphan Blocks (no assembly)',
    category: 'orphan_block',
    severity: 'warning',
    cypher: `MATCH (b) WHERE (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
AND NOT (b)<-[:COMPOSED_OF]-(:Assembly)
RETURN b.id AS id, b.name AS name, b.domain AS domain, labels(b)[0] AS type
LIMIT 25`,
    buildFinding: (records) => records.map(r => ({
      id: `orphan-${r.id ?? uuid().slice(0, 8)}`,
      severity: 'warning' as const,
      category: 'orphan_block' as const,
      title: `Orphan block: ${r.name ?? r.id}`,
      description: `Block "${r.name}" (${r.type}, domain: ${r.domain}) is not part of any assembly`,
      node_ids: [String(r.id)],
      suggested_action: 'Include in an assembly via POST /api/assembly/compose or archive if obsolete',
    })),
  },
  {
    name: 'Assemblies without decisions',
    category: 'dangling_assembly',
    severity: 'warning',
    cypher: `MATCH (a:Assembly) WHERE a.status = 'accepted'
AND NOT (a)<-[:BASED_ON]-(:Decision)
RETURN a.id AS id, a.name AS name, a.composite AS score
LIMIT 15`,
    buildFinding: (records) => records.map(r => ({
      id: `dangling-asm-${r.id ?? uuid().slice(0, 8)}`,
      severity: 'warning' as const,
      category: 'dangling_assembly' as const,
      title: `Accepted assembly without decision: ${r.name ?? r.id}`,
      description: `Assembly "${r.name}" was accepted (score: ${r.score}) but no Decision node references it`,
      node_ids: [String(r.id)],
      suggested_action: 'Create a Decision via POST /api/decisions/certify or reject the assembly',
    })),
  },
  {
    name: 'Decisions without lineage',
    category: 'missing_lineage',
    severity: 'critical',
    cypher: `MATCH (d:Decision) WHERE NOT (d)-[:BASED_ON]->(:Assembly)
AND NOT (d)-[:DERIVES_FROM]->()
RETURN d.id AS id, d.title AS title, d.certified_at AS certified_at
LIMIT 10`,
    buildFinding: (records) => records.map(r => ({
      id: `no-lineage-${r.id ?? uuid().slice(0, 8)}`,
      severity: 'critical' as const,
      category: 'missing_lineage' as const,
      title: `Decision without lineage: ${r.title ?? r.id}`,
      description: `Decision "${r.title}" has no traceable lineage to assemblies or source signals`,
      node_ids: [String(r.id)],
      suggested_action: 'Link decision to source assembly or re-certify with proper lineage',
    })),
  },
  {
    name: 'Disconnected high-value nodes',
    category: 'disconnected_node',
    severity: 'info',
    cypher: `MATCH (n) WHERE (n:StrategicInsight OR n:Pattern OR n:Signal)
AND NOT (n)-[]-()
RETURN n.id AS id, labels(n)[0] AS type, n.domain AS domain, n.insight AS title
LIMIT 20`,
    buildFinding: (records) => records.map(r => ({
      id: `disconnected-${r.id ?? uuid().slice(0, 8)}`,
      severity: 'info' as const,
      category: 'disconnected_node' as const,
      title: `Disconnected ${r.type}: ${(r.title ?? r.id ?? '').toString().slice(0, 60)}`,
      description: `${r.type} node in domain "${r.domain}" has no relationships — may be a missed connection`,
      node_ids: [String(r.id)],
      suggested_action: 'Review and connect to related blocks or mark as processed',
    })),
  },
  {
    name: 'Unresolved decisions (stale drafts)',
    category: 'unresolved_decision',
    severity: 'warning',
    cypher: `MATCH (d:Decision) WHERE d.status = 'draft'
AND d.created_at < datetime() - duration('P7D')
RETURN d.id AS id, d.title AS title, d.created_at AS created_at
LIMIT 10`,
    buildFinding: (records) => records.map(r => ({
      id: `stale-decision-${r.id ?? uuid().slice(0, 8)}`,
      severity: 'warning' as const,
      category: 'unresolved_decision' as const,
      title: `Stale draft decision: ${r.title ?? r.id}`,
      description: `Decision "${r.title}" has been in draft for >7 days (created: ${r.created_at})`,
      node_ids: [String(r.id)],
      suggested_action: 'Certify, reject, or archive the stale decision',
    })),
  },
]

/* ─── Scan Engine ────────────────────────────────────────────────────────── */

export async function runLooseEndScan(): Promise<LooseEndScanResult> {
  const scanId = uuid()
  const t0 = Date.now()
  const findings: LooseEndFinding[] = []

  logger.info({ scan_id: scanId }, 'Loose-end scan started')

  // Run all detection queries in parallel
  const queryResults = await Promise.allSettled(
    DETECTION_QUERIES.map(async (dq) => {
      try {
        const result = await callMcpTool({
          toolName: 'graph.read_cypher',
          args: { query: dq.cypher },
          callId: uuid(),
          timeoutMs: 15000,
        })

        if (result.status !== 'success') return []

        const records = Array.isArray(result.result) ? result.result
          : Array.isArray((result.result as any)?.records) ? (result.result as any).records
          : []

        return dq.buildFinding(records)
      } catch (err) {
        logger.warn({ query: dq.name, err: String(err) }, 'Loose-end detection query failed')
        return []
      }
    })
  )

  for (const qr of queryResults) {
    if (qr.status === 'fulfilled') {
      findings.push(...qr.value)
    }
  }

  const summary = {
    critical: findings.filter(f => f.severity === 'critical').length,
    warning: findings.filter(f => f.severity === 'warning').length,
    info: findings.filter(f => f.severity === 'info').length,
    total: findings.length,
  }

  const scanResult: LooseEndScanResult = {
    scan_id: scanId,
    scanned_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    findings,
    summary,
    auto_fixed: 0,
  }

  // Persist to Redis
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(scanResult), 'EX', 86400)
      // Add to history (sorted set, keep 30 entries)
      await redis.zadd(REDIS_HISTORY, Date.now(), JSON.stringify(scanResult))
      const count = await redis.zcard(REDIS_HISTORY)
      if (count > 30) {
        await redis.zremrangebyrank(REDIS_HISTORY, 0, count - 31)
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to persist loose-end scan')
    }
  }

  // Persist summary to Neo4j
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (s:LooseEndScan {id: $id})
SET s.scanned_at = datetime(), s.duration_ms = $duration,
    s.critical = $critical, s.warning = $warning, s.info = $info,
    s.total = $total, s.auto_fixed = 0`,
        params: {
          id: scanId,
          duration: scanResult.duration_ms,
          critical: summary.critical,
          warning: summary.warning,
          info: summary.info,
          total: summary.total,
        },
        intent: 'Persist loose-end scan summary to graph for trend tracking',
        purpose: 'Maintain LooseEndScan history to detect recurring platform issues',
        objective: 'Record scan outcome for cross-session analysis',
        evidence: `Scan ${scanId}: ${summary.total} items (critical=${summary.critical} warning=${summary.warning} info=${summary.info})`,
        verification: 'Read-back via MATCH (s:LooseEndScan {id: $id}) RETURN s',
        test_results: `duration_ms=${scanResult.duration_ms} total=${summary.total}`,
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
  } catch { /* non-critical */ }

  // Broadcast via SSE
  broadcastSSE('loose-end-scan', {
    scan_id: scanId,
    summary,
    duration_ms: scanResult.duration_ms,
  })

  logger.info({
    scan_id: scanId,
    ...summary,
    duration_ms: scanResult.duration_ms,
  }, 'Loose-end scan complete')

  return scanResult
}

/* ─── POST /scan — Run detection suite ───────────────────────────────────── */

looseEndsRouter.post('/scan', async (_req: Request, res: Response) => {
  try {
    const result = await runLooseEndScan()
    res.json({ success: true, data: result })
  } catch (err) {
    logger.error({ err: String(err) }, 'Loose-end scan failed')
    res.status(500).json({
      success: false,
      error: { code: 'SCAN_ERROR', message: String(err), status_code: 500 },
    })
  }
})

/* ─── GET / — Latest scan results ────────────────────────────────────────── */

looseEndsRouter.get('/', async (_req: Request, res: Response) => {
  const redis = getRedis()
  if (!redis) {
    res.json({ success: true, data: null, message: 'No scan results available' })
    return
  }

  try {
    const raw = await redis.get(REDIS_KEY)
    if (!raw) {
      res.json({ success: true, data: null, message: 'No scan has been run yet' })
      return
    }
    res.json({ success: true, data: JSON.parse(raw) })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

/* ─── GET /history — Scan history ────────────────────────────────────────── */

looseEndsRouter.get('/history', async (req: Request, res: Response) => {
  const redis = getRedis()
  const limit = Math.min(parseInt(String(req.query.limit ?? '10')), 30)

  if (!redis) {
    res.json({ success: true, data: { scans: [], total: 0 } })
    return
  }

  try {
    const raw = await redis.zrevrange(REDIS_HISTORY, 0, limit - 1)
    const scans = raw.map(r => {
      const parsed = JSON.parse(r)
      // Return summary only for history (not full findings)
      return {
        scan_id: parsed.scan_id,
        scanned_at: parsed.scanned_at,
        duration_ms: parsed.duration_ms,
        summary: parsed.summary,
        auto_fixed: parsed.auto_fixed,
      }
    })
    res.json({ success: true, data: { scans, total: scans.length } })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})
