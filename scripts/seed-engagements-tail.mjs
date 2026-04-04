// Re-seed the last 5 engagements that hit rate limit in seed-engagements.mjs
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

function iso(daysAgo) {
  return new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10) + 'T00:00:00Z'
}

const SEEDS = [
  { client: 'SimCorp', domain: 'Finance', objective: 'Investment management platform cloud migration with multi-tenant SaaS transformation for buy-side clients', start_date: iso(390), target_end_date: iso(110), budget_dkk: 26_000_000, team_size: 32, methodology_refs: ['Cloud Migration', 'Multi-tenant SaaS', 'AWS Well-Architected'], outcome: { grade: 'met', well: 'First 10 client tenants migrated cleanly.', wrong: 'Performance regressions on large position books needed tuning.' } },
  { client: 'SKAT Tax Agency', domain: 'Public Sector', objective: 'Tax administration AI-powered fraud detection and risk scoring across personal and corporate filings', start_date: iso(510), target_end_date: iso(220), budget_dkk: 22_000_000, team_size: 28, methodology_refs: ['Machine Learning', 'Fraud Detection', 'GDPR'], outcome: { grade: 'exceeded', well: 'Detected 3x more potential fraud cases.', wrong: 'Explainability requirements drove model architecture rework.' } },
  { client: 'Grundfos', domain: 'Manufacturing', objective: 'Connected pump platform with predictive maintenance and water efficiency optimization for utilities', start_date: iso(350), target_end_date: iso(100), budget_dkk: 14_500_000, team_size: 19, methodology_refs: ['IoT', 'Predictive Maintenance', 'Digital Twin'], outcome: { grade: 'met', well: 'Utility customer trials successful.', wrong: 'OT/IT integration security review added delay.' } },
  { client: 'Jyske Bank', domain: 'Finance', objective: 'Open banking API platform with PSD2 compliance and third-party fintech partner onboarding', start_date: iso(330), target_end_date: iso(120), budget_dkk: 11_000_000, team_size: 15, methodology_refs: ['PSD2', 'Open Banking', 'API Management'], outcome: { grade: 'met', well: '12 fintech partners onboarded in first quarter.', wrong: 'Consent management UX needed iteration.' } },
  { client: 'Rockwool', domain: 'Manufacturing', objective: 'Insulation product configurator and building performance simulation platform for architects and contractors', start_date: iso(310), target_end_date: iso(90), budget_dkk: 9_800_000, team_size: 13, methodology_refs: ['Product Configurator', 'Building Simulation', 'B2B Commerce'], outcome: { grade: 'exceeded', well: 'Adopted by top 50 Nordic architecture firms.', wrong: 'Internationalization effort was larger than planned.' } },
]

async function call(method, path, body) {
  const res = await fetch(`${ORCH}${path}`, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) })
  return { status: res.status, json: await res.json() }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('Waiting 65s for rate limit reset...')
  await sleep(65000)
  console.log(`Seeding ${SEEDS.length} tail engagements\n`)

  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i]
    const createRes = await call('POST', '/api/engagements', {
      client: s.client, domain: s.domain, objective: s.objective,
      start_date: s.start_date, target_end_date: s.target_end_date,
      budget_dkk: s.budget_dkk, team_size: s.team_size, methodology_refs: s.methodology_refs,
    })
    if (createRes.status !== 201) { console.log(`[${i + 1}/${SEEDS.length}] ✗ ${s.client} — ${createRes.status}`); continue }
    const engId = createRes.json.data.$id
    await call('POST', `/api/engagements/${encodeURIComponent(engId)}/outcome`, {
      grade: s.outcome.grade, actual_end_date: s.target_end_date,
      deliverables_shipped: s.methodology_refs.map(m => `${m} artifacts`),
      what_went_well: s.outcome.well, what_went_wrong: s.outcome.wrong,
      precedent_match_accuracy: s.outcome.grade === 'exceeded' ? 0.9 : 0.75,
      recorded_by: 'seed-script',
    })
    console.log(`[${i + 1}/${SEEDS.length}] ✓ ${s.client} — ${engId.slice(0, 22)}`)
    await sleep(3500) // 3.5s spacing = ~17/min
  }
  console.log('\n=== Done ===')
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
