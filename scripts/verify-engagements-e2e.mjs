// E2E verification for v4.0 Engagement Intelligence Engine
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

async function call(method, path, body) {
  const res = await fetch(`${ORCH}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  })
  return { status: res.status, json: await res.json() }
}

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('=== EIE E2E Verification ===\n')

  // E1: LIST — ≥25 engagements from seed
  console.log('E1: List engagements')
  const list = await call('GET', '/api/engagements?limit=50')
  check('GET /api/engagements returns 200', list.status === 200)
  check('returns ≥25 seeded engagements', list.json?.data?.length >= 25, `got ${list.json?.data?.length}`)
  const sample = list.json.data[0]
  check('engagement has $id', !!sample?.$id)
  check('engagement has domain', !!sample?.domain)
  check('engagement has methodology_refs array', Array.isArray(sample?.methodology_refs))

  await sleep(2000)

  // E2: GET by id — retrieve single
  console.log('\nE2: Get single engagement')
  const single = await call('GET', `/api/engagements/${encodeURIComponent(sample.$id)}`)
  check('GET /:id returns 200', single.status === 200)
  check('returns same $id', single.json?.data?.$id === sample.$id)

  await sleep(2000)

  // E3: MATCH — find precedents for a Finance NIS2 query
  console.log('\nE3: Match precedents (Finance NIS2)')
  const match = await call('POST', '/api/engagements/match', {
    objective: 'NIS2 compliance implementation for Danish retail bank with third-party risk management',
    domain: 'Finance',
    max_results: 5,
  })
  check('POST /match returns 200', match.status === 200)
  const matches = match.json?.data?.matches ?? []
  check('returns ≥1 match', matches.length >= 1, `got ${matches.length}`)
  check('match has similarity score', typeof matches[0]?.similarity === 'number')
  check('match has reasoning', !!matches[0]?.match_reasoning)

  await sleep(5000)

  // E4: PLAN — generate structured plan
  console.log('\nE4: Generate plan')
  const plan = await call('POST', '/api/engagements/plan', {
    objective: 'Zero Trust architecture rollout for Danish insurance company using CrowdStrike Falcon and Zscaler with SOC modernization',
    domain: 'Cybersecurity',
    duration_weeks: 16,
    team_size: 12,
    budget_dkk: 8_000_000,
  })
  check('POST /plan returns 200', plan.status === 200, plan.status === 200 ? '' : JSON.stringify(plan.json).slice(0, 150))
  const planData = plan.json?.data
  check('plan has phases array', Array.isArray(planData?.phases), `phases=${planData?.phases?.length}`)
  check('phases sum to ~duration_weeks', Math.abs(planData?.phases?.reduce((s, p) => s + p.duration_weeks, 0) - 16) <= 4)
  check('plan has risks array', Array.isArray(planData?.risks), `risks=${planData?.risks?.length}`)
  check('plan has required_skills', Array.isArray(planData?.required_skills))
  check('plan has precedents_used', Array.isArray(planData?.precedents_used))
  check('plan total_citations ≥5', planData?.total_citations >= 5, `got ${planData?.total_citations}`)
  check('plan avg_confidence > 0', planData?.avg_confidence > 0, `${planData?.avg_confidence}`)
  check('plan has engagement_id', !!planData?.engagement_id)

  await sleep(5000)

  // E5: OUTCOME — record and verify adaptive-rag hook fires
  console.log('\nE5: Record outcome')
  const outcome = await call('POST', `/api/engagements/${encodeURIComponent(sample.$id)}/outcome`, {
    grade: 'met',
    actual_end_date: new Date().toISOString(),
    deliverables_shipped: ['Strategy doc', 'Implementation plan', 'Risk register'],
    what_went_well: 'E2E verification ran successfully',
    what_went_wrong: 'Nothing — this is a test',
    precedent_match_accuracy: 0.85,
    recorded_by: 'e2e-verifier',
  })
  check('POST /:id/outcome returns 201', outcome.status === 201)
  check('outcome has grade', outcome.json?.data?.grade === 'met')

  await sleep(2000)

  // E6: Retrieve stored plan via GET
  if (planData?.engagement_id) {
    console.log('\nE6: Retrieve stored plan')
    const storedPlan = await call('GET', `/api/engagements/${encodeURIComponent(planData.engagement_id)}/plan`)
    check('GET /:id/plan returns 200', storedPlan.status === 200)
  }

  console.log(`\n=== RESULTS ===`)
  console.log(`Pass: ${pass}`)
  console.log(`Fail: ${fail}`)
  console.log(`Total: ${pass + fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
