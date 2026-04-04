// v5: Deep KPI measurement with granular stack-specific queries
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

const QUERIES = [
  // Deep consulting
  { prompt: 'Wardley mapping vs Blue Ocean Strategy canvas for platform strategy', type: 'analysis' },
  { prompt: 'Celonis process mining with Six Sigma DMAIC for operational excellence', type: 'roadmap' },
  { prompt: 'McKinsey QuantumBlack vs BCG Gamma vs Accenture AI analytics practices', type: 'analysis' },
  { prompt: 'Jobs to be Done with Lean Startup MVP validation framework', type: 'roadmap' },
  // Deep IT tools
  { prompt: 'Argo CD GitOps with Kustomize Helm Kubernetes deployment pipeline', type: 'roadmap' },
  { prompt: 'ClickHouse vs DuckDB vs Apache Iceberg lakehouse analytics stack', type: 'analysis' },
  { prompt: 'Grafana Prometheus OpenTelemetry Jaeger observability pipeline', type: 'roadmap' },
  { prompt: 'Istio Linkerd Cilium service mesh eBPF comparison', type: 'analysis' },
  // Deep code
  { prompt: 'Next.js App Router Server Components with Server Actions and Suspense', type: 'analysis' },
  { prompt: 'Rust Axum vs Go Gin vs Elixir Phoenix backend framework selection', type: 'analysis' },
  { prompt: 'Neon PlanetScale CockroachDB serverless database comparison', type: 'analysis' },
  { prompt: 'TanStack Query Zustand Jotai React state management patterns', type: 'roadmap' },
  { prompt: 'Turborepo pnpm Changesets monorepo workflow', type: 'roadmap' },
  // Deep AI tools
  { prompt: 'LangGraph stateful agents with LangSmith observability and Ragas evals', type: 'roadmap' },
  { prompt: 'Cohere Rerank with BGE embeddings ColBERT late interaction RAG', type: 'analysis' },
  { prompt: 'Unstructured LlamaParse Firecrawl document ingestion pipeline', type: 'roadmap' },
  { prompt: 'Modal Runpod CoreWeave serverless GPU inference platforms', type: 'analysis' },
  { prompt: 'LoRA Unsloth Axolotl fine-tuning Llama Mistral DeepSeek', type: 'roadmap' },
  { prompt: 'MCP Model Context Protocol vs OpenAI function calling tool use', type: 'analysis' },
  { prompt: 'Langfuse Helicone LiteLLM OpenRouter LLM observability gateway', type: 'analysis' },
  // Cross-stack
  { prompt: 'End-to-end AI consulting platform Claude Code LangGraph Pinecone Next.js', type: 'roadmap' },
]

async function genDel(prompt, type) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${ORCH}/api/deliverables/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify({ prompt, type, format: 'markdown', max_sections: 3 }),
      signal: AbortSignal.timeout(120000),
    })
    const j = await res.json()
    return { citations: j.data?.total_citations ?? 0, confidence: j.data?.avg_confidence ?? 0, ms: Date.now() - t0 }
  } catch (e) {
    return { citations: 0, confidence: 0, ms: Date.now() - t0, error: String(e).slice(0, 60) }
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log(`=== KPI v5: ${QUERIES.length} deep granular queries ===\n`)
  const t0 = Date.now()
  const results = []

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i]
    const r = await genDel(q.prompt, q.type)
    console.log(`[${i+1}/${QUERIES.length}] ${r.citations}cit conf:${r.confidence?.toFixed(2)} ${r.ms}ms | ${q.prompt.slice(0, 60)}`)
    results.push({ ...r, prompt: q.prompt })
    if (i < QUERIES.length - 1) await sleep(4000)
  }

  const withCit = results.filter(r => r.citations > 0).length
  const avgCit = results.reduce((s, r) => s + r.citations, 0) / results.length
  const avgConf = results.reduce((s, r) => s + r.confidence, 0) / results.length
  const zeroes = results.filter(r => r.citations === 0)

  console.log(`\n=== RESULTS ===`)
  console.log(`With citations: ${withCit}/${results.length} (${((withCit/results.length)*100).toFixed(0)}%)`)
  console.log(`Zero citations: ${results.length - withCit}/${results.length}`)
  console.log(`Avg citations: ${avgCit.toFixed(1)}`)
  console.log(`Avg confidence: ${avgConf.toFixed(2)}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
  if (zeroes.length > 0) {
    console.log(`\nZero-result queries:`)
    zeroes.forEach(z => console.log(`  - ${z.prompt.slice(0, 70)}`))
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
