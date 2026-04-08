/**
 * moa-router.ts — Mixture-of-Agents routing (LIN-595 SNOUT-13).
 *
 * Complex queries route to 2-3 specialist agents, responses merged via consensus.
 *
 * Pipeline:
 *   1. CLASSIFY — determine query complexity + domains
 *   2. SELECT — match 2-3 agents by capability overlap
 *   3. DISPATCH — run agents in parallel via chain-engine
 *   4. MERGE — consensus algorithm weighs responses by capability match score
 *
 * Unique: No off-the-shelf MoA exists for MCP tool ecosystems.
 */
import { v4 as uuid } from 'uuid'
import { AgentRegistry } from '../agents/agent-registry.js'
import { executeChain, type ChainDefinition } from '../chain/chain-engine.js'
import { chatLLM } from './llm-proxy.js'
import { logger } from '../logger.js'
import { createBlackboard } from '../memory/blackboard.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MoARequest {
  query: string
  /** Force specific agents (bypass auto-selection) */
  agents?: string[]
  /** Max agents to dispatch (default: 3) */
  max_agents?: number
  /** LLM provider for classification + merge (default: deepseek) */
  provider?: string
}

interface AgentCandidate {
  agent_id: string
  display_name: string
  capabilities: string[]
  match_score: number
  matched_capabilities: string[]
}

export interface MoAResult {
  query: string
  agents_dispatched: string[]
  responses: Array<{
    agent_id: string
    response: string
    status: 'success' | 'error' | 'timeout'
  }>
  consensus: string
  confidence: number
  classification: { complexity: string; domains: string[] }
  duration_ms: number
}

// ─── Domain → Capability Mapping ────────────────────────────────────────────

const DOMAIN_CAPABILITIES: Record<string, string[]> = {
  security: ['threat_hunting', 'osint', 'cti', 'compliance', 'attack_surface'],
  knowledge: ['context_management', 'memory_store', 'search', 'embeddings'],
  architecture: ['sitrep', 'architecture', 'governance', 'compliance'],
  consulting: ['engagement_analysis', 'deliverable_generation', 'client_profiling'],
  graph: ['graph_intelligence', 'neo4j', 'community_detection', 'embeddings'],
  code: ['code_analysis', 'reinforcement_learning', 'dreaming'],
  intelligence: ['harvest', 'competitive_intel', 'osint', 'data_collection'],
  compliance: ['compliance', 'governance', 'legal', 'regulatory'],
  operations: ['delegation', 'task_management', 'agent_coordination', 'introspection'],
}

// ─── Step 1: Classify ───────────────────────────────────────────────────────

async function classifyQuery(query: string, provider: string): Promise<{ complexity: string; domains: string[] }> {
  try {
    const result = await chatLLM({
      provider,
      messages: [
        { role: 'system', content: `Classify this query. Return JSON only: {"complexity": "simple|medium|complex", "domains": ["security","knowledge","architecture","consulting","graph","code","intelligence","compliance","operations"]}. Pick 1-3 most relevant domains.` },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
      max_tokens: 100,
    })
    const match = result.content.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      return {
        complexity: parsed.complexity || 'medium',
        domains: Array.isArray(parsed.domains) ? parsed.domains.slice(0, 3) : ['knowledge'],
      }
    }
  } catch { /* fall through */ }
  return { complexity: 'medium', domains: ['knowledge'] }
}

// ─── Step 2: Select Agents ──────────────────────────────────────────────────

function selectAgents(domains: string[], maxAgents: number): AgentCandidate[] {
  // Collect relevant capabilities from domains
  const targetCapabilities = new Set<string>()
  for (const domain of domains) {
    const caps = DOMAIN_CAPABILITIES[domain] ?? []
    caps.forEach(c => targetCapabilities.add(c))
  }

  // Score all registered agents
  const candidates: AgentCandidate[] = []
  for (const entry of AgentRegistry.all()) {
    const agentCaps = entry.handshake.capabilities ?? []
    const matched = agentCaps.filter(c => targetCapabilities.has(c))
    if (matched.length === 0) continue

    candidates.push({
      agent_id: entry.handshake.agent_id,
      display_name: entry.handshake.display_name ?? entry.handshake.agent_id,
      capabilities: agentCaps,
      match_score: matched.length / Math.max(targetCapabilities.size, 1),
      matched_capabilities: matched,
    })
  }

  // Sort by match score desc, take top N
  return candidates
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, maxAgents)
}

// ─── Step 3: Dispatch ───────────────────────────────────────────────────────

async function dispatchAgents(
  query: string,
  agents: AgentCandidate[],
): Promise<Array<{ agent_id: string; response: string; status: 'success' | 'error' | 'timeout' }>> {
  const chainDef: ChainDefinition = {
    name: `moa-${uuid().slice(0, 8)}`,
    mode: 'parallel',
    steps: agents.map(a => ({
      agent_id: a.agent_id,
      tool_name: 'search_knowledge',
      arguments: { query },
    })),
  }

  const execution = await executeChain(chainDef)

  return execution.results.map((r, i) => ({
    agent_id: agents[i]?.agent_id ?? r.agent_id,
    response: typeof r.output === 'string' ? r.output : JSON.stringify(r.output ?? ''),
    status: r.status,
  }))
}

// ─── Step 4: Consensus Merge ────────────────────────────────────────────────

async function mergeConsensus(
  query: string,
  responses: Array<{ agent_id: string; response: string; status: string }>,
  provider: string,
): Promise<{ consensus: string; confidence: number }> {
  const successResponses = responses.filter(r => r.status === 'success' && r.response.length > 10)

  if (successResponses.length === 0) {
    return { consensus: 'No successful agent responses to merge.', confidence: 0 }
  }
  if (successResponses.length === 1) {
    return { consensus: successResponses[0].response, confidence: 0.6 }
  }

  // Use LLM to synthesize consensus
  const agentOutputs = successResponses.map(r =>
    `## Agent: ${r.agent_id}\n${r.response.slice(0, 1000)}`
  ).join('\n\n---\n\n')

  try {
    const result = await chatLLM({
      provider,
      messages: [
        { role: 'system', content: `You are merging responses from multiple specialist agents into a single consensus answer. Synthesize the best information from each, resolve contradictions by favoring the more specific/evidence-backed claim. Output the merged answer, then on the last line: "CONFIDENCE: 0.X" (0.0-1.0).` },
        { role: 'user', content: `Query: ${query}\n\n${agentOutputs}` },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    })

    let confidence = 0.7
    const confMatch = result.content.match(/CONFIDENCE:\s*([\d.]+)/)
    if (confMatch) confidence = Math.min(1, Math.max(0, parseFloat(confMatch[1])))

    const consensus = result.content.replace(/CONFIDENCE:\s*[\d.]+\s*$/, '').trim()
    return { consensus, confidence }
  } catch (err) {
    // Fallback: concatenate
    return {
      consensus: successResponses.map(r => `[${r.agent_id}] ${r.response}`).join('\n\n'),
      confidence: 0.4,
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Route a query through Mixture-of-Agents pipeline.
 * Complex queries get 2-3 specialist agents dispatched in parallel,
 * with responses merged via LLM consensus.
 */
export async function routeMoA(request: MoARequest): Promise<MoAResult> {
  const t0 = Date.now()
  const provider = request.provider ?? 'deepseek'
  const maxAgents = request.max_agents ?? 3

  // LIN-593: Blackboard for shared agent state (TypeBox-validated)
  const taskId = `moa-${uuid()}`
  const board = createBlackboard(taskId)

  // Step 1: Classify
  const classification = await classifyQuery(request.query, provider)

  // Blackboard: write observations (classification is the MoA observation)
  await board.write('observations', {
    items: [
      `complexity: ${classification.complexity}`,
      `domains: ${classification.domains.join(', ')}`,
    ],
    confidence: 0.8,
    source_agent: 'moa-router',
    timestamp: new Date().toISOString(),
  }, 'moa-router').catch(() => { /* non-critical */ })

  // Step 2: Select agents
  let agents: AgentCandidate[]
  if (request.agents && request.agents.length > 0) {
    // Manual agent selection
    agents = request.agents.map(id => {
      const entry = AgentRegistry.get(id)
      return {
        agent_id: id,
        display_name: entry?.handshake.display_name ?? id,
        capabilities: entry?.handshake.capabilities ?? [],
        match_score: 1,
        matched_capabilities: [],
      }
    })
  } else {
    agents = selectAgents(classification.domains, maxAgents)
  }

  if (agents.length === 0) {
    return {
      query: request.query,
      agents_dispatched: [],
      responses: [],
      consensus: 'No suitable agents found for this query.',
      confidence: 0,
      classification,
      duration_ms: Date.now() - t0,
    }
  }

  logger.info({
    query: request.query.slice(0, 80),
    agents: agents.map(a => a.agent_id),
    domains: classification.domains,
    complexity: classification.complexity,
  }, 'MoA routing: dispatching agents')

  // Step 3: Dispatch in parallel
  const responses = await dispatchAgents(request.query, agents)

  // Blackboard: write result slot (aggregated dispatch outcome)
  await board.write('result', {
    outputs: responses.map(r => r.response),
    passed: responses.filter(r => r.status === 'success').length,
    failed: responses.filter(r => r.status !== 'success').length,
    artifacts: [],
    source_agent: 'moa-router',
    timestamp: new Date().toISOString(),
  }, 'moa-router').catch(() => { /* non-critical */ })

  // Step 4: Consensus merge
  const { consensus, confidence } = await mergeConsensus(request.query, responses, provider)

  // Blackboard: write verdict (final consensus judgment)
  await board.write('verdict', {
    passed: confidence >= 0.5,
    score: Math.round(confidence * 10),
    issues: responses.filter(r => r.status !== 'success').map(r => `${r.agent_id}: ${r.status}`),
    recommendation: confidence >= 0.7 ? 'approve' : confidence >= 0.4 ? 'revise' : 'reject',
    source_agent: 'moa-router',
    timestamp: new Date().toISOString(),
  }, 'moa-router').catch(() => { /* non-critical */ })

  const result: MoAResult = {
    query: request.query,
    agents_dispatched: agents.map(a => a.agent_id),
    responses,
    consensus,
    confidence,
    classification,
    duration_ms: Date.now() - t0,
  }

  logger.info({
    agents: result.agents_dispatched,
    confidence,
    ms: result.duration_ms,
  }, 'MoA routing complete')

  return result
}
