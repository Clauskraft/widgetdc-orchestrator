/**
 * routes/dashboard.ts — JSON feed for Command Center SPA
 *
 * Redis-cached (15s TTL) to avoid serializing 450+ agents on every poll.
 */
import { Router } from 'express'
import { AgentRegistry } from '../agents/agent-registry.js'
import { getConnectionStats } from '../chat-broadcaster.js'
import { listExecutions } from '../chain/chain-engine.js'
import { listCronJobs } from '../cron-scheduler.js'
import { isRlmAvailable, getRlmHealth } from '../cognitive-proxy.js'
import { getOpenClawHealth, getOpenClawSkills } from './openclaw.js'
import { config } from '../config.js'
import { buildRoutingDashboardData } from '../agents/routing-engine.js'
import { getRedis } from '../redis.js'

export const dashboardRouter = Router()

const CACHE_KEY = 'orchestrator:dashboard-cache'
const CACHE_TTL = 15 // seconds

dashboardRouter.get('/data', async (_req, res) => {
  // Serve from Redis cache if fresh
  const redis = getRedis()
  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY)
      if (cached) {
        res.setHeader('X-Cache', 'HIT')
        return res.json(JSON.parse(cached))
      }
    } catch { /* cache miss, rebuild */ }
  }

  const agents = AgentRegistry.all().map(a => ({
    agent_id: a.handshake.agent_id,
    display_name: a.handshake.display_name,
    source: a.handshake.source,
    version: a.handshake.version ?? 'n/a',
    status: a.handshake.status,
    capabilities: a.handshake.capabilities,
    allowed_tool_namespaces: a.handshake.allowed_tool_namespaces,
    active_calls: a.activeCalls,
    registered_at: a.registeredAt.toISOString(),
    last_seen_at: a.lastSeenAt.toISOString(),
  }))

  const wsStats = getConnectionStats()
  const chains = listExecutions().slice(0, 50)
  const routing = buildRoutingDashboardData(chains)
  const cronJobs = listCronJobs()
  const rlmAvailable = isRlmAvailable()

  // RLM health with 2s timeout — don't let cold-start block dashboard
  let rlmHealth = null
  if (rlmAvailable) {
    try {
      rlmHealth = await Promise.race([
        getRlmHealth(),
        new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
      ])
    } catch { /* timeout or error — skip */ }
  }

  // Adoption trends (last 7 days from Redis sorted set)
  let adoptionTrends: unknown[] = []
  if (redis) {
    try {
      const weekAgo = Date.now() - 7 * 86400000
      const raw = await redis.zrangebyscore('orchestrator:adoption-trends', weekAgo, '+inf')
      adoptionTrends = raw.map(r => JSON.parse(r))
    } catch { /* skip */ }
  }

  const payload = {
    agents,
    wsStats,
    chains,
    routing,
    cronJobs,
    rlmAvailable,
    rlmHealth,
    adoptionTrends,
    openclaw: {
      health: getOpenClawHealth(),
      skills: getOpenClawSkills(),
    },
    config: {
      backendUrl: config.backendUrl,
      orchestratorId: config.orchestratorId,
      nodeEnv: config.nodeEnv,
    },
    timestamp: new Date().toISOString(),
  }

  // Cache in Redis
  if (redis) {
    try {
      const json = JSON.stringify(payload)
      redis.set(CACHE_KEY, json, 'EX', CACHE_TTL).catch(() => {})
    } catch { /* stringify failed — skip cache */ }
  }

  res.setHeader('X-Cache', 'MISS')
  res.json(payload)
})
