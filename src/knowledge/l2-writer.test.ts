import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('l2Writer', () => {
  it('exports a writeL2 async function', async () => {
    // Set required env vars before dynamic import
    process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY ?? 'test'
    process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY ?? 'test'
    process.env.RLM_API_KEY = process.env.RLM_API_KEY ?? 'test'
    const { writeL2 } = await import('./l2-writer.js')
    assert.equal(typeof writeL2, 'function')
  })
  it('exports a listL2 async function', async () => {
    const { listL2 } = await import('./l2-writer.js')
    assert.equal(typeof listL2, 'function')
  })
})
