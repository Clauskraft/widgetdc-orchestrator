#!/usr/bin/env node
/**
 * gemini-context.mjs — Dumps live WidgeTDC platform state as text
 * Copy-paste output into Gemini AI Studio as context.
 *
 * Usage: node gemini-context.mjs | clip     (Windows: copies to clipboard)
 *        node gemini-context.mjs > ctx.md   (or save to file)
 */

const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const ORCH_KEY = 'WidgeTDC_Orch_2026'
const BACKEND_KEY = 'Heravej_22'

async function fetchJSON(url, key) {
  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${key}` }, signal: AbortSignal.timeout(10000) })
    return res.ok ? await res.json() : { error: res.status }
  } catch (e) { return { error: e.message } }
}

async function mcpQuery(cypher) {
  try {
    const res = await fetch(`${BACKEND}/api/mcp/route`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${BACKEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'graph.read_cypher', payload: { query: cypher } }),
      signal: AbortSignal.timeout(10000),
    })
    return res.ok ? await res.json() : { error: res.status }
  } catch (e) { return { error: e.message } }
}

async function main() {
  const [health, dashboard, adoption, trends, looseEnds, assemblies, decisions, crons] = await Promise.all([
    fetchJSON(`${ORCH}/health`, ORCH_KEY),
    fetchJSON(`${ORCH}/api/dashboard/data`, ORCH_KEY),
    fetchJSON(`${ORCH}/api/adoption/metrics`, ORCH_KEY),
    fetchJSON(`${ORCH}/api/adoption/trends?days=7`, ORCH_KEY),
    fetchJSON(`${ORCH}/api/loose-ends`, ORCH_KEY),
    fetchJSON(`${ORCH}/api/assembly`, ORCH_KEY),
    fetchJSON(`${ORCH}/api/decisions`, ORCH_KEY),
    fetchJSON(`${ORCH}/cron`, ORCH_KEY),
  ])

  const graphStats = await mcpQuery("MATCH (n) RETURN labels(n)[0] AS type, count(*) AS count ORDER BY count DESC LIMIT 15")
  const graphRels = await mcpQuery("MATCH ()-[r]->() RETURN type(r) AS rel, count(*) AS count ORDER BY count DESC LIMIT 10")

  const ts = new Date().toISOString()

  console.log(`# WidgeTDC Live Platform Context — ${ts}

Brug denne data til at designe moduler. Den er hentet LIVE fra production.

## Health
\`\`\`json
${JSON.stringify(health, null, 2)}
\`\`\`

## Agents (${dashboard.agents?.length ?? '?'} total)
Top 10:
${(dashboard.agents ?? []).slice(0, 10).map(a => `- ${a.agent_id} (${a.source}, ${a.status})`).join('\n')}

## Cron Jobs (${crons.data?.total ?? '?'})
${(crons.data?.jobs ?? []).map(j => `- ${j.enabled ? '✅' : '⬜'} ${j.name} — ${j.schedule} (runs: ${j.run_count})`).join('\n')}

## Adoption Metrics
\`\`\`json
${JSON.stringify(adoption, null, 2)}
\`\`\`

## Adoption Trends (${trends.data?.total ?? 0} days)
\`\`\`json
${JSON.stringify(trends.data?.trends ?? [], null, 2)}
\`\`\`

## Loose-End Scan
\`\`\`json
${JSON.stringify(looseEnds.data ?? looseEnds, null, 2)}
\`\`\`

## Assemblies (${assemblies.total ?? 0})
\`\`\`json
${JSON.stringify(assemblies.assemblies?.slice(0, 5) ?? [], null, 2)}
\`\`\`

## Decisions (${decisions.total ?? 0})
\`\`\`json
${JSON.stringify(decisions.decisions?.slice(0, 5) ?? [], null, 2)}
\`\`\`

## Neo4j Graph — Node Types
\`\`\`json
${JSON.stringify(graphStats.results ?? graphStats.result ?? graphStats, null, 2)}
\`\`\`

## Neo4j Graph — Relationship Types
\`\`\`json
${JSON.stringify(graphRels.results ?? graphRels.result ?? graphRels, null, 2)}
\`\`\`

## Chain Executions (seneste 5)
${(dashboard.chains ?? []).slice(0, 5).map(c => `- ${c.name} (${c.mode}) — ${c.status}, ${c.steps_completed}/${c.steps_total} steps`).join('\n')}

## Routing Stats
\`\`\`json
${JSON.stringify(dashboard.routing ?? {}, null, 2)}
\`\`\`
`)
}

main().catch(console.error)
