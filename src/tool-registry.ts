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
  deprecated?: boolean
  deprecatedSince?: string
  deprecatedMessage?: string
  sunsetDate?: string
  replacedBy?: string
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
  deprecated?: boolean
  deprecatedSince?: string
  deprecatedMessage?: string
  sunsetDate?: string
  replacedBy?: string
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
        const itemDef = (itemType as any).def ?? (itemType as any)._def ?? itemType
        const itemKind = itemDef.type ?? itemDef.typeName ?? 'string'
        if (itemKind === 'string' || itemKind === 'ZodString') prop.items = { type: 'string' }
        else if (itemKind === 'number' || itemKind === 'ZodNumber') prop.items = { type: 'number' }
        else if (itemKind === 'boolean' || itemKind === 'ZodBoolean') prop.items = { type: 'boolean' }
        else if (itemKind === 'enum' || itemKind === 'ZodEnum') prop.items = { type: 'string', enum: itemDef.values ?? itemDef.def?.values }
        else if ((itemType as any).shape) prop.items = zodToJsonSchemaSimple(itemType)
        else prop.items = { type: 'object' }
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
    deprecated: opts.deprecated ?? false,
    deprecatedSince: opts.deprecatedSince,
    deprecatedMessage: opts.deprecatedMessage,
    sunsetDate: opts.sunsetDate,
    replacedBy: opts.replacedBy,
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
  defineTool({
    name: 'governance_matrix',
    namespace: 'compliance',
    description: 'Get the WidgeTDC Manifesto enforcement matrix — maps all 10 principles to their runtime enforcement mechanisms. Shows status (ENFORCED/PARTIAL/GAP), enforcement layer, and gap remediation.',
    input: z.object({
      filter: z.enum(['all', 'enforced', 'gaps']).optional().describe('Filter by status (default: all)'),
    }),
    timeoutMs: 5000,
    outputDescription: '10-principle enforcement matrix with status, mechanism, and gap remediation',
  }),
  defineTool({
    name: 'run_osint_scan',
    namespace: 'knowledge',
    description: 'Run OSINT scanning pipeline on Danish public sector domains. Scans CT logs + DMARC/SPF and ingests results to Neo4j.',
    input: z.object({
      domains: z.array(z.string()).optional().describe('Override domain list (default: 50 DK public domains)'),
      scan_type: z.enum(['full', 'ct_only', 'dmarc_only']).optional().describe('Scan type (default: full)'),
    }),
    timeoutMs: 600000,
    outputDescription: 'Scan results with CT entries, DMARC results, and ingestion counts',
  }),
  defineTool({
    name: 'list_tools',
    namespace: 'monitor',
    description: 'List all available orchestrator tools with their schemas, protocols, and categories. Use to discover what tools are available and how to call them.',
    input: z.object({
      namespace: z.string().optional().describe('Filter by namespace'),
      category: z.string().optional().describe('Filter by category'),
    }),
    timeoutMs: 5000,
    outputDescription: 'List of tool definitions with schemas and metadata',
  }),

  defineTool({
    name: 'run_evolution',
    namespace: 'chains',
    description: 'Trigger one cycle of the autonomous evolution loop (OODA: Observe→Orient→Act→Learn). Assesses platform state, identifies improvement opportunities, executes changes, and captures lessons.',
    input: z.object({
      focus_area: z.string().optional().describe('Optional focus area for this cycle'),
      dry_run: z.boolean().optional().describe('If true, plan only without executing'),
    }),
    timeoutMs: 300000,
    outputDescription: 'Evolution cycle results with observations, actions taken, and lessons learned',
  }),

  // ─── v3.0 Adoption Sprint 1: Missing tools ────────────────────────────────

  defineTool({
    name: 'ingest_document',
    namespace: 'knowledge',
    description: 'Ingest a document into the knowledge graph. Parses content, extracts entities via LLM, MERGEs to Neo4j, and indexes for vector search. Supports markdown, text, and PDF (via Docling).',
    input: z.object({
      content: z.string().describe('Document content (markdown, text, or base64 PDF)'),
      filename: z.string().describe('Source filename'),
      domain: z.string().optional().describe('Target domain for classification'),
      extract_entities: z.boolean().optional().describe('Extract and link entities (default: true)'),
    }),
    timeoutMs: 60000,
    outputDescription: 'Ingestion result with entities extracted, nodes merged, and parsing method',
  }),

  defineTool({
    name: 'build_communities',
    namespace: 'graph',
    description: 'Build hierarchical community summaries from the knowledge graph using Leiden community detection. Creates CommunitySummary nodes with LLM-generated summaries and MEMBER_OF relationships. Used for thematic retrieval.',
    input: z.object({}),
    timeoutMs: 120000,
    outputDescription: 'Community build result with count, summaries generated, and method used',
  }),

  defineTool({
    name: 'adaptive_rag_dashboard',
    namespace: 'monitor',
    description: 'Get the Adaptive RAG dashboard showing current routing weights, per-strategy performance stats, compound intelligence metric (accuracy × quality × coverage), and training sample count.',
    input: z.object({}),
    timeoutMs: 10000,
    outputDescription: 'Adaptive RAG weights, strategy stats, and compound metric',
  }),

  defineTool({
    name: 'adaptive_rag_query',
    namespace: 'knowledge',
    description: 'Query the knowledge graph using adaptive RAG routing. Automatically selects the best retrieval strategy (simple/multi_hop/structured) based on Q-learning weights. Returns merged results with channel attribution. This is the CANONICAL RAG endpoint — all other RAG calls should delegate here.',
    input: z.object({
      query: z.string().describe('The query to search for'),
      max_results: z.number().optional().describe('Maximum results to return (default: 10)'),
      force_strategy: z.string().optional().describe('Force a specific strategy: simple, multi_hop, structured (bypasses adaptive routing)'),
    }),
    timeoutMs: 30000,
    outputDescription: 'Merged RAG results with strategy used, channel attribution, and confidence',
  }),

  defineTool({
    name: 'adaptive_rag_retrain',
    namespace: 'intelligence',
    description: 'Trigger retraining of adaptive RAG routing weights. Analyzes recent query outcomes, recalculates per-strategy performance, and updates routing weights. Should run weekly or after significant query volume.',
    input: z.object({}),
    timeoutMs: 60000,
    outputDescription: 'Retraining result with old/new weights, training samples used, and performance delta',
  }),

  defineTool({
    name: 'adaptive_rag_reward',
    namespace: 'intelligence',
    description: 'Send a Q-learning reward signal to update RAG routing. Call this after evaluating RAG result quality to reinforce good strategies and penalize poor ones.',
    input: z.object({
      query: z.string().describe('The original query'),
      strategy: z.string().describe('Strategy used: simple, multi_hop, structured'),
      reward: z.number().describe('Reward signal: -1.0 (terrible) to 1.0 (perfect)'),
      reason: z.string().optional().describe('Why this reward was given'),
    }),
    timeoutMs: 10000,
    outputDescription: 'Confirmation of reward signal with updated weight preview',
  }),

  defineTool({
    name: 'graph_hygiene_run',
    namespace: 'monitor',
    description: 'Run graph health check: 6 metrics (orphan ratio, avg rels, embedding coverage, domain count, stale nodes, pollution). Stores GraphHealthSnapshot and alerts on anomalies.',
    input: z.object({}),
    timeoutMs: 30000,
    outputDescription: 'Health metrics with alerts if thresholds are crossed',
  }),

  // ─── SNOUT Wave 2: Steal Smart ──────────────────────────────────────────────

  defineTool({
    name: 'critique_refine',
    namespace: 'intelligence',
    description: 'Run Constitutional AI-inspired generate→critique→revise pipeline. Generates a response, critiques it against quality principles, then revises. Returns original, critique, and refined version.',
    input: z.object({
      query: z.string().describe('The query or task to process'),
      provider: z.string().optional().describe('LLM provider (default: deepseek)'),
      principles: z.array(z.string()).optional().describe('Custom critique principles (default: 5 standard)'),
      max_rounds: z.number().optional().describe('Max refine rounds (default: 1)'),
    }),
    timeoutMs: 120000,
    outputDescription: 'Original response, critique, revised response, and timing',
  }),

  defineTool({
    name: 'judge_response',
    namespace: 'intelligence',
    description: 'Score an agent response on 5 PRISM dimensions (Precision, Reasoning, Information, Safety, Methodology). Returns 0-10 scores per dimension plus aggregate. Based on openevals prompt templates.',
    input: z.object({
      query: z.string().describe('The original query/task'),
      response: z.string().describe('The agent response to evaluate'),
      context: z.string().optional().describe('Optional reference context or expected answer'),
      provider: z.string().optional().describe('LLM provider for judging (default: deepseek)'),
    }),
    timeoutMs: 60000,
    outputDescription: 'PRISM scores (0-10 each) with aggregate and explanation',
  }),
  // ─── SNOUT Wave 3: Build Unique ──────────────────────────────────────────

  defineTool({
    name: 'moa_query',
    namespace: 'intelligence',
    description: 'Mixture-of-Agents routing: classifies query complexity, selects 2-3 specialist agents by capability match, dispatches in parallel, and merges responses via LLM consensus. Use for complex queries that benefit from multiple perspectives.',
    input: z.object({
      query: z.string().describe('The complex query to route through MoA'),
      agents: z.array(z.string()).optional().describe('Force specific agent IDs (bypass auto-selection)'),
      max_agents: z.number().optional().describe('Max agents to dispatch (default: 3)'),
      provider: z.string().optional().describe('LLM provider for classify + merge (default: deepseek)'),
    }),
    timeoutMs: 120000,
    outputDescription: 'Consensus response with agent attributions, confidence score, and classification',
  }),
]

// ─── Protocol Compilers ─────────────────────────────────────────────────────

/** Compile registry → OpenAI function calling format */
export function toOpenAITools() {
  return TOOL_REGISTRY
    .filter(t => t.availableVia.includes('openai'))
    .map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
        ...(t.deprecated ? { deprecated: true } : {}),
      },
    }))
}

/** Compile registry → MCP tool descriptors */
export function toMCPTools() {
  return TOOL_REGISTRY
    .filter(t => t.availableVia.includes('mcp'))
    .map(t => {
      let description = t.description
      if (t.deprecated) {
        const parts = [`[DEPRECATED since ${t.deprecatedSince ?? 'unknown'}]`]
        if (t.replacedBy) parts.push(`Use "${t.replacedBy}" instead.`)
        if (t.deprecatedMessage) parts.push(t.deprecatedMessage)
        if (t.sunsetDate) parts.push(`Sunset: ${t.sunsetDate}.`)
        description = `${parts.join(' ')} — ${description}`
      }
      return { name: t.name, description, inputSchema: t.inputSchema }
    })
}

/** Compile registry → OpenAPI 3.0 path entries */
export function toOpenAPIPaths(): Record<string, object> {
  const paths: Record<string, object> = {}

  for (const tool of TOOL_REGISTRY.filter(t => t.availableVia.includes('openapi'))) {
    const operationId = tool.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    paths[`/api/tools/${tool.name}`] = {
      post: {
        operationId: `tool_${operationId}`,
        summary: tool.description.slice(0, 80),
        description: tool.description,
        tags: [tool.category.charAt(0).toUpperCase() + tool.category.slice(1)],
        security: tool.authRequired ? [{ BearerAuth: [] }] : [],
        ...(tool.deprecated ? { deprecated: true } : {}),
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
