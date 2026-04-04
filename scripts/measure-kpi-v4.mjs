// v4: Expanded KPI measurement covering new domains (Consulting + IT Tools + Code + AI Tools)
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

const QUERIES = [
  // Consulting methodology
  { prompt: 'McKinsey 7-step problem solving with MECE pyramid principle', type: 'analysis' },
  { prompt: 'BCG growth share matrix vs McKinsey three horizons portfolio strategy', type: 'analysis' },
  { prompt: 'Kotter 8-step change management with ADKAR framework', type: 'roadmap' },
  { prompt: 'Target operating model design capability-based planning', type: 'roadmap' },
  // IT tools
  { prompt: 'ServiceNow ITSM vs Jira Service Management enterprise deployment', type: 'analysis' },
  { prompt: 'Snowflake vs Databricks lakehouse analytics platform', type: 'analysis' },
  { prompt: 'Datadog observability with OpenTelemetry instrumentation', type: 'roadmap' },
  // Code
  { prompt: 'TypeScript Next.js React Server Components architecture', type: 'analysis' },
  { prompt: 'PostgreSQL pgvector Prisma ORM for RAG applications', type: 'roadmap' },
  { prompt: 'Rust vs Go for cloud-native microservices performance', type: 'analysis' },
  // AI tools
  { prompt: 'LangChain LlamaIndex DSPy framework comparison for production RAG', type: 'analysis' },
  { prompt: 'Pinecone Weaviate Qdrant vector database selection', type: 'analysis' },
  { prompt: 'Claude Code Cursor Windsurf AI coding assistant enterprise', type: 'analysis' },
  { prompt: 'AWS Bedrock Azure OpenAI Vertex AI foundation model platforms', type: 'analysis' },
  // Cross-domain
  { prompt: 'AI-powered consulting transformation with LangGraph agents', type: 'roadmap' },
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
  console.log(`=== KPI v4: ${QUERIES.length} queries across Consulting/IT/Code/AI ===\n`)
  const t0 = Date.now()
  const results = []

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]
    const r = await genDel(q.prompt, q.type)
    console.log(`[${i+1}/${QUERIES.length}] ${r.citations}cit conf:${r.confidence?.toFixed(2)} ${r.ms}ms | ${q.prompt.slice(0, 55)}`)
    results.push({ ...r, prompt: q.prompt })
    if (i < QUERIES.length - 1) await sleep(5000)
  }

  const withCit = results.filter(r => r.citations > 0).length
  const avgCit = results.reduce((s, r) => s + r.citations, 0) / results.length
  const avgConf = results.reduce((s, r) => s + r.confidence, 0) / results.length
  const zeroes = results.filter(r => r.citations === 0)

  console.log(`\n=== RESULTS ===`)
  console.log(`With citations: ${withCit}/${results.length} (${((withCit/results.length)*100).toFixed(0)}%)`)
  console.log(`Zero citations: ${results.length - withCit}/${results.length} (${(((results.length - withCit)/results.length)*100).toFixed(0)}%)`)
  console.log(`Avg citations: ${avgCit.toFixed(1)}`)
  console.log(`Avg confidence: ${avgConf.toFixed(2)}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
  if (zeroes.length > 0) {
    console.log(`\nZero-result queries:`)
    zeroes.forEach(z => console.log(`  - ${z.prompt.slice(0, 70)}`))
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
