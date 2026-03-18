/**
 * routes/dashboard.ts — JSON feed for Command Center SPA
 */
import { Router } from 'express'
import { AgentRegistry } from '../agent-registry.js'
import { getConnectionStats } from '../chat-broadcaster.js'
import { listExecutions } from '../chain-engine.js'
import { listCronJobs } from '../cron-scheduler.js'
import { isRlmAvailable, getRlmHealth } from '../cognitive-proxy.js'
import { getOpenClawHealth, getOpenClawSkills } from './openclaw.js'
import { config } from '../config.js'
import { buildRoutingDashboardData } from '../routing-engine.js'

export const dashboardRouter = Router()

dashboardRouter.get('/data', async (_req, res) => {
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

  let rlmHealth = null
  if (rlmAvailable) {
    try { rlmHealth = await getRlmHealth() } catch { /* ignore */ }
  }

  res.json({
    agents,
    wsStats,
    chains,
    routing,
    cronJobs,
    rlmAvailable,
    rlmHealth,
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
  })
})
