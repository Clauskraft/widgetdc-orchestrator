import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

process.env.ORCHESTRATOR_API_KEY = 'test-key'
process.env.BACKEND_API_KEY = 'test-key'
process.env.REDIS_URL = ''

const { openaiCompatRouter } = await import('../src/routes/openai-compat.ts')
const { AgentRegistry } = await import('../src/agents/agent-registry.ts')

async function withServer(handler) {
  const app = express()
  app.use(express.json())
  app.use(openaiCompatRouter)

  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s))
  })

  try {
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    await handler(baseUrl)
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  }
}

async function testDynamicOwuiModels() {
  await AgentRegistry.purgeAll()
  AgentRegistry.register({
    agent_id: 'governance',
    display_name: 'Governance Sentinel',
    source: 'core',
    status: 'online',
    capabilities: ['governance', 'policy', 'approval'],
    allowed_tool_namespaces: ['governance', '*'],
    registered_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  })
  AgentRegistry.register({
    agent_id: 'obsidian',
    display_name: 'Obsidian Vault Agent',
    source: 'core',
    status: 'online',
    capabilities: ['vault_search', 'knowledge_sync'],
    allowed_tool_namespaces: ['knowledge', '*'],
    registered_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  })

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        Authorization: 'Bearer test-key',
        Accept: 'application/json',
      },
    })
    assert.equal(response.status, 200, 'GET /v1/models should return 200')

    const payload = await response.json()
    const ids = payload.data.map(model => model.id)

    assert(ids.includes('governance'), 'dynamic model list should include registry agent governance')
    assert(ids.includes('obsidian'), 'dynamic model list should include registry agent obsidian')
    assert(ids.includes('omega'), 'dynamic model list should retain seeded agents when registry is partial')

    const governance = payload.data.find(model => model.id === 'governance')
    assert.deepEqual(
      governance.meta.capabilities,
      ['governance', 'policy', 'approval'],
      'dynamic agent metadata should expose capabilities',
    )
  })
}

async function testDynamicOwuiModelCacheInvalidatesOnRegistryChange() {
  await AgentRegistry.purgeAll()

  await withServer(async (baseUrl) => {
    const firstResponse = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        Authorization: 'Bearer test-key',
        Accept: 'application/json',
      },
    })
    assert.equal(firstResponse.status, 200, 'first GET /v1/models should return 200')
    const firstPayload = await firstResponse.json()
    const firstIds = firstPayload.data.map(model => model.id)
    assert(!firstIds.includes('field-ops'), 'sanity check: custom agent should not exist before registration')

    AgentRegistry.register({
      agent_id: 'field-ops',
      display_name: 'Field Operations',
      source: 'core',
      status: 'online',
      capabilities: ['runtime_health'],
      allowed_tool_namespaces: ['monitor'],
      registered_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })

    const secondResponse = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        Authorization: 'Bearer test-key',
        Accept: 'application/json',
      },
    })
    assert.equal(secondResponse.status, 200, 'second GET /v1/models should return 200')

    const secondPayload = await secondResponse.json()
    const secondIds = secondPayload.data.map(model => model.id)
    assert(
      secondIds.includes('field-ops'),
      'model list should refresh immediately when the registry snapshot changes',
    )
  })
}

function testSpaFallbackBypassesV1Routes() {
  const indexSource = readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8')
  assert(
    indexSource.includes("'/v1'") || indexSource.includes('"/v1"'),
    'SPA fallback should treat /v1 routes as API-only paths',
  )
}

function testStreamingRouteFlushesEarlyAndDisablesTransforms() {
  const routeSource = readFileSync(path.join(ROOT, 'src', 'routes', 'openai-compat.ts'), 'utf8')
  assert(
    routeSource.includes("'widgetdc-neural': 'gemini-2.0-flash'"),
    'widgetdc-neural should be a first-class alias instead of falling through to an implicit fallback',
  )
  assert(
    routeSource.includes("const FALLBACK_TOOLS = ['intent_detect', 'search_knowledge', 'get_platform_health']"),
    'default tool routing should start from tested intent detection and knowledge retrieval',
  )
  assert(
    routeSource.includes("tools: ['intent_detect', 'query_graph', 'search_knowledge', 'knowledge_normalize', 'context_fold']"),
    'graph analyst should be wired to the tested intent, graph, normalization, and folding layers',
  )
  assert(
    routeSource.includes("tools: ['intent_detect', 'get_platform_health', 'call_mcp_tool', 'reason_deeply', 'context_fold']"),
    'platform health should be wired to the tested runtime, reasoning, and folding layers',
  )
  assert(
    routeSource.includes("res.setHeader('Cache-Control', 'no-cache, no-transform')"),
    'streaming responses should disable intermediary content transforms',
  )
  assert(
    routeSource.includes("res.setHeader('X-Accel-Buffering', 'no')"),
    'streaming responses should disable proxy buffering hints',
  )
  assert(
    routeSource.includes("res.setHeader('Content-Encoding', 'identity')"),
    'streaming responses should explicitly opt out of compression at the origin',
  )
  assert(
    routeSource.includes('res.flushHeaders()'),
    'streaming responses should flush headers before the heavy orchestration work begins',
  )
  assert(
    routeSource.includes("writeStreamChunk(res, requestId, model, { role: 'assistant', content: '\\u200b' })"),
    'streaming responses should emit an immediate content-bearing first chunk',
  )
  assert(
    routeSource.includes('finalContent = buildDeterministicHealthResponse('),
    'deterministic health fast path should synthesize directly from tool output instead of paying for another model round',
  )
  assert(
    routeSource.includes("const allowedCompanions = new Set(['get_platform_health', 'verify_output', 'intent_detect'])"),
    'deterministic health fast path should tolerate the generic verify tool and intent detector when the user says health check',
  )
}

async function main() {
  await testDynamicOwuiModels()
  await testDynamicOwuiModelCacheInvalidatesOnRegistryChange()
  testSpaFallbackBypassesV1Routes()
  testStreamingRouteFlushesEarlyAndDisablesTransforms()
  console.log('PASS owui-openai-compat')
  process.exit(0)
}

main().catch(err => {
  console.error('FAIL owui-openai-compat')
  console.error(err)
  process.exit(1)
})
