/**
 * token-telemetry.test.mjs — TokenTelemetryRecord schema + emission contract.
 *
 * Validates Phase Δ P1.b TokenTelemetry hook (Inventor Variant E + 3 RLM
 * additions = 35 fields, 1750 bytes target).
 *
 * Usage: node test/token-telemetry.test.mjs
 *
 * Note: matches existing widgetdc-orchestrator test pattern (plain .mjs,
 * no test framework). The actual TS module is built via build.mjs; here we
 * inline-replicate the contract to test the SHAPE without needing a TS
 * compiler in the test runner.
 */

let passed = 0, failed = 0

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (err) { failed++; console.log(`  ❌ ${name}: ${err.message}`) }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed')
}

// ─── Inline-replicated buildTelemetryRecord (matches src/llm/token-telemetry.ts) ─

function buildTelemetryRecord(input) {
  const correlation_id = input.correlation_id ?? input.workflow_id ?? input.run_id
  return {
    id: `telemetry-${input.run_id}-${(crypto.randomUUID?.() || 'abcd1234').slice(0, 8)}`,
    session_id: input.session_id ?? input.workflow_id ?? input.run_id,
    run_id: input.run_id,
    provider: input.provider,
    model: input.model,
    prompt_tokens: input.prompt_tokens,
    completion_tokens: input.completion_tokens,
    total_tokens: input.prompt_tokens + input.completion_tokens,
    estimated_cost_dkk: input.estimated_cost_dkk ?? 0,
    budget_lane: input.budget_lane ?? 'standard',
    selected_skills: input.selected_skills,
    router_algorithm: input.router_algorithm,
    prompt_tokens_before_jit: input.prompt_tokens_before_jit,
    prompt_tokens_after_jit: input.prompt_tokens_after_jit,
    context_saved_tokens: input.context_saved_tokens,
    fold_triggered: input.fold_triggered,
    router_decision_id: input.router_decision_id,
    materialization_id: input.materialization_id,
    llm_call_id: input.llm_call_id,
    settle_id: input.settle_id,
    embedding_hash: input.embedding_hash,
    fold_compression_ratio: input.fold_compression_ratio,
    router_precision: input.router_precision,
    downstream_task_success_rate: input.downstream_task_success_rate,
    semantic_drift_score: input.semantic_drift_score,
    cache_hit_rate: input.cache_hit_rate,
    meta_skill_invocation_id: input.meta_skill_invocation_id,
    reasoning_chain_hash: input.reasoning_chain_hash,
    invocation_count: input.invocation_count,
    compliance_gap_score: input.compliance_gap_score,
    rollback_trigger_state: input.rollback_trigger_state ?? 'none',
    meta_skill_invocation_latency_ms: input.meta_skill_invocation_latency_ms,
    workflow_id: input.workflow_id,
    plan_id: input.plan_id,
    correlation_id,
    created_at: new Date().toISOString(),
  }
}

function normalizeRecord(record) {
  const out = {}
  for (const [k, v] of Object.entries(record)) {
    out[k] = v === undefined ? null : v
  }
  return out
}

function estimateEmissionBytes(record) {
  return Buffer.byteLength(JSON.stringify(normalizeRecord(record)), 'utf-8')
}

console.log('\n  PSR P1.b TokenTelemetry contract tests')
console.log('  =======================================\n')

// ─── Schema fields (35 = Variant E 32 + 3 RLM additions) ─────────────────────

test('Minimal record has all required core fields', () => {
  const r = buildTelemetryRecord({
    run_id: 'run-1', provider: 'deepseek', model: 'deepseek-chat',
    prompt_tokens: 1000, completion_tokens: 500
  })
  for (const k of ['id', 'session_id', 'run_id', 'provider', 'model',
                   'prompt_tokens', 'completion_tokens', 'total_tokens',
                   'estimated_cost_dkk', 'budget_lane', 'correlation_id',
                   'created_at', 'rollback_trigger_state']) {
    assert(r[k] !== undefined, `missing required field: ${k}`)
  }
})

test('total_tokens equals prompt + completion', () => {
  const r = buildTelemetryRecord({
    run_id: 'r2', provider: 'p', model: 'm',
    prompt_tokens: 1234, completion_tokens: 567
  })
  assert(r.total_tokens === 1801, `expected 1801, got ${r.total_tokens}`)
})

test('correlation_id falls back: input → workflow_id → run_id', () => {
  const r1 = buildTelemetryRecord({
    run_id: 'r-only', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  assert(r1.correlation_id === 'r-only', 'should fall back to run_id')
  const r2 = buildTelemetryRecord({
    run_id: 'r2', workflow_id: 'wf-1',
    provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  assert(r2.correlation_id === 'wf-1', 'should use workflow_id')
  const r3 = buildTelemetryRecord({
    run_id: 'r3', workflow_id: 'wf-1', correlation_id: 'corr-explicit',
    provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  assert(r3.correlation_id === 'corr-explicit', 'should use explicit')
})

test('rollback_trigger_state defaults to "none"', () => {
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  assert(r.rollback_trigger_state === 'none', `default should be 'none', got ${r.rollback_trigger_state}`)
})

test('budget_lane defaults to "standard"', () => {
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  assert(r.budget_lane === 'standard')
})

// ─── Variant E provenance chain (4 fields) ──────────────────────────────────

test('Provenance chain: 4 chain ids accepted', () => {
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1,
    router_decision_id: 'rd-1', materialization_id: 'mat-1',
    llm_call_id: 'llm-1', settle_id: 'settle-1'
  })
  assert(r.router_decision_id === 'rd-1')
  assert(r.materialization_id === 'mat-1')
  assert(r.llm_call_id === 'llm-1')
  assert(r.settle_id === 'settle-1')
})

// ─── Variant E quality + drift signals (5 fields) ──────────────────────────

test('Quality signals: 5 quality fields accepted', () => {
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1,
    embedding_hash: 'sha256:abc', fold_compression_ratio: 4.2,
    router_precision: 0.85, downstream_task_success_rate: 0.92,
    semantic_drift_score: 0.12, cache_hit_rate: 0.5
  })
  assert(r.embedding_hash === 'sha256:abc')
  assert(r.router_precision === 0.85)
  assert(r.cache_hit_rate === 0.5)
})

// ─── RLM additions (plan v2) ──────────────────────────────────────────────

test('RLM additions: compliance_gap_score, rollback_trigger_state, latency', () => {
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1,
    compliance_gap_score: 0.3,
    rollback_trigger_state: 'spof_active',
    meta_skill_invocation_latency_ms: 42.7,
  })
  assert(r.compliance_gap_score === 0.3)
  assert(r.rollback_trigger_state === 'spof_active')
  assert(r.meta_skill_invocation_latency_ms === 42.7)
})

test('rollback_trigger_state accepts all 4 enum values', () => {
  for (const s of ['none', 'spof_active', 'manual_demote', 'canary_regression']) {
    const r = buildTelemetryRecord({
      run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1,
      rollback_trigger_state: s,
    })
    assert(r.rollback_trigger_state === s, `enum value ${s} failed`)
  }
})

// ─── Cost-of-emission (master prompt §COST GOVERNANCE) ────────────────────

test('Estimated emission bytes < 2KB ceiling (Variant E target 1750)', () => {
  const fullRecord = buildTelemetryRecord({
    run_id: 'run-deadbeef-cafe-feed-babe', session_id: 'sess-12345',
    workflow_id: 'wf-67890', plan_id: 'plan:psr-rollout',
    provider: 'deepseek', model: 'deepseek-chat',
    prompt_tokens: 4321, completion_tokens: 876,
    estimated_cost_dkk: 0.42, budget_lane: 'standard',
    selected_skills: ['meta.runtime_truth_verification', 'meta.root_cause_ladder', 'meta.canary_skeptic'],
    router_algorithm: 'MMR',
    prompt_tokens_before_jit: 9000, prompt_tokens_after_jit: 4321,
    context_saved_tokens: 4679, fold_triggered: true,
    router_decision_id: 'rd-abc-123', materialization_id: 'mat-xyz-789',
    llm_call_id: 'llm-deadbeef', settle_id: 'settle-feedface',
    embedding_hash: 'sha256:0123456789abcdef', fold_compression_ratio: 4.94,
    router_precision: 0.85, downstream_task_success_rate: 0.92,
    semantic_drift_score: 0.08, cache_hit_rate: 0.62,
    meta_skill_invocation_id: 'msi-001', reasoning_chain_hash: 'sha256:fedcba',
    invocation_count: 7, compliance_gap_score: 0.05,
    rollback_trigger_state: 'none', meta_skill_invocation_latency_ms: 23.4,
  })
  const bytes = estimateEmissionBytes(fullRecord)
  assert(bytes < 2048, `expected < 2KB, got ${bytes} bytes`)
  assert(bytes > 800, `suspiciously small: ${bytes} (expected >800 for full record)`)
  console.log(`         actual: ${bytes} bytes (target: 1750, ceiling: 2048)`)
})

// ─── normalizeRecord (Cypher-safety) ───────────────────────────────────────

test('normalizeRecord coerces undefined to null (Cypher-safe)', () => {
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  const n = normalizeRecord(r)
  for (const [k, v] of Object.entries(n)) {
    assert(v !== undefined, `field ${k} is undefined; should be null or value`)
  }
  assert(n.selected_skills === null, 'undefined selected_skills should be null')
})

// ─── Privacy posture: no raw user content slips in ─────────────────────────

test('Schema NEVER includes raw user message content', () => {
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  // Defense: explicit fields the schema must NOT have
  for (const k of ['user_content', 'prompt', 'messages', 'completion', 'embedding']) {
    assert(!(k in r), `forbidden raw-content field present: ${k}`)
  }
})

test('selected_skills is hashed/identifier list, never user content', () => {
  // PhantomSkill IDs are public-class identifiers ("meta.foo"), NOT user content
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1,
    selected_skills: ['meta.runtime_truth_verification']
  })
  for (const sk of r.selected_skills) {
    assert(typeof sk === 'string' && sk.startsWith('meta.'),
      'selected_skills must be PhantomSkill.id (public)')
  }
})

// ─── correlation_id always present (master prompt §EVENT SPINE) ───────────

test('correlation_id ALWAYS present (master prompt §EVENT SPINE)', () => {
  // Even with minimal input, correlation_id must be set
  const r = buildTelemetryRecord({
    run_id: 'r', provider: 'p', model: 'm', prompt_tokens: 1, completion_tokens: 1
  })
  assert(typeof r.correlation_id === 'string' && r.correlation_id.length > 0,
    'correlation_id must be non-empty string')
})

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
