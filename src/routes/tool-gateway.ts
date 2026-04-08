/**
 * routes/tool-gateway.ts — REST gateway for ALL orchestrator tools (LIN-564, LIN-565)
 *
 * POST /api/tools/:name — Execute any orchestrator tool via REST.
 * Auto-generated from canonical tool registry. All 13 tools accessible.
 *
 * This is the REST leg of the Triple-Protocol ABI:
 *   - OpenAI function calling → tool-executor.ts
 *   - MCP JSON-RPC           → routes/mcp-gateway.ts
 *   - REST/OpenAPI           → THIS FILE
 */
import { Router, Request, Response } from 'express'
import { executeToolUnified } from '../tools/tool-executor.js'
import { getTool, TOOL_REGISTRY } from '../tools/tool-registry.js'
import { logger } from '../logger.js'
import { recordToolCall } from '../flywheel/adoption-telemetry.js'
import { v4 as uuid } from 'uuid'

export const toolGatewayRouter = Router()

/**
 * POST /api/tools/:name — Execute an orchestrator tool by name.
 *
 * Body: the tool's input arguments (JSON).
 * Returns: ExecutionResult envelope with status, result, duration, tracking.
 */
toolGatewayRouter.post('/:name', async (req: Request, res: Response) => {
  const { name } = req.params
  const tool = getTool(name)

  if (!tool) {
    res.status(404).json({
      success: false,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Tool '${name}' not found. Use GET /api/tools to list available tools.`,
        available: TOOL_REGISTRY.map(t => t.name),
        status_code: 404,
      },
    })
    return
  }

  const callId = (req.body?.call_id as string) ?? uuid()
  const args = req.body ?? {}

  logger.info({ tool: name, call_id: callId }, 'REST tool gateway call')

  const result = await executeToolUnified(name, args, {
    call_id: callId,
    source_protocol: 'openapi',
    fold: req.query.fold !== 'false',
  })

  // Adoption telemetry: record successful tool calls (fire-and-forget)
  if (result.status === 'success') {
    recordToolCall(name)
  }

  const httpStatus = result.status === 'success' ? 200
    : result.status === 'timeout' ? 504
    : 500

  res.status(httpStatus).json({
    success: result.status === 'success',
    data: result,
  })
})

/**
 * GET /api/tools — List all orchestrator tools from canonical registry.
 */
toolGatewayRouter.get('/', (_req: Request, res: Response) => {
  const tools = TOOL_REGISTRY.map(t => ({
    name: t.name,
    namespace: t.namespace,
    category: t.category,
    description: t.description,
    tags: t.tags,
    available_via: t.availableVia,
    timeout_ms: t.timeoutMs,
    endpoint: `/api/tools/${t.name}`,
  }))

  res.json({
    success: true,
    data: {
      tools,
      total: tools.length,
      registry_version: '1.0.0',
    },
  })
})
