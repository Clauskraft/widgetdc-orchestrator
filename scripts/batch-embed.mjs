#!/usr/bin/env node
/**
 * batch-embed.mjs — Batch embedding pipeline for Neo4j nodes via vidensarkiv.add
 *
 * Embeds nodes that have text content but no embedding yet. Uses the backend's
 * vidensarkiv.add MCP tool which internally generates embeddings and stores them
 * in the searchable VectorDocument archive.
 *
 * Usage:
 *   node scripts/batch-embed.mjs                          # all labels, default batch=50
 *   node scripts/batch-embed.mjs --label AssemblyBlock     # single label
 *   node scripts/batch-embed.mjs --batch-size 100          # larger batches
 *   node scripts/batch-embed.mjs --dry-run                 # count only, no writes
 *
 * Resumable: tracks progress via `embedded_at` timestamp on source nodes.
 * Idempotent: skips nodes already marked, vidensarkiv deduplicates by content hash.
 */

const BACKEND_URL = 'https://backend-production-d3da.up.railway.app/api/mcp/route'
const BACKEND_KEY = 'Heravej_22'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const bsIdx = args.indexOf('--batch-size')
const BATCH_SIZE = bsIdx >= 0 ? parseInt(args[bsIdx + 1] || '50', 10) : 50
const lblIdx = args.indexOf('--label')
const LABEL_FILTER = lblIdx >= 0 ? args[lblIdx + 1] : null

// Label → text field mapping. Each entry defines which field(s) to concatenate for embedding.
const LABEL_CONFIG = [
  { label: 'AssemblyBlock', textFields: ['content'], minLength: 20 },
  { label: 'CertificationQuestion', textFields: ['question'], minLength: 10 },
  { label: 'CloudAdvisoryCase', textFields: ['input_text', 'output_text'], minLength: 10 },
]

async function mcp(tool, payload) {
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BACKEND_KEY}`,
    },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json()
  return data.result ?? data
}

async function graphRead(query, params = {}) {
  const r = await mcp('graph.read_cypher', { query, params })
  return r?.results ?? []
}

async function graphWrite(query, params = {}) {
  const r = await mcp('graph.write_cypher', { query, params })
  return r?.results ?? []
}

async function addToArchive(content, metadata) {
  return mcp('vidensarkiv.add', { content, metadata })
}

async function processLabel(config) {
  const { label, textFields, minLength } = config

  // Build text extraction expression for Cypher
  const textExpr = textFields.length === 1
    ? `n.${textFields[0]}`
    : textFields.map(f => `coalesce(n.${f}, "")`).join(' + " | " + ')

  // Count remaining
  const textCheck = textFields.map(f => `n.${f} IS NOT NULL`).join(' OR ')
  const countQuery = `
    MATCH (n:${label})
    WHERE n.embedded_at IS NULL AND (${textCheck})
    AND size(${textExpr}) > ${minLength}
    RETURN count(n) AS remaining
  `
  const countResult = await graphRead(countQuery)
  const remaining = countResult[0]?.remaining?.low ?? countResult[0]?.remaining ?? 0

  console.log(`\n📦 ${label}: ${remaining} nodes to embed (text fields: ${textFields.join(', ')})`)

  if (DRY_RUN || remaining === 0) return { label, embedded: 0, remaining, skipped: DRY_RUN }

  let totalEmbedded = 0
  let batchNum = 0
  const maxBatches = Math.ceil(remaining / BATCH_SIZE) + 5 // safety margin

  while (batchNum < maxBatches) {
    batchNum++

    // Fetch batch
    const fetchQuery = `
      MATCH (n:${label})
      WHERE n.embedded_at IS NULL AND (${textCheck})
      AND size(${textExpr}) > ${minLength}
      RETURN n.id AS id, ${textExpr} AS text
      LIMIT ${BATCH_SIZE}
    `
    const nodes = await graphRead(fetchQuery)
    if (nodes.length === 0) break

    let batchSuccess = 0
    let batchFail = 0

    // Two-phase per batch:
    // Phase 1: archive content via vidensarkiv.add (5 concurrent for throughput
    //          without overwhelming the backend connection pool)
    // Phase 2: batch-mark all archived nodes in ONE Cypher UNWIND (1 write call
    //          instead of N individual calls — avoids connection pool exhaustion)
    const CONCURRENCY = 5
    const archivedIds = []

    for (let i = 0; i < nodes.length; i += CONCURRENCY) {
      const chunk = nodes.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(chunk.map(async (node) => {
        const id = node.id
        const text = String(node.text || '').slice(0, 2000)
        if (!id || !text || text.length < minLength) throw new Error('skip')

        await addToArchive(
          `${label} ${id}: ${text}`,
          { source: `batch-embed-${label.toLowerCase()}`, source_id: id, label }
        )
        return id
      }))

      for (const r of results) {
        if (r.status === 'fulfilled') {
          archivedIds.push(r.value)
          batchSuccess++
        } else {
          batchFail++
        }
      }
    }

    // Phase 2: batch-mark all archived nodes in a single UNWIND call
    if (archivedIds.length > 0) {
      try {
        await graphWrite(
          `UNWIND $ids AS nid MATCH (n:${label} {id: nid}) SET n.embedded_at = datetime() RETURN count(n) AS marked`,
          { ids: archivedIds }
        )
      } catch (err) {
        console.error(`  ⚠ Batch mark failed: ${err.message} (${archivedIds.length} ids)`)
      }
    }

    totalEmbedded += batchSuccess
    const pct = ((totalEmbedded / remaining) * 100).toFixed(1)
    console.log(`  batch ${batchNum}: +${batchSuccess} embedded (${batchFail} failed) | total: ${totalEmbedded}/${remaining} (${pct}%)`)

    // Rate limit: 200ms between batches
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`✅ ${label}: ${totalEmbedded} embedded`)
  return { label, embedded: totalEmbedded, remaining: remaining - totalEmbedded }
}

async function main() {
  console.log(`🚀 Batch Embed Pipeline (batch_size=${BATCH_SIZE}, dry_run=${DRY_RUN})`)
  console.log(`   Backend: ${BACKEND_URL}`)
  console.log(`   Labels: ${LABEL_FILTER || 'all'}`)

  const configs = LABEL_FILTER
    ? LABEL_CONFIG.filter(c => c.label === LABEL_FILTER)
    : LABEL_CONFIG

  if (configs.length === 0) {
    console.error(`❌ Unknown label: ${LABEL_FILTER}. Available: ${LABEL_CONFIG.map(c => c.label).join(', ')}`)
    process.exit(1)
  }

  const results = []
  for (const config of configs) {
    const result = await processLabel(config)
    results.push(result)
  }

  console.log('\n═══════════════════════════════════════')
  console.log('RESULTS:')
  for (const r of results) {
    const status = r.skipped ? '⏸ DRY-RUN' : r.remaining === 0 ? '✅ DONE' : `⚠ ${r.remaining} remaining`
    console.log(`  ${r.label.padEnd(25)} embedded=${r.embedded.toString().padStart(6)} ${status}`)
  }
  console.log('═══════════════════════════════════════')
}

main().catch(err => {
  console.error('❌ Pipeline error:', err.message)
  process.exit(1)
})
