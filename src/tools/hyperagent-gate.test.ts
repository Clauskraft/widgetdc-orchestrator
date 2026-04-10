/**
 * hyperagent-gate.test.ts — FR-4 HyperAgent enforcement gate tests.
 *
 * Tests:
 * 1. governance_plan_create without plan is rejected (requires plan for downstream execution)
 * 2. railway_deploy without plan is rejected (production_write risk)
 * 3. data_graph_read (read_only) executes directly (no gating)
 *
 * Run: npx tsx src/tools/hyperagent-gate.test.ts
 */

// Set minimal env vars before importing config-dependent modules
process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.PORT = process.env.PORT || '3001'
process.env.NODE_ENV = 'test'
process.env.RLM_API_KEY = process.env.RLM_API_KEY || 'test-key'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

import { enforceHyperAgentGate } from './tool-executor.js'
import { getTool } from './tool-registry.js'

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  PASS: ${name}`)
  } catch (err) {
    console.log(`  FAIL: ${name} — ${err}`)
    process.exitCode = 1
  }
}

async function main() {
  console.log('HyperAgent Enforcement Gate (FR-4)')

  await test('rejects railway_deploy without plan_id (production_write)', async () => {
    const err = await enforceHyperAgentGate('railway_deploy')
    assert(err !== null, 'Expected error for railway_deploy without plan')
    assert(err.includes('Direct execution blocked'), `Expected gating error, got: ${err}`)
    assert(err.includes('railway_deploy'), `Expected tool name in error, got: ${err}`)
    assert(err.includes('HyperAgent plan'), `Expected plan message, got: ${err}`)
  })

  await test('rejects railway_env without plan_id (production_write)', async () => {
    const err = await enforceHyperAgentGate('railway_env')
    assert(err !== null, 'Expected error for railway_env without plan')
    assert(err.includes('Direct execution blocked'), `Expected gating error, got: ${err}`)
  })

  await test('rejects governance_plan_execute without plan_id (production_write)', async () => {
    const err = await enforceHyperAgentGate('governance_plan_execute')
    assert(err !== null, 'Expected error for governance_plan_execute without plan')
    assert(err.includes('Direct execution blocked'), `Expected gating error, got: ${err}`)
  })

  await test('allows data_graph_read directly (read_only)', async () => {
    const err = await enforceHyperAgentGate('data_graph_read')
    assert(err === null, `Expected no error for read_only tool, got: ${err}`)
  })

  await test('allows data_graph_stats directly (read_only)', async () => {
    const err = await enforceHyperAgentGate('data_graph_stats')
    assert(err === null, `Expected no error for read_only tool, got: ${err}`)
  })

  await test('allows system_health directly (read_only)', async () => {
    const err = await enforceHyperAgentGate('system_health')
    assert(err === null, `Expected no error for read_only tool, got: ${err}`)
  })

  await test('allows search_knowledge directly (read_only)', async () => {
    const err = await enforceHyperAgentGate('search_knowledge')
    assert(err === null, `Expected no error for read_only tool, got: ${err}`)
  })

  await test('allows unknown tools (no gating)', async () => {
    const err = await enforceHyperAgentGate('some_unknown_tool')
    assert(err === null, `Expected no error for unknown tool, got: ${err}`)
  })

  console.log('\nTool Registry Risk Metadata')

  await test('railway_deploy has production_write risk', async () => {
    const tool = getTool('railway_deploy')
    assert(tool !== undefined, 'Tool not found')
    assert(tool.riskLevel === 'production_write', `Expected production_write, got ${tool.riskLevel}`)
    assert(tool.requiresPlan === true, 'Expected requiresPlan=true')
    assert(tool.requiresApproval === true, 'Expected requiresApproval=true')
  })

  await test('railway_env has production_write risk', async () => {
    const tool = getTool('railway_env')
    assert(tool !== undefined, 'Tool not found')
    assert(tool.riskLevel === 'production_write', `Expected production_write, got ${tool.riskLevel}`)
    assert(tool.requiresPlan === true, 'Expected requiresPlan=true')
  })

  await test('governance_plan_execute has production_write risk', async () => {
    const tool = getTool('governance_plan_execute')
    assert(tool !== undefined, 'Tool not found')
    assert(tool.riskLevel === 'production_write', `Expected production_write, got ${tool.riskLevel}`)
    assert(tool.requiresPlan === true, 'Expected requiresPlan=true')
    assert(tool.requiresApproval === true, 'Expected requiresApproval=true')
  })

  await test('governance_plan_create has staged_write risk', async () => {
    const tool = getTool('governance_plan_create')
    assert(tool !== undefined, 'Tool not found')
    assert(tool.riskLevel === 'staged_write', `Expected staged_write, got ${tool.riskLevel}`)
    assert(tool.requiresPlan === false, 'Expected requiresPlan=false (IS the plan creation)')
  })

  await test('data_graph_read has read_only risk', async () => {
    const tool = getTool('data_graph_read')
    assert(tool !== undefined, 'Tool not found')
    assert(tool.riskLevel === 'read_only', `Expected read_only, got ${tool.riskLevel}`)
  })

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Test runner failed:', err)
  process.exit(1)
})
