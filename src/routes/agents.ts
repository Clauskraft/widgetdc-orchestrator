/**
 * routes/agents.ts — Agent registration & handshake endpoints.
 */
import { Router, Request, Response } from 'express'
import { AgentRegistry } from '../agent-registry.js'
import { notifyAgentRegistered } from '../slack.js'

export const agentsRouter = Router()

agentsRouter.post('/register', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>

  if (!body.agent_id || !body.display_name || !body.source || !body.status || !Array.isArray(body.capabilities) || !Array.isArray(body.allowed_tool_namespaces)) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Missing required fields: agent_id, display_name, source, status, capabilities[], allowed_tool_namespaces[]', status_code: 400 },
    })
    return
  }

  AgentRegistry.register(body as unknown as Parameters<typeof AgentRegistry.register>[0])

  notifyAgentRegistered(
    body.agent_id as string,
    body.display_name as string,
    body.allowed_tool_namespaces as string[],
  )

  res.json({
    success: true,
    data: { agent_id: body.agent_id, registered_at: new Date().toISOString() },
  })
})

agentsRouter.get('/', (_req: Request, res: Response) => {
  const agents = AgentRegistry.all().map(e => ({
    agent_id: e.handshake.agent_id,
    display_name: e.handshake.display_name,
    status: e.handshake.status,
    capabilities: e.handshake.capabilities,
    allowed_tool_namespaces: e.handshake.allowed_tool_namespaces,
    active_calls: e.activeCalls,
    registered_at: e.registeredAt.toISOString(),
    last_seen_at: e.lastSeenAt.toISOString(),
  }))
  res.json({ success: true, data: { agents, total: agents.length } })
})

agentsRouter.post('/:id/heartbeat', (req: Request, res: Response) => {
  const { id } = req.params
  const entry = AgentRegistry.get(id)
  if (!entry) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Agent '${id}' not registered`, status_code: 404 } })
    return
  }
  AgentRegistry.heartbeat(id)
  res.json({ success: true, data: { agent_id: id, last_seen_at: new Date().toISOString() } })
})
