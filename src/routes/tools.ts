/**
 * routes/tools.ts — MCP tool call endpoint.
 * Uses TypeBox contract validation at API boundary.
 */
import { Router, Request, Response } from 'express'
import { AgentRegistry } from '../agent-registry.js'
import { callMcpTool } from '../mcp-caller.js'
import { broadcastToolResult } from '../chat-broadcaster.js'
import { config } from '../config.js'
import { childLogger } from '../logger.js'
import { notifyToolCall } from '../slack.js'
import { validate, validateToolCall } from '../validation.js'
import type { OrchestratorToolCall } from '@widgetdc/contracts/orchestrator'

export const toolsRouter = Router()

toolsRouter.post('/call', async (req: Request, res: Response) => {
  const result = validate<OrchestratorToolCall>(validateToolCall, req.body)

  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid OrchestratorToolCall payload',
        details: result.errors,
        status_code: 400,
      },
    })
    return
  }

  const call = result.data

  const log = childLogger(call.trace_id ?? call.call_id)

  // ACL check
  const acl = AgentRegistry.canCallTool(call.agent_id, call.tool_name)
  if (!acl.allowed) {
    log.warn({ agent_id: call.agent_id, tool: call.tool_name }, `ACL denied: ${acl.reason}`)
    res.status(403).json({
      call_id: call.call_id, status: 'unauthorized', result: null,
      error_message: acl.reason, error_code: 'UNAUTHORIZED',
      duration_ms: 0, completed_at: new Date().toISOString(),
    })
    return
  }

  // Concurrency limit
  const active = AgentRegistry.getActiveCalls(call.agent_id)
  if (active >= config.maxConcurrentPerAgent) {
    res.status(429).json({
      call_id: call.call_id, status: 'rate_limited', result: null,
      error_message: `Max ${config.maxConcurrentPerAgent} concurrent calls`,
      error_code: 'RATE_LIMITED', duration_ms: 0, completed_at: new Date().toISOString(),
    })
    return
  }

  AgentRegistry.incrementActive(call.agent_id)
  log.info({ agent_id: call.agent_id, tool: call.tool_name }, 'Tool call start')

  try {
    const toolResult = await callMcpTool({
      toolName: call.tool_name,
      args: call.arguments as Record<string, unknown>,
      callId: call.call_id,
      traceId: call.trace_id,
      timeoutMs: call.timeout_ms,
    })
    res.json(toolResult)
    if (toolResult.status === 'success') {
      broadcastToolResult(call.call_id, toolResult.result, call.agent_id)
    }
    notifyToolCall(call.agent_id, call.tool_name, toolResult.status, toolResult.duration_ms ?? 0, toolResult.error_message)
    log.info({ tool: call.tool_name, status: toolResult.status, ms: toolResult.duration_ms }, 'Tool call done')
  } finally {
    AgentRegistry.decrementActive(call.agent_id)
  // Update last_seen for this agent
  AgentRegistry.heartbeat(call.agent_id)
  }
})

toolsRouter.get('/namespaces', async (_req: Request, res: Response) => {
  try {
    const r = await fetch(`${config.backendUrl}/api/mcp/tools`, {
      headers: { Authorization: `Bearer ${config.backendApiKey}` },
    })
    if (!r.ok) { res.status(502).json({ success: false, error: { message: `Backend ${r.status}` } }); return }
    const tools = await r.json()
    res.json({ success: true, data: tools })
  } catch (err) {
    res.status(502).json({ success: false, error: { message: String(err) } })
  }
})
