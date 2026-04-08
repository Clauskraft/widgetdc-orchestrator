/**
 * abi-docs.ts — ABI Auto-Docs + Live Playground (LIN-572)
 *
 * GET  /api/abi/docs — Auto-generated documentation for all orchestrator tools
 * POST /api/abi/try  — Live playground: execute a tool and return result with timing
 */
import { Router } from 'express'
import { TOOL_REGISTRY, getCategories } from '../tools/tool-registry.js'
import { executeToolUnified } from '../tools/tool-executor.js'
import { logger } from '../logger.js'

export const abiDocsRouter = Router()

// ─── GET /docs — Full auto-generated tool documentation ─────────────────────

abiDocsRouter.get('/docs', (_req, res) => {
  const namespace = (_req.query.namespace as string) ?? undefined
  const category = (_req.query.category as string) ?? undefined

  let tools = TOOL_REGISTRY

  if (namespace) {
    tools = tools.filter(t => t.namespace === namespace)
  }
  if (category) {
    tools = tools.filter(t => t.category === category)
  }

  const toolDocs = tools.map(t => ({
    name: t.name,
    namespace: t.namespace,
    description: t.description,
    input_schema: t.inputSchema,
    examples: buildExamples(t.name, t.inputSchema),
    protocols: t.availableVia,
    category: t.category,
    version: t.version,
    deprecated: !!t.deprecated,
    ...(t.deprecated ? { deprecated_since: t.deprecated.since, replacement: t.deprecated.replacement } : {}),
    handler: t.handler,
    timeout_ms: t.timeoutMs,
    output_description: t.outputDescription ?? null,
    tags: t.tags,
  }))

  // Stats
  const byNamespace: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  for (const t of TOOL_REGISTRY) {
    byNamespace[t.namespace] = (byNamespace[t.namespace] ?? 0) + 1
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1
  }

  res.json({
    tools: toolDocs,
    stats: {
      total: TOOL_REGISTRY.length,
      filtered: toolDocs.length,
      by_namespace: byNamespace,
      by_category: byCategory,
      categories: getCategories(),
    },
    generated_at: new Date().toISOString(),
  })
})

// ─── POST /try — Live playground ────────────────────────────────────────────

abiDocsRouter.post('/try', async (req, res) => {
  const { tool, arguments: args } = req.body ?? {}

  if (!tool || typeof tool !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_TOOL', message: 'Request body must include "tool" (string)', status_code: 400 },
    })
    return
  }

  // Validate tool exists in registry
  const toolDef = TOOL_REGISTRY.find(t => t.name === tool)
  if (!toolDef) {
    res.status(404).json({
      success: false,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Tool "${tool}" not found. Use GET /api/abi/docs to see available tools.`,
        status_code: 404,
        available_tools: TOOL_REGISTRY.map(t => t.name),
      },
    })
    return
  }

  const safeArgs = (args && typeof args === 'object') ? args : {}

  logger.info({ tool, args_keys: Object.keys(safeArgs) }, 'ABI playground: executing tool')

  const result = await executeToolUnified(tool, safeArgs, {
    source_protocol: 'abi-playground',
    fold: false, // Return full result for playground
  })

  res.json({
    success: result.status === 'success',
    result: result.result,
    error_message: result.error_message ?? null,
    duration_ms: result.duration_ms,
    tool: tool,
    tool_meta: {
      namespace: toolDef.namespace,
      category: toolDef.category,
      handler: toolDef.handler,
      timeout_ms: toolDef.timeoutMs,
    },
  })
})

// ─── Example generator ──────────────────────────────────────────────────────

function buildExamples(toolName: string, schema: Record<string, unknown>): Array<{ description: string; arguments: Record<string, unknown> }> {
  const props = (schema as any)?.properties ?? {}
  const required = (schema as any)?.required ?? []

  // Build a minimal example from required fields
  const minimalArgs: Record<string, unknown> = {}
  for (const key of required) {
    const prop = props[key]
    if (!prop) continue
    if (prop.type === 'string') minimalArgs[key] = prop.enum?.[0] ?? `example_${key}`
    else if (prop.type === 'number') minimalArgs[key] = 10
    else if (prop.type === 'boolean') minimalArgs[key] = true
    else if (prop.type === 'array') minimalArgs[key] = []
    else if (prop.type === 'object') minimalArgs[key] = {}
  }

  const examples: Array<{ description: string; arguments: Record<string, unknown> }> = []

  // Curated examples for well-known tools
  const curated = CURATED_EXAMPLES[toolName]
  if (curated) {
    examples.push(...curated)
  } else if (Object.keys(minimalArgs).length > 0) {
    examples.push({ description: 'Minimal call with required fields', arguments: minimalArgs })
  }

  return examples
}

const CURATED_EXAMPLES: Record<string, Array<{ description: string; arguments: Record<string, unknown> }>> = {
  search_knowledge: [
    { description: 'Search for cloud migration patterns', arguments: { query: 'cloud migration strategy', max_results: 5 } },
    { description: 'Find consulting frameworks', arguments: { query: 'consulting framework' } },
  ],
  reason_deeply: [
    { description: 'Analyze architecture trade-offs', arguments: { question: 'What are the trade-offs between microservices and monolith?', mode: 'analyze' } },
  ],
  query_graph: [
    { description: 'Count all nodes by label', arguments: { cypher: 'MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count ORDER BY count DESC LIMIT 20' } },
  ],
  get_platform_health: [
    { description: 'Check platform health', arguments: {} },
  ],
  list_tools: [
    { description: 'List all tools', arguments: {} },
    { description: 'Filter by namespace', arguments: { namespace: 'knowledge' } },
  ],
  call_mcp_tool: [
    { description: 'Call graph health check', arguments: { tool_name: 'graph.health', payload: {} } },
  ],
  linear_issues: [
    { description: 'Get active issues', arguments: { status: 'active', limit: 5 } },
  ],
  governance_matrix: [
    { description: 'Show enforcement gaps', arguments: { filter: 'gaps' } },
  ],
}
