// v4.0.3: Verify EIE smart gates — sanity, high-stakes, complex
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

async function call(body) {
  const t0 = Date.now()
  const res = await fetch(`${ORCH}/api/engagements/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  })
  const j = await res.json().catch(() => ({}))
  return { status: res.status, body: j, ms: Date.now() - t0 }
}

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('=== EIE v4.0.3 Smart Gates Verification ===\n')

  // G1: Sanity — objective too short → 422 INVALID_OBJECTIVE
  console.log('G1: Sanity gate — objective too short')
  const g1 = await call({ objective: 'short', domain: 'Finance', duration_weeks: 10, team_size: 5 })
  check('returns 422', g1.status === 422)
  check('code = INVALID_OBJECTIVE', g1.body?.error?.code === 'INVALID_OBJECTIVE')

  await sleep(3000)

  // G2: Sanity — budget over hard limit → 422
  console.log('\nG2: Sanity gate — budget over 500M DKK hard cap')
  const g2 = await call({ objective: 'Legit objective string long enough to pass min', domain: 'Finance', duration_weeks: 10, team_size: 5, budget_dkk: 600_000_000 })
  check('returns 422', g2.status === 422)
  check('code = BUDGET_OVER_HARD_LIMIT', g2.body?.error?.code === 'BUDGET_OVER_HARD_LIMIT')

  await sleep(3000)

  // G3: Sanity — duration over 260 weeks
  console.log('\nG3: Sanity gate — duration over 260w hard cap')
  const g3 = await call({ objective: 'Legit objective string long enough to pass min', domain: 'Finance', duration_weeks: 300, team_size: 5 })
  check('returns 422', g3.status === 422)
  check('code = DURATION_OVER_HARD_LIMIT', g3.body?.error?.code === 'DURATION_OVER_HARD_LIMIT')

  await sleep(3000)

  // G4: Sanity — team over 100
  console.log('\nG4: Sanity gate — team over 100 hard cap')
  const g4 = await call({ objective: 'Legit objective string long enough to pass min', domain: 'Finance', duration_weeks: 10, team_size: 150 })
  check('returns 422', g4.status === 422)
  check('code = TEAM_OVER_HARD_LIMIT', g4.body?.error?.code === 'TEAM_OVER_HARD_LIMIT')

  await sleep(3000)

  // G5: Normal plan (no gates triggered) — should succeed
  console.log('\nG5: Normal plan — no gates triggered')
  const g5 = await call({ objective: 'NIS2 compliance program for Danish retail bank with third-party risk', domain: 'Finance', duration_weeks: 16, team_size: 12, budget_dkk: 8_000_000 })
  check('returns 200', g5.status === 200)
  check('plan has phases', Array.isArray(g5.body?.data?.phases) && g5.body.data.phases.length > 0)
  check('high_stakes = false', g5.body?.data?.high_stakes === false)
  check('no consensus_proposal_id', !g5.body?.data?.consensus_proposal_id)
  check('no rlm_mission_id', !g5.body?.data?.rlm_mission_id)

  await sleep(3000)

  // G6: High-stakes — budget >20M → consensus gate fires
  console.log('\nG6: High-stakes — budget 30M DKK (consensus gate)')
  const g6 = await call({ objective: 'Enterprise digital transformation for Nordic financial holding with regulatory compliance', domain: 'Finance', duration_weeks: 28, team_size: 18, budget_dkk: 30_000_000 })
  check('returns 200', g6.status === 200, g6.status === 200 ? '' : JSON.stringify(g6.body).slice(0, 150))
  check('high_stakes = true', g6.body?.data?.high_stakes === true)
  check('has consensus_proposal_id', typeof g6.body?.data?.consensus_proposal_id === 'string' && g6.body.data.consensus_proposal_id.length > 5)
  check('consensus_quorum > 0', (g6.body?.data?.consensus_quorum ?? 0) > 0)

  await sleep(3000)

  // G7: Complex (long duration) — RLM mission + consensus both fire
  console.log('\nG7: Complex + high-stakes — 52 weeks (RLM mission + consensus)')
  const g7 = await call({ objective: 'Multi-year enterprise-wide NIS2 DORA transformation with cloud migration AI risk management', domain: 'Finance', duration_weeks: 52, team_size: 25, budget_dkk: 45_000_000 })
  check('returns 200', g7.status === 200, g7.status === 200 ? '' : JSON.stringify(g7.body).slice(0, 150))
  check('high_stakes = true', g7.body?.data?.high_stakes === true)
  check('has consensus_proposal_id', typeof g7.body?.data?.consensus_proposal_id === 'string')
  check('has rlm_mission_id', typeof g7.body?.data?.rlm_mission_id === 'string')
  check('rlm_steps_executed >= 1', (g7.body?.data?.rlm_steps_executed ?? 0) >= 1)
  check('plan has phases', (g7.body?.data?.phases?.length ?? 0) >= 3)

  console.log(`\n=== RESULTS ===`)
  console.log(`Pass: ${pass}`)
  console.log(`Fail: ${fail}`)
  console.log(`Total: ${pass + fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
