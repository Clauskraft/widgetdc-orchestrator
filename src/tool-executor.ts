/**
 * tool-executor.ts — Maps high-level tool calls to orchestrator modules.
 *
 * LIN-495: Orchestrator-Mediated Function Calling (Vej 1.5)
 *
 * Exposes 7 high-level tools to the LLM. Each tool internally delegates
 * to existing orchestrator modules (dual-rag, cognitive-proxy, chain-engine,
 * mcp-caller, verification-gate).
 *
 * The LLM decides WHICH tools to call. The orchestrator decides HOW to execute.
 */
import { dualChannelRAG } from './dual-rag.js'
import { callCognitive, isRlmAvailable } from './cognitive-proxy.js'
import { callMcpTool } from './mcp-caller.js'
import { executeChain } from './chain-engine.js'
import { verifyChainOutput } from './verification-gate.js'
import { runInvestigation } from './investigate-chain.js'
import { logger } from './logger.js'
import { v4 as uuid } from 'uuid'
import { toOpenAITools, getTool } from './tool-registry.js'

// ─── OpenAI-format tool definitions (compiled from canonical registry) ──────

export const ORCHESTRATOR_TOOLS = toOpenAITools()

// Legacy reference kept for backward compat — remove when all consumers use registry
const _LEGACY_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge',
      description: 'Search the WidgeTDC knowledge graph and semantic vector store. Use for ANY question about platform data, consulting knowledge, patterns, documents, or entities. Returns merged results from SRAG (semantic) and Neo4j (graph).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          max_results: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reason_deeply',
      description: 'Send a complex question to the RLM reasoning engine for deep multi-step analysis. Use for strategy questions, architecture analysis, comparisons, evaluations, and planning. More powerful than search — actually reasons about the data.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The complex question to reason about' },
          mode: { type: 'string', enum: ['reason', 'analyze', 'plan'], description: 'Reasoning mode (default: reason)' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'query_graph',
      description: 'Execute a Cypher query against the Neo4j knowledge graph (520K nodes, 4M relationships). Use for structured data queries like counting nodes, finding relationships, listing entities, or checking status.',
      parameters: {
        type: 'object',
        properties: {
          cypher: { type: 'string', description: 'Neo4j Cypher query (read-only, parameterized)' },
          params: { type: 'object', description: 'Query parameters (optional)' },
        },
        required: ['cypher'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_tasks',
      description: 'Get active tasks, issues, and project status from the knowledge graph. Use when asked about project status, next steps, blockers, sprints, or Linear issues.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['active', 'blocked', 'recent', 'all'], description: 'Task filter (default: active)' },
          keyword: { type: 'string', description: 'Optional keyword to filter tasks' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'call_mcp_tool',
      description: 'Call any of the 448 MCP tools on the WidgeTDC backend. Use for specific platform operations like embedding, compliance checks, memory operations, agent coordination, etc. Check tool name carefully.',
      parameters: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', description: 'MCP tool name (e.g., srag.query, graph.health, audit.dashboard)' },
          payload: { type: 'object', description: 'Tool payload arguments' },
        },
        required: ['tool_name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_platform_health',
      description: 'Get current health status of all WidgeTDC platform services (backend, RLM engine, Neo4j graph, Redis). Use when asked about system status, uptime, or health.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_documents',
      description: 'Search for specific documents, files, reports, or artifacts in the platform. Returns document metadata and content snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Document search query' },
          doc_type: { type: 'string', description: 'Optional filter: TDCDocument, ConsultingArtifact, Pattern, etc.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linear_issues',
      description: 'Get issues from Linear project management. Use for project status, active tasks, sprint progress, blockers, or specific issue details (LIN-xxx). Returns real-time Linear data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query or issue identifier (e.g., "LIN-493" or "cloud chat platform")' },
          status: { type: 'string', enum: ['active', 'done', 'backlog', 'all'], description: 'Filter by status (default: active)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linear_issue_detail',
      description: 'Get detailed info about a specific Linear issue by identifier (e.g., LIN-493). Returns full description, comments, status, assignee, sub-issues.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'Issue identifier (e.g., LIN-493)' },
        },
        required: ['identifier'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_chain',
      description: 'Execute a multi-step agent chain. Supports sequential (A→B→C), parallel (A+B+C), debate (two agents argue, third judges), and loop modes. Use for complex workflows that need multiple tool calls coordinated together.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Chain name/description' },
          mode: { type: 'string', enum: ['sequential', 'parallel', 'debate', 'loop'], description: 'Execution mode' },
          steps: {
            type: 'array',
            description: 'Chain steps — each has tool_name or cognitive_action + arguments',
            items: {
              type: 'object',
              properties: {
                agent_id: { type: 'string', description: 'Agent identifier' },
                tool_name: { type: 'string', description: 'MCP tool to call' },
                cognitive_action: { type: 'string', description: 'RLM action: reason, analyze, plan' },
                prompt: { type: 'string', description: 'Prompt or arguments' },
              },
            },
          },
        },
        required: ['name', 'mode', 'steps'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'investigate',
      description: 'Run a multi-agent deep investigation on a topic. Returns a comprehensive analysis artifact with graph data, compliance, strategy, and reasoning.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The topic to investigate deeply' },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_notebook',
      description: 'Create an interactive consulting notebook with query, insight, data, and action cells. Executes all cells and returns a full notebook with results. Great for structured analysis on any topic.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The topic to build a notebook around' },
          cells: {
            type: 'array',
            description: 'Optional: custom cells array. If omitted, auto-generates cells from topic.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['query', 'insight', 'data', 'action'] },
                id: { type: 'string' },
                query: { type: 'string' },
                prompt: { type: 'string' },
                source_cell_id: { type: 'string' },
                visualization: { type: 'string', enum: ['table', 'chart'] },
                recommendation: { type: 'string' },
              },
            },
          },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'verify_output',
      description: 'Run verification checks on a piece of content or data. Checks quality, accuracy, and compliance. Use after getting results from other tools to validate them before presenting to user.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Content to verify' },
          checks: {
            type: 'array',
            description: 'Verification checks to run',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Check name' },
                tool_name: { type: 'string', description: 'MCP tool for verification' },
              },
            },
          },
        },
        required: ['content'],
      },
    },
  },
]
void _LEGACY_TOOLS // suppress unused warning — will be removed in Phase 3

// ─── Token tracking ─────────────────────────────────────────────────────────

let totalTokensSaved = 0
let totalFoldingCalls = 0

export function getTokenSavings() {
  return { totalTokensSaved, totalFoldingCalls, avgSavingsPerFold: totalFoldingCalls > 0 ? Math.round(totalTokensSaved / totalFoldingCalls) : 0 }
}

/**
 * Compress tool result if too large. Estimates ~4 chars per token.
 * Results over 1500 chars (~375 tokens) get folded to max 800 chars.
 */
function foldToolResult(content: string, toolName: string): string {
  const MAX_CHARS = 800
  const TARGET_CHARS = 500

  if (content.length <= MAX_CHARS) return content

  const originalTokens = Math.ceil(content.length / 4)
  totalFoldingCalls++

  // Smart truncation: keep structure, remove noise
  let folded: string
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) {
      // Truncate arrays to first 5 items + count
      const truncated = parsed.slice(0, 5)
      folded = JSON.stringify(truncated, null, 1).slice(0, TARGET_CHARS)
      folded += `\n... (${parsed.length} total items, showing first 5)`
    } else if (typeof parsed === 'object') {
      // Keep top-level keys, truncate nested values
      const slim: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.length > 200) {
          slim[k] = v.slice(0, 200) + '...'
        } else if (Array.isArray(v) && v.length > 3) {
          slim[k] = [...v.slice(0, 3), `... +${v.length - 3} more`]
        } else {
          slim[k] = v
        }
      }
      folded = JSON.stringify(slim, null, 1).slice(0, TARGET_CHARS)
    } else {
      folded = content.slice(0, TARGET_CHARS) + '...'
    }
  } catch {
    // Not JSON — plain text truncation with section preservation
    const lines = content.split('\n')
    folded = lines.slice(0, 15).join('\n').slice(0, TARGET_CHARS)
    if (lines.length > 15) folded += `\n... (${lines.length} total lines)`
  }

  const foldedTokens = Math.ceil(folded.length / 4)
  const saved = originalTokens - foldedTokens
  totalTokensSaved += saved

  logger.debug({ tool: toolName, originalTokens, foldedTokens, saved }, 'Tool result folded')
  return folded
}

// ─── Tool execution ─────────────────────────────────────────────────────────

interface ToolCall {
  id: string
  function: {
    name: string
    arguments: string
  }
}

interface ToolResult {
  tool_call_id: string
  role: 'tool'
  content: string
}

export async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const results = await Promise.allSettled(
    toolCalls.map(tc => executeOne(tc))
  )

  return results.map((r, i) => {
    const raw = r.status === 'fulfilled' ? r.value : `Error: ${(r as PromiseRejectedResult).reason}`
    return {
      tool_call_id: toolCalls[i].id,
      role: 'tool' as const,
      content: foldToolResult(raw, toolCalls[i].function.name),
    }
  })
}

async function executeOne(tc: ToolCall): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(tc.function.arguments)
  } catch {
    return `Error: Invalid JSON arguments`
  }

  const name = tc.function.name
  logger.info({ tool: name, args_keys: Object.keys(args) }, 'Executing tool call')

  try {
    return await executeToolByName(name, args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ tool: name, error: msg }, 'Tool execution failed — returning graceful fallback')
    return buildToolFallback(name, msg)
  }
}

function buildToolFallback(toolName: string, error: string): string {
  const short = error.length > 200 ? error.slice(0, 200) + '...' : error
  switch (toolName) {
    case 'search_knowledge':
      return `Knowledge search unavailable (${short}). Try query_graph with a direct Cypher query, or call_mcp_tool with srag.query as a fallback.`
    case 'reason_deeply':
      return `RLM reasoning unavailable (${short}). Try breaking the question into simpler parts using search_knowledge or query_graph.`
    case 'query_graph':
      return `Neo4j graph query failed (${short}). The graph may be temporarily slow — try a simpler query or use search_knowledge instead.`
    case 'linear_issues':
    case 'linear_issue_detail':
      return `Linear query failed (${short}). Linear data may be temporarily unavailable.`
    default:
      return `Tool "${toolName}" failed: ${short}`
  }
}

// ─── Unified Execution (Triple-Protocol ABI — LIN-564) ─────────────────────

export interface ExecutionResult {
  call_id: string
  tool_name: string
  status: 'success' | 'error' | 'timeout'
  result: unknown
  error_message?: string
  duration_ms: number
  completed_at: string
  was_folded: boolean
  source_protocol: string
  deprecation_notice?: {
    deprecated: true
    since?: string
    message?: string
    sunset_date?: string
    replaced_by?: string
  }
}

/**
 * Execute a tool by name with structured result envelope.
 * Used by REST /api/tools/:name endpoint and MCP gateway.
 */
export async function executeToolUnified(
  toolName: string,
  args: Record<string, unknown>,
  opts?: { call_id?: string; source_protocol?: string; fold?: boolean },
): Promise<ExecutionResult> {
  const callId = opts?.call_id ?? uuid()
  const t0 = Date.now()

  // ─── Deprecation check (LIN-573) ───────────────────────────────────────
  let deprecation_notice: ExecutionResult['deprecation_notice']
  const toolDef = getTool(toolName)
  if (toolDef?.deprecated) {
    logger.warn({ tool: toolName }, `Deprecated tool called: ${toolName}. ${toolDef.deprecatedMessage ?? ''}`)
    deprecation_notice = {
      deprecated: true,
      since: toolDef.deprecatedSince,
      message: toolDef.deprecatedMessage,
      sunset_date: toolDef.sunsetDate,
      replaced_by: toolDef.replacedBy,
    }
  }

  try {
    const rawResult = await executeToolByName(toolName, args)
    const duration = Date.now() - t0
    const shouldFold = opts?.fold !== false
    const folded = shouldFold ? foldToolResult(rawResult, toolName) : rawResult

    // Prepend deprecation warning to result if deprecated
    const resultWithWarning = deprecation_notice
      ? `[DEPRECATED] ${toolDef?.deprecatedMessage ?? `Tool "${toolName}" is deprecated.`}${toolDef?.replacedBy ? ` Use "${toolDef.replacedBy}" instead.` : ''}\n\n${folded}`
      : folded

    return {
      call_id: callId,
      tool_name: toolName,
      status: 'success',
      result: resultWithWarning,
      duration_ms: duration,
      completed_at: new Date().toISOString(),
      was_folded: shouldFold && folded !== rawResult,
      source_protocol: opts?.source_protocol ?? 'unknown',
      ...(deprecation_notice ? { deprecation_notice } : {}),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      call_id: callId,
      tool_name: toolName,
      status: 'error',
      result: null,
      error_message: msg,
      duration_ms: Date.now() - t0,
      completed_at: new Date().toISOString(),
      was_folded: false,
      source_protocol: opts?.source_protocol ?? 'unknown',
      ...(deprecation_notice ? { deprecation_notice } : {}),
    }
  }
}

async function executeToolByName(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'search_knowledge': {
      if (!args.query || typeof args.query !== 'string') return 'Error: query is required and must be a string'
      const result = await dualChannelRAG(args.query as string, {
        maxResults: (args.max_results as number) ?? 10,
      })
      if (result.merged_context.length === 0) return 'No results found for this query.'
      const header = `[${result.route_strategy}] ${result.graphrag_count} graphrag + ${result.srag_count} semantic + ${result.cypher_count} graph (${result.duration_ms}ms, channels: ${result.channels_used.join(',')}${result.pollution_filtered > 0 ? `, ${result.pollution_filtered} polluted filtered` : ''}):`
      return `${header}\n\n${result.merged_context}`
    }

    case 'reason_deeply': {
      if (!isRlmAvailable()) return 'RLM Engine is not available.'
      const mode = (args.mode as string) ?? 'reason'
      const result = await callCognitive(mode, {
        prompt: args.question as string,
        context: { source: 'chat-tool-call' },
        agent_id: 'chat-orchestrator',
        depth: 1,
      }, 45000)
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    }

    case 'query_graph': {
      const cypher = args.cypher as string
      if (!cypher || typeof cypher !== 'string') return 'Error: cypher query is required and must be a string'
      // P0 FIX: Block destructive Cypher operations (write guard)
      const WRITE_KEYWORDS = /\b(DELETE|DETACH|CREATE|MERGE|SET|REMOVE|DROP|CALL\s+dbms)\b/i
      if (WRITE_KEYWORDS.test(cypher)) {
        return 'Error: query_graph is read-only. Write operations (DELETE, CREATE, MERGE, SET, REMOVE, DROP) are not allowed.'
      }
      const result = await callMcpTool({
        toolName: 'graph.read_cypher',
        args: { query: cypher, params: args.params ?? {} },
        callId: uuid(),
        timeoutMs: 15000,
      })
      if (result.status !== 'success') return `Graph query failed: ${result.error_message}`
      const rows = Array.isArray(result.result) ? result.result
        : (result.result as any)?.results ?? result.result
      return JSON.stringify(rows, null, 2).slice(0, 800)
    }

    case 'check_tasks': {
      const filter = (args.filter as string) ?? 'active'
      const keyword = args.keyword as string ?? ''

      let cypher: string
      if (filter === 'blocked') {
        cypher = `MATCH (n) WHERE (n:Task OR n:L3Task) AND toLower(coalesce(n.status,'')) CONTAINS 'block' RETURN coalesce(n.identifier,n.id) AS id, n.title AS title, n.status AS status ORDER BY n.updatedAt DESC LIMIT 15`
      } else if (filter === 'recent') {
        cypher = `MATCH (n) WHERE (n:Task OR n:L3Task) RETURN coalesce(n.identifier,n.id) AS id, n.title AS title, n.status AS status ORDER BY n.updatedAt DESC LIMIT 15`
      } else {
        cypher = `MATCH (n) WHERE (n:Task OR n:L3Task) AND n.status IN ['In Progress', 'Todo', 'Backlog'] RETURN coalesce(n.identifier,n.id) AS id, n.title AS title, n.status AS status ORDER BY n.updatedAt DESC LIMIT 15`
      }

      const result = await callMcpTool({
        toolName: 'graph.read_cypher',
        args: { query: cypher },
        callId: uuid(),
        timeoutMs: 10000,
      })

      if (result.status !== 'success') return `Task query failed: ${result.error_message}`
      const rows = (result.result as any)?.results ?? result.result ?? []
      if (!Array.isArray(rows) || rows.length === 0) return 'No tasks found.'
      return rows.map((r: any) => `- [${r.id ?? '?'}] ${r.title ?? 'Untitled'} (${r.status ?? '?'})`).join('\n')
    }

    case 'call_mcp_tool': {
      const result = await callMcpTool({
        toolName: args.tool_name as string,
        args: (args.payload as Record<string, unknown>) ?? {},
        callId: uuid(),
        timeoutMs: 30000,
      })
      if (result.status !== 'success') return `MCP tool failed: ${result.error_message}`
      return JSON.stringify(result.result, null, 2).slice(0, 800)
    }

    case 'get_platform_health': {
      const [backendHealth, graphHealth] = await Promise.allSettled([
        callMcpTool({ toolName: 'graph.health', args: {}, callId: uuid(), timeoutMs: 10000 }),
        callMcpTool({ toolName: 'graph.stats', args: {}, callId: uuid(), timeoutMs: 10000 }),
      ])

      const parts: string[] = []
      if (backendHealth.status === 'fulfilled' && backendHealth.value.status === 'success') {
        parts.push(`Neo4j: ${JSON.stringify(backendHealth.value.result)}`)
      }
      if (graphHealth.status === 'fulfilled' && graphHealth.value.status === 'success') {
        const stats = graphHealth.value.result as any
        parts.push(`Graph: ${stats?.nodes ?? '?'} nodes, ${stats?.relationships ?? '?'} rels`)
      }
      return parts.join('\n') || 'Health check returned no data.'
    }

    case 'search_documents': {
      const result = await callMcpTool({
        toolName: 'srag.query',
        args: { query: args.query as string },
        callId: uuid(),
        timeoutMs: 20000,
      })
      if (result.status !== 'success') return `Document search failed: ${result.error_message}`
      return JSON.stringify(result.result, null, 2).slice(0, 800)
    }

    case 'linear_issues': {
      const status = (args.status as string) ?? 'active'
      const limit = (args.limit as number) ?? 10
      const query = args.query as string ?? ''

      // Use linear.issues MCP tool (backend has LINEAR_API_KEY)
      const payload: Record<string, unknown> = { limit }
      if (query) payload.query = query
      if (status === 'active') payload.status = 'started'
      else if (status === 'done') payload.status = 'completed'
      else if (status === 'backlog') payload.status = 'backlog'

      const result = await callMcpTool({
        toolName: 'linear.issues',
        args: payload,
        callId: uuid(),
        timeoutMs: 15000,
      })
      if (result.status !== 'success') return `Linear query failed: ${result.error_message}`

      const data = result.result as any
      const issues = data?.issues ?? data ?? []
      if (!Array.isArray(issues) || issues.length === 0) return 'No Linear issues found.'

      return issues.map((i: any) =>
        `- [${i.identifier}] ${i.title} (${i.status}) ${i.assignee ? `→ ${i.assignee}` : ''} ${i.url ?? ''}`
      ).join('\n')
    }

    case 'linear_issue_detail': {
      const identifier = args.identifier as string
      const result = await callMcpTool({
        toolName: 'linear.issue_get',
        args: { identifier },
        callId: uuid(),
        timeoutMs: 15000,
      })
      if (result.status !== 'success') return `Linear issue lookup failed: ${result.error_message}`
      return JSON.stringify(result.result, null, 2).slice(0, 800)
    }

    case 'investigate': {
      const topic = args.topic as string
      if (!topic) return 'Error: topic is required'
      try {
        const result = await runInvestigation(topic)
        const summary = `Investigation "${topic}" ${result.execution.status} — ${result.execution.steps_completed}/${result.execution.steps_total} steps, ${result.execution.duration_ms}ms`
        const artifactInfo = result.artifact_url
          ? `\nArtifact: ${result.artifact_url}\nMarkdown: ${result.artifact_markdown_url}`
          : '\nArtifact: creation skipped (Redis unavailable or error)'
        const output = result.execution.final_output
          ? `\n\nSynthesis:\n${typeof result.execution.final_output === 'string' ? result.execution.final_output : JSON.stringify(result.execution.final_output, null, 2).slice(0, 600)}`
          : ''
        return summary + artifactInfo + output
      } catch (err) {
        return `Investigation failed: ${err}`
      }
    }

    case 'run_chain': {
      const steps = (args.steps as any[]) ?? []
      const chainDef = {
        name: args.name as string,
        mode: (args.mode as 'sequential' | 'parallel' | 'debate' | 'loop') ?? 'sequential',
        steps: steps.map((s: any, i: number) => ({
          id: `step-${i}`,
          agent_id: s.agent_id ?? 'chat-orchestrator',
          tool_name: s.tool_name,
          cognitive_action: s.cognitive_action,
          prompt: s.prompt,
          arguments: s.arguments ?? (s.prompt ? { query: s.prompt } : {}),
        })),
      }
      try {
        const execution = await executeChain(chainDef)
        const summary = `Chain "${execution.name}" (${execution.mode}): ${execution.status} — ${execution.steps_completed}/${execution.steps_total} steps, ${execution.duration_ms}ms`
        const output = execution.final_output
          ? `\n\nResult: ${typeof execution.final_output === 'string' ? execution.final_output : JSON.stringify(execution.final_output, null, 2).slice(0, 800)}`
          : ''
        return summary + output + (execution.error ? `\nError: ${execution.error}` : '')
      } catch (err) {
        return `Chain execution failed: ${err}`
      }
    }

    case 'create_notebook': {
      const topic = args.topic as string
      if (!topic) return 'Error: topic is required'

      // Build cells: auto-generate from topic if not provided
      const customCells = args.cells as any[] | undefined
      const cells = customCells && customCells.length > 0
        ? customCells
        : [
            { type: 'query', id: 'q1', query: `MATCH (n) WHERE toLower(coalesce(n.title,'')) CONTAINS toLower($topic) OR toLower(coalesce(n.name,'')) CONTAINS toLower($topic) RETURN labels(n)[0] AS type, coalesce(n.title, n.name) AS name, n.status AS status LIMIT 20`, params: { topic } },
            { type: 'query', id: 'q2', query: `What are the key insights and patterns related to this topic?`, params: { topic } },
            { type: 'insight', id: 'i1', prompt: `Analyze the findings about "${topic}" and provide strategic consulting insights, key patterns, and recommendations.` },
            { type: 'data', id: 'd1', source_cell_id: 'q1', visualization: 'table' },
            { type: 'action', id: 'a1', recommendation: `Review the analysis of "${topic}" and determine next steps for the consulting engagement.` },
          ]

      try {
        // Call the notebook execute endpoint internally
        const { config: appConfig } = await import('./config.js')
        const baseUrl = appConfig.nodeEnv === 'production'
          ? 'https://orchestrator-production-c27e.up.railway.app'
          : `http://localhost:${appConfig.port}`
        const resp = await fetch(`${baseUrl}/api/notebooks/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appConfig.orchestratorApiKey}`,
          },
          body: JSON.stringify({ title: `Notebook: ${topic}`, cells, created_by: 'chat-orchestrator' }),
        })
        const data = await resp.json() as { success: boolean; notebook?: { $id: string; title: string; cells: any[] }; error?: string }
        if (!data.success) return `Notebook creation failed: ${data.error}`

        const nb = data.notebook!
        const cellSummaries = nb.cells.map((c: any) => {
          if (c.type === 'query') return `[Query] ${c.query.slice(0, 60)}... → ${c.result ? 'OK' : 'no result'}`
          if (c.type === 'insight') return `[Insight] ${(c.content ?? '').slice(0, 100)}...`
          if (c.type === 'data') return `[Data] from ${c.source_cell_id}: ${c.result ? 'OK' : 'no data'}`
          if (c.type === 'action') return `[Action] ${c.recommendation.slice(0, 80)}`
          return `[${c.type}]`
        }).join('\n')

        return `Notebook created: "${nb.title}"\nID: ${nb.$id}\nCells: ${nb.cells.length}\n\n${cellSummaries}\n\nView: /api/notebooks/${encodeURIComponent(nb.$id)}\nMarkdown: /api/notebooks/${encodeURIComponent(nb.$id)}.md`
      } catch (err) {
        return `Notebook creation failed: ${err}`
      }
    }

    case 'verify_output': {
      const content = args.content as string
      const checks = (args.checks as any[]) ?? [
        { name: 'graph_health', tool_name: 'graph.health', arguments: {} },
      ]
      try {
        const result = await verifyChainOutput(
          { content },
          {
            checks: checks.map((c: any) => ({
              name: c.name ?? 'check',
              tool_name: c.tool_name ?? 'graph.health',
              arguments: c.arguments ?? {},
            })),
          }
        )
        return JSON.stringify(result, null, 2).slice(0, 800)
      } catch (err) {
        return `Verification failed: ${err}`
      }
    }

    case 'precedent_search': {
      const query = args.query as string
      if (!query || query.length < 3) return 'Error: query is required (min 3 chars)'
      try {
        const { findSimilarClients } = await import('./similarity-engine.js')
        const result = await findSimilarClients({
          query,
          dimensions: args.dimensions as any,
          max_results: (typeof args.max_results === 'number' && Number.isInteger(args.max_results)) ? args.max_results : undefined,
          structural_weight: (typeof args.structural_weight === 'number') ? args.structural_weight : undefined,
        })
        if (result.matches.length === 0) return `No similar clients found for "${query}" (method: ${result.method}, ${result.duration_ms}ms)`
        const lines = result.matches.map((m, i) => {
          const dims = m.shared_dimensions.map(d => `${d.dimension}: ${d.shared_values.slice(0, 3).join(', ')}`).join(' | ')
          return `${i + 1}. ${m.client_name} (score: ${m.overall_score.toFixed(2)}, ${m.node_type})${dims ? ` — ${dims}` : ''}`
        })
        return `Found ${result.matches.length} similar clients (method: ${result.method}, ${result.duration_ms}ms):\n\n${lines.join('\n')}`
      } catch (err) {
        return `Precedent search failed: ${err}`
      }
    }

    case 'generate_deliverable': {
      const prompt = args.prompt as string
      if (!prompt || prompt.length < 10) return 'Error: prompt is required (min 10 chars)'
      const type = (args.type as string) ?? 'analysis'
      if (!['analysis', 'roadmap', 'assessment'].includes(type)) return 'Error: type must be analysis, roadmap, or assessment'
      try {
        const { generateDeliverable } = await import('./deliverable-engine.js')
        const rawMax = args.max_sections
        const maxSections = (typeof rawMax === 'number' && Number.isInteger(rawMax)) ? rawMax : undefined
        const result = await generateDeliverable({
          prompt,
          type: type as 'analysis' | 'roadmap' | 'assessment',
          format: (args.format as 'pdf' | 'markdown') ?? 'markdown',
          max_sections: maxSections,
        })
        const summary = `Deliverable "${result.title}" — ${result.status} (${result.metadata.sections_count} sections, ${result.metadata.total_citations} citations, ${result.metadata.generation_ms}ms)`
        const preview = result.markdown.slice(0, 600)
        return `${summary}\n\nID: ${result.$id}\nURL: /api/deliverables/${encodeURIComponent(result.$id)}\nMarkdown: /api/deliverables/${encodeURIComponent(result.$id)}/markdown\n\n${preview}...`
      } catch (err) {
        return `Deliverable generation failed: ${err}`
      }
    }

    case 'governance_matrix': {
      const { getEnforcementMatrix, getEnforcementScore, getGaps } = await import('./manifesto-governance.js')
      const filter = (args.filter as string) ?? 'all'
      if (filter === 'gaps') {
        const gaps = getGaps()
        return gaps.length === 0
          ? 'All 10 manifesto principles are ENFORCED. No gaps.'
          : `${gaps.length} principle(s) with gaps:\n${gaps.map(g => `P${g.number} ${g.name} — ${g.status}: ${g.gap_remediation ?? 'No remediation specified'}`).join('\n')}`
      }
      const principles = filter === 'enforced'
        ? getEnforcementMatrix().filter(p => p.status === 'ENFORCED')
        : getEnforcementMatrix()
      const score = getEnforcementScore()
      const lines = principles.map(p =>
        `P${p.number} ${p.name} — ${p.status} [${p.enforcement_layer}] ${p.mechanism}`
      )
      return `Manifesto Enforcement Matrix (${score.score}):\n${lines.join('\n')}`
    }

    case 'run_osint_scan': {
      try {
        const { runOsintScan } = await import('./osint-scanner.js')
        const result = await runOsintScan({
          domains: args.domains as string[] | undefined,
          scan_type: args.scan_type as 'full' | 'ct_only' | 'dmarc_only' | undefined,
        })
        const summary = `OSINT scan ${result.scan_id} completed in ${result.duration_ms}ms — ${result.domains_scanned} domains, ${result.ct_entries} CT entries, ${result.dmarc_results} DMARC results, ${result.total_new_nodes} new nodes (tools: ${result.tools_available ? 'live' : 'fallback'})`
        if (result.errors.length > 0) {
          return `${summary}\n\nErrors (${result.errors.length}):\n${result.errors.slice(0, 10).join('\n')}`
        }
        return summary
      } catch (err) {
        return `OSINT scan failed: ${err}`
      }
    }

    case 'list_tools': {
      const { TOOL_REGISTRY } = await import('./tool-registry.js')
      let tools = TOOL_REGISTRY
      if (args.namespace && typeof args.namespace === 'string') {
        tools = tools.filter(t => t.namespace === args.namespace)
      }
      if (args.category && typeof args.category === 'string') {
        tools = tools.filter(t => t.category === args.category)
      }
      const summary = tools.map(t =>
        `- ${t.name} [${t.namespace}/${t.category}] — ${t.description.slice(0, 80)}${t.description.length > 80 ? '...' : ''} (${t.availableVia.join(',')})`
      )
      return `${tools.length} tools${args.namespace ? ` in namespace "${args.namespace}"` : ''}${args.category ? ` in category "${args.category}"` : ''}:\n\n${summary.join('\n')}`
    }

    case 'run_evolution': {
      const { runEvolutionLoop } = await import('./evolution-loop.js')
      const result = await runEvolutionLoop({
        focus_area: args.focus_area as string | undefined,
        dry_run: (args.dry_run as boolean) ?? false,
      })
      return `Evolution cycle ${result.status}: ${result.summary}`
    }

    default:
      return `Unknown tool: ${name}`
  }
}
