/**
 * write-gate-inline-merge.test.mjs — Regression tests for B-5 inline-MERGE
 *
 * Bug 2026-04-28: write-gate B-5 rejected legitimate Inventor writes:
 *   - MERGE (e:InventorExperiment {name: $experiment}) ...   ← inline name pattern
 *   - MERGE (t:InventorTrial {id: $nodeId}) ...              ← UUID id, no name
 *
 * This test replicates the B-5 rule inline (same pattern as other tests in this dir
 * that don't import src/) and verifies both the new inline-MERGE name detection
 * and the InventorExperiment/InventorTrial/InventorNode exemptions.
 *
 * Usage: node test/write-gate-inline-merge.test.mjs
 */

let passed = 0, failed = 0

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}: ${err.message}`) }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed') }

// Replicates write-gate.ts B-5 rule (post-fix 2026-04-28)
function checkB5(query, params) {
  const isNodeCreation = /(?:CREATE|MERGE)\s*\([^)]*:[A-Z]\w+/i.test(query)
    && /ON\s+CREATE\s+SET|CREATE\s*\(/i.test(query)
  if (!isNodeCreation) return { allowed: true }

  const hasIdentifier = Object.entries(params).some(([key, val]) => {
    return (key === 'title' || key === 'name' || key === 'filename')
      && typeof val === 'string' && val.trim().length > 0
  })
  const setsIdentifier = /SET\s+\w+\.(title|name|filename)\s*=/i.test(query)

  // Post-fix B-5b: inline MERGE (x:Label {name: $param})
  let mergesIdentifierInline = false
  const inlineMatch = query.match(/(?:MERGE|CREATE)\s*\(\w*:\w+\s*\{[^}]*\b(title|name|filename)\s*:\s*\$(\w+)/i)
  if (inlineMatch) {
    const inlineParam = inlineMatch[2]
    const inlineVal = params[inlineParam]
    if (typeof inlineVal === 'string' && inlineVal.trim().length > 0) {
      mergesIdentifierInline = true
    }
  }

  if (hasIdentifier || setsIdentifier || mergesIdentifierInline) return { allowed: true }

  const isInfraNode = /:(GraphHealthSnapshot|RLMDecision|RLMTool|RLMPattern|InventorExperiment|InventorTrial|InventorNode|TenantBudget|InferenceSpend|ExternalProviderCall|ManifestoPrinciple)/i.test(query)
  if (isInfraNode) return { allowed: true }

  return { allowed: false, reason: 'New nodes must have a non-empty title, name, or filename' }
}

console.log('\n  B-5 write-gate regression tests (inline-MERGE + Inventor exempt)')
console.log('  =================================================================\n')

// ─── Inline-MERGE name pattern (the actual Inventor use case) ─────────────
test('InventorExperiment with inline {name: $param} — ALLOWED', () => {
  const r = checkB5(
    `MERGE (e:InventorExperiment {name: $experiment})
     ON CREATE SET e.startedAt = datetime()
     SET e.taskDescription = $taskDescription`,
    { experiment: 'phantom-skill-registry-psr-v2', taskDescription: 'evolve PSR variants' }
  )
  assert(r.allowed, `expected allowed, got: ${r.reason}`)
})

test('inline MERGE with title param — ALLOWED', () => {
  const r = checkB5(
    `MERGE (n:ResearchProject {title: $titleParam}) ON CREATE SET n.created_at = datetime()`,
    { titleParam: 'Phantom Skill Registry analysis' }
  )
  assert(r.allowed)
})

test('inline MERGE with filename param — ALLOWED', () => {
  const r = checkB5(
    `MERGE (d:Document {filename: $fname}) ON CREATE SET d.uploaded_at = datetime()`,
    { fname: 'psr-architecture.md' }
  )
  assert(r.allowed)
})

test('inline MERGE with EMPTY string in name → still REJECTED', () => {
  const r = checkB5(
    `MERGE (n:GenericNode {name: $emptyName}) ON CREATE SET n.created_at = datetime()`,
    { emptyName: '' }
  )
  assert(!r.allowed)
})

// ─── Inventor* exempt labels (UUID-id append-only lineage) ────────────────
test('InventorTrial with id only (no name) — EXEMPT', () => {
  const r = checkB5(
    `MERGE (t:InventorTrial {id: $nodeId}) ON CREATE SET t.score = $score, t.artifact = $artifact`,
    { nodeId: 'trial-uuid-123', score: 0.8, artifact: '...' }
  )
  assert(r.allowed)
})

test('InventorNode with id only — EXEMPT', () => {
  const r = checkB5(
    `MERGE (n:InventorNode {id: $id}) ON CREATE SET n.created_at = datetime()`,
    { id: 'node-uuid-xyz' }
  )
  assert(r.allowed)
})

// ─── Existing exemptions still work ──────────────────────────────────────
test('GraphHealthSnapshot still EXEMPT', () => {
  const r = checkB5(
    `MERGE (s:GraphHealthSnapshot {id: $id}) ON CREATE SET s.captured_at = datetime()`,
    { id: 'snap-1' }
  )
  assert(r.allowed)
})

test('RLMDecision still EXEMPT', () => {
  const r = checkB5(
    `MERGE (d:RLMDecision {id: $id}) ON CREATE SET d.score = $score`,
    { id: 'dec-1', score: 0.5 }
  )
  assert(r.allowed)
})

// ─── New 2026-04-28: LLM cost-governance labels exempted ─────────────────
test('TenantBudget (cost-governance preflight) — EXEMPT', () => {
  const r = checkB5(
    `MERGE (b:TenantBudget {id: $budget_id}) ON CREATE SET b.tenant_id = $tenant_id, b.period = date($period), b.hard_limit = $hard_limit, b.created_at = datetime()`,
    { budget_id: 'widgetdc-platform:2026-04-28', tenant_id: 'widgetdc-platform', period: '2026-04-28', hard_limit: 120000 }
  )
  assert(r.allowed)
})

test('InferenceSpend (cost-governance settle) — EXEMPT', () => {
  const r = checkB5(
    `MERGE (s:InferenceSpend {id: $spend_id}) ON CREATE SET s.tokens = $tokens, s.created_at = datetime()`,
    { spend_id: 'spend-uuid-1', tokens: 100 }
  )
  assert(r.allowed)
})

test('ExternalProviderCall (cost-governance settle) — EXEMPT', () => {
  const r = checkB5(
    `MERGE (e:ExternalProviderCall {id: $provider_call_id}) ON CREATE SET e.provider = $provider, e.created_at = datetime()`,
    { provider_call_id: 'pc-uuid-1', provider: 'deepseek' }
  )
  assert(r.allowed)
})

test('ManifestoPrinciple (governance schema) — EXEMPT', () => {
  const r = checkB5(
    `MERGE (p:ManifestoPrinciple {number: $number}) ON CREATE SET p.text = $text, p.created_at = datetime()`,
    { number: 1, text: 'principle text' }
  )
  assert(r.allowed)
})

// ─── Negative tests: arbitrary nameless nodes still rejected ─────────────
test('arbitrary nameless node — REJECTED', () => {
  const r = checkB5(
    `MERGE (x:RandomLLMOutput {id: $id}) ON CREATE SET x.payload = $payload`,
    { id: 'arb-1', payload: 'whatever' }
  )
  assert(!r.allowed)
})

test('CREATE without name/title/filename — REJECTED', () => {
  const r = checkB5(
    `CREATE (x:NoIdentifier {payload: $p})`,
    { p: 'data' }
  )
  assert(!r.allowed)
})

// ─── Existing positive paths still work ───────────────────────────────────
test('SET with name still ALLOWED', () => {
  const r = checkB5(
    `MERGE (n:Doc {id: $id}) ON CREATE SET n.created_at = datetime() SET n.name = $name`,
    { id: 'd-1', name: 'My Doc' }
  )
  assert(r.allowed)
})

test('params.name still ALLOWED', () => {
  const r = checkB5(
    `MERGE (n:Person {id: $id}) ON CREATE SET n.created_at = datetime(), n.name = $name`,
    { id: 'p-1', name: 'Claus' }
  )
  assert(r.allowed)
})

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
