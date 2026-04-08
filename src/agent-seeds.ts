/**
 * agent-seeds.ts — Canonical agent definitions for the WidgeTDC swarm.
 *
 * These are the REAL agents with proper names, capabilities, and namespace ACLs.
 * Seeded on boot after hydration — won't overwrite if agent already exists with
 * a non-auto-discovered source.
 */
import { AgentRegistry } from './agent-registry.js'
import type { AgentHandshakeData } from './agent-registry.js'
import { logger } from './logger.js'

export const AGENT_SEEDS: AgentHandshakeData[] = [
  {
    agent_id: 'omega',
    display_name: 'Omega Sentinel',
    source: 'core',
    version: '3.0',
    status: 'online',
    capabilities: ['sitrep', 'compliance', 'circuit_breakers', 'swarm', 'pheromones', 'architecture', 'adoption_audit', 'integrity_scoring', 'judge_response'],
    allowed_tool_namespaces: ['omega', 'audit', 'graph', 'intelligence', '*'],
  },
  {
    agent_id: 'trident',
    display_name: 'Trident Security',
    source: 'core',
    version: '3.0',
    status: 'online',
    capabilities: ['threat_hunting', 'osint', 'cti', 'cvr', 'attack_surface', 'certstream'],
    allowed_tool_namespaces: ['trident', 'osint', 'the_snout', 'harvest.intel', '*'],
  },
  {
    agent_id: 'prometheus',
    display_name: 'Prometheus Engine',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['code_analysis', 'embeddings', 'dreaming', 'reinforcement_learning', 'governance'],
    allowed_tool_namespaces: ['prometheus', 'code', 'lsp', '*'],
  },
  {
    agent_id: 'master',
    display_name: 'Master Orchestrator',
    source: 'core',
    version: '3.0',
    status: 'online',
    capabilities: ['delegation', 'introspection', 'task_management', 'agent_coordination', 'moa_routing', 'skill_forging', 'critique_refine'],
    allowed_tool_namespaces: ['master', 'agent', 'action', 'intelligence', '*'],
  },
  {
    agent_id: 'harvest',
    display_name: 'Harvest Collector',
    source: 'core',
    version: '2.0',
    status: 'online',
    capabilities: ['web_crawl', 'scraping', 'cloud_ingestion', 'm365', 'sharepoint', 'scribd', 'remarkable'],
    allowed_tool_namespaces: ['harvest', 'ingestion', 'datafabric', '*'],
  },
  {
    agent_id: 'docgen',
    display_name: 'DocGen Factory',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['powerpoint', 'word', 'excel', 'diagrams', 'presentations'],
    allowed_tool_namespaces: ['docgen', 'tdc', '*'],
  },
  {
    agent_id: 'graph',
    display_name: 'Neo4j Graph Agent',
    source: 'core',
    version: '3.0',
    status: 'online',
    capabilities: ['cypher_read', 'cypher_write', 'graph_search', 'graph_stats', 'hygiene', 'graph_hygiene_run', 'self_correct', 'community_detection', 'build_communities'],
    allowed_tool_namespaces: ['graph', 'kg_rag', 'srag', 'monitor', '*'],
  },
  {
    agent_id: 'consulting',
    display_name: 'Consulting Intelligence',
    source: 'core',
    version: '3.0',
    status: 'online',
    capabilities: ['insight_search', 'pattern_search', 'failure_search', 'precedent_search', 'generate_deliverable', 'ingest_document'],
    allowed_tool_namespaces: ['consulting', 'vidensarkiv', 'kg_rag', 'knowledge', 'assembly', '*'],
  },
  {
    agent_id: 'legal',
    display_name: 'Legal & Compliance',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['retsinformation', 'compliance_check', 'eu_funding', 'tax', 'blast_radius'],
    allowed_tool_namespaces: ['legal', 'intel', '*'],
  },
  {
    agent_id: 'custodian',
    display_name: 'Custodian Guardian',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['chaos_testing', 'patrol', 'voting', 'governance'],
    allowed_tool_namespaces: ['custodian', 'audit', '*'],
  },
  {
    agent_id: 'roma',
    display_name: 'Roma Self-Healer',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['self_healing', 'incident_response', 'seed', 'approval'],
    allowed_tool_namespaces: ['roma', 'incident', '*'],
  },
  {
    agent_id: 'rlm',
    display_name: 'RLM Reasoning Engine',
    source: 'rlm-engine',
    version: '7.1.5',
    status: 'online',
    capabilities: ['reasoning', 'planning', 'context_folding', 'missions', 'rag', 'adaptive_rag_query', 'critique_refine', 'judge_response'],
    allowed_tool_namespaces: ['rlm', 'context_folding', 'specialist', 'intelligence', 'knowledge', '*'],
  },
  {
    agent_id: 'llm-router',
    display_name: 'LLM Cost Router',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['multi_model_routing', 'cost_tracking', 'budget'],
    allowed_tool_namespaces: ['llm', '*'],
  },
  {
    agent_id: 'vidensarkiv',
    display_name: 'Vidensarkiv',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['knowledge_search', 'file_management', 'batch_add'],
    allowed_tool_namespaces: ['vidensarkiv', '*'],
  },
  {
    agent_id: 'the-snout',
    display_name: 'The Snout OSINT',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['domain_intel', 'email_intel', 'osint', 'extraction'],
    allowed_tool_namespaces: ['the_snout', 'osint', '*'],
  },
  {
    agent_id: 'autonomous',
    display_name: 'Autonomous Swarm',
    source: 'core',
    version: '3.0',
    status: 'online',
    capabilities: ['graphrag', 'stategraph', 'evolution', 'agent_teams', 'moa_routing', 'forge_tool', 'run_evolution'],
    allowed_tool_namespaces: ['autonomous', 'loop', 'intelligence', 'chains', '*'],
  },
  {
    agent_id: 'cma',
    display_name: 'Context Memory Agent',
    source: 'core',
    version: '3.0',
    status: 'online',
    capabilities: ['context_management', 'memory_store', 'memory_retrieve', 'working_memory', 'blackboard', 'checkpoint_saver'],
    allowed_tool_namespaces: ['cma', '*'],
  },
  {
    agent_id: 'nexus',
    display_name: 'Nexus Analyzer',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: ['decomposition', 'gap_analysis', 'feedback'],
    allowed_tool_namespaces: ['nexus', '*'],
  },
  {
    agent_id: 'command-center',
    display_name: 'Command Center',
    source: 'dashboard',
    version: '2.2',
    status: 'online',
    capabilities: ['mcp_tools', 'chat', 'chain_execution'],
    allowed_tool_namespaces: ['*'],
  },

  // ─── LibreChat agents (visible in registry, not WS-connected) ────────────
  {
    agent_id: 'lc-prometheus',
    display_name: 'Prometheus (LibreChat)',
    source: 'librechat',
    version: '1.0',
    status: 'online',
    capabilities: ['code_analysis', 'embeddings', 'governance', 'reinforcement_learning'],
    allowed_tool_namespaces: ['prometheus', 'code', '*'],
  },
  {
    agent_id: 'lc-roma',
    display_name: 'Roma (LibreChat)',
    source: 'librechat',
    version: '1.0',
    status: 'online',
    capabilities: ['self_healing', 'incident_response', 'monitoring'],
    allowed_tool_namespaces: ['roma', 'incident', '*'],
  },
  {
    agent_id: 'lc-dot',
    display_name: 'DOT Navigator (LibreChat)',
    source: 'librechat',
    version: '1.0',
    status: 'online',
    capabilities: ['navigation', 'task_routing', 'context_switching'],
    allowed_tool_namespaces: ['dot', '*'],
  },
  {
    agent_id: 'lc-harvester',
    display_name: 'Harvester (LibreChat)',
    source: 'librechat',
    version: '1.0',
    status: 'online',
    capabilities: ['web_crawl', 'data_ingestion', 'extraction'],
    allowed_tool_namespaces: ['harvest', 'ingestion', '*'],
  },
  {
    agent_id: 'lc-sentinel',
    display_name: 'Sentinel (LibreChat)',
    source: 'librechat',
    version: '1.0',
    status: 'online',
    capabilities: ['monitoring', 'alerting', 'threat_detection'],
    allowed_tool_namespaces: ['sentinel', 'alert', '*'],
  },
  {
    agent_id: 'lc-analyst',
    display_name: 'Analyst (LibreChat)',
    source: 'librechat',
    version: '1.0',
    status: 'online',
    capabilities: ['data_analysis', 'reporting', 'visualization'],
    allowed_tool_namespaces: ['analyst', 'report', '*'],
  },

  // ─── Orchestrator Inventor ─────────────────────────────────────────────
  // ASI-Evolve-inspired closed-loop evolution engine. Runs LEARN→DESIGN→
  // EXPERIMENT→ANALYZE cycles with UCB1/Island sampling. Deposits pheromones,
  // triggers PeerEval, and feeds adaptive RAG rewards.
  {
    agent_id: 'orchestrator_inventor',
    display_name: 'Orchestrator Inventor',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: [
      'evolution_loop',
      'trial_design',
      'trial_execution',
      'ucb1_sampling',
      'island_sampling',
      'rlm_reasoning',
      'pheromone_deposit',
      'peer_eval',
      'adaptive_rag_reward',
      'frontend_evaluation',
      'architecture_evolution',
    ],
    allowed_tool_namespaces: [
      'inventor', 'evolution', 'cognitive', 'knowledge',
      'pheromone', 'peereval', 'graph', 'memory',
      'chains', 'rlm', '*',
    ],
  },

  // ─── HyperAgent Autonomous Executor ────────────────────────────────────
  // Maintained ONLY in widgetdc-orchestrator. Callable from ALL repos via MCP.
  // Drives 72-target registry through graduated autonomy phases with
  // persistent cross-repo memory (Redis + Neo4j Lesson nodes).
  {
    agent_id: 'hyperagent-auto',
    display_name: 'HyperAgent Autonomous Executor',
    source: 'core',
    version: '1.0',
    status: 'online',
    capabilities: [
      'autonomous_execution',
      'target_prioritization',
      'fitness_evolution',
      'issue_discovery',
      'phase_management',
      'rlm_reasoning',
      'rag_rewards',
      'context_folding',
      'cross_repo_memory',
      'persistent_lessons',
    ],
    allowed_tool_namespaces: [
      'hyperagent', 'autonomous', 'graph', 'knowledge',
      'intelligence', 'rlm', 'chains', 'memory', '*',
    ],
  },
]

/**
 * Seed canonical agents on boot.
 * Only registers if agent doesn't exist or was auto-discovered (overwrite ghost names).
 */
export function seedAgents(): void {
  let seeded = 0
  for (const seed of AGENT_SEEDS) {
    const existing = AgentRegistry.get(seed.agent_id)
    // Seed if: not registered, or was auto-discovered (ghost with hex name)
    if (!existing || existing.handshake.source === 'auto-discovered') {
      AgentRegistry.register(seed)
      seeded++
    }
  }
  // Clean ghost agents (auto-discovered with hex suffixes like backend-6365e801)
  const ghostPattern = /^(backend|omega-sentinel|agent|rlm)-[0-9a-f]{6,}$/
  let cleaned = 0
  for (const entry of AgentRegistry.all()) {
    if (ghostPattern.test(entry.handshake.agent_id)) {
      AgentRegistry.remove(entry.handshake.agent_id)
      cleaned++
    }
  }
  logger.info({ seeded, cleaned }, 'Agent seeds applied')
}
