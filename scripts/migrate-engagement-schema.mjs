// Neo4j schema migration for v4.0 Engagement entity
// Creates constraints + indexes via backend graph.write_cypher
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const KEY = 'Heravej_22'

const STATEMENTS = [
  // Unique constraint on Engagement.id
  `CREATE CONSTRAINT engagement_id_unique IF NOT EXISTS FOR (e:Engagement) REQUIRE e.id IS UNIQUE`,
  // Unique constraint on EngagementOutcome.engagementId
  `CREATE CONSTRAINT outcome_engagement_id_unique IF NOT EXISTS FOR (o:EngagementOutcome) REQUIRE o.engagementId IS UNIQUE`,
  // Index on domain for fast domain filtering
  `CREATE INDEX engagement_domain IF NOT EXISTS FOR (e:Engagement) ON (e.domain)`,
  // Index on status for active-engagement queries
  `CREATE INDEX engagement_status IF NOT EXISTS FOR (e:Engagement) ON (e.status)`,
  // Index on client for client-scoped queries
  `CREATE INDEX engagement_client IF NOT EXISTS FOR (e:Engagement) ON (e.client)`,
]

async function exec(cypher) {
  const res = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ tool: 'graph.write_cypher', payload: { query: cypher, params: {}, _force: true } }),
    signal: AbortSignal.timeout(20000),
  })
  const j = await res.json()
  return j
}

async function main() {
  console.log('=== Engagement Schema Migration ===\n')
  for (const stmt of STATEMENTS) {
    const short = stmt.slice(0, 70).replace(/\s+/g, ' ')
    try {
      const result = await exec(stmt)
      const ok = result?.result?.success !== false
      console.log(`${ok ? '✓' : '✗'} ${short}`)
      if (!ok) console.log(`  error: ${JSON.stringify(result).slice(0, 200)}`)
    } catch (err) {
      console.log(`✗ ${short}\n  error: ${String(err).slice(0, 100)}`)
    }
  }
  console.log('\n=== Done ===')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
