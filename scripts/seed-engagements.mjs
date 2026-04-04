// Seed 25 realistic past engagements via the orchestrator API.
// Uses the newly-deployed /api/engagements endpoints so that each seed
// hits createEngagement → Redis + Neo4j MERGE + raptor.index in one step.
const ORCH = 'https://orchestrator-production-c27e.up.railway.app'
const KEY = 'WidgeTDC_Orch_2026'

function iso(daysAgo) {
  return new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10) + 'T00:00:00Z'
}

const SEEDS = [
  {
    client: 'Nordea Bank',
    domain: 'Finance',
    objective: 'NIS2 compliance program implementation across Nordic retail banking operations with third-party risk management and incident reporting',
    start_date: iso(365),
    target_end_date: iso(180),
    budget_dkk: 8_500_000,
    team_size: 12,
    methodology_refs: ['NIS2', 'DORA', 'ISO 27001'],
    outcome: { grade: 'met', well: 'Regulator approval on first review. Strong stakeholder engagement.', wrong: 'Timeline slipped 3 weeks on third-party vendor assessment.' },
  },
  {
    client: 'Novo Nordisk',
    domain: 'Healthcare',
    objective: 'Digital therapeutics platform architecture for diabetes patient monitoring with GDPR and MDR compliance',
    start_date: iso(300),
    target_end_date: iso(120),
    budget_dkk: 12_000_000,
    team_size: 18,
    methodology_refs: ['GDPR', 'MDR', 'Design Thinking'],
    outcome: { grade: 'exceeded', well: 'MVP shipped 4 weeks early. CE mark on track.', wrong: 'Underestimated data protection officer review cycles.' },
  },
  {
    client: 'Maersk',
    domain: 'Operations',
    objective: 'End-to-end supply chain visibility platform with IoT sensor integration and predictive ETA machine learning',
    start_date: iso(400),
    target_end_date: iso(150),
    budget_dkk: 15_000_000,
    team_size: 22,
    methodology_refs: ['Lean Six Sigma', 'Value Stream Mapping'],
    outcome: { grade: 'met', well: 'Reduced port dwell time by 18 percent measured.', wrong: 'ML model accuracy below target for Asian routes.' },
  },
  {
    client: 'Danske Bank',
    domain: 'Finance',
    objective: 'Anti-money laundering transaction monitoring modernization with graph analytics and real-time scoring',
    start_date: iso(420),
    target_end_date: iso(200),
    budget_dkk: 22_000_000,
    team_size: 28,
    methodology_refs: ['AML', 'Graph Analytics', 'Agile'],
    outcome: { grade: 'partial', well: 'False positive rate cut 40 percent.', wrong: 'Legacy mainframe integration took twice expected time.' },
  },
  {
    client: 'Carlsberg',
    domain: 'Operations',
    objective: 'SAP S4HANA greenfield migration with RISE bundle for Nordic and Baltic brewing operations',
    start_date: iso(500),
    target_end_date: iso(220),
    budget_dkk: 45_000_000,
    team_size: 40,
    methodology_refs: ['SAP Activate', 'RISE with SAP', 'Change Management ADKAR'],
    outcome: { grade: 'met', well: 'Zero downtime cutover weekend. Strong training adoption.', wrong: 'Custom report migration underestimated by 15 percent.' },
  },
  {
    client: 'Orsted',
    domain: 'Energy',
    objective: 'Wind farm operations digital twin with predictive maintenance and turbine performance optimization',
    start_date: iso(350),
    target_end_date: iso(90),
    budget_dkk: 18_000_000,
    team_size: 20,
    methodology_refs: ['Digital Twin', 'Predictive Maintenance', 'IoT'],
    outcome: { grade: 'exceeded', well: '3.2 percent energy yield improvement vs baseline.', wrong: 'Cybersecurity review added 6 weeks mid-project.' },
  },
  {
    client: 'LEGO Group',
    domain: 'Retail',
    objective: 'Omnichannel unified commerce platform integrating stores ecommerce and LEGO VIP loyalty program',
    start_date: iso(380),
    target_end_date: iso(140),
    budget_dkk: 28_000_000,
    team_size: 32,
    methodology_refs: ['Design Thinking', 'Salesforce Commerce Cloud', 'MACH'],
    outcome: { grade: 'met', well: 'Unified customer view live across 650 stores.', wrong: 'Inventory sync edge cases caused launch delays.' },
  },
  {
    client: 'Pandora',
    domain: 'Retail',
    objective: 'AI-powered personalization and recommendation engine for global jewelry ecommerce with 100 markets',
    start_date: iso(290),
    target_end_date: iso(60),
    budget_dkk: 9_500_000,
    team_size: 14,
    methodology_refs: ['Machine Learning', 'A/B Testing', 'Personalization'],
    outcome: { grade: 'exceeded', well: 'Conversion lift 22 percent in personalized segments.', wrong: 'Cold start on new markets initially underperformed.' },
  },
  {
    client: 'Vestas',
    domain: 'Energy',
    objective: 'Manufacturing execution system modernization for wind turbine blade production with quality analytics',
    start_date: iso(450),
    target_end_date: iso(180),
    budget_dkk: 20_000_000,
    team_size: 25,
    methodology_refs: ['Manufacturing 4.0', 'Six Sigma DMAIC', 'MES'],
    outcome: { grade: 'met', well: 'Defect rate reduced 12 percent. Real-time OEE.', wrong: 'Change management resistance on shop floor.' },
  },
  {
    client: 'Saxo Bank',
    domain: 'Finance',
    objective: 'Trading platform latency optimization and multi-region active-active architecture for high-frequency retail trading',
    start_date: iso(320),
    target_end_date: iso(100),
    budget_dkk: 16_000_000,
    team_size: 18,
    methodology_refs: ['Site Reliability Engineering', 'Kafka Streams', 'Kubernetes'],
    outcome: { grade: 'exceeded', well: 'Order latency p99 reduced from 45ms to 12ms.', wrong: 'Database migration downtime window was tight.' },
  },
  {
    client: 'TryghedsGruppen',
    domain: 'Insurance',
    objective: 'Claims automation with computer vision for vehicle damage assessment and straight-through processing',
    start_date: iso(280),
    target_end_date: iso(80),
    budget_dkk: 11_000_000,
    team_size: 15,
    methodology_refs: ['Computer Vision', 'Claims Automation', 'RPA'],
    outcome: { grade: 'met', well: 'STP rate 45 percent for simple claims.', wrong: 'Edge cases on winter conditions needed more training data.' },
  },
  {
    client: 'Demant',
    domain: 'Healthcare',
    objective: 'Hearing aid telemetry cloud platform with GDPR-compliant patient insights and audiologist dashboards',
    start_date: iso(360),
    target_end_date: iso(150),
    budget_dkk: 13_000_000,
    team_size: 17,
    methodology_refs: ['GDPR', 'Cloud Architecture', 'IoT'],
    outcome: { grade: 'met', well: 'Strong audiologist NPS. Regulatory approval clean.', wrong: 'Patient mobile app engagement below target.' },
  },
  {
    client: 'Coloplast',
    domain: 'Healthcare',
    objective: 'Direct-to-consumer subscription and reorder platform for chronic care products with insurance integration',
    start_date: iso(410),
    target_end_date: iso(170),
    budget_dkk: 14_000_000,
    team_size: 19,
    methodology_refs: ['Subscription Commerce', 'Insurance Integration', 'GDPR'],
    outcome: { grade: 'partial', well: 'Launched in 5 countries on schedule.', wrong: 'Insurance claim integration delays in Germany and France.' },
  },
  {
    client: 'Chr Hansen',
    domain: 'Manufacturing',
    objective: 'Bioscience R&D data platform with strain library and fermentation analytics for food cultures',
    start_date: iso(340),
    target_end_date: iso(110),
    budget_dkk: 10_500_000,
    team_size: 13,
    methodology_refs: ['Data Mesh', 'Scientific Computing', 'LIMS'],
    outcome: { grade: 'exceeded', well: 'R&D experiment cycle time cut 30 percent.', wrong: 'Legacy LIMS integration was brittle.' },
  },
  {
    client: 'DSV',
    domain: 'Operations',
    objective: 'Transport management system consolidation post-acquisition with real-time freight visibility',
    start_date: iso(480),
    target_end_date: iso(190),
    budget_dkk: 32_000_000,
    team_size: 38,
    methodology_refs: ['Post-Merger Integration', 'TMS', 'EDI'],
    outcome: { grade: 'partial', well: 'Core routes consolidated successfully.', wrong: 'Long tail of niche carriers required extra integration work.' },
  },
  {
    client: 'Bestseller',
    domain: 'Retail',
    objective: 'Supply chain sustainability traceability from raw material to retail shelf with blockchain provenance',
    start_date: iso(300),
    target_end_date: iso(80),
    budget_dkk: 12_500_000,
    team_size: 16,
    methodology_refs: ['Blockchain', 'Supply Chain Traceability', 'CSRD'],
    outcome: { grade: 'met', well: 'CSRD reporting ready. Strong supplier adoption.', wrong: 'ROI story hard to articulate to finance.' },
  },
  {
    client: 'Netcompany',
    domain: 'Public Sector',
    objective: 'Citizen digital identity platform for municipal services with MitID integration and accessibility compliance',
    start_date: iso(370),
    target_end_date: iso(130),
    budget_dkk: 17_000_000,
    team_size: 22,
    methodology_refs: ['eIDAS2', 'MitID', 'WCAG Accessibility'],
    outcome: { grade: 'met', well: 'Accessibility audit passed at AAA level.', wrong: 'MitID API rate limits caused production issues.' },
  },
  {
    client: 'ISS',
    domain: 'Operations',
    objective: 'Facility management IoT sensor platform for energy and occupancy optimization across European office portfolio',
    start_date: iso(420),
    target_end_date: iso(160),
    budget_dkk: 19_000_000,
    team_size: 24,
    methodology_refs: ['IoT', 'Energy Management', 'BMS Integration'],
    outcome: { grade: 'exceeded', well: 'Energy savings 14 percent exceeded 10 percent target.', wrong: 'Sensor battery life was shorter than vendor claims.' },
  },
  {
    client: 'Lundbeck',
    domain: 'Pharma',
    objective: 'Clinical trial data platform with real-world evidence integration and regulatory submission automation',
    start_date: iso(460),
    target_end_date: iso(200),
    budget_dkk: 25_000_000,
    team_size: 30,
    methodology_refs: ['Clinical Data', 'FDA Submissions', 'Real World Evidence'],
    outcome: { grade: 'met', well: 'First submission on new platform accepted.', wrong: 'Validation documentation burden higher than planned.' },
  },
  {
    client: 'TDC NetCo',
    domain: 'Telco',
    objective: 'OSS/BSS modernization and fiber rollout operations platform with field engineer mobile workflows',
    start_date: iso(440),
    target_end_date: iso(170),
    budget_dkk: 35_000_000,
    team_size: 42,
    methodology_refs: ['TM Forum', 'Agile at Scale', 'Field Service'],
    outcome: { grade: 'partial', well: 'Fiber rollout velocity increased 25 percent.', wrong: 'Legacy BSS decommissioning pushed to phase 2.' },
  },
  {
    client: 'SimCorp',
    domain: 'Finance',
    objective: 'Investment management platform cloud migration with multi-tenant SaaS transformation for buy-side clients',
    start_date: iso(390),
    target_end_date: iso(110),
    budget_dkk: 26_000_000,
    team_size: 32,
    methodology_refs: ['Cloud Migration', 'Multi-tenant SaaS', 'AWS Well-Architected'],
    outcome: { grade: 'met', well: 'First 10 client tenants migrated cleanly.', wrong: 'Performance regressions on large position books needed tuning.' },
  },
  {
    client: 'SKAT Tax Agency',
    domain: 'Public Sector',
    objective: 'Tax administration AI-powered fraud detection and risk scoring across personal and corporate filings',
    start_date: iso(510),
    target_end_date: iso(220),
    budget_dkk: 22_000_000,
    team_size: 28,
    methodology_refs: ['Machine Learning', 'Fraud Detection', 'GDPR'],
    outcome: { grade: 'exceeded', well: 'Detected 3x more potential fraud cases.', wrong: 'Explainability requirements drove model architecture rework.' },
  },
  {
    client: 'Grundfos',
    domain: 'Manufacturing',
    objective: 'Connected pump platform with predictive maintenance and water efficiency optimization for utilities',
    start_date: iso(350),
    target_end_date: iso(100),
    budget_dkk: 14_500_000,
    team_size: 19,
    methodology_refs: ['IoT', 'Predictive Maintenance', 'Digital Twin'],
    outcome: { grade: 'met', well: 'Utility customer trials successful.', wrong: 'OT/IT integration security review added delay.' },
  },
  {
    client: 'Jyske Bank',
    domain: 'Finance',
    objective: 'Open banking API platform with PSD2 compliance and third-party fintech partner onboarding',
    start_date: iso(330),
    target_end_date: iso(120),
    budget_dkk: 11_000_000,
    team_size: 15,
    methodology_refs: ['PSD2', 'Open Banking', 'API Management'],
    outcome: { grade: 'met', well: '12 fintech partners onboarded in first quarter.', wrong: 'Consent management UX needed iteration.' },
  },
  {
    client: 'Rockwool',
    domain: 'Manufacturing',
    objective: 'Insulation product configurator and building performance simulation platform for architects and contractors',
    start_date: iso(310),
    target_end_date: iso(90),
    budget_dkk: 9_800_000,
    team_size: 13,
    methodology_refs: ['Product Configurator', 'Building Simulation', 'B2B Commerce'],
    outcome: { grade: 'exceeded', well: 'Adopted by top 50 Nordic architecture firms within 3 months.', wrong: 'Internationalization effort was larger than planned.' },
  },
]

async function call(method, path, body) {
  const res = await fetch(`${ORCH}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  })
  const j = await res.json()
  return { status: res.status, json: j }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log(`=== Seeding ${SEEDS.length} engagements ===\n`)
  const t0 = Date.now()
  let created = 0
  let withOutcomes = 0

  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i]
    const createRes = await call('POST', '/api/engagements', {
      client: s.client,
      domain: s.domain,
      objective: s.objective,
      start_date: s.start_date,
      target_end_date: s.target_end_date,
      budget_dkk: s.budget_dkk,
      team_size: s.team_size,
      methodology_refs: s.methodology_refs,
    })

    if (createRes.status !== 201 || !createRes.json?.data?.$id) {
      console.log(`[${i + 1}/${SEEDS.length}] ✗ ${s.client} — create failed: ${createRes.status}`)
      continue
    }
    const engId = createRes.json.data.$id
    created++

    // Record outcome (most of these are "past" engagements)
    if (s.outcome) {
      const outcomeRes = await call('POST', `/api/engagements/${encodeURIComponent(engId)}/outcome`, {
        grade: s.outcome.grade,
        actual_end_date: s.target_end_date,
        deliverables_shipped: s.methodology_refs.map(m => `${m} artifacts`),
        what_went_well: s.outcome.well,
        what_went_wrong: s.outcome.wrong,
        precedent_match_accuracy: s.outcome.grade === 'exceeded' ? 0.9 : s.outcome.grade === 'met' ? 0.75 : s.outcome.grade === 'partial' ? 0.5 : 0.2,
        recorded_by: 'seed-script',
      })
      if (outcomeRes.status === 201) withOutcomes++
    }

    console.log(`[${i + 1}/${SEEDS.length}] ✓ ${s.client} (${s.domain}) — ${engId.slice(0, 20)}`)
    await sleep(500) // Polite pacing
  }

  console.log(`\n=== Done ===`)
  console.log(`Created: ${created}/${SEEDS.length}`)
  console.log(`Outcomes recorded: ${withOutcomes}/${SEEDS.length}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
