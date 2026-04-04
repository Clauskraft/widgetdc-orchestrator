// v4.0.2: Repair missing :EngagementOutcome edges.
// Seed script race condition: recordOutcome ran before mergeEngagementNode completed,
// so MATCH (eng) failed silently. Now that all Engagements exist in Neo4j, re-apply
// outcomes directly via graph.write_cypher MERGE.
const BACKEND = 'https://backend-production-d3da.up.railway.app'
const KEY = 'Heravej_22'

// Same seed data but with outcomes (matched by client name)
const OUTCOMES = [
  { client: 'Nordea Bank', grade: 'met', well: 'Regulator approval on first review. Strong stakeholder engagement.', wrong: 'Timeline slipped 3 weeks on third-party vendor assessment.' },
  { client: 'Novo Nordisk', grade: 'exceeded', well: 'MVP shipped 4 weeks early. CE mark on track.', wrong: 'Underestimated data protection officer review cycles.' },
  { client: 'Maersk', grade: 'met', well: 'Reduced port dwell time by 18 percent measured.', wrong: 'ML model accuracy below target for Asian routes.' },
  { client: 'Danske Bank', grade: 'partial', well: 'False positive rate cut 40 percent.', wrong: 'Legacy mainframe integration took twice expected time.' },
  { client: 'Carlsberg', grade: 'met', well: 'Zero downtime cutover weekend. Strong training adoption.', wrong: 'Custom report migration underestimated by 15 percent.' },
  { client: 'Orsted', grade: 'exceeded', well: '3.2 percent energy yield improvement vs baseline.', wrong: 'Cybersecurity review added 6 weeks mid-project.' },
  { client: 'LEGO Group', grade: 'met', well: 'Unified customer view live across 650 stores.', wrong: 'Inventory sync edge cases caused launch delays.' },
  { client: 'Pandora', grade: 'exceeded', well: 'Conversion lift 22 percent in personalized segments.', wrong: 'Cold start on new markets initially underperformed.' },
  { client: 'Vestas', grade: 'met', well: 'Defect rate reduced 12 percent. Real-time OEE.', wrong: 'Change management resistance on shop floor.' },
  { client: 'Saxo Bank', grade: 'exceeded', well: 'Order latency p99 reduced from 45ms to 12ms.', wrong: 'Database migration downtime window was tight.' },
  { client: 'TryghedsGruppen', grade: 'met', well: 'STP rate 45 percent for simple claims.', wrong: 'Edge cases on winter conditions needed more training data.' },
  { client: 'Demant', grade: 'met', well: 'Strong audiologist NPS. Regulatory approval clean.', wrong: 'Patient mobile app engagement below target.' },
  { client: 'Coloplast', grade: 'partial', well: 'Launched in 5 countries on schedule.', wrong: 'Insurance claim integration delays in Germany and France.' },
  { client: 'Chr Hansen', grade: 'exceeded', well: 'R&D experiment cycle time cut 30 percent.', wrong: 'Legacy LIMS integration was brittle.' },
  { client: 'DSV', grade: 'partial', well: 'Core routes consolidated successfully.', wrong: 'Long tail of niche carriers required extra integration work.' },
  { client: 'Bestseller', grade: 'met', well: 'CSRD reporting ready. Strong supplier adoption.', wrong: 'ROI story hard to articulate to finance.' },
  { client: 'Netcompany', grade: 'met', well: 'Accessibility audit passed at AAA level.', wrong: 'MitID API rate limits caused production issues.' },
  { client: 'ISS', grade: 'exceeded', well: 'Energy savings 14 percent exceeded 10 percent target.', wrong: 'Sensor battery life was shorter than vendor claims.' },
  { client: 'Lundbeck', grade: 'met', well: 'First submission on new platform accepted.', wrong: 'Validation documentation burden higher than planned.' },
  { client: 'TDC NetCo', grade: 'partial', well: 'Fiber rollout velocity increased 25 percent.', wrong: 'Legacy BSS decommissioning pushed to phase 2.' },
  { client: 'SimCorp', grade: 'met', well: 'First 10 client tenants migrated cleanly.', wrong: 'Performance regressions on large position books needed tuning.' },
  { client: 'SKAT Tax Agency', grade: 'exceeded', well: 'Detected 3x more potential fraud cases.', wrong: 'Explainability requirements drove model architecture rework.' },
  { client: 'Grundfos', grade: 'met', well: 'Utility customer trials successful.', wrong: 'OT/IT integration security review added delay.' },
  { client: 'Jyske Bank', grade: 'met', well: '12 fintech partners onboarded in first quarter.', wrong: 'Consent management UX needed iteration.' },
  { client: 'Rockwool', grade: 'exceeded', well: 'Adopted by top 50 Nordic architecture firms.', wrong: 'Internationalization effort was larger than planned.' },
]

async function exec(query, params) {
  const res = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({ tool: 'graph.write_cypher', payload: { query, params, _force: true } }),
    signal: AbortSignal.timeout(30000),
  })
  return res.json()
}

async function main() {
  console.log(`=== Repairing ${OUTCOMES.length} EngagementOutcome edges ===\n`)
  const t0 = Date.now()
  let repaired = 0, failed = 0

  for (const o of OUTCOMES) {
    const precAcc = o.grade === 'exceeded' ? 0.9 : o.grade === 'met' ? 0.75 : o.grade === 'partial' ? 0.5 : 0.2
    try {
      const result = await exec(
        `MATCH (e:Engagement {client: $client})
MERGE (out:EngagementOutcome {engagementId: e.id})
SET out.grade = $grade,
    out.completedAt = datetime(),
    out.whatWentWell = $well,
    out.whatWentWrong = $wrong,
    out.precedentAccuracy = $precAcc,
    out.recordedBy = 'repair-script',
    out.updatedAt = datetime()
MERGE (e)-[:HAS_OUTCOME]->(out)
SET e.status = 'completed'
RETURN e.id AS engagementId, out.grade AS grade`,
        { client: o.client, grade: o.grade, well: o.well, wrong: o.wrong, precAcc }
      )
      const ok = result?.result?.success !== false && (result?.result?.results?.length ?? 0) > 0
      if (ok) {
        repaired++
        console.log(`✓ ${o.client} — ${o.grade}`)
      } else {
        failed++
        console.log(`✗ ${o.client} — ${JSON.stringify(result).slice(0, 150)}`)
      }
    } catch (err) {
      failed++
      console.log(`✗ ${o.client} — ${String(err).slice(0, 100)}`)
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Repaired: ${repaired}/${OUTCOMES.length}`)
  console.log(`Failed: ${failed}`)
  console.log(`Duration: ${Date.now() - t0}ms`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
