// KPI measurement for v4.0 Engagement Intelligence Engine
// Tests plan generation quality across domains that map to the enriched stack
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

const PLANS = [
  { objective: 'NIS2 compliance program for Nordic retail bank with third-party vendor risk management', domain: 'Finance', duration_weeks: 20, team_size: 14 },
  { objective: 'DORA ICT risk management for Danish insurance with operational resilience testing', domain: 'Insurance', duration_weeks: 16, team_size: 10 },
  { objective: 'Zero Trust architecture rollout using CrowdStrike Falcon Zscaler with SOC modernization', domain: 'Cybersecurity', duration_weeks: 18, team_size: 12 },
  { objective: 'SAP S4HANA migration with RISE bundle for Nordic manufacturing operations', domain: 'Operations', duration_weeks: 36, team_size: 35 },
  { objective: 'Snowflake data platform with dbt and Fivetran for retail analytics modernization', domain: 'Data', duration_weeks: 14, team_size: 8 },
  { objective: 'LangGraph agent platform with Pinecone vector database and Claude Opus for consulting knowledge assistant', domain: 'AI', duration_weeks: 12, team_size: 6 },
  { objective: 'Next.js App Router migration with Server Components and TypeScript for ecommerce frontend', domain: 'Code', duration_weeks: 10, team_size: 5 },
  { objective: 'ServiceNow ITSM implementation with ITIL processes for Danish public sector', domain: 'Public Sector', duration_weeks: 22, team_size: 16 },
  { objective: 'AI-powered consulting transformation with McKinsey QuantumBlack methodology and GenAI rollout', domain: 'Consulting', duration_weeks: 28, team_size: 20 },
  { objective: 'Kubernetes platform engineering with Argo CD GitOps Istio service mesh for fintech', domain: 'Cloud', duration_weeks: 16, team_size: 11 },
]

async function call(path, body) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${ORCH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    const j = await res.json()
    return { data: j.data, ms: Date.now() - t0, status: res.status }
  } catch (e) {
    return { data: null, ms: Date.now() - t0, error: String(e).slice(0, 60) }
  }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log(`=== EIE KPI: ${PLANS.length} plans across enriched stack ===\n`)
  const t0 = Date.now()
  const results = []

  for (let i = 0; i < PLANS.length; i++) {
    const p = PLANS[i]
    const r = await call('/api/engagements/plan', p)
    const d = r.data
    const phases = d?.phases?.length ?? 0
    const risks = d?.risks?.length ?? 0
    const skills = d?.required_skills?.length ?? 0
    const prec = d?.precedents_used?.length ?? 0
    const cits = d?.total_citations ?? 0
    const conf = d?.avg_confidence ?? 0
    console.log(`[${i + 1}/${PLANS.length}] ${phases}ph ${risks}r ${skills}sk ${prec}prec ${cits}cit conf:${conf.toFixed(2)} ${r.ms}ms | ${p.domain}: ${p.objective.slice(0, 48)}`)
    results.push({ ...p, phases, risks, skills, prec, cits, conf, ms: r.ms })
    if (i < PLANS.length - 1) await sleep(4000)
  }

  const n = results.length
  const avgCit = results.reduce((s, r) => s + r.cits, 0) / n
  const avgConf = results.reduce((s, r) => s + r.conf, 0) / n
  const avgPhases = results.reduce((s, r) => s + r.phases, 0) / n
  const avgPrec = results.reduce((s, r) => s + r.prec, 0) / n
  const withCits = results.filter(r => r.cits >= 5).length
  const highConf = results.filter(r => r.conf >= 0.7).length

  console.log(`\n=== RESULTS ===`)
  console.log(`Plans ≥5 citations: ${withCits}/${n} (${((withCits / n) * 100).toFixed(0)}%)`)
  console.log(`Plans ≥0.7 confidence: ${highConf}/${n} (${((highConf / n) * 100).toFixed(0)}%)`)
  console.log(`Avg citations: ${avgCit.toFixed(1)}`)
  console.log(`Avg confidence: ${avgConf.toFixed(2)}`)
  console.log(`Avg phases: ${avgPhases.toFixed(1)}`)
  console.log(`Avg precedents matched: ${avgPrec.toFixed(1)}`)
  console.log(`Total duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
