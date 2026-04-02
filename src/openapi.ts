/**
 * openapi.ts — OpenAPI 3.0 spec + Swagger UI for Universal AI Tool Gateway.
 *
 * Serves:
 *   GET /openapi.json  — Machine-readable OpenAPI spec (for ChatGPT Actions, Open WebUI, etc.)
 *   GET /docs          — Swagger UI explorer
 */
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import { toOpenAPIPaths, TOOL_REGISTRY } from './tool-registry.js'

// ─── Build OpenAPI spec inline (no JSDoc file scanning needed) ──────────────

function buildOpenAPISpec(): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'WidgeTDC Orchestrator — Universal AI Tool Gateway',
      version: '2.0.1',
      description:
        'Central intelligence platform for WidgeTDC. Provides unified access to 450+ MCP tools, ' +
        'agent orchestration, knowledge graph, cognitive reasoning, chain execution, and more. ' +
        'Use this API from ChatGPT Custom GPTs, Open WebUI, Gemini, or any OpenAPI-compatible client.',
      contact: { name: 'WidgeTDC Platform', url: 'https://orchestrator-production-c27e.up.railway.app' },
    },
    servers: [
      { url: 'https://orchestrator-production-c27e.up.railway.app', description: 'Production (Railway)' },
      { url: 'http://localhost:4800', description: 'Local development' },
    ],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'API key passed as Bearer token. Also accepts X-API-Key header or ?api_key= query param.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                status_code: { type: 'integer' },
              },
            },
          },
        },
        ToolCallRequest: {
          type: 'object',
          required: ['call_id', 'agent_id', 'tool_name', 'arguments'],
          properties: {
            call_id: { type: 'string', format: 'uuid', description: 'Unique call ID' },
            agent_id: { type: 'string', description: 'Calling agent identifier' },
            tool_name: { type: 'string', description: 'MCP tool name (e.g., srag.query, graph.health)' },
            arguments: { type: 'object', description: 'Tool arguments' },
            trace_id: { type: 'string', description: 'Optional trace ID for correlation' },
            timeout_ms: { type: 'integer', description: 'Timeout in ms (default 30000)', default: 30000 },
          },
        },
        ToolCallResponse: {
          type: 'object',
          properties: {
            call_id: { type: 'string' },
            status: { type: 'string', enum: ['success', 'error', 'timeout'] },
            result: { description: 'Tool result (shape varies by tool)' },
            error_message: { type: 'string', nullable: true },
            duration_ms: { type: 'integer' },
          },
        },
        ChainDefinition: {
          type: 'object',
          required: ['name', 'mode', 'steps'],
          properties: {
            name: { type: 'string', description: 'Chain name' },
            mode: { type: 'string', enum: ['sequential', 'parallel', 'loop', 'debate', 'adaptive', 'funnel'] },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                required: ['agent_id'],
                properties: {
                  agent_id: { type: 'string' },
                  tool_name: { type: 'string' },
                  cognitive_action: { type: 'string' },
                  prompt: { type: 'string' },
                  capability: { type: 'string' },
                },
              },
            },
          },
        },
        AgentHandshake: {
          type: 'object',
          required: ['agent_id', 'display_name'],
          properties: {
            agent_id: { type: 'string' },
            display_name: { type: 'string' },
            version: { type: 'string' },
            status: { type: 'string', enum: ['active', 'idle', 'busy', 'offline'] },
            capabilities: { type: 'array', items: { type: 'string' } },
            allowed_tool_namespaces: { type: 'array', items: { type: 'string' } },
          },
        },
        CognitiveRequest: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'The prompt/question to process' },
            context: { type: 'object', description: 'Additional context' },
            agent_id: { type: 'string' },
            depth: { type: 'integer' },
            mode: { type: 'string' },
            timeout_ms: { type: 'integer' },
          },
        },
        LLMChatRequest: {
          type: 'object',
          required: ['provider'],
          properties: {
            provider: { type: 'string', description: 'LLM provider: deepseek, openai, groq, gemini, claude' },
            prompt: { type: 'string', description: 'Single prompt (or use messages)' },
            messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } } },
            model: { type: 'string' },
            temperature: { type: 'number' },
            max_tokens: { type: 'integer' },
            broadcast: { type: 'boolean', default: true },
          },
        },
      },
    },
    paths: {
      // ─── Health ─────────────────────────────────────────
      '/health': {
        get: {
          operationId: 'getHealth',
          summary: 'Platform health check',
          description: 'Returns health status of all WidgeTDC services (Redis, RLM, OpenClaw, agents, chains, cron).',
          tags: ['Health'],
          security: [],
          responses: {
            '200': {
              description: 'Health status',
              content: { 'application/json': { schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'healthy' },
                  service: { type: 'string' },
                  version: { type: 'string' },
                  uptime_seconds: { type: 'integer' },
                  agents_registered: { type: 'integer' },
                  ws_connections: { type: 'integer' },
                  redis_enabled: { type: 'boolean' },
                  rlm_available: { type: 'boolean' },
                  active_chains: { type: 'integer' },
                  cron_jobs: { type: 'integer' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              } } },
            },
          },
        },
      },

      // ─── Dashboard ──────────────────────────────────────
      '/api/dashboard/data': {
        get: {
          operationId: 'getDashboardData',
          summary: 'Command Center dashboard data',
          description: 'JSON feed for the Command Center SPA. Returns agents, chains, cron jobs, WebSocket stats, Redis status.',
          tags: ['Dashboard'],
          security: [],
          responses: {
            '200': { description: 'Dashboard data object' },
          },
        },
      },

      // ─── Tools ──────────────────────────────────────────
      '/tools/call': {
        post: {
          operationId: 'callTool',
          summary: 'Call an MCP tool',
          description: 'Proxy a tool call to the WidgeTDC backend MCP system. Supports 450+ tools across knowledge graph, SRAG, Linear, compliance, embedding, and more.',
          tags: ['Tools'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolCallRequest' } } },
          },
          responses: {
            '200': { description: 'Tool result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolCallResponse' } } } },
            '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '403': { description: 'ACL denied' },
            '429': { description: 'Rate limited' },
          },
        },
      },
      '/tools/namespaces': {
        get: {
          operationId: 'getToolNamespaces',
          summary: 'List available MCP tool namespaces',
          description: 'Discover all available MCP tools from the backend.',
          tags: ['Tools'],
          responses: {
            '200': { description: 'List of tool namespaces and definitions' },
          },
        },
      },
      '/tools/catalog': {
        get: {
          operationId: 'getToolCatalog',
          summary: 'Full tool catalog with categories',
          description: 'Returns all orchestrator tools categorized by function, with backend tool mappings and availability.',
          tags: ['Tools'],
          responses: {
            '200': { description: 'Tool catalog' },
          },
        },
      },

      // ─── Chains ─────────────────────────────────────────
      '/chains/execute': {
        post: {
          operationId: 'executeChain',
          summary: 'Execute an agent chain',
          description: 'Run a multi-step agent chain. Supports sequential (A->B->C), parallel (A+B+C), debate (two agents argue, third judges), loop, adaptive, and funnel modes.',
          tags: ['Chains'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChainDefinition' } } },
          },
          responses: {
            '200': { description: 'Chain completed', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } },
            '202': { description: 'Chain started (poll for status)', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { execution_id: { type: 'string' }, poll_url: { type: 'string' } } } } } } } },
          },
        },
      },
      '/chains': {
        get: {
          operationId: 'listChains',
          summary: 'List recent chain executions',
          tags: ['Chains'],
          responses: { '200': { description: 'Chain execution list' } },
        },
      },
      '/chains/status/{id}': {
        get: {
          operationId: 'getChainStatus',
          summary: 'Get chain execution status',
          tags: ['Chains'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Execution status' },
            '404': { description: 'Execution not found' },
          },
        },
      },

      // ─── Cognitive (RLM Engine) ─────────────────────────
      '/cognitive/{action}': {
        post: {
          operationId: 'cognitiveAction',
          summary: 'Cognitive reasoning via RLM Engine',
          description: 'Proxy a cognitive action (reason, analyze, plan, learn, fold, enrich) to the RLM Engine for deep multi-step analysis.',
          tags: ['Cognitive'],
          parameters: [
            { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['reason', 'analyze', 'plan', 'learn', 'fold', 'enrich'] }, description: 'Cognitive action type' },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CognitiveRequest' } } },
          },
          responses: {
            '200': { description: 'Cognitive result' },
            '400': { description: 'Missing prompt' },
            '502': { description: 'RLM Engine error' },
            '503': { description: 'RLM Engine unavailable' },
          },
        },
      },

      // ─── Agents ─────────────────────────────────────────
      '/agents': {
        get: {
          operationId: 'listAgents',
          summary: 'List registered agents',
          description: 'Returns all registered agents with capabilities, status, and activity.',
          tags: ['Agents'],
          responses: { '200': { description: 'Agent list' } },
        },
      },
      '/agents/register': {
        post: {
          operationId: 'registerAgent',
          summary: 'Register an agent',
          description: 'Register a new agent in the orchestrator fleet.',
          tags: ['Agents'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentHandshake' } } },
          },
          responses: {
            '200': { description: 'Agent registered' },
            '400': { description: 'Validation error' },
          },
        },
      },

      // ─── Assembly Composer (LIN-534) ────────────────────
      '/api/assembly/compose': {
        post: {
          operationId: 'composeAssembly',
          summary: 'Compose architecture assembly from blocks',
          description: 'Composes verified blocks from LegoFactory into ranked architecture assemblies with coherence/coverage scoring.',
          tags: ['Assembly'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                block_ids: { type: 'array', items: { type: 'string' }, description: 'Specific block IDs to compose' },
                query: { type: 'string', description: 'Context query for assembly' },
                domains: { type: 'array', items: { type: 'string' }, description: 'Filter blocks by domain' },
                max_candidates: { type: 'integer', default: 3, description: 'Max assembly candidates (1-10)' },
              },
            } } },
          },
          responses: {
            '200': { description: 'Assembly candidates with scores' },
            '404': { description: 'No blocks found' },
          },
        },
      },
      '/api/assembly': {
        get: {
          operationId: 'listAssemblies',
          summary: 'List assemblies',
          tags: ['Assembly'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'accepted', 'rejected'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Assembly list' } },
        },
      },

      // ─── Loose-End Detector (LIN-535) ───────────────────
      '/api/loose-ends/scan': {
        post: {
          operationId: 'scanLooseEnds',
          summary: 'Run loose-end detection suite',
          description: 'Automated detection of orphan blocks, contradictions, missing lineage, dangling assemblies, and disconnected nodes.',
          tags: ['Loose Ends'],
          responses: {
            '200': { description: 'Scan results with findings and severity summary' },
          },
        },
      },
      '/api/loose-ends': {
        get: {
          operationId: 'getLooseEnds',
          summary: 'Get latest loose-end scan results',
          tags: ['Loose Ends'],
          responses: { '200': { description: 'Latest scan results' } },
        },
      },

      // ─── Decision Certification (LIN-536) ───────────────
      '/api/decisions/certify': {
        post: {
          operationId: 'certifyDecision',
          summary: 'Certify an architecture decision',
          description: 'Converts an accepted assembly into a verified decision with full lineage chain and production proof.',
          tags: ['Decisions'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['assembly_id', 'title'],
              properties: {
                assembly_id: { type: 'string', description: 'Assembly to certify' },
                title: { type: 'string', description: 'Decision title' },
                summary: { type: 'string' },
                rationale: { type: 'string' },
                certifier: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                evidence_refs: { type: 'array', items: { type: 'string' } },
              },
            } } },
          },
          responses: {
            '201': { description: 'Decision certified with lineage' },
            '400': { description: 'Missing required fields' },
          },
        },
      },
      '/api/decisions': {
        get: {
          operationId: 'listDecisions',
          summary: 'List certified decisions',
          tags: ['Decisions'],
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['certified', 'superseded', 'revoked'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'Decision list' } },
        },
      },

      // ─── Adoption ───────────────────────────────────────
      '/api/adoption/snapshot': {
        post: {
          operationId: 'captureAdoptionSnapshot',
          summary: 'Capture daily adoption metrics snapshot',
          description: 'Collects 24h metrics (conversations, tool calls, agents, pipelines, artifacts) and persists to Redis + Neo4j.',
          tags: ['Adoption'],
          responses: { '200': { description: 'Snapshot captured' } },
        },
      },
      '/api/adoption/metrics': {
        get: {
          operationId: 'getAdoptionMetrics',
          summary: 'Get adoption KPIs',
          tags: ['Adoption'],
          responses: { '200': { description: 'Adoption metrics' } },
        },
      },
      '/api/adoption/trends': {
        get: {
          operationId: 'getAdoptionTrends',
          summary: 'Time-series adoption data',
          tags: ['Adoption'],
          parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
          responses: { '200': { description: 'Daily snapshots' } },
        },
      },

      // ─── Knowledge ──────────────────────────────────────
      '/api/knowledge/cards': {
        get: {
          operationId: 'searchKnowledgeCards',
          summary: 'Search knowledge cards',
          description: 'Search the knowledge graph via KG-RAG and SRAG. Returns normalized knowledge cards with scores.',
          tags: ['Knowledge'],
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Search query' },
            { name: 'top_k', in: 'query', schema: { type: 'integer', default: 5 } },
            { name: 'domains', in: 'query', schema: { type: 'string', default: 'all' } },
          ],
          responses: { '200': { description: 'Knowledge cards' } },
        },
      },
      '/api/knowledge/feed': {
        get: {
          operationId: 'getKnowledgeFeed',
          summary: 'Daily knowledge briefing feed',
          description: 'Graph pulse, top insights, gap alerts, and domain coverage. Cached 24h.',
          tags: ['Knowledge'],
          responses: { '200': { description: 'Knowledge feed' } },
        },
      },

      // ─── LLM Chat ──────────────────────────────────────
      '/api/llm/chat': {
        post: {
          operationId: 'chatWithLLM',
          summary: 'Chat with an LLM provider',
          description: 'Send a prompt to DeepSeek, OpenAI, Groq, Gemini, or Claude. Optionally broadcasts response to chat.',
          tags: ['LLM'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LLMChatRequest' } } },
          },
          responses: {
            '200': { description: 'LLM response' },
            '400': { description: 'Missing provider or prompt' },
            '502': { description: 'LLM provider error' },
          },
        },
      },
      '/api/llm/providers': {
        get: {
          operationId: 'listLLMProviders',
          summary: 'List available LLM providers',
          tags: ['LLM'],
          responses: { '200': { description: 'Provider list with models and status' } },
        },
      },

      // ─── Cron ───────────────────────────────────────────
      '/cron': {
        get: {
          operationId: 'listCronJobs',
          summary: 'List scheduled cron jobs',
          description: 'Returns all configured cron loops with schedule, status, and last run time.',
          tags: ['Cron'],
          responses: { '200': { description: 'Cron job list' } },
        },
        post: {
          operationId: 'createCronJob',
          summary: 'Register a new cron job',
          tags: ['Cron'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['id', 'name', 'schedule', 'chain'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                schedule: { type: 'string', description: 'Cron expression' },
                chain: { $ref: '#/components/schemas/ChainDefinition' },
                enabled: { type: 'boolean', default: true },
              },
            } } },
          },
          responses: { '200': { description: 'Cron job registered' } },
        },
      },
      '/cron/{id}/run': {
        post: {
          operationId: 'triggerCronJob',
          summary: 'Trigger a cron job immediately',
          tags: ['Cron'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Triggered' } },
        },
      },

      // ─── Audit ──────────────────────────────────────────
      '/api/audit/log': {
        get: {
          operationId: 'getAuditLog',
          summary: 'Query audit trail',
          description: 'Queryable mutation trail with actor/action/entity filters.',
          tags: ['Audit'],
          parameters: [
            { name: 'actor', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'entity', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'Audit log entries' } },
        },
      },

      // ─── SSE Events ────────────────────────────────────
      '/api/events': {
        get: {
          operationId: 'subscribeSSE',
          summary: 'Server-Sent Events stream',
          description: 'Real-time event stream for dashboard updates, chain completions, scan results.',
          tags: ['Events'],
          responses: {
            '200': { description: 'SSE event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
          },
        },
      },

      // ─── Monitor ────────────────────────────────────────
      '/monitor/status': {
        get: {
          operationId: 'getMonitorStatus',
          summary: 'Platform monitoring status',
          tags: ['Monitor'],
          responses: { '200': { description: 'Monitor data' } },
        },
      },

      // ─── Orchestrator Tools (auto-generated from canonical registry) ──────
      ...toOpenAPIPaths(),
    },
    tags: [
      { name: 'Health', description: 'Service health and status' },
      { name: 'Dashboard', description: 'Command Center data feed' },
      { name: 'Tools', description: 'MCP tool proxy — 450+ backend tools' },
      { name: 'Chains', description: 'Multi-agent chain execution (sequential, parallel, debate, loop)' },
      { name: 'Cognitive', description: 'RLM Engine deep reasoning proxy' },
      { name: 'Agents', description: 'Agent fleet registration and management' },
      { name: 'Assembly', description: 'Architecture assembly composition from building blocks' },
      { name: 'Loose Ends', description: 'Automated detection of unresolved dependencies' },
      { name: 'Decisions', description: 'Architecture decision certification with lineage' },
      { name: 'Adoption', description: 'Platform adoption metrics and trends' },
      { name: 'Knowledge', description: 'Knowledge graph cards, feed, and briefing' },
      { name: 'LLM', description: 'Multi-provider LLM chat proxy' },
      { name: 'Cron', description: 'Scheduled intelligence loops' },
      { name: 'Audit', description: 'Mutation audit trail' },
      { name: 'Events', description: 'Real-time Server-Sent Events' },
      { name: 'Monitor', description: 'Platform monitoring' },
    ],
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const openapiRouter = Router()

const spec = buildOpenAPISpec()

// Machine-readable spec (for ChatGPT Actions, Open WebUI, etc.)
openapiRouter.get('/openapi.json', (_req, res) => {
  res.json(spec)
})

// Swagger UI
openapiRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(spec as any, {
  customSiteTitle: 'WidgeTDC API Explorer',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
  },
}))
