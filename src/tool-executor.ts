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
      // F4: Auto-enrichment hook — extract new entities from RAG answer (non-blocking)
      try {
        const { hookAutoEnrichment } = await import('./compound-hooks.js')
        hookAutoEnrichment(result.merged_context, args.query as string)
      } catch { /* non-blocking */ }
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

    case 'ingest_document': {
      const content = args.content as string
      const filename = args.filename as string
      if (!content || content.length < 20) return 'Error: content required (min 20 chars)'
      if (!filename) return 'Error: filename required'
      try {
        const { ingestDocument } = await import('./document-intelligence.js')
        const result = await ingestDocument({
          content, filename,
          domain: args.domain as string,
          extract_entities: args.extract_entities !== false,
        })
        return `Ingested "${result.filename}": ${result.entities_extracted} entities, ${result.nodes_merged} nodes merged, ${result.tables_found} tables (${result.parsing_method}, ${result.duration_ms}ms)`
      } catch (err) {
        return `Document ingestion failed: ${err}`
      }
    }

    case 'build_communities': {
      try {
        const { buildCommunitySummaries } = await import('./hierarchical-intelligence.js')
        const result = await buildCommunitySummaries()
        return `Communities built: ${result.communities_created} communities, ${result.summaries_generated} summaries, ${result.relationships_created} rels (${result.method}, ${result.duration_ms}ms)`
      } catch (err) {
        return `Community build failed: ${err}`
      }
    }

    case 'adaptive_rag_dashboard': {
      try {
        const { getAdaptiveRAGDashboard } = await import('./adaptive-rag.js')
        const d = await getAdaptiveRAGDashboard()
        const lines = [
          `Compound Metric: ${d.compound_metric.score} (accuracy=${d.compound_metric.accuracy}, quality=${d.compound_metric.quality}, coverage=${d.compound_metric.coverage})`,
          `Training samples: ${d.outcome_count}`,
          `Weights updated: ${d.weights.updated_at}`,
          ...d.stats.map(s => `  ${s.strategy}: ${s.total_queries} queries, confidence=${s.avg_confidence.toFixed(2)}, zero-result=${(s.zero_result_rate * 100).toFixed(0)}%`),
        ]
        return lines.join('\n')
      } catch (err) {
        return `Adaptive RAG dashboard failed: ${err}`
      }
    }

    case 'graph_hygiene_run': {
      try {
        const { runGraphHygiene } = await import('./graph-hygiene-cron.js')
        const result = await runGraphHygiene()
        const m = result.metrics
        const alertStr = result.alerts.length > 0
          ? `\nALERTS: ${result.alerts.map(a => a.message).join('; ')}`
          : '\nNo alerts — all metrics within thresholds.'
        return `Graph Health (${result.duration_ms}ms):\n  Orphan ratio: ${(m.orphan_ratio * 100).toFixed(1)}%\n  Avg rels/node: ${m.avg_rels_per_node.toFixed(1)}\n  Embedding coverage: ${(m.embedding_coverage * 100).toFixed(1)}%\n  Domains: ${m.domain_count}\n  Stale nodes: ${m.stale_node_count}\n  Pollution: ${m.pollution_count}${alertStr}`
      } catch (err) {
        return `Graph hygiene failed: ${err}`
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

    // ─── SNOUT Wave 2: Steal Smart ──────────────────────────────────────────

    case 'adaptive_rag_query': {
      const query = args.query as string
      if (!query || query.length < 2) return 'Error: query is required (min 2 chars)'
      try {
        const result = await dualChannelRAG(query, {
          maxResults: (args.max_results as number) ?? 10,
        })
        if (result.merged_context.length === 0) return `No results found for "${query}" (strategy: ${result.route_strategy}, ${result.duration_ms}ms)`
        const header = `[Adaptive RAG: ${result.route_strategy}] ${result.graphrag_count} graphrag + ${result.srag_count} semantic + ${result.cypher_count} graph (${result.duration_ms}ms, channels: ${result.channels_used.join(',')})`
        return `${header}\n\n${result.merged_context}`
      } catch (err) {
        return `Adaptive RAG query failed: ${err}`
      }
    }

    case 'adaptive_rag_retrain': {
      try {
        const { retrainRoutingWeights } = await import('./adaptive-rag.js')
        const result = await retrainRoutingWeights()
        return `Retrain complete (${result.training_samples} samples):\n  Compound metric: ${result.compound_metric.toFixed(3)}\n  Old weights: ${JSON.stringify(result.old_weights)}\n  New weights: ${JSON.stringify(result.new_weights)}`
      } catch (err) {
        return `Retrain failed: ${err}`
      }
    }

    case 'adaptive_rag_reward': {
      const query = args.query as string
      const strategy = args.strategy as string
      const reward = args.reward as number
      if (!query || !strategy || typeof reward !== 'number') return 'Error: query, strategy, and reward (number) are required'
      if (reward < -1 || reward > 1) return 'Error: reward must be between -1.0 and 1.0'
      try {
        const { sendQLearningReward } = await import('./adaptive-rag.js')
        await sendQLearningReward(query, strategy, reward)
        return `Q-learning reward sent: strategy=${strategy}, reward=${reward}${args.reason ? `, reason: ${args.reason}` : ''}`
      } catch (err) {
        return `Reward signal failed: ${err}`
      }
    }

    case 'moa_query': {
      const query = args.query as string
      if (!query || query.length < 5) return 'Error: query is required (min 5 chars)'
      try {
        const { routeMoA } = await import('./moa-router.js')
        const result = await routeMoA({
          query,
          agents: args.agents as string[] | undefined,
          max_agents: args.max_agents as number | undefined,
          provider: args.provider as string | undefined,
        })
        const agentList = result.agents_dispatched.join(', ') || 'none'
        const header = `MoA [${result.classification.complexity}] → ${agentList} (confidence: ${result.confidence.toFixed(2)}, ${result.duration_ms}ms)`
        return `${header}\nDomains: ${result.classification.domains.join(', ')}\n\n${result.consensus}`
      } catch (err) {
        return `MoA routing failed: ${err}`
      }
    }

    case 'critique_refine': {
      const query = args.query as string
      if (!query || query.length < 5) return 'Error: query is required (min 5 chars)'
      try {
        const { critiqueRefine } = await import('./critique-refine.js')
        const result = await critiqueRefine(
          query,
          (args.provider as string) ?? 'deepseek',
          args.principles as string[] | undefined,
          (args.max_rounds as number) ?? 1,
        )
        return `Critique-Refine (${result.provider}, ${result.rounds} round, ${result.duration_ms}ms):\n\n**Original:**\n${result.original.slice(0, 400)}\n\n**Critique:**\n${result.critique.slice(0, 300)}\n\n**Revised:**\n${result.revised.slice(0, 500)}`
      } catch (err) {
        return `Critique-refine failed: ${err}`
      }
    }

    case 'judge_response': {
      const query = args.query as string
      const response = args.response as string
      if (!query || !response) return 'Error: query and response are required'
      try {
        const { judgeResponse } = await import('./agent-judge.js')
        const result = await judgeResponse(
          query,
          response,
          args.context as string | undefined,
          (args.provider as string) ?? 'deepseek',
        )
        const s = result.score
        return `PRISM Score: ${s.aggregate}/10 (${result.duration_ms}ms)\n  P-Precision:   ${s.precision}/10\n  R-Reasoning:   ${s.reasoning}/10\n  I-Information:  ${s.information}/10\n  S-Safety:      ${s.safety}/10\n  M-Methodology: ${s.methodology}/10\n\n${s.explanation}`
      } catch (err) {
        return `Agent judge failed: ${err}`
      }
    }

    case 'forge_tool': {
      const toolName = args.name as string
      const purpose = args.purpose as string
      if (!toolName || !purpose) return 'Error: name and purpose are required'
      try {
        const { forgeTool, verifyForgedTool } = await import('./skill-forge.js')
        const handlerType = (args.handler_type as string) ?? 'llm-generate'
        const config: Record<string, string | undefined> = {}
        if (args.backend_tool) config.backend_tool = args.backend_tool as string
        if (args.system_prompt) config.system_prompt = args.system_prompt as string
        if (args.cypher_template) config.cypher_template = args.cypher_template as string

        const result = await forgeTool(toolName, purpose, handlerType as any, config)
        if (result.action !== 'created') return `Forge: ${result.message}`

        // Auto-verify unless disabled
        const shouldVerify = args.verify !== false
        let verifyMsg = ''
        if (shouldVerify) {
          const vResult = await verifyForgedTool(toolName)
          verifyMsg = `\nVerification: ${vResult.verified ? 'PASSED' : 'FAILED'} — ${vResult.result}`
        }

        return `Forged tool "${toolName}" (${handlerType}, ${result.duration_ms}ms)${verifyMsg}\nDescription: ${result.tool?.description}`
      } catch (err) {
        return `Forge failed: ${err}`
      }
    }

    case 'forge_analyze_gaps': {
      try {
        const { analyzeToolGaps } = await import('./skill-forge.js')
        const analysis = await analyzeToolGaps((args.provider as string) ?? 'deepseek')
        if (analysis.gaps.length === 0) return `No gaps found (${analysis.total_calls_analyzed} calls analyzed)`
        const gapLines = analysis.gaps.map(g => `- ${g.pattern} (freq: ${g.frequency}): ${g.suggestion}`)
        return `Gap Analysis (${analysis.total_calls_analyzed} calls, ${(analysis.failure_rate * 100).toFixed(1)}% failure rate):\n${gapLines.join('\n')}`
      } catch (err) {
        return `Gap analysis failed: ${err}`
      }
    }

    case 'forge_list': {
      try {
        const { getForgedTools } = await import('./skill-forge.js')
        const tools = getForgedTools()
        if (tools.length === 0) return 'No forged tools. Use forge_tool to create one.'
        return `${tools.length} forged tools:\n${tools.map(t => `- ${t.name} (${t.handler_type}, ${t.verified ? 'verified' : 'unverified'}) — ${t.description.slice(0, 80)}`).join('\n')}`
      } catch (err) {
        return `List failed: ${err}`
      }
    }

    // ─── v4.0.4 — Engagement Intelligence Engine (LIN-607) ─────────────────
    // All 5 cases delegate to engagement-engine.ts — zero duplicated logic.
    // Registry entries in tool-registry.ts surface these via REST tool-gateway,
    // Universal MCP gateway, OpenAPI /docs, and adoption telemetry.

    case 'engagement_create': {
      try {
        const { createEngagement } = await import('./engagement-engine.js')
        const result = await createEngagement({
          client: String(args.client ?? ''),
          domain: String(args.domain ?? ''),
          objective: String(args.objective ?? ''),
          start_date: String(args.start_date ?? ''),
          target_end_date: String(args.target_end_date ?? ''),
          budget_dkk: typeof args.budget_dkk === 'number' ? args.budget_dkk : undefined,
          team_size: typeof args.team_size === 'number' ? args.team_size : undefined,
          methodology_refs: Array.isArray(args.methodology_refs) ? (args.methodology_refs as unknown[]).map(String) : undefined,
        })
        return JSON.stringify({ engagement_id: result.$id, client: result.client, domain: result.domain, status: result.status, created_at: result.created_at })
      } catch (err) {
        return `Engagement create failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'engagement_match': {
      try {
        const { matchPrecedents } = await import('./engagement-engine.js')
        const result = await matchPrecedents({
          objective: String(args.objective ?? ''),
          domain: String(args.domain ?? ''),
          max_results: typeof args.max_results === 'number' ? args.max_results : undefined,
        })
        if (result.matches.length === 0) {
          return `No precedents found for "${String(args.objective).slice(0, 60)}" in ${args.domain} (${result.query_ms}ms)`
        }
        const lines = result.matches.map((m, i) =>
          `${i + 1}. ${m.title} — similarity ${m.similarity}${m.precedent_outcome ? `, outcome: ${m.precedent_outcome}` : ''}${m.stale ? ' [STALE]' : ''}\n   ${m.match_reasoning}`,
        )
        return `Found ${result.matches.length} precedents (${result.query_ms}ms):\n\n${lines.join('\n\n')}`
      } catch (err) {
        return `Engagement match failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'engagement_plan': {
      try {
        const { generatePlan, PlanGateRejection } = await import('./engagement-engine.js')
        const result = await generatePlan({
          objective: String(args.objective ?? ''),
          domain: String(args.domain ?? ''),
          duration_weeks: Number(args.duration_weeks),
          team_size: Number(args.team_size),
          budget_dkk: typeof args.budget_dkk === 'number' ? args.budget_dkk : undefined,
          engagement_id: typeof args.engagement_id === 'string' ? args.engagement_id : undefined,
        })
        const phaseList = result.phases.map((p, i) => `${i + 1}. ${p.name} (${p.duration_weeks}w) — ${p.deliverables.join(', ')}`).join('\n')
        const riskList = result.risks.map(r => `[${r.severity}] ${r.description} → ${r.mitigation}`).join('\n')
        const gateInfo = result.high_stakes
          ? `\n\nGates: high_stakes=true, consensus=${result.consensus_proposal_id ?? 'none'}${result.rlm_mission_id ? `, rlm_mission=${result.rlm_mission_id} (${result.rlm_steps_executed} steps)` : ''}`
          : ''
        return `Plan generated (${result.generation_ms}ms, source: ${result.plan_source}, citations: ${result.total_citations}, confidence: ${result.avg_confidence}):\n\nPhases:\n${phaseList}\n\nRisks:\n${riskList}\n\nSkills: ${result.required_skills.join(', ')}${gateInfo}`
      } catch (err) {
        // Surface gate rejections with clear code so LLMs can retry with adjusted inputs.
        const errObj = err as { name?: string; code?: string; reason?: string; message?: string }
        if (errObj?.name === 'PlanGateRejection') {
          return `Plan rejected by gate: ${errObj.code ?? 'UNKNOWN'} — ${errObj.reason ?? errObj.message ?? 'no reason'}`
        }
        return `Plan generation failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'engagement_outcome': {
      try {
        const { recordOutcome } = await import('./engagement-engine.js')
        const result = await recordOutcome({
          engagement_id: String(args.engagement_id ?? ''),
          grade: args.grade as 'exceeded' | 'met' | 'partial' | 'missed',
          actual_end_date: String(args.actual_end_date ?? ''),
          deliverables_shipped: Array.isArray(args.deliverables_shipped) ? (args.deliverables_shipped as unknown[]).map(String) : [],
          what_went_well: String(args.what_went_well ?? ''),
          what_went_wrong: String(args.what_went_wrong ?? ''),
          recorded_by: String(args.recorded_by ?? 'tool-executor'),
          precedent_match_accuracy: typeof args.precedent_match_accuracy === 'number' ? args.precedent_match_accuracy : undefined,
        })
        return `Outcome recorded: ${result.engagement_id} grade=${result.grade}, Q-learning reward sent`
      } catch (err) {
        return `Outcome recording failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'engagement_list': {
      try {
        const { listEngagements } = await import('./engagement-engine.js')
        const limit = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 20, 1), 100)
        const engagements = await listEngagements(limit)
        if (engagements.length === 0) return 'No engagements found'
        const lines = engagements.map((e, i) =>
          `${i + 1}. ${e.client} (${e.domain}) — ${e.objective.slice(0, 60)}... [${e.status}]`,
        )
        return `${engagements.length} engagements:\n${lines.join('\n')}`
      } catch (err) {
        return `Engagement list failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // ─── v4.0.5 — Ghost-tier feature registration (LIN-608 follow-up) ─────
    // 6 tools closing known-feature gaps from LIN-535/536/566/567/568/582.

    case 'memory_store': {
      try {
        const { storeMemory } = await import('./working-memory.js')
        const agentId = String(args.agent_id ?? '')
        const key = String(args.key ?? '')
        if (!agentId || !key) return 'Error: agent_id and key required'
        const ttl = typeof args.ttl === 'number' ? args.ttl : undefined
        const entry = await storeMemory(agentId, key, args.value, ttl)
        return JSON.stringify({ agent_id: entry.agent_id, key: entry.key, stored_at: entry.stored_at, ttl: entry.ttl })
      } catch (err) {
        return `Memory store failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'memory_retrieve': {
      try {
        const { retrieveMemory, listMemories } = await import('./working-memory.js')
        const agentId = String(args.agent_id ?? '')
        if (!agentId) return 'Error: agent_id required'
        if (args.key) {
          const entry = await retrieveMemory(agentId, String(args.key))
          return entry ? JSON.stringify(entry) : `No memory found for ${agentId}/${args.key}`
        }
        const entries = await listMemories(agentId)
        return `${entries.length} memories for ${agentId}:\n${entries.map(e => `- ${e.key}`).join('\n')}`
      } catch (err) {
        return `Memory retrieve failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'failure_harvest': {
      try {
        const { harvestFailures, buildFailureSummary } = await import('./failure-harvester.js')
        const windowHours = typeof args.window_hours === 'number' ? args.window_hours : 24
        const events = await harvestFailures(windowHours)
        const summary = buildFailureSummary(events, windowHours)
        return JSON.stringify({
          window_hours: windowHours,
          total_events: events.length,
          by_category: summary.by_category,
          top_patterns: summary.top_patterns?.slice(0, 5) ?? [],
        }, null, 2)
      } catch (err) {
        return `Failure harvest failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'context_fold': {
      try {
        const text = String(args.text ?? '')
        if (text.length < 50) return 'Error: text must be at least 50 chars to warrant folding'
        const query = typeof args.query === 'string' ? args.query : 'summarize the following context'
        const budget = typeof args.budget === 'number' ? args.budget : 4000
        const domain = typeof args.domain === 'string' ? args.domain : 'general'
        const result = await callMcpTool({
          toolName: 'context_folding.fold',
          args: {
            task: query,
            context: { text },
            max_tokens: budget,
            domain,
          },
          callId: uuid(),
          timeoutMs: 25000,
        })
        if (result.status !== 'success') return `Folding failed: ${result.error_message}`
        // Backend returns: { folded_context, summary, original_tokens, folded_tokens, compression_ratio, strategy }
        const data = result.result as Record<string, unknown> | null
        if (!data || data.success === false) return `Folding failed: ${JSON.stringify(data).slice(0, 200)}`
        const summary = typeof data.summary === 'string' ? data.summary : JSON.stringify(data.folded_context ?? data)
        const ratio = data.compression_ratio ?? 'unknown'
        const strategy = data.strategy ?? 'auto'
        const originalTokens = data.original_tokens ?? 0
        const foldedTokens = data.folded_tokens ?? 0
        return `Folded (${strategy}, ${originalTokens}→${foldedTokens} tokens, ratio: ${ratio}):\n\n${summary}`
      } catch (err) {
        return `Context fold failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'competitive_crawl': {
      try {
        const { runCompetitiveCrawl } = await import('./competitive-crawler.js')
        const report = await runCompetitiveCrawl()
        return JSON.stringify({
          competitors: report.competitors_crawled ?? 0,
          capabilities: report.capabilities_extracted ?? 0,
          gaps: report.gaps_identified ?? 0,
          generated_at: report.generated_at,
        }, null, 2)
      } catch (err) {
        return `Competitive crawl failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'loose_ends_scan': {
      try {
        const { runLooseEndScan } = await import('./routes/loose-ends.js')
        const result = await runLooseEndScan()
        return JSON.stringify({
          total_findings: result.total_findings ?? 0,
          by_category: result.by_category ?? {},
          scanned_at: result.scanned_at,
        }, null, 2)
      } catch (err) {
        return `Loose ends scan failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // ─── v4.0.6 — Ghost-tier sweep round 2 (LIN-618) ───────────────────────

    case 'llm_chat': {
      try {
        const { chatLLM } = await import('./llm-proxy.js')
        const provider = String(args.provider ?? 'deepseek')
        const messages = Array.isArray(args.messages) ? (args.messages as Array<{ role: string; content: string }>) : []
        if (messages.length === 0) return 'Error: messages array required'
        const result = await chatLLM({
          provider,
          messages: messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: String(m.content) })),
          model: typeof args.model === 'string' ? args.model : undefined,
          temperature: typeof args.temperature === 'number' ? args.temperature : undefined,
          max_tokens: typeof args.max_tokens === 'number' ? args.max_tokens : undefined,
        })
        return JSON.stringify({ provider: result.provider, model: result.model, content: result.content?.slice(0, 2000) ?? '', usage: result.usage })
      } catch (err) {
        return `LLM chat failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'llm_providers': {
      try {
        const { listProviders } = await import('./llm-proxy.js')
        const providers = listProviders()
        return JSON.stringify(providers, null, 2)
      } catch (err) {
        return `List providers failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'decision_certify': {
      try {
        const { storeDecision, buildLineageChain } = await import('./routes/decisions.js')
        const assemblyId = String(args.assembly_id ?? '')
        const title = String(args.title ?? '')
        if (!assemblyId || !title) return 'Error: assembly_id and title required'
        const lineage = await buildLineageChain(assemblyId)
        const now = new Date().toISOString()
        const decision = {
          $id: `widgetdc:decision:${uuid()}`,
          $schema: 'https://widgetdc.io/schemas/decision/v1',
          title,
          description: typeof args.description === 'string' ? args.description : '',
          assembly_id: assemblyId,
          lineage_chain: lineage,
          decided_by: String(args.decided_by ?? 'tool-executor'),
          created_at: now,
          updated_at: now,
          status: 'certified' as const,
        }
        const stored = await storeDecision(decision as any)
        return JSON.stringify({ decision_id: decision.$id, title, lineage_depth: lineage.length, stored })
      } catch (err) {
        return `Decision certify failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'decision_list': {
      try {
        const { listAllDecisionIds, loadDecision } = await import('./routes/decisions.js')
        const limit = typeof args.limit === 'number' ? args.limit : 50
        const ids = await listAllDecisionIds()
        const sliced = ids.slice(0, Math.min(limit, 100))
        const decisions = (await Promise.all(sliced.map(id => loadDecision(id)))).filter(d => d !== null)
        if (decisions.length === 0) return 'No certified decisions found'
        const lines = decisions.map((d: any, i) =>
          `${i + 1}. ${d.title} (${d.$id}) — decided_by: ${d.decided_by}, at: ${d.created_at}`,
        )
        return `${decisions.length} decisions:\n${lines.join('\n')}`
      } catch (err) {
        return `Decision list failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'decision_lineage': {
      try {
        const { buildLineageChain } = await import('./routes/decisions.js')
        const assemblyId = String(args.assembly_id ?? '')
        if (!assemblyId) return 'Error: assembly_id required'
        const lineage = await buildLineageChain(assemblyId)
        if (lineage.length === 0) return `No lineage found for ${assemblyId}`
        const lines = lineage.map((e, i) => `${i + 1}. [${e.stage}] ${e.node_type} — ${e.name} (${e.node_id})`)
        return `Lineage chain (${lineage.length} entries):\n${lines.join('\n')}`
      } catch (err) {
        return `Decision lineage failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'artifact_list': {
      try {
        const { listAllArtifactIds, loadArtifact } = await import('./routes/artifacts.js')
        const limit = typeof args.limit === 'number' ? args.limit : 20
        const ids = await listAllArtifactIds()
        const sliced = ids.slice(0, Math.min(limit, 100))
        const artifacts = (await Promise.all(sliced.map(id => loadArtifact(id)))).filter(a => a !== null)
        if (artifacts.length === 0) return 'No artifacts found'
        const lines = artifacts.map((a: any, i) =>
          `${i + 1}. ${a.title} (${a.$id}) — status: ${a.status}, blocks: ${a.blocks?.length ?? 0}, source: ${a.source}`,
        )
        return `${artifacts.length} artifacts:\n${lines.join('\n')}`
      } catch (err) {
        return `Artifact list failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'artifact_get': {
      try {
        const { loadArtifact } = await import('./routes/artifacts.js')
        const artifactId = String(args.artifact_id ?? '')
        if (!artifactId) return 'Error: artifact_id required'
        const artifact = await loadArtifact(artifactId)
        if (!artifact) return `Artifact ${artifactId} not found`
        return JSON.stringify(artifact, null, 2)
      } catch (err) {
        return `Artifact get failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    // ─── v4.0.7 — Ghost-tier sweep round 3 (LIN-619) ───────────────────────

    case 'drill_start': {
      try {
        const { saveDrillContext, fetchDrillChildren } = await import('./routes/drill.js')
        const domain = String(args.domain ?? '')
        if (!domain) return 'Error: domain required'
        const sessionId = uuid()
        const ctx = {
          stack: [],
          current_level: 'domain',
          current_id: domain,
          current_label: domain,
          domain,
        }
        const saved = await saveDrillContext(sessionId, ctx)
        if (!saved) return 'Error: Redis unavailable for drill session'
        const children = await fetchDrillChildren('domain', domain)
        return JSON.stringify({ session_id: sessionId, current_level: 'domain', current_label: domain, children_count: children.length, children: children.slice(0, 10) })
      } catch (err) {
        return `Drill start failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'drill_down': {
      try {
        const { loadDrillContext, saveDrillContext, fetchDrillChildren } = await import('./routes/drill.js')
        const sessionId = String(args.session_id ?? '')
        const targetId = String(args.target_id ?? '')
        const targetLevel = String(args.target_level ?? '')
        if (!sessionId || !targetId || !targetLevel) return 'Error: session_id, target_id, target_level required'
        const ctx = await loadDrillContext(sessionId)
        if (!ctx) return `Drill session ${sessionId} not found or expired`
        ctx.stack.push({ level: ctx.current_level, id: ctx.current_id, label: ctx.current_label })
        ctx.current_level = targetLevel
        ctx.current_id = targetId
        ctx.current_label = targetId
        await saveDrillContext(sessionId, ctx)
        const children = await fetchDrillChildren(targetLevel, targetId)
        return JSON.stringify({ session_id: sessionId, current_level: targetLevel, current_label: targetId, depth: ctx.stack.length, children_count: children.length })
      } catch (err) {
        return `Drill down failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'drill_up': {
      try {
        const { loadDrillContext, saveDrillContext, fetchDrillChildren } = await import('./routes/drill.js')
        const sessionId = String(args.session_id ?? '')
        if (!sessionId) return 'Error: session_id required'
        const ctx = await loadDrillContext(sessionId)
        if (!ctx) return `Drill session ${sessionId} not found or expired`
        if (ctx.stack.length === 0) return 'Already at top level (domain)'
        const parent = ctx.stack.pop()!
        ctx.current_level = parent.level
        ctx.current_id = parent.id
        ctx.current_label = parent.label
        await saveDrillContext(sessionId, ctx)
        const children = await fetchDrillChildren(ctx.current_level, ctx.current_label)
        return JSON.stringify({ session_id: sessionId, current_level: ctx.current_level, current_label: ctx.current_label, depth: ctx.stack.length, children_count: children.length })
      } catch (err) {
        return `Drill up failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'drill_children': {
      try {
        const { loadDrillContext, fetchDrillChildren } = await import('./routes/drill.js')
        const sessionId = String(args.session_id ?? '')
        if (!sessionId) return 'Error: session_id required'
        const ctx = await loadDrillContext(sessionId)
        if (!ctx) return `Drill session ${sessionId} not found or expired`
        const children = await fetchDrillChildren(ctx.current_level, ctx.current_label)
        return JSON.stringify({ session_id: sessionId, current_level: ctx.current_level, current_label: ctx.current_label, children_count: children.length, children: children.slice(0, 20) })
      } catch (err) {
        return `Drill children failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    case 'research_harvest': {
      try {
        const { executeChain } = await import('./chain-engine.js')
        const url = String(args.url ?? '')
        if (!url) return 'Error: url required'
        const topic = typeof args.topic === 'string' ? args.topic : 'General Intelligence'
        const sourceType = typeof args.source_type === 'string' ? args.source_type : 'MEDIA'
        const weights = (args.weights && typeof args.weights === 'object') ? args.weights : {}
        const execution = await executeChain({
          name: `S1-S4: ${topic}`,
          mode: 'sequential',
          steps: [
            { agent_id: 'harvester', tool_name: 'osint.scrape', arguments: { url, max_lines: 50 } },
            { agent_id: 'orchestrator', cognitive_action: 'analyze', prompt: `Transform this raw data into a valid IntelligenceObservation (snake_case). Topic=${topic}, Weights=${JSON.stringify(weights)}. Data: {{prev}}` },
            { agent_id: 'orchestrator', tool_name: 'graph.write_cypher', arguments: { query: 'MERGE (o:IntelligenceObservation {id: apoc.create.uuid()}) SET o.url = $url, o.source_type = $source_type, o.timestamp = datetime() RETURN o.id', parameters: { url, source_type: sourceType } } },
            { agent_id: 'sentinel', tool_name: 'audit.run', arguments: { target_id: '{{prev}}' } },
          ],
        } as any)
        return JSON.stringify({ execution_id: (execution as any).execution_id ?? 'unknown', topic, url })
      } catch (err) {
        return `S1-S4 trigger failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    default: {
      // Check forged tools before giving up
      try {
        const { hasForgedTool, executeForgedTool } = await import('./skill-forge.js')
        if (hasForgedTool(name)) {
          return await executeForgedTool(name, args)
        }
      } catch { /* not a forged tool */ }
      return `Unknown tool: ${name}`
    }
  }
}
