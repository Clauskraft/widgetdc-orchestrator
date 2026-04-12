/**
 * routes/agents.ts — Agent registration & handshake endpoints.
 * Uses TypeBox contract validation at API boundary.
 */
import { Router, Request, Response } from 'express'
import { AgentRegistry } from '../agents/agent-registry.js'
import type { AgentHandshakeData } from '../agents/agent-registry.js'
import { notifyAgentRegistered } from '../slack.js'
import { validate, validateHandshake, cleanToSchema } from '../validation.js'
import { AgentHandshake } from '@widgetdc/contracts/orchestrator'
import { config } from '../config.js'
import { logger } from '../logger.js'

export const agentsRouter = Router()

/** Call MCP tool via backend for Neo4j persistence */
async function mcpCall(tool: string, payload: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify({ tool, payload }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => null)
    return data?.result ?? data
  } catch (err) {
    logger.warn({ tool, err: String(err) }, 'MCP call failed (non-fatal)')
    return null
  }
}

agentsRouter.post('/register', async (req: Request, res: Response) => {
  const result = validate<AgentHandshakeData>(validateHandshake, req.body)

  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid AgentHandshake payload',
        details: result.errors,
        status_code: 400,
      },
    })
    return
  }

  const handshake = cleanToSchema<AgentHandshakeData>(AgentHandshake, result.data)
  AgentRegistry.register(handshake)

  notifyAgentRegistered(
    handshake.agent_id,
    handshake.display_name,
    handshake.allowed_tool_namespaces,
  )

  // Persist to Neo4j for A2A cross-session discovery
  mcpCall('graph.write_cypher', {
    query: `MERGE (a:Agent {agentId: $aid}) SET a.displayName = $name, a.status = $status, a.capabilities = $caps, a.namespaces = $ns, a.registeredAt = datetime(), a.lastSeenAt = datetime()`,
    params: {
      aid: handshake.agent_id,
      name: handshake.display_name,
      status: handshake.status || 'online',
      caps: handshake.capabilities || [],
      ns: handshake.allowed_tool_namespaces || [],
    },
  }).catch(() => {})

  res.json({
    success: true,
    data: { agent_id: handshake.agent_id, registered_at: new Date().toISOString() },
  })
})

agentsRouter.get('/', (_req: Request, res: Response) => {
  const agents = AgentRegistry.all().map(e => ({
    agent_id: e.handshake.agent_id,
    display_name: e.handshake.display_name,
    version: e.handshake.version ?? null,
    status: e.handshake.status,
    capabilities: e.handshake.capabilities,
    allowed_tool_namespaces: e.handshake.allowed_tool_namespaces,
    active_calls: e.activeCalls,
    registered_at: e.registeredAt.toISOString(),
    last_seen_at: e.lastSeenAt.toISOString(),
  }))
  res.json({ success: true, data: { agents, total: agents.length } })
})

agentsRouter.patch('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const updated = AgentRegistry.update(id, req.body)
  if (!updated) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Agent '${id}' not registered`, status_code: 404 } })
    return
  }
  res.json({ success: true, data: { agent_id: id, updated: true } })
})

agentsRouter.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const removed = AgentRegistry.remove(id)
  if (!removed) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Agent '${id}' not registered`, status_code: 404 } })
    return
  }
  res.json({ success: true, data: { agent_id: id, removed: true } })
})

agentsRouter.delete('/', async (_req: Request, res: Response) => {
  const count = await AgentRegistry.purgeAll()
  res.json({ success: true, data: { purged: count } })
})

agentsRouter.post('/:id/heartbeat', async (req: Request, res: Response) => {
  const { id } = req.params
  const entry = AgentRegistry.get(id)
  if (!entry) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Agent '${id}' not registered`, status_code: 404 } })
    return
  }
  AgentRegistry.heartbeat(id)

  // Persist heartbeat + A2A channel to Neo4j
  const a2aChannel = (req.body as any)?.a2aChannel
  if (a2aChannel) {
    mcpCall('graph.write_cypher', {
      query: `MERGE (a:Agent {agentId: $aid}) SET a.lastA2ABroadcast = $broadcast, a.a2AChannel = $channel, a.lastSeenAt = datetime()`,
      params: {
        aid: id,
        broadcast: (req.body as any)?.lastBroadcast || 'heartbeat',
        channel: a2aChannel,
      },
    }).catch(() => {})
  } else {
    mcpCall('graph.write_cypher', {
      query: `MERGE (a:Agent {agentId: $aid}) SET a.lastSeenAt = datetime()`,
      params: { aid: id },
    }).catch(() => {})
  }

  res.json({ success: true, data: { agent_id: id, last_seen_at: new Date().toISOString() } })
})

// ─── GET /a2a — List all agents with A2A channels from Neo4j ─────────────────
agentsRouter.get('/a2a', async (_req: Request, res: Response) => {
  try {
    const result = await mcpCall('graph.read_cypher', {
      query: `MATCH (a:Agent) WHERE a.a2AChannel IS NOT NULL OR a.lastA2ABroadcast IS NOT NULL RETURN a.agentId AS agent, a.a2AChannel AS channel, a.lastA2ABroadcast AS broadcast, a.status AS status, a.displayName AS name ORDER BY a.lastSeenAt DESC`,
      params: {},
    }) as any
    const agents = result?.results || result || []
    res.json({ success: true, data: { agents, total: agents.length } })
  } catch (err) {
    res.json({ success: true, data: { agents: [], total: 0 } })
  }
})
