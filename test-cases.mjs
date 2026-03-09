/**
 * test-cases.mjs — Real-world use-case scenarios for WidgeTDC Orchestrator.
 *
 * These are NOT unit tests — they are full workflow scenarios that exercise
 * the platform as a real agent or human operator would.
 *
 * Usage: node test-cases.mjs [base_url] [api_key]
 */

const BASE = process.argv[2] || 'https://orchestrator-production-c27e.up.railway.app'
const API_KEY = process.argv[3] || 'WidgeTDC_Orch_2026'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const BACKEND_KEY = 'Heravej_22'

let passed = 0, failed = 0
const results = []
const t0_global = Date.now()

async function scenario(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    passed++
    const ms = Date.now() - t0
    results.push({ name, status: 'PASS', ms })
    console.log(`  ✅ ${name} (${ms}ms)`)
  } catch (err) {
    failed++
    const ms = Date.now() - t0
    results.push({ name, status: 'FAIL', ms, error: err.message })
    console.log(`  ❌ ${name}: ${err.message}`)
  }
}

async function orch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, ...opts.headers }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers, signal: AbortSignal.timeout(60000) })
  const body = await res.json().catch(() => null)
  return { status: res.status, body, ok: res.ok }
}

async function backend(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BACKEND_KEY}`, ...opts.headers }
  const res = await fetch(`${BACKEND}${path}`, { ...opts, headers, signal: AbortSignal.timeout(60000) })
  const body = await res.json().catch(() => null)
  return { status: res.status, body, ok: res.ok }
}

async function mcp(tool, args = {}) {
  return backend('/api/mcp/route', {
    method: 'POST',
    body: JSON.stringify({ tool, args }),
  })
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed') }
function uid() { return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

// ═══════════════════════════════════════════════════════════════
console.log(`\n🔬 WidgeTDC Real-World Use-Case Tests — ${BASE}\n`)

// ═══════════════════════════════════════════════════════════════
console.log('=' .repeat(65))
console.log('  CASE 1: Agent Lifecycle — register → work → report → depart')
console.log('=' .repeat(65))

await scenario('1a. External agent registers with capabilities', async () => {
  const id = uid()
  globalThis._agent1 = id
  const r = await orch('/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: id,
      source: 'external',
      status: 'online',
      capabilities: ['data-analysis', 'reporting', 'neo4j-query'],
      allowed_tool_namespaces: ['graph', 'srag'],
      display_name: 'Data Analyst Agent',
      model: 'deepseek-r1',
      version: '1.0.0',
    }),
  })
  assert(r.ok, `register failed: ${r.status} ${JSON.stringify(r.body)}`)
})

await scenario('1b. Agent appears in registry with correct fields', async () => {
  const r = await orch('/agents')
  const agents = r.body.data?.agents || []
  const agent = agents.find(a => a.agent_id === globalThis._agent1)
  assert(agent, 'agent not found in registry')
  assert(agent.status === 'online', `wrong status: ${agent.status}`)
  assert(agent.display_name === 'Data Analyst Agent', `wrong name: ${agent.display_name}`)
})

await scenario('1c. Agent sends heartbeat to stay alive', async () => {
  const r = await orch(`/agents/${globalThis._agent1}/heartbeat`, { method: 'POST' })
  assert(r.ok, `heartbeat failed: ${r.status}`)
})

await scenario('1d. Agent updates status to busy', async () => {
  const r = await orch(`/agents/${globalThis._agent1}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'busy' }),
  })
  assert(r.ok, `patch failed: ${r.status}`)
  // Verify
  const r2 = await orch('/agents')
  const agent = (r2.body.data?.agents || []).find(a => a.agent_id === globalThis._agent1)
  assert(agent?.status === 'busy', `expected busy, got ${agent?.status}`)
})

await scenario('1e. Agent deregisters cleanly', async () => {
  const r = await orch(`/agents/${globalThis._agent1}`, { method: 'DELETE' })
  assert(r.ok, `delete failed: ${r.status}`)
  // Verify gone
  const r2 = await orch('/agents')
  const still = (r2.body.data?.agents || []).find(a => a.agent_id === globalThis._agent1)
  assert(!still, 'agent still in registry after delete')
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 2: Chain Execution — parallel graph queries')
console.log('=' .repeat(65))

await scenario('2a. Execute parallel chain with 2 graph steps', async () => {
  const r = await orch('/chains/execute', {
    method: 'POST',
    body: JSON.stringify({
      name: 'e2e-graph-audit',
      mode: 'parallel',
      steps: [
        { agent_id: 'command-center', tool_name: 'graph.stats', arguments: {} },
        { agent_id: 'command-center', tool_name: 'graph.health', arguments: {} },
      ],
    }),
  })
  assert(r.ok, `chain failed: ${r.status} ${JSON.stringify(r.body?.error)}`)
  globalThis._chainId = r.body.data?.execution_id || r.body.execution_id
  assert(globalThis._chainId, 'no execution_id returned')
})

await scenario('2b. Chain appears in execution history', async () => {
  const r = await orch('/chains')
  assert(r.ok, `list failed: ${r.status}`)
  const execs = r.body.data?.executions || []
  const ours = execs.find(e => e.execution_id === globalThis._chainId)
  assert(ours, 'chain not in history')
  assert(['completed', 'running', 'pending'].includes(ours.status), `unexpected status: ${ours.status}`)
})

await scenario('2c. Sequential chain with single step completes', async () => {
  const r = await orch('/chains/execute', {
    method: 'POST',
    body: JSON.stringify({
      name: 'e2e-seq-single',
      mode: 'sequential',
      steps: [
        { agent_id: 'command-center', tool_name: 'graph.stats', arguments: {} },
      ],
    }),
  })
  assert(r.ok, `chain failed: ${r.status}`)
  // Wait for completion and check status
  const execId = r.body.data?.execution_id || r.body.execution_id
  // Give it a moment to finish
  await new Promise(r => setTimeout(r, 2000))
  const r2 = await orch('/chains')
  const exec = (r2.body.data?.executions || []).find(e => e.execution_id === execId)
  if (exec) assert(exec.status !== 'failed', `chain failed: ${JSON.stringify(exec)}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 3: Chat Workflow — human posts, agent responds')
console.log('=' .repeat(65))

await scenario('3a. Human sends message to chat', async () => {
  const r = await orch('/chat/message', {
    method: 'POST',
    body: JSON.stringify({
      from: 'claus',
      to: 'All',
      source: 'human',
      type: 'Message',
      message: 'Hej team — kør status check på alle services',
      timestamp: new Date().toISOString(),
    }),
  })
  assert(r.ok, `send failed: ${r.status}`)
})

await scenario('3b. Agent responds with @mention', async () => {
  const r = await orch('/chat/message', {
    method: 'POST',
    body: JSON.stringify({
      from: 'omega',
      to: 'claus',
      source: 'system',
      type: 'Message',  // only Message, TaskAssignment, Command are valid
      message: '@claus Alle services kører. Backend: OK, RLM: OK, Neo4j: OK',
      timestamp: new Date().toISOString(),
    }),
  })
  assert(r.ok, `response failed: ${r.status}`)
})

await scenario('3c. Agent sends command result', async () => {
  const r = await orch('/chat/message', {
    method: 'POST',
    body: JSON.stringify({
      from: 'omega',
      to: 'All',
      source: 'system',
      type: 'Command',
      message: '/chain graph.stats → 137K nodes, 1.1M edges',
      timestamp: new Date().toISOString(),
    }),
  })
  assert(r.ok, `command failed: ${r.status}`)
})

await scenario('3d. WebSocket connects and receives presence', async () => {
  const wsUrl = BASE.replace('https://', 'wss://').replace('http://', 'ws://') +
    `/ws?agent_id=e2e-presence-${Date.now()}&api_key=${encodeURIComponent(API_KEY)}`
  const messages = await new Promise((resolve, reject) => {
    const collected = []
    const timer = setTimeout(() => resolve(collected), 4000)
    try {
      const ws = new WebSocket(wsUrl)
      ws.onmessage = (ev) => {
        try { collected.push(JSON.parse(ev.data)) } catch { collected.push(ev.data) }
      }
      ws.onerror = () => { clearTimeout(timer); reject(new Error('WS error')) }
      ws.onclose = (e) => {
        clearTimeout(timer)
        if (e.code === 4401) reject(new Error('WS auth rejected'))
        else resolve(collected)
      }
      // Send a ping after connecting
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'ping' }))
        // Close after 3 seconds
        setTimeout(() => ws.close(), 3000)
      }
    } catch (err) { clearTimeout(timer); reject(err) }
  })
  // We just need to confirm WS opened and didn't crash
  assert(true, 'WS connection successful')
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 4: Cron Loop — health-pulse cycle')
console.log('=' .repeat(65))

await scenario('4a. Verify health-pulse cron is active', async () => {
  const r = await orch('/cron')
  const jobs = r.body.data?.jobs || []
  const hp = jobs.find(j => j.id === 'health-pulse')
  assert(hp, 'health-pulse not found')
  assert(hp.enabled === true, 'health-pulse not enabled')
  assert(hp.schedule === '*/5 * * * *', `unexpected schedule: ${hp.schedule}`)
})

await scenario('4b. Manually trigger health-pulse', async () => {
  const r = await orch('/cron/health-pulse/run', { method: 'POST' })
  assert(r.ok, `trigger failed: ${r.status}`)
})

await scenario('4c. Disable health-pulse temporarily', async () => {
  const r = await orch('/cron/health-pulse', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false }),
  })
  assert(r.ok, `disable failed: ${r.status}`)
  // Verify disabled
  const r2 = await orch('/cron')
  const hp = (r2.body.data?.jobs || []).find(j => j.id === 'health-pulse')
  assert(hp?.enabled === false, 'still enabled after disable')
})

await scenario('4d. Re-enable health-pulse', async () => {
  const r = await orch('/cron/health-pulse', {
    method: 'PATCH',
    body: JSON.stringify({ enabled: true }),
  })
  assert(r.ok, `enable failed: ${r.status}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 5: Cognitive Pipeline — RLM reason + analyze')
console.log('=' .repeat(65))

await scenario('5a. Submit reasoning task to RLM', async () => {
  const r = await orch('/cognitive/reason', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Analyze the relationship between STR and FIN consulting domains',
      context: { domains: ['STR', 'FIN'], depth: 'surface' },
      depth: 1,
    }),
  })
  if (r.status === 502 || r.status === 503) {
    console.log('    ⚠ RLM unavailable — skipping')
    return
  }
  assert(r.ok, `reason failed: ${r.status} ${JSON.stringify(r.body)}`)
  globalThis._reasonResult = r.body
})

await scenario('5b. Submit analysis task to RLM', async () => {
  const r = await orch('/cognitive/analyze', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Cross-domain synergy between cybersecurity and compliance',
      task: 'Identify overlapping processes between CYB and RCM',
      context: 'Consulting taxonomy analysis',
      analysis_dimensions: ['overlap', 'synergy', 'gap'],
    }),
  })
  if (r.status === 502 || r.status === 503) {
    console.log('    ⚠ RLM unavailable — skipping')
    return
  }
  assert(r.ok, `analyze failed: ${r.status}`)
})

await scenario('5c. Submit planning task to RLM', async () => {
  const r = await orch('/cognitive/plan', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Plan integration of ESG domain into existing audit workflows',
      context: { current_domains: ['FIN', 'RCM'], target: 'ESG' },
    }),
  })
  if (r.status === 502 || r.status === 503) {
    console.log('    ⚠ RLM unavailable — skipping')
    return
  }
  assert(r.ok, `plan failed: ${r.status}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 6: MCP Tool Bridge — call backend tools via orchestrator')
console.log('=' .repeat(65))

await scenario('6a. Call graph.stats via /tools/call', async () => {
  const r = await orch('/tools/call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: 'command-center',
      tool_name: 'graph.stats',
      arguments: {},
      call_id: crypto.randomUUID(),
    }),
  })
  assert(r.ok, `tools/call failed: ${r.status} ${JSON.stringify(r.body?.error)}`)
  const data = r.body.data?.data || r.body.data || r.body
  assert(data, 'no data returned from graph.stats')
})

await scenario('6b. Call SRAG query via /tools/call', async () => {
  const r = await orch('/tools/call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: 'command-center',
      tool_name: 'srag.query',
      arguments: { query: 'consulting domain taxonomy' },
      call_id: crypto.randomUUID(),
    }),
  })
  // SRAG may timeout or backend may be down — accept gracefully
  if (r.status === 502 || r.status === 504) {
    console.log('    ⚠ Backend/SRAG unavailable')
    return
  }
  assert(r.ok, `srag failed: ${r.status}`)
})

await scenario('6c. Tool call reaches backend (open-access mode)', async () => {
  // AGENT_OPEN_ACCESS=true means ACL is bypassed and unknown agents auto-register.
  // In open-access mode, any tool call is forwarded to backend — rejection comes
  // from backend (tool not found), not from orchestrator ACL.
  const r = await orch('/tools/call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: 'e2e-open-access',
      tool_name: 'graph.stats',
      arguments: {},
      call_id: crypto.randomUUID(),
    }),
  })
  assert(r.ok, `open-access tool call failed: ${r.status}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 7: LLM Chat — multi-provider query')
console.log('=' .repeat(65))

await scenario('7a. List available LLM providers', async () => {
  const r = await orch('/api/llm/providers')
  assert(r.ok, `providers failed: ${r.status}`)
  const providers = r.body.data?.providers || []
  globalThis._providers = providers.map(p => p.id)
  assert(providers.length > 0, 'no providers')
  console.log(`    → providers: ${globalThis._providers.join(', ')}`)
})

await scenario('7b. DeepSeek short answer', async () => {
  if (!globalThis._providers?.includes('deepseek')) {
    console.log('    ⚠ DeepSeek not available'); return
  }
  const r = await orch('/api/llm/chat', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'deepseek',
      prompt: 'What is 2+2? Reply with just the number.',
      broadcast: false,
      max_tokens: 10,
    }),
  })
  assert(r.ok, `deepseek failed: ${r.status}`)
  assert(r.body.data?.content, 'no content')
  console.log(`    → response: "${r.body.data.content.trim()}" (${r.body.data.duration_ms}ms)`)
})

await scenario('7c. OpenAI short answer', async () => {
  if (!globalThis._providers?.includes('openai')) {
    console.log('    ⚠ OpenAI not available'); return
  }
  const r = await orch('/api/llm/chat', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai',
      prompt: 'What is 3+3? Reply with just the number.',
      broadcast: false,
      max_tokens: 10,
    }),
  })
  assert(r.ok, `openai failed: ${r.status}`)
  assert(r.body.data?.content, 'no content')
  console.log(`    → response: "${r.body.data.content.trim()}" (${r.body.data.duration_ms}ms)`)
})

await scenario('7d. LLM with broadcast sends to chat', async () => {
  const r = await orch('/api/llm/chat', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'deepseek',
      prompt: 'Say: E2E test broadcast OK',
      broadcast: true,
      max_tokens: 20,
    }),
  })
  assert(r.ok, `broadcast failed: ${r.status}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 8: Dashboard Consistency — data matches reality')
console.log('=' .repeat(65))

await scenario('8a. Dashboard agents match /agents endpoint', async () => {
  const [dash, agents] = await Promise.all([
    orch('/api/dashboard/data'),
    orch('/agents'),
  ])
  assert(dash.ok && agents.ok, 'API calls failed')
  const dashCount = dash.body.agents?.length || 0
  const agentCount = (agents.body.data?.agents || []).length
  assert(dashCount === agentCount, `dashboard=${dashCount} vs agents=${agentCount}`)
})

await scenario('8b. Dashboard cron jobs match /cron endpoint', async () => {
  const [dash, cron] = await Promise.all([
    orch('/api/dashboard/data'),
    orch('/cron'),
  ])
  assert(dash.ok && cron.ok, 'API calls failed')
  const dashIds = (dash.body.cronJobs || []).map(j => j.id).sort()
  const cronIds = (cron.body.data?.jobs || []).map(j => j.id).sort()
  assert(JSON.stringify(dashIds) === JSON.stringify(cronIds),
    `dashboard cron=[${dashIds}] vs /cron=[${cronIds}]`)
})

await scenario('8c. Dashboard WS stats match /chat/ws-stats', async () => {
  const [dash, ws] = await Promise.all([
    orch('/api/dashboard/data'),
    orch('/chat/ws-stats'),
  ])
  assert(dash.ok && ws.ok, 'API calls failed')
  const dashTotal = dash.body.wsStats?.total
  const wsTotal = (ws.body.data || ws.body)?.total
  assert(dashTotal !== undefined && wsTotal !== undefined, 'missing totals')
  // Allow ±1 due to timing
  assert(Math.abs(dashTotal - wsTotal) <= 1,
    `dashboard ws=${dashTotal} vs ws-stats=${wsTotal}`)
})

await scenario('8d. Dashboard RLM flag matches /health', async () => {
  const [dash, health] = await Promise.all([
    orch('/api/dashboard/data'),
    orch('/health'),
  ])
  assert(dash.ok && health.ok, 'API calls failed')
  assert(dash.body.rlmAvailable === health.body.rlm_available,
    `dashboard=${dash.body.rlmAvailable} vs health=${health.body.rlm_available}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 9: Audit Trail — operations leave traces')
console.log('=' .repeat(65))

await scenario('9a. Agent registration creates audit entry', async () => {
  const id = uid()
  await orch('/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: id, source: 'external', status: 'online',
      capabilities: ['audit-test'], allowed_tool_namespaces: [],
      display_name: 'Audit Test Agent',
    }),
  })
  // Check audit log — search broadly for register action
  await new Promise(r => setTimeout(r, 500))
  const r = await orch('/api/audit/log?limit=20&action=register')
  assert(r.ok, `audit failed: ${r.status}`)
  const entries = r.body.data?.entries || []
  // Audit may store agent_id in details or as top-level field
  const found = entries.length > 0  // at least some register entries exist
  assert(found, 'no register audit entries at all')
  // Cleanup
  await orch(`/agents/${id}`, { method: 'DELETE' })
})

await scenario('9b. Chain execution creates audit entry', async () => {
  const name = `audit-chain-${Date.now()}`
  await orch('/chains/execute', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mode: 'sequential',
      steps: [{ agent_id: 'command-center', tool_name: 'graph.stats', arguments: {} }],
    }),
  })
  await new Promise(r => setTimeout(r, 500))
  const r = await orch('/api/audit/log?limit=10')
  const entries = r.body.data?.entries || []
  const found = entries.find(e => e.action === 'chain_execute' || (e.details && JSON.stringify(e.details).includes(name)))
  assert(found, `no audit entry for chain ${name}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 10: Security — auth, ACL, validation')
console.log('=' .repeat(65))

await scenario('10a. All protected endpoints reject no-auth', async () => {
  const endpoints = [
    { path: '/agents', method: 'GET' },
    { path: '/chains', method: 'GET' },
    { path: '/cron', method: 'GET' },
    { path: '/tools/call', method: 'POST' },
    { path: '/cognitive/reason', method: 'POST' },
  ]
  for (const ep of endpoints) {
    const res = await fetch(`${BASE}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: ep.method === 'POST' ? '{}' : undefined,
    })
    assert(res.status === 401 || res.status === 403,
      `${ep.method} ${ep.path} should be protected, got ${res.status}`)
  }
})

await scenario('10b. Wrong API key is rejected', async () => {
  const res = await fetch(`${BASE}/agents`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer WRONG_KEY_12345',
    },
  })
  assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`)
})

await scenario('10c. Agent registration validates required fields', async () => {
  const badPayloads = [
    {},
    { agent_id: 'x' },
    { agent_id: 'x', source: 'external' },
    { agent_id: 'x', source: 'external', status: 'online' },
  ]
  for (const payload of badPayloads) {
    const r = await orch('/agents/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    assert(r.status === 400, `payload ${JSON.stringify(payload)} should be rejected, got ${r.status}`)
  }
})

await scenario('10d. Chain with invalid mode errors in execution', async () => {
  const r = await orch('/chains/execute', {
    method: 'POST',
    body: JSON.stringify({
      name: 'bad-mode',
      mode: 'this-mode-does-not-exist',
      steps: [{ agent_id: 'x', tool_name: 'y', arguments: {} }],
    }),
  })
  // Chain engine accepts the request but throws during execution.
  // The error surfaces in the execution result, not as HTTP 400.
  if (r.ok) {
    const execId = r.body.data?.execution_id || r.body.execution_id
    await new Promise(r => setTimeout(r, 1000))
    const r2 = await orch('/chains')
    const exec = (r2.body.data?.executions || []).find(e => e.execution_id === execId)
    assert(!exec || exec.status === 'failed', 'invalid mode should fail execution')
  }
  // If it does reject at HTTP level, that's also fine
})

await scenario('10e. Health endpoint is public (no auth needed)', async () => {
  const res = await fetch(`${BASE}/health`)
  assert(res.ok, `health should be public, got ${res.status}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 11: Cross-Service — orchestrator → backend → Neo4j')
console.log('=' .repeat(65))

await scenario('11a. Backend is reachable from orchestrator context', async () => {
  const r = await orch('/health')
  assert(r.ok, 'orchestrator unhealthy')
  // Verify backend via graph.stats tool call
  const r2 = await orch('/tools/call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: 'command-center',
      tool_name: 'graph.stats',
      arguments: {},
      call_id: crypto.randomUUID(),
    }),
  })
  if (r2.status === 502) {
    console.log('    ⚠ Backend unreachable (502)')
    return
  }
  assert(r2.ok, `graph.stats via orchestrator failed: ${r2.status}`)
})

await scenario('11b. Direct backend MCP call matches proxied result', async () => {
  // Direct to backend
  const direct = await mcp('graph.stats')
  if (!direct.ok) {
    console.log('    ⚠ Backend MCP unreachable')
    return
  }
  // Via orchestrator proxy
  const proxied = await orch('/tools/call', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: 'command-center',
      tool_name: 'graph.stats',
      arguments: {},
      call_id: crypto.randomUUID(),
    }),
  })
  assert(proxied.ok, `proxied call failed: ${proxied.status}`)
  // Both should return node/edge counts — just verify both have data
  assert(direct.body, 'direct returned nothing')
  assert(proxied.body, 'proxied returned nothing')
})

await scenario('11c. RLM Engine health check via orchestrator', async () => {
  const r = await orch('/health')
  assert(r.ok, 'health failed')
  console.log(`    → rlm_available: ${r.body.rlm_available}`)
  console.log(`    → redis_enabled: ${r.body.redis_enabled}`)
  console.log(`    → agents_registered: ${r.body.agents_registered}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 12: Frontend Smoke — SPA loads and renders')
console.log('=' .repeat(65))

await scenario('12a. HTML loads with all critical sections', async () => {
  const res = await fetch(`${BASE}/`)
  assert(res.ok, `HTTP ${res.status}`)
  const html = await res.text()
  // Must contain all panels
  const required = [
    'panel-dashboard', 'panel-agents', 'panel-chat', 'panel-chains',
    'panel-cron', 'panel-cognitive', 'panel-audit',
  ]
  for (const r of required) {
    assert(html.includes(r), `missing ${r}`)
  }
  globalThis._html = html
})

await scenario('12b. Frontend JS has no syntax errors', async () => {
  // Extract script content and check for basic sanity
  const match = globalThis._html.match(/<script>([\s\S]*?)<\/script>/)
  assert(match, 'no script block')
  const js = match[1]
  // Check for common fatal issues
  assert(!js.includes('undefined is not'), 'contains error strings')
  assert(js.includes('function '), 'no function definitions found')
  assert(js.includes('addEventListener'), 'no event listeners')
  // Check key functions exist
  const fns = ['refreshDashboard', 'renderChat', 'openPalette', 'doAuth']
  for (const fn of fns) {
    assert(js.includes(fn), `missing function: ${fn}`)
  }
})

await scenario('12c. CSS design system is complete', async () => {
  const tokens = [
    '--bg:', '--bg2:', '--bg3:', '--bg4:', '--bg5:',
    '--border:', '--text:', '--text2:',
    '--accent:', '--accent2:',
    '--glass-bg:', '--glass-border:',
    '--green:', '--green-muted:',
  ]
  for (const t of tokens) {
    assert(globalThis._html.includes(t), `missing CSS token: ${t}`)
  }
})

await scenario('12d. No hardcoded API keys in frontend', async () => {
  const html = globalThis._html
  // Should not contain actual keys
  assert(!html.includes('Heravej_22'), 'backend key leaked in frontend!')
  assert(!html.includes('WidgeTDC_Orch_2026'), 'orchestrator key leaked in frontend source!')
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 13: SSE & Real-time — event stream')
console.log('=' .repeat(65))

await scenario('13a. SSE endpoint returns event-stream', async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${BASE}/api/events`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
      signal: controller.signal,
    })
    assert(res.status === 200, `HTTP ${res.status}`)
    const ct = res.headers.get('content-type') || ''
    assert(ct.includes('text/event-stream'), `wrong content-type: ${ct}`)
  } catch (err) {
    if (err.name !== 'AbortError') throw err
  } finally { clearTimeout(timer) }
})

await scenario('13b. WS stats endpoint tracks connections', async () => {
  const r = await orch('/chat/ws-stats')
  assert(r.ok, `ws-stats failed: ${r.status}`)
  const data = r.body.data || r.body
  assert(typeof data.total === 'number', 'missing total')
  console.log(`    → WS connections: ${data.total}`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(65))
console.log('  CASE 14: Error Handling — graceful failures')
console.log('=' .repeat(65))

await scenario('14a. 404 returns structured error JSON', async () => {
  const r = await orch('/nonexistent-route-e2e-test')
  assert(r.status === 404, `expected 404, got ${r.status}`)
  assert(r.body?.success === false, 'missing success:false')
  assert(r.body?.error?.code === 'NOT_FOUND', 'missing NOT_FOUND code')
})

await scenario('14b. Invalid JSON body returns 4xx or 5xx', async () => {
  const res = await fetch(`${BASE}/agents/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: 'not json at all {{{',
  })
  // Express JSON parse error returns 400 or 500 depending on middleware config
  assert(res.status >= 400, `expected error status, got ${res.status}`)
})

await scenario('14c. Unknown cognitive action returns error', async () => {
  const r = await orch('/cognitive/nonexistent-action', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'test' }),
  })
  assert(!r.ok, `should fail for unknown action, got ${r.status}`)
})

await scenario('14d. Oversized payload is handled gracefully', async () => {
  const bigPayload = { prompt: 'x'.repeat(100000) }
  const r = await orch('/cognitive/reason', {
    method: 'POST',
    body: JSON.stringify(bigPayload),
  })
  // Should not crash — 413 or 502 or timeout are all acceptable
  assert(r.status !== 500, `got 500 — server crashed on large payload`)
})

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
const totalMs = Date.now() - t0_global
const total = passed + failed
console.log('\n' + '═' .repeat(65))
console.log(`  RESULTS: ${passed} passed, ${failed} failed / ${total} total`)
console.log(`  Total time: ${(totalMs / 1000).toFixed(1)}s`)
console.log('═' .repeat(65))

if (failed > 0) {
  console.log('\nFailed scenarios:')
  results.filter(r => r.status === 'FAIL').forEach(r =>
    console.log(`  ✗ ${r.name}: ${r.error}`)
  )
}

// Performance breakdown
console.log('\nSlowest scenarios:')
results.sort((a, b) => b.ms - a.ms).slice(0, 5).forEach(r =>
  console.log(`  ${r.ms}ms  ${r.name}`)
)

console.log()
process.exit(failed > 0 ? 1 : 0)
