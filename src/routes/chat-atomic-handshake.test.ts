import express from 'express'

process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.RLM_API_KEY = process.env.RLM_API_KEY || 'test-key'
process.env.NODE_ENV = 'test'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

async function startBackendMock() {
  const app = express()
  app.use(express.json({ limit: '100kb' }))
  app.post('/api/mcp/route', (_req, res) => {
    res.json({ result: { matched: 1 } })
  })
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1')
    srv.once('listening', () => resolve(srv))
    srv.once('error', (err: Error) => {
      throw err
    })
  })
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { server, baseUrl }
}

async function startServer() {
  const backend = await startBackendMock()
  process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
  process.env.BACKEND_URL = backend.baseUrl

  const { chatRouter } = await import('./chat.ts')
  const app = express()
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/chat', chatRouter)

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1')
    srv.once('listening', () => resolve(srv))
    srv.once('error', (err: Error) => {
      throw err
    })
  })

  return {
    backendServer: backend.server,
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
  if (!cond) throw new Error(message)
}

const runtime = await startServer()

try {
  const sent = await fetch(`${runtime.baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: 'codex',
      to: 'claude',
      message: 'Atomic handshake test message',
      thread_id: 'n1c-test-thread',
    }),
  })
  const sentBody = await sent.json() as {
    success?: boolean
    data?: { id?: string; handshake_id?: string; status?: string; ack_required?: boolean }
  }
  assert(sent.status === 200, 'send should return 200')
  assert(sentBody.success === true, 'send should return success=true')
  assert(Boolean(sentBody.data?.id), 'send should return message id')
  assert(Boolean(sentBody.data?.handshake_id), 'send should return handshake_id')
  assert(sentBody.data?.status === 'delivered', 'send should mark handshake as delivered')
  assert(sentBody.data?.ack_required === true, 'send should mark ack_required=true')

  const handshakeId = sentBody.data?.handshake_id as string

  const ack = await fetch(`${runtime.baseUrl}/api/chat/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handshake_id: handshakeId,
      ack_by: 'claude',
      ack_note: 'received',
    }),
  })
  const ackBody = await ack.json() as {
    success?: boolean
    data?: { status?: string; handshake_id?: string; ack_by?: string }
  }
  assert(ack.status === 200, 'ack should return 200')
  assert(ackBody.success === true, 'ack should return success=true')
  assert(ackBody.data?.status === 'acked', 'ack should set status=acked')
  assert(ackBody.data?.handshake_id === handshakeId, 'ack should preserve handshake id')
  assert(ackBody.data?.ack_by === 'claude', 'ack should persist ack_by')

  const getHandshake = await fetch(`${runtime.baseUrl}/api/chat/handshake/${encodeURIComponent(handshakeId)}`)
  const getBody = await getHandshake.json() as {
    success?: boolean
    data?: { status?: string; ack_by?: string }
  }
  assert(getHandshake.status === 200, 'handshake lookup should return 200')
  assert(getBody.success === true, 'handshake lookup should return success=true')
  assert(getBody.data?.status === 'acked', 'handshake lookup should show acked status')
  assert(getBody.data?.ack_by === 'claude', 'handshake lookup should show ack_by')
} finally {
  await closeServer(runtime.backendServer)
  await closeServer(runtime.server)
}

console.log('chat-atomic-handshake tests passed')
process.exit(0)
