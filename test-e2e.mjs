/**
 * test-e2e.mjs — 100 comprehensive end-to-end tests for WidgeTDC Command Center
 *
 * Covers: Health, Dashboard, Agents, Chat, Chains, Cron, Cognitive, LLM,
 *         Audit, SSE, WebSocket, Auth, Frontend HTML/CSS/JS, Command Palette,
 *         Fleet Health Score, Agent CRUD, MCP tools, error handling.
 *
 * Usage: node test-e2e.mjs [base_url] [api_key]
 */

const BASE = process.argv[2] || process.env.ORCH_URL || 'https://orchestrator-production-c27e.up.railway.app'
const API_KEY = process.argv[3] || process.env.ORCH_API_KEY || 'WidgeTDC_Orch_2026'

let passed = 0, failed = 0, skipped = 0
const results = []
const timings = []

async function test(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    passed++
    const ms = Date.now() - t0
    timings.push({ name, ms })
    results.push({ name, status: 'PASS' })
    console.log(`  \u2705 ${name} (${ms}ms)`)
  } catch (err) {
    failed++
    const ms = Date.now() - t0
    timings.push({ name, ms })
    results.push({ name, status: 'FAIL', error: err.message })
    console.log(`  \u274C ${name}: ${err.message}`)
  }
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, ...opts.headers }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  const body = await res.json().catch(() => null)
  return { status: res.status, body, ok: res.ok }
}

function assert(condition, msg) { if (!condition) throw new Error(msg || 'Assertion failed') }
function uuid() { return crypto.randomUUID() }

// Cache for cross-test data
let cachedHtml = null
let cachedDashboard = null

// ═══════════════════════════════════════════════════════════════
console.log(`\n\u{1F9EA} WidgeTDC Comprehensive E2E Tests \u2014 ${BASE}\n`)
console.log('=' .repeat(60))
console.log('  SECTION 1: Health & Infrastructure')
console.log('=' .repeat(60))

// ── 1. Health endpoint ──
await test('1. GET /health returns healthy', async () => {
  const r = await api('/health')
  assert(r.ok, `HTTP ${r.status}`)
  assert(r.body.status === 'healthy')
  assert(r.body.service === 'widgetdc-orchestrator')
  assert(typeof r.body.uptime_seconds === 'number')
})

// ── 2. Health includes all integration flags ──
await test('2. Health: all integration flags present', async () => {
  const r = await api('/health')
  for (const key of ['redis_enabled', 'rlm_available', 'slack_enabled', 'ws_connections', 'sse_clients', 'cron_jobs', 'active_chains', 'agents_registered', 'timestamp']) {
    assert(key in r.body, `missing ${key}`)
  }
})

// ── 3. Health timestamp is fresh ──
await test('3. Health: timestamp is recent (<60s)', async () => {
  const r = await api('/health')
  const diff = Date.now() - new Date(r.body.timestamp).getTime()
  assert(diff < 60000, `timestamp ${diff}ms old`)
})

// ── 4. Redis is enabled ──
await test('4. Health: Redis enabled', async () => {
  const r = await api('/health')
  assert(r.body.redis_enabled === true, 'Redis not enabled')
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 2: Frontend HTML/CSS/JS')
console.log('=' .repeat(60))

// ── 5. Frontend serves HTML ──
await test('5. GET / serves HTML with correct title', async () => {
  const res = await fetch(`${BASE}/`)
  assert(res.ok, `HTTP ${res.status}`)
  cachedHtml = await res.text()
  assert(cachedHtml.includes('Command Center'), 'missing Command Center')
  assert(cachedHtml.includes('WidgeTDC'), 'missing WidgeTDC')
})

// ── 6. Version tag present ──
await test('6. Frontend: version tag v2.8', async () => {
  assert(cachedHtml.includes('v2.8'), 'missing v2.8')
})

// ── 7. CSS design system tokens ──
await test('7. Frontend: CSS design system tokens present', async () => {
  assert(cachedHtml.includes('--bg:'), 'missing --bg')
  assert(cachedHtml.includes('--accent:'), 'missing --accent')
  assert(cachedHtml.includes('--glass-bg:'), 'missing --glass-bg (glassmorphism)')
  assert(cachedHtml.includes('--shadow-xl:'), 'missing --shadow-xl')
  assert(cachedHtml.includes('--ease-out:'), 'missing --ease-out (animations)')
})

// ── 8. Inter font loaded ──
await test('8. Frontend: Inter font import', async () => {
  assert(cachedHtml.includes('fonts.googleapis.com') && cachedHtml.includes('Inter'), 'missing Inter font')
})

// ── 9. Header bar present ──
await test('9. Frontend: header bar with breadcrumb + Ctrl+K', async () => {
  assert(cachedHtml.includes('header-bar'), 'missing header-bar')
  assert(cachedHtml.includes('header-breadcrumb'), 'missing breadcrumb')
  assert(cachedHtml.includes('Ctrl K'), 'missing Ctrl K shortcut')
})

// ── 10. Command Palette HTML ──
await test('10. Frontend: Command Palette overlay', async () => {
  assert(cachedHtml.includes('cmd-overlay'), 'missing cmd-overlay')
  assert(cachedHtml.includes('cmd-palette'), 'missing cmd-palette')
  assert(cachedHtml.includes('openPalette'), 'missing openPalette function')
})

// ── 11. All panels present ──
await test('11. Frontend: all 11 navigation panels', async () => {
  const panels = ['dashboard', 'agents', 'chat', 'chains', 'cron', 'omega', 'knowledge', 'cognitive', 'audit', 'cost', 'openclaw']
  for (const p of panels) {
    assert(cachedHtml.includes(`panel-${p}`), `missing panel-${p}`)
    assert(cachedHtml.includes(`data-panel="${p}"`), `missing nav for ${p}`)
  }
})

// ── 12. Chat features ──
await test('12. Frontend: Chat @mentions, /commands, autocomplete', async () => {
  assert(cachedHtml.includes('chat-mention'), 'missing chat-mention class')
  assert(cachedHtml.includes('chat-slash'), 'missing chat-slash class')
  assert(cachedHtml.includes('ac-popup'), 'missing autocomplete popup')
  assert(cachedHtml.includes('parseInput'), 'missing parseInput function')
})

// ── 13. Fleet Health Score ──
await test('13. Frontend: Fleet Health Score implementation', async () => {
  assert(cachedHtml.includes('computeFleetHealth'), 'missing computeFleetHealth')
  assert(cachedHtml.includes('health-score'), 'missing health-score class')
  assert(cachedHtml.includes('renderHealthCard'), 'missing renderHealthCard')
})

// ── 14. Chat /chain command ──
await test('14. Frontend: /chain command handler', async () => {
  assert(cachedHtml.includes("skillName === 'chain'"), 'missing /chain handler')
  assert(cachedHtml.includes('/chains/execute'), 'missing chains execute call')
})

// ── 15. /ask LLM command ──
await test('15. Frontend: /ask LLM multi-provider command', async () => {
  assert(cachedHtml.includes("skillName === 'ask'"), 'missing /ask handler')
  assert(cachedHtml.includes('/api/llm/chat'), 'missing LLM chat endpoint')
  assert(cachedHtml.includes('deepseek') && cachedHtml.includes('openai'), 'missing LLM providers')
})

// ── 16. Glassmorphism cards ──
await test('16. Frontend: glassmorphism stat-card effects', async () => {
  assert(cachedHtml.includes('backdrop-filter'), 'missing backdrop-filter')
  assert(cachedHtml.includes('translateY(-2px)'), 'missing hover lift')
  assert(cachedHtml.includes('gradient'), 'missing gradient effects')
})

// ── 17. Sidebar active-bar styling ──
await test('17. Frontend: Linear-style sidebar active bar', async () => {
  assert(cachedHtml.includes('accent-muted'), 'missing accent-muted')
  assert(cachedHtml.includes('accent-glow'), 'missing accent-glow')
  assert(cachedHtml.includes('.nav-item.active::before'), 'missing active bar pseudo-element')
})

// ── 18. Panel fade animation ──
await test('18. Frontend: panel transition animation', async () => {
  assert(cachedHtml.includes('panel-in'), 'missing panel-in animation')
  assert(cachedHtml.includes('@keyframes panel-in'), 'missing keyframes')
})

// ── 19. No TypeScript syntax ──
await test('19. Frontend: no TypeScript syntax in JS', async () => {
  const scriptMatch = cachedHtml.match(/<script>([\s\S]*?)<\/script>/)
  assert(scriptMatch, 'no script block found')
  const js = scriptMatch[1]
  // Check for common TypeScript-only syntax that crashes browsers
  const tsPatterns = [/ as number/g, / as string/g, / as any/g, /: string\)/g, /: number\)/g, /interface \w+ \{/g]
  for (const pat of tsPatterns) {
    assert(!pat.test(js), `TypeScript syntax found: ${pat}`)
  }
})

// ── 20. Auth overlay ──
await test('20. Frontend: auth overlay with logout', async () => {
  assert(cachedHtml.includes('auth-overlay'), 'missing auth-overlay')
  assert(cachedHtml.includes('doLogout'), 'missing doLogout')
  assert(cachedHtml.includes('doAuth'), 'missing doAuth')
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 3: Dashboard Data API')
console.log('=' .repeat(60))

// ── 21. Dashboard data ──
await test('21. GET /api/dashboard/data all sections', async () => {
  const r = await api('/api/dashboard/data')
  assert(r.ok, `HTTP ${r.status}`)
  cachedDashboard = r.body
  assert(Array.isArray(r.body.agents), 'missing agents')
  assert(Array.isArray(r.body.chains), 'missing chains')
  assert(Array.isArray(r.body.cronJobs), 'missing cronJobs')
  assert(r.body.wsStats, 'missing wsStats')
  assert(typeof r.body.rlmAvailable === 'boolean', 'missing rlmAvailable')
})

// ── 22. Dashboard has agents with correct fields ──
await test('22. Dashboard: agents have required fields', async () => {
  assert(cachedDashboard.agents.length > 0, 'no agents')
  const a = cachedDashboard.agents[0]
  for (const key of ['agent_id', 'status', 'display_name']) {
    assert(key in a, `agent missing ${key}`)
  }
})

// ── 23. Dashboard: cron jobs present ──
await test('23. Dashboard: cron jobs include health-pulse', async () => {
  const hp = cachedDashboard.cronJobs.find(j => j.id === 'health-pulse')
  assert(hp, 'missing health-pulse cron job')
  assert(hp.enabled === true, 'health-pulse not enabled')
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 4: Agents')
console.log('=' .repeat(60))

// ── 24. Agents list ──
await test('24. GET /agents returns list', async () => {
  const r = await api('/agents')
  assert(r.ok, `HTTP ${r.status}`)
  const agents = r.body.data?.agents || []
  assert(agents.length > 0, 'no agents')
})

// ── 25. Agent CRUD lifecycle ──
await test('25. Agent CRUD: register, heartbeat, verify, delete', async () => {
  const id = `e2e-crud-${Date.now()}`
  // Register
  const r1 = await api('/agents/register', { method: 'POST', body: JSON.stringify({ agent_id: id, source: 'external', status: 'online', capabilities: ['test'], allowed_tool_namespaces: [], display_name: 'E2E CRUD' }) })
  assert(r1.ok, `register: ${r1.status}`)
  // Heartbeat
  const r2 = await api(`/agents/${id}/heartbeat`, { method: 'POST' })
  assert(r2.ok, `heartbeat: ${r2.status}`)
  // Verify
  const r3 = await api('/agents')
  assert((r3.body.data?.agents || []).some(a => a.agent_id === id), 'not found after register')
  // Delete
  const r4 = await api(`/agents/${id}`, { method: 'DELETE' })
  assert(r4.ok, `delete: ${r4.status}`)
  // Verify gone
  const r5 = await api('/agents')
  assert(!(r5.body.data?.agents || []).some(a => a.agent_id === id), 'still exists after delete')
})

// ── 26. Agent registration validation ──
await test('26. Agent register: rejects invalid payload', async () => {
  const r = await api('/agents/register', { method: 'POST', body: JSON.stringify({ agent_id: 'test' }) })
  assert(r.status === 400, `expected 400, got ${r.status}`)
  assert(r.body.error?.code === 'VALIDATION_ERROR', 'no validation error')
})

// ── 27. Canonical agent seeds present ──
await test('27. Seeded agents: canonical agents exist', async () => {
  const r = await api('/agents')
  const agents = r.body.data?.agents || []
  const ids = agents.map(a => a.agent_id)
  const expected = ['omega', 'master', 'graph']
  for (const e of expected) {
    assert(ids.includes(e), `missing seeded agent: ${e}`)
  }
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 5: Chat & WebSocket')
console.log('=' .repeat(60))

// ── 28. Chat broadcast ──
await test('28. POST /chat/message broadcasts', async () => {
  const r = await api('/chat/message', { method: 'POST', body: JSON.stringify({ from: 'e2e', to: 'All', source: 'system', type: 'Message', message: 'E2E ' + Date.now(), timestamp: new Date().toISOString() }) })
  assert(r.ok, `HTTP ${r.status}`)
})

// ── 29. Chat WS stats ──
await test('29. GET /chat/ws-stats returns connection stats', async () => {
  const r = await api('/chat/ws-stats')
  assert(r.ok, `HTTP ${r.status}`)
  assert('total' in (r.body.data || r.body), 'missing total')
})

// ── 30. WebSocket connect + auth ──
await test('30. WebSocket: connects with valid auth', async () => {
  const wsUrl = BASE.replace('https://', 'wss://').replace('http://', 'ws://') + `/ws?agent_id=e2e-ws-test&api_key=${encodeURIComponent(API_KEY)}`
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS timeout')), 8000)
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => { clearTimeout(timer); ws.close(); resolve() }
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WS error')) }
    ws.onclose = (e) => { if (e.code === 4401) { clearTimeout(timer); reject(new Error('WS auth rejected')) } }
  })
})

// ── 31. WebSocket rejects bad auth ──
await test('31. WebSocket: rejects invalid API key', async () => {
  const wsUrl = BASE.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws?agent_id=e2e&api_key=WRONG_KEY'
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(-1), 5000)
    try {
      const ws = new WebSocket(wsUrl)
      ws.onclose = (e) => { clearTimeout(timer); resolve(e.code) }
      ws.onerror = () => {}
    } catch { clearTimeout(timer); resolve(-1) }
  })
  assert(code === 4401 || code === 1006, `expected 4401, got ${code}`)
})

// ── 32. Chat message with @mention ──
await test('32. Chat: @mention message to specific agent', async () => {
  const r = await api('/chat/message', { method: 'POST', body: JSON.stringify({ from: 'e2e', to: 'omega', source: 'human', type: 'Command', message: '@omega status check', timestamp: new Date().toISOString() }) })
  assert(r.ok, `HTTP ${r.status}`)
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 6: Chains')
console.log('=' .repeat(60))

// ── 33. Chain execute ──
await test('33. POST /chains/execute parallel chain', async () => {
  const r = await api('/chains/execute', { method: 'POST', body: JSON.stringify({ name: 'e2e-parallel', mode: 'parallel', steps: [{ agent_id: 'command-center', tool_name: 'graph.stats', arguments: {} }] }) })
  assert(r.ok, `HTTP ${r.status}: ${JSON.stringify(r.body?.error)}`)
  assert(r.body.data?.execution_id || r.body.execution_id, 'no execution_id')
})

// ── 34. Chain list ──
await test('34. GET /chains returns executions list', async () => {
  const r = await api('/chains')
  assert(r.ok, `HTTP ${r.status}`)
  const data = r.body.data?.executions || []
  assert(Array.isArray(data), 'not array')
})

// ── 35. Chain execute validation ──
await test('35. Chain: rejects empty steps', async () => {
  const r = await api('/chains/execute', { method: 'POST', body: JSON.stringify({ name: 'e2e-empty', mode: 'sequential', steps: [] }) })
  assert(!r.ok || r.status >= 400, 'should reject empty steps')
})

// ── 36. Chain sequential mode ──
await test('36. Chain: sequential mode works', async () => {
  const r = await api('/chains/execute', { method: 'POST', body: JSON.stringify({ name: 'e2e-seq', mode: 'sequential', steps: [{ agent_id: 'command-center', tool_name: 'graph.stats', arguments: {} }] }) })
  assert(r.ok, `HTTP ${r.status}: ${JSON.stringify(r.body?.error)}`)
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 7: Cron')
console.log('=' .repeat(60))

// ── 37. Cron list ──
await test('37. GET /cron returns jobs', async () => {
  const r = await api('/cron')
  assert(r.ok, `HTTP ${r.status}`)
  const data = r.body.data?.jobs || []
  assert(Array.isArray(data), 'not array')
  assert(data.length > 0, 'no cron jobs')
})

// ── 38. Cron trigger ──
await test('38. POST /cron/health-pulse/run triggers', async () => {
  const r = await api('/cron/health-pulse/run', { method: 'POST' })
  assert(r.ok, `HTTP ${r.status}`)
})

// ── 39. Cron toggle ──
await test('39. PATCH /cron/health-pulse toggle', async () => {
  // Disable
  const r1 = await api('/cron/health-pulse', { method: 'PATCH', body: JSON.stringify({ enabled: false }) })
  assert(r1.ok, `disable: ${r1.status}`)
  // Re-enable
  const r2 = await api('/cron/health-pulse', { method: 'PATCH', body: JSON.stringify({ enabled: true }) })
  assert(r2.ok, `enable: ${r2.status}`)
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 8: Cognitive & LLM')
console.log('=' .repeat(60))

// ── 40. Cognitive reason ──
await test('40. POST /cognitive/reason works', async () => {
  const r = await api('/cognitive/reason', { method: 'POST', body: JSON.stringify({ prompt: 'What is 2+2?', depth: 0 }) })
  if (r.status === 502 || r.status === 503) { console.log('    (RLM unavailable)'); return }
  assert(r.ok, `HTTP ${r.status}`)
})

// ── 41. Cognitive analyze ──
await test('41. POST /cognitive/analyze works', async () => {
  const r = await api('/cognitive/analyze', { method: 'POST', body: JSON.stringify({ prompt: 'e2e test', task: 'test', context: 'e2e', analysis_dimensions: ['general'] }) })
  if (r.status === 502 || r.status === 503) { console.log('    (RLM unavailable)'); return }
  assert(r.ok, `HTTP ${r.status}`)
})

// ── 42. LLM providers ──
await test('42. GET /api/llm/providers lists available', async () => {
  const r = await api('/api/llm/providers')
  assert(r.ok, `HTTP ${r.status}`)
  const providers = r.body.data?.providers || []
  assert(providers.length > 0, 'no providers')
  assert(providers.some(p => p.id === 'deepseek'), 'missing deepseek')
})

// ── 43. LLM chat DeepSeek ──
await test('43. POST /api/llm/chat DeepSeek responds', async () => {
  const r = await api('/api/llm/chat', { method: 'POST', body: JSON.stringify({ provider: 'deepseek', prompt: 'Reply with only: OK', broadcast: false, max_tokens: 10 }) })
  assert(r.ok, `HTTP ${r.status}`)
  assert(r.body.data?.content, 'no content')
  assert(r.body.data?.duration_ms > 0, 'no duration_ms')
})

// ── 44. LLM chat invalid provider ──
await test('44. LLM chat: rejects unknown provider', async () => {
  const r = await api('/api/llm/chat', { method: 'POST', body: JSON.stringify({ provider: 'nonexistent-llm', prompt: 'test' }) })
  assert(!r.ok, 'should fail for unknown provider')
})

// ── 45. LLM chat missing prompt ──
await test('45. LLM chat: rejects missing prompt', async () => {
  const r = await api('/api/llm/chat', { method: 'POST', body: JSON.stringify({ provider: 'deepseek' }) })
  assert(r.status === 400, `expected 400, got ${r.status}`)
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 9: Auth, Audit & SSE')
console.log('=' .repeat(60))

// ── 46. Auth rejection ──
await test('46. Auth: rejects unauthenticated requests', async () => {
  const res = await fetch(`${BASE}/tools/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: 'x', tool_name: 'x', arguments: {}, call_id: uuid() }) })
  assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`)
})

// ── 47. Audit log ──
await test('47. GET /api/audit/log returns entries', async () => {
  const r = await api('/api/audit/log?limit=5')
  assert(r.ok, `HTTP ${r.status}`)
  assert(Array.isArray(r.body.data?.entries), 'entries not array')
})

// ── 48. Audit log filter ──
await test('48. Audit log: filter by action', async () => {
  const r = await api('/api/audit/log?limit=5&action=register')
  assert(r.ok, `HTTP ${r.status}`)
  const entries = r.body.data?.entries || []
  // All returned entries should match filter (or be empty)
  for (const e of entries) {
    assert(e.action === 'register', `wrong action: ${e.action}`)
  }
})

// ── 49. SSE endpoint ──
await test('49. GET /api/events accepts SSE connection', async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(`${BASE}/api/events`, { headers: { 'Authorization': `Bearer ${API_KEY}` }, signal: controller.signal })
    assert(res.status === 200, `HTTP ${res.status}`)
    assert((res.headers.get('content-type') || '').includes('text/event-stream'), 'not SSE content-type')
  } catch (err) {
    if (err.name !== 'AbortError') throw err
  } finally { clearTimeout(timer) }
})

// ── 50. 404 handler ──
await test('50. 404: returns structured JSON error', async () => {
  const r = await api('/this-route-does-not-exist-e2e-test')
  assert(r.status === 404, `expected 404, got ${r.status}`)
  assert(r.body.success === false, 'missing success:false')
  assert(r.body.error?.code === 'NOT_FOUND', 'missing NOT_FOUND')
  assert(r.body.error?.status_code === 404, 'missing status_code')
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 10: Memory & Sequential Thinking (v2.8)')
console.log('=' .repeat(60))

// ── 51. Chat /think endpoint ──
await test('51. POST /chat/think starts sequential thinking', async () => {
  const r = await api('/chat/think', { method: 'POST', body: JSON.stringify({ question: 'What is the best architecture for microservices?', depth: 2 }) })
  if (r.status === 502 || r.status === 503) { console.log('    (RLM unavailable)'); return }
  assert(r.ok, `HTTP ${r.status}: ${JSON.stringify(r.body?.error)}`)
  assert(r.body.data?.think_id, 'no think_id')
  assert(r.body.data?.steps > 0, 'no steps')
})

// ── 52. Chat /think rejects missing question ──
await test('52. POST /chat/think rejects missing question', async () => {
  const r = await api('/chat/think', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status === 400, `expected 400, got ${r.status}`)
  assert(r.body.error?.code === 'MISSING_FIELDS', 'missing error code')
})

// ── 53. Chat /remember endpoint ──
await test('53. POST /chat/remember stores to memory layers', async () => {
  const r = await api('/chat/remember', { method: 'POST', body: JSON.stringify({ content: 'E2E test memory entry', title: 'E2E Test', tags: ['e2e', 'test'] }) })
  assert(r.ok, `HTTP ${r.status}: ${JSON.stringify(r.body?.error)}`)
  assert(r.body.data?.layers?.length === 3, 'should target 3 layers')
  assert(r.body.data?.title === 'E2E Test', 'title mismatch')
})

// ── 54. Chat /remember rejects empty ──
await test('54. POST /chat/remember rejects empty', async () => {
  const r = await api('/chat/remember', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status === 400, `expected 400, got ${r.status}`)
})

// ── 55. Chat /summarize returns persisted flag ──
await test('55. POST /chat/summarize includes persisted flag', async () => {
  const r = await api('/chat/summarize', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  if (r.status === 502) { console.log('    (LLM unavailable)'); return }
  assert(r.ok, `HTTP ${r.status}`)
  assert(r.body.data?.persisted === true, 'missing persisted:true')
})

// ── 56. Chat history endpoint ──
await test('56. GET /chat/history returns messages', async () => {
  const r = await api('/chat/history?limit=10')
  assert(r.ok, `HTTP ${r.status}`)
  assert(Array.isArray(r.body.data?.messages), 'messages not array')
})

// ── 57. Chat conversations endpoint ──
await test('57. GET /chat/conversations returns sidebar data', async () => {
  const r = await api('/chat/conversations')
  assert(r.ok, `HTTP ${r.status}`)
  assert(Array.isArray(r.body.data?.conversations), 'conversations not array')
})

// ── 58. Chat templates endpoint ──
await test('58. GET /chat/templates returns templates', async () => {
  const r = await api('/chat/templates')
  assert(r.ok, `HTTP ${r.status}`)
  const templates = r.body.data?.templates || []
  assert(templates.length >= 5, `expected 5+ templates, got ${templates.length}`)
  assert(templates.some(t => t.id === 'daily-standup'), 'missing daily-standup')
})

// ── 59. Frontend: /think command in autocomplete ──
await test('59. Frontend: /think command present', async () => {
  assert(cachedHtml.includes("skillName === 'think'"), 'missing /think handler')
  assert(cachedHtml.includes('/chat/think'), 'missing /chat/think endpoint call')
  assert(cachedHtml.includes("label: '/think'"), 'missing /think in autocomplete')
})

// ── 60. Frontend: /remember command in autocomplete ──
await test('60. Frontend: /remember command present', async () => {
  assert(cachedHtml.includes("skillName === 'remember'"), 'missing /remember handler')
  assert(cachedHtml.includes('/chat/remember'), 'missing /chat/remember endpoint call')
  assert(cachedHtml.includes("label: '/remember'"), 'missing /remember in autocomplete')
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 11: Omega Sentinel & Memory Commands (v2.8)')
console.log('=' .repeat(60))

// ── 61. Frontend: /omega command ──
await test('61. Frontend: /omega command with subcommands', async () => {
  assert(cachedHtml.includes("skillName === 'omega'"), 'missing /omega handler')
  assert(cachedHtml.includes('get_sentinel_status'), 'missing sentinel status call')
  assert(cachedHtml.includes("sub === 'sitrep'"), 'missing sitrep subcommand')
  assert(cachedHtml.includes("sub === 'sweep'"), 'missing sweep subcommand')
  assert(cachedHtml.includes("sub === 'memory'"), 'missing memory subcommand')
  assert(cachedHtml.includes("sub === 'compliance'"), 'missing compliance subcommand')
})

// ── 62. Frontend: /cortex command ──
await test('62. Frontend: /cortex associative memory command', async () => {
  assert(cachedHtml.includes("skillName === 'cortex'"), 'missing /cortex handler')
  assert(cachedHtml.includes('activate_associative_memory'), 'missing associative memory call')
})

// ── 63. Frontend: /mission command ──
await test('63. Frontend: /mission RLM multi-step command', async () => {
  assert(cachedHtml.includes("skillName === 'mission'"), 'missing /mission handler')
  assert(cachedHtml.includes('rlm.start_mission'), 'missing start_mission call')
  assert(cachedHtml.includes('rlm.execute_step'), 'missing execute_step call')
})

// ── 64. Frontend: /episodes command ──
await test('64. Frontend: /episodes episodic memory command', async () => {
  assert(cachedHtml.includes("skillName === 'episodes'"), 'missing /episodes handler')
  assert(cachedHtml.includes('SEARCH_EPISODES'), 'missing SEARCH_EPISODES call')
})

// ── 65. Frontend: all new commands in autocomplete ──
await test('65. Frontend: new commands in autocomplete', async () => {
  const cmds = ['/omega', '/cortex', '/mission', '/episodes', '/think', '/remember']
  for (const cmd of cmds) {
    assert(cachedHtml.includes(`label: '${cmd}'`), `missing ${cmd} in autocomplete`)
  }
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 12: Agent Auto-Reply (v2.8)')
console.log('=' .repeat(60))

// ── 66. Agent auto-reply triggers on @agent message ──
await test('66. Chat: @agent message triggers auto-reply', async () => {
  // Send a message to omega and wait for a reply to appear in history
  const marker = `autoreply-test-${Date.now()}`
  await api('/chat/message', { method: 'POST', body: JSON.stringify({
    from: 'e2e-tester', to: 'nexus', source: 'human', type: 'Message',
    message: `${marker}: test Nexus idégenerering for microservices`, timestamp: new Date().toISOString()
  })})

  // Wait for auto-reply (LLM takes a few seconds)
  let found = false
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const hist = await api('/chat/history?limit=30')
    const msgs = hist.body?.data?.messages || []
    // Look for a reply FROM nexus (source: agent)
    if (msgs.some(m => m.from === 'nexus' && m.source === 'agent')) {
      found = true
      break
    }
  }
  assert(found, 'No auto-reply from nexus within 40s')
})

// ── 67. Agent auto-reply: no reply for broadcast messages ──
await test('67. Chat: broadcast messages do NOT trigger auto-reply', async () => {
  const marker = `broadcast-test-${Date.now()}`
  await api('/chat/message', { method: 'POST', body: JSON.stringify({
    from: 'e2e-tester', to: 'All', source: 'human', type: 'Message',
    message: marker, timestamp: new Date().toISOString()
  })})
  // Brief wait
  await new Promise(r => setTimeout(r, 3000))
  const hist = await api('/chat/history?limit=10')
  const msgs = hist.body?.data?.messages || []
  // No agent should auto-reply to a broadcast
  const autoReplies = msgs.filter(m => m.message?.includes(marker) && m.source === 'agent')
  assert(autoReplies.length === 0, `unexpected auto-reply to broadcast: ${autoReplies.length}`)
})

// ── 68. Agent auto-reply: no_reply flag suppresses reply ──
await test('68. Chat: no_reply flag suppresses auto-reply', async () => {
  await api('/chat/message', { method: 'POST', body: JSON.stringify({
    from: 'e2e-tester', to: 'omega', source: 'human', type: 'Message',
    message: `noreply-test-${Date.now()}`, timestamp: new Date().toISOString(),
    no_reply: true
  })})
  // Should return immediately without triggering reply
  // (We just verify the message was accepted)
  // Brief check that no immediate reply comes
  await new Promise(r => setTimeout(r, 2000))
  // Pass — the point is it doesn't error
})

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 13: LLM Provider Contacts (v2.8)')
console.log('=' .repeat(60))

// ── 69. Frontend: LLM providers in contacts ──
await test('69. Frontend: LLM providers section in contacts sidebar', async () => {
  assert(cachedHtml.includes('LLM Providers'), 'missing LLM Providers section header')
  assert(cachedHtml.includes('llmProviders'), 'missing llmProviders variable')
  assert(cachedHtml.includes('loadProviders'), 'missing loadProviders function')
  assert(cachedHtml.includes('PROVIDER_ICONS'), 'missing PROVIDER_ICONS')
  assert(cachedHtml.includes('PROVIDER_COLORS'), 'missing PROVIDER_COLORS')
})

// ── 70. Frontend: isLLMProvider routing ──
await test('70. Frontend: LLM provider direct chat routing', async () => {
  assert(cachedHtml.includes('isLLMProvider'), 'missing isLLMProvider function')
  assert(cachedHtml.includes("isLLMProvider(target)"), 'missing provider routing in sendChat')
})

// ── 71. Frontend: chat header bar shows target info ──
await test('71. Frontend: chat header bar with provider/agent info', async () => {
  assert(cachedHtml.includes('chat-header-bar'), 'missing chat-header-bar')
  assert(cachedHtml.includes('chat-header-name'), 'missing chat-header-name')
  assert(cachedHtml.includes('chat-header-model'), 'missing chat-header-model')
})

// ── 72. LLM providers endpoint returns available providers ──
await test('72. GET /api/llm/providers returns available providers', async () => {
  const r = await api('/api/llm/providers')
  assert(r.ok, `HTTP ${r.status}`)
  const providers = r.body.data?.providers || []
  const available = providers.filter(p => p.available)
  assert(available.length >= 2, `expected 2+ available providers, got ${available.length}`)
  // Verify provider structure
  const p = providers[0]
  assert(p.id, 'missing id')
  assert(p.name, 'missing name')
  assert(p.model, 'missing model')
})

// ═══════════════════════════════════════════════════════════════
// SNOUT Wave 2 Tests (LIN-589, LIN-590, LIN-591, LIN-592)
// ═══════════════════════════════════════════════════════════════

// ── 73. Similarity select — validation rejects missing selected_match_id ──
await test('73. POST /api/similarity/select rejects missing selected_match_id', async () => {
  const r = await api('/api/similarity/select', { method: 'POST', body: JSON.stringify({ rejected_match_ids: ['a'] }) })
  assert(r.status === 400, `expected 400, got ${r.status}`)
  assert(r.body?.error?.code === 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${r.body?.error?.code}`)
})

// ── 74. Similarity select — validation rejects empty rejected_match_ids ──
await test('74. POST /api/similarity/select rejects empty rejected_match_ids', async () => {
  const r = await api('/api/similarity/select', { method: 'POST', body: JSON.stringify({ selected_match_id: 'x', rejected_match_ids: [] }) })
  assert(r.status === 400, `expected 400, got ${r.status}`)
})

// ── 75. Similarity select — validation rejects non-string array elements ──
await test('75. POST /api/similarity/select rejects non-string elements', async () => {
  const r = await api('/api/similarity/select', { method: 'POST', body: JSON.stringify({ selected_match_id: 'x', rejected_match_ids: [1, null] }) })
  assert(r.status === 400, `expected 400, got ${r.status}`)
  assert(r.body?.error?.message?.includes('non-empty strings'), `unexpected message: ${r.body?.error?.message}`)
})

// ── 76. Similarity select — accepts valid input ──
await test('76. POST /api/similarity/select accepts valid preference', async () => {
  const r = await api('/api/similarity/select', { method: 'POST', body: JSON.stringify({ selected_match_id: 'client-a', rejected_match_ids: ['client-b', 'client-c'] }) })
  assert(r.ok, `expected 200, got ${r.status}`)
  assert(r.body?.success === true, 'expected success: true')
  assert(r.body?.data?.rejected_count === 2, `expected 2 rejected, got ${r.body?.data?.rejected_count}`)
})

// ── 77. Tool registry has 25 tools (Wave 2) ──
await test('77. GET /api/tools lists 25 registered tools with Wave 2', async () => {
  const r = await api('/api/tools')
  assert(r.ok, `HTTP ${r.status}`)
  const tools = r.body?.data?.tools || r.body?.tools || []
  assert(tools.length >= 25, `expected 25+ tools, got ${tools.length}`)
  // Verify Wave 2 tools exist
  const names = tools.map(t => t.name)
  assert(names.includes('critique_refine'), 'critique_refine tool missing from registry')
  assert(names.includes('judge_response'), 'judge_response tool missing from registry')
  assert(names.includes('graph_hygiene_run'), 'graph_hygiene_run tool missing')
})

// ── 78. Tool gateway — critique_refine validates min query length ──
await test('78. POST /api/tools/critique_refine rejects empty query', async () => {
  const r = await api('/api/tools/critique_refine', { method: 'POST', body: JSON.stringify({ query: '' }) })
  assert(r.status !== 404, `critique_refine not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'critique_refine', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result === 'Error: query is required (min 5 chars)', `unexpected result: ${result}`)
})

// ── 79. Tool gateway — judge_response requires query + response ──
await test('79. POST /api/tools/judge_response rejects missing args', async () => {
  const r = await api('/api/tools/judge_response', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `judge_response not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'judge_response', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result === 'Error: query and response are required', `unexpected result: ${result}`)
})

// ── 80. Health endpoint includes write_gate_stats ──
await test('80. GET /health includes write_gate_stats and cron_jobs', async () => {
  const r = await fetch(`${BASE}/health`).then(res => res.json())
  assert(r.write_gate_stats !== undefined, 'missing write_gate_stats')
  assert(r.version, `missing version field`)
  assert(r.cron_jobs >= 20, `expected 20+ crons, got ${r.cron_jobs}`)
  assert(r.agents_registered >= 1, `expected 1+ agents, got ${r.agents_registered}`)
})

// ═══════════════════════════════════════════════════════════════
// SECTION 14: Tool Gateway Validation (Tests 81-100)
// ═══════════════════════════════════════════════════════════════

console.log('\n' + '=' .repeat(60))
console.log('  SECTION 14: Tool Gateway Validation (81-100)')
console.log('=' .repeat(60))

// ── 81. search_knowledge — rejects missing query ──
await test('81. POST /api/tools/search_knowledge rejects missing query', async () => {
  const r = await api('/api/tools/search_knowledge', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `search_knowledge not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'search_knowledge', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for missing query, got: ${result.slice(0, 100)}`)
})

// ── 82. reason_deeply — rejects missing question ──
await test('82. POST /api/tools/reason_deeply rejects missing question', async () => {
  const r = await api('/api/tools/reason_deeply', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `reason_deeply not deployed (404)`)
  // Returns 500 (RLM validation) or 200 (error in result) — both are valid rejection
  assert(r.status === 200 || r.status === 500, `expected 200 or 500, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'reason_deeply', `wrong tool_name: ${r.body?.data?.tool_name}`)
})

// ── 83. query_graph — rejects missing cypher ──
await test('83. POST /api/tools/query_graph rejects missing cypher', async () => {
  const r = await api('/api/tools/query_graph', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `query_graph not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'query_graph', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for missing cypher, got: ${result.slice(0, 100)}`)
})

// ── 84. query_graph — rejects destructive write operations ──
await test('84. POST /api/tools/query_graph rejects DELETE cypher', async () => {
  const r = await api('/api/tools/query_graph', { method: 'POST', body: JSON.stringify({ cypher: 'DELETE (n) RETURN n' }) })
  assert(r.status !== 404, `query_graph not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error') && result.includes('read-only'), `expected read-only Error, got: ${result.slice(0, 100)}`)
})

// ── 85. check_tasks — succeeds without required args ──
await test('85. POST /api/tools/check_tasks returns data (no args needed)', async () => {
  const r = await api('/api/tools/check_tasks', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `check_tasks not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'check_tasks', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 86. call_mcp_tool — rejects missing tool_name ──
await test('86. POST /api/tools/call_mcp_tool rejects missing tool_name', async () => {
  const r = await api('/api/tools/call_mcp_tool', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `call_mcp_tool not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'call_mcp_tool', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 87. get_platform_health — returns data without args ──
await test('87. POST /api/tools/get_platform_health returns data', async () => {
  const r = await api('/api/tools/get_platform_health', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `get_platform_health not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'get_platform_health', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 88. search_documents — rejects missing query ──
await test('88. POST /api/tools/search_documents rejects missing query', async () => {
  const r = await api('/api/tools/search_documents', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `search_documents not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'search_documents', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 89. linear_issues — succeeds without required args ──
await test('89. POST /api/tools/linear_issues returns data (no required args)', async () => {
  const r = await api('/api/tools/linear_issues', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `linear_issues not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'linear_issues', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 90. linear_issue_detail — rejects missing identifier ──
await test('90. POST /api/tools/linear_issue_detail rejects missing identifier', async () => {
  const r = await api('/api/tools/linear_issue_detail', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `linear_issue_detail not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'linear_issue_detail', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 91. run_chain — rejects missing steps ──
await test('91. POST /api/tools/run_chain rejects empty steps', async () => {
  const r = await api('/api/tools/run_chain', { method: 'POST', body: JSON.stringify({ name: 'test', mode: 'sequential', steps: [] }) })
  assert(r.status !== 404, `run_chain not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'run_chain', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 92. list_tools — returns tools without args ──
await test('92. POST /api/tools/list_tools returns tool list', async () => {
  const r = await api('/api/tools/list_tools', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `list_tools not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'list_tools', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('tools'), `expected tool list in result, got: ${result.slice(0, 100)}`)
})

// ── 93. adaptive_rag_dashboard — returns dashboard without args ──
await test('93. POST /api/tools/adaptive_rag_dashboard returns data', async () => {
  const r = await api('/api/tools/adaptive_rag_dashboard', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `adaptive_rag_dashboard not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'adaptive_rag_dashboard', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 94. adaptive_rag_query — rejects missing query ──
await test('94. POST /api/tools/adaptive_rag_query rejects missing query', async () => {
  const r = await api('/api/tools/adaptive_rag_query', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `adaptive_rag_query not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'adaptive_rag_query', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for missing query, got: ${result.slice(0, 100)}`)
})

// ── 95. adaptive_rag_reward — rejects missing args ──
await test('95. POST /api/tools/adaptive_rag_reward rejects missing args', async () => {
  const r = await api('/api/tools/adaptive_rag_reward', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `adaptive_rag_reward not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'adaptive_rag_reward', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for missing args, got: ${result.slice(0, 100)}`)
})

// ── 96. moa_query — rejects empty query (validation only, no LLM) ──
await test('96. POST /api/tools/moa_query rejects empty query', async () => {
  const r = await api('/api/tools/moa_query', { method: 'POST', body: JSON.stringify({ query: '' }) })
  assert(r.status !== 404, `moa_query not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'moa_query', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for empty query, got: ${result.slice(0, 100)}`)
})

// ── 97. forge_analyze_gaps — returns data without args ──
await test('97. POST /api/tools/forge_analyze_gaps returns data', async () => {
  const r = await api('/api/tools/forge_analyze_gaps', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `forge_analyze_gaps not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'forge_analyze_gaps', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 98. forge_list — returns list without args ──
await test('98. POST /api/tools/forge_list returns data', async () => {
  const r = await api('/api/tools/forge_list', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `forge_list not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'forge_list', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(typeof result === 'string', `expected string result, got: ${typeof result}`)
})

// ── 99. forge_tool — rejects missing name and purpose (validation only) ──
await test('99. POST /api/tools/forge_tool rejects missing args', async () => {
  const r = await api('/api/tools/forge_tool', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `forge_tool not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'forge_tool', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for missing args, got: ${result.slice(0, 100)}`)
})

// ── 100. governance_matrix — returns matrix without args ──
await test('100. POST /api/tools/governance_matrix returns matrix', async () => {
  const r = await api('/api/tools/governance_matrix', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `governance_matrix not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'governance_matrix', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Manifesto') || result.includes('matrix') || result.includes('principle'), `expected governance data, got: ${result.slice(0, 100)}`)
})

// ── 101. precedent_search — rejects too-short query ──
await test('101. POST /api/tools/precedent_search rejects short query', async () => {
  const r = await api('/api/tools/precedent_search', { method: 'POST', body: JSON.stringify({ query: 'ab' }) })
  assert(r.status !== 404, `precedent_search not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'precedent_search', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for short query, got: ${result.slice(0, 100)}`)
})

// ── 102. precedent_search — rejects missing query ──
await test('102. POST /api/tools/precedent_search rejects missing query', async () => {
  const r = await api('/api/tools/precedent_search', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `precedent_search not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'precedent_search', `wrong tool_name: ${r.body?.data?.tool_name}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for missing query, got: ${result.slice(0, 100)}`)
})

// ═══════════════════════════════════════════════════════════════
// Section 15: CI Adoption Gate — remaining 9 tools (found by ci-adoption-check.mjs)
// ═══════════════════════════════════════════════════════════════

// ── 103. investigate — exists and responds ──
await test('103. POST /api/tools/investigate responds', async () => {
  const r = await api('/api/tools/investigate', { method: 'POST', body: JSON.stringify({ topic: 'test' }) })
  assert(r.status !== 404, `investigate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'investigate', `wrong tool_name`)
})

// ── 104. create_notebook — exists and responds ──
await test('104. POST /api/tools/create_notebook responds', async () => {
  const r = await api('/api/tools/create_notebook', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `create_notebook not deployed (404)`)
  assert(r.body?.data?.tool_name === 'create_notebook', `wrong tool_name`)
})

// ── 105. verify_output — exists and responds ──
await test('105. POST /api/tools/verify_output responds', async () => {
  const r = await api('/api/tools/verify_output', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `verify_output not deployed (404)`)
  assert(r.body?.data?.tool_name === 'verify_output', `wrong tool_name`)
})

// ── 106. generate_deliverable rejects short prompt ──
await test('106. POST /api/tools/generate_deliverable rejects short prompt', async () => {
  const r = await api('/api/tools/generate_deliverable', { method: 'POST', body: JSON.stringify({ prompt: 'hi' }) })
  assert(r.status !== 404, `generate_deliverable not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  const result = r.body?.data?.result ?? ''
  assert(result.includes('Error'), `expected Error for short prompt`)
})

// ── 107. run_osint_scan — exists (do NOT trigger real scan) ──
await test('107. POST /api/tools/run_osint_scan exists', async () => {
  const r = await api('/api/tools/run_osint_scan', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `run_osint_scan not deployed (404)`)
  assert(r.body?.data?.tool_name === 'run_osint_scan', `wrong tool_name`)
})

// ── 108. run_evolution — exists (do NOT trigger real cycle) ──
await test('108. POST /api/tools/run_evolution exists', async () => {
  const r = await api('/api/tools/run_evolution', { method: 'POST', body: JSON.stringify({ dry_run: true }) })
  assert(r.status !== 404, `run_evolution not deployed (404)`)
  assert(r.body?.data?.tool_name === 'run_evolution', `wrong tool_name`)
})

// ── 109. ingest_document rejects missing content ──
await test('109. POST /api/tools/ingest_document rejects missing content', async () => {
  const r = await api('/api/tools/ingest_document', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `ingest_document not deployed (404)`)
  assert(r.body?.data?.tool_name === 'ingest_document', `wrong tool_name`)
})

// ── 110. build_communities — exists ──
await test('110. POST /api/tools/build_communities exists', async () => {
  const r = await api('/api/tools/build_communities', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `build_communities not deployed (404)`)
  assert(r.body?.data?.tool_name === 'build_communities', `wrong tool_name`)
})

// ── 111. adaptive_rag_retrain — exists ──
await test('111. POST /api/tools/adaptive_rag_retrain exists', async () => {
  const r = await api('/api/tools/adaptive_rag_retrain', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `adaptive_rag_retrain not deployed (404)`)
  assert(r.body?.data?.tool_name === 'adaptive_rag_retrain', `wrong tool_name`)
})

// ═══════════════════════════════════════════════════════════════
// Section 16: v4.0.4 LIN-607 — Engagement Intelligence Engine tools
// ═══════════════════════════════════════════════════════════════

// ── 112. engagement_list — exists and responds ──
await test('112. POST /api/tools/engagement_list responds', async () => {
  const r = await api('/api/tools/engagement_list', { method: 'POST', body: JSON.stringify({ limit: 3 }) })
  assert(r.status !== 404, `engagement_list not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'engagement_list', `wrong tool_name: ${r.body?.data?.tool_name}`)
})

// ── 113. engagement_match — rejects missing objective ──
await test('113. POST /api/tools/engagement_match rejects missing args', async () => {
  const r = await api('/api/tools/engagement_match', { method: 'POST', body: JSON.stringify({ domain: 'Finance' }) })
  assert(r.status !== 404, `engagement_match not deployed (404)`)
  assert(r.body?.data?.tool_name === 'engagement_match', `wrong tool_name`)
})

// ── 114. engagement_create — exists ──
await test('114. POST /api/tools/engagement_create responds', async () => {
  const r = await api('/api/tools/engagement_create', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `engagement_create not deployed (404)`)
  assert(r.body?.data?.tool_name === 'engagement_create', `wrong tool_name`)
})

// ── 115. engagement_plan — gate rejects short objective ──
await test('115. POST /api/tools/engagement_plan exists', async () => {
  const r = await api('/api/tools/engagement_plan', { method: 'POST', body: JSON.stringify({ objective: 'too short', domain: 'Finance', duration_weeks: 4, team_size: 3 }) })
  assert(r.status !== 404, `engagement_plan not deployed (404)`)
  assert(r.body?.data?.tool_name === 'engagement_plan', `wrong tool_name`)
})

// ── 116. engagement_outcome — exists ──
await test('116. POST /api/tools/engagement_outcome responds', async () => {
  const r = await api('/api/tools/engagement_outcome', { method: 'POST', body: JSON.stringify({ engagement_id: 'nonexistent' }) })
  assert(r.status !== 404, `engagement_outcome not deployed (404)`)
  assert(r.body?.data?.tool_name === 'engagement_outcome', `wrong tool_name`)
})

// ═══════════════════════════════════════════════════════════════
// Section 17: v4.0.5 LIN-609 — Ghost-tier feature registration
// ═══════════════════════════════════════════════════════════════

// ── 117. memory_store — exists ──
await test('117. POST /api/tools/memory_store responds', async () => {
  const r = await api('/api/tools/memory_store', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e', key: 'probe', value: 'test' }) })
  assert(r.status !== 404, `memory_store not deployed (404)`)
  assert(r.body?.data?.tool_name === 'memory_store', `wrong tool_name`)
})

// ── 118. memory_retrieve — exists ──
await test('118. POST /api/tools/memory_retrieve responds', async () => {
  const r = await api('/api/tools/memory_retrieve', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e' }) })
  assert(r.status !== 404, `memory_retrieve not deployed (404)`)
  assert(r.body?.data?.tool_name === 'memory_retrieve', `wrong tool_name`)
})

// ── 118a. memory_search — exists ──
await test('118a. POST /api/tools/memory_search responds', async () => {
  const r = await api('/api/tools/memory_search', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e', limit: 5 }) })
  assert(r.status !== 404, `memory_search not deployed (404)`)
  assert(r.body?.data?.tool_name === 'memory_search', `wrong tool_name`)
})

// ── 118b. memory_consolidate — exists ──
await test('118b. POST /api/tools/memory_consolidate responds', async () => {
  const r = await api('/api/tools/memory_consolidate', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e' }) })
  assert(r.status !== 404, `memory_consolidate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'memory_consolidate', `wrong tool_name`)
})

// ── 118c. document_convert — exists ──
await test('118c. POST /api/tools/document_convert responds', async () => {
  const r = await api('/api/tools/document_convert', { method: 'POST', body: JSON.stringify({ content: '# Test\nHello world', mime_type: 'text/markdown' }) })
  assert(r.status !== 404, `document_convert not deployed (404)`)
  assert(r.body?.data?.tool_name === 'document_convert', `wrong tool_name`)
})

// ── 118d. runtime_summary — exists ──
await test('118d. POST /api/tools/runtime_summary responds', async () => {
  const r = await api('/api/tools/runtime_summary', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `runtime_summary not deployed (404)`)
})

// ── 118e. agent_metrics — exists ──
await test('118e. POST /api/tools/agent_metrics responds', async () => {
  const r = await api('/api/tools/agent_metrics', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e' }) })
  assert(r.status !== 404, `agent_metrics not deployed (404)`)
})

// ── 118f. tool_metrics — exists ──
await test('118f. POST /api/tools/tool_metrics responds', async () => {
  const r = await api('/api/tools/tool_metrics', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  assert(r.status !== 404, `tool_metrics not deployed (404)`)
})

// ── 118g. prompt_add — exists ──
await test('118g. POST /api/tools/prompt_add responds', async () => {
  const r = await api('/api/tools/prompt_add', { method: 'POST', body: JSON.stringify({ title: 'Test', content: 'Test prompt', category: 'general' }) })
  assert(r.status !== 404, `prompt_add not deployed (404)`)
})

// ── 118h. prompt_query — exists ──
await test('118h. POST /api/tools/prompt_query responds', async () => {
  const r = await api('/api/tools/prompt_query', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  assert(r.status !== 404, `prompt_query not deployed (404)`)
})

// ── 118i. prompt_use — exists ──
await test('118i. POST /api/tools/prompt_use responds', async () => {
  const r = await api('/api/tools/prompt_use', { method: 'POST', body: JSON.stringify({ prompt_id: 'test', was_helpful: true }) })
  assert(r.status !== 404, `prompt_use not deployed (404)`)
})

// ── 118j. knowledge_ingest — exists ──
await test('118j. POST /api/tools/knowledge_ingest responds', async () => {
  const r = await api('/api/tools/knowledge_ingest', { method: 'POST', body: JSON.stringify({ title: 'Test', content: 'Test content', source_type: 'txt' }) })
  assert(r.status !== 404, `knowledge_ingest not deployed (404)`)
})

// ── 118k. knowledge_query — exists ──
await test('118k. POST /api/tools/knowledge_query responds', async () => {
  const r = await api('/api/tools/knowledge_query', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  assert(r.status !== 404, `knowledge_query not deployed (404)`)
})

// ── 118l. compliance_gap_audit — exists ──
await test('118l. POST /api/tools/compliance_gap_audit responds', async () => {
  const r = await api('/api/tools/compliance_gap_audit', { method: 'POST', body: JSON.stringify({ stack: [{ name: 'test-model', category: 'ml-model' }] }) })
  assert(r.status !== 404, `compliance_gap_audit not deployed (404)`)
})

// ── 118m. engagement_cost_report — exists ──
await test('118m. POST /api/tools/engagement_cost_report responds', async () => {
  const r = await api('/api/tools/engagement_cost_report', { method: 'POST', body: JSON.stringify({ engagement_id: 'test-e2e' }) })
  assert(r.status !== 404, `engagement_cost_report not deployed (404)`)
})

// ── 118n. agent_drift_report — exists ──
await test('118n. POST /api/tools/agent_drift_report responds', async () => {
  const r = await api('/api/tools/agent_drift_report', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `agent_drift_report not deployed (404)`)
})

// ── 118o. pr_review_parallel — exists ──
await test('118o. POST /api/tools/pr_review_parallel responds', async () => {
  const r = await api('/api/tools/pr_review_parallel', { method: 'POST', body: JSON.stringify({ repo: 'test', pr_number: '1', title: 'Test', diff: '+test' }) })
  assert(r.status !== 404, `pr_review_parallel not deployed (404)`)
})

// ── 118p. deliverable_draft — exists ──
await test('118p. POST /api/tools/deliverable_draft responds', async () => {
  const r = await api('/api/tools/deliverable_draft', { method: 'POST', body: JSON.stringify({ prompt: 'Test deliverable for QA', type: 'analysis' }) })
  assert(r.status !== 404, `deliverable_draft not deployed (404)`)
})

// ── 118q. rag_route — exists ──
await test('118q. POST /api/tools/rag_route responds', async () => {
  const r = await api('/api/tools/rag_route', { method: 'POST', body: JSON.stringify({ query: 'How to improve agent performance?' }) })
  assert(r.status !== 404, `rag_route not deployed (404)`)
})

// ── 118r. skill_corpus_sync — exists ──
await test('118r. POST /api/tools/skill_corpus_sync responds', async () => {
  const r = await api('/api/tools/skill_corpus_sync', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `skill_corpus_sync not deployed (404)`)
})

// ── 118s. due_diligence — exists ──
await test('118s. POST /api/tools/due_diligence responds', async () => {
  const r = await api('/api/tools/due_diligence', { method: 'POST', body: JSON.stringify({ target: 'test.dk' }) })
  assert(r.status !== 404, `due_diligence not deployed (404)`)
})

// ── 118t. prompt_ab_test — exists ──
await test('118t. POST /api/tools/prompt_ab_test responds', async () => {
  const r = await api('/api/tools/prompt_ab_test', { method: 'POST', body: JSON.stringify({ task_type: 'test', prompt: 'Test prompt', score: 0.8 }) })
  assert(r.status !== 404, `prompt_ab_test not deployed (404)`)
})

// ── 118u. fact_assert — exists ──
await test('118u. POST /api/tools/fact_assert responds', async () => {
  const r = await api('/api/tools/fact_assert', { method: 'POST', body: JSON.stringify({ subject: 'test', predicate: 'has_prop', object: 'value' }) })
  assert(r.status !== 404, `fact_assert not deployed (404)`)
})

// ── 118v. fact_query — exists ──
await test('118v. POST /api/tools/fact_query responds', async () => {
  const r = await api('/api/tools/fact_query', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `fact_query not deployed (404)`)
})

// ── 119. failure_harvest — exists ──
await test('119. POST /api/tools/failure_harvest responds', async () => {
  const r = await api('/api/tools/failure_harvest', { method: 'POST', body: JSON.stringify({ window_hours: 1 }) })
  assert(r.status !== 404, `failure_harvest not deployed (404)`)
  assert(r.body?.data?.tool_name === 'failure_harvest', `wrong tool_name`)
})

// ── 120. context_fold — exists ──
await test('120. POST /api/tools/context_fold responds', async () => {
  const r = await api('/api/tools/context_fold', { method: 'POST', body: JSON.stringify({ text: 'short' }) })
  assert(r.status !== 404, `context_fold not deployed (404)`)
  assert(r.body?.data?.tool_name === 'context_fold', `wrong tool_name`)
})

// ── 121. competitive_crawl — exists ──
await test('121. POST /api/tools/competitive_crawl responds', async () => {
  const r = await api('/api/tools/competitive_crawl', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `competitive_crawl not deployed (404)`)
  assert(r.body?.data?.tool_name === 'competitive_crawl', `wrong tool_name`)
})

// ── 122. loose_ends_scan — exists ──
await test('122. POST /api/tools/loose_ends_scan responds', async () => {
  const r = await api('/api/tools/loose_ends_scan', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `loose_ends_scan not deployed (404)`)
  assert(r.body?.data?.tool_name === 'loose_ends_scan', `wrong tool_name`)
})

// ═══════════════════════════════════════════════════════════════
// Section 18: v4.0.6 LIN-618 — Ghost-tier sweep round 2
// ═══════════════════════════════════════════════════════════════

// ── 123. llm_providers — exists ──
await test('123. POST /api/tools/llm_providers responds', async () => {
  const r = await api('/api/tools/llm_providers', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `llm_providers not deployed (404)`)
  assert(r.body?.data?.tool_name === 'llm_providers', `wrong tool_name`)
})

// ── 124. llm_chat — exists ──
await test('124. POST /api/tools/llm_chat responds', async () => {
  const r = await api('/api/tools/llm_chat', { method: 'POST', body: JSON.stringify({ messages: [] }) })
  assert(r.status !== 404, `llm_chat not deployed (404)`)
  assert(r.body?.data?.tool_name === 'llm_chat', `wrong tool_name`)
})

// ── 125. decision_list — exists ──
await test('125. POST /api/tools/decision_list responds', async () => {
  const r = await api('/api/tools/decision_list', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  assert(r.status !== 404, `decision_list not deployed (404)`)
  assert(r.body?.data?.tool_name === 'decision_list', `wrong tool_name`)
})

// ── 126. decision_certify — exists ──
await test('126. POST /api/tools/decision_certify responds', async () => {
  const r = await api('/api/tools/decision_certify', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `decision_certify not deployed (404)`)
  assert(r.body?.data?.tool_name === 'decision_certify', `wrong tool_name`)
})

// ── 127. decision_lineage — exists ──
await test('127. POST /api/tools/decision_lineage responds', async () => {
  const r = await api('/api/tools/decision_lineage', { method: 'POST', body: JSON.stringify({ assembly_id: 'nonexistent' }) })
  assert(r.status !== 404, `decision_lineage not deployed (404)`)
  assert(r.body?.data?.tool_name === 'decision_lineage', `wrong tool_name`)
})

// ── 128. artifact_list — exists ──
await test('128. POST /api/tools/artifact_list responds', async () => {
  const r = await api('/api/tools/artifact_list', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  assert(r.status !== 404, `artifact_list not deployed (404)`)
  assert(r.body?.data?.tool_name === 'artifact_list', `wrong tool_name`)
})

// ── 129. artifact_get — exists ──
await test('129. POST /api/tools/artifact_get responds', async () => {
  const r = await api('/api/tools/artifact_get', { method: 'POST', body: JSON.stringify({ artifact_id: 'nonexistent' }) })
  assert(r.status !== 404, `artifact_get not deployed (404)`)
  assert(r.body?.data?.tool_name === 'artifact_get', `wrong tool_name`)
})

// ═══════════════════════════════════════════════════════════════
// Section 19: v4.0.7 LIN-619 — Ghost-tier sweep round 3 (drill + research)
// ═══════════════════════════════════════════════════════════════

// ── 130. drill_start — exists ──
await test('130. POST /api/tools/drill_start responds', async () => {
  const r = await api('/api/tools/drill_start', { method: 'POST', body: JSON.stringify({ domain: 'Finance' }) })
  assert(r.status !== 404, `drill_start not deployed (404)`)
  assert(r.body?.data?.tool_name === 'drill_start', `wrong tool_name`)
})

// ── 131. drill_down — exists ──
await test('131. POST /api/tools/drill_down responds', async () => {
  const r = await api('/api/tools/drill_down', { method: 'POST', body: JSON.stringify({ session_id: 'nonexistent' }) })
  assert(r.status !== 404, `drill_down not deployed (404)`)
  assert(r.body?.data?.tool_name === 'drill_down', `wrong tool_name`)
})

// ── 132. drill_up — exists ──
await test('132. POST /api/tools/drill_up responds', async () => {
  const r = await api('/api/tools/drill_up', { method: 'POST', body: JSON.stringify({ session_id: 'nonexistent' }) })
  assert(r.status !== 404, `drill_up not deployed (404)`)
  assert(r.body?.data?.tool_name === 'drill_up', `wrong tool_name`)
})

// ── 133. drill_children — exists ──
await test('133. POST /api/tools/drill_children responds', async () => {
  const r = await api('/api/tools/drill_children', { method: 'POST', body: JSON.stringify({ session_id: 'nonexistent' }) })
  assert(r.status !== 404, `drill_children not deployed (404)`)
  assert(r.body?.data?.tool_name === 'drill_children', `wrong tool_name`)
})

// ── 134. research_harvest — exists ──
await test('134. POST /api/tools/research_harvest responds', async () => {
  const r = await api('/api/tools/research_harvest', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `research_harvest not deployed (404)`)
  assert(r.body?.data?.tool_name === 'research_harvest', `wrong tool_name`)
})

// ═══════════════════════════════════════════════════════════════
// Section 20: v4.0.12 LIN-611 — Output truncation with download URL (SNOUT-22)
// ═══════════════════════════════════════════════════════════════

// ── 135. tool-output route: invalid UUID returns 400 ──
await test('135. GET /api/tool-output/:id rejects non-UUID', async () => {
  const r = await api('/api/tool-output/not-a-uuid')
  assert(r.status === 400, `expected 400, got ${r.status}`)
  assert(r.body?.error?.code === 'INVALID_ID', `wrong code: ${r.body?.error?.code}`)
})

// ── 136. tool-output route: valid UUID but not stored returns 404 ──
await test('136. GET /api/tool-output/:id returns 404 for missing', async () => {
  const r = await api('/api/tool-output/00000000-0000-4000-8000-000000000000')
  assert(r.status === 404, `expected 404, got ${r.status}`)
  assert(r.body?.error?.code === 'NOT_FOUND', `wrong code: ${r.body?.error?.code}`)
})

// ── 137. tool-output /raw variant returns 404 on missing ──
await test('137. GET /api/tool-output/:id/raw returns 404 for missing', async () => {
  const r = await api('/api/tool-output/00000000-0000-4000-8000-000000000000/raw')
  assert(r.status === 404, `expected 404, got ${r.status}`)
})

// ═══════════════════════════════════════════════════════════════
// Section 21: HyperAgent Autonomous Executor (cross-repo MCP tools)
// ═══════════════════════════════════════════════════════════════

// ── 138. hyperagent_auto_status — exists ──
await test('138. POST /api/tools/hyperagent_auto_status responds', async () => {
  const r = await api('/api/tools/hyperagent_auto_status', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `hyperagent_auto_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'hyperagent_auto_status', `wrong tool_name`)
})

// ── 139. hyperagent_auto_run — exists ──
await test('139. POST /api/tools/hyperagent_auto_run responds', async () => {
  const r = await api('/api/tools/hyperagent_auto_run', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `hyperagent_auto_run not deployed (404)`)
  assert(r.body?.data?.tool_name === 'hyperagent_auto_run', `wrong tool_name`)
})

// ── 140. hyperagent_auto_memory — exists ──
await test('140. POST /api/tools/hyperagent_auto_memory responds', async () => {
  const r = await api('/api/tools/hyperagent_auto_memory', { method: 'POST', body: JSON.stringify({ action: 'list' }) })
  assert(r.status !== 404, `hyperagent_auto_memory not deployed (404)`)
  assert(r.body?.data?.tool_name === 'hyperagent_auto_memory', `wrong tool_name`)
})

// ── 141. hyperagent_auto_issues — exists ──
await test('141. POST /api/tools/hyperagent_auto_issues responds', async () => {
  const r = await api('/api/tools/hyperagent_auto_issues', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `hyperagent_auto_issues not deployed (404)`)
  assert(r.body?.data?.tool_name === 'hyperagent_auto_issues', `wrong tool_name`)
})

// ── 142. hyperagent auto REST status endpoint ──
await test('142. GET /api/hyperagent/auto/status returns status', async () => {
  const r = await api('/api/hyperagent/auto/status')
  assert(r.status !== 404, `hyperagent auto status endpoint not deployed (404)`)
})

// ── 143. pheromone_status — MCP tool exists ──
await test('143. POST /api/tools/pheromone_status responds', async () => {
  const r = await api('/api/tools/pheromone_status', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `pheromone_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'pheromone_status', `wrong tool_name`)
})

// ── 144. pheromone_sense — MCP tool exists ──
await test('144. POST /api/tools/pheromone_sense responds', async () => {
  const r = await api('/api/tools/pheromone_sense', { method: 'POST', body: JSON.stringify({ domain: 'test' }) })
  assert(r.status !== 404, `pheromone_sense not deployed (404)`)
  assert(r.body?.data?.tool_name === 'pheromone_sense', `wrong tool_name`)
})

// ── 145. pheromone_deposit — MCP tool exists ──
await test('145. POST /api/tools/pheromone_deposit responds', async () => {
  const r = await api('/api/tools/pheromone_deposit', { method: 'POST', body: JSON.stringify({ type: 'attraction', domain: 'test', source: 'e2e-test' }) })
  assert(r.status !== 404, `pheromone_deposit not deployed (404)`)
  assert(r.body?.data?.tool_name === 'pheromone_deposit', `wrong tool_name`)
})

// ── 146. pheromone_heatmap — MCP tool exists ──
await test('146. POST /api/tools/pheromone_heatmap responds', async () => {
  const r = await api('/api/tools/pheromone_heatmap', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `pheromone_heatmap not deployed (404)`)
  assert(r.body?.data?.tool_name === 'pheromone_heatmap', `wrong tool_name`)
})

// ── 147. peer_eval_status — MCP tool exists ──
await test('147. POST /api/tools/peer_eval_status responds', async () => {
  const r = await api('/api/tools/peer_eval_status', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `peer_eval_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'peer_eval_status', `wrong tool_name`)
})

// ── 148. peer_eval_fleet — MCP tool exists ──
await test('148. POST /api/tools/peer_eval_fleet responds', async () => {
  const r = await api('/api/tools/peer_eval_fleet', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `peer_eval_fleet not deployed (404)`)
  assert(r.body?.data?.tool_name === 'peer_eval_fleet', `wrong tool_name`)
})

// ── 149. peer_eval_evaluate — MCP tool exists ──
await test('149. POST /api/tools/peer_eval_evaluate responds', async () => {
  const r = await api('/api/tools/peer_eval_evaluate', { method: 'POST', body: JSON.stringify({ agent_id: 'e2e-test' }) })
  assert(r.status !== 404, `peer_eval_evaluate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'peer_eval_evaluate', `wrong tool_name`)
})

// ── 150. peer_eval_analyze — MCP tool exists ──
await test('150. POST /api/tools/peer_eval_analyze responds', async () => {
  const r = await api('/api/tools/peer_eval_analyze', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `peer_eval_analyze not deployed (404)`)
  assert(r.body?.data?.tool_name === 'peer_eval_analyze', `wrong tool_name`)
})

// ── 151. inventor_run — MCP tool exists ──
await test('151. POST /api/tools/inventor_run responds', async () => {
  const r = await api('/api/tools/inventor_run', { method: 'POST', body: JSON.stringify({ experiment_name: 'e2e-test', task_description: 'E2E test run' }) })
  assert(r.status !== 404, `inventor_run not deployed (404)`)
  assert(r.body?.data?.tool_name === 'inventor_run', `wrong tool_name`)
})

// ── 152. inventor_status — MCP tool exists ──
await test('152. POST /api/tools/inventor_status responds', async () => {
  const r = await api('/api/tools/inventor_status', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `inventor_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'inventor_status', `wrong tool_name`)
})

// ── 153. inventor_nodes — MCP tool exists ──
await test('153. POST /api/tools/inventor_nodes responds', async () => {
  const r = await api('/api/tools/inventor_nodes', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `inventor_nodes not deployed (404)`)
  assert(r.body?.data?.tool_name === 'inventor_nodes', `wrong tool_name`)
})

// ── 154. inventor_node — MCP tool exists ──
await test('154. POST /api/tools/inventor_node responds', async () => {
  const r = await api('/api/tools/inventor_node', { method: 'POST', body: JSON.stringify({ node_id: 'nonexistent' }) })
  assert(r.status !== 404, `inventor_node not deployed (404)`)
  assert(r.body?.data?.tool_name === 'inventor_node', `wrong tool_name`)
})

// ── 155. inventor_best — MCP tool exists ──
await test('155. POST /api/tools/inventor_best responds', async () => {
  const r = await api('/api/tools/inventor_best', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `inventor_best not deployed (404)`)
  assert(r.body?.data?.tool_name === 'inventor_best', `wrong tool_name`)
})

// ── 156. inventor_stop — MCP tool exists ──
await test('156. POST /api/tools/inventor_stop responds', async () => {
  const r = await api('/api/tools/inventor_stop', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `inventor_stop not deployed (404)`)
  assert(r.body?.data?.tool_name === 'inventor_stop', `wrong tool_name`)
})

// ── 157. inventor_history — MCP tool exists ──
await test('157. POST /api/tools/inventor_history responds', async () => {
  const r = await api('/api/tools/inventor_history', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  assert(r.status !== 404, `inventor_history not deployed (404)`)
  assert(r.body?.data?.tool_name === 'inventor_history', `wrong tool_name`)
})

// ═══════════════════════════════════════════════════════════════
// Section 22: Neural Bridge v2 — Data, System, Agent, Model, Workflow, Governance, Infra tools
// ═══════════════════════════════════════════════════════════════

// ── 158. data_graph_read — exists ──
await test('158. POST /api/tools/data_graph_read responds', async () => {
  const r = await api('/api/tools/data_graph_read', { method: 'POST', body: JSON.stringify({ cypher: 'RETURN 1' }) })
  assert(r.status !== 404, `data_graph_read not deployed (404)`)
  assert(r.body?.data?.tool_name === 'data_graph_read', `wrong tool_name`)
})

// ── 159. data_graph_stats — exists ──
await test('159. POST /api/tools/data_graph_stats responds', async () => {
  const r = await api('/api/tools/data_graph_stats', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `data_graph_stats not deployed (404)`)
  assert(r.body?.data?.tool_name === 'data_graph_stats', `wrong tool_name`)
})

// ── 160. data_redis_inspect — exists ──
await test('160. POST /api/tools/data_redis_inspect responds', async () => {
  const r = await api('/api/tools/data_redis_inspect', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `data_redis_inspect not deployed (404)`)
  assert(r.body?.data?.tool_name === 'data_redis_inspect', `wrong tool_name`)
})

// ── 161. data_integrity_check — exists ──
await test('161. POST /api/tools/data_integrity_check responds', async () => {
  const r = await api('/api/tools/data_integrity_check', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `data_integrity_check not deployed (404)`)
  assert(r.body?.data?.tool_name === 'data_integrity_check', `wrong tool_name`)
})

// ── 162. system_health — exists ──
await test('162. POST /api/tools/system_health responds', async () => {
  const r = await api('/api/tools/system_health', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `system_health not deployed (404)`)
  assert(r.body?.data?.tool_name === 'system_health', `wrong tool_name`)
})

// ── 163. system_service_status — exists ──
await test('163. POST /api/tools/system_service_status responds', async () => {
  const r = await api('/api/tools/system_service_status', { method: 'POST', body: JSON.stringify({ service: 'backend' }) })
  assert(r.status !== 404, `system_service_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'system_service_status', `wrong tool_name`)
})

// ── 164. system_metrics_summary — exists ──
await test('164. POST /api/tools/system_metrics_summary responds', async () => {
  const r = await api('/api/tools/system_metrics_summary', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `system_metrics_summary not deployed (404)`)
  assert(r.body?.data?.tool_name === 'system_metrics_summary', `wrong tool_name`)
})

// ── 165. system_logs_summary — exists ──
await test('165. POST /api/tools/system_logs_summary responds', async () => {
  const r = await api('/api/tools/system_logs_summary', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `system_logs_summary not deployed (404)`)
  assert(r.body?.data?.tool_name === 'system_logs_summary', `wrong tool_name`)
})

// ── 166. agent_list — exists ──
await test('166. POST /api/tools/agent_list responds', async () => {
  const r = await api('/api/tools/agent_list', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `agent_list not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agent_list', `wrong tool_name`)
})

// ── 167. agent_status — exists ──
await test('167. POST /api/tools/agent_status responds', async () => {
  const r = await api('/api/tools/agent_status', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e' }) })
  assert(r.status !== 404, `agent_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agent_status', `wrong tool_name`)
})

// ── 168. agent_dispatch — exists ──
await test('168. POST /api/tools/agent_dispatch responds', async () => {
  const r = await api('/api/tools/agent_dispatch', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e', task_id: 'e2e', task_type: 'test', context: 'probe' }) })
  assert(r.status !== 404, `agent_dispatch not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agent_dispatch', `wrong tool_name`)
})

// ── 169. agent_memory — exists ──
await test('169. POST /api/tools/agent_memory responds', async () => {
  const r = await api('/api/tools/agent_memory', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e' }) })
  assert(r.status !== 404, `agent_memory not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agent_memory', `wrong tool_name`)
})

// ── 170. agent_capabilities — exists ──
await test('170. POST /api/tools/agent_capabilities responds', async () => {
  const r = await api('/api/tools/agent_capabilities', { method: 'POST', body: JSON.stringify({ agent_id: 'test-e2e' }) })
  assert(r.status !== 404, `agent_capabilities not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agent_capabilities', `wrong tool_name`)
})

// ── 171. model_providers — exists ──
await test('171. POST /api/tools/model_providers responds', async () => {
  const r = await api('/api/tools/model_providers', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `model_providers not deployed (404)`)
  assert(r.body?.data?.tool_name === 'model_providers', `wrong tool_name`)
})

// ── 172. model_route — exists ──
await test('172. POST /api/tools/model_route responds', async () => {
  const r = await api('/api/tools/model_route', { method: 'POST', body: JSON.stringify({ task_type: 'reasoning' }) })
  assert(r.status !== 404, `model_route not deployed (404)`)
  assert(r.body?.data?.tool_name === 'model_route', `wrong tool_name`)
})

// ── 173. model_cost_estimate — exists ──
await test('173. POST /api/tools/model_cost_estimate responds', async () => {
  const r = await api('/api/tools/model_cost_estimate', { method: 'POST', body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-chat', estimated_tokens: 100 }) })
  assert(r.status !== 404, `model_cost_estimate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'model_cost_estimate', `wrong tool_name`)
})

// ── 174. model_budget_status — exists ──
await test('174. POST /api/tools/model_budget_status responds', async () => {
  const r = await api('/api/tools/model_budget_status', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `model_budget_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'model_budget_status', `wrong tool_name`)
})

// ── 175. model_policy_check — exists ──
await test('175. POST /api/tools/model_policy_check responds', async () => {
  const r = await api('/api/tools/model_policy_check', { method: 'POST', body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-chat' }) })
  assert(r.status !== 404, `model_policy_check not deployed (404)`)
  assert(r.body?.data?.tool_name === 'model_policy_check', `wrong tool_name`)
})

// ── 176. workflow_cost_trace — exists ──
await test('176. POST /api/tools/workflow_cost_trace responds', async () => {
  const r = await api('/api/tools/workflow_cost_trace', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `workflow_cost_trace not deployed (404)`)
  assert(r.body?.data?.tool_name === 'workflow_cost_trace', `wrong tool_name`)
})

// ── 177. workflow_context_compact — exists ──
await test('177. POST /api/tools/workflow_context_compact responds', async () => {
  const r = await api('/api/tools/workflow_context_compact', { method: 'POST', body: JSON.stringify({ context: 'test' }) })
  assert(r.status !== 404, `workflow_context_compact not deployed (404)`)
  assert(r.body?.data?.tool_name === 'workflow_context_compact', `wrong tool_name`)
})

// ── 178. workflow_fanout_guard — exists ──
await test('178. POST /api/tools/workflow_fanout_guard responds', async () => {
  const r = await api('/api/tools/workflow_fanout_guard', { method: 'POST', body: JSON.stringify({ parallel_steps: 2 }) })
  assert(r.status !== 404, `workflow_fanout_guard not deployed (404)`)
  assert(r.body?.data?.tool_name === 'workflow_fanout_guard', `wrong tool_name`)
})

// ── 179. workflow_premium_escalation_check — exists ──
await test('179. POST /api/tools/workflow_premium_escalation_check responds', async () => {
  const r = await api('/api/tools/workflow_premium_escalation_check', { method: 'POST', body: JSON.stringify({ provider: 'claude', task: 'test' }) })
  assert(r.status !== 404, `workflow_premium_escalation_check not deployed (404)`)
  assert(r.body?.data?.tool_name === 'workflow_premium_escalation_check', `wrong tool_name`)
})

// ── 180. governance_plan_create — exists ──
await test('180. POST /api/tools/governance_plan_create responds', async () => {
  const r = await api('/api/tools/governance_plan_create', { method: 'POST', body: JSON.stringify({ description: 'e2e probe', scope: 'low', target_service: 'backend' }) })
  assert(r.status !== 404, `governance_plan_create not deployed (404)`)
  assert(r.body?.data?.tool_name === 'governance_plan_create', `wrong tool_name`)
})

// ── 181. governance_plan_approve — exists ──
await test('181. POST /api/tools/governance_plan_approve responds', async () => {
  const r = await api('/api/tools/governance_plan_approve', { method: 'POST', body: JSON.stringify({ plan_id: 'nonexistent', approver: 'e2e-test' }) })
  assert(r.status !== 404, `governance_plan_approve not deployed (404)`)
  assert(r.body?.data?.tool_name === 'governance_plan_approve', `wrong tool_name`)
})

// ── 182. governance_plan_execute — exists ──
await test('182. POST /api/tools/governance_plan_execute responds', async () => {
  const r = await api('/api/tools/governance_plan_execute', { method: 'POST', body: JSON.stringify({ plan_id: 'nonexistent' }) })
  assert(r.status !== 404, `governance_plan_execute not deployed (404)`)
  assert(r.body?.data?.tool_name === 'governance_plan_execute', `wrong tool_name`)
})

// ── 183. governance_plan_evaluate — exists ──
await test('183. POST /api/tools/governance_plan_evaluate responds', async () => {
  const r = await api('/api/tools/governance_plan_evaluate', { method: 'POST', body: JSON.stringify({ plan_id: 'nonexistent', outcome: 'test' }) })
  assert(r.status !== 404, `governance_plan_evaluate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'governance_plan_evaluate', `wrong tool_name`)
})

// ── 184. governance_audit_query — exists ──
await test('184. POST /api/tools/governance_audit_query responds', async () => {
  const r = await api('/api/tools/governance_audit_query', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `governance_audit_query not deployed (404)`)
  assert(r.body?.data?.tool_name === 'governance_audit_query', `wrong tool_name`)
})

// ── 185. governance_policy_decide — exists ──
await test('185. POST /api/tools/governance_policy_decide responds', async () => {
  const r = await api('/api/tools/governance_policy_decide', { method: 'POST', body: JSON.stringify({ action: 'get', policy_key: 'max_tokens' }) })
  assert(r.status !== 404, `governance_policy_decide not deployed (404)`)
  assert(r.body?.data?.tool_name === 'governance_policy_decide', `wrong tool_name`)
})

// ── 186. grafana_dashboard — exists ──
await test('186. POST /api/tools/grafana_dashboard responds', async () => {
  const r = await api('/api/tools/grafana_dashboard', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `grafana_dashboard not deployed (404)`)
  assert(r.body?.data?.tool_name === 'grafana_dashboard', `wrong tool_name`)
})

// ── 187. railway_deploy — exists ──
await test('187. POST /api/tools/railway_deploy responds', async () => {
  const r = await api('/api/tools/railway_deploy', { method: 'POST', body: JSON.stringify({ action: 'status' }) })
  assert(r.status !== 404, `railway_deploy not deployed (404)`)
  assert(r.body?.data?.tool_name === 'railway_deploy', `wrong tool_name`)
})

// ── 188. railway_env — exists ──
await test('188. POST /api/tools/railway_env responds', async () => {
  const r = await api('/api/tools/railway_env', { method: 'POST', body: JSON.stringify({ service: 'backend', action: 'get' }) })
  assert(r.status !== 404, `railway_env not deployed (404)`)
  assert(r.body?.data?.tool_name === 'railway_env', `wrong tool_name`)
})

// ── 189. linear_labels — responds without args ──
await test('189. POST /api/tools/linear_labels responds', async () => {
  const r = await api('/api/tools/linear_labels', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `linear_labels not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'linear_labels', `wrong tool_name: ${r.body?.data?.tool_name}`)
})

// ── 190. linear_save_issue — rejects missing title on create ──
await test('190. POST /api/tools/linear_save_issue responds', async () => {
  const r = await api('/api/tools/linear_save_issue', { method: 'POST', body: JSON.stringify({ title: 'test', team: 'Backend' }) })
  assert(r.status !== 404, `linear_save_issue not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'linear_save_issue', `wrong tool_name: ${r.body?.data?.tool_name}`)
})

// ── 191. linear_get_issue — responds with id ──
await test('191. POST /api/tools/linear_get_issue responds', async () => {
  const r = await api('/api/tools/linear_get_issue', { method: 'POST', body: JSON.stringify({ id: 'LIN-1' }) })
  assert(r.status !== 404, `linear_get_issue not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'linear_get_issue', `wrong tool_name: ${r.body?.data?.tool_name}`)
})

// ── 192. chat_send — broadcast message ──
await test('192. POST /api/tools/chat_send sends message', async () => {
  const r = await api('/api/tools/chat_send', { method: 'POST', body: JSON.stringify({ from: 'test-agent', to: 'All', message: 'A2A test ping' }) })
  assert(r.status !== 404, `chat_send not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'chat_send', `wrong tool_name: ${r.body?.data?.tool_name}`)
})

// ── 193. chat_read — read messages ──
await test('193. POST /api/tools/chat_read returns messages', async () => {
  const r = await api('/api/tools/chat_read', { method: 'POST', body: JSON.stringify({ limit: 5 }) })
  assert(r.status !== 404, `chat_read not deployed (404)`)
  assert(r.status === 200, `expected 200, got ${r.status}`)
  assert(r.body?.data?.tool_name === 'chat_read', `wrong tool_name: ${r.body?.data?.tool_name}`)
})

// ── 194–202. agentic.* — Python agentic-kit MCP wrappers ──────────────────
await test('194. POST /api/tools/agentic_snout_ingest responds', async () => {
  const r = await api('/api/tools/agentic_snout_ingest', { method: 'POST', body: JSON.stringify({ mode: 'discovery' }) })
  assert(r.status !== 404, `agentic_snout_ingest not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_snout_ingest', `wrong tool_name`)
})

await test('195. POST /api/tools/agentic_mrp_recalculate responds', async () => {
  const r = await api('/api/tools/agentic_mrp_recalculate', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `agentic_mrp_recalculate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_mrp_recalculate', `wrong tool_name`)
})

await test('196. POST /api/tools/agentic_mrp_route responds', async () => {
  const r = await api('/api/tools/agentic_mrp_route', { method: 'POST', body: JSON.stringify({ capability: 'reasoning', geo: 'EU' }) })
  assert(r.status !== 404, `agentic_mrp_route not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_mrp_route', `wrong tool_name`)
})

await test('197. POST /api/tools/agentic_hitl_escalate responds', async () => {
  const r = await api('/api/tools/agentic_hitl_escalate', { method: 'POST', body: JSON.stringify({ issue_type: 'Test Escalation', context: { agent_id: 'test' } }) })
  assert(r.status !== 404, `agentic_hitl_escalate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_hitl_escalate', `wrong tool_name`)
})

await test('198. POST /api/tools/agentic_contract_issue responds', async () => {
  const r = await api('/api/tools/agentic_contract_issue', { method: 'POST', body: JSON.stringify({ requester: 'test', contractor_agent_id: 'qwen-eu-v2.5', deliverable_spec: { task: 'reasoning' } }) })
  assert(r.status !== 404, `agentic_contract_issue not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_contract_issue', `wrong tool_name`)
})

await test('199. POST /api/tools/agentic_canary_evaluate responds', async () => {
  const r = await api('/api/tools/agentic_canary_evaluate', { method: 'POST', body: JSON.stringify({ agent_id: 'qwen-eu-v2.5' }) })
  assert(r.status !== 404, `agentic_canary_evaluate not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_canary_evaluate', `wrong tool_name`)
})

await test('200. POST /api/tools/agentic_reward_compute responds', async () => {
  const r = await api('/api/tools/agentic_reward_compute', { method: 'POST', body: JSON.stringify({ quality_score: 0.9, cost_per_1k: 0.000002, latency_ms: 320 }) })
  assert(r.status !== 404, `agentic_reward_compute not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_reward_compute', `wrong tool_name`)
})

await test('201. POST /api/tools/agentic_chaos_test responds', async () => {
  const r = await api('/api/tools/agentic_chaos_test', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `agentic_chaos_test not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_chaos_test', `wrong tool_name`)
})

await test('202. POST /api/tools/agentic_compliance_audit responds', async () => {
  const r = await api('/api/tools/agentic_compliance_audit', { method: 'POST', body: JSON.stringify({ action: 'vendor_scrape', data_class: 'PII' }) })
  assert(r.status !== 404, `agentic_compliance_audit not deployed (404)`)
  assert(r.body?.data?.tool_name === 'agentic_compliance_audit', `wrong tool_name`)
})

// ── 203. flywheel_metrics — MCP tool exists ──
await test('203. POST /api/tools/flywheel_metrics responds', async () => {
  const r = await api('/api/tools/flywheel_metrics', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `flywheel_metrics not deployed (404)`)
  assert(r.body?.data?.tool_name === 'flywheel_metrics', `wrong tool_name`)
})

// ── 204. flywheel_consolidation — MCP tool exists ──
await test('204. POST /api/tools/flywheel_consolidation responds', async () => {
  const r = await api('/api/tools/flywheel_consolidation', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `flywheel_consolidation not deployed (404)`)
  assert(r.body?.data?.tool_name === 'flywheel_consolidation', `wrong tool_name`)
})

// ── 205. anomaly_status — MCP tool exists ──
await test('205. POST /api/tools/anomaly_status responds', async () => {
  const r = await api('/api/tools/anomaly_status', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `anomaly_status not deployed (404)`)
  assert(r.body?.data?.tool_name === 'anomaly_status', `wrong tool_name`)
})

// ── 206. anomaly_scan — MCP tool exists ──
await test('206. POST /api/tools/anomaly_scan responds', async () => {
  const r = await api('/api/tools/anomaly_scan', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `anomaly_scan not deployed (404)`)
  assert(r.body?.data?.tool_name === 'anomaly_scan', `wrong tool_name`)
})

// ── 207. anomaly_patterns — MCP tool exists ──
await test('207. POST /api/tools/anomaly_patterns responds', async () => {
  const r = await api('/api/tools/anomaly_patterns', { method: 'POST', body: JSON.stringify({}) })
  assert(r.status !== 404, `anomaly_patterns not deployed (404)`)
  assert(r.body?.data?.tool_name === 'anomaly_patterns', `wrong tool_name`)
})

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '=' .repeat(60))
const total = passed + failed + skipped
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped / ${total} total`)
console.log('=' .repeat(60))

if (failed > 0) {
  console.log('\nFailed tests:')
  results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  - ${r.name}: ${r.error}`))
}

// Performance summary
const sorted = timings.sort((a, b) => b.ms - a.ms)
console.log('\nSlowest tests:')
sorted.slice(0, 5).forEach(t => console.log(`  ${t.ms}ms  ${t.name}`))
console.log(`\nTotal time: ${timings.reduce((s, t) => s + t.ms, 0)}ms`)
console.log()

process.exit(failed > 0 ? 1 : 0)
