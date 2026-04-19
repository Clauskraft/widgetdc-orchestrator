/**
 * tool-gateway.test.ts — tests for /api/tools/call_mcp_tool write/read policy behavior.
 *
 * Covers:
 * 1) graph.write_cypher with intent+evidence returns success
 * 2) graph.write_cypher missing intent fails 400
 * 3) graph.write_cypher missing evidence fails 400
 * 4) query_graph without intent succeeds (read tools are exempt)
 */
import express from 'express'
import { AddressInfo } from 'node:net'

console.log('tool-gateway.test.ts starting')

process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.RLM_API_KEY = process.env.RLM_API_KEY || 'test-key'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
process.env.NODE_ENV = 'test'

async function startMockBackend() {
  console.log('Starting mock backend...')
  const backendApp = express()
  backendApp.use(express.json({ limit: '100kb' }))

  backendApp.post('/api/mcp/route', async (req, res) => {
    const tool = req.body?.tool as string | undefined
    const payload = req.body?.payload as Record<string, unknown> | undefined

    if (tool === 'graph.write_cypher') {
      res.json({ result: { matched: 1, tool: 'graph.write_cypher', evidence: payload?.evidence } })
      return
    }

    if (tool === 'graph.read_cypher') {
      res.json({ results: [{ one: 1, tool: 'graph.read_cypher' }] })
      return
    }

    res.json({ result: { tool, payload } })
  })

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const srv = backendApp.listen(0, '127.0.0.1')
    srv.once('listening', () => resolve(srv))
    srv.once('error', (err: Error) => {
      throw err
    })
  })

  const port = (server.address() as AddressInfo).port
  process.env.BACKEND_URL = `http://127.0.0.1:${port}`
  console.log(`Mock backend listening on ${process.env.BACKEND_URL}`)

  return { server, port }
}

async function startGateway() {
  console.log('Importing tool gateway...')
  const { toolGatewayRouter } = await import('../routes/tool-gateway.js')
  const app = express()
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/tools', toolGatewayRouter)

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1')
    srv.once('listening', () => resolve(srv))
    srv.once('error', (err: Error) => {
      throw err
    })
  })

  const port = (server.address() as AddressInfo).port
  console.log(`Gateway listening on http://127.0.0.1:${port}`)
  return { server, port }
}

async function closeServer(server: import('node:http').Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

type JsonEnvelope = Record<string, unknown>

async function postJson(url: string, body: object) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  const json = raw ? (JSON.parse(raw) as JsonEnvelope) : {}
  return { res, json, raw }
}

let passed = 0
let failed = 0

function assert(cond: boolean, message: string) {
  if (cond) {
    passed += 1
    console.log(`  PASS: ${message}`)
    return
  }
  failed += 1
  console.log(`  FAIL: ${message}`)
}

const writeQuery = 'MERGE (o:Test {id: $id}) SET o.intent = $intent RETURN o.id'

const mockBackend = await startMockBackend()
console.log('Mock backend started')
const gateway = await startGateway()
console.log('Gateway started')
const gatewayUrl = `http://127.0.0.1:${gateway.port}`
console.log(`Running tests against ${gatewayUrl}`)

try {
  console.log('Running case 1')
  const t1 = await postJson(`${gatewayUrl}/api/tools/call_mcp_tool`, {
    tool_name: 'graph.write_cypher',
    payload: {
      query: writeQuery,
      params: { id: 'node-1', intent: 'seed node' },
      intent: 'persist test node',
      evidence: 'test evidence for write',
    },
  })
  assert(t1.res.status === 200, 'graph.write_cypher with intent+evidence returns 200')
  assert((t1.json as JsonEnvelope).status === 'success', 'graph.write_cypher with intent+evidence has status success')

  const t2 = await postJson(`${gatewayUrl}/api/tools/call_mcp_tool`, {
    tool_name: 'graph.write_cypher',
    payload: {
      query: writeQuery,
      params: { id: 'node-2' },
      evidence: 'missing intent test',
    },
  })
  assert(t2.res.status === 400, 'graph.write_cypher missing intent returns 400')

  const t3 = await postJson(`${gatewayUrl}/api/tools/call_mcp_tool`, {
    tool_name: 'graph.write_cypher',
    payload: {
      query: writeQuery,
      params: { id: 'node-3' },
      intent: 'ok',
      // intentionally no evidence
    },
  })
  assert(t3.res.status === 400, 'graph.write_cypher missing evidence returns 400')

  const t4 = await postJson(`${gatewayUrl}/api/tools/call_mcp_tool`, {
    tool_name: 'query_graph',
    payload: {
      cypher: 'RETURN 1 AS one',
    },
  })
  assert(t4.res.status === 200, 'query_graph without intent succeeds (read tool exempt from write checks)')
  assert((t4.json as JsonEnvelope).status === 'success', 'query_graph without intent has status success')

  console.log(`\ntool-gateway.test.ts: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
} finally {
  await Promise.all([
    closeServer(gateway.server),
    closeServer(mockBackend.server),
  ])
}
