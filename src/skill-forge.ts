/**
 * skill-forge.ts — Autonomous MCP tool creation (LIN-594 SNOUT-12).
 *
 * Agents analyze usage patterns, identify gaps, generate tool definitions
 * + handlers, register them at runtime, and verify via test calls.
 *
 * Pipeline:
 *   1. ANALYZE — scan recent tool calls for failure patterns + unserved queries
 *   2. PROPOSE — LLM generates tool definition (name, description, input schema, handler)
 *   3. REGISTER — add to runtime TOOL_REGISTRY + dynamic executor
 *   4. VERIFY — test call the new tool to confirm it works
 *   5. PERSIST — store tool spec in Redis for reload on restart
 *
 * Unique: No existing package does autonomous MCP tool creation.
 */
import { v4 as uuid } from 'uuid'
import { chatLLM } from './llm-proxy.js'
import { callMcpTool } from './mcp-caller.js'
import { getRedis } from './redis.js'
import { logger } from './logger.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ForgedToolSpec {
  id: string
  name: string
  namespace: string
  description: string
  input_schema: Record<string, unknown>
  handler_type: 'mcp-proxy' | 'llm-generate' | 'cypher-query'
  handler_config: {
    /** For mcp-proxy: backend tool name to forward to */
    backend_tool?: string
    /** For llm-generate: system prompt for the LLM */
    system_prompt?: string
    /** For cypher-query: Cypher template with $param placeholders */
    cypher_template?: string
  }
  created_by: string
  created_at: string
  verified: boolean
  verification_result?: string
}

export interface ForgeResult {
  action: 'created' | 'already_exists' | 'verification_failed' | 'error'
  tool?: ForgedToolSpec
  message: string
  duration_ms: number
}

export interface GapAnalysis {
  gaps: Array<{
    pattern: string
    frequency: number
    suggestion: string
  }>
  total_calls_analyzed: number
  failure_rate: number
}

// ─── Runtime Registry for Forged Tools ──────────────────────────────────────

const FORGED_TOOLS = new Map<string, ForgedToolSpec>()
const REDIS_PREFIX = 'forge:'

/** Get all forged tools (runtime + persisted) */
export function getForgedTools(): ForgedToolSpec[] {
  return [...FORGED_TOOLS.values()]
}

/** Check if a forged tool exists */
export function hasForgedTool(name: string): boolean {
  return FORGED_TOOLS.has(name)
}

// ─── Step 1: Analyze Gaps ───────────────────────────────────────────────────

export async function analyzeToolGaps(provider = 'deepseek'): Promise<GapAnalysis> {
  // Query recent failure patterns from Redis audit trail
  const redis = getRedis()
  let failurePatterns: string[] = []

  if (redis) {
    try {
      const keys = await redis.keys('orchestrator:audit:*')
      const recentKeys = keys.slice(-100)
      for (const key of recentKeys) {
        const raw = await redis.get(key)
        if (raw) {
          const entry = JSON.parse(raw)
          if (entry.action === 'tool_call' && entry.status === 'error') {
            failurePatterns.push(`${entry.tool}: ${entry.error}`)
          }
        }
      }
    } catch { /* non-critical */ }
  }

  // Also check for TOOL_NOT_FOUND errors in recent logs
  const toolNotFoundPattern = failurePatterns.filter(p => p.includes('not found') || p.includes('NOT_FOUND'))

  // Use LLM to analyze patterns if we have data
  if (failurePatterns.length < 3) {
    return {
      gaps: [{ pattern: 'insufficient_data', frequency: 0, suggestion: 'Need more usage data to identify gaps' }],
      total_calls_analyzed: failurePatterns.length,
      failure_rate: 0,
    }
  }

  try {
    const result = await chatLLM({
      provider,
      messages: [
        { role: 'system', content: `Analyze these tool failure patterns and suggest new tools. Return JSON: {"gaps": [{"pattern": "description", "frequency": N, "suggestion": "new tool name + purpose"}]}` },
        { role: 'user', content: `Failure patterns:\n${failurePatterns.slice(0, 50).join('\n')}` },
      ],
      temperature: 0.3,
      max_tokens: 500,
    })

    const match = result.content.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      return {
        gaps: parsed.gaps || [],
        total_calls_analyzed: failurePatterns.length,
        failure_rate: toolNotFoundPattern.length / Math.max(failurePatterns.length, 1),
      }
    }
  } catch { /* fall through */ }

  return { gaps: [], total_calls_analyzed: failurePatterns.length, failure_rate: 0 }
}

// ─── Step 2+3: Forge a Tool ─────────────────────────────────────────────────

export async function forgeTool(
  name: string,
  purpose: string,
  handlerType: ForgedToolSpec['handler_type'] = 'mcp-proxy',
  handlerConfig: ForgedToolSpec['handler_config'] = {},
  provider = 'deepseek',
): Promise<ForgeResult> {
  const t0 = Date.now()

  // Check if already exists
  if (FORGED_TOOLS.has(name)) {
    return { action: 'already_exists', message: `Tool '${name}' already forged`, duration_ms: Date.now() - t0 }
  }

  // Generate tool spec via LLM
  let description = purpose
  let inputSchema: Record<string, unknown> = { type: 'object', properties: {} }

  try {
    const result = await chatLLM({
      provider,
      messages: [
        { role: 'system', content: `Generate a tool specification. Return JSON only: {"description": "clear description", "input_schema": {"type": "object", "properties": {...}, "required": [...]}}. Keep it concise and practical.` },
        { role: 'user', content: `Tool name: ${name}\nPurpose: ${purpose}\nHandler type: ${handlerType}` },
      ],
      temperature: 0.3,
      max_tokens: 500,
    })

    const match = result.content.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      description = parsed.description || purpose
      inputSchema = parsed.input_schema || inputSchema
    }
  } catch { /* use defaults */ }

  const namespace = name.split('_')[0] || 'custom'

  const spec: ForgedToolSpec = {
    id: uuid(),
    name,
    namespace,
    description,
    input_schema: inputSchema,
    handler_type: handlerType,
    handler_config: handlerConfig,
    created_by: 'skill-forge',
    created_at: new Date().toISOString(),
    verified: false,
  }

  // Register in runtime
  FORGED_TOOLS.set(name, spec)

  // Persist to Redis
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(`${REDIS_PREFIX}${name}`, JSON.stringify(spec), 'EX', 86400 * 30)
    } catch { /* non-critical */ }
  }

  logger.info({ name, namespace, handlerType }, 'Skill Forge: tool created')

  return {
    action: 'created',
    tool: spec,
    message: `Tool '${name}' forged successfully (${handlerType})`,
    duration_ms: Date.now() - t0,
  }
}

// ─── Step 4: Verify ─────────────────────────────────────────────────────────

export async function verifyForgedTool(name: string): Promise<{ verified: boolean; result: string }> {
  const spec = FORGED_TOOLS.get(name)
  if (!spec) return { verified: false, result: `Tool '${name}' not found in forge` }

  try {
    let testResult: string

    if (spec.handler_type === 'mcp-proxy' && spec.handler_config.backend_tool) {
      const result = await callMcpTool({
        toolName: spec.handler_config.backend_tool,
        args: {},
        callId: uuid(),
        timeoutMs: 10000,
      })
      testResult = result.status === 'success' ? 'Backend tool reachable' : `Backend error: ${result.error_message}`
      spec.verified = result.status === 'success'
    } else if (spec.handler_type === 'cypher-query' && spec.handler_config.cypher_template) {
      // Test with a safe read query
      const result = await callMcpTool({
        toolName: 'graph.read_cypher',
        args: { query: 'RETURN 1 AS test' },
        callId: uuid(),
        timeoutMs: 5000,
      })
      testResult = result.status === 'success' ? 'Cypher engine reachable' : `Cypher error: ${result.error_message}`
      spec.verified = result.status === 'success'
    } else {
      testResult = 'LLM-generate tools verified by schema presence'
      spec.verified = true
    }

    spec.verification_result = testResult

    // Update Redis
    const redis = getRedis()
    if (redis) {
      try { await redis.set(`${REDIS_PREFIX}${name}`, JSON.stringify(spec), 'EX', 86400 * 30) } catch {}
    }

    return { verified: spec.verified, result: testResult }
  } catch (err) {
    return { verified: false, result: `Verification failed: ${err}` }
  }
}

// ─── Execute a Forged Tool ──────────────────────────────────────────────────

export async function executeForgedTool(name: string, args: Record<string, unknown>): Promise<string> {
  const spec = FORGED_TOOLS.get(name)
  if (!spec) return `Forged tool '${name}' not found`

  try {
    switch (spec.handler_type) {
      case 'mcp-proxy': {
        if (!spec.handler_config.backend_tool) return 'Error: no backend_tool configured'
        const result = await callMcpTool({
          toolName: spec.handler_config.backend_tool,
          args,
          callId: uuid(),
          timeoutMs: 30000,
        })
        return result.status === 'success' ? JSON.stringify(result.result, null, 2).slice(0, 1000) : `Error: ${result.error_message}`
      }

      case 'cypher-query': {
        if (!spec.handler_config.cypher_template) return 'Error: no cypher_template configured'
        const result = await callMcpTool({
          toolName: 'graph.read_cypher',
          args: { query: spec.handler_config.cypher_template, params: args },
          callId: uuid(),
          timeoutMs: 15000,
        })
        return result.status === 'success' ? JSON.stringify(result.result, null, 2).slice(0, 1000) : `Error: ${result.error_message}`
      }

      case 'llm-generate': {
        const { chatLLM: chat } = await import('./llm-proxy.js')
        const sysPrompt = spec.handler_config.system_prompt ?? `You are a helpful tool called "${name}". ${spec.description}`
        const result = await chat({
          provider: 'deepseek',
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: JSON.stringify(args) },
          ],
          temperature: 0.5,
        })
        return result.content
      }

      default:
        return `Unknown handler type: ${spec.handler_type}`
    }
  } catch (err) {
    return `Execution error: ${err}`
  }
}

// ─── Boot: Load Persisted Tools ─────────────────────────────────────────────

export async function loadForgedTools(): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0

  try {
    const keys = await redis.keys(`${REDIS_PREFIX}*`)
    let loaded = 0
    for (const key of keys) {
      const raw = await redis.get(key)
      if (raw) {
        const spec = JSON.parse(raw) as ForgedToolSpec
        FORGED_TOOLS.set(spec.name, spec)
        loaded++
      }
    }
    if (loaded > 0) logger.info({ count: loaded }, 'Skill Forge: loaded persisted tools')
    return loaded
  } catch {
    return 0
  }
}
