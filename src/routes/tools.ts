/**
 * routes/tools.ts — MCP tool call endpoint.
 * Uses TypeBox contract validation at API boundary.
 */
import { Router, Request, Response } from 'express'
import { AgentRegistry } from '../agent-registry.js'
import { callMcpTool } from '../mcp-caller.js'
import { broadcastToolResult } from '../chat-broadcaster.js'
import { config } from '../config.js'
import { childLogger, logger } from '../logger.js'
import { notifyToolCall } from '../slack.js'
import { validate, validateToolCall } from '../validation.js'
import { getRedis } from '../redis.js'
import { ORCHESTRATOR_TOOLS } from '../tool-executor.js'
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

  // ACL check — auto-discovery mode: register unknown agents instead of blocking
  if (config.agentOpenAccess) {
    // Side effect: canCallTool auto-registers unknown agents
    AgentRegistry.canCallTool(call.agent_id, call.tool_name)
  } else {
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

/* ─── GET /catalog — Full tool catalog with categories ────────────────────── */

const CATALOG_CACHE_KEY = 'orchestrator:tool-catalog'
const CATALOG_TTL_SECONDS = 3600 // 1h

/** Derive category from tool name prefix or function name */
function deriveCategory(name: string): string {
  if (name.includes('knowledge') || name.includes('search_doc')) return 'knowledge'
  if (name.includes('graph') || name.includes('cypher')) return 'graph'
  if (name.includes('linear') || name.includes('task')) return 'linear'
  if (name.includes('health') || name.includes('platform')) return 'health'
  if (name.includes('chain') || name.includes('run_chain')) return 'chains'
  if (name.includes('reason') || name.includes('cognitive')) return 'cognitive'
  if (name.includes('verify')) return 'compliance'
  if (name.includes('mcp')) return 'mcp'
  return 'general'
}

/** Map tool function name to backend MCP tool name if applicable */
function deriveBackendTool(name: string): string | null {
  const mapping: Record<string, string> = {
    search_knowledge: 'srag.query + graph.read_cypher',
    reason_deeply: 'rlm.reason',
    query_graph: 'graph.read_cypher',
    check_tasks: 'graph.read_cypher',
    call_mcp_tool: '(dynamic)',
    get_platform_health: 'graph.health + graph.stats',
    search_documents: 'srag.query',
    linear_issues: 'linear.issues',
    linear_issue_detail: 'linear.issue_get',
    run_chain: 'chain-engine',
    verify_output: 'verification-gate',
  }
  return mapping[name] ?? null
}

/** Default availability for orchestrator tools */
function deriveAvailableIn(name: string): string[] {
  const base = ['command-center']
  // Knowledge and search tools are also available in other UIs
  if (['search_knowledge', 'search_documents', 'reason_deeply'].includes(name)) {
    return ['open-webui', 'obsidian', ...base]
  }
  if (['linear_issues', 'linear_issue_detail', 'check_tasks'].includes(name)) {
    return ['open-webui', ...base]
  }
  return base
}

interface CatalogEntry {
  name: string
  category: string
  description: string
  available_in: string[]
  backend_tool: string | null
}

function buildCatalog(): { tools: CatalogEntry[]; categories: string[]; total: number; generated_at: string } {
  const tools: CatalogEntry[] = ORCHESTRATOR_TOOLS.map(t => ({
    name: t.function.name,
    category: deriveCategory(t.function.name),
    description: t.function.description,
    available_in: deriveAvailableIn(t.function.name),
    backend_tool: deriveBackendTool(t.function.name),
  }))

  const categories = [...new Set(tools.map(t => t.category))].sort()

  return {
    tools,
    categories,
    total: tools.length,
    generated_at: new Date().toISOString(),
  }
}

toolsRouter.get('/catalog', async (_req: Request, res: Response) => {
  const redis = getRedis()

  // Try cache first
  if (redis) {
    try {
      const cached = await redis.get(CATALOG_CACHE_KEY)
      if (cached) {
        res.json(JSON.parse(cached))
        return
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis cache read failed for tool catalog')
    }
  }

  const catalog = buildCatalog()

  // Cache in Redis with 1h TTL
  if (redis) {
    try {
      await redis.set(CATALOG_CACHE_KEY, JSON.stringify(catalog), 'EX', CATALOG_TTL_SECONDS)
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis cache write failed for tool catalog')
    }
  }

  res.json(catalog)
})
