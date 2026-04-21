/**
 * pheromone-human-signaled.test.ts — regression tests for human-signaled pheromone ingress.
 */
import express from 'express'

process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.RLM_API_KEY = process.env.RLM_API_KEY || 'test-key'
process.env.BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:1'
process.env.NODE_ENV = 'test'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

async function startServer() {
  const { pheromoneRouter } = await import('./pheromone.ts')
  const app = express()
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/pheromone', pheromoneRouter)

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1')
    srv.once('listening', () => resolve(srv))
    srv.once('error', (err: Error) => {
      throw err
    })
  })

  return {
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  }
}

async function closeServer(server: import('node:http').Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function assert(cond: boolean, message: string) {
  if (!cond) {
    throw new Error(message)
  }
}

const runtime = await startServer()

try {
  const accepted = await fetch(`${runtime.baseUrl}/api/pheromone/human-signaled`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source: 'canvas-operator',
      domain: 'neurogenesis',
      label: 'Operator identified a novel anchor worth inspection.',
      signal_type: 'opportunity',
      client_surface: 'canvas',
      strength: 0.81,
      rationale: 'Promote this into the human-signaled queue.',
      anchor: {
        anchor_kind: 'web-url',
        resource_uri: 'https://canvas.widgetdc.test/session/123',
      },
    }),
  })
  const acceptedBody = await accepted.json() as { success?: boolean; data?: { status?: string; domain?: string; signal_type?: string } }
  assert(accepted.status === 202, 'human-signaled endpoint returns 202 for canonical payload')
  assert(acceptedBody.success === true, 'human-signaled endpoint wraps success=true')
  assert(acceptedBody.data?.status === 'accepted', 'human-signaled endpoint marks request accepted')
  assert(acceptedBody.data?.domain === 'neurogenesis', 'human-signaled endpoint preserves domain')
  assert(acceptedBody.data?.signal_type === 'opportunity', 'human-signaled endpoint preserves signal type')

  const invalid = await fetch(`${runtime.baseUrl}/api/pheromone/human-signaled`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source: 'canvas-operator',
      domain: 'neurogenesis',
    }),
  })
  assert(invalid.status === 400, 'human-signaled endpoint rejects incomplete payloads')
} finally {
  await closeServer(runtime.server)
}


