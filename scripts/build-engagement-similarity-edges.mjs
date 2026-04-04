// v4.0.2: Build :SIMILAR_TO edges between seeded :Engagement nodes.
// Similarity computed from shared domain + shared methodologies + outcome proximity.
// Enables multi-hop precedent walks via autonomous.graphrag.
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const KEY = 'Heravej_22'

async function exec(query, params = {}) {
  const res = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ tool: 'graph.write_cypher', payload: { query, params, _force: true } }),
    signal: AbortSignal.timeout(30000),
  })
  return res.json()
}

async function read(query, params = {}) {
  const res = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ tool: 'graph.read_cypher', payload: { query, params } }),
    signal: AbortSignal.timeout(30000),
  })
  return res.json()
}

async function main() {
  console.log('=== v4.0.2 — Build engagement similarity edges ===\n')
  const t0 = Date.now()

  // Step 1: Same-domain similarity (high weight)
  console.log('Step 1: Same-domain similarity edges...')
  const step1 = await exec(`
MATCH (a:Engagement), (b:Engagement)
WHERE a.id < b.id AND a.domain = b.domain
MERGE (a)-[r:SIMILAR_TO]-(b)
ON CREATE SET r.reason = 'same_domain', r.weight = 0.5, r.createdAt = datetime()
ON MATCH SET r.weight = CASE WHEN r.weight < 0.5 THEN 0.5 ELSE r.weight END
RETURN count(*) AS edges
`)
  console.log(`  → ${JSON.stringify(step1).slice(0, 200)}`)

  // Step 2: Shared methodology boost (increment weight)
  console.log('\nStep 2: Shared methodology weight boost...')
  const step2 = await exec(`
MATCH (a:Engagement)-[:USES_METHODOLOGY]->(m)<-[:USES_METHODOLOGY]-(b:Engagement)
WHERE a.id < b.id
WITH a, b, count(DISTINCT m) AS shared
MERGE (a)-[r:SIMILAR_TO]-(b)
ON CREATE SET r.reason = 'shared_methodology', r.weight = 0.3 + (toFloat(shared) * 0.1), r.createdAt = datetime(), r.sharedMethodologies = shared
ON MATCH SET r.weight = r.weight + (toFloat(shared) * 0.1), r.sharedMethodologies = shared
RETURN count(*) AS edges
`)
  console.log(`  → ${JSON.stringify(step2).slice(0, 200)}`)

  // Step 3: Outcome proximity (successful → successful get extra weight)
  console.log('\nStep 3: Outcome-grade proximity boost...')
  const step3 = await exec(`
MATCH (a:Engagement)-[:HAS_OUTCOME]->(oa:EngagementOutcome),
      (b:Engagement)-[:HAS_OUTCOME]->(ob:EngagementOutcome)
WHERE a.id < b.id AND oa.grade = ob.grade AND oa.grade IN ['exceeded', 'met']
MERGE (a)-[r:SIMILAR_TO]-(b)
ON CREATE SET r.reason = 'similar_outcome', r.weight = 0.4, r.sharedOutcome = oa.grade, r.createdAt = datetime()
ON MATCH SET r.weight = r.weight + 0.2, r.sharedOutcome = oa.grade
RETURN count(*) AS edges
`)
  console.log(`  → ${JSON.stringify(step3).slice(0, 200)}`)

  // Step 4: Cap weights at 1.0 and report
  console.log('\nStep 4: Normalize weights...')
  await exec(`
MATCH ()-[r:SIMILAR_TO]-()
WHERE r.weight > 1.0
SET r.weight = 1.0
RETURN count(*) AS normalized
`)

  // Final count + distribution
  const summary = await read(`
MATCH ()-[r:SIMILAR_TO]-()
RETURN count(DISTINCT r) AS total_edges,
       avg(r.weight) AS avg_weight,
       max(r.weight) AS max_weight,
       min(r.weight) AS min_weight
`)
  console.log(`\nSummary: ${JSON.stringify(summary).slice(0, 300)}`)
  console.log(`\nDuration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
