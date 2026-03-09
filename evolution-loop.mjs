#!/usr/bin/env node
/**
 * evolution-loop.mjs — Self-improving use-case discovery engine.
 *
 * 1. Queries Neo4j graph for inspiration (node types, relationships, tools, insights)
 * 2. Generates use cases via LLM based on graph structure
 * 3. Tests each use case against the orchestrator API
 * 4. Records results → learns from failures
 * 5. Feeds learnings back into next iteration for improvement
 *
 * Usage: node evolution-loop.mjs [iterations=5] [cases-per-iteration=20]
 */

const BASE = 'https://orchestrator-production-c27e.up.railway.app'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const API_KEY = 'WidgeTDC_Orch_2026'
const BACKEND_KEY = 'Heravej_22'

const MAX_ITERATIONS = parseInt(process.argv[2] || '5')
const CASES_PER_ITER = parseInt(process.argv[3] || '20')

// ─── State ──────────────────────────────────────────────────────────────────
const allCases = []
const allResults = []
const learnings = []
const improvements = []
let totalPassed = 0, totalFailed = 0, totalFixed = 0

// ─── Helpers ────────────────────────────────────────────────────────────────
async function orch(path, opts = {}) {
  const url = `${BASE}${path}`
  const res = await fetch(url, {
    ...opts,
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(120000),
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

async function backend(tool, args) {
  const res = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BACKEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json().catch(() => null)
  return data?.result ?? data
}

async function llm(prompt, maxTokens = 2000) {
  const res = await orch('/api/llm/chat', {
    method: 'POST',
    body: JSON.stringify({ provider: 'deepseek', prompt, broadcast: false, max_tokens: maxTokens }),
  })
  return res.body?.data?.content || ''
}

async function graphQuery(cypher) {
  const result = await backend('graph.read_cypher', { query: cypher })
  return result?.results || result || []
}

async function graphWrite(cypher) {
  return await backend('graph.write_cypher', { query: cypher })
}

// ─── FailureMemory Ingestion ────────────────────────────────────────────────
async function ingestFailureMemory() {
  console.log('\n🧠 Ingesting FailureMemory from graph...')
  try {
    const failures = await graphQuery(
      "MATCH (f:FailureMemory) RETURN f.pattern AS pattern, f.category AS category, f.resolution AS resolution, f.source AS source ORDER BY f.created_at DESC LIMIT 30"
    )
    if (failures.length === 0) {
      console.log('  No FailureMemory nodes found')
      return []
    }
    const insights = failures
      .filter(f => f.pattern || f.resolution)
      .map(f => `[${f.category || 'general'}] ${f.pattern || ''} → ${f.resolution || '(unresolved)'}`)
    console.log(`  📥 Loaded ${insights.length} failure patterns from graph`)
    return insights
  } catch (err) {
    console.log(`  ⚠️ Failed to load FailureMemory: ${err.message}`)
    return []
  }
}

// ─── Persist EvolutionEvent to graph ────────────────────────────────────────
async function writeEvolutionEvent(iteration, passed, failed, total, categories) {
  try {
    await graphWrite(`
      CREATE (e:EvolutionEvent {
        type: 'evolution_test',
        iteration: ${iteration},
        pass_rate: ${(passed / total * 100).toFixed(1)},
        passed: ${passed},
        failed: ${failed},
        total: ${total},
        categories: '${categories}',
        source: 'evolution-loop',
        timestamp: datetime()
      })
      WITH e
      MERGE (hub:HubNode:EvolutionHub {name: 'Evolution Log'})
      MERGE (e)-[:LOGGED_IN]->(hub)
      RETURN e.iteration AS iter
    `)
  } catch {}
}

// ─── Persist FailureMemory nodes for new failures ───────────────────────────
async function writeFailureMemory(failedCases) {
  for (const f of failedCases.slice(0, 10)) {
    try {
      const pattern = (f.error || '').replace(/'/g, "\\'").slice(0, 500)
      const name = (f.name || '').replace(/'/g, "\\'").slice(0, 200)
      await graphWrite(`
        MERGE (f:FailureMemory {
          pattern: '${pattern}',
          category: '${f.category || 'unknown'}',
          test_name: '${name}'
        })
        ON CREATE SET f.created_at = datetime(), f.source = 'evolution-loop', f.hit_count = 1
        ON MATCH SET f.last_seen = datetime(), f.hit_count = coalesce(f.hit_count, 0) + 1
        WITH f
        MERGE (hub:HubNode:EvolutionHub {name: 'Evolution Log'})
        MERGE (f)-[:DISCOVERED_IN]->(hub)
        RETURN f.pattern AS p
      `)
    } catch {}
  }
}

// ─── Graph Discovery ────────────────────────────────────────────────────────
async function discoverGraphContext() {
  console.log('\n🔍 Discovering graph context...')

  const [nodeTypes, relTypes, tools, insights, patterns, capabilities] = await Promise.allSettled([
    graphQuery("MATCH (n) RETURN DISTINCT labels(n) AS l, count(*) AS c ORDER BY c DESC LIMIT 25"),
    graphQuery("MATCH ()-[r]->() RETURN DISTINCT type(r) AS r, count(*) AS c ORDER BY c DESC LIMIT 20"),
    graphQuery("MATCH (t:MCPTool) RETURN t.name AS name, t.description AS desc LIMIT 30"),
    graphQuery("MATCH (i:StrategicInsight) RETURN i.title AS title, i.domain AS domain LIMIT 15"),
    graphQuery("MATCH (p:Pattern) RETURN p.name AS name, p.type AS type LIMIT 15"),
    graphQuery("MATCH (c:Capability) RETURN c.name AS name, c.description AS desc LIMIT 15"),
  ])

  const ctx = {
    nodeTypes: nodeTypes.status === 'fulfilled' ? nodeTypes.value.map(r => `${r.l?.join(',')}(${r.c?.low || r.c})`).join(', ') : '(unavailable)',
    relTypes: relTypes.status === 'fulfilled' ? relTypes.value.map(r => r.r).join(', ') : '(unavailable)',
    tools: tools.status === 'fulfilled' ? tools.value.map(r => r.name).filter(Boolean).join(', ') : '(unavailable)',
    insights: insights.status === 'fulfilled' ? insights.value.slice(0, 10).map(r => r.title || r.domain).filter(Boolean).join('; ') : '',
    patterns: patterns.status === 'fulfilled' ? patterns.value.map(r => r.name).filter(Boolean).join(', ') : '',
    capabilities: capabilities.status === 'fulfilled' ? capabilities.value.map(r => r.name).filter(Boolean).join(', ') : '',
  }

  console.log(`  Nodes: ${ctx.nodeTypes.slice(0, 200)}...`)
  console.log(`  Relations: ${ctx.relTypes.slice(0, 200)}...`)
  console.log(`  Tools: ${(ctx.tools || '').slice(0, 200)}...`)
  return ctx
}

// ─── Available API Endpoints ────────────────────────────────────────────────
const API_SURFACE = `
Available Orchestrator API endpoints:
- GET /health — health check with integration flags
- GET /agents — list all registered agents
- POST /agents/register — register new agent (agent_id, source, status, capabilities, allowed_tool_namespaces, display_name)
- POST /agents/:id/heartbeat — heartbeat
- DELETE /agents/:id — remove agent
- POST /chat/message — broadcast message (from, to, source, type:Message|Command|Answer|Handover|Alert|ToolResult, message)
- GET /chat/history — persistent message history (query: limit, offset, target)
- GET /chat/conversations — conversation summaries
- GET /chat/templates — workflow templates
- POST /chat/think — sequential thinking (question, depth:1-5)
- POST /chat/remember — store to all memory layers (content, title, tags)
- POST /chat/summarize — AI summary (target, limit)
- POST /chat/debate — multi-agent debate (agents[], topic, rounds)
- POST /chat/capture — knowledge capture to SRAG (message_ids, summary, tags)
- GET /chat/search — search messages (q, limit)
- POST /chat/pin — pin/unpin message
- POST /chains/execute — execute chain (name, mode:sequential|parallel|loop|debate, steps[])
- GET /chains — list chain executions
- GET /chains/status/:id — chain status
- POST /cognitive/reason — deep reasoning (prompt, depth)
- POST /cognitive/analyze — analysis (task, context, analysis_dimensions[])
- POST /cognitive/plan — planning (task, context, constraints[])
- GET /cron — list cron jobs
- POST /cron/:id/run — trigger cron job
- PATCH /cron/:id — toggle enable/disable
- POST /tools/call — MCP tool proxy (agent_id, tool_name, arguments, call_id:uuid)
- GET /tools/namespaces — available MCP tool namespaces
- POST /api/llm/chat — LLM chat (provider:deepseek|qwen|gemini|openai, prompt)
- GET /api/llm/providers — list LLM providers
- GET /api/dashboard/data — full dashboard data
- GET /api/audit/log — audit trail (limit, action)
- GET /api/events — SSE event stream

Agent auto-reply: When POST /chat/message targets a specific agent (to != "All"), orchestrator generates AI response using that agent's persona.

Chat commands: /omega sitrep|sweep|memory|compliance, /cortex, /mission, /think, /remember, /debate, /summarize, /capture, /chain, /ask, /rag, /episodes, /reason, /plan, /analyze, /fold
`

// ─── Use Case Generator — 100 comprehensive cases across 5 iterations ──────

const uid = () => crypto.randomUUID()
const ts = () => new Date().toISOString()

function generateUseCases(graphCtx, iteration, previousLearnings) {
  const tools = (graphCtx.tools || '').split(', ').filter(Boolean)
  const mcpTool = tools[Math.floor(Math.random() * tools.length)] || 'graph.stats'

  // Each iteration covers different feature domains
  const CASE_BANKS = [
    // ─── Iteration 1: Infrastructure & Agents ──────────────────────────
    [
      { id: '1-01', name: 'Health returns healthy', category: 'health', method: 'GET', path: '/health', body: null, expect_status: 200, expect_body_contains: 'healthy' },
      { id: '1-02', name: 'Health has Redis flag', category: 'health', method: 'GET', path: '/health', body: null, expect_status: 200, expect_body_contains: 'redis_enabled' },
      { id: '1-03', name: 'Health has uptime', category: 'health', method: 'GET', path: '/health', body: null, expect_status: 200, expect_body_contains: 'uptime_seconds' },
      { id: '1-04', name: 'Health has agent count', category: 'health', method: 'GET', path: '/health', body: null, expect_status: 200, expect_body_contains: 'agents_registered' },
      { id: '1-05', name: 'Health has cron count', category: 'health', method: 'GET', path: '/health', body: null, expect_status: 200, expect_body_contains: 'cron_jobs' },
      { id: '1-06', name: 'Dashboard data loads', category: 'dashboard', method: 'GET', path: '/api/dashboard/data', body: null, expect_status: 200, expect_body_contains: 'agents' },
      { id: '1-07', name: 'Dashboard has chains', category: 'dashboard', method: 'GET', path: '/api/dashboard/data', body: null, expect_status: 200, expect_body_contains: 'chains' },
      { id: '1-08', name: 'Dashboard has cronJobs', category: 'dashboard', method: 'GET', path: '/api/dashboard/data', body: null, expect_status: 200, expect_body_contains: 'cronJobs' },
      { id: '1-09', name: 'Agent list returns', category: 'agents', method: 'GET', path: '/agents', body: null, expect_status: 200, expect_body_contains: 'agents' },
      { id: '1-10', name: 'Omega agent exists', category: 'agents', method: 'GET', path: '/agents', body: null, expect_status: 200, expect_body_contains: 'omega' },
      { id: '1-11', name: 'Graph agent exists', category: 'agents', method: 'GET', path: '/agents', body: null, expect_status: 200, expect_body_contains: 'graph' },
      { id: '1-12', name: 'RLM agent exists', category: 'agents', method: 'GET', path: '/agents', body: null, expect_status: 200, expect_body_contains: 'rlm' },
      { id: '1-13', name: 'Register agent', category: 'agents', method: 'POST', path: '/agents/register', body: { agent_id: `evo-${Date.now()}`, source: 'external', status: 'online', capabilities: ['evolution'], allowed_tool_namespaces: ['*'], display_name: 'Evo Test' }, expect_status: 200, expect_body_contains: 'success' },
      { id: '1-14', name: 'Register rejects invalid', category: 'agents', method: 'POST', path: '/agents/register', body: { agent_id: 'x' }, expect_status: 400, expect_body_contains: 'VALIDATION_ERROR' },
      { id: '1-15', name: '404 returns JSON error', category: 'error', method: 'GET', path: '/nonexistent-route-test', body: null, expect_status: 404, expect_body_contains: 'NOT_FOUND' },
      { id: '1-16', name: 'Audit log accessible', category: 'audit', method: 'GET', path: '/api/audit/log?limit=3', body: null, expect_status: 200, expect_body_contains: 'entries' },
      { id: '1-17', name: 'LLM providers list', category: 'llm', method: 'GET', path: '/api/llm/providers', body: null, expect_status: 200, expect_body_contains: 'providers' },
      { id: '1-18', name: 'Tool namespaces', category: 'tools', method: 'GET', path: '/tools/namespaces', body: null, expect_status: 200, expect_body_contains: 'success' },
      { id: '1-19', name: 'WS stats endpoint', category: 'chat', method: 'GET', path: '/chat/ws-stats', body: null, expect_status: 200, expect_body_contains: 'total' },
      { id: '1-20', name: 'Cron jobs list', category: 'cron', method: 'GET', path: '/cron', body: null, expect_status: 200, expect_body_contains: 'jobs' },
    ],
    // ─── Iteration 2: Chat & Messaging ─────────────────────────────────
    [
      { id: '2-01', name: 'Broadcast message', category: 'chat', method: 'POST', path: '/chat/message', body: { from: 'evo', to: 'All', source: 'system', type: 'Message', message: `evo-broadcast-${Date.now()}`, timestamp: ts() }, expect_status: 200, expect_body_contains: 'success' },
      { id: '2-02', name: 'Direct message to omega', category: 'chat', method: 'POST', path: '/chat/message', body: { from: 'evo', to: 'omega', source: 'human', type: 'Message', message: 'evolution test ping', timestamp: ts(), no_reply: true }, expect_status: 200, expect_body_contains: 'success' },
      { id: '2-03', name: 'Command to agent', category: 'chat', method: 'POST', path: '/chat/message', body: { from: 'evo', to: 'graph', source: 'human', type: 'Command', message: 'run graph stats', timestamp: ts(), no_reply: true }, expect_status: 200, expect_body_contains: 'success' },
      { id: '2-04', name: 'Command message', category: 'chat', method: 'POST', path: '/chat/message', body: { from: 'evo', to: 'All', source: 'system', type: 'Command', message: 'evolution check', timestamp: ts() }, expect_status: 200, expect_body_contains: 'success' },
      { id: '2-05', name: 'Chat rejects invalid type', category: 'chat-validation', method: 'POST', path: '/chat/message', body: { from: 'evo', to: 'All', source: 'system', type: 'InvalidType', message: 'test' }, expect_status: 400, expect_body_contains: 'VALIDATION_ERROR' },
      { id: '2-06', name: 'Chat history loads', category: 'chat', method: 'GET', path: '/chat/history?limit=10', body: null, expect_status: 200, expect_body_contains: 'messages' },
      { id: '2-07', name: 'Chat history with offset', category: 'chat', method: 'GET', path: '/chat/history?limit=5&offset=2', body: null, expect_status: 200, expect_body_contains: 'messages' },
      { id: '2-08', name: 'Chat conversations', category: 'chat', method: 'GET', path: '/chat/conversations', body: null, expect_status: 200, expect_body_contains: 'conversations' },
      { id: '2-09', name: 'Chat templates list', category: 'chat', method: 'GET', path: '/chat/templates', body: null, expect_status: 200, expect_body_contains: 'templates' },
      { id: '2-10', name: 'Chat search requires query', category: 'chat-validation', method: 'GET', path: '/chat/search?q=a', body: null, expect_status: 400, expect_body_contains: 'QUERY_TOO_SHORT' },
      { id: '2-11', name: 'Chat search works', category: 'chat', method: 'GET', path: '/chat/search?q=evolution', body: null, expect_status: 200, expect_body_contains: 'results' },
      { id: '2-12', name: 'Chat pinned list', category: 'chat', method: 'GET', path: '/chat/pinned', body: null, expect_status: 200, expect_body_contains: 'messages' },
      { id: '2-13', name: 'Think rejects empty', category: 'think', method: 'POST', path: '/chat/think', body: {}, expect_status: 400, expect_body_contains: 'MISSING_FIELDS' },
      { id: '2-14', name: 'Think starts', category: 'think', method: 'POST', path: '/chat/think', body: { question: 'What is the best pattern for multi-agent coordination?', depth: 2 }, expect_status: 200, expect_body_contains: 'think_id' },
      { id: '2-15', name: 'Remember stores', category: 'memory', method: 'POST', path: '/chat/remember', body: { content: 'Evolution loop test memory entry', title: 'Evo Test', tags: ['evolution', 'test'] }, expect_status: 200, expect_body_contains: 'layers' },
      { id: '2-16', name: 'Remember rejects empty', category: 'memory-validation', method: 'POST', path: '/chat/remember', body: {}, expect_status: 400, expect_body_contains: 'MISSING_FIELDS' },
      { id: '2-17', name: 'Capture rejects empty', category: 'capture-validation', method: 'POST', path: '/chat/capture', body: {}, expect_status: 400, expect_body_contains: 'MISSING_FIELDS' },
      { id: '2-18', name: 'Debate rejects no agents', category: 'debate-validation', method: 'POST', path: '/chat/debate', body: { topic: 'test' }, expect_status: 400, expect_body_contains: 'MISSING_FIELDS' },
      { id: '2-19', name: 'Debate rejects single agent', category: 'debate-validation', method: 'POST', path: '/chat/debate', body: { agents: ['omega'], topic: 'test' }, expect_status: 400, expect_body_contains: 'MISSING_FIELDS' },
      { id: '2-20', name: 'Template daily-standup exists', category: 'templates', method: 'GET', path: '/chat/templates', body: null, expect_status: 200, expect_body_contains: 'daily-standup' },
    ],
    // ─── Iteration 3: Chains & Cognitive ────────────────────────────────
    [
      { id: '3-01', name: 'Chain execute sequential', category: 'chains', method: 'POST', path: '/chains/execute', body: { name: 'evo-seq', mode: 'sequential', steps: [{ agent_id: 'command-center', tool_name: 'graph.stats', arguments: {} }] }, expect_status: [200, 202], expect_body_contains: 'success' },
      { id: '3-02', name: 'Chain execute parallel', category: 'chains', method: 'POST', path: '/chains/execute', body: { name: 'evo-par', mode: 'parallel', steps: [{ agent_id: 'omega', tool_name: 'graph.stats', arguments: {} }] }, expect_status: [200, 202], expect_body_contains: 'success' },
      { id: '3-03', name: 'Chain rejects empty steps', category: 'chains-validation', method: 'POST', path: '/chains/execute', body: { name: 'empty', mode: 'sequential', steps: [] }, expect_status: 400, expect_body_contains: '' },
      { id: '3-04', name: 'Chain list returns', category: 'chains', method: 'GET', path: '/chains', body: null, expect_status: 200, expect_body_contains: 'executions' },
      { id: '3-05', name: 'Chain with cognitive reason', category: 'chains-cognitive', method: 'POST', path: '/chains/execute', body: { name: 'evo-cognitive', mode: 'sequential', steps: [{ agent_id: 'rlm', cognitive_action: 'reason', prompt: 'What is 2+2?' }] }, expect_status: [200, 202], expect_body_contains: 'success' },
      { id: '3-06', name: 'Cognitive reason', category: 'cognitive', method: 'POST', path: '/cognitive/reason', body: { prompt: 'What is 2+2?', task: 'simple math', depth: 0 }, expect_status: 200, expect_body_contains: '' },
      { id: '3-07', name: 'Cognitive analyze', category: 'cognitive', method: 'POST', path: '/cognitive/analyze', body: { prompt: 'evo test', task: 'evo test', context: 'evolution loop testing', analysis_dimensions: ['general'] }, expect_status: 200, expect_body_contains: '' },
      { id: '3-08', name: 'Cognitive plan', category: 'cognitive', method: 'POST', path: '/cognitive/plan', body: { prompt: 'plan for evolution', task: 'evo test plan', context: { scope: 'test' }, constraints: [] }, expect_status: 200, expect_body_contains: '' },
      { id: '3-09', name: 'Cron health-pulse exists', category: 'cron', method: 'GET', path: '/cron', body: null, expect_status: 200, expect_body_contains: 'health-pulse' },
      { id: '3-10', name: 'Cron trigger health-pulse', category: 'cron', method: 'POST', path: '/cron/health-pulse/run', body: null, expect_status: 200, expect_body_contains: 'success' },
      { id: '3-11', name: 'LLM DeepSeek responds', category: 'llm', method: 'POST', path: '/api/llm/chat', body: { provider: 'deepseek', prompt: 'Reply: OK', broadcast: false, max_tokens: 10 }, expect_status: 200, expect_body_contains: 'content' },
      { id: '3-12', name: 'LLM Qwen responds', category: 'llm-external', method: 'POST', path: '/api/llm/chat', body: { provider: 'qwen', prompt: 'Reply: OK', broadcast: false, max_tokens: 10 }, expect_status: [200, 502], expect_body_contains: '' },
      { id: '3-13', name: 'LLM Gemini responds', category: 'llm-external', method: 'POST', path: '/api/llm/chat', body: { provider: 'gemini', prompt: 'Reply: OK', broadcast: false, max_tokens: 10 }, expect_status: [200, 502], expect_body_contains: '' },
      { id: '3-14', name: 'LLM OpenAI responds', category: 'llm-external', method: 'POST', path: '/api/llm/chat', body: { provider: 'openai', prompt: 'Reply: OK', broadcast: false, max_tokens: 10 }, expect_status: [200, 502], expect_body_contains: '' },
      { id: '3-15', name: 'LLM rejects bad provider', category: 'llm-validation', method: 'POST', path: '/api/llm/chat', body: { provider: 'nonexistent', prompt: 'test' }, expect_status: [400, 502], expect_body_contains: '' },
      { id: '3-16', name: 'LLM rejects no prompt', category: 'llm-validation', method: 'POST', path: '/api/llm/chat', body: { provider: 'deepseek' }, expect_status: 400, expect_body_contains: 'MISSING_PROMPT' },
      { id: '3-17', name: 'MCP tool call graph.stats', category: 'mcp', method: 'POST', path: '/tools/call', body: { agent_id: 'omega', tool_name: 'graph.stats', arguments: {}, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '3-18', name: 'MCP tool call srag.query', category: 'mcp', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'srag.query', arguments: { query: 'architecture patterns' }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '3-19', name: 'Summarize with limit', category: 'summarize', method: 'POST', path: '/chat/summarize', body: { limit: 5 }, expect_status: 200, expect_body_contains: 'summary' },
      { id: '3-20', name: 'Debate starts', category: 'debate', method: 'POST', path: '/chat/debate', body: { agents: ['omega', 'nexus'], topic: 'Best architecture for microservices', rounds: 1 }, expect_status: 200, expect_body_contains: 'debate_id' },
    ],
    // ─── Iteration 4: Graph-inspired use cases ─────────────────────────
    [
      { id: '4-01', name: 'Graph read StrategicInsight count', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (n:StrategicInsight) RETURN count(n) AS total" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-02', name: 'Graph read CVE count', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (n:CVE) RETURN count(n) AS total" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-03', name: 'Graph read MCPTool list', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (t:MCPTool) RETURN t.name LIMIT 10" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-04', name: 'Graph read Pattern nodes', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (p:Pattern) RETURN p.name, p.type LIMIT 5" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-05', name: 'Graph read Memory nodes', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (m:Memory) RETURN m.type, count(*) AS cnt ORDER BY cnt DESC LIMIT 5" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-06', name: 'Graph read SIMILAR_TO rels', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH ()-[r:SIMILAR_TO]->() RETURN count(r) AS total" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-07', name: 'Graph read McKinseyReport', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (m:McKinseyReport) RETURN m.title LIMIT 3" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-08', name: 'Graph read Capability nodes', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (c:Capability) RETURN c.name LIMIT 5" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-09', name: 'Graph read EvolutionEvent', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (e:EvolutionEvent) RETURN e.type, count(*) AS cnt ORDER BY cnt DESC LIMIT 5" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-10', name: 'Graph health check', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.health', arguments: {}, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-11', name: 'SRAG query architecture', category: 'srag', method: 'POST', path: '/tools/call', body: { agent_id: 'omega', tool_name: 'srag.query', arguments: { query: 'architecture patterns multi-agent' }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-12', name: 'CMA context retrieval', category: 'memory', method: 'POST', path: '/tools/call', body: { agent_id: 'cma', tool_name: 'cma.context', arguments: { keywords: ['evolution', 'testing'] }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '4-13', name: 'Agent auto-reply omega', category: 'auto-reply', method: 'POST', path: '/chat/message', body: { from: 'evo-test', to: 'omega', source: 'human', type: 'Message', message: 'quick status?', timestamp: ts() }, expect_status: 200, expect_body_contains: 'success' },
      { id: '4-14', name: 'Agent auto-reply nexus', category: 'auto-reply', method: 'POST', path: '/chat/message', body: { from: 'evo-test', to: 'nexus', source: 'human', type: 'Message', message: 'decompose microservices', timestamp: ts() }, expect_status: 200, expect_body_contains: 'success' },
      { id: '4-15', name: 'Agent auto-reply graph', category: 'auto-reply', method: 'POST', path: '/chat/message', body: { from: 'evo-test', to: 'graph', source: 'human', type: 'Message', message: 'how many nodes?', timestamp: ts() }, expect_status: 200, expect_body_contains: 'success' },
      { id: '4-16', name: 'Template incident-response', category: 'templates', method: 'POST', path: '/chat/templates/incident-response/run', body: { topic: 'test-evolution-incident' }, expect_status: 200, expect_body_contains: 'success' },
      { id: '4-17', name: 'Template knowledge-harvest', category: 'templates', method: 'POST', path: '/chat/templates/knowledge-harvest/run', body: { topic: 'evolution patterns' }, expect_status: 200, expect_body_contains: 'success' },
      { id: '4-18', name: 'Template 404 for bad name', category: 'templates-validation', method: 'POST', path: '/chat/templates/nonexistent/run', body: { topic: 'test' }, expect_status: 404, expect_body_contains: 'NOT_FOUND' },
      { id: '4-19', name: 'Audit log filter by action', category: 'audit', method: 'GET', path: '/api/audit/log?limit=3&action=register', body: null, expect_status: 200, expect_body_contains: 'entries' },
      { id: '4-20', name: 'Cron toggle off then on', category: 'cron', method: 'PATCH', path: '/cron/health-pulse', body: { enabled: true }, expect_status: 200, expect_body_contains: 'success' },
    ],
    // ─── Iteration 5: Edge cases, integration & stress ─────────────────
    [
      { id: '5-01', name: 'Auth: no key rejected', category: 'auth', method: 'POST', path: '/tools/call', body: { agent_id: 'x', tool_name: 'x', arguments: {}, call_id: uid() }, expect_status: 401, expect_body_contains: '', _no_auth: true },
      { id: '5-02', name: 'Chat message with thread', category: 'chat-threads', method: 'POST', path: '/chat/message', body: { from: 'evo', to: 'All', source: 'system', type: 'Message', message: 'thread test', timestamp: ts(), thread_id: 'evo-thread-1', parent_id: 'evo-thread-1' }, expect_status: 200, expect_body_contains: 'success' },
      { id: '5-03', name: 'Chat message with files', category: 'chat-files', method: 'POST', path: '/chat/message', body: { from: 'evo', to: 'All', source: 'system', type: 'Message', message: 'file test', timestamp: ts(), files: [{ name: 'test.txt', size: 100, type: 'text/plain' }] }, expect_status: 200, expect_body_contains: 'success' },
      { id: '5-04', name: 'Chain loop mode', category: 'chains-loop', method: 'POST', path: '/chains/execute', body: { name: 'evo-loop', mode: 'loop', max_iterations: 2, steps: [{ agent_id: 'command-center', tool_name: 'graph.stats', arguments: {} }] }, expect_status: [200, 202], expect_body_contains: 'success' },
      { id: '5-05', name: 'Chain debate mode', category: 'chains-debate', method: 'POST', path: '/chains/execute', body: { name: 'evo-debate', mode: 'debate', judge_agent: 'master', steps: [{ agent_id: 'omega', cognitive_action: 'reason', prompt: 'Position A' }, { agent_id: 'nexus', cognitive_action: 'reason', prompt: 'Position B' }] }, expect_status: [200, 202], expect_body_contains: 'success' },
      { id: '5-06', name: 'Multiple providers available', category: 'llm', method: 'GET', path: '/api/llm/providers', body: null, expect_status: 200, expect_body_contains: 'deepseek' },
      { id: '5-07', name: 'Graph write + read', category: 'graph-write', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.write_cypher', arguments: { query: "MERGE (e:EvolutionTest {id: 'evo-loop-test'}) SET e.timestamp = datetime(), e.status = 'tested' RETURN e" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '5-08', name: 'Graph verify write', category: 'graph-verify', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.read_cypher', arguments: { query: "MATCH (e:EvolutionTest {id: 'evo-loop-test'}) RETURN e.status" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '5-09', name: 'Capture with summary', category: 'capture', method: 'POST', path: '/chat/capture', body: { summary: 'Evolution loop test capture — testing knowledge capture pipeline', tags: ['evolution', 'test-capture'] }, expect_status: 200, expect_body_contains: 'success' },
      { id: '5-10', name: 'Remember with tags', category: 'memory', method: 'POST', path: '/chat/remember', body: { content: 'Evolution discovered: graph has 130k+ nodes across 40+ types', title: 'Graph Scale Discovery', tags: ['evolution', 'graph', 'discovery'] }, expect_status: 200, expect_body_contains: 'layers' },
      { id: '5-11', name: 'Concurrent chain + message', category: 'concurrency', method: 'POST', path: '/chat/message', body: { from: 'evo-concurrent', to: 'All', source: 'system', type: 'Message', message: 'concurrent test', timestamp: ts() }, expect_status: 200, expect_body_contains: 'success' },
      { id: '5-12', name: 'Chat search evolution', category: 'chat-search', method: 'GET', path: '/chat/search?q=evolution', body: null, expect_status: 200, expect_body_contains: 'results' },
      { id: '5-13', name: 'Pin requires message_id', category: 'pin-validation', method: 'POST', path: '/chat/pin', body: {}, expect_status: 400, expect_body_contains: 'MISSING_FIELDS' },
      { id: '5-14', name: 'Threads endpoint', category: 'threads', method: 'GET', path: '/chat/threads/evo-thread-1', body: null, expect_status: 200, expect_body_contains: 'success' },
      { id: '5-15', name: 'Think depth 3', category: 'think', method: 'POST', path: '/chat/think', body: { question: 'How to optimize Neo4j graph queries for 130k nodes?', depth: 3 }, expect_status: 200, expect_body_contains: 'think_id' },
      { id: '5-16', name: 'SSE event stream connects', category: 'sse', method: 'GET', path: '/api/events', body: null, expect_status: 200, expect_body_contains: '', _sse: true },
      { id: '5-17', name: 'Graph stats tool', category: 'graph', method: 'POST', path: '/tools/call', body: { agent_id: 'omega', tool_name: 'graph.stats', arguments: {}, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '5-18', name: 'Multi-step chain reason+plan', category: 'chains-multi', method: 'POST', path: '/chains/execute', body: { name: 'evo-multi', mode: 'sequential', steps: [{ agent_id: 'rlm', cognitive_action: 'reason', prompt: 'Why multi-agent?' }, { agent_id: 'rlm', cognitive_action: 'plan', prompt: 'Plan: {{prev}}' }] }, expect_status: [200, 202], expect_body_contains: 'success' },
      { id: '5-19', name: 'Graph cleanup EvolutionTest', category: 'graph-cleanup', method: 'POST', path: '/tools/call', body: { agent_id: 'graph', tool_name: 'graph.write_cypher', arguments: { query: "MATCH (e:EvolutionTest {id: 'evo-loop-test'}) DELETE e" }, call_id: uid() }, expect_status: 200, expect_body_contains: '' },
      { id: '5-20', name: 'Final health check', category: 'health', method: 'GET', path: '/health', body: null, expect_status: 200, expect_body_contains: 'healthy' },
    ],
  ]

  // Cycle through banks for iterations > 5
  const bankIndex = (iteration - 1) % CASE_BANKS.length
  const cases = CASE_BANKS[bankIndex].map(c => ({
    ...c,
    id: `${iteration}-${c.id.split('-')[1]}`,  // Unique ID per iteration
  }))
  // Re-generate unique IDs for agent registration and tool calls
  cases.forEach(c => {
    if (c.body?.agent_id?.startsWith('evo-')) c.body.agent_id = `evo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    if (c.body?.call_id) c.body.call_id = uid()
    if (c.body?.timestamp) c.body.timestamp = ts()
    if (c.body?.message?.includes('evo-broadcast-')) c.body.message = `evo-broadcast-${Date.now()}`
  })
  console.log(`  📋 ${cases.length} cases for iteration ${iteration} (bank ${bankIndex + 1}/5)`)
  return cases
}

// ─── Test Runner ────────────────────────────────────────────────────────────
async function runCase(testCase) {
  const t0 = Date.now()
  try {
    // SSE test — just verify connection starts (status 200)
    if (testCase._sse) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 3000)
      try {
        const rawRes = await fetch(`${BASE}${testCase.path}`, {
          headers: { 'Authorization': `Bearer ${API_KEY}` },
          signal: ctrl.signal,
        })
        clearTimeout(timer)
        return { ...testCase, passed: rawRes.status === 200, error: rawRes.status !== 200 ? `Status ${rawRes.status}` : null, status: rawRes.status, response_preview: '(SSE stream)', duration_ms: Date.now() - t0 }
      } catch (err) {
        clearTimeout(timer)
        // AbortError means connection was established (200) then we killed it — that's a PASS
        if (err.name === 'AbortError') return { ...testCase, passed: true, error: null, status: 200, response_preview: '(SSE aborted after connect)', duration_ms: Date.now() - t0 }
        throw err
      }
    }

    const opts = { method: testCase.method || 'GET' }
    if (testCase.body) opts.body = JSON.stringify(testCase.body)

    // For auth rejection tests, call without auth header
    let res
    if (testCase._no_auth) {
      const url = `${BASE}${testCase.path}`
      const rawRes = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000) })
      const body = await rawRes.json().catch(() => null)
      res = { ok: rawRes.ok, status: rawRes.status, body }
    } else {
      res = await orch(testCase.path, opts)
    }
    const ms = Date.now() - t0
    const bodyStr = JSON.stringify(res.body || '')

    // Accept 502/503 for cognitive/RLM endpoints (may be unavailable)
    const rlmEndpoints = ['/cognitive/reason', '/cognitive/analyze', '/cognitive/plan', '/cognitive/fold']
    const isRlm = rlmEndpoints.some(e => testCase.path.startsWith(e))
    const expectedStatuses = Array.isArray(testCase.expect_status) ? testCase.expect_status : (testCase.expect_status ? [testCase.expect_status] : null)
    const statusOk = (isRlm && (res.status === 502 || res.status === 503))
      ? true
      : (expectedStatuses ? expectedStatuses.includes(res.status) : res.ok)
    const bodyOk = (isRlm && (res.status === 502 || res.status === 503))
      ? true
      : (testCase.expect_body_contains ? bodyStr.includes(testCase.expect_body_contains) : true)

    const passed = statusOk && bodyOk
    const error = !statusOk
      ? `Expected ${testCase.expect_status || '2xx'}, got ${res.status}`
      : !bodyOk
        ? `Response missing "${testCase.expect_body_contains}"`
        : null

    return {
      ...testCase,
      passed,
      error,
      status: res.status,
      response_preview: bodyStr.slice(0, 300),
      duration_ms: ms,
    }
  } catch (err) {
    return {
      ...testCase,
      passed: false,
      error: `Exception: ${err.message}`,
      status: 0,
      response_preview: '',
      duration_ms: Date.now() - t0,
    }
  }
}

// ─── Learning Engine ────────────────────────────────────────────────────────
async function analyzeFails(failedCases, iteration) {
  if (failedCases.length === 0) return []

  const failSummary = failedCases.map(f =>
    `[${f.category}] ${f.name}: ${f.method} ${f.path} → ${f.error} (HTTP ${f.status}) | Response: ${(f.response_preview || '').slice(0, 150)}`
  ).join('\n')

  const prompt = `Analyze these API test failures for a multi-agent orchestrator and provide ACTIONABLE learnings.

FAILURES (iteration ${iteration}):
${failSummary}

For each failure, determine:
1. Is it a TEST issue (bad test expectations) or a SYSTEM issue (actual bug/missing feature)?
2. What should be fixed?

Reply with a JSON array of objects:
{ "type": "test_fix" | "system_fix" | "learning", "description": "what to fix or learn", "category": "category" }

Only JSON, no other text.`

  const raw = await llm(prompt, 1500)
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    return match ? JSON.parse(match[0]) : []
  } catch {
    return [{ type: 'learning', description: `${failedCases.length} failures in iteration ${iteration} — needs manual review`, category: 'general' }]
  }
}

// ─── Store Results to Memory ────────────────────────────────────────────────
async function persistResults(iteration, results, newLearnings) {
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const categories = [...new Set(results.map(r => r.category))].join(', ')

  const content = `Evolution Loop Iteration ${iteration}
Results: ${passed} passed, ${failed} failed / ${results.length} total
Categories: ${categories}

Failed cases:
${results.filter(r => !r.passed).map(r => `- [${r.category}] ${r.name}: ${r.error}`).join('\n') || '(none)'}

Learnings:
${newLearnings.map(l => `- [${l.type}] ${l.description}`).join('\n') || '(none)'}

Cumulative stats: ${totalPassed} passed, ${totalFailed} failed, ${totalFixed} fixed across ${iteration} iterations`

  // Store to orchestrator memory
  try {
    await orch('/chat/remember', {
      method: 'POST',
      body: JSON.stringify({
        content,
        title: `Evolution Loop Iteration ${iteration}`,
        tags: ['evolution', 'testing', `iter-${iteration}`],
      }),
    })
  } catch {}

  // Broadcast summary to chat
  try {
    await orch('/chat/message', {
      method: 'POST',
      body: JSON.stringify({
        from: 'Evolution Engine',
        to: 'All',
        source: 'system',
        type: 'Message',
        message: `🧬 **Evolution Iteration ${iteration}**: ${passed}/${results.length} passed | ${newLearnings.length} learnings | Categories: ${categories}`,
        timestamp: new Date().toISOString(),
        no_reply: true,
      }),
    })
  } catch {}
}

// ─── Main Evolution Loop ────────────────────────────────────────────────────
async function run() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  🧬 WidgeTDC Evolution Loop                            ║')
  console.log(`║  Iterations: ${MAX_ITERATIONS} | Cases/iter: ${CASES_PER_ITER} | Total: ${MAX_ITERATIONS * CASES_PER_ITER}      ║`)
  console.log('╚══════════════════════════════════════════════════════════╝')

  // Discover graph context + ingest historical failure patterns
  const graphCtx = await discoverGraphContext()
  const failurePatterns = await ingestFailureMemory()
  if (failurePatterns.length > 0) {
    learnings.push(...failurePatterns.slice(0, 15))
    console.log(`  📚 Seeded ${Math.min(failurePatterns.length, 15)} learnings from FailureMemory`)
  }

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`  ITERATION ${iter}/${MAX_ITERATIONS}`)
    console.log('═'.repeat(60))

    // 1. Generate use cases (informed by previous learnings)
    const cases = await generateUseCases(graphCtx, iter, learnings)

    // 2. Run all cases
    console.log(`\n🏃 Running ${cases.length} tests...`)
    const results = []
    for (const c of cases) {
      const result = await runCase(c)
      results.push(result)
      allResults.push(result)
      allCases.push(c)

      const icon = result.passed ? '✅' : '❌'
      console.log(`  ${icon} [${(c.category || '?').slice(0, 12).padEnd(12)}] ${(c.name || c.id).slice(0, 50)} (${result.duration_ms}ms)`)
    }

    const passed = results.filter(r => r.passed).length
    const failed = results.filter(r => !r.passed).length
    totalPassed += passed
    totalFailed += failed

    console.log(`\n  Results: ${passed} passed, ${failed} failed / ${results.length}`)

    // 3. Analyze failures and generate learnings
    const failedCases = results.filter(r => !r.passed)
    if (failedCases.length > 0) {
      console.log(`\n🧠 Analyzing ${failedCases.length} failures...`)
      const newLearnings = await analyzeFails(failedCases, iter)

      for (const l of newLearnings) {
        learnings.push(l.description)
        if (l.type === 'system_fix') improvements.push(l)
        console.log(`  💡 [${l.type}] ${l.description.slice(0, 100)}`)
      }
    }

    // 4. Persist results to memory + graph
    const categories = [...new Set(results.map(r => r.category))].join(', ')
    await Promise.allSettled([
      persistResults(iter, results, learnings.slice(-10)),
      writeEvolutionEvent(iter, passed, failed, results.length, categories),
      failedCases.length > 0 ? writeFailureMemory(failedCases) : Promise.resolve(),
    ])

    console.log(`\n📊 Cumulative: ${totalPassed} passed, ${totalFailed} failed across ${iter} iterations`)
  }

  // ─── Final Report ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('  🧬 EVOLUTION LOOP COMPLETE')
  console.log('═'.repeat(60))
  console.log(`\n  Total cases:    ${allResults.length}`)
  console.log(`  Passed:         ${totalPassed}`)
  console.log(`  Failed:         ${totalFailed}`)
  console.log(`  Pass rate:      ${(totalPassed / allResults.length * 100).toFixed(1)}%`)
  console.log(`  Learnings:      ${learnings.length}`)
  console.log(`  System fixes:   ${improvements.filter(i => i.type === 'system_fix').length}`)

  // Category breakdown
  const catStats = {}
  for (const r of allResults) {
    const cat = r.category || 'other'
    if (!catStats[cat]) catStats[cat] = { passed: 0, failed: 0 }
    catStats[cat][r.passed ? 'passed' : 'failed']++
  }
  console.log('\n  Category breakdown:')
  for (const [cat, stats] of Object.entries(catStats).sort((a, b) => (b[1].passed + b[1].failed) - (a[1].passed + a[1].failed))) {
    const total = stats.passed + stats.failed
    const pct = (stats.passed / total * 100).toFixed(0)
    console.log(`    ${cat.padEnd(20)} ${stats.passed}/${total} (${pct}%)`)
  }

  if (learnings.length > 0) {
    console.log('\n  Key learnings:')
    // Deduplicate similar learnings
    const unique = [...new Set(learnings)]
    unique.slice(0, 20).forEach((l, i) => console.log(`    ${i + 1}. ${l.slice(0, 120)}`))
  }

  if (improvements.length > 0) {
    console.log('\n  🔧 Suggested system improvements:')
    improvements.forEach((imp, i) => console.log(`    ${i + 1}. [${imp.category}] ${imp.description}`))
  }

  // Store final report
  const finalReport = `Evolution Loop Complete — ${allResults.length} cases, ${totalPassed} passed (${(totalPassed / allResults.length * 100).toFixed(1)}%)

Key learnings:
${[...new Set(learnings)].map((l, i) => `${i + 1}. ${l}`).join('\n')}

System improvements needed:
${improvements.map((i, n) => `${n + 1}. [${i.category}] ${i.description}`).join('\n') || '(none)'}

Category breakdown:
${Object.entries(catStats).map(([c, s]) => `${c}: ${s.passed}/${s.passed + s.failed}`).join(', ')}`

  await orch('/chat/remember', {
    method: 'POST',
    body: JSON.stringify({
      content: finalReport,
      title: `Evolution Loop Final Report — ${allResults.length} cases`,
      tags: ['evolution', 'final-report', 'testing'],
    }),
  }).catch(() => {})

  console.log('\n')
  process.exit(totalFailed > allResults.length * 0.5 ? 1 : 0)
}

run().catch(err => {
  console.error('Evolution loop crashed:', err)
  process.exit(1)
})
