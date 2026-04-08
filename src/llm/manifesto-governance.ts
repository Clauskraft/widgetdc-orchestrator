/**
 * manifesto-governance.ts — Manifesto Razor's Edge: Living Governance (LIN-577)
 *
 * Maps all 10 WidgeTDC Manifesto Principles to their enforcement mechanisms.
 * This is the single source of truth for principle -> enforcement mapping.
 *
 * Design model: "Ambient Enforcement" — additive, NOT subtractive.
 * Every principle is enforced by existing systems, not a new governance layer.
 *
 * Status transitions: GAP -> PARTIAL -> ENFORCED
 * An ENFORCED principle has runtime-backed enforcement (not just docs).
 */

export type EnforcementStatus = 'ENFORCED' | 'PARTIAL' | 'GAP'
export type EnforcementLayer = 'pipeline' | 'tool' | 'cron' | 'middleware' | 'governance-doc' | 'runtime-config' | 'agent-protocol'

export interface ManifestoPrinciple {
  number: number
  name: string
  description: string
  status: EnforcementStatus
  enforcement_layer: EnforcementLayer
  mechanism: string
  mechanism_detail: string
  gap_remediation?: string
  updatedAt: string
}

/**
 * The 10 WidgeTDC Manifesto Principles — Enforcement Matrix
 *
 * Each principle is mapped to the runtime system that enforces it.
 * "If it is not enforced and verified, it is not done."
 *   — GLOBAL_AGENT_GOVERNANCE.md, Final Rule
 */
export const MANIFESTO_PRINCIPLES: ManifestoPrinciple[] = [
  {
    number: 1,
    name: 'Invisible Omnipotence',
    description: 'Intelligence runs invisibly on every message. Users never see the machinery — they only experience the result.',
    status: 'ENFORCED',
    enforcement_layer: 'pipeline',
    mechanism: 'mercury_enforcement.py',
    mechanism_detail: 'Mercury enforcement pipeline runs on EVERY Open WebUI message. 5-section router: classify -> RAG -> fold -> inject -> certify. Zero user interaction required.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 2,
    name: 'Aesthetic Authority',
    description: 'All output meets consulting-grade formatting standards. Danish language, structured sections, proper citations.',
    status: 'ENFORCED',
    enforcement_layer: 'pipeline',
    mechanism: 'widgetdc_beautifier pipeline',
    mechanism_detail: 'Beautifier pipeline post-processes all LLM output: Danish language enforcement, structured headings, citation formatting, consulting-grade markdown. Runs as Open WebUI pipeline.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 3,
    name: 'Cognitive Supremacy',
    description: 'Deep reasoning via RLM Engine for complex questions. Multi-step analysis, PDR, swarms, and context folding.',
    status: 'ENFORCED',
    enforcement_layer: 'tool',
    mechanism: 'cognitive-proxy.ts + RLM Engine',
    mechanism_detail: 'RLM Engine (Python/FastAPI) provides reason/analyze/plan/learn/fold/enrich endpoints. Orchestrator proxies via cognitive-proxy.ts. Tool registry exposes reason_deeply + investigate tools. Mercury pipeline auto-routes complex queries to RLM.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 4,
    name: 'Mercury Efficiency',
    description: 'Context compression and intelligent folding to maximize signal-to-noise in every interaction.',
    status: 'ENFORCED',
    enforcement_layer: 'pipeline',
    mechanism: 'mercury_fold pipeline + foldToolResult()',
    mechanism_detail: 'Mercury fold pipeline compresses context in Open WebUI. Orchestrator foldToolResult() in tool-executor.ts compresses tool results >1500 chars. RLM /cognitive/fold endpoint for deep folding. Triple-layer enforcement.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 5,
    name: 'Immutable Truths',
    description: 'All claims are verified against the knowledge graph. No hallucination passes unchecked.',
    status: 'ENFORCED',
    enforcement_layer: 'pipeline',
    mechanism: 'Mercury certify step + verification-gate.ts',
    mechanism_detail: 'Mercury pipeline certify step validates claims against Neo4j graph on every message. Orchestrator verification-gate.ts provides post-chain verification with tripwire guardrails and auto-fix loops (max 3 retries).',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 6,
    name: 'Anticipatory Intelligence',
    description: 'Pre-fetch relevant context before the user needs it. Proactive queue management.',
    status: 'ENFORCED',
    enforcement_layer: 'pipeline',
    mechanism: 'widgetdc_anticipator pipeline + proactive.queue',
    mechanism_detail: 'Anticipator pipeline pre-fetches related knowledge on message classification. proactive.queue MCP tool (LIN-575, backend v2.0.2) queues anticipated follow-up data. intent.resolve maps user intent to pre-load relevant graph subsets.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 7,
    name: 'Monopoly of Truth',
    description: 'Neo4j knowledge graph is the single source of truth. All data flows through the graph.',
    status: 'ENFORCED',
    enforcement_layer: 'tool',
    mechanism: 'graph_intel tool + dual-rag.ts + knowledge.query',
    mechanism_detail: 'widgetdc_graph_intel tool exposes Neo4j as single source. dual-rag.ts routes ALL retrieval through graph-first (graphrag -> srag -> cypher). 475K+ nodes, 3.8M+ relationships. MERGE-only writes, parameterized Cypher, read-back verify.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 8,
    name: 'Sovereign Market',
    description: 'Competitive intelligence through systematic capability mapping and gap analysis against market players.',
    status: 'PARTIAL',
    enforcement_layer: 'cron',
    mechanism: 'competitive-crawler.ts + failure-harvester.ts',
    mechanism_detail: 'competitive-crawler.ts crawls 5 competitors weekly (Mon 03:00 cron). failure-harvester.ts harvests failure patterns every 4h. 33+ capabilities mapped from Palantir + Copilot Studio. Gap reports generated. PARTIAL: no automated remediation loop from gaps to roadmap.',
    gap_remediation: 'Add automated gap-to-Linear-issue pipeline: when competitive crawler finds a capability gap scored >0.7, auto-create a Linear issue in backlog. Wire via existing cron infrastructure.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 9,
    name: 'Ubiquity',
    description: 'Platform intelligence accessible from every surface: Open WebUI, Obsidian, CLI, API, Slack.',
    status: 'ENFORCED',
    enforcement_layer: 'tool',
    mechanism: 'widgetdc_obsidian_bridge + Triple-Protocol ABI + Slack webhook',
    mechanism_detail: 'Obsidian bridge tool syncs knowledge to local vault. Triple-Protocol ABI (OpenAI + OpenAPI + MCP) exposes all tools to any client. Slack webhook integration (slack.ts). Command Center SPA. WebSocket + SSE real-time. /v1 OpenAI-compat API for any LLM client.',
    updatedAt: '2026-04-03T00:00:00Z',
  },
  {
    number: 10,
    name: 'Obsidian Protocol',
    description: 'Governance-as-code: all rules enforced by config, contracts, code, or runtime checks. Documentation alone is not enforcement.',
    status: 'ENFORCED',
    enforcement_layer: 'governance-doc',
    mechanism: 'GLOBAL_AGENT_GOVERNANCE.md + runtime enforcement chain',
    mechanism_detail: 'GLOBAL_AGENT_GOVERNANCE.md defines the cross-repo baseline. Runtime enforcement: TypeBox validators (validation.ts), auth middleware (auth.ts), audit trail (audit.ts, 30-day TTL), ACL on tool calls, rate limiting, parameterized queries. Cron compliance scan every 6h (intel-compliance-scan). Final Rule: "If it is not enforced and verified, it is not done."',
    updatedAt: '2026-04-03T00:00:00Z',
  },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getEnforcementMatrix(): ManifestoPrinciple[] {
  return MANIFESTO_PRINCIPLES
}

export function getPrincipleByNumber(n: number): ManifestoPrinciple | undefined {
  return MANIFESTO_PRINCIPLES.find(p => p.number === n)
}

export function getGaps(): ManifestoPrinciple[] {
  return MANIFESTO_PRINCIPLES.filter(p => p.status !== 'ENFORCED')
}

export function getEnforcementScore(): { enforced: number; partial: number; gap: number; score: string } {
  const enforced = MANIFESTO_PRINCIPLES.filter(p => p.status === 'ENFORCED').length
  const partial = MANIFESTO_PRINCIPLES.filter(p => p.status === 'PARTIAL').length
  const gap = MANIFESTO_PRINCIPLES.filter(p => p.status === 'GAP').length
  const score = `${enforced}/10 ENFORCED, ${partial} PARTIAL, ${gap} GAP`
  return { enforced, partial, gap, score }
}

/**
 * Generate parameterized Cypher + params for MERGE of all 10 ManifestoPrinciple nodes.
 * Returns array of {query, params} objects safe for graph.write_cypher.
 */
export function generateGraphCypher(): Array<{ query: string; params: Record<string, unknown> }> {
  return MANIFESTO_PRINCIPLES.map(p => ({
    query: `MERGE (p:ManifestoPrinciple {number: $number})
SET p.name = $name,
    p.description = $description,
    p.status = $status,
    p.enforcement_layer = $enforcement_layer,
    p.mechanism = $mechanism,
    p.mechanism_detail = $mechanism_detail,
    p.gap_remediation = $gap_remediation,
    p.updatedAt = datetime()
RETURN p`,
    params: {
      number: p.number,
      name: p.name,
      description: p.description,
      status: p.status,
      enforcement_layer: p.enforcement_layer,
      mechanism: p.mechanism,
      mechanism_detail: p.mechanism_detail,
      gap_remediation: p.gap_remediation ?? '',
    },
  }))
}
