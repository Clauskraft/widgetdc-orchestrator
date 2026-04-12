/**
 * runtime-analytics.test.mjs — Regression tests for Phantom Week 4 analytics.
 *
 * Verifies:
 *  - recordAgentResponse() writes snake_case AgentResponse to Redis
 *  - Millikroner cost storage avoids float drift
 *  - getAgentMetrics() round-trips correctly
 *  - getRuntimeSummary() aggregates totals
 *
 * If REDIS_URL is not set, tests skip cleanly (not a failure).
 */
import { strict as assert } from 'node:assert'

const HAS_REDIS = !!process.env.REDIS_URL
if (!HAS_REDIS) {
  console.log('⚠ REDIS_URL not set — skipping runtime-analytics tests')
  process.exit(0)
}

// Import after env check so redis.ts picks up the URL
const { recordAgentResponse, recordToolMetrics, getAgentMetrics, getToolMetrics, getRuntimeSummary } =
  await import('../dist/index.js').then(m => m).catch(async () => {
    // Fallback to source path for local dev
    return await import('../src/analytics/runtime-analytics.js')
  })

const TEST_AGENT = 'test-analytics-agent'
const TEST_TOOL = 'test-analytics-tool'

// ── Clean slate: not strictly needed (hincrby is additive), but record deltas
const before = (await getAgentMetrics(TEST_AGENT)) ?? {
  total_requests: 0, total_success: 0, total_failed: 0,
  total_tokens_input: 0, total_tokens_output: 0, total_cost_dkk: 0,
}

// ── Record 3 responses (2 success, 1 failed) with deterministic values
const baseResponse = {
  request_id: '00000000-0000-4000-8000-000000000001',
  agent_id: TEST_AGENT,
  output: 'test-output',
  tokens_used: { input: 100, output: 50 },
  cost_dkk: 0.025, // → 25 millikroner
  conflicts: [],
}

await recordAgentResponse({ ...baseResponse, status: 'success' }, 100)
await recordAgentResponse({ ...baseResponse, status: 'success' }, 200)
await recordAgentResponse({ ...baseResponse, status: 'failed' }, 50)

// ── Verify agent metrics
const after = await getAgentMetrics(TEST_AGENT)
assert(after !== null, 'agent metrics should exist after 3 records')

const dRequests = after.total_requests - before.total_requests
const dSuccess = after.total_success - before.total_success
const dFailed = after.total_failed - before.total_failed
const dCost = after.total_cost_dkk - before.total_cost_dkk

assert.equal(dRequests, 3, `expected 3 new requests, got ${dRequests}`)
assert.equal(dSuccess, 2, `expected 2 new success, got ${dSuccess}`)
assert.equal(dFailed, 1, `expected 1 new failed, got ${dFailed}`)

// Float precision: 3 × 0.025 = 0.075 DKK (via millikroner integer math)
assert.equal(Math.round(dCost * 1000), 75, `expected +75 millikroner, got ${Math.round(dCost * 1000)}`)

// ── Record tool metrics separately
await recordToolMetrics(TEST_TOOL, 150, false)
await recordToolMetrics(TEST_TOOL, 250, true)

const toolMetrics = await getToolMetrics(TEST_TOOL)
assert(toolMetrics !== null, 'tool metrics should exist')
assert(toolMetrics.call_count >= 2, 'call_count should increment')
assert(toolMetrics.error_count >= 1, 'error_count should increment on failed call')

// ── Summary
const summary = await getRuntimeSummary()
assert(summary.total_agents >= 1, 'summary should include at least the test agent')
assert(summary.generated_at, 'summary must have generated_at timestamp')

console.log('✅ runtime-analytics regression tests passed')
console.log(`   agent requests recorded: ${dRequests}, cost delta: ${dCost} DKK`)
console.log(`   tool call_count: ${toolMetrics.call_count}, errors: ${toolMetrics.error_count}`)
console.log(`   runtime summary: ${summary.total_agents} agents, ${summary.total_requests} requests`)
