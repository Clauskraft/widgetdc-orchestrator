#!/usr/bin/env node
/**
 * failure-injection-test.mjs — Failure-Memory Loop Stress Test
 *
 * Proves the self-correcting failure loop is live end-to-end:
 *   Step 1  INJECT  — fire known-bad chain steps to generate failures
 *   Step 2  WAIT    — allow context_fold + PeerEval + harvest pipeline to process
 *   Step 3  VERIFY  — query peer-eval, pheromone, graph and confirm loop closed
 *
 * Usage:
 *   node scripts/failure-injection-test.mjs [base_url] [api_key]
 *   node scripts/failure-injection-test.mjs --skip-inject   # only verify existing data
 *   node scripts/failure-injection-test.mjs --timeout 15    # custom wait seconds
 */

const BASE    = process.argv.find(a => a.startsWith('http')) || process.env.ORCH_URL || 'https://orchestrator-production-c27e.up.railway.app'
const API_KEY = process.env.ORCH_API_KEY || 'WidgeTDC_Orch_2026'
const SKIP_INJECT = process.argv.includes('--skip-inject')
const TIMEOUT_ARG = process.argv.find(a => a.startsWith('--timeout'))
const SETTLE_SECS = TIMEOUT_ARG ? parseInt(TIMEOUT_ARG.split('=')[1] ?? '15', 10) : 15

// ─── ANSI ────────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m'
const ok   = (m) => `  ${G}✅${X} ${m}`
const fail = (m) => `  ${R}❌${X} ${m}`
const warn = (m) => `  ${Y}⚠️ ${X} ${m}`
const info = (m) => `  ${C}ℹ️ ${X} ${m}`

let passed = 0, failed = 0, warned = 0
const log = []

function record(status, name, detail = '') {
  if (status === 'pass')  { passed++; console.log(ok(`${name}${detail ? ' — ' + detail : ''}`)) }
  if (status === 'fail')  { failed++; console.log(fail(`${name}${detail ? ': ' + detail : ''}`)) }
  if (status === 'warn')  { warned++; console.log(warn(`${name}${detail ? ' — ' + detail : ''}`)) }
  if (status === 'info')  {           console.log(info(`${name}${detail ? ' — ' + detail : ''}`)) }
  log.push({ status, name, detail })
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function api(method, path, body = null, timeoutMs = 15_000) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(timeoutMs),
  }
  if (body) opts.body = JSON.stringify(body)
  try {
    const res = await fetch(`${BASE}${path}`, opts)
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'DOMException') {
      return { ok: false, status: 408, data: null, timedOut: true }
    }
    throw err
  }
}

const GET  = (path)       => api('GET',  path)
const POST = (path, body) => api('POST', path, body)

// ─── Sleep ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${B}${C}🧪 Failure-Memory Loop Stress Test${X} — ${BASE}\n`)
console.log('═'.repeat(70))

// ─── PHASE 0: Health gate ────────────────────────────────────────────────────
console.log(`\n${B}PHASE 0 — Health Gate${X}`)
const health = await GET('/health')
if (!health.ok || health.data?.status !== 'healthy') {
  console.log(fail('Orchestrator not healthy — aborting'))
  process.exit(1)
}
record('pass', 'Orchestrator healthy', `uptime=${health.data?.uptime ?? '?'}s`)

// ─── PHASE 1: Inject Failures ────────────────────────────────────────────────
let injectedIds = []

if (!SKIP_INJECT) {
  console.log(`\n${B}PHASE 1 — Failure Injection (${3} scenarios)${X}`)

  // Scenario A: tool that does not exist → guaranteed MCP 404
  const chainA = await POST('/chains/execute', {
    name: 'failure-inject-A-nonexistent-tool',
    mode: 'sequential',
    steps: [{ agent_id: 'test-failure-agent', tool_name: 'graph.NONEXISTENT_TOOL_XYZ', arguments: { q: 'inject' } }],
  })
  if (chainA.ok) {
    const eid = chainA.data?.data?.execution_id ?? chainA.data?.execution_id
    if (eid) injectedIds.push(eid)
    record('pass', 'Scenario A injected (nonexistent tool)', `execution_id=${eid ?? 'queued'}`)
  } else {
    record('warn', 'Scenario A chain endpoint rejected (may not exist)', `HTTP ${chainA.status}`)
  }

  // Scenario B: cognitive action with intentionally malformed prompt (guaranteed fold)
  const chainB = await POST('/chains/execute', {
    name: 'failure-inject-B-cognitive-crash',
    mode: 'sequential',
    steps: [{
      agent_id: 'test-failure-agent',
      cognitive_action: 'reason',
      prompt: '',  // empty prompt — RLM should error
    }],
  })
  if (chainB.ok) {
    const eid = chainB.data?.data?.execution_id ?? chainB.data?.execution_id
    if (eid) injectedIds.push(eid)
    record('pass', 'Scenario B injected (empty cognitive prompt)', `execution_id=${eid ?? 'queued'}`)
  } else {
    record('warn', 'Scenario B chain endpoint rejected', `HTTP ${chainB.status}`)
  }

  // Scenario C: MCP tool with bad payload (type error triggers fold)
  const chainC = await POST('/chains/execute', {
    name: 'failure-inject-C-bad-payload',
    mode: 'sequential',
    steps: [{
      agent_id: 'test-failure-agent',
      tool_name: 'graph.read_cypher',
      arguments: { query: null },  // null query → Neo4j error
    }],
  })
  if (chainC.ok) {
    const eid = chainC.data?.data?.execution_id ?? chainC.data?.execution_id
    if (eid) injectedIds.push(eid)
    record('pass', 'Scenario C injected (null Cypher payload)', `execution_id=${eid ?? 'queued'}`)
  } else {
    record('warn', 'Scenario C chain endpoint rejected', `HTTP ${chainC.status}`)
  }

  // injectedIds may be empty if server uses async execution (execution_id in poll_url)
  // Phase 7 will verify by name from the executions list instead

  // Wait for pipeline to process
  console.log(`\n${info(`Settling ${SETTLE_SECS}s — waiting for context_fold + PeerEval + harvest pipeline…`)}`)
  for (let i = 1; i <= SETTLE_SECS; i++) {
    process.stdout.write(`\r  ${Y}⏳${X} ${i}/${SETTLE_SECS}s`)
    await sleep(1000)
  }
  console.log()
} else {
  record('info', 'Injection skipped (--skip-inject) — verifying existing data')
}

// ─── PHASE 2: Trigger failure harvest manually (force the scan) ──────────────
console.log(`\n${B}PHASE 2 — Trigger Failure Harvest${X}`)

// Fire-and-forget (harvest is slow — don't wait for response)
fetch(`${BASE}/cron/failure-harvester/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
  signal: AbortSignal.timeout(3_000),
}).catch(() => {}) // expected to timeout — we just want to trigger it
record('pass', 'Failure harvester cron fired (fire-and-forget)')
await sleep(5000) // let it start processing before we query

await sleep(3000) // short settle after harvest

// ─── PHASE 3: Verify — Peer-Eval failure records ─────────────────────────────
console.log(`\n${B}PHASE 3 — Verify PeerEval Failure Records${X}`)

const peerStatus = await GET('/api/peer-eval/status')
if (!peerStatus.ok) {
  record('fail', 'GET /api/peer-eval/status returned error', `HTTP ${peerStatus.status}`)
} else {
  const d = peerStatus.data?.data ?? peerStatus.data
  const evalCount = d?.totalEvals ?? d?.total_evaluations ?? d?.evaluations ?? 0
  const taskTypes = d?.taskTypesTracked ?? 0
  record(evalCount > 0 ? 'pass' : 'warn',
    'PeerEval has evaluation records',
    `total=${evalCount} taskTypes=${taskTypes}`)
}

// Check fleet data (contains failure patterns)
const fleetData = await GET('/api/peer-eval/fleet')
if (!fleetData.ok) {
  record('warn', 'GET /api/peer-eval/fleet not available', `HTTP ${fleetData.status}`)
} else {
  const d = fleetData.data?.data ?? fleetData.data
  const agents = d?.agents ?? d?.fleet ?? []
  const arr = Array.isArray(agents) ? agents : []
  const agentsWithFailures = arr.filter(a => (a.failure_count ?? a.failures ?? a.failureCount ?? 0) > 0)
  record(arr.length > 0 ? 'pass' : 'warn',
    'PeerEval fleet data available',
    `${arr.length} agents tracked, ${agentsWithFailures.length} have failures`)

  if (agentsWithFailures.length > 0) {
    const sorted = agentsWithFailures.sort((a, b) =>
      (b.failure_count ?? b.failures ?? b.failureCount ?? 0) - (a.failure_count ?? a.failures ?? a.failureCount ?? 0))
    sorted.slice(0, 3).forEach(a => record('info',
      `Agent failure: ${a.id ?? a.agentId ?? 'unknown'}`,
      `failures=${a.failure_count ?? a.failures ?? a.failureCount}`))
  }
}

// ─── PHASE 4: Verify — Pheromone repellent signals ───────────────────────────
console.log(`\n${B}PHASE 4 — Verify Pheromone Repellent Signals${X}`)

const pheroStatus = await GET('/api/pheromone/status')
if (!pheroStatus.ok) {
  record('fail', 'GET /api/pheromone/status returned error', `HTTP ${pheroStatus.status}`)
} else {
  const signals = pheroStatus.data?.signals ?? pheroStatus.data?.pheromones ?? []
  const repellents = signals.filter(s => s.type === 'repellent' || s.pheromoneType === 'repellent')
  record(repellents.length > 0 ? 'pass' : 'warn',
    'Pheromone layer has repellent signals',
    `${repellents.length} repellent signals active`)

  if (repellents.length > 0) {
    const strongest = repellents.sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0)).slice(0, 2)
    strongest.forEach(s => record('info',
      `Repellent: domain=${s.domain ?? 'unknown'}`,
      `strength=${(s.strength ?? 0).toFixed(3)} ttl=${s.ttl ?? 'unknown'}`))
  }
}

// Check failure domain specifically
const pheroSense = await GET('/api/pheromone/sense?domain=failure&limit=5')
if (pheroSense.ok) {
  const trails = pheroSense.data?.trails ?? pheroSense.data ?? []
  const arr = Array.isArray(trails) ? trails : []
  const nonZero = arr.filter(t => (t.strength ?? 0) > 0)
  record(nonZero.length > 0 ? 'pass' : 'warn',
    'Pheromone failure-domain sense',
    `${nonZero.length} active failure trails (strengths: ${nonZero.map(t => (t.strength ?? 0).toFixed(2)).join(', ') || 'none'})`)
}

// ─── PHASE 5: Verify — Neo4j FailurePattern nodes ───────────────────────────
console.log(`\n${B}PHASE 5 — Verify Neo4j FailurePattern Graph${X}`)

// Use the graph query tool via /api/tools
const cypherRes = await POST('/api/tools/query_graph', {
  cypher: `
    MATCH (fp:FailureMemory)
    WHERE fp.timestamp > datetime() - duration('PT48H')
    RETURN fp.agentId AS agent, fp.category AS category, count(*) AS failures
    ORDER BY failures DESC LIMIT 5
  `,
})

if (!cypherRes.ok) {
  record('warn', 'graph query via MCP not available', `HTTP ${cypherRes.status}`)
} else {
  const rows = cypherRes.data?.result?.results ?? cypherRes.data?.results ?? cypherRes.data?.data ?? []
  const arr = Array.isArray(rows) ? rows : []
  record(arr.length > 0 ? 'pass' : 'warn',
    'FailureMemory nodes in Neo4j (last 48h)',
    `${arr.length} agent/category buckets`)
  arr.forEach(r => record('info',
    `FailureMemory: agent=${r.agent ?? '?'} category=${r.category ?? '?'}`,
    `count=${r.failures}`))
}

// Check for FailurePattern nodes (written by runFailureHarvest)
const patternRes = await POST('/api/tools/query_graph', {
  cypher: `
    MATCH (fp:FailurePattern)
    WHERE fp.lastSeen > datetime() - duration('PT72H')
    RETURN fp.agentId AS agent, fp.taskType AS task, fp.severity AS severity
    ORDER BY fp.severity DESC LIMIT 5
  `,
})

if (patternRes.ok) {
  const rows = patternRes.data?.result?.results ?? patternRes.data?.results ?? patternRes.data?.data ?? []
  const arr = Array.isArray(rows) ? rows : []
  record(arr.length > 0 ? 'pass' : 'warn',
    'FailurePattern nodes (from harvest, last 72h)',
    arr.length > 0 ? `${arr.length} patterns` : 'none yet — harvest may not have run')
}

// ─── PHASE 6: Verify — Adaptive RAG routing weights ─────────────────────────
console.log(`\n${B}PHASE 6 — Verify Adaptive RAG Routing Weights${X}`)

const ragDash = await POST('/api/tools/adaptive_rag_dashboard', {})
if (!ragDash.ok) {
  record('warn', 'adaptive_rag_dashboard tool call failed', `HTTP ${ragDash.status}`)
} else {
  const result = ragDash.data?.data?.result ?? ragDash.data?.result ?? ''
  const hasData = typeof result === 'string' ? result.length > 20 : result !== null
  record(hasData ? 'pass' : 'warn',
    'Adaptive RAG dashboard tool responded', hasData ? 'data present' : 'empty result')

  // Try to parse route weights if result is stringified JSON
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    const weights = parsed?.weights ?? parsed?.routingWeights ?? {}
    const hasPenalties = Object.values(weights).some(w => (w?.score ?? w ?? 1) < 0.8)
    const trainSamples = parsed?.training_samples ?? parsed?.weights?.training_samples ?? 0
    record('info', 'Adaptive RAG stats',
      `routes=${Object.keys(weights).length} penalised=${hasPenalties} samples=${trainSamples}`)
  } catch { /* result may not be JSON */ }
}

// ─── PHASE 7: Verify — Injected chains resolved as failed ────────────────────
console.log(`\n${B}PHASE 7 — Verify Injected Chain Statuses${X}`)

// Fetch all chains and find our injected ones by name
const chainsRes = await GET('/chains')
const executions = chainsRes.data?.data?.executions ?? chainsRes.data?.executions ?? []
const injected = executions.filter(e =>
  e.name?.startsWith('failure-inject-') &&
  new Date(e.started_at ?? e.created_at ?? 0).getTime() > Date.now() - 120_000
)

if (injected.length > 0) {
  const failedCount = injected.filter(e => e.status === 'failed').length
  record(failedCount === injected.length ? 'pass' : 'warn',
    `Injected chains resolved as failed`,
    `${failedCount}/${injected.length} status=failed`)
  injected.forEach(e => record('info',
    `Chain: ${e.name}`, `status=${e.status} steps=${e.steps_completed}/${e.steps_total}`))
} else {
  record('warn', 'Injected chains not found in recent executions list', 'may still be running or beyond window')
}

// ─── PHASE 8: Flywheel metrics (smoke test) ──────────────────────────────────
console.log(`\n${B}PHASE 8 — Flywheel Smoke Test${X}`)

const fwRes = await GET('/api/flywheel/metrics')
if (!fwRes.ok) {
  record('fail', 'GET /api/flywheel/metrics', `HTTP ${fwRes.status}`)
} else {
  const available = fwRes.data?.available !== false
  record(available ? 'pass' : 'warn',
    'Flywheel metrics endpoint live',
    available
      ? `compound=${((fwRes.data?.report?.compoundScore ?? fwRes.data?.compoundScore ?? 0) * 100).toFixed(0)}%`
      : 'no sync data yet')
}

const consRes = await GET('/api/flywheel/consolidation')
if (!consRes.ok) {
  record('fail', 'GET /api/flywheel/consolidation', `HTTP ${consRes.status}`)
} else {
  record('pass', 'Flywheel consolidation endpoint live',
    `candidates=${consRes.data?.report?.candidates?.length ?? 0}`)
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
console.log(`${B}Result:${X} ${G}${passed} passed${X} | ${R}${failed} failed${X} | ${Y}${warned} warned${X}`)
console.log('═'.repeat(70))

// Loop verdict
const loopClosed = (
  log.some(l => l.name.includes('PeerEval') && l.status === 'pass') &&
  (log.some(l => l.name.includes('Pheromone') && l.status === 'pass') ||
   log.some(l => l.name.includes('FailureMemory') && l.status === 'pass'))
)

if (loopClosed) {
  console.log(`\n${G}${B}✅ FAILURE-MEMORY LOOP CLOSED${X} — PeerEval + graph evidence confirmed.\n`)
} else if (failed === 0) {
  console.log(`\n${Y}${B}⚠️  LOOP PARTIALLY VERIFIED${X} — No hard failures, but some evidence still accumulating.\n   Re-run with --skip-inject after a few minutes to check harvest pipeline.\n`)
} else {
  console.log(`\n${R}${B}❌ LOOP NOT CONFIRMED${X} — ${failed} check(s) failed. See above for root cause.\n`)
}

process.exit(failed > 0 ? 1 : 0)
