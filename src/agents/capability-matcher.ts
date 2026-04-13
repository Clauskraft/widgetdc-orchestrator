/**
 * capability-matcher.ts — LIN-774: Internal capability matching.
 *
 * Matches task requirements against available capabilities from:
 *   - MCPTool capabilities (from tool registry)
 *   - Agent capabilities (from agent registry)
 *   - Pattern capabilities (from known patterns)
 *   - Service capabilities (from service definitions)
 *
 * Returns ranked matches with confidence scores.
 */
import type { OrchestratorTool } from '../tools/tool-registry.js'
import { AgentRegistry } from '../agents/agent-registry.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export type CapabilitySource = 'mcp_tool' | 'agent' | 'pattern' | 'service'

export interface CapabilityMatch {
  source: CapabilitySource
  id: string              // tool name, agent id, pattern id, service name
  name: string
  capabilities: string[]
  matched_capabilities: string[]
  confidence: number      // 0-1
  metadata: Record<string, unknown>
}

export interface CapabilityQuery {
  required_capabilities: string[]
  min_confidence?: number  // Default 0.3
  max_results?: number     // Default 20
}

// ─── Known Patterns (from FINAL_PLAN_v4.0.md and Phantom Integration) ───────

interface PatternDef {
  id: string
  name: string
  capabilities: string[]
  metadata: Record<string, unknown>
}

const KNOWN_PATTERNS: PatternDef[] = [
  {
    id: 'hexagonal-packing',
    name: 'Hexagonal Circle Packing',
    capabilities: ['optimization', 'mathematical', 'geometric', 'circle-packing'],
    metadata: { domain: 'mathematics', complexity: 'high', sota: 2.635 },
  },
  {
    id: 'differential-evolution',
    name: 'Differential Evolution Optimizer',
    capabilities: ['optimization', 'evolutionary', 'continuous', 'gradient-free'],
    metadata: { domain: 'optimization', complexity: 'medium', population_based: true },
  },
  {
    id: 'ucb1-sampling',
    name: 'Upper Confidence Bound Sampling',
    capabilities: ['sampling', 'exploration-exploitation', 'multi-armed-bandit'],
    metadata: { domain: 'statistics', complexity: 'medium', theoretical_regret_bound: 'O(sqrt(n))' },
  },
  {
    id: 'rlm-reasoning',
    name: 'RLM Deep Reasoning',
    capabilities: ['reasoning', 'analysis', 'planning', 'multi-hop'],
    metadata: { domain: 'cognitive', complexity: 'high', max_depth: 3 },
  },
  {
    id: 'graphrag-tri-channel',
    name: 'Tri-Channel Graph RAG',
    capabilities: ['retrieval', 'graphrag', 'srag', 'cypher', 'multi-hop'],
    metadata: { domain: 'knowledge-retrieval', complexity: 'high', channels: 3 },
  },
  {
    id: 'context-folding',
    name: 'Context Folding Pipeline',
    capabilities: ['compression', 'summarization', 'context-management'],
    metadata: { domain: 'cognitive', complexity: 'medium', max_tokens_in: 8000, max_tokens_out: 500 },
  },
  {
    id: 'pheromone-routing',
    name: 'Pheromone-Based Routing',
    capabilities: ['stigmergy', 'adaptive-routing', 'swarm-intelligence'],
    metadata: { domain: 'coordination', complexity: 'high', decay_rate: 0.8 },
  },
  {
    id: 'compliance-audit',
    name: 'EU Compliance Audit Pipeline',
    capabilities: ['compliance', 'audit', 'regulatory', 'GDPR', 'NIS2', 'DORA', 'AI-Act'],
    metadata: { domain: 'legal', complexity: 'high', frameworks: 12 },
  },
  {
    id: 'deliverable-factory',
    name: 'Lego Factory Deliverable Generation',
    capabilities: ['document-generation', 'consulting', 'structured-output'],
    metadata: { domain: 'consulting', complexity: 'medium', max_length: 8000 },
  },
  {
    id: 'inventor-evolution',
    name: 'ASI-Evolve Inventor Loop',
    capabilities: ['evolution', 'optimization', 'closed-loop', 'research', 'experiment'],
    metadata: { domain: 'meta-optimization', complexity: 'very-high', max_steps: 25 },
  },
]

// ─── Known Services (WidgeTDC platform services) ─────────────────────────────

interface ServiceDef {
  id: string
  name: string
  capabilities: string[]
  metadata: Record<string, unknown>
}

const KNOWN_SERVICES: ServiceDef[] = [
  {
    id: 'widgetdc-orchestrator',
    name: 'Orchestrator Service',
    capabilities: ['tool-routing', 'chain-execution', 'inventor', 'benchmark', 'agent-coordination'],
    metadata: { url: 'https://orchestrator-production-c27e.up.railway.app', tools: 165 },
  },
  {
    id: 'widgetdc-backend',
    name: 'Backend MCP Service',
    capabilities: ['graph-queries', 'srag', 'linear-integration', 'audit', 'memory'],
    metadata: { url: 'https://backend-production-d3da.up.railway.app', mcp_tools: 449 },
  },
  {
    id: 'widgetdc-rlm-engine',
    name: 'RLM Reasoning Engine',
    capabilities: ['reasoning', 'analysis', 'planning', 'folding', 'learning'],
    metadata: { url: 'https://rlm-engine-production.up.railway.app', depth: 3 },
  },
  {
    id: 'widgetdc-neo4j',
    name: 'Neo4j Knowledge Graph',
    capabilities: ['graph-storage', 'cypher-queries', 'vector-search', 'relationship-traversal'],
    metadata: { nodes: '1M+', relationships: '3.8M+', labels: 100 },
  },
  {
    id: 'widgetdc-redis',
    name: 'Redis Cache & State',
    capabilities: ['caching', 'state-persistence', 'rate-limiting', 'pub-sub'],
    metadata: { ttl_max: '30d', max_memory: '256MB' },
  },
]

// ─── MCP Tool Capability Extraction ──────────────────────────────────────────

/**
 * Extract capabilities from a tool definition.
 * Heuristics: parse name, description, input schema for capability keywords.
 */
function extractToolCapabilities(tool: OrchestratorTool): string[] {
  const capabilities = new Set<string>()
  const name = tool.function.name.toLowerCase()
  const desc = tool.function.description.toLowerCase()
  const combined = `${name} ${desc}`

  // Namespace-based capabilities
  if (tool.namespace) capabilities.add(`namespace:${tool.namespace}`)

  // Keyword-based capabilities
  const keywordMap: Record<string, string[]> = {
    'search': ['search', 'retrieval'],
    'graph': ['graph', 'cypher', 'neo4j'],
    'rag': ['retrieval', 'augmented-generation'],
    'reason': ['reasoning', 'analysis'],
    'linear': ['project-management', 'issue-tracking'],
    'memory': ['memory', 'persistence'],
    'compliance': ['compliance', 'audit', 'regulatory'],
    'deliverable': ['document-generation', 'consulting'],
    'inventor': ['evolution', 'optimization', 'experiment'],
    'benchmark': ['evaluation', 'measurement'],
    'prompt': ['prompt-management'],
    'fact': ['fact-storage', 'knowledge-representation'],
    'rag_route': ['retrieval-routing', 'adaptive-rag'],
    'skill': ['knowledge-acquisition'],
    'due_diligence': ['osint', 'risk-assessment'],
    'ab_test': ['experimentation', 'optimization'],
    'drift': ['monitoring', 'anomaly-detection'],
    'cost': ['cost-tracking', 'attribution'],
    'health': ['monitoring', 'observability'],
    'metrics': ['metrics', 'observability'],
    'log': ['logging', 'observability'],
    'agent': ['agent-coordination'],
    'chat': ['a2a-communication'],
    'model': ['model-routing', 'llm-management'],
    'workflow': ['workflow-management'],
    'governance': ['governance', 'policy'],
    'deployment': ['deployment', 'infrastructure'],
    'hyperagent': ['autonomous-execution'],
    'pheromone': ['stigmergy', 'swarm-intelligence'],
    'peer_eval': ['peer-review', 'fleet-learning'],
    'flywheel': ['continuous-improvement'],
    'anomaly': ['anomaly-detection', 'monitoring'],
  }

  for (const [keyword, caps] of Object.entries(keywordMap)) {
    if (combined.includes(keyword)) {
      for (const cap of caps) capabilities.add(cap)
    }
  }

  // Complexity-based capabilities
  if (tool.timeoutMs && tool.timeoutMs > 60000) capabilities.add('long-running')
  if (tool.timeoutMs && tool.timeoutMs < 10000) capabilities.add('fast-response')

  return Array.from(capabilities)
}

// ─── Agent Capability Extraction ─────────────────────────────────────────────

function extractAgentCapabilities(agentId: string): string[] {
  const agent = AgentRegistry.get(agentId)
  if (!agent) return []

  const capabilities = new Set<string>(agent.handshake?.capabilities ?? [])

  // Namespace-based capabilities
  if (agent.allowed_tool_namespaces) {
    for (const ns of agent.allowed_tool_namespaces) {
      capabilities.add(`namespace:${ns}`)
    }
  }

  return Array.from(capabilities)
}

// ─── Core Matching Logic ─────────────────────────────────────────────────────

/**
 * Compute confidence score for a capability match.
 * Based on: fraction of required capabilities matched, weighted by importance.
 */
function computeConfidence(
  required: string[],
  available: string[],
): number {
  if (required.length === 0) return 1.0
  const matched = required.filter(r => available.some(a =>
    a.toLowerCase() === r.toLowerCase() ||
    a.toLowerCase().includes(r.toLowerCase()) ||
    r.toLowerCase().includes(a.toLowerCase())
  ))
  return matched.length / required.length
}

/**
 * Query capabilities across all sources (tools, agents, patterns, services).
 * Returns ranked matches by confidence.
 */
export async function queryCapabilities(query: CapabilityQuery): Promise<CapabilityMatch[]> {
  const { required_capabilities, min_confidence = 0.3, max_results = 20 } = query
  const matches: CapabilityMatch[] = []

  // 1. Match MCP Tools
  const { ORCHESTRATOR_TOOLS } = await import('../tools/tool-registry.js')
  for (const tool of ORCHESTRATOR_TOOLS) {
    const caps = extractToolCapabilities(tool as OrchestratorTool)
    const confidence = computeConfidence(required_capabilities, caps)
    if (confidence >= min_confidence) {
      const matched = required_capabilities.filter(r => caps.some(a =>
        a.toLowerCase() === r.toLowerCase() || a.toLowerCase().includes(r.toLowerCase())
      ))
      matches.push({
        source: 'mcp_tool',
        id: tool.function.name,
        name: tool.function.name,
        capabilities: caps,
        matched_capabilities: matched,
        confidence,
        metadata: { namespace: tool.namespace, timeout_ms: tool.timeoutMs },
      })
    }
  }

  // 2. Match Agents
  const agents = AgentRegistry.list()
  for (const agent of agents) {
    const caps = extractAgentCapabilities(agent.agent_id)
    const confidence = computeConfidence(required_capabilities, caps)
    if (confidence >= min_confidence) {
      const matched = required_capabilities.filter(r => caps.some(a =>
        a.toLowerCase() === r.toLowerCase() || a.toLowerCase().includes(r.toLowerCase())
      ))
      matches.push({
        source: 'agent',
        id: agent.agent_id,
        name: agent.handshake?.display_name ?? agent.agent_id,
        capabilities: caps,
        matched_capabilities: matched,
        confidence,
        metadata: { status: agent.status, last_seen: agent.last_seen },
      })
    }
  }

  // 3. Match Patterns
  for (const pattern of KNOWN_PATTERNS) {
    const confidence = computeConfidence(required_capabilities, pattern.capabilities)
    if (confidence >= min_confidence) {
      const matched = required_capabilities.filter(r => pattern.capabilities.some(a =>
        a.toLowerCase() === r.toLowerCase() || a.toLowerCase().includes(r.toLowerCase())
      ))
      matches.push({
        source: 'pattern',
        id: pattern.id,
        name: pattern.name,
        capabilities: pattern.capabilities,
        matched_capabilities: matched,
        confidence,
        metadata: pattern.metadata,
      })
    }
  }

  // 4. Match Services
  for (const service of KNOWN_SERVICES) {
    const confidence = computeConfidence(required_capabilities, service.capabilities)
    if (confidence >= min_confidence) {
      const matched = required_capabilities.filter(r => service.capabilities.some(a =>
        a.toLowerCase() === r.toLowerCase() || a.toLowerCase().includes(r.toLowerCase())
      ))
      matches.push({
        source: 'service',
        id: service.id,
        name: service.name,
        capabilities: service.capabilities,
        matched_capabilities: matched,
        confidence,
        metadata: service.metadata,
      })
    }
  }

  // Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence)

  return matches.slice(0, max_results)
}

/**
 * Convenience: find best tool for a set of required capabilities.
 */
export async function findBestTool(required_capabilities: string[]): Promise<CapabilityMatch | null> {
  const matches = await queryCapabilities({
    required_capabilities,
    min_confidence: 0.1,
    max_results: 1,
  })
  return matches.find(m => m.source === 'mcp_tool') ?? null
}

/**
 * Convenience: find best agent for a set of required capabilities.
 */
export async function findBestAgent(required_capabilities: string[]): Promise<CapabilityMatch | null> {
  const matches = await queryCapabilities({
    required_capabilities,
    min_confidence: 0.1,
    max_results: 1,
  })
  return matches.find(m => m.source === 'agent') ?? null
}
