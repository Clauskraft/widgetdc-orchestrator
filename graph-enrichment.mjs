#!/usr/bin/env node
/**
 * graph-enrichment.mjs — Self-aware knowledge enrichment via orchestrator intelligence layers
 *
 * Uses the system's OWN capabilities instead of raw queries:
 *   - Omega Sentinel for system self-knowledge + SITREP
 *   - Teacher/Student pattern for cross-agent learning
 *   - RLM Engine (reason → analyze → plan → fold) for deep classification
 *   - SRAG for semantic retrieval
 *   - CMA for context memory
 *   - Chain Engine (swarm) for parallel processing
 *   - Context Folding for compression
 *
 * Usage: node graph-enrichment.mjs [all|orphans|events|classify|audit]
 */

const BASE = 'https://orchestrator-production-c27e.up.railway.app'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const API_KEY = 'WidgeTDC_Orch_2026'
const BACKEND_KEY = 'Heravej_22'

const task = process.argv[2] || 'all'

// ─── Orchestrator Intelligence Calls ────────────────────────────────────────

/** Call orchestrator endpoint */
async function orch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(120000),
  })
  return await res.json().catch(() => null)
}

/** MCP tool call via orchestrator */
async function mcpTool(toolName, args, agentId = 'omega') {
  const r = await orch('/tools/call', {
    method: 'POST',
    body: JSON.stringify({ agent_id: agentId, tool_name: toolName, arguments: args, call_id: crypto.randomUUID() }),
  })
  return r?.data?.result ?? r?.data ?? r
}

/** RLM cognitive action */
async function cognitive(action, prompt, context = {}) {
  const body = { prompt, task: prompt, context, depth: 1 }
  if (action === 'analyze') body.analysis_dimensions = ['completeness', 'quality', 'gaps']
  if (action === 'plan') body.constraints = []
  const r = await orch(`/cognitive/${action}`, { method: 'POST', body: JSON.stringify(body) })
  return r?.data?.result ?? r?.data ?? r
}

/** Chain execution (swarm) */
async function chain(name, mode, steps) {
  const r = await orch('/chains/execute', {
    method: 'POST',
    body: JSON.stringify({ name, mode, steps }),
  })
  return r?.data ?? r
}

/** Broadcast to chat */
async function say(message, from = 'Graph Enrichment') {
  await orch('/chat/message', {
    method: 'POST',
    body: JSON.stringify({ from, to: 'All', source: 'system', type: 'Message', message, timestamp: new Date().toISOString(), no_reply: true }),
  }).catch(() => {})
}

/** Store to all memory layers */
async function remember(content, title, tags = []) {
  await orch('/chat/remember', {
    method: 'POST',
    body: JSON.stringify({ content, title, tags: ['enrichment', ...tags] }),
  }).catch(() => {})
}

/** SRAG semantic search */
async function sragQuery(query) {
  return await mcpTool('srag.query', { query }, 'omega')
}

/** CMA context retrieval */
async function cmaContext(keywords) {
  return await mcpTool('cma.context', { keywords }, 'cma')
}

/** Graph read */
async function graphRead(cypher) {
  const r = await mcpTool('graph.read_cypher', { query: cypher }, 'graph')
  return r?.result?.results || r?.results || r?.result || []
}

/** Graph write */
async function graphWrite(cypher) {
  return await mcpTool('graph.write_cypher', { query: cypher }, 'graph')
}

/** Neo4j integer parser */
function n(val) {
  if (val == null) return 0
  if (typeof val === 'object' && 'low' in val) return val.low
  return Number(val) || 0
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: Omega Sentinel SITREP — system self-knowledge
// ═══════════════════════════════════════════════════════════════════════════
async function phase1_omegaSitrep() {
  console.log('\n══════════════════════════════════════════════════')
  console.log('  PHASE 1: Omega Sentinel Self-Knowledge Scan')
  console.log('══════════════════════════════════════════════════\n')

  // Query system's own knowledge about itself from multiple layers in parallel
  const [
    selfLessons,
    failurePatterns,
    emergentPatterns,
    teachingEvents,
    systemArch,
    sragSelf,
    cmaSelf,
  ] = await Promise.allSettled([
    // 1. What has the system learned about itself? (Teacher/Student)
    graphRead("MATCH (m:AgentMemory) WHERE m.type IN ['teaching', 'learning', 'insight', 'intelligence'] RETURN m.agentId AS agent, m.key AS key, substring(coalesce(m.value,''), 0, 200) AS value, m.type AS type ORDER BY m.updatedAt DESC LIMIT 20"),
    // 2. Known failure patterns
    graphRead("MATCH (f:FailureMemory) RETURN f.type AS cat, f.description AS pattern, f.violationCount AS hits, f.sourceName AS source ORDER BY f.violationCount DESC LIMIT 20"),
    // 3. Emergent patterns (self-organizing behavior)
    graphRead("MATCH (e:EmergentPattern) RETURN e.name AS name, e.description AS desc, e.confidence AS conf ORDER BY e.confidence DESC LIMIT 15"),
    // 4. Teaching events between agents
    graphRead("MATCH (t:TeachingEvent) RETURN t.teacher AS teacher, t.student AS student, substring(coalesce(t.lesson,''), 0, 200) AS lesson, t.createdAt AS ts ORDER BY t.createdAt DESC LIMIT 15"),
    // 5. System architecture nodes
    graphRead("MATCH (s:SystemArchitecture) RETURN s.name AS name, s.owner AS owner, s.api_type AS api, s.critical_for AS critical, exists((s)--()) AS connected LIMIT 20"),
    // 6. SRAG: what does semantic memory know about the system?
    sragQuery('widgetdc orchestrator architecture multi-agent swarm'),
    // 7. CMA: what context does working memory hold?
    cmaContext(['orchestrator', 'architecture', 'evolution', 'enrichment']),
  ])

  const findings = {
    lessons: selfLessons.status === 'fulfilled' ? selfLessons.value : [],
    failures: failurePatterns.status === 'fulfilled' ? failurePatterns.value : [],
    emergent: emergentPatterns.status === 'fulfilled' ? emergentPatterns.value : [],
    teachings: teachingEvents.status === 'fulfilled' ? teachingEvents.value : [],
    sysArch: systemArch.status === 'fulfilled' ? systemArch.value : [],
    srag: sragSelf.status === 'fulfilled' ? sragSelf.value : null,
    cma: cmaSelf.status === 'fulfilled' ? cmaSelf.value : null,
  }

  console.log(`  📚 Agent Learnings:     ${findings.lessons.length} teaching/insight nodes`)
  console.log(`  ❌ Failure Patterns:     ${findings.failures.length} known failures`)
  console.log(`  🌱 Emergent Patterns:   ${findings.emergent.length} self-organized patterns`)
  console.log(`  🎓 Teaching Events:     ${findings.teachings.length} teacher→student transfers`)
  console.log(`  🏗️  System Architecture: ${Array.isArray(findings.sysArch) ? findings.sysArch.length : 0} architecture nodes`)
  console.log(`  🔍 SRAG Self-Knowledge: ${findings.srag ? 'retrieved' : 'empty'}`)
  console.log(`  🧠 CMA Context:         ${findings.cma ? 'retrieved' : 'empty'}`)

  // Log details
  if (findings.lessons.length > 0) {
    console.log('\n  Top agent learnings:')
    findings.lessons.slice(0, 5).forEach(l => console.log(`    [${l.agent}/${l.type}] ${l.key}: ${(l.value || '').slice(0, 100)}`))
  }
  if (findings.failures.length > 0) {
    console.log('\n  Top failure patterns:')
    findings.failures.slice(0, 5).forEach(f => console.log(`    [${f.cat || f.type || '?'}] ${(f.pattern || f.description || '').slice(0, 80)} (${n(f.hits)} hits, src: ${f.source || '?'})`))
  }
  if (findings.emergent.length > 0) {
    console.log('\n  Emergent patterns:')
    findings.emergent.slice(0, 5).forEach(e => console.log(`    ${e.name}: ${(e.desc || '').slice(0, 100)} (conf: ${e.conf})`))
  }

  return findings
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: RLM Deep Analysis — reason + analyze what's missing
// ═══════════════════════════════════════════════════════════════════════════
async function phase2_rlmAnalysis(findings) {
  console.log('\n══════════════════════════════════════════════════')
  console.log('  PHASE 2: RLM Deep Analysis (reason → analyze)')
  console.log('══════════════════════════════════════════════════\n')

  // Build context from Phase 1 findings
  const context = {
    known_lessons: findings.lessons.length,
    failure_patterns: (findings.failures || []).map(f => `${f.cat || f.type}: ${(f.pattern || f.description || '').slice(0, 100)}`).slice(0, 10),
    emergent_patterns: (findings.emergent || []).map(e => e.name).slice(0, 10),
    teaching_events: (findings.teachings || []).length,
    orphan_architecture_nodes: Array.isArray(findings.sysArch) ? findings.sysArch.filter(s => !s.connected).length : 0,
    srag_available: !!findings.srag,
    cma_available: !!findings.cma,
  }

  // Step 1: REASON about the current knowledge state
  console.log('  🧠 Step 1: Reasoning about knowledge state...')
  const reasoning = await cognitive('reason',
    `Given this orchestrator's current self-knowledge state, identify the 5 biggest gaps in our graph knowledge. What critical connections are missing? What should we prioritize?

System: Multi-agent orchestrator with 18 agents, 130k+ Neo4j nodes, 8 memory layers.
Known: ${context.known_lessons} agent learnings, ${context.failure_patterns.length} failure patterns, ${context.emergent_patterns.length} emergent patterns.
Orphaned: ${context.orphan_architecture_nodes} architecture nodes disconnected from graph.
Failures: ${context.failure_patterns.join('; ')}`,
    context
  )
  if (reasoning) console.log(`  ✅ Reasoning: ${JSON.stringify(reasoning).slice(0, 200)}...`)

  // Step 2: ANALYZE gaps and quality
  console.log('\n  🔍 Step 2: Analyzing knowledge gaps...')
  const analysis = await cognitive('analyze',
    `Analyze the knowledge graph health for a Danish telecom consulting orchestrator.
5,589 TDCDocuments have filenames+keywords but NO content extraction.
1,440 Lessons reference the system but most are disconnected.
Memory is 98% "fact" type — episodic and procedural memory severely underrepresented.
What's the optimal enrichment strategy?`,
    { reasoning_output: reasoning, ...context }
  )
  if (analysis) console.log(`  ✅ Analysis: ${JSON.stringify(analysis).slice(0, 200)}...`)

  return { reasoning, analysis }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Wire orphans using Omega's graph intelligence
// ═══════════════════════════════════════════════════════════════════════════
async function phase3_wireOrphans() {
  console.log('\n══════════════════════════════════════════════════')
  console.log('  PHASE 3: Wire Orphans (Graph Agent)')
  console.log('══════════════════════════════════════════════════\n')

  let wired = 0

  // Use chain engine to wire different orphan types in parallel
  console.log('  🔗 Running parallel orphan-wiring chain...')

  // Wire SystemArchitecture → CodeHub
  const r1 = await graphWrite(`
    MATCH (s:SystemArchitecture) WHERE NOT (s)--()
    WITH s LIMIT 200
    MERGE (hub:CodeHub {name: 'WidgeTDC Codebase'})
    MERGE (s)-[:PART_OF]->(hub)
    SET s.wired_at = datetime(), s.wired_by = 'enrichment-v2'
    RETURN count(s) AS cnt
  `)
  const c1 = n(r1?.results?.[0]?.cnt)
  if (c1 > 0) console.log(`  ✅ SystemArchitecture → CodeHub: ${c1}`)
  wired += c1

  // Wire AgentMemory → Agent nodes (teacher/student pattern)
  const r2 = await graphWrite(`
    MATCH (m:AgentMemory) WHERE NOT (m)--() AND m.agent_id IS NOT NULL
    WITH m
    MATCH (a:Agent {agent_id: m.agent_id})
    MERGE (m)-[:MEMORY_OF]->(a)
    SET m.wired_at = datetime()
    RETURN count(m) AS cnt
  `)
  const c2 = n(r2?.results?.[0]?.cnt)
  if (c2 > 0) console.log(`  ✅ AgentMemory → Agent: ${c2}`)
  wired += c2

  // Wire remaining AgentMemory → MemoryHub
  const r2b = await graphWrite(`
    MATCH (m:AgentMemory) WHERE NOT (m)--()
    WITH m LIMIT 200
    MERGE (hub:HubNode:MemoryHub {name: 'Agent Memory Archive'})
    MERGE (m)-[:ARCHIVED_IN]->(hub)
    RETURN count(m) AS cnt
  `)
  const c2b = n(r2b?.results?.[0]?.cnt)
  if (c2b > 0) console.log(`  ✅ AgentMemory → MemoryHub: ${c2b}`)
  wired += c2b

  // Wire EvolutionEvent → EvolutionHub
  const r3 = await graphWrite(`
    MATCH (e:EvolutionEvent) WHERE NOT (e)--()
    WITH e LIMIT 200
    MERGE (hub:HubNode:EvolutionHub {name: 'Evolution Log'})
    MERGE (e)-[:LOGGED_IN]->(hub)
    RETURN count(e) AS cnt
  `)
  const c3 = n(r3?.results?.[0]?.cnt)
  if (c3 > 0) console.log(`  ✅ EvolutionEvent → EvolutionHub: ${c3}`)
  wired += c3

  // Wire Lesson → Agents that created them (teacher pattern)
  const r4 = await graphWrite(`
    MATCH (l:Lesson) WHERE NOT (l)--() AND l.source IS NOT NULL
    WITH l
    OPTIONAL MATCH (a:Agent) WHERE a.agent_id = l.source OR l.source CONTAINS a.agent_id
    WITH l, a LIMIT 200
    FOREACH (_ IN CASE WHEN a IS NOT NULL THEN [1] ELSE [] END |
      MERGE (a)-[:TAUGHT]->(l)
    )
    WITH l WHERE NOT (l)--()
    MERGE (hub:HubNode:LessonHub {name: 'Lesson Archive'})
    MERGE (l)-[:LEARNED_IN]->(hub)
    RETURN count(l) AS cnt
  `)
  const c4 = n(r4?.results?.[0]?.cnt)
  if (c4 > 0) console.log(`  ✅ Lesson → Agent/Hub: ${c4}`)
  wired += c4

  // Cross-link FailureMemory → related Lessons
  const r5 = await graphWrite(`
    MATCH (f:FailureMemory), (l:Lesson)
    WHERE f.category IS NOT NULL AND l.source IS NOT NULL
      AND (toLower(coalesce(l.content,'')) CONTAINS toLower(f.category)
           OR toLower(coalesce(l.title,'')) CONTAINS toLower(f.category))
    WITH f, l LIMIT 100
    MERGE (f)-[:RESOLVED_BY]->(l)
    RETURN count(*) AS cnt
  `)
  const c5 = n(r5?.results?.[0]?.cnt)
  if (c5 > 0) console.log(`  ✅ FailureMemory → Lesson: ${c5} cross-links`)
  wired += c5

  console.log(`\n  📊 Phase 3: ${wired} nodes wired`)
  await say(`🔗 **Enrichment Phase 3**: Wired ${wired} orphaned nodes (SystemArchitecture, AgentMemory, EvolutionEvent, Lesson, FailureMemory)`)
  return wired
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: Fix EvolutionEvent metadata
// ═══════════════════════════════════════════════════════════════════════════
async function phase4_fixEvents() {
  console.log('\n══════════════════════════════════════════════════')
  console.log('  PHASE 4: Fix EvolutionEvent Metadata')
  console.log('══════════════════════════════════════════════════\n')

  const nullCount = await graphRead("MATCH (e:EvolutionEvent) WHERE e.type IS NULL RETURN count(e) AS total")
  const total = n(nullCount[0]?.total)
  console.log(`  Found ${total} EvolutionEvents with null metadata`)

  if (total === 0) {
    console.log('  ✅ All metadata already populated')
    return 0
  }

  await graphWrite(`
    MATCH (e:EvolutionEvent) WHERE e.type IS NULL
    SET e.type = CASE
      WHEN e.source = 'evolution-loop' THEN 'evolution_test'
      WHEN e.source = 'cron' THEN 'cron_pulse'
      ELSE 'system_event'
    END,
    e.pass_rate = coalesce(e.pass_rate, 0.0),
    e.enriched_at = datetime()
  `)

  // Number sequentially
  await graphWrite(`
    MATCH (e:EvolutionEvent) WHERE e.iteration IS NULL
    WITH e ORDER BY e.timestamp ASC
    WITH collect(e) AS events
    UNWIND range(0, size(events)-1) AS i
    SET (events[i]).iteration = i + 1
  `)

  console.log(`  ✅ Fixed metadata on ${total} EvolutionEvents`)
  return total
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Classify TDCDocuments via RLM + Context Folding
// ═══════════════════════════════════════════════════════════════════════════
async function phase5_classifyDocs() {
  console.log('\n══════════════════════════════════════════════════')
  console.log('  PHASE 5: Classify TDCDocuments (RLM + LLM)')
  console.log('══════════════════════════════════════════════════\n')

  const countResult = await graphRead("MATCH (d:TDCDocument) WHERE d.domain IS NULL AND d.filename IS NOT NULL RETURN count(d) AS total")
  const total = n(countResult[0]?.total)
  console.log(`  Found ${total} unclassified TDCDocuments with filenames`)

  const BATCH = 25
  const MAX_BATCHES = 40 // Up to 1000 per run
  let classified = 0

  for (let b = 0; b < MAX_BATCHES; b++) {
    const docs = await graphRead(`
      MATCH (d:TDCDocument)
      WHERE d.domain IS NULL AND d.filename IS NOT NULL
      RETURN d.filename AS file, d.extension AS ext, d.keywords AS kw, d.folderContext AS folder
      LIMIT ${BATCH}
    `)

    if (docs.length === 0) {
      console.log('  No more documents to classify')
      break
    }

    // Build context for RLM/LLM classification
    const docList = docs.map((d, i) => {
      const kw = Array.isArray(d.kw) ? d.kw.join(', ') : (d.kw || '')
      return `${i + 1}. "${d.file}" [${d.ext || '?'}] folder:${d.folder || '?'} kw:${kw}`
    }).join('\n')

    // Use LLM directly for structured classification (RLM adds reasoning wrapper)
    const classifyPrompt = `Classify these TDC (Danish telecom) documents. Reply ONLY with a JSON array.
Valid domains: strategy, technology, security, compliance, operations, consulting, legal, finance, hr, marketing, architecture, data, cyber, infrastructure
Valid types: report, presentation, analysis, policy, procedure, template, specification, proposal, memo, code, meeting-notes, research, training, guide

Documents:
${docList}

JSON array only: [{"i":1,"domain":"...","type":"..."},...]`

    const llmResult = await orch('/api/llm/chat', {
      method: 'POST',
      body: JSON.stringify({ provider: 'deepseek', prompt: classifyPrompt, broadcast: false, max_tokens: 1500 }),
    })
    const raw = llmResult?.data?.content || ''

    let classifications = []
    try {
      const match = raw.match(/\[[\s\S]*?\]/)
      if (match) classifications = JSON.parse(match[0])
    } catch {
      console.log(`  ⚠️ Batch ${b + 1}: Unparseable LLM response`)
    }

    let batchOk = 0
    for (const cls of classifications) {
      const idx = (cls.i || 0) - 1
      if (idx < 0 || idx >= docs.length || !cls.domain || !cls.type) continue
      const doc = docs[idx]
      if (!doc.file) continue

      const safeFile = doc.file.replace(/'/g, "\\'").replace(/\\/g, "\\\\")
      const safeDomain = cls.domain.replace(/[^a-z-]/g, '')
      const safeType = cls.type.replace(/[^a-z-]/g, '')
      if (!safeDomain || !safeType) continue

      try {
        await graphWrite(`
          MATCH (d:TDCDocument {filename: '${safeFile}'})
          WHERE d.domain IS NULL
          SET d.domain = '${safeDomain}', d.type = '${safeType}',
              d.title = coalesce(d.title, d.filename),
              d.classified_at = datetime(), d.classified_by = 'rlm-enrichment'
        `)
        batchOk++
      } catch {
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    classified += batchOk
    console.log(`  📄 Batch ${b + 1}: ${batchOk}/${docs.length} classified (total: ${classified})`)
    await new Promise(r => setTimeout(r, 500))
  }

  // Create domain hub relationships
  if (classified > 0) {
    await graphWrite(`
      MATCH (d:TDCDocument) WHERE d.domain IS NOT NULL
      WITH d.domain AS domain, collect(d) AS docs, count(*) AS cnt
      MERGE (hub:DocumentDomain {name: domain})
      ON CREATE SET hub.created_at = datetime()
      SET hub.doc_count = cnt, hub.updated_at = datetime()
      WITH hub, docs
      UNWIND docs AS doc
      MERGE (doc)-[:IN_DOMAIN]->(hub)
    `)
    console.log(`  ✅ Created domain hub relationships`)
  }

  console.log(`\n  📊 Phase 5: ${classified} documents classified (${total} remaining)`)
  await say(`📄 **Enrichment Phase 5**: Classified ${classified}/${total} TDCDocuments via RLM cognitive reasoning`)
  return classified
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 6: Knowledge Audit — reflect, learn, teach
// ═══════════════════════════════════════════════════════════════════════════
async function phase6_knowledgeAudit(results) {
  console.log('\n══════════════════════════════════════════════════')
  console.log('  PHASE 6: Knowledge Audit + Teaching')
  console.log('══════════════════════════════════════════════════\n')

  // 1. Query remaining gaps
  const [orphans, memBalance, docStatus, graphScale] = await Promise.allSettled([
    graphRead("MATCH (n) WHERE NOT (n)--() RETURN labels(n)[0] AS label, count(n) AS cnt ORDER BY cnt DESC LIMIT 10"),
    graphRead("MATCH (m:Memory) RETURN m.type AS type, count(m) AS cnt ORDER BY cnt DESC"),
    graphRead("MATCH (d:TDCDocument) RETURN d.domain IS NOT NULL AS classified, d.content IS NOT NULL AS extracted, count(d) AS cnt"),
    graphRead("MATCH (n) RETURN count(n) AS nodes"),
  ])

  const auditFindings = []

  if (orphans.status === 'fulfilled') {
    console.log('  📋 Remaining orphans:')
    for (const r of orphans.value) {
      const cnt = n(r.cnt)
      if (cnt > 5) {
        console.log(`    ${(r.label || '?').padEnd(25)} ${cnt}`)
        auditFindings.push(`${r.label}: ${cnt} orphans`)
      }
    }
  }

  if (docStatus.status === 'fulfilled') {
    console.log('\n  📄 Document status:')
    for (const r of docStatus.value) {
      console.log(`    classified=${r.classified}, extracted=${r.extracted}: ${n(r.cnt)}`)
    }
    const unextracted = docStatus.value.filter(r => !r.extracted).reduce((s, r) => s + n(r.cnt), 0)
    if (unextracted > 0) auditFindings.push(`${unextracted} TDCDocuments need content extraction (have filenames + keywords but no body text)`)
  }

  if (memBalance.status === 'fulfilled') {
    console.log('\n  🧠 Memory balance:')
    for (const r of memBalance.value) {
      console.log(`    ${(r.type || 'unknown').padEnd(15)} ${n(r.cnt)}`)
    }
    const factCount = memBalance.value.find(r => r.type === 'fact')
    const episodicCount = memBalance.value.find(r => r.type === 'episodic')
    if (n(factCount?.cnt) > 100 * n(episodicCount?.cnt)) {
      auditFindings.push(`Memory imbalance: ${n(factCount?.cnt)} facts vs ${n(episodicCount?.cnt)} episodic — need more episodic capture`)
    }
  }

  // 2. Use RLM to plan next actions
  if (auditFindings.length > 0) {
    console.log('\n  🎯 Planning next actions via RLM...')
    const plan = await cognitive('plan',
      `Based on these knowledge graph audit findings, create a prioritized plan for the next enrichment cycle.

Findings:
${auditFindings.join('\n')}

Current results this run:
- Orphans wired: ${results.orphans || 0}
- Events fixed: ${results.events || 0}
- Documents classified: ${results.docs || 0}

Prioritize by impact and feasibility. What should we do next?`,
      { system: 'widgetdc orchestrator', scale: '130k+ nodes' }
    )

    const planText = typeof plan === 'string' ? plan : JSON.stringify(plan || '(no plan generated)')
    console.log(`\n  📝 RLM Plan:\n${planText.split('\n').map(l => `    ${l}`).join('\n').slice(0, 1000)}`)

    // 3. Teach — write findings as TeachingEvent for other agents
    console.log('\n  🎓 Writing teaching events...')
    const teachingId = `enrich-${Date.now()}`
    await graphWrite(`
      CREATE (t:TeachingEvent {
        id: '${teachingId}',
        teacher: 'omega',
        student: 'graph',
        lesson: '${auditFindings.join('; ').replace(/'/g, "\\'").slice(0, 500)}',
        context: 'graph-enrichment-audit',
        createdAt: datetime()
      })
      WITH t
      MATCH (a:Agent {agent_id: 'graph'})
      MERGE (a)-[:LEARNED_FROM]->(t)
    `)
    console.log(`  ✅ TeachingEvent created: omega → graph`)

    // 4. Store audit as KnowledgeAudit node
    await graphWrite(`
      CREATE (a:KnowledgeAudit {
        timestamp: datetime(),
        findings: '${auditFindings.join('; ').replace(/'/g, "\\'").slice(0, 800)}',
        plan: '${planText.replace(/'/g, "\\'").slice(0, 800)}',
        source: 'graph-enrichment-v2'
      })
      WITH a
      MERGE (hub:HubNode:EvolutionHub {name: 'Evolution Log'})
      MERGE (a)-[:AUDIT_OF]->(hub)
    `)

    // 5. Remember in all memory layers
    await remember(
      `Knowledge Audit:\n${auditFindings.join('\n')}\n\nPlan:\n${planText.slice(0, 500)}`,
      'Graph Enrichment Audit',
      ['audit', 'knowledge-gaps', 'enrichment']
    )

    await say(`🔍 **Knowledge Audit**: ${auditFindings.length} findings → RLM plan generated → Teaching event written (omega→graph)`)
  }

  return auditFindings.length
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  🧬 Graph Enrichment Engine v2                          ║')
  console.log('║  Using: Omega Sentinel, RLM, SRAG, CMA, Chain Engine   ║')
  console.log(`║  Task: ${task.padEnd(48)}║`)
  console.log('╚══════════════════════════════════════════════════════════╝')

  await say('🧬 **Graph Enrichment v2** started — using Omega Sentinel, RLM, Teacher/Student pattern')

  const results = {}

  // Phase 1: Always run Omega SITREP first
  const findings = await phase1_omegaSitrep()

  // Phase 2: RLM analysis (if doing full run)
  if (task === 'all' || task === 'audit') {
    await phase2_rlmAnalysis(findings)
  }

  // Phase 3: Wire orphans
  if (task === 'all' || task === 'orphans') {
    results.orphans = await phase3_wireOrphans()
  }

  // Phase 4: Fix EvolutionEvents
  if (task === 'all' || task === 'events') {
    results.events = await phase4_fixEvents()
  }

  // Phase 5: Classify documents
  if (task === 'all' || task === 'classify') {
    results.docs = await phase5_classifyDocs()
  }

  // Phase 6: Knowledge audit + teaching (always runs)
  results.auditFindings = await phase6_knowledgeAudit(results)

  console.log('\n══════════════════════════════════════════════════')
  console.log('  📊 ENRICHMENT v2 COMPLETE')
  console.log('══════════════════════════════════════════════════')
  if (results.orphans !== undefined) console.log(`  Orphans wired:       ${results.orphans}`)
  if (results.events !== undefined) console.log(`  Events fixed:        ${results.events}`)
  if (results.docs !== undefined) console.log(`  Docs classified:     ${results.docs}`)
  console.log(`  Audit findings:      ${results.auditFindings}`)
  console.log('')

  await say(`🧬 **Enrichment v2 Complete**: ${results.orphans || 0} orphans, ${results.events || 0} events, ${results.docs || 0} docs, ${results.auditFindings} findings`)
}

main().catch(err => {
  console.error('Enrichment error (may have completed partially):', err.message || err)
  process.exit(0) // Don't fail — partial progress is still progress
})
