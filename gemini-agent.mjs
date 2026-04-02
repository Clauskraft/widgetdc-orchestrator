#!/usr/bin/env node
/**
 * gemini-agent.mjs — Gemini med function calling til WidgeTDC
 *
 * Gemini får adgang til ALLE orchestrator tools via function calling.
 * Kører som lokal agent — Gemini beslutter hvad der skal kaldes,
 * scriptet eksekverer mod Railway og returnerer resultatet.
 *
 * Usage:
 *   node gemini-agent.mjs "Hvad er platform status?"
 *   node gemini-agent.mjs --interactive
 *   node gemini-agent.mjs --system "Du er frontend designer" "Design et adoption dashboard"
 *
 * Kræver: GEMINI_API_KEY i env eller .env
 */

import { config } from 'dotenv'
import * as readline from 'readline'

// dotenv override: force .env values over system env
config({ override: true })

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
if (!GEMINI_KEY) {
  console.error('Fejl: Sæt GEMINI_API_KEY i environment eller .env')
  process.exit(1)
}

const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const ORCH_KEY = 'WidgeTDC_Orch_2026'
const BACKEND_KEY = 'Heravej_22'
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`

// ─── Tool Definitions (Gemini format) ──────────────────────────────────────

const TOOLS = [
  {
    name: 'get_platform_health',
    description: 'Get live health status of all WidgeTDC services (orchestrator, backend, RLM, Redis, Neo4j, cron jobs, agents)',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_dashboard_data',
    description: 'Get full dashboard data: agents, chains, crons, adoption trends, routing stats, RLM health, OpenClaw status',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_adoption_metrics',
    description: 'Get adoption KPIs: features done/total, milestones, assistants, pipelines',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_adoption_trends',
    description: 'Get daily adoption time-series: conversations, pipelines, artifacts, agents, tool calls, chains',
    parameters: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Number of days (default 7, max 90)' } },
    },
  },
  {
    name: 'get_loose_ends',
    description: 'Get latest loose-end scan: orphan blocks, dangling assemblies, decisions without lineage, disconnected nodes',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'run_loose_end_scan',
    description: 'Trigger a fresh loose-end detection scan across the entire graph',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_assemblies',
    description: 'List architecture assemblies with coherence/coverage/conflict scores',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_decisions',
    description: 'List certified architecture decisions with lineage depth',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_decision_lineage',
    description: 'Get full Signal→Artifact lineage chain for a specific decision',
    parameters: {
      type: 'object',
      properties: { decision_id: { type: 'string', description: 'Full decision ID (widgetdc:decision:UUID)' } },
      required: ['decision_id'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Search the knowledge graph and semantic vector store. Returns consulting knowledge, patterns, documents, entities.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Natural language search query' } },
      required: ['query'],
    },
  },
  {
    name: 'query_graph',
    description: 'Execute a read-only Cypher query against Neo4j (520K nodes, 4M relationships). For counting, listing, finding relationships.',
    parameters: {
      type: 'object',
      properties: { cypher: { type: 'string', description: 'Cypher query' } },
      required: ['cypher'],
    },
  },
  {
    name: 'get_cron_jobs',
    description: 'List all scheduled cron jobs with status, schedule, and run count',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_agents',
    description: 'List all registered agents with source, status, capabilities',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_knowledge_feed',
    description: 'Get daily knowledge briefing: graph pulse, top insights, gap alerts, domain coverage',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'reason_deeply',
    description: 'Send a complex question to the RLM reasoning engine for deep multi-step analysis, strategy, architecture evaluation, planning',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'Complex question to reason about' } },
      required: ['question'],
    },
  },
  {
    name: 'call_mcp_tool',
    description: 'Call any of the 449 MCP tools on the backend. For specific operations like embedding, compliance, memory, agent coordination.',
    parameters: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'MCP tool name (e.g., srag.query, audit.dashboard)' },
        payload: { type: 'object', description: 'Tool arguments' },
      },
      required: ['tool_name'],
    },
  },
]

// ─── Tool Execution ────────────────────────────────────────────────────────

async function fetchAPI(url, key, method = 'GET', body = null) {
  const opts = { method, headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(url, opts)
  return res.json()
}

async function executeTool(name, args) {
  try {
    switch (name) {
      case 'get_platform_health':
        return await fetchAPI(`${ORCH}/health`, ORCH_KEY)
      case 'get_dashboard_data':
        return await fetchAPI(`${ORCH}/api/dashboard/data`, ORCH_KEY)
      case 'get_adoption_metrics':
        return await fetchAPI(`${ORCH}/api/adoption/metrics`, ORCH_KEY)
      case 'get_adoption_trends':
        return await fetchAPI(`${ORCH}/api/adoption/trends?days=${args.days ?? 7}`, ORCH_KEY)
      case 'get_loose_ends':
        return await fetchAPI(`${ORCH}/api/loose-ends`, ORCH_KEY)
      case 'run_loose_end_scan':
        return await fetchAPI(`${ORCH}/api/loose-ends/scan`, ORCH_KEY, 'POST')
      case 'get_assemblies':
        return await fetchAPI(`${ORCH}/api/assembly`, ORCH_KEY)
      case 'get_decisions':
        return await fetchAPI(`${ORCH}/api/decisions`, ORCH_KEY)
      case 'get_decision_lineage':
        return await fetchAPI(`${ORCH}/api/decisions/${encodeURIComponent(args.decision_id)}/lineage`, ORCH_KEY)
      case 'search_knowledge':
        return await fetchAPI(`${ORCH}/api/knowledge/cards?q=${encodeURIComponent(args.query)}`, ORCH_KEY)
      case 'query_graph':
        return await fetchAPI(`${BACKEND}/api/mcp/route`, BACKEND_KEY, 'POST', { tool: 'graph.read_cypher', payload: { query: args.cypher } })
      case 'get_cron_jobs':
        return await fetchAPI(`${ORCH}/cron`, ORCH_KEY)
      case 'get_agents':
        return await fetchAPI(`${ORCH}/agents`, ORCH_KEY)
      case 'get_knowledge_feed':
        return await fetchAPI(`${ORCH}/api/knowledge/feed`, ORCH_KEY)
      case 'reason_deeply':
        return await fetchAPI(`${ORCH}/cognitive/reason`, ORCH_KEY, 'POST', { prompt: args.question, context: {} })
      case 'call_mcp_tool':
        return await fetchAPI(`${BACKEND}/api/mcp/route`, BACKEND_KEY, 'POST', { tool: args.tool_name, payload: args.payload ?? {} })
      default:
        return { error: `Unknown tool: ${name}` }
    }
  } catch (err) {
    return { error: err.message }
  }
}

// ─── Gemini API ────────────────────────────────────────────────────────────

async function callGemini(contents, systemInstruction) {
  const body = {
    contents,
    tools: [{ functionDeclarations: TOOLS }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  }

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API ${res.status}: ${err.slice(0, 300)}`)
  }

  return res.json()
}

// ─── Conversation Loop (handles multi-turn function calling) ───────────────

const DEFAULT_SYSTEM = `Du er WidgeTDC Platform Agent med LIVE adgang til hele platformen via function calling.

## BOOT SEKVENS (MANDATORY — kør STRAKS ved session start)

Når samtalen starter, kør ALTID disse tool calls FØRST — før du svarer brugeren:

1. get_platform_health — er platformen oppe?
2. get_dashboard_data — agents, chains, crons, adoption, routing
3. get_adoption_trends (days: 7) — hvad er trenden?
4. get_loose_ends — er der uløste problemer?
5. get_cron_jobs — kører intelligence loops?
6. query_graph med: "MATCH (n) RETURN labels(n)[0] AS type, count(*) AS cnt ORDER BY cnt DESC LIMIT 10" — graf-overblik

Præsentér resultatet som en kort SITREP:

\`\`\`
═══ WidgeTDC SITREP ═══
Services:     [green/yellow/red]
Agents:       X registered (Y online)
Crons:        X/Y enabled (Z runs today)
Graph:        X nodes, Y relationships
Adoption:     X% features | Trend: up/down/flat
Loose ends:   X critical, Y warnings
Last scan:    [timestamp]
═══════════════════════
\`\`\`

Derefter: "Klar. Hvad skal vi bygge?"

## DIN OPGAVE

Du bygger UDELUKKENDE selvstændige moduler til to surfaces:

### Open WebUI (https://open-webui-production-25cb.up.railway.app)
- Pipelines (.py) — filter/function pipelines
- Tool functions (.py) — callable tools i chat
- Model presets (JSON) — assistenter med system prompts

### Obsidian (git-synced vault)
- Plugins (TypeScript) — ItemView panels, commands, status bar
- DataviewJS (.js) — live dashboards i notes
- Templater templates (.md) — genererede notes med API data

## REGLER

1. ALDRIG ændr eksisterende kode — kun nye separate filer
2. Hent ALTID live data via tools før du designer (brug boot-data)
3. Dark theme, data-dense, consulting-grade æstetik
4. Hvert modul = 1 fil, click-to-activate, zero dependencies
5. Kode skal være KOMPLET og kørbart — ingen placeholders
6. Fejlhåndtering: graceful fallback hvis API er nede
7. Vis altid datakilde og timestamp i UI

## API REFERENCE

Orchestrator: https://orchestrator-production-c27e.up.railway.app
Backend MCP: https://backend-production-d3da.up.railway.app/api/mcp/route
Open WebUI: https://open-webui-production-25cb.up.railway.app
Auth orchestrator: Bearer WidgeTDC_Orch_2026
Auth backend: Bearer Heravej_22

## KONTEKST

WidgeTDC er en enterprise multi-agent architecture synthesis platform.
- 7-stage funnel: Signal → Pattern → Block → Assembly → Arbitration → Decision → Artifact
- 290+ agents, 449 MCP tools, 15 cron intelligence loops
- Neo4j knowledge graph (520K+ nodes, 4M+ relationships)
- RLM reasoning engine (deep multi-step analysis)
- Adoption tracking, loose-end detection, decision certification

Brug tools aggressivt. Du har LIVE adgang til alt.`

async function chat(userMessage, systemInstruction = DEFAULT_SYSTEM) {
  const contents = [{ role: 'user', parts: [{ text: userMessage }] }]
  let rounds = 0

  while (rounds < 5) {
    rounds++
    const response = await callGemini(contents, systemInstruction)
    const candidate = response.candidates?.[0]
    if (!candidate) { console.log('[Gemini returnerede tomt svar]'); return }

    const parts = candidate.content?.parts ?? []

    // Check for function calls
    const functionCalls = parts.filter(p => p.functionCall)
    if (functionCalls.length === 0) {
      // Final text response
      const text = parts.map(p => p.text).filter(Boolean).join('\n')
      console.log('\n' + text)
      return text
    }

    // Execute all function calls
    contents.push({ role: 'model', parts })

    const functionResponses = []
    for (const part of functionCalls) {
      const { name, args } = part.functionCall
      process.stderr.write(`  🔧 ${name}(${JSON.stringify(args).slice(0, 80)})...`)
      const result = await executeTool(name, args ?? {})
      // Truncate large results
      let resultStr = JSON.stringify(result)
      if (resultStr.length > 15000) resultStr = resultStr.slice(0, 15000) + '...[truncated]'
      process.stderr.write(` ✓\n`)
      functionResponses.push({
        functionResponse: { name, response: { content: resultStr } }
      })
    }

    contents.push({ role: 'user', parts: functionResponses })
  }

  console.log('[Max tool rounds reached]')
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  let systemInstruction = DEFAULT_SYSTEM
  let query = null
  let interactive = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--system') systemInstruction = args[++i]
    else if (args[i] === '--interactive' || args[i] === '-i') interactive = true
    else query = args[i]
  }

  if (interactive || !query) {
    console.log('╔═══════════════════════════════════════════════════════════╗')
    console.log('║  Gemini WidgeTDC Agent — Live Railway connection         ║')
    console.log('║  16 tools, 449 MCP tools, Neo4j graph, RLM reasoning    ║')
    console.log('║  Type "exit" to quit                                     ║')
    console.log('╚═══════════════════════════════════════════════════════════╝\n')

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const prompt = () => {
      rl.question('Du: ', async (input) => {
        if (!input || input === 'exit') { rl.close(); return }
        try {
          await chat(input, systemInstruction)
        } catch (err) {
          console.error(`Fejl: ${err.message}`)
        }
        prompt()
      })
    }
    prompt()
  } else {
    await chat(query, systemInstruction)
  }
}

main().catch(console.error)
