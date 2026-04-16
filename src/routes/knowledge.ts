/**
 * routes/knowledge.ts — Knowledge Cards + Daily Feed endpoints
 * G2.5: GET /api/knowledge/cards — MCP-backed knowledge card search
 * G2.6: GET /api/knowledge/feed — Cached daily knowledge briefing
 */
import { Router, Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { config } from '../config.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'

export const knowledgeRouter = Router()

const FEED_CACHE_KEY = 'orchestrator:knowledge-feed'
const BRIEFING_CACHE_KEY = 'orchestrator:knowledge-briefing-prompt'
const FEED_TTL_SECONDS = 86400 // 24h
const MCP_TIMEOUT_MS = 10000   // 10s for knowledge calls

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

interface McpResult {
  ok: boolean
  data?: unknown
  error?: string
}

async function callMcp(tool: string, payload: Record<string, unknown>): Promise<McpResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS)

  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ tool, payload }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return { ok: false, error: `MCP ${tool} returned ${res.status}` }
    }

    const data = await res.json()
    return { ok: true, data }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `MCP ${tool} failed: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

interface KnowledgeCard {
  id: string
  title: string
  summary: string
  score: number
  domain: string
  source_ref: string
}

function normalizeCards(raw: unknown, source: string): KnowledgeCard[] {
  if (!raw || typeof raw !== 'object') return []

  // Handle various MCP response shapes
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>).results)
      ? (raw as Record<string, unknown>).results as unknown[]
      : Array.isArray((raw as Record<string, unknown>).data)
        ? (raw as Record<string, unknown>).data as unknown[]
        : Array.isArray((raw as Record<string, unknown>).entries)
          ? (raw as Record<string, unknown>).entries as unknown[]
          : []

  return items.map((item: unknown, idx: number) => {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return {
      id: String(r.id ?? r.node_id ?? `${source}-${idx}`),
      title: String(r.title ?? r.name ?? r.label ?? 'Untitled'),
      summary: String(r.summary ?? r.content ?? r.text ?? r.description ?? ''),
      score: typeof r.score === 'number' ? r.score : typeof r.relevance === 'number' ? r.relevance : 0,
      domain: String(r.domain ?? r.type ?? r.category ?? 'unknown'),
      source_ref: String(r.source_ref ?? r.source ?? r.url ?? source),
    }
  })
}

/* ─── G2.5: GET /cards ─────────────────────────────────────────────────────── */

knowledgeRouter.get('/cards', async (req: Request, res: Response) => {
  const q = req.query.q as string
  if (!q) {
    res.status(400).json({ cards: [], error: 'Missing required query param: q', query: '' })
    return
  }

  const topK = Math.min(Math.max(parseInt(req.query.top_k as string) || 5, 1), 50)
  const domains = (req.query.domains as string) || 'all'

  // Try kg_rag.query first
  const kgResult = await callMcp('kg_rag.query', { question: q, top_k: topK })

  if (kgResult.ok) {
    const cards = normalizeCards(kgResult.data, 'kg_rag')
    if (cards.length > 0) {
      res.json({ cards, source: 'kg_rag', query: q, count: cards.length })
      return
    }
  }

  // Fallback to srag.query
  logger.info({ query: q }, 'kg_rag empty or failed, falling back to srag.query')
  const sragResult = await callMcp('srag.query', { query: q, domains })

  if (sragResult.ok) {
    const cards = normalizeCards(sragResult.data, 'srag')
    res.json({ cards, source: 'srag', query: q, count: cards.length })
    return
  }

  // Both failed
  const errorMsg = [kgResult.error, sragResult.error].filter(Boolean).join('; ')
  res.json({ cards: [], error: errorMsg, query: q, count: 0 })
})

/* ─── G2.6: GET /feed ──────────────────────────────────────────────────────── */

knowledgeRouter.get('/feed', async (_req: Request, res: Response) => {
  const redis = getRedis()

  // Try cache first
  if (redis) {
    try {
      const cached = await redis.get(FEED_CACHE_KEY)
      if (cached) {
        res.json(JSON.parse(cached))
        return
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis cache read failed for knowledge feed')
    }
  }

  // Generate on-the-fly
  const feed: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    graph_pulse: null,
    top_insights: [],
    gap_alerts: [],
    domain_coverage: {},
  }

  const errors: string[] = []

  // 1. Graph pulse
  const graphResult = await callMcp('graph.read_cypher', {
    query: 'MATCH (n) RETURN labels(n) AS type, count(*) AS count ORDER BY count DESC LIMIT 20',
  })

  if (graphResult.ok) {
    const data = graphResult.data as Record<string, unknown> | undefined
    const records = Array.isArray(data)
      ? data
      : Array.isArray(data?.records)
        ? data.records
        : Array.isArray(data?.data)
          ? data.data
          : []

    const domainCoverage: Record<string, number> = {}
    let totalNodes = 0
    for (const rec of records as Array<Record<string, unknown>>) {
      const label = String(rec.type ?? rec.labels ?? 'Unknown')
      const count = typeof rec.count === 'number' ? rec.count : parseInt(String(rec.count)) || 0
      domainCoverage[label] = count
      totalNodes += count
    }

    feed.graph_pulse = { total_nodes: totalNodes, label_distribution: domainCoverage }
    feed.domain_coverage = domainCoverage
  } else {
    errors.push(graphResult.error ?? 'graph.read_cypher failed')
  }

  // 2. Top insights + gap alerts
  const insightResult = await callMcp('kg_rag.query', {
    question: 'What are the most important recent insights and gaps?',
    top_k: 10,
  })

  if (insightResult.ok) {
    const cards = normalizeCards(insightResult.data, 'kg_rag')
    feed.top_insights = cards.filter(c => c.score >= 0.5 || cards.length <= 5)
    feed.gap_alerts = cards.filter(c => {
      const lower = c.summary.toLowerCase()
      return lower.includes('gap') || lower.includes('missing') || lower.includes('incomplete')
    })
  } else {
    errors.push(insightResult.error ?? 'kg_rag.query failed for insights')
  }

  if (errors.length > 0) {
    feed.error = errors.join('; ')
  }

  // Cache in Redis
  if (redis) {
    try {
      await redis.set(FEED_CACHE_KEY, JSON.stringify(feed), 'EX', FEED_TTL_SECONDS)
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis cache write failed for knowledge feed')
    }
  }

  res.json(feed)
})

/* ─── G2.8: GET /briefing ─────────────────────────────────────────────────── */

/**
 * Returns a condensed, prompt-ready knowledge briefing (~500 chars max).
 * Intended for injection into Open WebUI system prompts via SRAG filter
 * or admin system prompt variable.
 *
 * Cache-miss returns a 204 (no briefing available yet).
 */
knowledgeRouter.get('/briefing', async (_req: Request, res: Response) => {
  const redis = getRedis()

  if (!redis) {
    res.status(503).json({ error: 'Redis not available', briefing: null })
    return
  }

  try {
    const briefing = await redis.get(BRIEFING_CACHE_KEY)
    if (!briefing) {
      res.status(204).end()
      return
    }
    res.type('text/plain').send(briefing)
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis read failed for knowledge briefing')
    res.status(500).json({ error: 'Failed to read briefing from cache' })
  }
})

/* ─── KB Status: GET /api/knowledge/bus/status ────────────────────────────── */

/**
 * Returns KnowledgeBus tier counts from Neo4j + L2 staging count from Redis.
 * Used by agents and dashboards to see KB health at a glance.
 */
knowledgeRouter.get('/bus/status', async (_req: Request, res: Response) => {
  const extractRecords = (result: Awaited<ReturnType<typeof callMcpTool>>): Array<Record<string, unknown>> => {
    if (result.status !== 'success') return []
    const r = result.result as Record<string, unknown> | undefined
    if (Array.isArray(r)) return r as Array<Record<string, unknown>>
    if (Array.isArray(r?.results)) return r.results as Array<Record<string, unknown>>
    return []
  }

  const [tierResult, recentResult] = await Promise.allSettled([
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: { query: 'MATCH (n:KnowledgeCandidate) RETURN n.tier AS tier, count(n) AS cnt ORDER BY n.tier' },
      callId: uuid(),
      timeoutMs: 12000,
    }),
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: { query: 'MATCH (n:KnowledgeCandidate) RETURN n.title AS title, n.tier AS tier, n.score AS score, n.source AS source, n.created_at AS created_at ORDER BY n.created_at DESC LIMIT 10' },
      callId: uuid(),
      timeoutMs: 12000,
    }),
  ])

  const tiers: Record<string, number> = {}
  const debug: Record<string, unknown> = {}
  if (tierResult.status === 'fulfilled') {
    debug.tier_status = tierResult.value.status
    debug.tier_error = tierResult.value.error_message
    debug.tier_raw = tierResult.value.result
    for (const rec of extractRecords(tierResult.value)) {
      const tier = String(rec.tier ?? 'unknown')
      const cnt = typeof rec.cnt === 'number' ? rec.cnt
        : typeof (rec.cnt as Record<string, unknown>)?.low === 'number' ? (rec.cnt as Record<string, unknown>).low as number
        : parseInt(String(rec.cnt)) || 0
      tiers[tier] = cnt
    }
  } else {
    debug.tier_rejected = String(tierResult.reason)
  }

  const recentEvents: unknown[] = recentResult.status === 'fulfilled'
    ? extractRecords(recentResult.value)
    : []

  // L2 staging count from Redis
  let l2StagingCount = 0
  const redis = getRedis()
  if (redis) {
    try {
      const keys = await redis.keys('knowledge:staging:*')
      l2StagingCount = keys.length
    } catch { /* non-critical */ }
  }

  const total = Object.values(tiers).reduce((s, n) => s + n, 0)
  res.json({
    success: true,
    data: {
      tiers,
      total_persisted: total,
      l2_staged: l2StagingCount,
      recent_events: recentEvents,
      generated_at: new Date().toISOString(),
      _debug: debug,
    },
  })
})

/* ─── KB Emit: POST /api/knowledge/bus/emit ───────────────────────────────── */

/**
 * Inject a KnowledgeEvent directly into the KnowledgeBus.
 * Agents and crons can POST here to contribute knowledge without going through tool-executor.
 *
 * Body: { source, title, content, summary, score?, tags?, repo? }
 */
knowledgeRouter.post('/bus/emit', async (req: Request, res: Response) => {
  const { source, title, content, summary, score, tags, repo } = req.body as Record<string, unknown>

  if (!source || !title || !content || !summary) {
    res.status(400).json({ success: false, error: 'source, title, content, summary are required' })
    return
  }

  try {
    const { emitKnowledge } = await import('../knowledge/index.js')
    emitKnowledge({
      source: source as 'inventor' | 'session_fold' | 'phantom_bom' | 'commit' | 'manual',
      title: String(title),
      content: String(content),
      summary: String(summary),
      score: typeof score === 'number' ? score : undefined,
      tags: Array.isArray(tags) ? tags as string[] : [],
      repo: String(repo ?? 'widgetdc-orchestrator'),
    })

    const tierHint = typeof score === 'number'
      ? (score >= 0.85 ? 'L4 (skill candidate)' : score >= 0.70 ? 'L3 (AgentMemory)' : 'L2 (staging)')
      : 'auto-scored by PRISM'

    logger.info({ title, source, score }, 'KnowledgeBus HTTP emit received')
    res.json({ success: true, tier_hint: tierHint, title })
  } catch (err) {
    logger.error({ err: String(err) }, 'KnowledgeBus HTTP emit failed')
    res.status(500).json({ success: false, error: String(err) })
  }
})

/* ─── KB Fold: POST /api/knowledge/bus/fold ──────────────────────────────── */

/**
 * Fold a session transcript into the KnowledgeBus.
 * Body: { session_id } — session_id is the transcript filename without .jsonl
 */
knowledgeRouter.post('/bus/fold', async (req: Request, res: Response) => {
  const { session_id } = req.body as Record<string, unknown>
  if (!session_id) {
    res.status(400).json({ success: false, error: 'session_id is required' })
    return
  }
  try {
    const { foldSession } = await import('../knowledge/adapters/session-fold-adapter.js')
    // Support both full paths and bare session IDs
    const path = String(session_id).includes('/') || String(session_id).includes('\\')
      ? String(session_id)
      : `${process.env.HOME ?? process.env.USERPROFILE ?? '/tmp'}/.claude/projects/${String(session_id)}.jsonl`
    const fold = await foldSession(path)
    res.json({
      success: true,
      session_id: fold.session_id,
      commits: fold.commits.length,
      open_tasks: fold.open_tasks.length,
      decisions: fold.decisions.length,
      linear_refs: fold.linear_refs,
    })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})
