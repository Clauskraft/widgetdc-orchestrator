/**
 * chat-broadcaster.ts — Real-time AgentMessage broadcaster over WebSocket.
 *
 * All connected agents receive all broadcast messages (pub/sub).
 * Supports:
 *   - Agent→Agent direct messages (to field)
 *   - Broadcast messages (to: "All")
 *   - ToolResult notifications
 *   - Heartbeat pings
 */
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { AgentMessage } from '@widgetdc/contracts/orchestrator'
import { logger } from './logger.js'
import { config } from './config.js'
import { broadcastSSE } from './sse.js'
import { storeMessage, msgId } from './chat-store.js'

interface ConnectedAgent {
  ws: WebSocket
  agentId: string
  connectedAt: Date
  lastPingAt: Date
}

const connections = new Map<string, ConnectedAgent>()
let wss: WebSocketServer | null = null

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://localhost`)
    const agentId = url.searchParams.get('agent_id') ?? 'unknown'

    // Validate API key if configured
    if (config.orchestratorApiKey) {
      const token = url.searchParams.get('api_key')
        ?? (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : '')
        ?? ''
      if (token !== config.orchestratorApiKey) {
        logger.warn({ agent_id: agentId }, 'WebSocket auth rejected')
        ws.close(4401, 'Unauthorized')
        return
      }
    }

    const conn: ConnectedAgent = { ws, agentId, connectedAt: new Date(), lastPingAt: new Date() }
    connections.set(agentId, conn)

    logger.info({ agent_id: agentId, total_connections: connections.size }, 'WebSocket connected')

    // Announce join
    broadcastMessage({
      from: 'System',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `🟢 ${agentId} connected to Orchestrator`,
      timestamp: new Date().toISOString(),
    })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as AgentMessage
        handleIncomingMessage(agentId, msg)
      } catch (err) {
        logger.warn({ agent_id: agentId, err: String(err) }, 'Invalid WS message')
      }
    })

    ws.on('close', () => {
      connections.delete(agentId)
      logger.info({ agent_id: agentId, total_connections: connections.size }, 'WebSocket disconnected')

      broadcastMessage({
        from: 'System',
        to: 'All',
        source: 'system',
        type: 'Message',
        message: `🔴 ${agentId} disconnected from Orchestrator`,
        timestamp: new Date().toISOString(),
      })
    })

    ws.on('error', (err) => {
      logger.error({ agent_id: agentId, err: err.message }, 'WebSocket error')
    })
  })

  // Heartbeat loop
  setInterval(() => {
    const now = Date.now()
    for (const [agentId, conn] of connections.entries()) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.ping()
        conn.lastPingAt = new Date()
      } else if (now - conn.lastPingAt.getTime() > config.wsHeartbeatMs * 3) {
        logger.warn({ agent_id: agentId }, 'Stale WS connection removed')
        connections.delete(agentId)
      }
    }
  }, config.wsHeartbeatMs)

  logger.info({ path: '/ws' }, 'WebSocket server ready')
}

function handleIncomingMessage(fromAgentId: string, msg: AgentMessage): void {
  logger.debug({ from: msg.from, to: msg.to, type: msg.type }, 'WS message received')

  if (msg.to === 'All') {
    broadcastMessage(msg)
  } else {
    // Direct message to specific agent
    const target = connections.get(msg.to)
    if (target?.ws.readyState === WebSocket.OPEN) {
      target.ws.send(JSON.stringify(msg))
    } else {
      // Target not connected — broadcast as fallback
      broadcastMessage(msg)
    }
  }
}

export function broadcastMessage(msg: AgentMessage): void {
  // Persist message to Redis/memory store
  const storedMsg = {
    id: (msg as any).id || msgId(),
    from: msg.from,
    to: msg.to,
    source: msg.source,
    type: msg.type,
    message: msg.message,
    timestamp: msg.timestamp || new Date().toISOString(),
    thread_id: (msg as any).thread_id,
    parent_id: (msg as any).parent_id,
    files: (msg as any).files,
    metadata: (msg as any).metadata,
  }
  storeMessage(storedMsg).catch(() => {})

  // Push to SSE clients for dashboard real-time updates
  broadcastSSE('message', { ...msg, id: storedMsg.id })

  const payload = JSON.stringify({ type: 'message', data: { ...msg, id: storedMsg.id } })
  let sent = 0

  for (const [, conn] of connections.entries()) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(payload)
      sent++
    }
  }

  logger.debug({ to: msg.to, type: msg.type, recipients: sent }, 'Message broadcast')
}

export function broadcastToolResult(callId: string, result: unknown, agentId: string): void {
  broadcastMessage({
    from: 'Orchestrator',
    to: agentId as AgentMessage['to'],
    source: 'orchestrator',
    type: 'ToolResult',
    message: `Tool call ${callId} completed`,
    call_id: callId,
    timestamp: new Date().toISOString(),
  })
}

export function getConnectionStats() {
  return {
    total: connections.size,
    agents: Array.from(connections.entries()).map(([id, c]) => ({
      agent_id: id,
      connected_at: c.connectedAt.toISOString(),
      last_ping: c.lastPingAt.toISOString(),
      state: c.ws.readyState === WebSocket.OPEN ? 'open' : 'closing',
    })),
  }
}
