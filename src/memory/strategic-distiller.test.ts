import { strict as assert } from 'node:assert'

process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'

const { StrategicDistiller } = await import('./strategic-distiller.js')

async function testWeightsByPheromonePressure() {
  let receivedContext: Record<string, unknown> | null = null

  const distiller = new StrategicDistiller({
    callGraph: async () => [
      { id: 'low', label: 'Low Node', summary: 'low pressure', pheromone_pressure: 0.12, ts: '2026-04-20T00:00:00.000Z' },
      { id: 'high', label: 'High Node', summary: 'high pressure', pheromone_pressure: 0.92, ts: '2026-04-20T00:00:00.000Z' },
      { id: 'mid', label: 'Mid Node', summary: 'mid pressure', pheromone_pressure: 0.54, ts: '2026-04-20T00:00:00.000Z' },
    ],
    callFold: async ({ context }) => {
      receivedContext = context
      return 'distilled-output'
    },
    isRlmReady: () => true,
  })

  const result = await distiller.distill({
    text: 'Operator anchored neurogenesis context text',
    budget: 1200,
    strategy: 'semantic',
    query: 'operator anchored pheromone',
  })

  assert.equal(result.folded_text, 'distilled-output')
  assert.equal(result.compression_mode, 'graph_semantic')
  assert.equal(result.bom_components[0], 'high')
  assert.ok(result.memory_summary.includes('High Node'))
  assert.ok(result.graph_weight_profile.top_pressure >= 0.92)
  assert.ok(receivedContext)
  assert.equal((receivedContext as Record<string, unknown>).weighting, 'pheromone_pressure')
}

async function testFallbackWhenRlmUnavailable() {
  const distiller = new StrategicDistiller({
    callGraph: async () => [],
    callFold: async () => '',
    isRlmReady: () => false,
  })

  const source = `${'A'.repeat(900)}${'B'.repeat(900)}`
  const result = await distiller.distill({
    text: source,
    budget: 200,
    strategy: 'hybrid',
  })

  assert.equal(result.compression_mode, 'fallback_truncate')
  assert.ok(result.folded_text.includes('[...strategic-distilled...]'))
  assert.ok(result.folded_text.length <= 800)
}

async function testParsesStringifiedGraphRows() {
  const distiller = new StrategicDistiller({
    callGraph: async () => JSON.stringify([
      { id: 'n-1', label: 'Node 1', summary: 'node summary', pheromone_pressure: 0.77, ts: '2026-04-20T00:00:00.000Z' },
    ]),
    callFold: async () => 'ok',
    isRlmReady: () => true,
  })

  const result = await distiller.distill({
    text: 'sample text',
    budget: 1000,
    strategy: 'extractive',
  })

  assert.equal(result.source_count, 1)
  assert.equal(result.compression_mode, 'graph_extractive')
  assert.ok(result.memory_summary.includes('Node 1'))
}

await testWeightsByPheromonePressure()
await testFallbackWhenRlmUnavailable()
await testParsesStringifiedGraphRows()

console.log('strategic-distiller tests passed')
