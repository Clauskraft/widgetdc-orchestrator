/**
 * tool-registry.ts — Canonical Tool Registry (Triple-Protocol ABI)
 *
 * LIN-562: Single source of truth for ALL tool definitions.
 * Each tool is defined once here, then compiled to:
 *   - OpenAI function calling format (for chat/LLM)
 *   - OpenAPI 3.0 paths (for REST/Swagger)
 *   - MCP tool descriptors (for MCP clients)
 *
 * To add a new tool: add ONE entry here. All protocols update automatically.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToolCategory =
  | 'knowledge'
  | 'graph'
  | 'cognitive'
  | 'chains'
  | 'agents'
  | 'assembly'
  | 'decisions'
  | 'adoption'
  | 'linear'
  | 'compliance'
  | 'llm'
  | 'monitor'
  | 'mcp'

export interface CanonicalTool {
  name: string
  namespace: string
  description: string
  category: ToolCategory
  inputSchema: Record<string, unknown>
  outputDescription?: string
  handler: 'orchestrator' | 'mcp-proxy'
  backendTool?: string
  timeoutMs: number
  authRequired: boolean
  availableVia: Array<'openai' | 'openapi' | 'mcp'>
  tags: string[]
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const TOOL_REGISTRY: CanonicalTool[] = [
  {
    name: 'search_knowledge',
    namespace: 'orchestrator',
    description: 'Search the WidgeTDC knowledge graph and semantic vector store. Use for ANY question about platform data, consulting knowledge, patterns, documents, or entities. Returns merged results from SRAG (semantic) and Neo4j (graph).',
    category: 'knowledge',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        max_results: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
    outputDescription: 'Merged SRAG + graph results with counts and duration',
    handler: 'orchestrator',
    backendTool: 'srag.query + graph.read_cypher',
    timeoutMs: 20000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['rag', 'search', 'srag', 'knowledge-graph'],
  },
  {
    name: 'reason_deeply',
    namespace: 'orchestrator',
    description: 'Send a complex question to the RLM reasoning engine for deep multi-step analysis. Use for strategy questions, architecture analysis, comparisons, evaluations, and planning. More powerful than search — actually reasons about the data.',
    category: 'cognitive',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The complex question to reason about' },
        mode: { type: 'string', enum: ['reason', 'analyze', 'plan'], description: 'Reasoning mode (default: reason)' },
      },
      required: ['question'],
    },
    outputDescription: 'RLM reasoning result — text or structured JSON',
    handler: 'orchestrator',
    backendTool: 'rlm.reason',
    timeoutMs: 45000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['reasoning', 'rlm', 'analysis', 'planning'],
  },
  {
    name: 'query_graph',
    namespace: 'orchestrator',
    description: 'Execute a Cypher query against the Neo4j knowledge graph (475K+ nodes, 3.8M+ relationships). Use for structured data queries like counting nodes, finding relationships, listing entities, or checking status.',
    category: 'graph',
    inputSchema: {
      type: 'object',
      properties: {
        cypher: { type: 'string', description: 'Neo4j Cypher query (read-only, parameterized)' },
        params: { type: 'object', description: 'Query parameters (optional)' },
      },
      required: ['cypher'],
    },
    outputDescription: 'Array of graph query result rows (JSON)',
    handler: 'orchestrator',
    backendTool: 'graph.read_cypher',
    timeoutMs: 15000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['neo4j', 'cypher', 'graph', 'query'],
  },
  {
    name: 'check_tasks',
    namespace: 'orchestrator',
    description: 'Get active tasks, issues, and project status from the knowledge graph. Use when asked about project status, next steps, blockers, sprints, or Linear issues.',
    category: 'linear',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['active', 'blocked', 'recent', 'all'], description: 'Task filter (default: active)' },
        keyword: { type: 'string', description: 'Optional keyword to filter tasks' },
      },
    },
    outputDescription: 'Formatted task list with IDs, titles, and status',
    handler: 'orchestrator',
    backendTool: 'graph.read_cypher',
    timeoutMs: 10000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['tasks', 'linear', 'project-management'],
  },
  {
    name: 'call_mcp_tool',
    namespace: 'orchestrator',
    description: 'Call any of the 449+ MCP tools on the WidgeTDC backend. Use for specific platform operations like embedding, compliance checks, memory operations, agent coordination. Check tool name carefully.',
    category: 'mcp',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'MCP tool name (e.g., srag.query, graph.health, audit.dashboard)' },
        payload: { type: 'object', description: 'Tool payload arguments' },
      },
      required: ['tool_name'],
    },
    outputDescription: 'Tool result (shape varies by tool)',
    handler: 'orchestrator',
    backendTool: '(dynamic)',
    timeoutMs: 30000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['mcp', 'dynamic', 'passthrough'],
  },
  {
    name: 'get_platform_health',
    namespace: 'orchestrator',
    description: 'Get current health status of all WidgeTDC platform services (backend, RLM engine, Neo4j graph, Redis). Use when asked about system status, uptime, or health.',
    category: 'monitor',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputDescription: 'Health status for Neo4j, graph stats (node/relationship counts)',
    handler: 'orchestrator',
    backendTool: 'graph.health + graph.stats',
    timeoutMs: 10000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['health', 'monitoring', 'status'],
  },
  {
    name: 'search_documents',
    namespace: 'orchestrator',
    description: 'Search for specific documents, files, reports, or artifacts in the platform. Returns document metadata and content snippets.',
    category: 'knowledge',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Document search query' },
        doc_type: { type: 'string', description: 'Optional filter: TDCDocument, ConsultingArtifact, Pattern, etc.' },
      },
      required: ['query'],
    },
    outputDescription: 'Document results with metadata and snippets',
    handler: 'orchestrator',
    backendTool: 'srag.query',
    timeoutMs: 20000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['documents', 'search', 'srag'],
  },
  {
    name: 'linear_issues',
    namespace: 'orchestrator',
    description: 'Get issues from Linear project management. Use for project status, active tasks, sprint progress, blockers, or specific issue details (LIN-xxx). Returns real-time Linear data.',
    category: 'linear',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query or issue identifier (e.g., "LIN-493" or "cloud chat platform")' },
        status: { type: 'string', enum: ['active', 'done', 'backlog', 'all'], description: 'Filter by status (default: active)' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
    },
    outputDescription: 'Formatted issue list with identifiers, titles, status, assignees',
    handler: 'orchestrator',
    backendTool: 'linear.issues',
    timeoutMs: 15000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['linear', 'issues', 'project-management'],
  },
  {
    name: 'linear_issue_detail',
    namespace: 'orchestrator',
    description: 'Get detailed info about a specific Linear issue by identifier (e.g., LIN-493). Returns full description, comments, status, assignee, sub-issues.',
    category: 'linear',
    inputSchema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Issue identifier (e.g., LIN-493)' },
      },
      required: ['identifier'],
    },
    outputDescription: 'Full issue detail JSON',
    handler: 'orchestrator',
    backendTool: 'linear.issue_get',
    timeoutMs: 15000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['linear', 'issue-detail'],
  },
  {
    name: 'run_chain',
    namespace: 'orchestrator',
    description: 'Execute a multi-step agent chain. Supports sequential (A->B->C), parallel (A+B+C), debate (two agents argue, third judges), and loop modes. Use for complex workflows that need multiple tool calls coordinated together.',
    category: 'chains',
    inputSchema: {
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
    outputDescription: 'Chain execution result with status, steps completed, duration, final output',
    handler: 'orchestrator',
    timeoutMs: 60000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['chains', 'orchestration', 'multi-agent'],
  },
  {
    name: 'investigate',
    namespace: 'orchestrator',
    description: 'Run a multi-agent deep investigation on a topic. Returns a comprehensive analysis artifact with graph data, compliance, strategy, and reasoning.',
    category: 'cognitive',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic to investigate deeply' },
      },
      required: ['topic'],
    },
    outputDescription: 'Investigation result with artifact URL, synthesis, and step details',
    handler: 'orchestrator',
    timeoutMs: 120000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['investigation', 'deep-analysis', 'multi-agent'],
  },
  {
    name: 'create_notebook',
    namespace: 'orchestrator',
    description: 'Create an interactive consulting notebook with query, insight, data, and action cells. Executes all cells and returns a full notebook with results. Great for structured analysis on any topic.',
    category: 'knowledge',
    inputSchema: {
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
    outputDescription: 'Notebook with executed cells, results, and view URLs',
    handler: 'orchestrator',
    timeoutMs: 60000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['notebook', 'consulting', 'analysis'],
  },
  {
    name: 'verify_output',
    namespace: 'orchestrator',
    description: 'Run verification checks on a piece of content or data. Checks quality, accuracy, and compliance. Use after getting results from other tools to validate them before presenting to user.',
    category: 'compliance',
    inputSchema: {
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
    outputDescription: 'Verification result with pass/fail per check',
    handler: 'orchestrator',
    timeoutMs: 30000,
    authRequired: true,
    availableVia: ['openai', 'openapi', 'mcp'],
    tags: ['verification', 'compliance', 'quality'],
  },
]

// ─── Protocol Compilers ─────────────────────────────────────────────────────

/** Compile registry → OpenAI function calling format */
export function toOpenAITools(filter?: { availableVia?: 'openai' }) {
  const tools = filter?.availableVia
    ? TOOL_REGISTRY.filter(t => t.availableVia.includes(filter.availableVia!))
    : TOOL_REGISTRY

  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }))
}

/** Compile registry → MCP tool descriptors */
export function toMCPTools() {
  return TOOL_REGISTRY
    .filter(t => t.availableVia.includes('mcp'))
    .map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
}

/** Compile registry → OpenAPI 3.0 path entries for orchestrator tools */
export function toOpenAPIPaths(): Record<string, object> {
  const paths: Record<string, object> = {}

  for (const tool of TOOL_REGISTRY.filter(t => t.availableVia.includes('openapi'))) {
    const operationId = tool.name.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    paths[`/api/tools/${tool.name}`] = {
      post: {
        operationId: `tool_${operationId}`,
        summary: tool.description.slice(0, 80),
        description: tool.description,
        tags: [tool.category.charAt(0).toUpperCase() + tool.category.slice(1)],
        security: tool.authRequired ? [{ BearerAuth: [] }] : [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: tool.inputSchema } },
        },
        responses: {
          '200': {
            description: tool.outputDescription ?? 'Tool result',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '400': { description: 'Validation error' },
          '401': { description: 'Unauthorized' },
        },
      },
    }
  }

  return paths
}

/** Get a tool by name */
export function getTool(name: string): CanonicalTool | undefined {
  return TOOL_REGISTRY.find(t => t.name === name)
}

/** Get tools by category */
export function getToolsByCategory(category: ToolCategory): CanonicalTool[] {
  return TOOL_REGISTRY.filter(t => t.category === category)
}

/** Get all categories with counts */
export function getCategories(): Array<{ category: ToolCategory; count: number }> {
  const counts = new Map<ToolCategory, number>()
  for (const t of TOOL_REGISTRY) {
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}
