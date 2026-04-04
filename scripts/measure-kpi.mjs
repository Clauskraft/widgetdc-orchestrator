const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

// 20 diverse queries across the enriched domains
const QUERIES = [
  { prompt: 'NIS2 compliance strategy for Danish financial institutions', type: 'analysis' },
  { prompt: 'DORA ICT risk management for insurance sector', type: 'assessment' },
  { prompt: 'Zero Trust architecture roadmap using CrowdStrike and Zscaler', type: 'roadmap' },
  { prompt: 'Compare OpenAI ChatGPT and Anthropic Claude for enterprise', type: 'analysis' },
  { prompt: 'Cloud migration strategy from SAP on-prem to Azure', type: 'roadmap' },
  { prompt: 'AI Act compliance assessment for SaaS providers', type: 'assessment' },
  { prompt: 'Snowflake vs Databricks data platform comparison', type: 'analysis' },
  { prompt: 'Stripe payment integration best practices', type: 'analysis' },
  { prompt: 'McKinsey Deloitte BCG digital transformation approach', type: 'analysis' },
  { prompt: 'Cybersecurity maturity model for mid-size enterprises', type: 'assessment' },
  { prompt: 'Workday HCM implementation roadmap', type: 'roadmap' },
  { prompt: 'SAP S4HANA migration planning', type: 'roadmap' },
  { prompt: 'Salesforce Einstein AI adoption strategy', type: 'analysis' },
  { prompt: 'ServiceNow ITSM transformation roadmap', type: 'roadmap' },
  { prompt: 'Palo Alto Networks Zero Trust deployment', type: 'assessment' },
  { prompt: 'AWS Azure GCP multi-cloud governance', type: 'analysis' },
  { prompt: 'Okta identity management implementation', type: 'roadmap' },
  { prompt: 'HuggingFace LangChain RAG pipeline setup', type: 'analysis' },
  { prompt: 'BlackRock Aladdin portfolio analytics', type: 'analysis' },
  { prompt: 'Accenture Capgemini TCS consulting partner selection', type: 'analysis' },
]

async function generateDeliverable(prompt, type) {
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

async function main() {
  console.log(`=== KPI MEASUREMENT: ${QUERIES.length} queries ===\n`)
  const t0 = Date.now()

  // Run in batches of 5 to avoid overwhelming orchestrator
  const BATCH = 5
  const results = []
  for (let i = 0; i < QUERIES.length; i += BATCH) {
    const batch = QUERIES.slice(i, i + BATCH)
    console.log(`Batch ${Math.floor(i/BATCH) + 1}/${Math.ceil(QUERIES.length/BATCH)}: ${batch.length} queries...`)
    const batchResults = await Promise.all(batch.map(q => generateDeliverable(q.prompt, q.type)))
    batchResults.forEach((r, idx) => {
      const q = batch[idx].prompt.slice(0, 40)
      console.log(`  ${r.citations}cit conf:${r.confidence?.toFixed(2)} ${r.ms}ms | ${q}...`)
    })
    results.push(...batchResults)
  }

  const withCit = results.filter(r => r.citations > 0)
  const zeroCit = results.filter(r => r.citations === 0)
  const avgCit = results.reduce((s, r) => s + r.citations, 0) / results.length
  const avgConf = results.reduce((s, r) => s + r.confidence, 0) / results.length
  const zeroRate = zeroCit.length / results.length

  console.log(`\n=== RESULTS ===`)
  console.log(`Queries: ${results.length}`)
  console.log(`With citations: ${withCit.length} (${((withCit.length/results.length)*100).toFixed(0)}%)`)
  console.log(`Zero citations: ${zeroCit.length} (${(zeroRate*100).toFixed(0)}%)`)
  console.log(`Avg citations: ${avgCit.toFixed(1)}`)
  console.log(`Avg confidence: ${avgConf.toFixed(2)}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
