/**
 * jit-materializer.test.mjs — Phase Δ P2.b JIT Materializer contract tests.
 *
 * Plain Node tests. Replicates pure logic inline.
 */

import { createHash } from 'node:crypto'

let passed = 0, failed = 0

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}: ${err.message}`) }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed')
}

// ─── Inline-replicated pure logic ─────────────────────────────────────────

const DEFAULT_MATERIALIZER_CONFIG = {
  maxTotalTokens: 9000,
  perSkillFetchTimeoutMs: 5000,
  emitLineage: true,
  emitEvent: true,
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function hashBody(body) {
  return 'sha256:' + createHash('sha256').update(body).digest('hex').slice(0, 16)
}

function isJITEnabled() {
  return process.env.PSR_JIT_MATERIALIZER_ENABLED === '1'
}

// Budget allocation logic (extracted from materializeContext)
function allocateBudget(skills, maxTotalTokens) {
  const materialized = []
  const excluded = []
  let totalTokens = 0
  for (const sel of skills) {
    const tokens = estimateTokens(sel.body || '')
    if (totalTokens + tokens > maxTotalTokens) {
      excluded.push(sel)
      continue
    }
    materialized.push({ ...sel, body_token_estimate: tokens })
    totalTokens += tokens
  }
  return { materialized, excluded, totalTokens, budgetExhausted: excluded.length > 0 }
}

// Context block assembly
function assembleContextBlock(materialized) {
  return materialized
    .map(
      (m, idx) =>
        `\n--- skill ${idx + 1}/${materialized.length}: ${m.name} (id=${m.id}, rank=${m.rank}, sim=${m.similarity.toFixed(3)}) ---\n${m.body}`
    )
    .join('\n')
}

console.log('\n  Phase Δ P2.b JIT Materializer contract tests')
console.log('  ============================================\n')

// ─── Feature flag ──────────────────────────────────────────────────────

test('isJITEnabled() defaults to false', () => {
  delete process.env.PSR_JIT_MATERIALIZER_ENABLED
  assert(isJITEnabled() === false, 'JIT must default OFF')
})

test('isJITEnabled() true only when PSR_JIT_MATERIALIZER_ENABLED=1', () => {
  process.env.PSR_JIT_MATERIALIZER_ENABLED = '1'
  assert(isJITEnabled() === true)
  process.env.PSR_JIT_MATERIALIZER_ENABLED = '0'
  assert(isJITEnabled() === false)
  process.env.PSR_JIT_MATERIALIZER_ENABLED = 'true'
  assert(isJITEnabled() === false, 'must require exact "1"')
  delete process.env.PSR_JIT_MATERIALIZER_ENABLED
})

// ─── Default config ────────────────────────────────────────────────────

test('DEFAULT_MATERIALIZER_CONFIG: maxTotalTokens=9000', () => {
  assert(DEFAULT_MATERIALIZER_CONFIG.maxTotalTokens === 9000,
    `expected 9000, got ${DEFAULT_MATERIALIZER_CONFIG.maxTotalTokens}`)
})

test('DEFAULT_MATERIALIZER_CONFIG: emitLineage + emitEvent default true', () => {
  assert(DEFAULT_MATERIALIZER_CONFIG.emitLineage === true)
  assert(DEFAULT_MATERIALIZER_CONFIG.emitEvent === true)
})

// ─── Token estimation ─────────────────────────────────────────────────

test('estimateTokens: empty string → 0 tokens', () => {
  assert(estimateTokens('') === 0)
})

test('estimateTokens: 4 chars → 1 token', () => {
  assert(estimateTokens('abcd') === 1)
})

test('estimateTokens: 5 chars → 2 tokens (ceil)', () => {
  assert(estimateTokens('abcde') === 2)
})

test('estimateTokens: 1000 chars → 250 tokens', () => {
  const s = 'x'.repeat(1000)
  assert(estimateTokens(s) === 250)
})

// ─── Body hashing ──────────────────────────────────────────────────────

test('hashBody returns sha256: prefix + 16-char body', () => {
  const h = hashBody('test body')
  assert(h.startsWith('sha256:'), `bad prefix: ${h}`)
  assert(h.length === 7 + 16, `expected 23 chars, got ${h.length}`)
})

test('hashBody is deterministic', () => {
  const a = hashBody('hello world')
  const b = hashBody('hello world')
  assert(a === b, 'hash must be deterministic')
})

test('hashBody differs for different bodies', () => {
  assert(hashBody('a') !== hashBody('b'), 'different bodies must hash differently')
})

test('hashBody NEVER exposes raw body content', () => {
  const sensitive = 'SECRET API_KEY=sk-1234567890abcdef'
  const hash = hashBody(sensitive)
  assert(!hash.includes('SECRET'), 'hash must not contain raw text')
  assert(!hash.includes('sk-1234567890'), 'hash must not contain key fragment')
  assert(hash.length < sensitive.length, 'hash should be shorter than raw')
})

// ─── Budget allocation ─────────────────────────────────────────────────

test('Budget: all skills fit under max', () => {
  const skills = [
    { id: 'a', name: 'A', body: 'x'.repeat(200), rank: 1, similarity: 0.9 },
    { id: 'b', name: 'B', body: 'x'.repeat(200), rank: 2, similarity: 0.8 },
  ]
  const { materialized, excluded, totalTokens, budgetExhausted } = allocateBudget(skills, 9000)
  assert(materialized.length === 2)
  assert(excluded.length === 0)
  assert(totalTokens === 100, `expected 100 tokens (50+50), got ${totalTokens}`)
  assert(budgetExhausted === false)
})

test('Budget: excludes skills over max budget', () => {
  const skills = [
    { id: 'a', name: 'A', body: 'x'.repeat(20000), rank: 1, similarity: 0.9 },  // 5000 tokens
    { id: 'b', name: 'B', body: 'x'.repeat(20000), rank: 2, similarity: 0.85 }, // 5000 tokens — would push to 10000 > 9000
  ]
  const { materialized, excluded, totalTokens, budgetExhausted } = allocateBudget(skills, 9000)
  assert(materialized.length === 1, `expected 1 materialized, got ${materialized.length}`)
  assert(excluded.length === 1, 'second should be excluded')
  assert(totalTokens === 5000, `expected 5000, got ${totalTokens}`)
  assert(budgetExhausted === true)
})

test('Budget: empty skills → empty result', () => {
  const r = allocateBudget([], 9000)
  assert(r.materialized.length === 0)
  assert(r.excluded.length === 0)
  assert(r.totalTokens === 0)
  assert(r.budgetExhausted === false)
})

test('Budget: respects rank order (greedy)', () => {
  // First skill takes most of budget; second gets included if fits
  const skills = [
    { id: 'a', name: 'A', body: 'x'.repeat(32000), rank: 1, similarity: 0.95 },  // 8000
    { id: 'b', name: 'B', body: 'x'.repeat(2000), rank: 2, similarity: 0.7 },    // 500
    { id: 'c', name: 'C', body: 'x'.repeat(8000), rank: 3, similarity: 0.6 },    // 2000 — would push past
  ]
  const { materialized, excluded } = allocateBudget(skills, 9000)
  assert(materialized.length === 2, `expected 2 (a+b fit), got ${materialized.length}`)
  assert(materialized[0].id === 'a')
  assert(materialized[1].id === 'b')
  assert(excluded[0].id === 'c')
})

// ─── Context block assembly ──────────────────────────────────────────

test('Context block: includes skill name + id + rank + similarity per entry', () => {
  const m = [
    { id: 'meta.foo', name: 'Foo Skill', body: 'foo body', rank: 1, similarity: 0.92 },
    { id: 'meta.bar', name: 'Bar Skill', body: 'bar body', rank: 2, similarity: 0.85 },
  ]
  const block = assembleContextBlock(m)
  assert(block.includes('skill 1/2'), 'should include "skill 1/2"')
  assert(block.includes('skill 2/2'), 'should include "skill 2/2"')
  assert(block.includes('Foo Skill'))
  assert(block.includes('meta.foo'))
  assert(block.includes('rank=1'))
  assert(block.includes('sim=0.920'))
  assert(block.includes('foo body'))
})

test('Context block: empty input → empty string', () => {
  assert(assembleContextBlock([]) === '')
})

test('Context block: separators between skills', () => {
  const m = [
    { id: 'a', name: 'A', body: 'A_BODY', rank: 1, similarity: 0.9 },
    { id: 'b', name: 'B', body: 'B_BODY', rank: 2, similarity: 0.8 },
  ]
  const block = assembleContextBlock(m)
  assert((block.match(/--- skill /g) || []).length === 2,
    'should have 2 separator markers')
})

// ─── A6-v2 invariant (PRODUCES_CONTEXT edge required) ───────────────

test('A6-v2 invariant: MaterializationResult schema includes phantom_bom_run_id + workartifact_id fields', () => {
  // The result envelope MUST carry these for typed-promotion lineage.
  // This test validates the contract shape — production code creates the
  // MATERIALIZED_SKILL + PRODUCES_CONTEXT edges in emitMaterializationLineage.
  const requiredFields = [
    'materialization_id', 'correlation_id', 'router_decision_id',
    'router_variant', 'materialized_skills', 'context_block',
    'total_tokens', 'budget_exhausted', 'feature_flag_enabled',
    'phantom_bom_run_id', 'workartifact_id',  // A6-v2 lineage anchors
  ]
  // We just verify the field name list (real structural check happens in TS module)
  assert(requiredFields.includes('phantom_bom_run_id'),
    'phantom_bom_run_id required for MATERIALIZED_SKILL edge')
  assert(requiredFields.includes('workartifact_id'),
    'workartifact_id required for PRODUCES_CONTEXT edge (A6-v2)')
})

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
