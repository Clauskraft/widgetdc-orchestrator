/**
 * routes/knowledge.ts — Knowledge Cards + Daily Feed endpoints
 * G2.5: GET /api/knowledge/cards — MCP-backed knowledge card search
 * G2.6: GET /api/knowledge/feed — Cached daily knowledge briefing
 */
import { Router, Request, Response } from 'express'
import { config } from '../config.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

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
