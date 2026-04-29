/**
 * intent-router.test.mjs — Phase Δ P2.a IntentRouter contract tests.
 *
 * Plain Node test (matches widgetdc-orchestrator/test/*.test.mjs pattern).
 * Replicates pure-logic functions inline to test SHAPE without TS compile.
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

// ─── Inline-replicated pure logic from src/intelligence/intent-router.ts ─

const DEFAULT_ROUTER_CONFIG = {
  topK: 3,
  mmrLambda: 0.5,
  minSimilarity: 0.4,
  variant: 'B',
  skillTypeFilter: 'meta_skill',
}

function applyMMR(candidates, config) {
  const selected = []
  const remaining = [...candidates]
  while (selected.length < config.topK && remaining.length > 0) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]
      const prefix = cand.id.split('.')[0] + '.' + (cand.id.split('.')[1] ?? '')
      const sameClusterCount = selected.filter((s) =>
        s.id.startsWith(prefix.split('_')[0])
      ).length
      const diversityPenalty = sameClusterCount * 0.15
      const mmr = config.mmrLambda * cand.similarity - (1 - config.mmrLambda) * diversityPenalty
      if (mmr > bestScore) {
        bestScore = mmr
        bestIdx = i
      }
    }
    const winner = remaining.splice(bestIdx, 1)[0]
    winner.rank = selected.length + 1
    selected.push(winner)
  }
  return selected
}

function applyVariantFRerank(candidates, config) {
  const mmrSelected = applyMMR(candidates, config)
  return mmrSelected
    .map((s) => ({
      ...s,
      similarity:
        s.similarity * 0.7 +
        Math.log1p(s.invocation_count ?? 0) * 0.1 +
        (s.confidence ?? 0) * 0.2,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .map((s, idx) => ({ ...s, rank: idx + 1 }))
}

function isRouterEnabled() {
  return process.env.PSR_INTENT_ROUTER_ENABLED === '1'
}

function getRouterVariant() {
  const v = (process.env.PSR_ROUTER_VARIANT || 'B').toUpperCase()
  return v === 'F' ? 'F' : 'B'
}

console.log('\n  Phase Δ P2.a IntentRouter contract tests')
console.log('  ========================================\n')

// ─── Feature flag defaults ──────────────────────────────────────────────

test('isRouterEnabled() defaults to false (no env var)', () => {
  delete process.env.PSR_INTENT_ROUTER_ENABLED
  assert(isRouterEnabled() === false, 'router must default OFF')
})

test('isRouterEnabled() true only when PSR_INTENT_ROUTER_ENABLED=1', () => {
  process.env.PSR_INTENT_ROUTER_ENABLED = '1'
  assert(isRouterEnabled() === true)
  process.env.PSR_INTENT_ROUTER_ENABLED = '0'
  assert(isRouterEnabled() === false)
  process.env.PSR_INTENT_ROUTER_ENABLED = 'true'
  assert(isRouterEnabled() === false, 'must require exact "1" string')
  delete process.env.PSR_INTENT_ROUTER_ENABLED
})

test('getRouterVariant() defaults to B (production)', () => {
  delete process.env.PSR_ROUTER_VARIANT
  assert(getRouterVariant() === 'B')
})

test('getRouterVariant() respects PSR_ROUTER_VARIANT=F', () => {
  process.env.PSR_ROUTER_VARIANT = 'F'
  assert(getRouterVariant() === 'F')
  process.env.PSR_ROUTER_VARIANT = 'f'
  assert(getRouterVariant() === 'F', 'should be case-insensitive')
  process.env.PSR_ROUTER_VARIANT = 'X'
  assert(getRouterVariant() === 'B', 'unknown variant falls back to B')
  delete process.env.PSR_ROUTER_VARIANT
})

// ─── DEFAULT_ROUTER_CONFIG ──────────────────────────────────────────────

test('DEFAULT_ROUTER_CONFIG: topK=3, mmrLambda=0.5, minSim=0.4', () => {
  assert(DEFAULT_ROUTER_CONFIG.topK === 3)
  assert(DEFAULT_ROUTER_CONFIG.mmrLambda === 0.5, 'plan v2 specifies λ=0.5')
  assert(DEFAULT_ROUTER_CONFIG.minSimilarity === 0.4)
  assert(DEFAULT_ROUTER_CONFIG.variant === 'B', 'default variant is B (Variant B 0.85)')
  assert(DEFAULT_ROUTER_CONFIG.skillTypeFilter === 'meta_skill', 'default to meta-skill candidates')
})

// ─── MMR algorithm ─────────────────────────────────────────────────────

test('MMR returns up to topK results', () => {
  const candidates = [
    { id: 'meta.foo_a', name: 'A', similarity: 0.9, rank: 1 },
    { id: 'meta.bar_b', name: 'B', similarity: 0.85, rank: 2 },
    { id: 'meta.baz_c', name: 'C', similarity: 0.8, rank: 3 },
    { id: 'meta.qux_d', name: 'D', similarity: 0.75, rank: 4 },
    { id: 'meta.zaz_e', name: 'E', similarity: 0.7, rank: 5 },
  ]
  const result = applyMMR(candidates, { topK: 3, mmrLambda: 0.5 })
  assert(result.length === 3, `expected 3, got ${result.length}`)
})

test('MMR returns at-most candidates count', () => {
  const candidates = [
    { id: 'meta.foo', name: 'A', similarity: 0.9, rank: 1 },
  ]
  const result = applyMMR(candidates, { topK: 5, mmrLambda: 0.5 })
  assert(result.length === 1, 'cannot return more than candidates')
})

test('MMR with λ=1.0 (relevance only) selects top-K by similarity', () => {
  const candidates = [
    { id: 'a.b', similarity: 0.9, rank: 1 },
    { id: 'c.d', similarity: 0.85, rank: 2 },
    { id: 'e.f', similarity: 0.5, rank: 3 },
  ]
  const result = applyMMR(candidates, { topK: 2, mmrLambda: 1.0 })
  assert(result[0].id === 'a.b', `expected a.b first, got ${result[0].id}`)
  assert(result[1].id === 'c.d', `expected c.d second, got ${result[1].id}`)
})

test('MMR re-ranks results 1..K', () => {
  const candidates = [
    { id: 'a.b', similarity: 0.9, rank: 99 },
    { id: 'c.d', similarity: 0.85, rank: 99 },
    { id: 'e.f', similarity: 0.8, rank: 99 },
  ]
  const result = applyMMR(candidates, { topK: 3, mmrLambda: 0.5 })
  assert(result[0].rank === 1)
  assert(result[1].rank === 2)
  assert(result[2].rank === 3)
})

test('MMR handles empty candidates', () => {
  const result = applyMMR([], { topK: 3, mmrLambda: 0.5 })
  assert(result.length === 0, 'empty in → empty out')
})

// ─── Variant F (hybrid) ─────────────────────────────────────────────────

test('Variant F applies invocation_count + confidence boost on top of MMR', () => {
  const candidates = [
    { id: 'meta.a', similarity: 0.8, invocation_count: 100, confidence: 0.9, rank: 1 },
    { id: 'meta.b', similarity: 0.85, invocation_count: 0, confidence: 0.5, rank: 2 },
  ]
  const result = applyVariantFRerank(candidates, { topK: 2, mmrLambda: 0.5 })
  // meta.a should rank higher despite lower base similarity due to history boost:
  //   meta.a: 0.8*0.7 + log(101)*0.1 + 0.9*0.2 = 0.56 + 0.461 + 0.18 = 1.20
  //   meta.b: 0.85*0.7 + log(1)*0.1 + 0.5*0.2 = 0.595 + 0 + 0.1 = 0.695
  assert(result[0].id === 'meta.a',
    `Variant F should boost high-invocation skills; got ${result[0].id}`)
})

test('Variant F handles missing invocation_count + confidence', () => {
  const candidates = [
    { id: 'meta.x', similarity: 0.9, rank: 1 },  // no history
  ]
  const result = applyVariantFRerank(candidates, { topK: 1, mmrLambda: 0.5 })
  assert(result.length === 1, 'should not throw on missing fields')
  // Score should be 0.9*0.7 + log(1)*0.1 + 0*0.2 = 0.63
  assert(Math.abs(result[0].similarity - 0.63) < 0.001,
    `expected ~0.63, got ${result[0].similarity}`)
})

// ─── Edge cases ────────────────────────────────────────────────────────

test('topK clamping: must be >= 1 and <= 10 (per RouteIntentInput)', () => {
  // Test the clamp logic that would be in routeIntent()
  const clamp = (n) => Math.min(Math.max(n, 1), 10)
  assert(clamp(0) === 1, 'min 1')
  assert(clamp(15) === 10, 'max 10')
  assert(clamp(5) === 5, 'identity in range')
})

test('Embedding hash uses sha256 prefix + 16-char body', () => {
  // Replicate the hashing scheme
  // createHash imported at module top
  const v = [0.1, 0.2, 0.3]
  const canonical = v.map((x) => x.toFixed(6)).join(',')
  const hash = 'sha256:' + createHash('sha256').update(canonical).digest('hex').slice(0, 16)
  assert(hash.startsWith('sha256:'))
  assert(hash.length === 7 + 16, `expected 23 chars, got ${hash.length}`)
})

test('Embedding hash is deterministic for same input', () => {
  // createHash imported at module top
  const hash = (v) => 'sha256:' + createHash('sha256').update(v.map((x) => x.toFixed(6)).join(',')).digest('hex').slice(0, 16)
  const v = [0.1, 0.2, 0.3]
  assert(hash(v) === hash([...v]), 'hash should be deterministic')
})

test('Embedding hash differs for different vectors', () => {
  // createHash imported at module top
  const hash = (v) => 'sha256:' + createHash('sha256').update(v.map((x) => x.toFixed(6)).join(',')).digest('hex').slice(0, 16)
  assert(hash([0.1, 0.2]) !== hash([0.1, 0.3]), 'different inputs must hash differently')
})

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
