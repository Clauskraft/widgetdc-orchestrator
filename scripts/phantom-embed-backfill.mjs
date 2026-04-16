#!/usr/bin/env node
/**
 * One-shot backfill for PhantomComponent.needsEmbedding=true.
 *
 * For each queued component:
 *   1. Call vidensarkiv.add(content, metadata) → creates VectorDocument with HF embedding
 *   2. SET c.needsEmbedding = false, c.embeddedAt = datetime()
 *
 * Usage: node scripts/phantom-embed-backfill.mjs [--batch 50] [--limit 1000]
 */

const BASE = 'https://orchestrator-production-c27e.up.railway.app'
const AUTH = 'Bearer WidgeTDC_Orch_2026'
const BATCH = parseInt(process.argv.indexOf('--batch') >= 0 ? process.argv[process.argv.indexOf('--batch') + 1] : '50', 10)
const LIMIT = parseInt(process.argv.indexOf('--limit') >= 0 ? process.argv[process.argv.indexOf('--limit') + 1] : '2000', 10)

async function mcp(tool, payload) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${BASE}/api/tools/call_mcp_tool?fold=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: AUTH },
      body: JSON.stringify({ tool_name: tool, payload }),
    })
    const json = await res.json()
    const rawResult = json?.data?.result
    if (typeof rawResult === 'string') {
      const rateMatch = rawResult.match(/retryAfter[\"']?\s*[:=]\s*(\d+)/i)
      if (rateMatch || /Too Many Requests|Rate limit exceeded/i.test(rawResult)) {
        const waitS = rateMatch ? parseInt(rateMatch[1], 10) + 2 : 30
        console.error(`  rate-limited on ${tool}, wait ${waitS}s (attempt ${attempt + 1}/6)`)
        await new Promise(r => setTimeout(r, waitS * 1000))
        continue
      }
    }
    return json
  }
  return { data: { result: 'rate-limit-exhausted' } }
}

// NOTE: orchestrator's query_graph tool hardcodes .slice(0, 800) on the
// returned JSON string. To avoid truncation, bypass it by calling
// backend's graph.read_cypher directly via call_mcp_tool.
async function queryGraph(cypher, params = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const env = await mcp('graph.read_cypher', { query: cypher, params })
    const rawResult = env?.data?.result
    if (typeof rawResult !== 'string') return []

    // Rate-limit retry
    const rateMatch = rawResult.match(/retryAfter[\"']?\s*[:=]\s*(\d+)/i)
    if (rateMatch || /Too Many Requests|Rate limit exceeded/i.test(rawResult)) {
      const waitS = rateMatch ? parseInt(rateMatch[1], 10) + 2 : 30
      console.error(`  rate-limited, wait ${waitS}s (attempt ${attempt + 1}/6)`)
      await new Promise(r => setTimeout(r, waitS * 1000))
      continue
    }

    // Backend graph.read_cypher returns { success, results: [...], count, query } as JSON string
    try {
      const parsed = JSON.parse(rawResult)
      if (parsed?.success === false) {
        console.error(`  query failed: ${String(parsed.error).slice(0, 160)}`)
        return []
      }
      const rows = parsed?.results ?? parsed
      return Array.isArray(rows) ? rows : []
    } catch (e) {
      console.error(`  parse error (raw length=${rawResult.length}): ${String(e).slice(0, 100)}`)
      return []
    }
  }
  console.error('  giving up after 6 rate-limit retries')
  return []
}

// Server truncates result payload around ~1KB even with was_folded:false.
// Lean query: fetch only ids here, then resolve each component's details
// in embedComponent via a single-id query to avoid truncation.
async function fetchQueued(n) {
  return queryGraph(`
    MATCH (c:PhantomComponent)
    WHERE c.needsEmbedding = true
    RETURN c.componentId AS id
    LIMIT ${n}
  `)
}

async function fetchComponentDetails(cid) {
  const rows = await queryGraph(`
    MATCH (c:PhantomComponent {componentId: $cid})
    RETURN c.componentId AS id,
           c.name AS name,
           substring(coalesce(c.description, ''), 0, 400) AS description,
           coalesce(c.capabilities, []) AS caps,
           coalesce(c.type, 'pattern') AS type,
           coalesce(c.sourceRepo, '') AS repo
    LIMIT 1
  `, { cid })
  return rows[0] ?? null
}

async function embedComponent(idOnly) {
  // Resolve full details just-in-time to avoid response-payload truncation on batch fetch.
  const c = await fetchComponentDetails(idOnly.id)
  if (!c) return { ok: false, err: 'not-found' }

  const capsStr = Array.isArray(c.caps) && c.caps.length ? `\nCapabilities: ${c.caps.join(', ')}` : ''
  const content = `${c.name}: ${c.description}${capsStr}`.slice(0, 2000)

  const addResult = await mcp('vidensarkiv.add', {
    content,
    metadata: {
      source: 'phantom-bom-backfill',
      componentId: c.id,
      name: c.name,
      type: c.type,
      sourceRepo: c.repo,
    },
  })

  const resultText = addResult?.data?.result ?? ''
  const ok = typeof resultText === 'string' && resultText.includes('Knowledge added')
  if (!ok) return { ok: false, err: resultText.slice(0, 140) }

  // Clear flag
  await mcp('graph.write_cypher', {
    query: 'MATCH (c:PhantomComponent {componentId: $cid}) SET c.needsEmbedding = false, c.embeddedAt = datetime() RETURN c.componentId',
    params: { cid: c.id },
    intent: 'phantom_bom_backfill',
    purpose: `Clear needsEmbedding flag for ${c.name} after vidensarkiv.add`,
    objective: 'Remove component from embedding queue',
    evidence: 'vidensarkiv.add returned "Knowledge added to archive"',
    verification: 'idempotent SET on existing node matched by componentId',
    test_results: 'one-shot backfill script phantom-embed-backfill.mjs',
  })

  return { ok: true }
}

async function main() {
  let total = 0, ok = 0, fail = 0
  while (total < LIMIT) {
    const batch = await fetchQueued(BATCH)
    if (batch.length === 0) break
    process.stdout.write(`\nwave: ${batch.length} queued (processed so far: ${total})\n`)
    for (const c of batch) {
      if (!c.id) continue
      try {
        const r = await embedComponent(c)
        total++
        if (r.ok) { ok++; process.stdout.write('.') }
        else { fail++; process.stdout.write('x'); console.error(`\nFAIL ${c.id}: ${r.err}`) }
      } catch (err) {
        fail++; total++
        console.error(`\nERR ${c.id}: ${err?.message ?? String(err)}`)
      }
      // Pace: each component now = 3 API calls (details + add + clear). 1000ms keeps us under 500/min.
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  console.log(`\n\nDONE: total=${total} ok=${ok} fail=${fail}`)

  // Final state
  const finalState = await queryGraph(`
    MATCH (c:PhantomComponent)
    RETURN count(c) AS total,
           count(CASE WHEN c.embeddedAt IS NOT NULL THEN 1 END) AS embedded,
           count(CASE WHEN c.needsEmbedding = true THEN 1 END) AS queued
  `)
  console.log('\nFinal state:', JSON.stringify(finalState, null, 2))
}

main().catch((err) => { console.error(err); process.exit(1) })
