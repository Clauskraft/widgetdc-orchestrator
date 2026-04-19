import assert from 'node:assert/strict'
import test from 'node:test'

process.env.BACKEND_API_KEY ??= 'test-backend-key'

const modulePath = './vault-layer-migration.ts'

test('runVaultLayerMigrationCron posts to the backend endpoint and normalizes the result', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const fetchMock = async (input: string, init?: RequestInit) => {
    calls.push({ input, init })
    return new Response(JSON.stringify({
      success: true,
      result: {
        backfilled: 4,
        promotedToCurated: 2,
        demotedToArchived: 1,
        durationMs: 987,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { runVaultLayerMigrationCron } = await import(modulePath)
  const result = await runVaultLayerMigrationCron(fetchMock as typeof fetch, () => 1234567890)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.input, 'https://backend-production-d3da.up.railway.app/api/cron/vault-layer-migration')
  assert.equal(calls[0]?.init?.method ?? '', 'POST')
  assert.equal((calls[0]?.init?.headers as Record<string, string>)?.Authorization, 'Bearer test-backend-key')
  assert.equal((calls[0]?.init?.headers as Record<string, string>)?.['X-Call-Id'], 'cron-vault-layer-migration-1234567890')
  assert.deepEqual(result, {
    backfilled: 4,
    promotedToCurated: 2,
    demotedToArchived: 1,
    durationMs: 987,
    endpoint: 'https://backend-production-d3da.up.railway.app/api/cron/vault-layer-migration',
    summary: 'backfilled=4, promoted=2, demoted=1, 987ms',
  })
})

test('runVaultLayerMigrationCron throws on backend failure', async () => {
  const fetchMock = async () => new Response(JSON.stringify({
    success: false,
    error: 'boom',
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })

  const { runVaultLayerMigrationCron } = await import(modulePath)
  await assert.rejects(
    () => runVaultLayerMigrationCron(fetchMock as typeof fetch, () => 42),
    /HTTP 500 boom/,
  )
})
