/**
 * tool-registry.ts — Canonical Tool Registry (Triple-Protocol ABI)
 *
 * LIN-562 + LIN-571: Single source of truth for ALL tool definitions.
 * Uses Zod schemas for type-safe input definitions + defineTool() builder.
 *
 * To add a new tool:
 *   defineTool({ name, namespace, description, input: z.object({...}) })
 *
 * 4 required fields. Everything else is inferred or defaulted.
 * All 3 protocols (OpenAI, OpenAPI, MCP) compile automatically.
 */
import { z } from 'zod'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToolCategory =
  | 'knowledge' | 'graph' | 'cognitive' | 'chains' | 'agents'
  | 'assembly' | 'decisions' | 'adoption' | 'linear' | 'compliance'
  | 'llm' | 'monitor' | 'mcp'

export interface CanonicalTool {
  name: string
  namespace: string
  version: string
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
  deprecated?: { since: string; replacement?: string }
}

// ─── defineTool() builder — "easy as hell" ─────────────────────────────────

type ZodShape = Record<string, z.ZodTypeAny>

interface DefineToolOpts {
  name: string
  namespace: string
  description: string
  input: z.ZodObject<ZodShape>
  version?: string
  backendTool?: string
  timeoutMs?: number
  authRequired?: boolean
  availableVia?: Array<'openai' | 'openapi' | 'mcp'>
  outputDescription?: string
  deprecated?: { since: string; replacement?: string }
}

function inferCategory(namespace: string): ToolCategory {
  const map: Record<string, ToolCategory> = {
    knowledge: 'knowledge', graph: 'graph', cognitive: 'cognitive',
    chains: 'chains', agents: 'agents', assembly: 'assembly',
    decisions: 'decisions', adoption: 'adoption', linear: 'linear',
    compliance: 'compliance', llm: 'llm', monitor: 'monitor', mcp: 'mcp',
  }
  return map[namespace] ?? 'mcp'
}

function inferTags(name: string): string[] {
  return name.split('_').filter(t => t.length > 2)
}

/** Convert Zod schema to JSON Schema (lightweight, Zod v4 compatible) */
function zodToJsonSchemaSimple(schema: z.ZodObject<ZodShape>): Record<string, unknown> {
  const shape = schema.shape
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, field] of Object.entries(shape)) {
    const def = (field as any).def ?? (field as any)._def ?? field
    const isOptional = def.type === 'optional' || def.typeName === 'ZodOptional'
    const inner = isOptional ? (def.innerType ?? def.schema ?? def) : def

    const prop: Record<string, unknown> = {}
    const innerType = inner.type ?? inner.typeName ?? 'string'

    if (innerType === 'string' || innerType === 'ZodString') prop.type = 'string'
    else if (innerType === 'number' || innerType === 'ZodNumber') prop.type = 'number'
    else if (innerType === 'boolean' || innerType === 'ZodBoolean') prop.type = 'boolean'
    else if (innerType === 'array' || innerType === 'ZodArray') {
      prop.type = 'array'
      const itemType = inner.element ?? inner.items ?? inner.def?.element
      if (itemType) {
        prop.items = zodToJsonSchemaSimple(itemType)
      } else {
        prop.items = { type: 'object' }
      }
    } else if (innerType === 'object' || innerType === 'ZodObject') {
      Object.assign(prop, zodToJsonSchemaSimple(inner as any))
    } else if (innerType === 'enum' || innerType === 'ZodEnum') {
      prop.type = 'string'
      prop.enum = inner.values ?? inner.def?.values ?? inner.options
    } else if (innerType === 'record' || innerType === 'ZodRecord') {
      prop.type = 'object'
    } else {
      prop.type = 'string' // safe fallback
    }

    // Extract description from Zod metadata
    const desc = (field as any).description ?? def.description ?? inner.description
    if (desc) prop.description = desc

    properties[key] = prop
    if (!isOptional) required.push(key)
  }

  const result: Record<string, unknown> = { type: 'object', properties }
  if (required.length > 0) result.required = required
  return result
}

export function defineTool(opts: DefineToolOpts): CanonicalTool {
  const inputSchema = zodToJsonSchemaSimple(opts.input)

  return {
    name: opts.name,
    namespace: opts.namespace,
    version: opts.version ?? '1.0',
    description: opts.description,
    category: inferCategory(opts.namespace),
    inputSchema,
    outputDescription: opts.outputDescription,
    handler: opts.backendTool ? 'mcp-proxy' : 'orchestrator',
    backendTool: opts.backendTool,
    timeoutMs: opts.timeoutMs ?? 30000,
    authRequired: opts.authRequired ?? true,
    availableVia: opts.availableVia ?? ['openai', 'openapi', 'mcp'],
    tags: inferTags(opts.name),
    deprecated: opts.deprecated,
  }
}

// ─── Tool Definitions (4 required fields each) ─────────────────────────────

export const TOOL_REGISTRY: CanonicalTool[] = [
  defineTool({
    name: 'search_knowledge',
    namespace: 'knowledge',
    description: 'Search the WidgeTDC knowledge graph and semantic vector store. Use for ANY question about platform data, consulting knowledge, patterns, documents, or entities. Returns merged results from SRAG (semantic) and Neo4j (graph).',
    input: z.object({
      query: z.string().describe('Natural language search query'),
      max_results: z.number().optional().describe('Max results (default 10)'),
    }),
    backendTool: 'srag.query + graph.read_cypher',
    timeoutMs: 20000,
  }),

  defineTool({
    name: 'reason_deeply',
    namespace: 'cognitive',
    description: 'Send a complex question to the RLM reasoning engine for deep multi-step analysis. Use for strategy questions, architecture analysis, comparisons, evaluations, and planning.',
    input: z.object({
      question: z.string().describe('The complex question to reason about'),
      mode: z.enum(['reason', 'analyze', 'plan']).optional().describe('Reasoning mode (default: reason)'),
    }),
    backendTool: 'rlm.reason',
    timeoutMs: 45000,
  }),

  defineTool({
    name: 'query_graph',
    namespace: 'graph',
    description: 'Execute a Cypher query against the Neo4j knowledge graph (475K+ nodes, 3.8M+ relationships). Use for structured data queries like counting nodes, finding relationships, listing entities.',
    input: z.object({
      cypher: z.string().describe('Neo4j Cypher query (read-only, parameterized)'),
      params: z.record(z.unknown()).optional().describe('Query parameters'),
    }),
    backendTool: 'graph.read_cypher',
    timeoutMs: 15000,
  }),

  defineTool({
    name: 'check_tasks',
    namespace: 'linear',
    description: 'Get active tasks, issues, and project status from the knowledge graph. Use when asked about project status, next steps, blockers, sprints, or Linear issues.',
    input: z.object({
      filter: z.enum(['active', 'blocked', 'recent', 'all']).optional().describe('Task filter (default: active)'),
      keyword: z.string().optional().describe('Optional keyword to filter tasks'),
    }),
    backendTool: 'graph.read_cypher',
    timeoutMs: 10000,
  }),

  defineTool({
    name: 'call_mcp_tool',
    namespace: 'mcp',
    description: 'Call any of the 449+ MCP tools on the WidgeTDC backend. Use for specific platform operations like embedding, compliance checks, memory operations, agent coordination.',
    input: z.object({
      tool_name: z.string().describe('MCP tool name (e.g., srag.query, graph.health, audit.dashboard)'),
      payload: z.record(z.unknown()).optional().describe('Tool payload arguments'),
    }),
    backendTool: '(dynamic)',
  }),

  defineTool({
    name: 'get_platform_health',
    namespace: 'monitor',
    description: 'Get current health status of all WidgeTDC platform services (backend, RLM engine, Neo4j graph, Redis). Use when asked about system status, uptime, or health.',
    input: z.object({}),
    backendTool: 'graph.health + graph.stats',
    timeoutMs: 10000,
  }),

  defineTool({
    name: 'search_documents',
    namespace: 'knowledge',
    description: 'Search for specific documents, files, reports, or artifacts in the platform. Returns document metadata and content snippets.',
    input: z.object({
      query: z.string().describe('Document search query'),
      doc_type: z.string().optional().describe('Optional filter: TDCDocument, ConsultingArtifact, Pattern, etc.'),
    }),
    backendTool: 'srag.query',
    timeoutMs: 20000,
  }),

  defineTool({
    name: 'linear_issues',
    namespace: 'linear',
    description: 'Get issues from Linear project management. Use for project status, active tasks, sprint progress, blockers, or specific issue details (LIN-xxx).',
    input: z.object({
      query: z.string().optional().describe('Search query or issue identifier (e.g., "LIN-493")'),
      status: z.enum(['active', 'done', 'backlog', 'all']).optional().describe('Filter by status (default: active)'),
      limit: z.number().optional().describe('Max results (default 10)'),
    }),
    backendTool: 'linear.issues',
    timeoutMs: 15000,
  }),

  defineTool({
    name: 'linear_issue_detail',
    namespace: 'linear',
    description: 'Get detailed info about a specific Linear issue by identifier (e.g., LIN-493). Returns full description, comments, status, assignee, sub-issues.',
    input: z.object({
      identifier: z.string().describe('Issue identifier (e.g., LIN-493)'),
    }),
    backendTool: 'linear.issue_get',
    timeoutMs: 15000,
  }),

  defineTool({
    name: 'run_chain',
    namespace: 'chains',
    description: 'Execute a multi-step agent chain. Supports sequential, parallel, debate, and loop modes. Use for complex workflows needing coordinated tool calls.',
    input: z.object({
      name: z.string().describe('Chain name/description'),
      mode: z.enum(['sequential', 'parallel', 'debate', 'loop']).describe('Execution mode'),
      steps: z.array(z.object({
        agent_id: z.string().describe('Agent identifier'),
        tool_name: z.string().optional().describe('MCP tool to call'),
        cognitive_action: z.string().optional().describe('RLM action: reason, analyze, plan'),
        prompt: z.string().optional().describe('Prompt or arguments'),
      })).describe('Chain steps'),
    }),
    timeoutMs: 60000,
  }),

  defineTool({
    name: 'investigate',
    namespace: 'cognitive',
    description: 'Run a multi-agent deep investigation on a topic. Returns a comprehensive analysis artifact with graph data, compliance, strategy, and reasoning.',
    input: z.object({
      topic: z.string().describe('The topic to investigate deeply'),
    }),
    timeoutMs: 120000,
  }),

  defineTool({
    name: 'create_notebook',
    namespace: 'knowledge',
    description: 'Create an interactive consulting notebook with query, insight, data, and action cells. Executes all cells and returns a full notebook with results.',
    input: z.object({
      topic: z.string().describe('The topic to build a notebook around'),
      cells: z.array(z.object({
        type: z.enum(['query', 'insight', 'data', 'action']),
        id: z.string().optional(),
        query: z.string().optional(),
        prompt: z.string().optional(),
        source_cell_id: z.string().optional(),
        visualization: z.enum(['table', 'chart']).optional(),
        recommendation: z.string().optional(),
      })).optional().describe('Custom cells. If omitted, auto-generates from topic.'),
    }),
    timeoutMs: 60000,
  }),

  defineTool({
    name: 'verify_output',
    namespace: 'compliance',
    description: 'Run verification checks on content or data. Checks quality, accuracy, and compliance. Use after other tools to validate results.',
    input: z.object({
      content: z.string().describe('Content to verify'),
      checks: z.array(z.object({
        name: z.string().describe('Check name'),
        tool_name: z.string().describe('MCP tool for verification'),
      })).optional().describe('Verification checks to run'),
    }),
  }),

  defineTool({
    name: 'generate_deliverable',
    namespace: 'assembly',
    description: 'Generate a consulting deliverable (report, roadmap, or assessment) from a natural language prompt. Uses knowledge graph + RAG to produce a structured, citation-backed document. Returns markdown with optional PDF.',
    input: z.object({
      prompt: z.string().describe('What the deliverable should cover (min 10 chars)'),
      type: z.enum(['analysis', 'roadmap', 'assessment']).describe('Deliverable type'),
      format: z.enum(['pdf', 'markdown']).optional().describe('Output format (default: markdown)'),
      max_sections: z.number().optional().describe('Max sections (2-8, default 5)'),
    }),
    timeoutMs: 120000,
    outputDescription: 'Deliverable with sections, citations, confidence scores, and markdown content',
  }),

  defineTool({
    name: 'precedent_search',
    namespace: 'knowledge',
    description: 'Find similar clients, engagements, or use cases based on shared characteristics. Uses hybrid matching: structural (shared graph relationships) + semantic (embedding similarity). Returns ranked matches with explanation of what dimensions matched.',
    input: z.object({
      query: z.string().describe('Client name, engagement description, or use case to find matches for'),
      dimensions: z.array(z.enum(['industry', 'service', 'challenge', 'domain', 'size', 'geography', 'deliverable'])).optional().describe('Match dimensions (default: industry, service, challenge, domain)'),
      max_results: z.number().optional().describe('Max results (1-20, default 5)'),
      structural_weight: z.number().optional().describe('Weight for structural vs semantic matching (0-1, default 0.6)'),
    }),
    timeoutMs: 30000,
    outputDescription: 'Ranked list of similar clients with scores, shared dimensions, and match method',
  }),
]

// ─── Protocol Compilers ─────────────────────────────────────────────────────

/** Compile registry → OpenAI function calling format */
export function toOpenAITools() {
  return TOOL_REGISTRY
    .filter(t => t.availableVia.includes('openai') && !t.deprecated)
    .map(t => ({
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
    .filter(t => t.availableVia.includes('mcp') && !t.deprecated)
    .map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
}

/** Compile registry → OpenAPI 3.0 path entries */
export function toOpenAPIPaths(): Record<string, object> {
  const paths: Record<string, object> = {}

  for (const tool of TOOL_REGISTRY.filter(t => t.availableVia.includes('openapi') && !t.deprecated)) {
    const operationId = tool.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
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

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getTool(name: string): CanonicalTool | undefined {
  return TOOL_REGISTRY.find(t => t.name === name)
}

export function getToolsByCategory(category: ToolCategory): CanonicalTool[] {
  return TOOL_REGISTRY.filter(t => t.category === category)
}

export function getCategories(): Array<{ category: ToolCategory; count: number }> {
  const counts = new Map<ToolCategory, number>()
  for (const t of TOOL_REGISTRY) {
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}
