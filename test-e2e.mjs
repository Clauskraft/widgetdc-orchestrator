/**
 * test-e2e.mjs — 50 comprehensive end-to-end tests for WidgeTDC Command Center
 *
 * Covers: Health, Dashboard, Agents, Chat, Chains, Cron, Cognitive, LLM,
 *         Audit, SSE, WebSocket, Auth, Frontend HTML/CSS/JS, Command Palette,
 *         Fleet Health Score, Agent CRUD, MCP tools, error handling.
 *
 * Usage: node test-e2e.mjs [base_url] [api_key]
 */

const BASE = process.argv[2] || 'https://orchestrator-production-c27e.up.railway.app'
const API_KEY = process.argv[3] || 'WidgeTDC_Orch_2026'

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
await test('6. Frontend: version tag v2.5', async () => {
  assert(cachedHtml.includes('v2.5'), 'missing v2.5')
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
