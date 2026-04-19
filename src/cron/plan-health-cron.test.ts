import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('plan-health-cron', () => {
  it('normalizes sparse plan health responses and computes deltas', async () => {
    process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-backend-key'
    process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-orchestrator-key'
    process.env.PORT = process.env.PORT || '4000'
    process.env.NODE_ENV = 'test'

    const {
      computePlanHealthDelta,
      formatPlanHealthPollDigest,
      normalizePlanHealthResponse,
    } = await import('./plan-health-cron.js')

    const previous = normalizePlanHealthResponse({
      phase: '0',
      milestone: '0.4',
      in_flight_tasks: { low: 1, high: 0 },
      blocked_tasks: 0,
      fitness_latest: 0.5,
    }, '2026-04-19T14:00:00.000Z')

    const next = normalizePlanHealthResponse({
      phase: '0',
      milestone: '0.5',
      in_flight_tasks: 2,
      blocked_tasks: { low: 1, high: 0 },
      fitness_latest: 0.75,
    }, '2026-04-19T14:30:00.000Z')

    const delta = computePlanHealthDelta(previous, next)

    assert.equal(delta.has_changes, true)
    assert.equal(delta.in_flight_delta, 1)
    assert.equal(delta.blocked_delta, 1)
    assert.equal(delta.phase_changed, false)
    assert.equal(delta.milestone_changed, true)
    assert.equal(delta.fitness_delta, 0.25)
    assert.match(formatPlanHealthPollDigest(next, delta), /Milestone: `0\.5`/)
  })

  it('polls backend plan health, stores snapshots, and falls back to LIN-928 when topnode is absent', async () => {
    process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-backend-key'
    process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-orchestrator-key'
    process.env.PORT = process.env.PORT || '4000'
    process.env.NODE_ENV = 'test'

    const { runPlanHealthPoll } = await import('./plan-health-cron.js')

    const calls: Array<{ url: string; body?: any }> = []
    const stored: Array<{ key: string; value: unknown; ttl: number }> = []
    let retrieveCount = 0

    const fetchImpl: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, body })

      if (url.endsWith('/api/plan/health')) {
        return new Response(JSON.stringify({
          phase: '0',
          milestone: '0.5',
          in_flight_tasks: 2,
          blocked_tasks: 1,
          fitness_latest: 0.82,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      if (url.endsWith('/api/mcp/route') && body?.tool === 'linear.issue_get' && body?.payload?.identifier === 'LIN-DIVINE-SYMBIOSIS') {
        return new Response(JSON.stringify({ success: false, error: 'not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      if (url.endsWith('/api/mcp/route') && body?.tool === 'linear.issue_get' && body?.payload?.identifier === 'LIN-928') {
        return new Response(JSON.stringify({ success: true, result: { identifier: 'LIN-928' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      if (url.endsWith('/api/mcp/route') && body?.tool === 'linear.comment_create') {
        return new Response(JSON.stringify({ success: true, result: { identifier: body.payload.identifier } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    }

    const result = await runPlanHealthPoll({
      fetchImpl,
      retrieveMemoryImpl: async () => {
        retrieveCount += 1
        return retrieveCount === 1
          ? {
              key: 'plan:health:last-poll',
              agent_id: 'orch-cron',
              created_at: '2026-04-19T14:00:00.000Z',
              ttl_seconds: 604800,
              value: {
                snapshot: {
                  phase: '0',
                  milestone: '0.4',
                  in_flight_tasks: 1,
                  blocked_tasks: 0,
                  fitness_latest: 0.7,
                  polled_at: '2026-04-19T14:00:00.000Z',
                },
              },
            }
          : null
      },
      storeMemoryImpl: async (agentId, key, value, ttl) => {
        assert.equal(agentId, 'orch-cron')
        stored.push({ key, value, ttl })
        return {
          key,
          value,
          agent_id: agentId,
          created_at: '2026-04-19T14:30:00.000Z',
          ttl_seconds: ttl ?? 0,
        }
      },
      broadcastMessageImpl: () => undefined as any,
      broadcastSseImpl: () => undefined as any,
      now: () => new Date('2026-04-19T14:30:00.000Z'),
    })

    assert.equal(result.linear_identifier, 'LIN-928')
    assert.equal(result.snapshot.phase, '0')
    assert.equal(result.snapshot.milestone, '0.5')
    assert.equal(result.delta.in_flight_delta, 1)
    assert.equal(result.delta.blocked_delta, 1)
    assert.equal(result.delta.fitness_delta, 0.12)
    assert.equal(stored.length, 3)
    assert.ok(stored.some((entry) => entry.key === 'plan:health:last-poll'))
    assert.ok(stored.some((entry) => entry.key.startsWith('plan:health:poll:')))
    assert.ok(stored.some((entry) => entry.key.startsWith('plan:health:delta:')))
    assert.ok(calls.some((call) => call.body?.tool === 'linear.comment_create' && call.body?.payload?.identifier === 'LIN-928'))
  })
})
