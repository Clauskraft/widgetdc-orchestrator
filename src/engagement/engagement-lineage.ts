import { v4 as uuid } from 'uuid'
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'

export type EngagementDeliverableSummary = {
  id: string
  title: string
  type: string
  status: string
  created_at?: string
  completed_at?: string
  source_tool?: string
}

export type EngagementArtifactSummary = {
  path: string
  title: string
  kind: string
  generated_at?: string
  source_tool?: string
  refined_from?: string
  source_deliverable_id?: string
}

type GraphRows = Array<Record<string, unknown>>

type DeliverableLineageInput = {
  engagementId: string
  deliverableId: string
  title: string
  type: string
  status: string
  createdAt?: string
  completedAt?: string
  sourceTool?: string
  derivedFromPath?: string
}

type ObsidianArtifactLineageInput = {
  engagementId: string
  path: string
  title: string
  kind: string
  generatedAt?: string
  sourceTool?: string
  refinedFrom?: string
  sourceDeliverableId?: string
}

async function readRows(query: string, params: Record<string, unknown>): Promise<GraphRows> {
  const result = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: { query, params },
    callId: uuid(),
    timeoutMs: 15000,
  })

  if (result.status !== 'success') return []
  const payload = result.result as Record<string, unknown> | null
  if (!payload || payload.success === false) return []
  return Array.isArray(payload.results) ? payload.results as GraphRows : []
}

export async function recordDeliverableLineage(input: DeliverableLineageInput): Promise<void> {
  if (!input.engagementId) return

  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (eng:Engagement {id: $engagementId})
MERGE (d:Deliverable {id: $deliverableId})
SET d.title = $title,
    d.type = $type,
    d.status = $status,
    d.sourceTool = $sourceTool,
    d.updatedAt = datetime(),
    d.createdAt = coalesce(d.createdAt, datetime($createdAt))
FOREACH (_ IN CASE WHEN $completedAt IS NULL OR $completedAt = '' THEN [] ELSE [1] END |
  SET d.completedAt = datetime($completedAt)
)
MERGE (d)-[:FOR_ENGAGEMENT]->(eng)
MERGE (src:WorkspaceSource {id: $sourceTool})
SET src.kind = 'tool', src.updatedAt = datetime()
MERGE (d)-[:WAS_GENERATED_BY]->(src)
FOREACH (_ IN CASE WHEN $derivedFromPath IS NULL OR $derivedFromPath = '' THEN [] ELSE [1] END |
  MERGE (a:ObsidianArtifact {path: $derivedFromPath})
  MERGE (d)-[:WAS_DERIVED_FROM]->(a)
)`,
        params: {
          engagementId: input.engagementId,
          deliverableId: input.deliverableId,
          title: input.title,
          type: input.type,
          status: input.status,
          createdAt: input.createdAt ?? new Date().toISOString(),
          completedAt: input.completedAt ?? null,
          sourceTool: input.sourceTool ?? 'deliverable_draft',
          derivedFromPath: input.derivedFromPath ?? null,
        },
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 15000,
    })
  } catch (err) {
    logger.warn({ error: String(err), deliverableId: input.deliverableId, engagementId: input.engagementId }, 'Deliverable lineage write failed')
  }
}

export async function recordObsidianArtifactLineage(input: ObsidianArtifactLineageInput): Promise<void> {
  if (!input.engagementId) return

  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (eng:Engagement {id: $engagementId})
MERGE (a:ObsidianArtifact {path: $path})
SET a.title = $title,
    a.kind = $kind,
    a.sourceTool = $sourceTool,
    a.generatedAt = datetime($generatedAt),
    a.refinedFrom = $refinedFrom,
    a.sourceDeliverableId = $sourceDeliverableId,
    a.updatedAt = datetime()
MERGE (a)-[:FOR_ENGAGEMENT]->(eng)
MERGE (src:WorkspaceSource {id: $sourceTool})
SET src.kind = 'surface', src.updatedAt = datetime()
MERGE (a)-[:WAS_GENERATED_BY]->(src)
FOREACH (_ IN CASE WHEN $refinedFrom IS NULL OR $refinedFrom = '' THEN [] ELSE [1] END |
  MERGE (parent:ObsidianArtifact {path: $refinedFrom})
  MERGE (a)-[:WAS_DERIVED_FROM]->(parent)
)
FOREACH (_ IN CASE WHEN $sourceDeliverableId IS NULL OR $sourceDeliverableId = '' THEN [] ELSE [1] END |
  MERGE (d:Deliverable {id: $sourceDeliverableId})
  MERGE (a)-[:WAS_DERIVED_FROM]->(d)
)`,
        params: {
          engagementId: input.engagementId,
          path: input.path,
          title: input.title,
          kind: input.kind,
          generatedAt: input.generatedAt ?? new Date().toISOString(),
          sourceTool: input.sourceTool ?? 'obsidian',
          refinedFrom: input.refinedFrom ?? null,
          sourceDeliverableId: input.sourceDeliverableId ?? null,
        },
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 15000,
    })
  } catch (err) {
    logger.warn({ error: String(err), path: input.path, engagementId: input.engagementId }, 'Obsidian artifact lineage write failed')
  }
}

export async function listDeliverablesForEngagement(engagementId: string, limit = 10): Promise<EngagementDeliverableSummary[]> {
  const rows = await readRows(
    `MATCH (:Engagement {id: $engagementId})<-[:FOR_ENGAGEMENT]-(d:Deliverable)
RETURN d.id AS id,
       d.title AS title,
       d.type AS type,
       d.status AS status,
       toString(d.createdAt) AS created_at,
       toString(d.completedAt) AS completed_at,
       d.sourceTool AS source_tool
ORDER BY d.createdAt DESC
LIMIT $limit`,
    { engagementId, limit },
  )

  return rows.map((row) => ({
    id: String(row.id ?? ''),
    title: String(row.title ?? 'Untitled deliverable'),
    type: String(row.type ?? 'unknown'),
    status: String(row.status ?? 'unknown'),
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    completed_at: typeof row.completed_at === 'string' ? row.completed_at : undefined,
    source_tool: typeof row.source_tool === 'string' ? row.source_tool : undefined,
  })).filter((row) => row.id)
}

export async function listArtifactsForEngagement(engagementId: string, limit = 10): Promise<EngagementArtifactSummary[]> {
  const rows = await readRows(
    `MATCH (:Engagement {id: $engagementId})<-[:FOR_ENGAGEMENT]-(a:ObsidianArtifact)
RETURN a.path AS path,
       a.title AS title,
       a.kind AS kind,
       toString(a.generatedAt) AS generated_at,
       a.sourceTool AS source_tool,
       a.refinedFrom AS refined_from,
       a.sourceDeliverableId AS source_deliverable_id
ORDER BY a.generatedAt DESC
LIMIT $limit`,
    { engagementId, limit },
  )

  return rows.map((row) => ({
    path: String(row.path ?? ''),
    title: String(row.title ?? 'Untitled artifact'),
    kind: String(row.kind ?? 'unknown'),
    generated_at: typeof row.generated_at === 'string' ? row.generated_at : undefined,
    source_tool: typeof row.source_tool === 'string' ? row.source_tool : undefined,
    refined_from: typeof row.refined_from === 'string' ? row.refined_from : undefined,
    source_deliverable_id: typeof row.source_deliverable_id === 'string' ? row.source_deliverable_id : undefined,
  })).filter((row) => row.path)
}
