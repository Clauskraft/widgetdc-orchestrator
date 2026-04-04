// v3: Sequential with 5s cooldown to avoid backend overload
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

const QUERIES = [
  { prompt: 'NIS2 compliance strategy for Danish financial institutions', type: 'analysis' },
  { prompt: 'DORA ICT risk management for insurance', type: 'assessment' },
  { prompt: 'ESG reporting Nordic pension funds', type: 'analysis' },
  { prompt: 'Cloud migration strategy SAP to Azure', type: 'roadmap' },
  { prompt: 'Zero Trust CrowdStrike Zscaler deployment', type: 'roadmap' },
  { prompt: 'McKinsey Deloitte BCG digital transformation', type: 'analysis' },
  { prompt: 'Stripe payment integration best practices', type: 'analysis' },
  { prompt: 'OpenAI ChatGPT enterprise adoption', type: 'analysis' },
  { prompt: 'AWS Azure multi-cloud governance', type: 'assessment' },
  { prompt: 'Snowflake data warehouse implementation', type: 'roadmap' },
]

async function genDel(prompt, type) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${ORCH}/api/deliverables/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({ prompt, type, format: 'markdown', max_sections: 3 }),
      signal: AbortSignal.timeout(90000),
    })
    const j = await res.json()
    return { citations: j.data?.total_citations ?? 0, confidence: j.data?.avg_confidence ?? 0, ms: Date.now() - t0 }
  } catch (e) {
    return { citations: 0, confidence: 0, ms: Date.now() - t0, error: String(e).slice(0, 60) }
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log(`=== KPI v3 (sequential + 5s cooldown) ===\n`)
  const t0 = Date.now()
  const results = []

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]
    const r = await genDel(q.prompt, q.type)
    console.log(`[${i+1}/${QUERIES.length}] ${r.citations}cit conf:${r.confidence?.toFixed(2)} ${r.ms}ms | ${q.prompt.slice(0, 45)}`)
    results.push(r)
    if (i < QUERIES.length - 1) await sleep(5000)
  }

  const withCit = results.filter(r => r.citations > 0).length
  const avgCit = results.reduce((s, r) => s + r.citations, 0) / results.length
  const avgConf = results.reduce((s, r) => s + r.confidence, 0) / results.length

  console.log(`\n=== RESULTS ===`)
  console.log(`With citations: ${withCit}/${results.length} (${((withCit/results.length)*100).toFixed(0)}%)`)
  console.log(`Zero citations: ${results.length - withCit}/${results.length} (${(((results.length - withCit)/results.length)*100).toFixed(0)}%)`)
  console.log(`Avg citations: ${avgCit.toFixed(1)}`)
  console.log(`Avg confidence: ${avgConf.toFixed(2)}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
