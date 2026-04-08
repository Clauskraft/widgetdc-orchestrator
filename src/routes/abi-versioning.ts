/**
 * routes/abi-versioning.ts — ABI Tool-Level Versioning + Deprecation (LIN-573).
 *
 * Provides discovery endpoints for tool versions, deprecation status,
 * and a lightweight changelog.
 *
 *   GET /api/abi/versions    — All tools with version + deprecation status
 *   GET /api/abi/deprecated  — Only deprecated tools with migration guidance
 *   GET /api/abi/changelog   — Version history (maintained in code)
 */
import { Router, Request, Response } from 'express'
import { TOOL_REGISTRY } from '../tools/tool-registry.js'

export const abiVersioningRouter = Router()

/**
 * GET /api/abi/versions — List all tools with version + deprecation status.
 */
abiVersioningRouter.get('/versions', (_req: Request, res: Response) => {
  const tools = TOOL_REGISTRY.map(t => ({
    name: t.name,
    namespace: t.namespace,
    version: t.version,
    category: t.category,
    deprecated: t.deprecated ?? false,
    deprecatedSince: t.deprecatedSince ?? null,
    deprecatedMessage: t.deprecatedMessage ?? null,
    sunsetDate: t.sunsetDate ?? null,
    replacedBy: t.replacedBy ?? null,
    availableVia: t.availableVia,
  }))

  res.json({
    success: true,
    data: {
      tools,
      total: tools.length,
      deprecated_count: tools.filter(t => t.deprecated).length,
      active_count: tools.filter(t => !t.deprecated).length,
    },
  })
})

/**
 * GET /api/abi/deprecated — Only deprecated tools with migration info.
 */
abiVersioningRouter.get('/deprecated', (_req: Request, res: Response) => {
  const deprecated = TOOL_REGISTRY
    .filter(t => t.deprecated)
    .map(t => ({
      name: t.name,
      namespace: t.namespace,
      version: t.version,
      deprecatedSince: t.deprecatedSince ?? null,
      deprecatedMessage: t.deprecatedMessage ?? null,
      sunsetDate: t.sunsetDate ?? null,
      replacedBy: t.replacedBy ?? null,
      migration: t.replacedBy
        ? `Replace calls to "${t.name}" with "${t.replacedBy}". ${t.deprecatedMessage ?? ''}`
        : t.deprecatedMessage ?? 'No migration guidance available.',
    }))

  res.json({
    success: true,
    data: {
      deprecated,
      count: deprecated.length,
      upcoming_sunsets: deprecated
        .filter(d => d.sunsetDate)
        .sort((a, b) => (a.sunsetDate ?? '').localeCompare(b.sunsetDate ?? '')),
    },
  })
})

/**
 * ABI Changelog — version history maintained in code.
 * Each entry records a version bump, deprecation, or tool addition.
 */
const ABI_CHANGELOG: Array<{
  version: string
  date: string
  changes: Array<{ type: 'added' | 'deprecated' | 'removed' | 'changed'; tool: string; description: string }>
}> = [
  {
    version: '2.0.0',
    date: '2026-03-28',
    changes: [
      { type: 'added', tool: 'search_knowledge', description: 'Dual-channel RAG (SRAG + Neo4j graph) search' },
      { type: 'added', tool: 'reason_deeply', description: 'RLM reasoning engine proxy' },
      { type: 'added', tool: 'query_graph', description: 'Neo4j Cypher read queries' },
      { type: 'added', tool: 'check_tasks', description: 'Linear task status from graph' },
      { type: 'added', tool: 'call_mcp_tool', description: 'Dynamic MCP tool proxy (449+ tools)' },
      { type: 'added', tool: 'get_platform_health', description: 'Platform service health check' },
      { type: 'added', tool: 'search_documents', description: 'Document search via SRAG' },
      { type: 'added', tool: 'linear_issues', description: 'Linear issue listing' },
      { type: 'added', tool: 'linear_issue_detail', description: 'Linear issue detail' },
      { type: 'added', tool: 'run_chain', description: 'Multi-step agent chain execution' },
      { type: 'added', tool: 'investigate', description: 'Deep multi-agent investigation' },
      { type: 'added', tool: 'create_notebook', description: 'Interactive consulting notebook' },
      { type: 'added', tool: 'verify_output', description: 'Content verification checks' },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-03-30',
    changes: [
      { type: 'added', tool: 'generate_deliverable', description: 'Consulting deliverable generation (analysis/roadmap/assessment)' },
      { type: 'added', tool: 'precedent_search', description: 'Hybrid structural + semantic client similarity' },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-04-02',
    changes: [
      { type: 'added', tool: 'governance_matrix', description: 'Manifesto enforcement matrix (10 principles)' },
      { type: 'added', tool: 'run_osint_scan', description: 'OSINT scanning pipeline for DK public sector' },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-04-03',
    changes: [
      { type: 'added', tool: 'run_evolution', description: 'Autonomous OODA evolution loop' },
      { type: 'added', tool: 'list_tools', description: 'Tool discovery with schema and protocol info' },
    ],
  },
  {
    version: '2.4.0',
    date: '2026-04-03',
    changes: [
      { type: 'changed', tool: '*', description: 'LIN-573: ABI tool-level versioning + deprecation lifecycle. All tools now expose version, deprecation status, sunset dates, and migration guidance across all 3 protocols.' },
    ],
  },
]

/**
 * GET /api/abi/changelog — Version history.
 */
abiVersioningRouter.get('/changelog', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      changelog: ABI_CHANGELOG,
      latest_version: ABI_CHANGELOG[ABI_CHANGELOG.length - 1]?.version ?? '0.0.0',
      total_entries: ABI_CHANGELOG.length,
    },
  })
})
