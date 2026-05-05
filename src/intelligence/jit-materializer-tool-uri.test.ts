/**
 * jit-materializer-tool-uri.test.ts
 *
 * Tests for the tool:// URI resolution path added to fetchSkillBody()
 * as part of the CL4R1T4S corpus :Observation implementation.
 *
 * The resolveToolUri() function is private; we test it indirectly via
 * the exported materializeContext() public surface, using a mocked
 * callMcpTool that simulates graph responses.
 *
 * Call sequence for a single tool_definition skill (happy path):
 *   1. fetchSkillBody    → graph.read_cypher (body=null, body_uri=tool://web.search)
 *   2. resolveToolUri    → graph.read_cypher (tool_name, description, parameters, ...)
 *   3. emitLineage       → graph.write_cypher
 *   4. emitEvent         → graph.write_cypher
 *
 * Canary class: Tier 1 (unit-mock — no live graph, no LLM calls).
 *
 * Run: node --experimental-test-module-mocks --import tsx/esm --test \
 *        src/intelligence/jit-materializer-tool-uri.test.ts
 */

process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.PORT = process.env.PORT || '3001'
process.env.NODE_ENV = 'test'
process.env.PSR_JIT_MATERIALIZER_ENABLED = '1'

import { describe, it, mock, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Mock callMcpTool before module load ──────────────────────────────────────
// _mockQueue drives sequential responses — push items before each test.
const _mockQueue: unknown[] = []

const _mockCallMcpTool = mock.fn((..._args: unknown[]) => {
  if (_mockQueue.length === 0) return Promise.resolve({ status: 'success', result: { results: [] } })
  return Promise.resolve(_mockQueue.shift())
})

await mock.module('../mcp-caller.js', {
  namedExports: {
    callMcpTool: (...args: unknown[]) => _mockCallMcpTool(...args),
  },
})

// Import AFTER mock is registered
const { materializeContext, estimateTokens } = await import('./jit-materializer.js')

// ── Type helpers (minimal — match actual RouterDecision interface) ─────────
interface TestSelectedSkill {
  id: string
  name: string
  similarity: number
  rank: number
  body_uri?: string
}

interface TestRouterDecision {
  decision_id: string
  correlation_id: string
  variant: 'B' | 'F'
  algorithm: 'kNN' | 'MMR' | 'learned' | 'hybrid'
  intent_summary: string
  embedding_hash: string
  embedding_dimensions: number
  selected_skills: TestSelectedSkill[]
  total_candidates_evaluated: number
  cold_start_fallback: boolean
  latency_ms: number
  emitted_event: boolean
  decision_at: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDecision(skillOverrides: Partial<TestSelectedSkill> = {}): TestRouterDecision {
  return {
    decision_id: 'test-decision-001',
    correlation_id: 'test-corr-001',
    variant: 'B',
    algorithm: 'kNN',
    intent_summary: 'web search test',
    embedding_hash: 'hash-abc123',
    embedding_dimensions: 1536,
    selected_skills: [
      {
        id: 'phantom-skill:tool-def-web-search',
        name: 'Web Search Tool Definition',
        similarity: 0.91,
        rank: 1,
        ...skillOverrides,
      },
    ],
    total_candidates_evaluated: 10,
    cold_start_fallback: false,
    latency_ms: 42,
    emitted_event: false,
    decision_at: new Date().toISOString(),
  }
}

function makeDecisionForSkill(id: string, name: string): TestRouterDecision {
  return { ...makeDecision(), selected_skills: [{ id, name, similarity: 0.88, rank: 1 }] }
}

// Push the standard 4-call mock sequence for a tool:// skill.
function enqueue(overrides: {
  body?: string | null
  body_uri?: string | null
  tool_name?: string
  description?: string
  parameters?: string | null
  provider_examples?: string | string[]
} = {}) {
  const {
    body = null,
    body_uri = 'tool://web.search',
    tool_name = 'web.search',
    description = 'Execute a web search and return ranked results.',
    parameters = JSON.stringify([
      { name: 'query', type: 'string', required: true, description: 'The search query' },
      { name: 'num_results', type: 'number', required: false, description: 'Max results' },
    ]),
    provider_examples = ['Grok', 'ChatGPT', 'Perplexity'],
  } = overrides

  // Call 1: fetchSkillBody (body + body_uri)
  _mockQueue.push({
    status: 'success',
    result: { results: [{ body, body_uri, name: 'Web Search Tool Definition' }] },
  })
  // Call 2: resolveToolUri (tool schema fields)
  _mockQueue.push({
    status: 'success',
    result: {
      results: [{
        tool_name,
        description,
        parameters,
        provider_examples,
        name: 'Web Search Tool Definition',
      }],
    },
  })
  // Call 3: emitMaterializationLineage
  _mockQueue.push({ status: 'success', result: { results: [] } })
  // Call 4: emitSkillMaterializedEvent
  _mockQueue.push({ status: 'success', result: { results: [] } })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('jit-materializer tool:// URI resolution', () => {
  beforeEach(() => {
    _mockQueue.length = 0
    _mockCallMcpTool.mock.resetCalls()
  })

  it('resolves tool:// URI to an injectable tool contract block', async () => {
    enqueue()

    const result = await materializeContext({
      decision: makeDecision() as never,
      correlation_id: 'test-corr-001',
    })

    assert.strictEqual(result.feature_flag_enabled, true)
    assert.strictEqual(result.materialized_skills.length, 1)

    const skill = result.materialized_skills[0]
    assert.ok(skill, 'skill should be defined')
    assert.strictEqual(skill!.fetched_from, 'tool_uri')
    assert.ok(skill!.body.includes('## Tool Contract: web.search'), 'body contains contract header')
    assert.ok(skill!.body.includes('**Description**:'), 'body contains Description label')
    assert.ok(skill!.body.includes('query'), 'body contains query parameter')
    assert.ok(skill!.body.includes('**Provider examples**:'), 'body contains Provider examples label')
    assert.ok(skill!.body.includes('Grok'), 'body contains Grok as provider example')
  })

  it('context_block contains the tool contract header', async () => {
    enqueue()

    const result = await materializeContext({
      decision: makeDecision() as never,
      correlation_id: 'test-corr-002',
    })

    assert.ok(result.context_block.includes('Tool Contract: web.search'), 'context_block has contract header')
  })

  it('fetched_from=tool_uri is recorded in materialized_skills', async () => {
    enqueue()

    const result = await materializeContext({
      decision: makeDecision() as never,
      correlation_id: 'test-corr-003',
    })

    assert.strictEqual(result.materialized_skills[0]?.fetched_from, 'tool_uri')
  })

  it('falls back to fallback_empty when resolveToolUri returns no graph rows', async () => {
    // fetchSkillBody: no inline body, body_uri=tool://web.search
    _mockQueue.push({
      status: 'success',
      result: { results: [{ body: null, body_uri: 'tool://web.search', name: 'x' }] },
    })
    // resolveToolUri: empty results array → row undefined → returns null → fallback_empty
    _mockQueue.push({
      status: 'success',
      result: { results: [] },
    })
    // lineage + event
    _mockQueue.push({ status: 'success', result: { results: [] } })
    _mockQueue.push({ status: 'success', result: { results: [] } })

    const result = await materializeContext({
      decision: makeDecision() as never,
      correlation_id: 'test-corr-004',
    })

    assert.strictEqual(result.materialized_skills[0]?.fetched_from, 'fallback_empty')
    assert.strictEqual(result.materialized_skills[0]?.body, '')
  })

  it('falls back to fallback_empty when graph call for resolveToolUri fails', async () => {
    _mockQueue.push({
      status: 'success',
      result: { results: [{ body: null, body_uri: 'tool://web.search', name: 'x' }] },
    })
    _mockQueue.push({ status: 'error', error_message: 'neo4j timeout' })
    _mockQueue.push({ status: 'success', result: { results: [] } })
    _mockQueue.push({ status: 'success', result: { results: [] } })

    const result = await materializeContext({
      decision: makeDecision() as never,
      correlation_id: 'test-corr-005',
    })

    assert.strictEqual(result.materialized_skills[0]?.fetched_from, 'fallback_empty')
  })

  it('formats parameters as named list when parameters field is JSON', async () => {
    enqueue({
      parameters: JSON.stringify([
        { name: 'url', type: 'string', required: true, description: 'Target URL to browse' },
        { name: 'instruction', type: 'string', required: false, description: 'Extraction instruction' },
      ]),
      tool_name: 'web.browse_page',
      description: 'Browse a web page and extract content.',
    })

    const result = await materializeContext({
      decision: makeDecisionForSkill(
        'phantom-skill:tool-def-browse-page',
        'Browse Page Tool Definition'
      ) as never,
      correlation_id: 'test-corr-006',
    })

    const body = result.materialized_skills[0]?.body ?? ''
    assert.ok(body.includes('Tool Contract: web.browse_page'), 'body has browse_page header')
    assert.ok(body.includes('- url (string, required)'), 'url param formatted correctly')
    assert.ok(body.includes('- instruction (string, optional)'), 'instruction param formatted correctly')
  })

  it('omits parameter block when parameters field is absent', async () => {
    enqueue({ parameters: null })

    const result = await materializeContext({
      decision: makeDecision() as never,
      correlation_id: 'test-corr-007',
    })

    const body = result.materialized_skills[0]?.body ?? ''
    assert.ok(!body.includes('**Parameters**:'), 'Parameters block absent when null')
    assert.ok(body.includes('## Tool Contract:'), 'Contract header still present')
  })

  it('falls back to graph_property when inline body is present (does not call resolveToolUri)', async () => {
    // fetchSkillBody returns inline body — resolveToolUri must NOT be called
    _mockQueue.push({
      status: 'success',
      result: { results: [{ body: 'INLINE SKILL BODY', body_uri: 'tool://web.search', name: 'x' }] },
    })
    // lineage + event (3 calls: fetch, lineage, event)
    _mockQueue.push({ status: 'success', result: { results: [] } })
    _mockQueue.push({ status: 'success', result: { results: [] } })

    const result = await materializeContext({
      decision: makeDecision() as never,
      correlation_id: 'test-corr-008',
    })

    assert.strictEqual(result.materialized_skills[0]?.fetched_from, 'graph_property')
    assert.strictEqual(result.materialized_skills[0]?.body, 'INLINE SKILL BODY')

    // Verify resolveToolUri was NOT called (no extra read_cypher containing tool_name)
    const toolUriCalls = _mockCallMcpTool.mock.calls.filter((c) => {
      const arg = c.arguments?.[0] as Record<string, unknown> | undefined
      const argsField = arg?.args as Record<string, unknown> | undefined
      const query = argsField?.query as string | undefined
      return arg?.toolName === 'graph.read_cypher' && (query ?? '').includes('tool_name')
    })
    assert.strictEqual(toolUriCalls.length, 0, 'resolveToolUri not called when inline body present')
  })
})

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    assert.strictEqual(estimateTokens(''), 0)
    assert.strictEqual(estimateTokens('abcd'), 1)
    assert.strictEqual(estimateTokens('abcde'), 2)
    assert.strictEqual(estimateTokens('a'.repeat(100)), 25)
  })
})
