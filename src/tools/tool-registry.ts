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
  | 'llm' | 'monitor' | 'mcp' | 'engagement' | 'memory' | 'inventor'

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
    engagement: 'engagement', memory: 'memory',
    pheromone: 'monitor', peereval: 'monitor',
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
  defineTool({
    name: 'forge_tool',
    namespace: 'intelligence',
    description: 'Forge a new MCP tool at runtime. Generates tool definition + handler via LLM, registers in runtime registry, and optionally verifies. Supports 3 handler types: mcp-proxy (forward to backend tool), llm-generate (LLM answers), cypher-query (Neo4j template).',
    input: z.object({
      name: z.string().describe('Tool name (snake_case, e.g. "analyze_risk")'),
      purpose: z.string().describe('What the tool should do'),
      handler_type: z.string().optional().describe('Handler: mcp-proxy, llm-generate, cypher-query (default: llm-generate)'),
      backend_tool: z.string().optional().describe('For mcp-proxy: backend tool name to forward to'),
      system_prompt: z.string().optional().describe('For llm-generate: system prompt'),
      cypher_template: z.string().optional().describe('For cypher-query: Cypher template with $params'),
      verify: z.boolean().optional().describe('Run verification after creation (default: true)'),
    }),
    timeoutMs: 60000,
    outputDescription: 'Forge result with tool spec, verification status, and handler config',
  }),

  defineTool({
    name: 'forge_analyze_gaps',
    namespace: 'intelligence',
    description: 'Analyze recent tool usage patterns to identify gaps — tools that are missing, frequently failing, or requested but not available. Returns suggested new tools to forge.',
    input: z.object({
      provider: z.string().optional().describe('LLM provider for analysis (default: deepseek)'),
    }),
    timeoutMs: 30000,
    outputDescription: 'Gap analysis with patterns, frequencies, and tool suggestions',
  }),

  defineTool({
    name: 'forge_list',
    namespace: 'intelligence',
    description: 'List all dynamically forged tools with their handler type, verification status, and creation date.',
    input: z.object({}),
    timeoutMs: 5000,
    outputDescription: 'List of forged tools with specs',
  }),

  // ─── v4.0.4 — Engagement Intelligence Engine (LIN-607) ─────────────────────
  // First-class consulting engagement entities with precedent matching, plan
  // generation via /cognitive/analyze, smart gates (sanity + consensus + RLM
  // mission), and outcome-driven Q-learning. All 5 entries surface via REST
  // tool-gateway, Universal MCP gateway, OpenAPI /docs, and adoption telemetry.

  defineTool({
    name: 'engagement_create',
    namespace: 'engagement',
    description: 'Create a first-class Engagement entity. Writes to Neo4j via MERGE (Engagement + USES_METHODOLOGY edges) and indexes in raptor.index for semantic precedent retrieval. Required: client, domain, objective, start_date, target_end_date.',
    input: z.object({
      client: z.string().describe('Client name'),
      domain: z.string().describe('Engagement domain (Finance, Healthcare, Operations, etc.)'),
      objective: z.string().describe('Engagement objective (min 10 chars)'),
      start_date: z.string().describe('ISO date string'),
      target_end_date: z.string().describe('ISO date string'),
      budget_dkk: z.number().optional().describe('Budget in DKK (optional)'),
      team_size: z.number().optional().describe('Team size (optional)'),
      methodology_refs: z.array(z.string()).optional().describe('Methodology framework names'),
    }),
    timeoutMs: 15000,
    outputDescription: 'Created Engagement with $id, status=draft, timestamps',
  }),

  defineTool({
    name: 'engagement_match',
    namespace: 'engagement',
    description: 'Find similar past engagements via Cypher (actual :Engagement nodes ranked by outcome grade + methodology overlap + freshness) with dualChannelRAG fallback. Returns top precedents with outcome grades and staleness flags.',
    input: z.object({
      objective: z.string().describe('Engagement objective to match against'),
      domain: z.string().describe('Domain filter'),
      max_results: z.number().optional().describe('Max precedents returned (default 5)'),
    }),
    timeoutMs: 30000,
    outputDescription: 'Ranked EngagementMatch[] with similarity, outcome grade, reasoning, stale flag',
  }),

  defineTool({
    name: 'engagement_plan',
    namespace: 'engagement',
    description: 'Generate structured consulting plan (phases, risks, skills) via RLM /cognitive/analyze + 4-channel retrieval (graphrag 3-hop + srag + cypher + kg_rag) + context folding. Enforces smart gates: sanity validation, consensus gate for high-stakes (>20M DKK or >20 team or >40w), RLM mission for complex (>40w).',
    input: z.object({
      objective: z.string().describe('Engagement objective'),
      domain: z.string().describe('Consulting domain'),
      duration_weeks: z.number().describe('Plan duration 1-260 weeks (hard cap)'),
      team_size: z.number().describe('Team size 1-100 (hard cap)'),
      budget_dkk: z.number().optional().describe('Budget in DKK, max 500M hard cap'),
      engagement_id: z.string().optional().describe('Attach plan to existing engagement'),
    }),
    timeoutMs: 120000,
    outputDescription: 'EngagementPlan with phases, risks, skills, precedents, citations, confidence, consensus_proposal_id, rlm_mission_id',
  }),

  defineTool({
    name: 'engagement_outcome',
    namespace: 'engagement',
    description: 'Record engagement completion outcome. Writes EngagementOutcome node + HAS_OUTCOME edge to Neo4j, sets engagement status=completed, and sends Q-learning reward to adaptive-rag based on grade + precedent accuracy.',
    input: z.object({
      engagement_id: z.string().describe('Target engagement ID'),
      grade: z.enum(['exceeded', 'met', 'partial', 'missed']).describe('Outcome grade'),
      actual_end_date: z.string().describe('ISO date actual completion'),
      deliverables_shipped: z.array(z.string()).describe('List of shipped deliverables'),
      what_went_well: z.string().describe('Success narrative'),
      what_went_wrong: z.string().describe('Failure narrative'),
      recorded_by: z.string().describe('Recorder agent/user ID'),
      precedent_match_accuracy: z.number().optional().describe('0-1 how well top precedent predicted outcome'),
    }),
    timeoutMs: 15000,
    outputDescription: 'EngagementOutcome with timestamps, Q-learning reward sent',
  }),

  defineTool({
    name: 'engagement_list',
    namespace: 'engagement',
    description: 'List recent engagements from Redis + Neo4j. Supports limit filter. Returns most recent first by createdAt.',
    input: z.object({
      limit: z.number().optional().describe('Max engagements returned (default 20, max 100)'),
    }),
    timeoutMs: 10000,
    outputDescription: 'Engagement[] sorted newest first',
  }),

  // ─── v4.0.5 — Ghost-tier feature registration (LIN-608 follow-up) ──────────
  // Audit found 13 ghost-tier routers. These 6 tools register the highest-value
  // features tied to known Linear issues (LIN-535/536/566/567/568/582) that
  // shipped without TOOL_REGISTRY entries. Closes the Omega lesson loop.

  defineTool({
    name: 'memory_store',
    namespace: 'memory',
    description: 'Store an entry in agent working memory (8-layer memory system, LIN-582 SNOUT-4). Backed by Redis with optional TTL. Retrievable via memory_retrieve.',
    input: z.object({
      agent_id: z.string().describe('Agent identifier'),
      key: z.string().describe('Memory key'),
      value: z.unknown().describe('Memory value (any JSON-serializable)'),
      ttl: z.number().optional().describe('TTL in seconds (default: 3600)'),
    }),
    timeoutMs: 5000,
    outputDescription: 'Stored MemoryEntry with timestamp',
  }),

  defineTool({
    name: 'memory_retrieve',
    namespace: 'memory',
    description: 'Retrieve a specific memory entry or list all entries for an agent (LIN-582). Working memory is the agent cognition layer.',
    input: z.object({
      agent_id: z.string().describe('Agent identifier'),
      key: z.string().optional().describe('Specific key (omit to list all for agent)'),
    }),
    timeoutMs: 5000,
    outputDescription: 'MemoryEntry or MemoryEntry[] if no key provided',
  }),

  defineTool({
    name: 'failure_harvest',
    namespace: 'intelligence',
    description: 'Harvest recent orchestrator failures (timeouts, 502s, auth errors, MCP errors) for Red Queen learning loop (LIN-567). Returns categorized failure summary with counts and patterns.',
    input: z.object({
      window_hours: z.number().optional().describe('Lookback window in hours (default: 24)'),
    }),
    timeoutMs: 30000,
    outputDescription: 'FailureSummary with categorized events and counts',
  }),

  defineTool({
    name: 'context_fold',
    namespace: 'cognitive',
    description: 'Compress large context via RLM /cognitive/fold (LIN-568 CaaS Mercury). Auto-selects strategy (baseline/neural/deepseek). Rate limited 100 req/day per API key.',
    input: z.object({
      text: z.string().describe('Text to compress'),
      query: z.string().optional().describe('Query context for attention-focused folding'),
      budget: z.number().optional().describe('Target token budget (default 4000)'),
      domain: z.string().optional().describe('Domain hint for strategy selection'),
    }),
    timeoutMs: 30000,
    outputDescription: 'Folded text with compression ratio and strategy used',
  }),

  defineTool({
    name: 'competitive_crawl',
    namespace: 'intelligence',
    description: 'Trigger competitive phagocytosis crawl (LIN-566). Fetches competitor docs, extracts capabilities via DeepSeek LLM, MERGEs into Neo4j as :Competitor + :Capability nodes, produces gap report.',
    input: z.object({}),
    timeoutMs: 180000,
    outputDescription: 'GapReport with competitor capabilities and identified gaps',
  }),

  defineTool({
    name: 'loose_ends_scan',
    namespace: 'intelligence',
    description: 'Scan synthesis funnel for loose ends — unresolved dependencies, contradictions, orphaned blocks (LIN-535). Returns scan result with categorized findings.',
    input: z.object({}),
    timeoutMs: 60000,
    outputDescription: 'LooseEndScanResult with counts and findings by category',
  }),

  // ─── v4.0.6 — Ghost-tier sweep round 2 (LIN-618) ──────────────────────────
  // 7 more tools from the audit — decisions (LIN-536), artifacts (G4.2-5),
  // llm proxy, s1-s4 research pipeline. Drill stack deferred to v4.0.7 (stateful).

  defineTool({
    name: 'llm_chat',
    namespace: 'llm',
    description: 'Direct LLM chat proxy supporting 6 providers (deepseek, qwen, openai, groq, gemini, claude). Returns provider/model/content.',
    input: z.object({
      provider: z.string().describe('LLM provider: deepseek|qwen|openai|groq|gemini|claude'),
      messages: z.array(z.object({ role: z.string(), content: z.string() })).describe('Chat messages array'),
      model: z.string().optional().describe('Model override (defaults per provider)'),
      temperature: z.number().optional().describe('0-2 sampling temperature'),
      max_tokens: z.number().optional().describe('Max tokens to generate'),
    }),
    timeoutMs: 60000,
    outputDescription: 'LLMResponse with provider, model, content, usage',
  }),

  defineTool({
    name: 'llm_providers',
    namespace: 'llm',
    description: 'List available LLM providers configured in the orchestrator with their default models.',
    input: z.object({}),
    timeoutMs: 5000,
    outputDescription: 'Array of provider configs {name, defaultModel, baseUrl}',
  }),

  defineTool({
    name: 'decision_certify',
    namespace: 'decisions',
    description: 'Certify an assembly as an architecture decision (LIN-536). Traverses Assembly → Blocks → Patterns → Signals lineage, produces DecisionCertificate with full provenance trail stored in Redis.',
    input: z.object({
      assembly_id: z.string().describe('Source assembly ID'),
      title: z.string().describe('Decision title'),
      description: z.string().optional().describe('Decision description'),
      decided_by: z.string().optional().describe('Decider agent/user ID'),
    }),
    timeoutMs: 30000,
    outputDescription: 'DecisionCertificate with $id, lineage chain, timestamps',
  }),

  defineTool({
    name: 'decision_list',
    namespace: 'decisions',
    description: 'List all certified decisions from the orchestrator Redis store. Returns decision metadata sorted by creation.',
    input: z.object({
      limit: z.number().optional().describe('Max decisions returned (default 50)'),
    }),
    timeoutMs: 10000,
    outputDescription: 'DecisionCertificate[] with id, title, decided_by, created_at',
  }),

  defineTool({
    name: 'decision_lineage',
    namespace: 'decisions',
    description: 'Build full lineage chain for a decision or assembly — traces from Assembly → Blocks → Patterns → Signals via Neo4j graph traversal. Used for audit and provenance (LIN-536).',
    input: z.object({
      assembly_id: z.string().describe('Assembly ID to trace lineage from'),
    }),
    timeoutMs: 20000,
    outputDescription: 'LineageEntry[] with stage (assembly/block/pattern/signal), node_id, node_type, name, timestamp',
  }),

  defineTool({
    name: 'artifact_list',
    namespace: 'assembly',
    description: 'List AnalysisArtifact objects from the broker (G4.2-5). Artifacts are Obsidian-Markdown exportable analysis outputs with blocks (text, table, chart, kpi_card, cypher, mermaid).',
    input: z.object({
      limit: z.number().optional().describe('Max artifacts returned (default 20)'),
    }),
    timeoutMs: 10000,
    outputDescription: 'AnalysisArtifact[] with id, title, status, blocks count',
  }),

  defineTool({
    name: 'artifact_get',
    namespace: 'assembly',
    description: 'Retrieve a specific AnalysisArtifact by ID with all blocks, graph refs, tags, and metadata.',
    input: z.object({
      artifact_id: z.string().describe('Artifact $id'),
    }),
    timeoutMs: 5000,
    outputDescription: 'Full AnalysisArtifact object',
  }),

  // ─── v4.0.7 — Ghost-tier sweep round 3 (LIN-619) ──────────────────────────
  // Final ghost-tier closure: drill stack (G4.15-19 stateful hierarchical
  // navigation, Redis-backed sessions) + s1-s4 research pipeline trigger.

  defineTool({
    name: 'drill_start',
    namespace: 'graph',
    description: 'Start a hierarchical drill-down session (G4.15). Creates Redis session and returns children at the domain level. Navigation path: Domain → Segment → Framework → KPI → Trend → Recommendation.',
    input: z.object({
      domain: z.string().describe('Consulting domain to begin drill from'),
    }),
    timeoutMs: 15000,
    outputDescription: 'DrillContext with session_id, current level, children, breadcrumbs',
  }),

  defineTool({
    name: 'drill_down',
    namespace: 'graph',
    description: 'Drill down into a child level in an active session (G4.16). Pushes current position to stack, moves to target_id at target_level.',
    input: z.object({
      session_id: z.string().describe('Active drill session ID'),
      target_id: z.string().describe('Child node ID to drill into'),
      target_level: z.string().describe('Child level: segment|framework|kpi|trend|recommendation'),
    }),
    timeoutMs: 15000,
    outputDescription: 'Updated DrillContext with children at new level',
  }),

  defineTool({
    name: 'drill_up',
    namespace: 'graph',
    description: 'Navigate up one level in drill session (G4.17). Pops parent from stack, returns children at parent level.',
    input: z.object({
      session_id: z.string().describe('Active drill session ID'),
    }),
    timeoutMs: 15000,
    outputDescription: 'Updated DrillContext at parent level',
  }),

  defineTool({
    name: 'drill_children',
    namespace: 'graph',
    description: 'Fetch children at current drill position without navigating (G4.18). Safe read-only inspection.',
    input: z.object({
      session_id: z.string().describe('Active drill session ID'),
    }),
    timeoutMs: 10000,
    outputDescription: 'DrillChild[] at current position with breadcrumbs',
  }),

  defineTool({
    name: 'research_harvest',
    namespace: 'intelligence',
    description: 'Trigger the S1-S4 research harvesting pipeline — Extract (OSINT) → Map (cognitive analyze) → Sync/Inject (Neo4j) → Verify (audit). Returns execution_id.',
    input: z.object({
      url: z.string().describe('URL or local path to harvest'),
      source_type: z.string().optional().describe('Source type (e.g. MEDIA, BLOG, PAPER)'),
      topic: z.string().optional().describe('Topic context for mapping'),
      weights: z.record(z.unknown()).optional().describe('Optional salience weights'),
    }),
    timeoutMs: 180000,
    outputDescription: 'Execution ID for tracking the 4-step chain',
  }),

  // ─── HyperAgent Autonomous Executor (cross-repo callable) ──────────────

  defineTool({
    name: 'hyperagent_auto_run',
    namespace: 'hyperagent',
    description: 'Trigger an autonomous execution cycle. Prioritizes targets by fitness function, plans via RLM, executes via chain engine, evaluates, discovers issues, and evolves weights. Callable from ANY repo via MCP. Persistent memory ensures continuity across sessions and repos.',
    input: z.object({
      phase: z.enum(['phase_0', 'phase_1', 'phase_2', 'phase_3']).optional().describe('Override phase (default: current)'),
      max_targets: z.number().optional().describe('Max targets per cycle (default: phase-dependent batch size)'),
      caller_repo: z.string().optional().describe('Calling repo identifier for cross-repo memory tracking'),
    }),
    timeoutMs: 300000,
    outputDescription: 'Cycle result: targets attempted/completed/failed, fitness delta, discovered issues',
  }),

  defineTool({
    name: 'hyperagent_auto_status',
    namespace: 'hyperagent',
    description: 'Get current autonomous executor status — phase, fitness score, edge scores, running state, cycle count, last cycle results. Callable from ANY repo via MCP.',
    input: z.object({
      include_history: z.boolean().optional().describe('Include last N cycle results (default: false)'),
      history_limit: z.number().optional().describe('Number of historical cycles to include (default: 5)'),
    }),
    timeoutMs: 10000,
    outputDescription: 'Status object with phase, fitness, edges, running state, and optional history',
  }),

  defineTool({
    name: 'hyperagent_auto_memory',
    namespace: 'hyperagent',
    description: 'Read/write persistent cross-repo memory for the autonomous executor. Stores lessons, discoveries, and execution context in Redis + Neo4j. Memory is keyed by domain and persists across sessions, repos, and restarts.',
    input: z.object({
      action: z.enum(['read', 'write', 'list']).describe('Memory operation'),
      domain: z.string().optional().describe('Memory domain (e.g. "lessons", "discoveries", "fitness", "edges")'),
      key: z.string().optional().describe('Specific memory key (for read/write)'),
      value: z.unknown().optional().describe('Value to store (for write)'),
      caller_repo: z.string().optional().describe('Calling repo for provenance tracking'),
    }),
    timeoutMs: 15000,
    outputDescription: 'Memory entries or confirmation of write',
  }),

  defineTool({
    name: 'hyperagent_auto_issues',
    namespace: 'hyperagent',
    description: 'List all issues discovered during autonomous execution cycles. Issues are accumulated across all cycles and repos. Useful for cross-repo coordination and backlog grooming.',
    input: z.object({
      limit: z.number().optional().describe('Max issues to return (default: 50)'),
      since_cycle: z.string().optional().describe('Only issues discovered after this cycle ID'),
      caller_repo: z.string().optional().describe('Calling repo identifier'),
    }),
    timeoutMs: 10000,
    outputDescription: 'Array of discovered issues with cycle context and timestamps',
  }),

  // ── Pheromone Layer (Stigmergic Communication) ────────────────────────────

  defineTool({
    name: 'pheromone_status',
    namespace: 'pheromone',
    description: 'Get pheromone layer status: active pheromone count, total deposits, decay cycles, amplifications, trail count. Use to check flywheel health.',
    input: z.object({}),
    timeoutMs: 5000,
    outputDescription: 'Pheromone layer state with counts and timestamps',
  }),

  defineTool({
    name: 'pheromone_sense',
    namespace: 'pheromone',
    description: 'Sense pheromones in a domain — returns active signals ranked by strength. Use before task execution to find best trails, or to check which strategies are working in a domain.',
    input: z.object({
      domain: z.string().optional().describe('Domain to sense (e.g., "research", "analysis", "chain:sequential")'),
      type: z.enum(['attraction', 'repellent', 'trail', 'external', 'amplification']).optional().describe('Filter by pheromone type'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      min_strength: z.number().optional().describe('Minimum strength threshold (0-1, default 0.1)'),
      limit: z.number().optional().describe('Max results (default 20)'),
    }),
    timeoutMs: 5000,
    outputDescription: 'Array of pheromones with type, strength, domain, source, tags, and timestamps',
  }),

  defineTool({
    name: 'pheromone_deposit',
    namespace: 'pheromone',
    description: 'Deposit a pheromone signal — attraction (good result), repellent (bad result), trail (successful path), or external (outside intelligence). Use after task completion to share learnings with the fleet.',
    input: z.object({
      type: z.enum(['attraction', 'repellent', 'trail', 'external']).describe('Pheromone type'),
      domain: z.string().describe('Domain (e.g., "research", "analysis", "cost-optimization")'),
      source: z.string().describe('Who deposited (agent ID or system)'),
      strength: z.number().optional().describe('Signal strength 0-1 (default 0.5)'),
      label: z.string().optional().describe('Human-readable label for the signal'),
      tags: z.array(z.string()).optional().describe('Classification tags'),
      metadata: z.record(z.number()).optional().describe('Numeric metrics (e.g., { score: 0.9, latency_ms: 50 })'),
    }),
    timeoutMs: 5000,
    outputDescription: 'Deposited pheromone with assigned ID and TTL',
  }),

  defineTool({
    name: 'pheromone_heatmap',
    namespace: 'pheromone',
    description: 'Get cross-domain pheromone heatmap — shows which domains have the strongest signals and most activity. Use for strategic overview of where the flywheel is spinning fastest.',
    input: z.object({}),
    timeoutMs: 5000,
    outputDescription: 'Domain-by-type heatmap with counts and average strengths',
  }),

  // ── PeerEval Fleet Learning ───────────────────────────────────────────────

  defineTool({
    name: 'peer_eval_status',
    namespace: 'peereval',
    description: 'Get fleet learning status: total evals, task types tracked, best practices shared. Use to check if the fleet is learning effectively.',
    input: z.object({}),
    timeoutMs: 5000,
    outputDescription: 'PeerEval state with eval counts, task type count, and timestamps',
  }),

  defineTool({
    name: 'peer_eval_fleet',
    namespace: 'peereval',
    description: 'Get fleet learning data for a specific task type or all task types. Returns best agent, average efficiency, top strategies from pheromone trails, and EMA-aggregated scores.',
    input: z.object({
      task_type: z.string().optional().describe('Specific task type to query (omit for all)'),
    }),
    timeoutMs: 10000,
    outputDescription: 'Fleet learning records with bestAgent, avgEfficiency, topStrategies, and pheromoneStrength per task type',
  }),

  defineTool({
    name: 'peer_eval_evaluate',
    namespace: 'peereval',
    description: 'Trigger a manual peer evaluation for an agent task. Records self-assessment, deposits pheromones, updates fleet learning, and broadcasts best practices if score + novelty are high.',
    input: z.object({
      agent_id: z.string().describe('Agent that performed the task'),
      task_id: z.string().optional().describe('Task identifier'),
      context: z.string().optional().describe('What the agent did (for self-assessment prompt)'),
    }),
    timeoutMs: 15000,
    outputDescription: 'Evaluation report with selfScore, novelty, pheromone deposited, and whether best practice was broadcast',
  }),

  defineTool({
    name: 'peer_eval_analyze',
    namespace: 'peereval',
    description: 'Run RLM-powered fleet analysis — identifies underperformers, top strategies, and strategic recommendations across all task types. Expensive but high-value. Runs weekly via cron.',
    input: z.object({}),
    timeoutMs: 45000,
    outputDescription: 'Strategic fleet analysis with patterns, underperformers, and recommended changes',
  }),

  // ── Inventor (ASI-Evolve Closed-Loop Evolution Engine) ──────────────────

  defineTool({
    name: 'inventor_run',
    namespace: 'inventor',
    description: 'Start or resume an Inventor evolution experiment. Fire-and-forget — poll inventor_status for progress. Requires experiment name + task description. Supports UCB1, greedy, random, or island (MAP-Elites) sampling.',
    input: z.object({
      experiment_name: z.string().describe('Unique experiment identifier (used for Redis/Neo4j namespacing)'),
      task_description: z.string().describe('Problem description to evolve solutions for'),
      initial_artifact: z.string().optional().describe('Optional seed solution to start from'),
      sampling_algorithm: z.enum(['ucb1', 'greedy', 'random', 'island']).optional().describe('Sampling strategy (default: ucb1)'),
      sample_n: z.number().optional().describe('Number of parent nodes to sample per step (default: 3)'),
      max_steps: z.number().optional().describe('Maximum evolution steps (default: 20)'),
      chain_mode: z.enum(['sequential', 'parallel', 'debate']).optional().describe('Chain execution mode (default: sequential)'),
      resume: z.boolean().optional().describe('Resume a paused experiment (default: false)'),
    }),
    timeoutMs: 30000,
    outputDescription: 'Experiment start confirmation with poll URL',
  }),

  defineTool({
    name: 'inventor_status',
    namespace: 'inventor',
    description: 'Get current Inventor experiment status: running state, current step, total steps, nodes created, best score, best node ID, sampling algorithm, and last error if any.',
    input: z.object({}),
    timeoutMs: 5000,
    outputDescription: 'InventorStatus with isRunning, currentStep, totalSteps, nodesCreated, bestScore, bestNodeId',
  }),

  defineTool({
    name: 'inventor_nodes',
    namespace: 'inventor',
    description: 'List all Inventor trial nodes from current or last experiment. Sortable by score or creation time. Each node has: artifact, score, metrics, analysis, motivation, parent lineage.',
    input: z.object({
      sort: z.enum(['score', 'created']).optional().describe('Sort order (default: score)'),
      limit: z.number().optional().describe('Max nodes to return (default: 50, max: 200)'),
      offset: z.number().optional().describe('Pagination offset (default: 0)'),
    }),
    timeoutMs: 5000,
    outputDescription: 'Paginated array of InventorNodes sorted by score or creation time',
  }),

  defineTool({
    name: 'inventor_node',
    namespace: 'inventor',
    description: 'Get a specific Inventor trial node by ID. Returns full artifact, score, metrics, analysis, motivation, parent ID, island, visit count, and timestamps.',
    input: z.object({
      node_id: z.string().describe('The trial node ID to retrieve'),
    }),
    timeoutMs: 5000,
    outputDescription: 'Complete InventorNode with artifact and all metadata',
  }),

  defineTool({
    name: 'inventor_best',
    namespace: 'inventor',
    description: 'Get the best-scoring Inventor trial node from the current or last experiment. Returns the winning solution with full artifact, score breakdown, and evolution lineage.',
    input: z.object({}),
    timeoutMs: 5000,
    outputDescription: 'Best InventorNode with highest score, full artifact and metadata',
  }),

  defineTool({
    name: 'inventor_stop',
    namespace: 'inventor',
    description: 'Stop the currently running Inventor experiment gracefully. The experiment will halt after the current step completes and persist results to history.',
    input: z.object({}),
    timeoutMs: 5000,
  }),

  defineTool({
    name: 'inventor_history',
    namespace: 'inventor',
    description: 'List past Inventor experiments with their status, scores, and configuration. Returns up to 20 most recent experiments from Redis history.',
    input: z.object({
      limit: z.number().optional().describe('Max experiments to return (default: 20, max: 50)'),
    }),
    timeoutMs: 5000,
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
