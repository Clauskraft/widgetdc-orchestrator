/**
 * routes/adoption.ts — Adoption Dashboard API
 * GET  /api/adoption/metrics   — Returns adoption KPIs
 * PUT  /api/adoption/metrics   — Update adoption KPIs
 * GET  /api/adoption/trends    — Time-series adoption data (daily snapshots)
 * POST /api/adoption/snapshot  — Capture daily snapshot (called by cron)
 */
import { Router, Request, Response } from 'express'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'
import { v4 as uuid } from 'uuid'
import { computeTelemetry } from '../flywheel/adoption-telemetry.js'
import { recommendPhantomSkillLoop } from '../services/phantom-loop-selector.js'

export const adoptionRouter = Router()

const REDIS_KEY = 'orchestrator:adoption-metrics'
const REDIS_TRENDS_KEY = 'orchestrator:adoption-trends'

interface AdoptionMetrics {
  features_done: number
  features_total: number
  features_pct: number
  milestones: Record<string, { status: string; tasks: number; done: number }>
  assistants: number
  pipelines: number
  obsidian_views: number
  generated_at: string
}

/** Daily usage snapshot for time-series tracking */
export interface AdoptionSnapshot {
  date: string                    // ISO date YYYY-MM-DD
  captured_at: string             // ISO timestamp
  conversations_24h: number       // Open WebUI conversations in last 24h
  pipeline_executions_24h: number // Knowledge Fabric pipeline runs
  artifact_creations_24h: number  // Analysis Bridge artifacts created
  unique_agents_24h: number       // Unique agents active
  total_tool_calls_24h: number    // Total MCP tool calls
  chain_executions_24h: number    // Chain executions
  features_done: number           // Cumulative features shipped
  features_pct: number            // Adoption percentage
}

const DEFAULT_METRICS: Omit<AdoptionMetrics, 'generated_at'> = {
  features_done: 14,
  features_total: 54,
  features_pct: 25.9,
  milestones: {
    M0: { status: 'complete', tasks: 3, done: 3 },
    M1: { status: 'complete', tasks: 8, done: 8 },
    M2: { status: 'in_progress', tasks: 6, done: 6 },
    M3: { status: 'in_progress', tasks: 6, done: 0 },
    M4: { status: 'pending', tasks: 31, done: 0 },
  },
  assistants: 5,
  pipelines: 3,
  obsidian_views: 3,
}

/* ─── GET /telemetry — Runtime tool-usage KPIs ───────────────────────────── */

adoptionRouter.get('/telemetry', async (_req: Request, res: Response) => {
  try {
    const summary = await computeTelemetry()
    res.json({ success: true, data: summary })
  } catch (err) {
    logger.error({ err: String(err) }, 'adoption telemetry compute failed')
    res.status(500).json({ success: false, error: { code: 'TELEMETRY_ERROR', message: String(err) } })
  }
})

/* ─── POST /skills/recommend — Phantom loop recommendation ───────────────── */

adoptionRouter.post('/skills/recommend', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const intent = typeof body.intent === 'string' ? body.intent.trim() : ''
  const repoOrDomain = typeof body.repo_or_domain === 'string' ? body.repo_or_domain.trim() : ''

  if (intent.length < 4) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'intent is required (min 4 chars)', status_code: 400 },
    })
    return
  }

  if (repoOrDomain.length < 2) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'repo_or_domain is required (min 2 chars)', status_code: 400 },
    })
    return
  }

  try {
    const recommendation = await recommendPhantomSkillLoop(intent, repoOrDomain)
    res.json({ success: true, data: recommendation })
  } catch (err) {
    logger.error({ err: String(err), intent, repoOrDomain }, 'adoption skill recommendation failed')
    res.status(500).json({
      success: false,
      error: { code: 'RECOMMENDATION_ERROR', message: String(err), status_code: 500 },
    })
  }
})

/* ─── GET /metrics ────────────────────────────────────────────────────────── */

adoptionRouter.get('/metrics', async (_req: Request, res: Response) => {
  const redis = getRedis()

  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get(REDIS_KEY)
      if (cached) {
        res.json(JSON.parse(cached))
        return
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis read failed for adoption metrics')
    }
  }

  // Return defaults + persist to Redis
  const metrics: AdoptionMetrics = {
    ...DEFAULT_METRICS,
    generated_at: new Date().toISOString(),
  }

  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(metrics))
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis write failed for adoption metrics')
    }
  }

  res.json(metrics)
})

/* ─── PUT /metrics ────────────────────────────────────────────────────────── */

adoptionRouter.put('/metrics', async (req: Request, res: Response) => {
  const redis = getRedis()
  const body = req.body as Partial<Omit<AdoptionMetrics, 'generated_at'>>

  // Load current metrics
  let current: AdoptionMetrics = { ...DEFAULT_METRICS, generated_at: new Date().toISOString() }

  if (redis) {
    try {
      const cached = await redis.get(REDIS_KEY)
      if (cached) current = JSON.parse(cached)
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis read failed during adoption metrics update')
    }
  }

  // Merge updates
  if (typeof body.features_done === 'number') current.features_done = body.features_done
  if (typeof body.features_total === 'number') current.features_total = body.features_total
  if (typeof body.assistants === 'number') current.assistants = body.assistants
  if (typeof body.pipelines === 'number') current.pipelines = body.pipelines
  if (typeof body.obsidian_views === 'number') current.obsidian_views = body.obsidian_views
  if (body.milestones && typeof body.milestones === 'object') {
    current.milestones = { ...current.milestones, ...body.milestones }
  }

  // Recompute percentage
  current.features_pct = current.features_total > 0
    ? Math.round((current.features_done / current.features_total) * 1000) / 10
    : 0
  current.generated_at = new Date().toISOString()

  // Persist
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(current))
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis write failed for adoption metrics update')
      res.status(500).json({ success: false, error: 'Failed to persist metrics' })
      return
    }
  }

  res.json({ success: true, metrics: current })
})

/* ─── POST /snapshot — Capture daily adoption metrics ────────────────────── */

export async function captureAdoptionSnapshot(): Promise<AdoptionSnapshot> {
  const redis = getRedis()
  const today = new Date().toISOString().slice(0, 10)

  // Collect metrics from multiple sources in parallel
  const [conversationsResult, artifactsResult, toolCallsResult] = await Promise.allSettled([
    // Count conversations from last 24h via graph
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: "MATCH (c:Conversation) WHERE c.createdAt > datetime() - duration('P1D') RETURN count(c) AS count",
      },
      callId: uuid(),
      timeoutMs: 10000,
    }),
    // Count artifacts from last 24h
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: "MATCH (a:AnalysisArtifact) WHERE a.createdAt > datetime() - duration('P1D') RETURN count(a) AS count",
      },
      callId: uuid(),
      timeoutMs: 10000,
    }),
    // Count tool calls from audit trail
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: "MATCH (e:AuditEvent) WHERE e.timestamp > datetime() - duration('P1D') AND e.action = 'tool_call' RETURN count(e) AS count",
      },
      callId: uuid(),
      timeoutMs: 10000,
    }),
  ])

  // Extract counts safely
  const extractCount = (r: PromiseSettledResult<any>): number => {
    if (r.status !== 'fulfilled') return 0
    const result = r.value?.result
    if (Array.isArray(result) && result[0]?.count != null) return Number(result[0].count)
    if (result?.count != null) return Number(result.count)
    return 0
  }

  // Load current adoption metrics for features tracking
  let current: AdoptionMetrics = { ...DEFAULT_METRICS, generated_at: new Date().toISOString() }
  if (redis) {
    try {
      const cached = await redis.get(REDIS_KEY)
      if (cached) current = JSON.parse(cached)
    } catch { /* use defaults */ }
  }

  // Count pipeline executions and chain executions from Redis audit
  let pipelineExecs = 0
  let chainExecs = 0
  let uniqueAgents = 0
  if (redis) {
    try {
      // Count chain executions from the hash
      const chainData = await redis.hgetall('orchestrator:chains')
      const oneDayAgo = Date.now() - 86400000
      for (const val of Object.values(chainData)) {
        try {
          const exec = JSON.parse(val)
          if (new Date(exec.started_at).getTime() > oneDayAgo) {
            chainExecs++
            if (exec.name?.toLowerCase().includes('pipeline') || exec.name?.toLowerCase().includes('knowledge')) {
              pipelineExecs++
            }
          }
        } catch { /* skip bad entries */ }
      }

      // Count unique agents from registry
      const agentData = await redis.hgetall('orchestrator:agents')
      const activeAgents = new Set<string>()
      for (const val of Object.values(agentData)) {
        try {
          const agent = JSON.parse(val)
          if (new Date(agent.lastSeenAt).getTime() > oneDayAgo) {
            activeAgents.add(agent.agent_id ?? agent.handshake?.agent_id)
          }
        } catch { /* skip */ }
      }
      uniqueAgents = activeAgents.size
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to collect Redis adoption metrics')
    }
  }

  const snapshot: AdoptionSnapshot = {
    date: today,
    captured_at: new Date().toISOString(),
    conversations_24h: extractCount(conversationsResult),
    pipeline_executions_24h: pipelineExecs,
    artifact_creations_24h: extractCount(artifactsResult),
    unique_agents_24h: uniqueAgents,
    total_tool_calls_24h: extractCount(toolCallsResult),
    chain_executions_24h: chainExecs,
    features_done: current.features_done,
    features_pct: current.features_pct,
  }

  // Persist snapshot to Redis trends list (keep 90 days)
  if (redis) {
    try {
      // Use sorted set with date as score for easy range queries
      const score = new Date(today).getTime()
      await redis.zadd(REDIS_TRENDS_KEY, score, JSON.stringify(snapshot))
      // Trim to 90 entries
      const totalEntries = await redis.zcard(REDIS_TRENDS_KEY)
      if (totalEntries > 90) {
        await redis.zremrangebyrank(REDIS_TRENDS_KEY, 0, totalEntries - 91)
      }
      logger.info({ date: today, snapshot }, 'Adoption snapshot captured')
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to persist adoption snapshot')
    }
  }

  // Store in Neo4j for long-term tracking
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (m:AdoptionMetric {date: $date})
SET m.conversations_24h = $conversations,
    m.pipeline_executions_24h = $pipelines,
    m.artifact_creations_24h = $artifacts,
    m.unique_agents_24h = $agents,
    m.total_tool_calls_24h = $toolCalls,
    m.chain_executions_24h = $chains,
    m.features_done = $featuresDone,
    m.features_pct = $featuresPct,
    m.captured_at = datetime()`,
        params: {
          date: today,
          conversations: snapshot.conversations_24h,
          pipelines: snapshot.pipeline_executions_24h,
          artifacts: snapshot.artifact_creations_24h,
          agents: snapshot.unique_agents_24h,
          toolCalls: snapshot.total_tool_calls_24h,
          chains: snapshot.chain_executions_24h,
          featuresDone: snapshot.features_done,
          featuresPct: snapshot.features_pct,
        },
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to write adoption snapshot to Neo4j')
  }

  return snapshot
}

adoptionRouter.post('/snapshot', async (_req: Request, res: Response) => {
  try {
    const snapshot = await captureAdoptionSnapshot()
    res.json({ success: true, data: snapshot })
  } catch (err) {
    logger.error({ err: String(err) }, 'Adoption snapshot capture failed')
    res.status(500).json({
      success: false,
      error: { code: 'SNAPSHOT_ERROR', message: String(err), status_code: 500 },
    })
  }
})

/* ─── GET /trends — Time-series adoption data ────────────────────────────── */

adoptionRouter.get('/trends', async (req: Request, res: Response) => {
  const redis = getRedis()
  const days = Math.min(parseInt(String(req.query.days ?? '30'), 10) || 30, 90)

  if (!redis) {
    res.json({ success: true, data: { trends: [], days, source: 'none' } })
    return
  }

  try {
    const cutoff = Date.now() - days * 86400000
    const raw = await redis.zrangebyscore(REDIS_TRENDS_KEY, cutoff, '+inf')
    const trends: AdoptionSnapshot[] = raw.map(r => JSON.parse(r))

    res.json({ success: true, data: { trends, days, total: trends.length } })
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to read adoption trends')
    res.status(500).json({
      success: false,
      error: { code: 'TRENDS_ERROR', message: String(err), status_code: 500 },
    })
  }
})
