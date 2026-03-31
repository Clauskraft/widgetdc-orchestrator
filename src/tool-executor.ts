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
import { logger } from './logger.js'
import { v4 as uuid } from 'uuid'

// ─── OpenAI-format tool definitions ─────────────────────────────────────────

export const ORCHESTRATOR_TOOLS = [
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
]

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

  return results.map((r, i) => ({
    tool_call_id: toolCalls[i].id,
    role: 'tool' as const,
    content: r.status === 'fulfilled' ? r.value : `Error: ${(r as PromiseRejectedResult).reason}`,
  }))
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

  switch (name) {
    case 'search_knowledge': {
      const result = await dualChannelRAG(args.query as string, {
        maxResults: (args.max_results as number) ?? 10,
      })
      return result.merged_context.length > 0
        ? `Found ${result.srag_count} semantic + ${result.cypher_count} graph results (${result.duration_ms}ms):\n\n${result.merged_context}`
        : 'No results found for this query.'
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
      const result = await callMcpTool({
        toolName: 'graph.read_cypher',
        args: { query: args.cypher as string, params: args.params ?? {} },
        callId: uuid(),
        timeoutMs: 15000,
      })
      if (result.status !== 'success') return `Graph query failed: ${result.error_message}`
      const rows = Array.isArray(result.result) ? result.result
        : (result.result as any)?.results ?? result.result
      return JSON.stringify(rows, null, 2).slice(0, 3000)
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
      return JSON.stringify(result.result, null, 2).slice(0, 3000)
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
      return JSON.stringify(result.result, null, 2).slice(0, 3000)
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
      return JSON.stringify(result.result, null, 2).slice(0, 4000)
    }

    default:
      return `Unknown tool: ${name}`
  }
}
