// v5 retry: Re-index the last 55 chunks that failed when backend crashed
import { readFileSync } from 'fs'
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const BACKEND_KEY = 'Heravej_22'

async function raptorIndex(content, title, domain) {
  try {
    const res = await fetch(`${BACKEND}/api/mcp/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BACKEND_KEY}` },
      body: JSON.stringify({
        tool: 'raptor.index',
        payload: { content, metadata: { title, domain }, orgId: 'default' }
      }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json()
    return data?.result?.success === true ? data.result.data : null
  } catch { return null }
}

// Extract KNOWLEDGE array from v5 (eval the literal)
const src = readFileSync(new URL('./mega-enrich-v5.mjs', import.meta.url), 'utf8')
const match = src.match(/const KNOWLEDGE = (\[[\s\S]*?\n\])/)
const KNOWLEDGE = eval(match[1])

// Only retry last 55 (indices 105-159)
const RETRY = KNOWLEDGE.slice(105)

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log(`=== v5 RETRY: ${RETRY.length} chunks with smaller batches + cooldown ===\n`)
  const t0 = Date.now()
  const BATCH = 5
  let indexed = 0
  let failed = 0

  for (let i = 0; i < RETRY.length; i += BATCH) {
    const batch = RETRY.slice(i, i + BATCH)
    const batchT0 = Date.now()
    const results = await Promise.all(batch.map(k => raptorIndex(k.content, k.title, k.domain)))
    const batchOk = results.filter(r => r !== null).length
    indexed += batchOk
    failed += (batch.length - batchOk)
    console.log(`Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(RETRY.length/BATCH)}: ${batchOk}/${batch.length} (${Date.now() - batchT0}ms)`)
    if (i + BATCH < RETRY.length) await sleep(2000)
  }

  console.log(`\n=== DONE === Indexed: ${indexed}/${RETRY.length} Failed: ${failed} Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
