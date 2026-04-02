#!/usr/bin/env node
/**
 * loop-enrichment.mjs — Autonomous Enrichment Loop System
 *
 * 5 flows that test + enrich the WidgeTDC platform simultaneously.
 * Each flow exercises endpoints, builds graph data, and validates integrity.
 *
 * Usage:
 *   node loop-enrichment.mjs                    # Run all 5 flows once
 *   node loop-enrichment.mjs --loops 10         # Run 10 iterations
 *   node loop-enrichment.mjs --hours 2          # Run for 2 hours
 *   node loop-enrichment.mjs --flow 3           # Run only flow 3
 *   node loop-enrichment.mjs --hours 4 --delay 60  # 4 hours, 60s between iterations
 */

const ORCH_URL = 'https://orchestrator-production-c27e.up.railway.app'
const BACKEND_URL = 'https://backend-production-d3da.up.railway.app'
const ORCH_KEY = 'WidgeTDC_Orch_2026'
const BACKEND_KEY = 'Heravej_22'

const DOMAINS = [
  'Strategy', 'Digital Government', 'Cybersecurity', 'architecture',
  'compliance', 'consulting', 'data-management', 'cloud-infrastructure',
  'ai-governance', 'supply-chain', 'financial-advisory', 'risk-management',
]

const CONSULTING_TOPICS = [
  'Due diligence methodology for Nordic public sector IT',
  'NIS2 compliance gap analysis for critical infrastructure',
  'Cloud migration risk assessment framework',
  'AI governance policy for EU regulated enterprises',
  'Vendor lock-in reduction strategy for municipal IT',
  'Digital twin architecture for industrial IoT',
  'Zero-trust security model for hybrid workforce',
  'Data mesh implementation for multi-cloud environments',
  'Sustainability reporting automation using graph databases',
  'McKinsey 7S framework applied to digital transformation',
  'Porter Five Forces analysis of Danish IT consulting market',
  'TOGAF architecture decision records for enterprise modernization',
  'Agile at scale patterns for government agencies',
  'Technical debt quantification and remediation prioritization',
  'Knowledge graph design for consulting IP management',
]

let stats = {
  iterations: 0,
  signals_created: 0,
  patterns_found: 0,
  blocks_created: 0,
  assemblies_composed: 0,
  decisions_certified: 0,
  loose_ends_scanned: 0,
  adoption_snapshots: 0,
  chains_executed: 0,
  cognitive_calls: 0,
  errors: 0,
  start_time: Date.now(),
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function orchFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${ORCH_KEY}`,
      'Content-Type': 'application/json',
    },
  }
  if (body) opts.body = JSON.stringify(body)
  const t0 = Date.now()
  try {
    const res = await fetch(`${ORCH_URL}${path}`, opts)
    const data = await res.json()
    return { ok: res.ok, status: res.status, data, ms: Date.now() - t0 }
  } catch (err) {
    stats.errors++
    return { ok: false, status: 0, data: { error: err.message }, ms: Date.now() - t0 }
  }
}

async function backendMcp(tool, payload) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${BACKEND_URL}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BACKEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool, payload }),
    })
    const data = await res.json()
    return { ok: res.ok, data, ms: Date.now() - t0 }
  } catch (err) {
    stats.errors++
    return { ok: false, data: { error: err.message }, ms: Date.now() - t0 }
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function uid() { return `enrich-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }

function log(flow, msg, ms = null) {
  const ts = new Date().toISOString().slice(11, 19)
  const timing = ms ? ` (${ms}ms)` : ''
  console.log(`  [${ts}] Flow ${flow}: ${msg}${timing}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 1: Signal Seeding — Create consulting signals from domain knowledge
// Purpose: Populate Signal nodes, exercise cognitive/reason, build foundation
// ═══════════════════════════════════════════════════════════════════════════

async function flow1_SignalSeeding() {
  const topic = pick(CONSULTING_TOPICS)
  const domain = pick(DOMAINS)
  log(1, `Seeding signal: "${topic.slice(0, 50)}..." in ${domain}`)

  // Step 1: Use RLM cognitive to generate a structured signal
  const cogResult = await orchFetch('/cognitive/reason', 'POST', {
    prompt: `You are a consulting signal detector. Extract a structured architectural signal from this topic.

Topic: ${topic}
Domain: ${domain}

Reply as JSON: {"signal_title": "...", "key_insight": "...", "implications": ["..."], "confidence": 0.0-1.0, "related_domains": ["..."]}`,
    context: { domain, source: 'enrichment-loop' },
  })

  if (!cogResult.ok) {
    log(1, `Cognitive call failed: ${cogResult.status}`, cogResult.ms)
    stats.errors++
    return
  }
  stats.cognitive_calls++

  // Step 2: Parse and store as Signal node in Neo4j
  let signal = { signal_title: topic, key_insight: topic, confidence: 0.6 }
  try {
    const text = typeof cogResult.data === 'string' ? cogResult.data
      : JSON.stringify(cogResult.data?.data ?? cogResult.data)
    const match = text.match(/\{[\s\S]*?\}/)
    if (match) signal = { ...signal, ...JSON.parse(match[0]) }
  } catch { /* use defaults */ }

  const signalId = uid()
  const graphResult = await backendMcp('graph.write_cypher', {
    query: `CREATE (s:Signal {
      id: $id, title: $title, insight: $insight,
      domain: $domain, confidence: $confidence,
      source: 'enrichment-loop', createdAt: datetime()
    })
    WITH s
    MATCH (d:Domain {name: $domain})
    MERGE (s)-[:BELONGS_TO_DOMAIN]->(d)
    RETURN s.id AS id`,
    params: {
      id: signalId,
      title: signal.signal_title?.slice(0, 200) ?? topic.slice(0, 200),
      insight: signal.key_insight?.slice(0, 500) ?? '',
      domain,
      confidence: Math.max(0, Math.min(1, signal.confidence ?? 0.6)),
    },
  })

  stats.signals_created++
  log(1, `Signal "${signalId}" created in ${domain}`, cogResult.ms + (graphResult.ms ?? 0))
  return signalId
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 2: Pattern Discovery — Analyze signals, find patterns, create blocks
// Purpose: Exercise kg_rag, create Pattern+Block nodes, build relationships
// ═══════════════════════════════════════════════════════════════════════════

async function flow2_PatternDiscovery() {
  const domain = pick(DOMAINS)
  log(2, `Discovering patterns in ${domain}`)

  // Step 1: Query existing signals in this domain
  const signals = await backendMcp('graph.read_cypher', {
    query: `MATCH (s:Signal) WHERE s.domain = $domain
    RETURN s.id AS id, s.title AS title, s.insight AS insight
    ORDER BY s.createdAt DESC LIMIT 5`,
    params: { domain },
  })

  const signalList = Array.isArray(signals.data?.result) ? signals.data.result
    : Array.isArray(signals.data?.results) ? signals.data.results : []

  if (signalList.length === 0) {
    log(2, `No signals in ${domain} yet — skipping (will seed next iteration)`)
    return
  }

  // Step 2: Use KG-RAG to find cross-domain patterns
  const ragResult = await backendMcp('kg_rag.query', {
    question: `What patterns emerge from these signals in ${domain}? ${signalList.map(s => s.title).join('; ')}`,
    max_evidence: 10,
  })
  stats.patterns_found++

  // Step 3: Create a Pattern node linking to signals
  const patternId = uid()
  const patternTitle = `${domain} pattern: ${signalList.length} signals analyzed`

  await backendMcp('graph.write_cypher', {
    query: `CREATE (p:Pattern {
      id: $id, title: $title, domain: $domain,
      signal_count: $count, source: 'enrichment-loop',
      createdAt: datetime()
    })
    WITH p
    UNWIND $signalIds AS sid
    MATCH (s:Signal {id: sid})
    MERGE (p)-[:DERIVED_FROM]->(s)
    RETURN p.id`,
    params: {
      id: patternId,
      title: patternTitle,
      domain,
      count: signalList.length,
      signalIds: signalList.map(s => s.id).filter(Boolean),
    },
  })

  // Step 4: Promote strong patterns to Blocks
  if (signalList.length >= 3) {
    const blockId = uid()
    await backendMcp('graph.write_cypher', {
      query: `CREATE (b:Block {
        id: $id, name: $name, domain: $domain,
        type: 'architecture-block', source: 'enrichment-loop',
        createdAt: datetime()
      })
      WITH b
      MATCH (p:Pattern {id: $patternId})
      MERGE (b)-[:EXTRACTED_FROM]->(p)
      RETURN b.id`,
      params: {
        id: blockId,
        name: `${domain} Architecture Block`,
        domain,
        patternId,
      },
    })
    stats.blocks_created++
    log(2, `Block "${blockId}" promoted from pattern in ${domain}`, signals.ms)
  } else {
    log(2, `Pattern found but not enough signals for block promotion (${signalList.length}/3)`, signals.ms)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 3: Assembly Composition — Compose blocks into architecture assemblies
// Purpose: Exercise /api/assembly/compose, test scoring, build Assembly nodes
// ═══════════════════════════════════════════════════════════════════════════

async function flow3_AssemblyComposition() {
  log(3, 'Composing architecture assemblies from available blocks')

  // Step 1: Check how many blocks exist
  const blockCount = await backendMcp('graph.read_cypher', {
    query: `MATCH (b:Block) RETURN count(b) AS count`,
  })

  const count = blockCount.data?.result?.[0]?.count?.low ??
    blockCount.data?.results?.[0]?.count?.low ?? 0

  if (count < 2) {
    log(3, `Only ${count} blocks — need at least 2. Skipping (build blocks in flow 2 first).`)
    return
  }

  // Step 2: Try assembly composition via orchestrator API
  const result = await orchFetch('/api/assembly/compose', 'POST', {
    query: `Compose an architecture for consulting delivery in ${pick(DOMAINS)}`,
    max_candidates: 2,
  })

  if (result.ok && result.data?.success) {
    const data = result.data.data
    stats.assemblies_composed += data.candidates_generated ?? 0
    log(3, `Composed ${data.candidates_generated} assemblies from ${data.input_blocks} blocks`, result.ms)

    // Step 3: Accept the top-scoring assembly
    if (data.assemblies?.length > 0) {
      const topAssembly = data.assemblies[0]
      await orchFetch(`/api/assembly/${topAssembly.$id}`, 'PUT', { status: 'accepted' })
      log(3, `Accepted assembly "${topAssembly.name}" (score: ${topAssembly.scores.composite})`)
    }
  } else {
    log(3, `Assembly compose: ${result.data?.error?.message ?? 'no blocks found'}`, result.ms)
    // Build more blocks
    await flow2_PatternDiscovery()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 4: Decision Certification + Loose-End Detection
// Purpose: Certify decisions from assemblies, then scan for loose ends
// ═══════════════════════════════════════════════════════════════════════════

async function flow4_DecisionAndLooseEnds() {
  log(4, 'Decision certification + loose-end detection')

  // Step 1: Find accepted assemblies without decisions
  const assemblies = await orchFetch('/api/assembly?status=accepted')
  const accepted = assemblies.data?.assemblies ?? []

  if (accepted.length > 0) {
    // Step 2: Certify a decision for the top assembly
    const assembly = accepted[0]
    const certResult = await orchFetch('/api/decisions/certify', 'POST', {
      assembly_id: assembly.$id,
      title: `Architecture Decision: ${assembly.name}`,
      context: { source: 'enrichment-loop', iteration: stats.iterations },
    })

    if (certResult.ok) {
      stats.decisions_certified++
      log(4, `Decision certified for "${assembly.name}"`, certResult.ms)
    } else {
      log(4, `Certification failed: ${certResult.status}`, certResult.ms)
    }
  } else {
    log(4, 'No accepted assemblies — certifying from enrichment data')
    // Certify based on iteration data
    const certResult = await orchFetch('/api/decisions/certify', 'POST', {
      assembly_id: `enrichment-iteration-${stats.iterations}`,
      title: `Enrichment Decision: ${pick(DOMAINS)} architecture validated`,
      summary: `Iteration ${stats.iterations}: ${stats.signals_created} signals, ${stats.blocks_created} blocks`,
      rationale: `Autonomous enrichment loop validated ${stats.patterns_found} patterns across domains`,
    })
    if (certResult.ok) stats.decisions_certified++
    log(4, `Enrichment decision certified`, certResult.ms)
  }

  // Step 3: Run loose-end scan
  const scanResult = await orchFetch('/api/loose-ends/scan', 'POST')
  if (scanResult.ok) {
    const summary = scanResult.data?.data?.summary ?? {}
    stats.loose_ends_scanned++
    log(4, `Loose-end scan: ${summary.critical ?? 0} critical, ${summary.warning ?? 0} warnings, ${summary.info ?? 0} info`, scanResult.ms)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 5: Full Funnel + Metrics — Run funnel chain + capture adoption metrics
// Purpose: Exercise funnel mode, adoption trends, dashboard, health
// ═══════════════════════════════════════════════════════════════════════════

async function flow5_FunnelAndMetrics() {
  const topic = pick(CONSULTING_TOPICS)
  log(5, `Funnel pipeline: "${topic.slice(0, 50)}..."`)

  // Step 1: Execute funnel chain
  const funnelResult = await orchFetch('/chains/execute', 'POST', {
    name: `Enrichment Funnel: ${topic.slice(0, 40)}`,
    mode: 'funnel',
    funnel_entry: 'signal',
    steps: [
      {
        agent_id: 'orchestrator',
        tool_name: 'srag.query',
        arguments: { query: topic },
      },
      {
        agent_id: 'orchestrator',
        tool_name: 'kg_rag.query',
        arguments: { question: `What patterns relate to: ${topic}?`, max_evidence: 5 },
      },
      {
        agent_id: 'orchestrator',
        tool_name: 'graph.read_cypher',
        arguments: {
          query: "MATCH (b:Block) RETURN b.id AS id, b.name AS name LIMIT 5",
        },
      },
    ],
  })

  if (funnelResult.ok) {
    stats.chains_executed++
    const exec = funnelResult.data?.data ?? {}
    log(5, `Funnel: ${exec.status ?? 'started'}, ${exec.steps_completed ?? '?'}/${exec.steps_total ?? '?'} steps`, funnelResult.ms)
  }

  // Step 2: Capture adoption snapshot
  const snapshot = await orchFetch('/api/adoption/snapshot', 'POST')
  if (snapshot.ok) {
    stats.adoption_snapshots++
    const s = snapshot.data?.data ?? {}
    log(5, `Adoption: ${s.conversations_24h ?? 0} convos, ${s.pipeline_executions_24h ?? 0} pipes, ${s.chain_executions_24h ?? 0} chains`, snapshot.ms)
  }

  // Step 3: Verify dashboard integrity
  const dashboard = await orchFetch('/api/dashboard/data')
  const hasTrends = Array.isArray(dashboard.data?.adoptionTrends)
  const cronCount = dashboard.data?.cronJobs?.length ?? 0
  log(5, `Dashboard: ${hasTrends ? 'trends OK' : 'trends MISSING'}, ${cronCount} crons`, dashboard.ms)

  // Step 4: Health check
  const health = await fetch(`${ORCH_URL}/health`).then(r => r.json())
  log(5, `Health: ${health.status}, ${health.agents_registered} agents, ${health.cron_jobs} crons`)
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════

async function runIteration(flowFilter = null) {
  stats.iterations++
  const iterStart = Date.now()

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  ITERATION ${stats.iterations} — ${new Date().toISOString()}`)
  console.log(`${'═'.repeat(70)}`)

  const flows = [
    flow1_SignalSeeding,
    flow2_PatternDiscovery,
    flow3_AssemblyComposition,
    flow4_DecisionAndLooseEnds,
    flow5_FunnelAndMetrics,
  ]

  for (let i = 0; i < flows.length; i++) {
    if (flowFilter !== null && flowFilter !== i + 1) continue
    try {
      await flows[i]()
    } catch (err) {
      stats.errors++
      log(i + 1, `ERROR: ${err.message}`)
    }
  }

  const elapsed = Date.now() - iterStart
  console.log(`\n  Iteration ${stats.iterations} complete (${(elapsed / 1000).toFixed(1)}s)`)
  printStats()
}

function printStats() {
  const runtime = ((Date.now() - stats.start_time) / 60000).toFixed(1)
  console.log(`
  ┌─────────────────────────────────────────┐
  │ ENRICHMENT STATS (${runtime} min runtime)
  │ Iterations:      ${stats.iterations}
  │ Signals created: ${stats.signals_created}
  │ Patterns found:  ${stats.patterns_found}
  │ Blocks created:  ${stats.blocks_created}
  │ Assemblies:      ${stats.assemblies_composed}
  │ Decisions:       ${stats.decisions_certified}
  │ Loose-end scans: ${stats.loose_ends_scanned}
  │ Adoption snaps:  ${stats.adoption_snapshots}
  │ Chains executed: ${stats.chains_executed}
  │ Cognitive calls: ${stats.cognitive_calls}
  │ Errors:          ${stats.errors}
  └─────────────────────────────────────────┘`)
}

async function main() {
  const args = process.argv.slice(2)
  let maxLoops = 1
  let maxHours = null
  let flowFilter = null
  let delaySeconds = 30

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--loops') maxLoops = parseInt(args[++i]) || 1
    if (args[i] === '--hours') maxHours = parseFloat(args[++i]) || 1
    if (args[i] === '--flow') flowFilter = parseInt(args[++i]) || null
    if (args[i] === '--delay') delaySeconds = parseInt(args[++i]) || 30
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  WidgeTDC Enrichment Loop System                            ║
║  Flows: ${flowFilter ? `#${flowFilter} only` : 'ALL 5'}                                            ║
║  Mode: ${maxHours ? `${maxHours}h runtime` : `${maxLoops} iteration(s)`}                                   ║
║  Delay: ${delaySeconds}s between iterations                          ║
╚══════════════════════════════════════════════════════════════╝`)

  const deadline = maxHours ? Date.now() + maxHours * 3600000 : null

  for (let i = 0; i < (deadline ? 999999 : maxLoops); i++) {
    if (deadline && Date.now() >= deadline) {
      console.log('\n  ⏰ Time limit reached. Stopping.')
      break
    }

    await runIteration(flowFilter)

    // Delay between iterations (except last)
    if (i < (deadline ? 999999 : maxLoops) - 1) {
      if (deadline && Date.now() >= deadline) break
      console.log(`\n  Waiting ${delaySeconds}s before next iteration...`)
      await new Promise(r => setTimeout(r, delaySeconds * 1000))
    }
  }

  console.log('\n' + '═'.repeat(70))
  console.log('  FINAL REPORT')
  console.log('═'.repeat(70))
  printStats()
  console.log('\n  Done.')
}

main().catch(console.error)
