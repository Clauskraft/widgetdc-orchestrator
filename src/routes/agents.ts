/**
 * routes/agents.ts — Agent registration & handshake endpoints.
 * Uses TypeBox contract validation at API boundary.
 */
import { Router, Request, Response } from 'express'
import { AgentRegistry } from '../agent-registry.js'
import type { AgentHandshakeData } from '../agent-registry.js'
import { notifyAgentRegistered } from '../slack.js'
import { validate, validateHandshake, cleanToSchema } from '../validation.js'
import { AgentHandshake } from '@widgetdc/contracts/orchestrator'

export const agentsRouter = Router()

agentsRouter.post('/register', (req: Request, res: Response) => {
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
