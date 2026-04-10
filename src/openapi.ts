/**
 * openapi.ts — OpenAPI 3.0 spec + Swagger UI for Universal AI Tool Gateway.
 *
 * Serves:
 *   GET /openapi.json  — Machine-readable OpenAPI spec (for ChatGPT Actions, Open WebUI, etc.)
 *   GET /docs          — Swagger UI explorer
 */
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import { toOpenAPIPaths, TOOL_REGISTRY } from './tools/tool-registry.js'

// ─── Build OpenAPI spec inline (no JSDoc file scanning needed) ──────────────

function buildOpenAPISpec(): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'WidgeTDC Orchestrator — Universal AI Tool Gateway',
      version: '2.1.0',
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

// ─── ChatGPT-trimmed spec (10 core Neural Bridge tools) ─────────────────────

function buildChatGPTSpec(): object {
  const BASE = 'https://orchestrator-production-c27e.up.railway.app'
  return {
    openapi: '3.1.0',
    info: {
      title: 'WidgeTDC Neural Bridge',
      version: '1.0.0',
      description: 'WidgeTDC platform intelligence: knowledge graph (475K+ nodes), Linear project management, RLM deep reasoning, and multi-agent chains.',
    },
    servers: [{ url: BASE, description: 'WidgeTDC Orchestrator (Railway)' }],
    security: [{ BearerAuth: [] }],
    components: {
      schemas: {},
      securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } },
    },
    paths: {
      '/api/tools/search_knowledge': {
        post: {
          operationId: 'searchKnowledge',
          summary: 'Search the WidgeTDC knowledge graph',
          description: 'Search the knowledge graph and semantic vector store. Use for ANY question about platform data, consulting knowledge, patterns, documents, or entities.',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['query'],
            properties: {
              query: { type: 'string', description: 'Natural language search query' },
              max_results: { type: 'integer', description: 'Max results (default 10)', default: 10 },
            },
          } } } },
          responses: { '200': { description: 'Search results from SRAG + Neo4j' } },
        },
      },
      '/api/tools/reason_deeply': {
        post: {
          operationId: 'reasonDeeply',
          summary: 'Deep multi-step reasoning via RLM engine',
          description: 'Send a complex question to the RLM reasoning engine. Use for strategy questions, architecture analysis, comparisons, evaluations, and planning.',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['question'],
            properties: {
              question: { type: 'string', description: 'The complex question to reason about' },
              mode: { type: 'string', enum: ['reason', 'analyze', 'plan'], default: 'reason', description: 'Reasoning mode' },
            },
          } } } },
          responses: { '200': { description: 'Deep reasoning result' } },
        },
      },
      '/api/tools/query_graph': {
        post: {
          operationId: 'queryGraph',
          summary: 'Execute a Cypher query against Neo4j',
          description: 'Run a read-only Cypher query against the Neo4j knowledge graph (475K+ nodes, 3.8M+ relationships).',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['cypher'],
            properties: {
              cypher: { type: 'string', description: 'Neo4j Cypher query (read-only)' },
              params: { type: 'object', description: 'Query parameters', additionalProperties: true },
            },
          } } } },
          responses: { '200': { description: 'Query results' } },
        },
      },
      '/api/tools/check_tasks': {
        post: {
          operationId: 'checkTasks',
          summary: 'Get active tasks and project status',
          description: 'Get active tasks, issues, and project status. Use when asked about project status, next steps, blockers, sprints, or Linear issues.',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              filter: { type: 'string', enum: ['active', 'blocked', 'recent', 'all'], default: 'active' },
              keyword: { type: 'string', description: 'Optional keyword to filter tasks' },
            },
          } } } },
          responses: { '200': { description: 'Task list' } },
        },
      },
      '/api/tools/linear_issues': {
        post: {
          operationId: 'linearIssues',
          summary: 'Get Linear issues and project status',
          description: 'Get issues from Linear. Use for project status, sprint progress, blockers, or looking up specific issues (LIN-xxx).',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query or issue identifier e.g. "LIN-493"' },
              status: { type: 'string', enum: ['active', 'done', 'backlog', 'all'], default: 'active' },
              limit: { type: 'integer', default: 10 },
            },
          } } } },
          responses: { '200': { description: 'Linear issues' } },
        },
      },
      '/api/tools/linear_save_issue': {
        post: {
          operationId: 'linearSaveIssue',
          summary: 'Create or update a Linear issue',
          description: 'Create a new Linear issue or update an existing one. Provide id to update, omit to create. Title and team required for new issues.',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Issue ID for update (omit for create)' },
              title: { type: 'string', description: 'Issue title (required when creating)' },
              description: { type: 'string', description: 'Issue description as Markdown' },
              team: { type: 'string', description: 'Team name or ID (required when creating)' },
              priority: { type: 'integer', description: '0=None, 1=Urgent, 2=High, 3=Normal, 4=Low' },
              state: { type: 'string', description: 'State name e.g. "In Progress"' },
            },
          } } } },
          responses: { '200': { description: 'Issue created or updated' } },
        },
      },
      '/api/tools/get_platform_health': {
        post: {
          operationId: 'getPlatformHealth',
          summary: 'Get platform health status',
          description: 'Check current health of all WidgeTDC services (backend, RLM engine, Neo4j, Redis). Use when asked about system status or uptime.',

          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {} } } } },
          responses: { '200': { description: 'Health status for all services' } },
        },
      },
      '/api/tools/investigate': {
        post: {
          operationId: 'investigate',
          summary: 'Deep multi-agent investigation',
          description: 'Run a comprehensive multi-agent investigation on any topic. Returns analysis with graph data, compliance, strategy, and reasoning. Slower but very thorough.',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['topic'],
            properties: { topic: { type: 'string', description: 'The topic to investigate' } },
          } } } },
          responses: { '200': { description: 'Investigation artifact' } },
        },
      },
      '/api/tools/call_mcp_tool': {
        post: {
          operationId: 'callMcpTool',
          summary: 'Call any of the 449+ MCP tools directly',
          description: 'Direct access to all WidgeTDC MCP tools. Use for specific operations: srag.query, graph.health, audit.dashboard, embedding.embed, compliance.check, etc.',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['tool_name'],
            properties: {
              tool_name: { type: 'string', description: 'MCP tool name e.g. "srag.query", "graph.health"' },
              payload: { type: 'object', description: 'Tool arguments', additionalProperties: true },
            },
          } } } },
          responses: { '200': { description: 'Tool result' } },
        },
      },
      '/api/tools/run_chain': {
        post: {
          operationId: 'runChain',
          summary: 'Execute a multi-agent chain',
          description: 'Run a coordinated multi-step agent chain in sequential, parallel, debate, or loop mode.',

          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['name', 'mode', 'steps'],
            properties: {
              name: { type: 'string', description: 'Chain name' },
              mode: { type: 'string', enum: ['sequential', 'parallel', 'debate', 'loop'] },
              steps: {
                type: 'array',
                items: {
                  type: 'object', required: ['agent_id'],
                  properties: {
                    agent_id: { type: 'string' },
                    tool_name: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                },
              },
            },
          } } } },
          responses: { '200': { description: 'Chain result' } },
        },
      },
      '/api/tools/chat_send': {
        post: {
          operationId: 'chatSend',
          summary: 'Send a message to the WidgeTDC agent chat bus',
          description: 'Post a message to the orchestrator chat bus. Use for A2A communication: send replies to debate threads, broadcast to all agents, or DM a specific agent. Always include thread_id when replying to a thread.',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['from', 'message'],
            properties: {
              from: { type: 'string', description: 'Your agent identity (e.g. "chatgpt", "qwen")' },
              to: { type: 'string', description: 'Recipient agent ID or "All" for broadcast', default: 'All' },
              message: { type: 'string', description: 'Message content (markdown supported)' },
              thread_id: { type: 'string', description: 'Thread ID to reply in an existing conversation thread' },
            },
          } } } },
          responses: { '200': { description: 'Message sent confirmation with message ID' } },
        },
      },
      '/api/tools/chat_read': {
        post: {
          operationId: 'chatRead',
          summary: 'Read messages from the WidgeTDC agent chat bus',
          description: 'Read recent messages from the orchestrator chat bus. Use thread_id to read a specific conversation thread (e.g. a debate). Call this first to catch up on what others have said, then respond with chat_send.',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              thread_id: { type: 'string', description: 'Filter by thread ID to read a specific conversation' },
              from_agent: { type: 'string', description: 'Filter messages from a specific agent' },
              limit: { type: 'integer', description: 'Max messages to return (default 20, max 100)', default: 20 },
            },
          } } } },
          responses: { '200': { description: 'Array of messages with from, to, message, timestamp, thread_id' } },
        },
      },
    },
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const openapiRouter = Router()

const spec = buildOpenAPISpec()
const gptSpec = buildChatGPTSpec()

// Machine-readable spec (for ChatGPT Actions, Open WebUI, etc.)
openapiRouter.get('/openapi.json', (_req, res) => {
  res.json(spec)
})

// Trimmed spec for ChatGPT Custom GPT Actions (10 core Neural Bridge tools)
openapiRouter.get('/openapi-gpt.json', (_req, res) => {
  res.json(gptSpec)
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
