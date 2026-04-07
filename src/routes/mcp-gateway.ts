/**
 * routes/mcp-gateway.ts — MCP Streamable HTTP Gateway
 *
 * Implements the Model Context Protocol (MCP) over HTTP using JSON-RPC 2.0.
 * Exposes all orchestrator tools + backend MCP tools to any MCP-compatible client.
 *
 * POST /mcp — Single endpoint for all MCP messages:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *   - ping
 *
 * Supports both single requests and SSE streaming for long-running calls.
 */
import { Router, Request, Response } from 'express'
import { ORCHESTRATOR_TOOLS, executeToolCalls } from '../tool-executor.js'
import { toMCPTools, TOOL_REGISTRY } from '../tool-registry.js'
import { callMcpTool } from '../mcp-caller.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { v4 as uuid } from 'uuid'

export const mcpGatewayRouter = Router()

// ─── Inline auth (supports query param + Bearer + X-API-Key) ───────────────
// External MCP clients (Qwen web, Open WebUI) can't reliably send custom headers
// on both SSE GET and JSON-RPC POST, so we accept api_key as query param.

function mcpAuth(req: Request, res: Response): boolean {
  if (!config.orchestratorApiKey) return true // dev mode

  const bearer = (req.headers['authorization'] ?? '').toString().replace('Bearer ', '')
  const xApiKey = (req.headers['x-api-key'] ?? '').toString()
  const queryKey = (req.query['api_key'] ?? '').toString()

  if (bearer === config.orchestratorApiKey || xApiKey === config.orchestratorApiKey || queryKey === config.orchestratorApiKey) {
    return true
  }

  logger.warn({ path: req.path, ip: req.ip }, 'MCP gateway: unauthorized')
  res.status(401).json({
    jsonrpc: '2.0', id: null,
    error: { code: -32600, message: 'Unauthorized. Pass api_key query param or Authorization: Bearer header.' },
  })
  return false
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ─── Backend tool discovery cache ───────────────────────────────────────────

let backendToolsCache: Array<{ name: string; description: string; inputSchema: object }> = []
let backendToolsCacheTime = 0
const CACHE_TTL_MS = 300_000 // 5 min

async function getBackendTools(): Promise<typeof backendToolsCache> {
  if (Date.now() - backendToolsCacheTime < CACHE_TTL_MS && backendToolsCache.length > 0) {
    return backendToolsCache
  }

  try {
    const r = await fetch(`${config.backendUrl}/api/mcp/tools`, {
      headers: { Authorization: `Bearer ${config.backendApiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return backendToolsCache

    const data = await r.json() as any
    const rawTools = Array.isArray(data) ? data
      : Array.isArray(data?.tools) ? data.tools
      : Array.isArray(data?.data?.tools) ? data.data.tools
      : []

    backendToolsCache = rawTools.map((t: any) => {
      // Backend returns either strings ("graph.health") or objects ({name, description})
      if (typeof t === 'string') {
        return {
          name: `backend.${t}`,
          description: `Backend MCP tool: ${t}`,
          inputSchema: { type: 'object', properties: { payload: { type: 'object', description: 'Tool arguments' } } },
        }
      }
      return {
        name: `backend.${t.name ?? t.tool ?? ''}`,
        description: String(t.description ?? `Backend MCP tool: ${t.name ?? t.tool}`),
        inputSchema: t.inputSchema ?? t.input_schema ?? t.parameters ?? { type: 'object', properties: {} },
      }
    }).filter((t: any) => t.name !== 'backend.')
    backendToolsCacheTime = Date.now()
    logger.info({ count: backendToolsCache.length }, 'MCP gateway: refreshed backend tools cache')
  } catch (err) {
    logger.warn({ err: String(err) }, 'MCP gateway: failed to fetch backend tools')
  }

  return backendToolsCache
}

// ─── Convert orchestrator tools to MCP format (compiled from canonical registry) ─

function getOrchestratorToolsMCP(): Array<{ name: string; description: string; inputSchema: object }> {
  return toMCPTools()
}

// ─── JSON-RPC handlers ─────────────────────────────────────────────────────

async function handleInitialize(id: string | number | null, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
  // Negotiate protocol version — match client's version if we support it
  const clientVersion = (params?.protocolVersion ?? '2025-03-26') as string
  const SUPPORTED_VERSIONS = ['2025-03-26', '2024-11-05']
  const negotiatedVersion = SUPPORTED_VERSIONS.includes(clientVersion) ? clientVersion : SUPPORTED_VERSIONS[0]

  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: negotiatedVersion,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: 'widgetdc-orchestrator',
        version: '2.1.0',
      },
    },
  }
}

async function handleToolsList(id: string | number | null, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
  const orchestratorTools = getOrchestratorToolsMCP()

  // Only include backend tools if explicitly requested via cursor param
  // Default: orchestrator tools only (keeps payload small for MCP clients like Qwen)
  const includeBackend = params?.cursor === 'include_backend'
  const backendTools = includeBackend ? await getBackendTools() : []

  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools: [...orchestratorTools, ...backendTools],
    },
  }
}

async function handleToolsCall(
  id: string | number | null,
  params: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const toolName = params.name as string
  const args = (params.arguments ?? {}) as Record<string, unknown>

  if (!toolName) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: 'Missing required parameter: name' },
    }
  }

  // Check if it's an orchestrator tool (lookup from canonical registry)
  const isOrchestratorTool = TOOL_REGISTRY.some(t => t.name === toolName)

  if (isOrchestratorTool) {
    try {
      const results = await executeToolCalls([{
        id: uuid(),
        function: { name: toolName, arguments: JSON.stringify(args) },
      }])

      const result = results[0]
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: result.content }],
          isError: false,
        },
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err}` }],
          isError: true,
        },
      }
    }
  }

  // Backend MCP tool — strip "backend." prefix if present
  const backendName = toolName.startsWith('backend.') ? toolName.slice(8) : toolName

  try {
    const mcpResult = await callMcpTool({
      toolName: backendName,
      args,
      callId: uuid(),
      timeoutMs: 30000,
    })

    if (mcpResult.status !== 'success') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: mcpResult.error_message ?? 'Tool call failed' }],
          isError: true,
        },
      }
    }

    const text = typeof mcpResult.result === 'string'
      ? mcpResult.result
      : JSON.stringify(mcpResult.result, null, 2)

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text }],
        isError: false,
      },
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `MCP tool error: ${err}` }],
        isError: true,
      },
    }
  }
}

async function handlePing(id: string | number | null): Promise<JsonRpcResponse> {
  return { jsonrpc: '2.0', id, result: {} }
}

// ─── Main endpoint ──────────────────────────────────────────────────────────

mcpGatewayRouter.post('/', async (req: Request, res: Response) => {
  // Auth skipped — MCP clients (Qwen, Open WebUI) can't reliably pass headers/query on POST.
  // Protected by: apiRateLimiter (30 req/min per IP) + backend auth on tool execution.
  const body = req.body as Record<string, unknown>

  // Log raw body for debugging MCP client compat issues
  logger.info({ rawBody: JSON.stringify(body).slice(0, 500), contentType: req.headers['content-type'] }, 'MCP gateway raw request')

  // Lenient validation — accept requests with or without jsonrpc field
  // Some MCP clients (Qwen) may omit jsonrpc or send it differently
  const method = (body?.method ?? '') as string
  if (!body || !method) {
    res.status(400).json({
      jsonrpc: '2.0',
      id: (body?.id as any) ?? null,
      error: { code: -32600, message: `Invalid request — need at least "method" field. Got: ${JSON.stringify(body).slice(0, 200)}` },
    })
    return
  }

  // Normalize: ensure jsonrpc is set for response compatibility
  const id = (body.id ?? null) as string | number | null
  const params = (body.params ?? {}) as Record<string, unknown>
  logger.info({ method, id }, 'MCP gateway request')

  let response: JsonRpcResponse

  try {
    switch (method) {
      case 'initialize':
        response = await handleInitialize(id ?? null, params)
        break

      case 'notifications/initialized':
        // Client acknowledgment — MCP spec says 202 Accepted for notifications
        res.status(202).end()
        return

      case 'tools/list':
        response = await handleToolsList(id ?? null, params)
        break

      case 'tools/call':
        response = await handleToolsCall(id ?? null, params ?? {})
        break

      case 'ping':
        response = await handlePing(id ?? null)
        break

      // Qwen-specific compat: tools/health is non-standard but Qwen's MCP client sends it
      case 'tools/health':
        response = {
          jsonrpc: '2.0',
          id: id ?? null,
          result: { status: 'healthy', tools_count: getOrchestratorToolsMCP().length },
        }
        break

      default:
        response = {
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32601, message: `Method not found: ${method}` },
        }
    }
  } catch (err) {
    logger.error({ method, err: String(err) }, 'MCP gateway error')
    response = {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32603, message: `Internal error: ${err}` },
    }
  }

  res.json(response)
})

// ─── GET for SSE transport (MCP Streamable HTTP spec) ───────────────────────

mcpGatewayRouter.get('/', (req: Request, res: Response) => {
  // SSE endpoint for server-initiated messages
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Send initial endpoint event
  res.write(`event: endpoint\ndata: /mcp\n\n`)

  // Keep alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n')
  }, 30000)

  req.on('close', () => {
    clearInterval(keepAlive)
  })
})

// ─── DELETE for session termination ─────────────────────────────────────────

mcpGatewayRouter.delete('/', (_req: Request, res: Response) => {
  res.status(200).json({ jsonrpc: '2.0', result: { message: 'Session terminated' } })
})
