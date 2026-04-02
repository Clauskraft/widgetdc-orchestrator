#!/usr/bin/env node
/**
 * P1 Graph Cleanup: Consolidate duplicate ConsultingDomains from 32 → ~18
 *
 * Prerequisites:
 *   - Neo4j must be in READ-WRITE mode (AuraDB free tier may be read-only)
 *   - Backend must be healthy
 *
 * Usage:
 *   node scripts/domain-consolidation.mjs [--dry-run]
 *
 * Merge groups:
 *   1. Legal Advisory ← Legal, Legal & Compliance
 *   2. Digital & Analytics ← Digital
 *   3. Digital Transformation (kept — semantically distinct from D&A)
 *   4. Technology ← Technology & Digital
 *   5. Strategy ← Strategy Consulting, Strategy & Transformation
 *   6. Strategy & M&A (kept — Due Diligence overlap, distinct domain)
 *   7. Risk & Compliance ← Risk Management, Risk Advisory
 *   8. Cybersecurity (merge duplicate node with same name)
 *
 * Result: 32 → ~19 domains
 */

const BACKEND = 'https://backend-production-d3da.up.railway.app'
const API_KEY = process.env.BACKEND_API_KEY || 'Heravej_22'
const DRY_RUN = process.argv.includes('--dry-run')

const MERGE_GROUPS = [
  {
    canonical: 'Legal Advisory',
    weak: ['Legal', 'Legal & Compliance'],
    reason: 'Legal Advisory (1054 conns) is the richest legal domain node'
  },
  {
    canonical: 'Digital & Analytics',
    weak: ['Digital'],
    reason: 'Digital (4 conns) is a stub — D&A (2786) is the real domain'
  },
  {
    canonical: 'Technology',
    weak: ['Technology & Digital'],
    reason: 'Technology (17096 conns) is the mega-node; T&D (2224) overlaps with both Tech and Digital groups'
  },
  {
    canonical: 'Strategy',
    weak: ['Strategy Consulting', 'Strategy & Transformation'],
    reason: 'Strategy (3502) is canonical; S.Consulting (325) and S&T (329) are subsets'
  },
  // Strategy & M&A kept separate — distinct M&A/Due Diligence content (1133 conns)
  {
    canonical: 'Risk & Compliance',
    weak: ['Risk Management', 'Risk Advisory'],
    reason: 'R&C (5761) is canonical; Risk Mgmt (2341) and Risk Advisory (588) are subsets'
  },
  {
    canonical: 'Cybersecurity',
    canonicalId: '4:8d837e7f-ba84-497e-961c-2a169e6e22c0:69158',  // 2047 conns
    weakIds: ['4:8d837e7f-ba84-497e-961c-2a169e6e22c0:27385'],     // 364 conns
    reason: 'Two nodes with identical name "Cybersecurity" — merge smaller into larger'
  }
]

const delay = ms => new Promise(r => setTimeout(r, ms))

async function mcpCall(tool, payload) {
  await delay(200) // Rate limit protection
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BACKEND}/api/mcp/route`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tool, payload })
      })
      if (res.status === 429) {
        console.log(`  Rate limited, waiting 10s (attempt ${attempt}/3)...`)
        await delay(10000)
        continue
      }
      if (res.status === 502) {
        console.log(`  Backend 502, waiting 30s (attempt ${attempt}/3)...`)
        await delay(30000)
        continue
      }
      const data = await res.json()
      if (!data.success || !data.result?.success) {
        throw new Error(data.result?.error || data.message || 'MCP call failed')
      }
      return data.result
    } catch (err) {
      if (attempt === 3) throw err
      console.log(`  Retry ${attempt}/3: ${err.message}`)
      await delay(5000)
    }
  }
  throw new Error('Max retries exceeded')
}

async function readCypher(query, params = {}) {
  return mcpCall('graph.read_cypher', { query, params })
}

async function writeCypher(query, params = {}) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would execute: ${query.substring(0, 120)}...`)
    return { results: [{ redirected: 0 }] }
  }
  return mcpCall('graph.write_cypher', { query, params })
}

// Generic relationship redirect: handles ALL relationship types in both directions
// Uses APOC-free approach with multiple passes per relationship type
async function redirectRelationships(canonicalName, weakNames) {
  // Step 1: Find all relationship types on weak nodes
  const relTypes = await readCypher(
    `MATCH (d:ConsultingDomain)-[r]-() WHERE d.name IN $weak
     RETURN DISTINCT type(r) AS rel_type,
       CASE WHEN startNode(r) = d THEN 'outgoing' ELSE 'incoming' END AS direction`,
    { weak: weakNames }
  )

  let totalRedirected = 0

  for (const { rel_type, direction } of relTypes.results) {
    const rt = rel_type
    // For each rel type + direction, redirect from weak → canonical
    let query
    if (direction === 'incoming') {
      // (n)-[r:TYPE]->(weak)  →  (n)-[:TYPE]->(canonical)
      query = `
        MATCH (canonical:ConsultingDomain {name: $canonical})
        MATCH (weak:ConsultingDomain) WHERE weak.name IN $weak
        MATCH (n)-[r:\`${rt}\`]->(weak) WHERE n <> canonical
        WITH n, r, canonical LIMIT 500
        MERGE (n)-[:\`${rt}\`]->(canonical)
        DELETE r
        RETURN count(*) AS redirected`
    } else {
      // (weak)-[r:TYPE]->(n)  →  (canonical)-[:TYPE]->(n)
      query = `
        MATCH (canonical:ConsultingDomain {name: $canonical})
        MATCH (weak:ConsultingDomain) WHERE weak.name IN $weak
        MATCH (weak)-[r:\`${rt}\`]->(n) WHERE n <> canonical
        WITH n, r, canonical LIMIT 500
        MERGE (canonical)-[:\`${rt}\`]->(n)
        DELETE r
        RETURN count(*) AS redirected`
    }

    // Loop until all redirected (batch 500 at a time)
    let batchTotal = 0
    let more = true
    while (more) {
      const result = await writeCypher(query, { canonical: canonicalName, weak: weakNames })
      const count = result.results?.[0]?.redirected?.low ?? result.results?.[0]?.redirected ?? 0
      batchTotal += count
      more = count >= 500 // If we hit limit, there might be more
    }

    if (batchTotal > 0) {
      console.log(`    ${direction} ${rt}: ${batchTotal} redirected`)
    }
    totalRedirected += batchTotal
  }

  return totalRedirected
}

// For Cybersecurity duplicate (same name), use elementId-based matching
async function redirectRelationshipsById(canonicalId, weakIds) {
  const relTypes = await readCypher(
    `MATCH (d:ConsultingDomain)-[r]-() WHERE elementId(d) IN $weakIds
     RETURN DISTINCT type(r) AS rel_type,
       CASE WHEN startNode(r) = d THEN 'outgoing' ELSE 'incoming' END AS direction`,
    { weakIds }
  )

  let totalRedirected = 0

  for (const { rel_type, direction } of relTypes.results) {
    const rt = rel_type
    let query
    if (direction === 'incoming') {
      query = `
        MATCH (canonical:ConsultingDomain) WHERE elementId(canonical) = $canonicalId
        MATCH (weak:ConsultingDomain) WHERE elementId(weak) IN $weakIds
        MATCH (n)-[r:\`${rt}\`]->(weak) WHERE n <> canonical
        WITH n, r, canonical LIMIT 500
        MERGE (n)-[:\`${rt}\`]->(canonical)
        DELETE r
        RETURN count(*) AS redirected`
    } else {
      query = `
        MATCH (canonical:ConsultingDomain) WHERE elementId(canonical) = $canonicalId
        MATCH (weak:ConsultingDomain) WHERE elementId(weak) IN $weakIds
        MATCH (weak)-[r:\`${rt}\`]->(n) WHERE n <> canonical
        WITH n, r, canonical LIMIT 500
        MERGE (canonical)-[:\`${rt}\`]->(n)
        DELETE r
        RETURN count(*) AS redirected`
    }

    let batchTotal = 0
    let more = true
    while (more) {
      const result = await writeCypher(query, { canonicalId, weakIds })
      const count = result.results?.[0]?.redirected?.low ?? result.results?.[0]?.redirected ?? 0
      batchTotal += count
      more = count >= 500
    }

    if (batchTotal > 0) {
      console.log(`    ${direction} ${rt}: ${batchTotal} redirected`)
    }
    totalRedirected += batchTotal
  }

  return totalRedirected
}

async function deleteWeakNodes(weakNames) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would delete: ${weakNames.join(', ')}`)
    return 0
  }
  const result = await writeCypher(
    `MATCH (d:ConsultingDomain) WHERE d.name IN $weak DETACH DELETE d RETURN count(*) AS deleted`,
    { weak: weakNames }
  )
  return result.results?.[0]?.deleted?.low ?? result.results?.[0]?.deleted ?? 0
}

async function deleteWeakNodesById(weakIds) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would delete nodes by ID: ${weakIds.join(', ')}`)
    return 0
  }
  const result = await writeCypher(
    `MATCH (d:ConsultingDomain) WHERE elementId(d) IN $weakIds DETACH DELETE d RETURN count(*) AS deleted`,
    { weakIds }
  )
  return result.results?.[0]?.deleted?.low ?? result.results?.[0]?.deleted ?? 0
}

async function main() {
  console.log('=== P1 ConsultingDomain Consolidation ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}`)
  console.log()

  // Step 1: Snapshot before
  console.log('--- Before snapshot ---')
  const before = await readCypher(
    `MATCH (d:ConsultingDomain) OPTIONAL MATCH (d)-[r]-()
     RETURN d.name AS domain, count(r) AS connections ORDER BY connections DESC`
  )
  const domainsBefore = before.results.length
  const totalConnsBefore = before.results.reduce((s, r) => s + (r.connections.low ?? r.connections), 0)
  console.log(`Domains: ${domainsBefore}`)
  console.log(`Total connections: ${totalConnsBefore}`)
  for (const r of before.results) {
    console.log(`  ${(r.domain || '?').padEnd(25)} ${(r.connections.low ?? r.connections).toString().padStart(6)} conns`)
  }
  console.log()

  // Step 2: Execute merges
  let totalMerged = 0
  let totalRedirected = 0

  for (const group of MERGE_GROUPS) {
    const isById = !!group.canonicalId
    const weakLabel = isById
      ? `[${group.weakIds.length} nodes by ID]`
      : group.weak.join(', ')

    console.log(`--- Merging into "${group.canonical}" ← ${weakLabel} ---`)
    console.log(`  Reason: ${group.reason}`)

    // Redirect relationships
    let redirected
    if (isById) {
      redirected = await redirectRelationshipsById(group.canonicalId, group.weakIds)
    } else {
      redirected = await redirectRelationships(group.canonical, group.weak)
    }
    console.log(`  Total redirected: ${redirected}`)
    totalRedirected += redirected

    // Verify weak nodes have 0 remaining relationships
    if (!DRY_RUN) {
      if (isById) {
        const check = await readCypher(
          `MATCH (d:ConsultingDomain)-[r]-() WHERE elementId(d) IN $weakIds RETURN count(r) AS remaining`,
          { weakIds: group.weakIds }
        )
        const remaining = check.results?.[0]?.remaining?.low ?? 0
        if (remaining > 0) {
          console.log(`  WARNING: ${remaining} relationships still on weak nodes — skipping delete`)
          continue
        }
      } else {
        const check = await readCypher(
          `MATCH (d:ConsultingDomain)-[r]-() WHERE d.name IN $weak RETURN count(r) AS remaining`,
          { weak: group.weak }
        )
        const remaining = check.results?.[0]?.remaining?.low ?? 0
        if (remaining > 0) {
          console.log(`  WARNING: ${remaining} relationships still on weak nodes — skipping delete`)
          continue
        }
      }
    }

    // Delete weak nodes
    let deleted
    if (isById) {
      deleted = await deleteWeakNodesById(group.weakIds)
    } else {
      deleted = await deleteWeakNodes(group.weak)
    }
    console.log(`  Deleted: ${deleted} nodes`)
    totalMerged += deleted

    // Brief pause between groups
    await new Promise(r => setTimeout(r, 500))
    console.log()
  }

  // Step 3: Snapshot after
  console.log('--- After snapshot ---')
  const after = await readCypher(
    `MATCH (d:ConsultingDomain) OPTIONAL MATCH (d)-[r]-()
     RETURN d.name AS domain, count(r) AS connections ORDER BY connections DESC`
  )
  const domainsAfter = after.results.length
  const totalConnsAfter = after.results.reduce((s, r) => s + (r.connections.low ?? r.connections), 0)
  console.log(`Domains: ${domainsAfter} (was ${domainsBefore}, removed ${domainsBefore - domainsAfter})`)
  console.log(`Total connections: ${totalConnsAfter} (was ${totalConnsBefore})`)
  for (const r of after.results) {
    console.log(`  ${(r.domain || '?').padEnd(25)} ${(r.connections.low ?? r.connections).toString().padStart(6)} conns`)
  }

  console.log()
  console.log('=== Summary ===')
  console.log(`Domains before: ${domainsBefore}`)
  console.log(`Domains after:  ${domainsAfter}`)
  console.log(`Nodes deleted:  ${totalMerged}`)
  console.log(`Rels redirected: ${totalRedirected}`)
  console.log(`Connection delta: ${totalConnsAfter - totalConnsBefore} (negative = deduped overlapping rels)`)
}

main().catch(err => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
