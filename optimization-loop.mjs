#!/usr/bin/env node
/**
 * optimization-loop.mjs — Autonomous self-improving ratcheting engine.
 *
 * Inspired by karpathy/autoresearch. Adapts the git-ratcheting concept
 * for prompt/config optimization instead of ML training.
 *
 * Architecture:
 *   1. program.md — Human-controlled research direction
 *   2. optimizable configs — Mutable targets (prompts, chain params, RAG weights)
 *   3. eval corpus — Fixed benchmark queries with ground truth
 *   4. ratchet — Only improvements persist to graph + config
 *
 * Flow per experiment:
 *   Agent reads program.md + current best config + past results
 *   → Agent proposes config mutation
 *   → System evaluates against benchmark
 *   → If score improves: persist as new baseline (ratchet)
 *   → If score same/worse: discard, try next experiment
 *
 * Usage:
 *   node optimization-loop.mjs [experiments=50] [domain=all]
 *   node optimization-loop.mjs 100 rag
 *   node optimization-loop.mjs 30 chains
 *   node optimization-loop.mjs 20 cognitive
 *
 * Domains: all, rag, chains, cognitive, prompts
 */

const BASE = 'https://orchestrator-production-c27e.up.railway.app'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const API_KEY = process.env.ORCHESTRATOR_API_KEY || 'WidgeTDC_Orch_2026'
const BACKEND_KEY = process.env.WIDGETDC_API_KEY || 'Heravej_22'

const MAX_EXPERIMENTS = parseInt(process.argv[2] || '50')
const DOMAIN = process.argv[3] || 'all'

// ─── State ──────────────────────────────────────────────────────────────────
const experimentLog = []
let bestScore = 0
let bestConfig = null
let improvementCount = 0
let experimentsRun = 0

// ─── Helpers ────────────────────────────────────────────────────────────────
async function orch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(120000),
  })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
}

async function backend(tool, payload) {
  const res = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BACKEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json().catch(() => null)
  return data?.result ?? data
}

async function llm(prompt, maxTokens = 3000) {
  const res = await orch('/api/llm/chat', {
    method: 'POST',
    body: JSON.stringify({ provider: 'deepseek', prompt, broadcast: false, max_tokens: maxTokens }),
  })
  return res.body?.data?.content || ''
}

// ─── RLM Cognitive Proxy — reason, analyze, plan, fold ──────────────────────

async function cognitive(action, prompt, context = {}) {
  // RLM Engine requires specific body formats per action:
  //   reason: { prompt, task, depth, context: object }
  //   analyze: { prompt, task, context: object (NOT string!), analysis_dimensions: [] }
  //   plan: { prompt, task, context: object, constraints: [] }
  //   fold: { prompt, task, context: object }
  const ctxObj = typeof context === 'string' ? { info: context } : (context || {})

  const body = action === 'reason'
    ? { prompt, task: prompt, depth: 1, context: ctxObj }
    : action === 'analyze'
    ? { prompt, task: prompt, context: ctxObj, analysis_dimensions: ['optimization', 'risk'] }
    : action === 'plan'
    ? { prompt, task: prompt, context: ctxObj, constraints: ['single parameter change', 'must be JSON-serializable'] }
    : { prompt, task: prompt, context: ctxObj }

  const res = await orch(`/cognitive/${action}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`RLM ${action}: ${res.status}`)
  const data = res.body?.data?.result ?? res.body?.data ?? res.body
  return typeof data === 'string' ? data : JSON.stringify(data ?? '')
}

// ─── SRAG & CMA context retrieval ──────────────────────────────────────────

async function sragQuery(query) {
  try {
    const result = await backend('srag.query', { query })
    const items = Array.isArray(result) ? result : result?.results || result?.chunks || []
    return items.slice(0, 5).map(i => i.content || i.text || i.chunk || '').filter(Boolean)
  } catch { return [] }
}

async function dualRAG(query) {
  try {
    const res = await orch('/chat/rag', {
      method: 'POST',
      body: JSON.stringify({ query, max_results: 5 }),
    })
    return res.body?.data?.merged_context || ''
  } catch { return '' }
}

async function graphQuery(cypher) {
  const result = await backend('graph.read_cypher', { query: cypher })
  return result?.results || result || []
}

async function graphWrite(cypher) {
  return await backend('graph.write_cypher', { query: cypher })
}

function n(val) {
  if (val == null) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'object' && 'low' in val) return val.low
  return Number(val) || 0
}

// ─── Evaluation Benchmark ───────────────────────────────────────────────────
// Fixed corpus for reproducible evaluation. Each query has expected behavior.

const EVAL_CORPUS = {
  rag: [
    { query: 'insurance market trends', expect_results: true, expect_source: 'cypher', weight: 1 },
    { query: 'agent orchestration patterns', expect_results: true, expect_source: 'any', weight: 1 },
    { query: 'failure analysis methodology', expect_results: true, expect_source: 'any', weight: 1 },
    { query: 'McKinsey consulting framework', expect_results: true, expect_source: 'cypher', weight: 1.5 },
    { query: 'cybersecurity vulnerability CVE', expect_results: true, expect_source: 'cypher', weight: 1 },
    { query: 'strategic insight sustainability', expect_results: true, expect_source: 'any', weight: 1 },
    { query: 'multi-agent swarm coordination', expect_results: true, expect_source: 'any', weight: 1.2 },
    { query: 'knowledge graph evolution', expect_results: true, expect_source: 'any', weight: 1 },
    { query: 'context folding compression', expect_results: true, expect_source: 'any', weight: 0.8 },
    { query: 'rlm deep reasoning chain', expect_results: true, expect_source: 'any', weight: 1 },
  ],
  chains: [
    { name: 'sequential-graph-stats', mode: 'sequential', steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }], expect: 'completed', weight: 1 },
    { name: 'parallel-dual-query', mode: 'parallel', steps: [
      { agent_id: 'analyst-1', tool_name: 'graph.read_cypher', arguments: { query: 'MATCH (n:StrategicInsight) RETURN count(n) AS c' } },
      { agent_id: 'analyst-2', tool_name: 'graph.read_cypher', arguments: { query: 'MATCH (n:Pattern) RETURN count(n) AS c' } },
    ], expect: 'completed', weight: 1.5 },
    { name: 'adaptive-test', mode: 'adaptive', query: 'What are the top failure patterns?', steps: [
      { agent_id: 'analyst-1', tool_name: 'graph.read_cypher', arguments: { query: 'MATCH (f:FailureMemory) RETURN f.type AS t LIMIT 3' } },
    ], expect: 'completed', weight: 2 },
  ],
  cognitive: [
    { action: 'reason', prompt: 'What is the relationship between SRAG vector search and Neo4j graph traversal?', expect_length: 50, weight: 1 },
    { action: 'analyze', prompt: 'Analyze the tradeoffs between sequential and parallel chain execution', expect_length: 50, weight: 1 },
    { action: 'plan', prompt: 'Create a plan to improve RAG retrieval quality', expect_length: 30, weight: 1 },
  ],
  prompts: [
    { target: 'think', question: 'How should multi-agent debate work?', depth: 2, expect_has: 'think_id', weight: 1 },
    { target: 'summarize', params: { target: 'omega', limit: 5 }, expect_has: 'summary', weight: 1 },
  ],
}

// ─── Optimizable Config Space ───────────────────────────────────────────────
// These are the "dials" the agent can tune.

const CONFIG_SPACE = {
  rag: {
    max_results: { current: 10, min: 3, max: 25, type: 'int' },
    cypher_depth: { current: 2, min: 1, max: 4, type: 'int' },
    cypher_keyword_limit: { current: 5, min: 2, max: 10, type: 'int' },
    cypher_result_limit: { current: 15, min: 5, max: 30, type: 'int' },
    srag_timeout_ms: { current: 30000, min: 5000, max: 60000, type: 'int' },
    cypher_timeout_ms: { current: 15000, min: 5000, max: 30000, type: 'int' },
    score_default_cypher: { current: 0.7, min: 0.3, max: 1.0, type: 'float' },
    node_types: {
      current: 'StrategicInsight,Pattern,Lesson,Knowledge,Memory,TDCDocument',
      options: [
        'StrategicInsight,Pattern,Lesson,Knowledge,Memory,TDCDocument',
        'StrategicInsight,Pattern,Lesson,Knowledge,Memory,TDCDocument,CVE,AgentMemory',
        'StrategicInsight,Pattern,Lesson,Knowledge',
        'StrategicInsight,Pattern,Lesson,Knowledge,Memory,TDCDocument,McKinseyReport,Capability',
      ],
      type: 'enum',
    },
    stop_word_count: { current: 26, min: 10, max: 40, type: 'int' },
    min_keyword_length: { current: 3, min: 2, max: 5, type: 'int' },
  },
  chains: {
    default_timeout_ms: { current: 30000, min: 10000, max: 120000, type: 'int' },
    gvu_confidence_threshold: { current: 0.6, min: 0.3, max: 0.9, type: 'float' },
    complexity_classification_timeout: { current: 15000, min: 5000, max: 30000, type: 'int' },
  },
  cognitive: {
    reason_depth: { current: 0, min: 0, max: 3, type: 'int' },
    fold_max_tokens: { current: 2000, min: 500, max: 4000, type: 'int' },
    analyze_dimensions: {
      current: 'general',
      options: ['general', 'general,risk', 'general,risk,opportunity', 'strategic,tactical', 'technical,business'],
      type: 'enum',
    },
  },
}

// ─── Program.md — Research Direction ────────────────────────────────────────

const PROGRAM_MD = `
# Optimization Research Program

## Objective
Optimize the WidgeTDC Orchestrator's configuration for maximum quality, relevance, and speed.

## System Context
- Neo4j knowledge graph with 130k+ nodes (StrategicInsight, Pattern, Lesson, CVE, TDCDocument, etc.)
- SRAG vector search for semantic retrieval
- Neo4j Cypher for structured graph traversal
- Chain engine with sequential/parallel/loop/debate/adaptive modes
- RLM cognitive proxy for deep reasoning (reason, analyze, plan, fold)
- GVU debate with confidence scoring

## What You Can Tune
- RAG parameters: max_results, cypher_depth, keyword limits, timeouts, node types
- Chain parameters: timeouts, GVU confidence threshold, complexity classification
- Cognitive parameters: reasoning depth, fold token limits, analysis dimensions

## Constraints
- Changes must be JSON-serializable parameter adjustments
- Each experiment evaluates against a fixed benchmark corpus
- Metric: weighted quality score (0-100). Higher is better.
- Only tune ONE parameter per experiment for clean attribution
- Do NOT suggest changes to code structure, only parameter values

## Known Issues
- SRAG vector search frequently times out (30s+). RAG scoring doesn't penalize for SRAG absence.
- RAG score depends mainly on Cypher results quality, speed, and content length.
- Chains already score near 100%. Focus optimization on RAG and cognitive.
- Don't repeat experiments that already showed "no change" — try different parameters.
- Consider exploring: min_keyword_length, stop_word_count, cypher_timeout_ms, node_types variations.

## Recent Results
{{EXPERIMENT_LOG}}

## Current Best Score
{{BEST_SCORE}}/100 ({{IMPROVEMENT_COUNT}} improvements in {{EXPERIMENTS_RUN}} experiments)
`

// ─── Evaluators ──────────────────────────────────────────────────────────────

async function evaluateRAG(config) {
  const corpus = EVAL_CORPUS.rag
  let totalScore = 0
  let maxScore = 0

  for (const test of corpus) {
    maxScore += test.weight * 10
    try {
      const t0 = Date.now()
      const res = await orch('/chat/rag', {
        method: 'POST',
        body: JSON.stringify({
          query: test.query,
          max_results: config.max_results ?? 10,
          cypher_depth: config.cypher_depth ?? 2,
        }),
      })
      const ms = Date.now() - t0
      const data = res.body?.data

      if (!res.ok || !data) { continue }

      const resultCount = data.results?.length ?? 0
      const sragCount = data.srag_count ?? 0
      const cypherCount = data.cypher_count ?? 0

      // Score components
      let score = 0
      // Has results at all (3 points)
      if (resultCount > 0) score += 3
      // Has at least one source returning results (2 points)
      // SRAG often times out — don't penalize for single-source
      if (sragCount > 0 && cypherCount > 0) score += 2
      else if (cypherCount > 0) score += 2
      else if (sragCount > 0) score += 2
      // Result count quality (2 points)
      if (resultCount >= 3) score += 2
      else if (resultCount >= 1) score += 1
      // Speed bonus (2 points)
      if (ms < 5000) score += 2
      else if (ms < 15000) score += 1
      // Content quality — has actual text (1 point)
      if (data.merged_context?.length > 50) score += 1

      totalScore += score * test.weight
    } catch {
      // timeout or error = 0 score
    }
  }

  return (totalScore / maxScore) * 100
}

async function evaluateChains(config) {
  const corpus = EVAL_CORPUS.chains
  let totalScore = 0
  let maxScore = 0

  for (const test of corpus) {
    maxScore += test.weight * 10
    try {
      const t0 = Date.now()
      const res = await orch('/chains/execute', {
        method: 'POST',
        body: JSON.stringify({
          name: `opt-${test.name}`,
          mode: test.mode,
          query: test.query,
          steps: test.steps,
          confidence_threshold: config.gvu_confidence_threshold ?? 0.6,
        }),
      })
      const ms = Date.now() - t0

      if (!res.ok) { continue }

      const execId = res.body?.data?.execution_id
      if (!execId) { totalScore += 3 * test.weight; continue }

      // Poll for completion (max 30s)
      let status = 'running'
      let finalResult = null
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const poll = await orch(`/chains/status/${execId}`)
        if (poll.body?.data?.status !== 'running') {
          status = poll.body?.data?.status
          finalResult = poll.body?.data
          break
        }
      }

      let score = 0
      // Completed (4 points)
      if (status === 'completed') score += 4
      else if (status === 'failed') score += 1
      // All steps succeeded (3 points)
      if (finalResult?.steps_completed === finalResult?.steps_total) score += 3
      // Speed (2 points)
      const totalMs = finalResult?.duration_ms ?? ms
      if (totalMs < 5000) score += 2
      else if (totalMs < 15000) score += 1
      // Has output (1 point)
      if (finalResult?.final_output != null) score += 1

      totalScore += score * test.weight
    } catch {
      // error = 0
    }
  }

  return (totalScore / maxScore) * 100
}

async function evaluateCognitive(config) {
  const corpus = EVAL_CORPUS.cognitive
  let totalScore = 0
  let maxScore = 0

  for (const test of corpus) {
    maxScore += test.weight * 10
    try {
      const t0 = Date.now()
      const body = test.action === 'reason'
        ? { prompt: test.prompt, task: test.prompt, depth: config.reason_depth ?? 0 }
        : test.action === 'analyze'
        ? { prompt: test.prompt, task: test.prompt, context: test.prompt, analysis_dimensions: (config.analyze_dimensions ?? 'general').split(',') }
        : { prompt: test.prompt, task: test.prompt, context: { scope: 'optimization' }, constraints: [] }

      const res = await orch(`/cognitive/${test.action}`, { method: 'POST', body: JSON.stringify(body) })
      const ms = Date.now() - t0

      let score = 0
      // Got response (3 points)
      if (res.ok) score += 3
      // Response has content (3 points)
      const content = JSON.stringify(res.body?.data ?? res.body ?? '')
      if (content.length >= test.expect_length) score += 3
      else if (content.length > 20) score += 1
      // Speed (2 points)
      if (ms < 5000) score += 2
      else if (ms < 15000) score += 1
      // Quality indicator — multi-paragraph response (2 points)
      if (content.length > 200) score += 2
      else if (content.length > 100) score += 1

      totalScore += score * test.weight
    } catch {
      // 0
    }
  }

  return (totalScore / maxScore) * 100
}

async function evaluatePrompts(config) {
  const corpus = EVAL_CORPUS.prompts
  let totalScore = 0
  let maxScore = 0

  for (const test of corpus) {
    maxScore += test.weight * 10
    try {
      const t0 = Date.now()
      let res
      if (test.target === 'think') {
        res = await orch('/chat/think', { method: 'POST', body: JSON.stringify({ question: test.question, depth: test.depth }) })
      } else if (test.target === 'summarize') {
        res = await orch('/chat/summarize', { method: 'POST', body: JSON.stringify(test.params) })
      }
      const ms = Date.now() - t0

      let score = 0
      if (res?.ok) score += 4
      const body = JSON.stringify(res?.body ?? '')
      if (body.includes(test.expect_has)) score += 3
      if (ms < 10000) score += 2
      else if (ms < 30000) score += 1
      if (body.length > 100) score += 1

      totalScore += score * test.weight
    } catch {
      // 0
    }
  }

  return (totalScore / maxScore) * 100
}

// ─── Master Evaluator ────────────────────────────────────────────────────────

async function evaluate(config, domain) {
  const scores = {}

  if (domain === 'all' || domain === 'rag') {
    scores.rag = await evaluateRAG(config.rag ?? CONFIG_SPACE.rag)
  }
  if (domain === 'all' || domain === 'chains') {
    scores.chains = await evaluateChains(config.chains ?? CONFIG_SPACE.chains)
  }
  if (domain === 'all' || domain === 'cognitive') {
    scores.cognitive = await evaluateCognitive(config.cognitive ?? CONFIG_SPACE.cognitive)
  }
  if (domain === 'all' || domain === 'prompts') {
    scores.prompts = await evaluatePrompts(config.prompts ?? {})
  }

  // Weighted average
  const weights = { rag: 0.35, chains: 0.25, cognitive: 0.25, prompts: 0.15 }
  let totalWeight = 0
  let totalScore = 0
  for (const [key, score] of Object.entries(scores)) {
    const w = weights[key] ?? 0.25
    totalScore += score * w
    totalWeight += w
  }

  const overall = totalWeight > 0 ? totalScore / totalWeight : 0
  return { overall: Math.round(overall * 100) / 100, scores }
}

// ─── Config Extraction (current values) ─────────────────────────────────────

function getCurrentConfig() {
  const config = {}
  for (const [domain, params] of Object.entries(CONFIG_SPACE)) {
    config[domain] = {}
    for (const [key, spec] of Object.entries(params)) {
      config[domain][key] = spec.current
    }
  }
  return config
}

// ─── Agent: Propose Mutation (RLM-powered) ─────────────────────────────────
// Uses 3 RLM layers:
//   1. cognitive/fold — compress experiment history for context window
//   2. dual-RAG — retrieve relevant knowledge from graph + SRAG
//   3. cognitive/reason — deep reasoning to propose experiment
//   Fallback: LLM if RLM unavailable

async function proposeExperiment(currentConfig, recentLog) {
  const programFilled = PROGRAM_MD
    .replace('{{EXPERIMENT_LOG}}', recentLog || '(no experiments yet)')
    .replace('{{BEST_SCORE}}', bestScore.toFixed(1))
    .replace('{{IMPROVEMENT_COUNT}}', String(improvementCount))
    .replace('{{EXPERIMENTS_RUN}}', String(experimentsRun))

  try {
    // Step 1: Context Folding IN — compress experiment history
    let compressedHistory = recentLog || '(no experiments yet)'
    if (recentLog && recentLog.length > 500) {
      try {
        const folded = await cognitive('fold',
          `Compress this experiment log to key patterns. What worked? What failed? What's untried?\n\n${recentLog}`,
          { experiments_run: experimentsRun, improvements: improvementCount }
        )
        if (folded && folded.length > 20) compressedHistory = folded
      } catch { /* keep uncompressed */ }
    }

    // Step 2: Dual-RAG — retrieve relevant optimization knowledge
    let ragContext = ''
    try {
      ragContext = await dualRAG('optimization parameter tuning agent configuration')
      if (ragContext.length > 500) ragContext = ragContext.slice(0, 500)
    } catch { /* no RAG context */ }

    // Step 3: RLM Reason — deep reasoning for experiment proposal
    const reasonPrompt = `You are an optimization agent using ratcheting (autoresearch pattern).

## Program
${programFilled}

## Compressed Experiment History
${compressedHistory}

## Current Config
${JSON.stringify(currentConfig, null, 2)}

## Config Space
${JSON.stringify(CONFIG_SPACE, null, 2)}

${ragContext ? `## Retrieved Knowledge\n${ragContext}\n` : ''}

## Task
Reason about which single parameter change would most likely improve the quality score.
Consider: what domains are weakest? What hasn't been tried? What patterns from improvements suggest?

Reply ONLY with valid JSON:
{"domain":"rag|chains|cognitive","parameter":"param_name","old_value":<current>,"new_value":<proposed>,"hypothesis":"reason"}`

    const response = await cognitive('reason', reasonPrompt, {
      config_space: Object.keys(CONFIG_SPACE),
      best_score: bestScore,
      experiments_run: experimentsRun,
    })

    // Parse JSON from RLM response
    const match = String(response).match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])

    // RLM returned reasoning but no JSON — extract with LLM
    const extractPrompt = `Extract the JSON experiment proposal from this reasoning:\n\n${String(response).slice(0, 1000)}\n\nReply ONLY with valid JSON: {"domain":"...","parameter":"...","old_value":...,"new_value":...,"hypothesis":"..."}`
    const extracted = await llm(extractPrompt, 300)
    const jsonMatch = extracted.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])

  } catch (err) {
    // Fallback to direct LLM if RLM fails
    console.log(`  (RLM fallback: ${err.message?.slice(0, 60)})`)
  }

  // Fallback: direct LLM
  const fallbackPrompt = `${programFilled}

## Current Config
${JSON.stringify(currentConfig, null, 2)}

## Config Space
${JSON.stringify(CONFIG_SPACE, null, 2)}

Propose ONE parameter change. Reply ONLY with JSON:
{"domain":"rag|chains|cognitive","parameter":"param_name","old_value":<current>,"new_value":<proposed>,"hypothesis":"reason"}`

  const response = await llm(fallbackPrompt, 500)
  try {
    const match = response.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } catch {}
  return null
}

// ─── Apply Mutation ─────────────────────────────────────────────────────────

function applyMutation(config, mutation) {
  if (!mutation?.domain || !mutation?.parameter) return config

  const newConfig = JSON.parse(JSON.stringify(config))
  if (!newConfig[mutation.domain]) newConfig[mutation.domain] = {}
  newConfig[mutation.domain][mutation.parameter] = mutation.new_value
  return newConfig
}

// ─── Persist Results to Graph ───────────────────────────────────────────────

async function persistExperiment(exp) {
  try {
    const safe = (s) => String(s || '').replace(/'/g, "\\'").slice(0, 300)
    await graphWrite(`
      CREATE (e:OptimizationExperiment {
        experiment_id: ${exp.id},
        domain: '${safe(exp.domain)}',
        parameter: '${safe(exp.parameter)}',
        old_value: '${safe(JSON.stringify(exp.old_value))}',
        new_value: '${safe(JSON.stringify(exp.new_value))}',
        hypothesis: '${safe(exp.hypothesis)}',
        baseline_score: ${exp.baseline_score},
        new_score: ${exp.new_score},
        improvement: ${exp.improvement},
        ratcheted: ${exp.ratcheted},
        duration_ms: ${exp.duration_ms},
        timestamp: datetime(),
        valid_from: datetime(),
        valid_to: datetime('9999-12-31T23:59:59Z')
      })
      WITH e
      MERGE (hub:HubNode:OptimizationHub {name: 'Optimization Log'})
      MERGE (e)-[:LOGGED_IN]->(hub)
    `)
  } catch {}
}

async function persistBestConfig(config, score) {
  try {
    await graphWrite(`
      MERGE (c:OptimizationConfig {name: 'best_config'})
      SET c.config = '${JSON.stringify(config).replace(/'/g, "\\'")}',
          c.score = ${score},
          c.updated_at = datetime(),
          c.valid_from = datetime()
    `)
  } catch {}
}

// ─── Omega Sentinel Self-Knowledge Scan ─────────────────────────────────────

async function scanSelfKnowledge() {
  console.log('\n  Phase 0: Omega Sentinel Self-Knowledge Scan')
  console.log('  Using: Graph, SRAG, RLM, Dual-RAG')

  try {
    // Parallel: Graph scan + SRAG scan + previous optimization results
    const [learnings, failures, architecture, prevOptimizations, sragKnowledge, ragContext] = await Promise.allSettled([
      graphQuery("MATCH (m:AgentMemory) WHERE m.type = 'learning' RETURN m.agentId AS agent, m.value AS value LIMIT 10"),
      graphQuery("MATCH (f:FailureMemory) RETURN f.type AS type, f.description AS desc, f.violationCount AS hits LIMIT 10"),
      graphQuery("MATCH (s:SystemArchitecture) RETURN s.name AS name, s.owner AS owner LIMIT 10"),
      graphQuery("MATCH (o:OptimizationExperiment) WHERE o.ratcheted = true RETURN o.domain AS domain, o.parameter AS param, o.improvement AS gain ORDER BY o.experiment_id DESC LIMIT 10"),
      sragQuery('optimization parameter tuning configuration improvement'),
      dualRAG('system optimization learnings failure patterns'),
    ])

    const ctx = {
      learnings: learnings.status === 'fulfilled' ? learnings.value.length : 0,
      failures: failures.status === 'fulfilled' ? failures.value.length : 0,
      architecture: architecture.status === 'fulfilled' ? architecture.value.length : 0,
      prevOptimizations: prevOptimizations.status === 'fulfilled' ? prevOptimizations.value : [],
      sragHits: sragKnowledge.status === 'fulfilled' ? sragKnowledge.value.length : 0,
      ragContext: ragContext.status === 'fulfilled' ? (ragContext.value || '').slice(0, 300) : '',
    }

    console.log(`  Graph:  ${ctx.learnings} learnings | ${ctx.failures} failures | ${ctx.architecture} architecture`)
    console.log(`  SRAG:   ${ctx.sragHits} semantic hits`)
    console.log(`  RAG:    ${ctx.ragContext.length > 0 ? 'retrieved' : 'empty'}`)
    console.log(`  Prev:   ${ctx.prevOptimizations.length} previous ratcheted improvements`)

    // RLM Analyze: reason about system state for optimization strategy
    if (ctx.prevOptimizations.length > 0) {
      try {
        const prevSummary = ctx.prevOptimizations.map(o => `${o.domain}.${o.param}: +${n(o.gain)}`).join(', ')
        const analysis = await cognitive('analyze',
          `Previous successful optimizations: ${prevSummary}. What patterns do you see? Which domains still have room for improvement?`,
          { failures: ctx.failures, architecture: ctx.architecture }
        )
        console.log(`  RLM:    ${String(analysis).slice(0, 120)}...`)
      } catch {}
    }

    return ctx
  } catch {
    return { learnings: 0, failures: 0, architecture: 0, prevOptimizations: [], sragHits: 0, ragContext: '' }
  }
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`
${'═'.repeat(60)}
  OPTIMIZATION LOOP — Autonomous Ratcheting Engine
  Inspired by karpathy/autoresearch
${'═'.repeat(60)}
  Domain:      ${DOMAIN}
  Experiments: ${MAX_EXPERIMENTS}
  Endpoint:    ${BASE}
${'═'.repeat(60)}
`)

  // Phase 0: System self-knowledge scan
  const selfKnowledge = await scanSelfKnowledge()

  // Phase 1: Baseline evaluation
  console.log('\n  Phase 1: Establishing baseline...')
  const currentConfig = getCurrentConfig()
  bestConfig = currentConfig
  const baseline = await evaluate(currentConfig, DOMAIN)
  bestScore = baseline.overall

  console.log(`
  Baseline Score: ${bestScore.toFixed(1)}/100
  Breakdown: ${Object.entries(baseline.scores).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(', ')}
`)

  // Phase 2: Load previous optimization results from graph
  let previousBest = null
  try {
    const prev = await graphQuery("MATCH (c:OptimizationConfig {name: 'best_config'}) RETURN c.score AS score, c.config AS config LIMIT 1")
    if (prev[0]?.score && prev[0].score > bestScore) {
      previousBest = prev[0]
      console.log(`  Found previous best in graph: ${n(previousBest.score)}/100`)
    }
  } catch {}

  // Phase 3: Experiment loop
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  Phase 3: Running experiments...')
  console.log(`${'═'.repeat(60)}`)

  for (let i = 1; i <= MAX_EXPERIMENTS; i++) {
    const t0 = Date.now()
    experimentsRun = i

    // Build recent experiment log for agent context
    const recentLog = experimentLog.slice(-10).map(e =>
      `  [${e.ratcheted ? 'IMPROVED' : 'discarded'}] ${e.domain}.${e.parameter}: ${JSON.stringify(e.old_value)} → ${JSON.stringify(e.new_value)} | score: ${e.baseline_score.toFixed(1)} → ${e.new_score.toFixed(1)} (${e.improvement >= 0 ? '+' : ''}${e.improvement.toFixed(1)}) | "${e.hypothesis}"`
    ).join('\n')

    // Agent proposes mutation
    process.stdout.write(`\n  [${i}/${MAX_EXPERIMENTS}] Proposing... `)
    const mutation = await proposeExperiment(bestConfig, recentLog)

    if (!mutation) {
      console.log('agent returned invalid proposal, skipping')
      continue
    }

    process.stdout.write(`${mutation.domain}.${mutation.parameter}: ${JSON.stringify(mutation.old_value)} → ${JSON.stringify(mutation.new_value)}`)

    // Apply mutation and evaluate
    const mutatedConfig = applyMutation(bestConfig, mutation)
    // Always evaluate ALL domains for fair overall score comparison
    const result = await evaluate(mutatedConfig, 'all')
    const newScore = result.overall
    const improvement = newScore - bestScore

    const exp = {
      id: i,
      domain: mutation.domain,
      parameter: mutation.parameter,
      old_value: mutation.old_value,
      new_value: mutation.new_value,
      hypothesis: mutation.hypothesis,
      baseline_score: bestScore,
      new_score: newScore,
      improvement,
      ratcheted: false,
      duration_ms: Date.now() - t0,
    }

    // Ratchet decision
    if (newScore > bestScore) {
      exp.ratcheted = true
      bestScore = newScore
      bestConfig = mutatedConfig
      improvementCount++
      console.log(` → ${newScore.toFixed(1)} (+${improvement.toFixed(1)}) RATCHETED ✅`)

      // Persist best config
      await persistBestConfig(bestConfig, bestScore)
    } else if (Math.abs(improvement) < 0.1) {
      console.log(` → ${newScore.toFixed(1)} (=${improvement.toFixed(1)}) no change`)
    } else {
      console.log(` → ${newScore.toFixed(1)} (${improvement.toFixed(1)}) discarded ❌`)
    }

    experimentLog.push(exp)

    // Persist experiment to graph (async, non-blocking)
    persistExperiment(exp).catch(() => {})

    // Brief pause between experiments
    await new Promise(r => setTimeout(r, 1000))
  }

  // ─── Phase 4: Summary ───────────────────────────────────────────────────
  const improvements = experimentLog.filter(e => e.ratcheted)
  const avgDuration = experimentLog.length > 0
    ? Math.round(experimentLog.reduce((s, e) => s + e.duration_ms, 0) / experimentLog.length / 1000)
    : 0

  console.log(`

${'═'.repeat(60)}
  OPTIMIZATION COMPLETE
${'═'.repeat(60)}
  Experiments:    ${experimentsRun}
  Improvements:   ${improvementCount} (${(improvementCount / Math.max(experimentsRun, 1) * 100).toFixed(0)}% hit rate)
  Baseline:       ${baseline.overall.toFixed(1)}/100
  Final Score:    ${bestScore.toFixed(1)}/100
  Total Gain:     +${(bestScore - baseline.overall).toFixed(1)}
  Avg Experiment: ${avgDuration}s
${'═'.repeat(60)}

  Top Improvements:`)

  for (const imp of improvements.slice(-10)) {
    console.log(`    ${imp.domain}.${imp.parameter}: ${JSON.stringify(imp.old_value)} → ${JSON.stringify(imp.new_value)} (+${imp.improvement.toFixed(1)}) "${imp.hypothesis}"`)
  }

  console.log(`
  Best Config:
${JSON.stringify(bestConfig, null, 4)}
`)

  // Phase 4.5: RLM Analysis of results — reason about what we learned
  console.log('\n  Phase 4.5: RLM Deep Analysis of optimization run...')
  try {
    const improvementSummary = improvements.map(i =>
      `${i.domain}.${i.parameter}: ${JSON.stringify(i.old_value)} → ${JSON.stringify(i.new_value)} (+${i.improvement.toFixed(1)})`
    ).join('\n')
    const failedSummary = experimentLog.filter(e => !e.ratcheted && e.improvement < -1).slice(0, 5).map(e =>
      `${e.domain}.${e.parameter}: ${JSON.stringify(e.old_value)} → ${JSON.stringify(e.new_value)} (${e.improvement.toFixed(1)})`
    ).join('\n')

    const analysis = await cognitive('analyze',
      `Analyze this optimization run:

Baseline: ${baseline.overall.toFixed(1)}/100 → Final: ${bestScore.toFixed(1)}/100
${Object.entries(baseline.scores).map(([k,v]) => `${k}: ${v.toFixed(1)}`).join(', ')}

Improvements that worked:
${improvementSummary || '(none)'}

Changes that hurt:
${failedSummary || '(none)'}

Questions to analyze:
1. What patterns explain the successful improvements?
2. Which domains have untapped optimization potential?
3. What should the next optimization run focus on?
4. Are there synergistic parameter combinations worth exploring?`,
      { domain: DOMAIN, experiments: experimentsRun }
    )

    console.log(`\n  RLM Analysis:\n  ${String(analysis).slice(0, 500)}`)
  } catch (err) {
    console.log(`  RLM analysis skipped: ${err.message?.slice(0, 60)}`)
  }

  // Phase 5: Persist final results to graph
  console.log('\n  Persisting final results to graph...')

  try {
    await graphWrite(`
      CREATE (r:OptimizationRun {
        experiments: ${experimentsRun},
        improvements: ${improvementCount},
        baseline_score: ${baseline.overall},
        final_score: ${bestScore},
        gain: ${bestScore - baseline.overall},
        domain: '${DOMAIN}',
        best_config: '${JSON.stringify(bestConfig).replace(/'/g, "\\'")}',
        timestamp: datetime(),
        valid_from: datetime(),
        valid_to: datetime('9999-12-31T23:59:59Z')
      })
      WITH r
      MERGE (hub:HubNode:OptimizationHub {name: 'Optimization Log'})
      MERGE (r)-[:LOGGED_IN]->(hub)
    `)
    console.log('  Persisted to graph')
  } catch (err) {
    console.log(`  Failed to persist: ${err.message}`)
  }

  // Phase 6: Broadcast summary to chat
  try {
    await orch('/chat/message', {
      method: 'POST',
      body: JSON.stringify({
        from: 'optimization-loop',
        to: 'All',
        source: 'system',
        type: 'Message',
        message: `Optimization complete: ${experimentsRun} experiments, ${improvementCount} improvements. Score: ${baseline.overall.toFixed(1)} → ${bestScore.toFixed(1)} (+${(bestScore - baseline.overall).toFixed(1)}). Domain: ${DOMAIN}.`,
        timestamp: new Date().toISOString(),
      }),
    })
  } catch {}

  // Phase 7: Store learnings to SRAG
  if (improvements.length > 0) {
    try {
      const learningContent = improvements.map(i =>
        `${i.domain}.${i.parameter}: ${JSON.stringify(i.old_value)} → ${JSON.stringify(i.new_value)} improved score by ${i.improvement.toFixed(1)}. Hypothesis: ${i.hypothesis}`
      ).join('\n')

      await orch('/chat/remember', {
        method: 'POST',
        body: JSON.stringify({
          content: `Optimization learnings (${DOMAIN}):\n${learningContent}\nFinal score: ${bestScore.toFixed(1)}/100`,
          title: `Optimization Run ${new Date().toISOString().slice(0, 10)}`,
          tags: ['optimization', 'autoresearch', DOMAIN, 'ratcheting'],
        }),
      })
      console.log('  Learnings stored to memory layers')
    } catch {}
  }

  console.log('\n  Done.')
}

main().catch(err => {
  console.error('Fatal error:', err.message)
  process.exit(1)
})
