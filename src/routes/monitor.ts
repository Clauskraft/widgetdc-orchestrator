/**
 * routes/monitor.ts — Evolution & Feature monitoring endpoints.
 *
 * Provides a unified view of all 6 research features and graph health:
 *   GET /monitor/status    — Overall system evolution status
 *   GET /monitor/features  — Feature-by-feature status
 *   POST /monitor/self-correct — Trigger self-correcting graph agent
 *   POST /monitor/compress — Test context compression
 */
import { Router, Request, Response } from 'express'
import { callMcpTool } from '../mcp-caller.js'
import { runSelfCorrect } from '../graph-self-correct.js'
import { compressContext, expandContext } from '../context-compress.js'
import { dualChannelRAG } from '../dual-rag.js'
import { listExecutions } from '../chain-engine.js'
import { listCronJobs } from '../cron-scheduler.js'
import { isRlmAvailable } from '../cognitive-proxy.js'
import { logger } from '../logger.js'
import { v4 as uuid } from 'uuid'

export const monitorRouter = Router()

async function graphRead(cypher: string): Promise<any[]> {
  const result = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: { query: cypher },
    callId: uuid(),
    timeoutMs: 10000,
  })
  if (result.status !== 'success') return []
  const data = result.result as any
  return data?.results || data || []
}

function neo4jInt(val: any): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'object' && 'low' in val) return val.low
  return Number(val) || 0
}

// ─── GET /status — Overall evolution dashboard ──────────────────────────────

monitorRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const [
      evolutionEvents,
      failureMemory,
      selfCorrections,
      biTemporalNodes,
      graphStats,
    ] = await Promise.all([
      graphRead(`
        MATCH (e:EvolutionEvent)
        WHERE e.timestamp > datetime() - duration('P7D')
        RETURN count(e) AS events_7d,
               avg(toFloat(coalesce(e.pass_rate, 0))) AS avg_pass_rate,
               max(e.timestamp) AS latest
      `),
      graphRead(`
        MATCH (f:FailureMemory)
        RETURN count(f) AS total,
               sum(CASE WHEN f.resolved IS NOT NULL THEN 1 ELSE 0 END) AS resolved
      `),
      graphRead(`
        MATCH (s:SelfCorrectionEvent)
        RETURN count(s) AS runs,
               sum(s.total_fixed) AS total_fixed,
               max(s.timestamp) AS latest
        LIMIT 1
      `),
      graphRead(`
        MATCH (n)
        WHERE n.valid_from IS NOT NULL
        RETURN count(n) AS temporal_nodes
      `),
      graphRead(`
        MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count
        ORDER BY count DESC LIMIT 15
      `),
    ])

    const ev = evolutionEvents[0] || {}
    const fm = failureMemory[0] || {}
    const sc = selfCorrections[0] || {}
    const bt = biTemporalNodes[0] || {}

    const cronJobs = listCronJobs()
    const recentChains = listExecutions().slice(0, 5)

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        evolution: {
          events_last_7d: neo4jInt(ev.events_7d),
          avg_pass_rate: ev.avg_pass_rate ?? null,
          latest_event: ev.latest,
        },
        failure_memory: {
          total: neo4jInt(fm.total),
          resolved: neo4jInt(fm.resolved),
          unresolved: neo4jInt(fm.total) - neo4jInt(fm.resolved),
        },
        self_corrections: {
          total_runs: neo4jInt(sc.runs),
          total_fixed: neo4jInt(sc.total_fixed),
          latest_run: sc.latest,
        },
        bi_temporal: {
          nodes_with_temporal_metadata: neo4jInt(bt.temporal_nodes),
        },
        features: {
          '1_bi_temporal_edges': neo4jInt(bt.temporal_nodes) > 0 ? 'active' : 'pending',
          '2_self_correcting_graph': neo4jInt(sc.runs) > 0 ? 'active' : 'registered',
          '3_context_compression': isRlmAvailable() ? 'available' : 'no_rlm',
          '4_adaptive_graph_of_thoughts': 'active',
          '5_gvu_debate': 'active',
          '6_dual_channel_rag': 'active',
        },
        cron_jobs: cronJobs.map(j => ({
          id: j.id,
          name: j.name,
          schedule: j.schedule,
          enabled: j.enabled,
          last_run: j.last_run,
          last_status: j.last_status,
          run_count: j.run_count,
        })),
        recent_chains: recentChains.map(c => ({
          name: c.name,
          mode: c.mode,
          status: c.status,
          steps: `${c.steps_completed}/${c.steps_total}`,
          duration_ms: c.duration_ms,
          started_at: c.started_at,
        })),
        graph_stats: graphStats.map((r: any) => ({
          label: r.label,
          count: neo4jInt(r.count),
        })),
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'Monitor status error')
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ─── GET /features — Detailed feature status ────────────────────────────────

monitorRouter.get('/features', async (_req: Request, res: Response) => {
  const features = [
    {
      id: 1,
      name: 'Bi-Temporal Edges',
      source: 'Graphiti/Zep (2024)',
      status: 'active',
      description: 'Nodes get valid_from/valid_to + temporal_version. Self-correcting agent adds temporal metadata to nodes missing it.',
      endpoint: null,
      cron: 'graph-self-correct (adds bi-temporal metadata)',
    },
    {
      id: 2,
      name: 'Self-Correcting Graph Agent',
      source: 'Globant (2025)',
      status: 'active',
      description: 'Detects orphaned nodes, stale failures, missing metadata, duplicates. Runs every 2 hours via cron.',
      endpoint: 'POST /monitor/self-correct',
      cron: 'graph-self-correct (every 2h)',
    },
    {
      id: 3,
      name: 'Active Context Compression',
      source: 'arXiv 2601.07190',
      status: isRlmAvailable() ? 'active' : 'degraded',
      description: 'Context Folding IN/OUT via RLM Engine. Strategies: fold, truncate, dedupe, hybrid.',
      endpoint: 'POST /monitor/compress',
      cron: null,
    },
    {
      id: 4,
      name: 'Adaptive Graph of Thoughts (AGoT)',
      source: 'arXiv 2502.05078',
      status: 'active',
      description: 'Chain engine auto-selects topology (sequential/parallel/debate) based on query complexity classification.',
      endpoint: 'POST /chains/execute (mode: adaptive)',
      cron: null,
    },
    {
      id: 5,
      name: 'GVU Self-Improvement Loop',
      source: 'Chojecki (2025)',
      status: 'active',
      description: 'Generator-Verifier-Updater pattern in debate chains. Judge scores positions 0-1, enforces confidence threshold.',
      endpoint: 'POST /chains/execute (mode: debate)',
      cron: null,
    },
    {
      id: 6,
      name: 'Dual-Channel RAG',
      source: 'Nature (2025)',
      status: 'active',
      description: 'Parallel SRAG vector search + Neo4j Cypher path traversal, merged by relevance score.',
      endpoint: 'POST /chat/rag',
      cron: null,
    },
  ]

  res.json({ success: true, data: { features, count: features.length } })
})

// ─── POST /self-correct — Manual trigger ─────────────────────────────────────

monitorRouter.post('/self-correct', async (_req: Request, res: Response) => {
  try {
    const report = await runSelfCorrect()
    res.json({ success: true, data: report })
  } catch (err) {
    logger.error({ err: String(err) }, 'Self-correct trigger error')
    res.status(500).json({ success: false, error: String(err) })
  }
})

// ─── POST /compress — Test context compression ──────────────────────────────

monitorRouter.post('/compress', async (req: Request, res: Response) => {
  const { content, strategy, max_tokens, expand_format } = req.body
  if (!content || typeof content !== 'string') {
    res.status(400).json({ success: false, error: 'content (string) required' })
    return
  }

  try {
    const result = await compressContext(content, {
      strategy: strategy ?? 'hybrid',
      maxTokens: max_tokens,
    })

    let expanded: string | undefined
    if (expand_format) {
      expanded = await expandContext(result.content, expand_format)
    }

    res.json({
      success: true,
      data: {
        ...result,
        ...(expanded ? { expanded } : {}),
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'Compress error')
    res.status(500).json({ success: false, error: String(err) })
  }
})
