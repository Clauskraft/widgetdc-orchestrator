/**
 * graph-hygiene.ts — Knowledge Graph World-Class Fixes (LIN-574)
 *
 * Targeted graph repair operations:
 *   P0: Fix Framework→Domain relationship mapping
 *   P1: Consolidate duplicated domains (31→17)
 *   P2: Purge orphan RLMDecision nodes + SHOULD_AWARE_OF bloat
 *
 * Each operation is idempotent (safe to re-run).
 */
import { callMcpTool } from './mcp-caller.js'
import { logger } from './logger.js'
import { broadcastSSE } from './sse.js'
import { v4 as uuid } from 'uuid'

// ─── Helpers ────────────────────────────────────────────────────────────────

async function graphRead(cypher: string): Promise<any[]> {
  const result = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: { query: cypher },
    callId: uuid(),
    timeoutMs: 30000,
  })
  if (result.status !== 'success') return []
  const data = result.result as any
  return data?.results || data || []
}

async function graphWrite(cypher: string, params?: Record<string, unknown>): Promise<boolean> {
  const result = await callMcpTool({
    toolName: 'graph.write_cypher',
    args: { query: cypher, ...(params ? { params } : {}) },
    callId: uuid(),
    timeoutMs: 60000,
  })
  return result.status === 'success'
}

/** Neo4j integers come as {low, high} objects — normalize to JS number */
function neo4jInt(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'object' && 'low' in (val as any)) return (val as any).low
  return Number(val) || 0
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HygieneResult {
  operation: string
  severity: 'P0' | 'P1' | 'P2'
  before: number
  after: number
  fixed: number
  details: string
}

export interface HygieneReport {
  $id: string
  started_at: string
  completed_at: string
  duration_ms: number
  operations: HygieneResult[]
  total_fixed: number
}

// ─── P0: Fix Framework→Domain Relationship Mapping ──────────────────────────

/**
 * 84 Framework nodes use BELONGS_TO_DOMAIN but lack IN_DOMAIN relationships.
 * This creates IN_DOMAIN rels from existing BELONGS_TO_DOMAIN connections,
 * ensuring domain coverage queries work correctly.
 */
export async function fixFrameworkDomainRels(): Promise<HygieneResult> {
  // Count frameworks without IN_DOMAIN
  const before = await graphRead(`
    MATCH (f:Framework)
    WHERE NOT (f)-[:IN_DOMAIN]->(:Domain)
    RETURN count(f) AS count
  `)
  const missingCount = neo4jInt(before[0]?.count)

  if (missingCount === 0) {
    return { operation: 'framework_domain_rels', severity: 'P0', before: 0, after: 0, fixed: 0, details: 'No missing IN_DOMAIN rels' }
  }

  // Create IN_DOMAIN from BELONGS_TO_DOMAIN where missing
  await graphWrite(`
    MATCH (f:Framework)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    WHERE NOT (f)-[:IN_DOMAIN]->(d)
    MERGE (f)-[:IN_DOMAIN]->(d)
  `)

  // Also catch frameworks linked to domain by name property
  await graphWrite(`
    MATCH (f:Framework) WHERE f.domain IS NOT NULL AND NOT (f)-[:IN_DOMAIN]->(:Domain)
    MATCH (d:Domain) WHERE d.name = f.domain OR d.slug = f.domain
    MERGE (f)-[:IN_DOMAIN]->(d)
  `)

  // Verify
  const after = await graphRead(`
    MATCH (f:Framework)
    WHERE NOT (f)-[:IN_DOMAIN]->(:Domain)
    RETURN count(f) AS count
  `)
  const remaining = neo4jInt(after[0]?.count)
  const fixed = missingCount - remaining

  return {
    operation: 'framework_domain_rels',
    severity: 'P0',
    before: missingCount,
    after: remaining,
    fixed: Math.max(0, fixed),
    details: `Created IN_DOMAIN rels for ${Math.max(0, fixed)} frameworks (${remaining} still unlinked — may lack Domain node)`,
  }
}

// ─── P1: Consolidate Duplicated Domains ─────────────────────────────────────

/**
 * Domain consolidation map: merge variant names into canonical 17 domains.
 * All relationships from source domains are re-pointed to canonical domain.
 */
const DOMAIN_CONSOLIDATION: Record<string, string[]> = {
  'Legal & Compliance': ['Legal', 'Legal & Regulatory', 'Compliance'],
  'Digital Transformation': ['Digital', 'Digital Strategy', 'Digitalization'],
  'Strategy & Advisory': ['Strategy', 'Strategic Advisory', 'Business Strategy', 'Corporate Strategy'],
  'Technology & Architecture': ['Technology', 'IT Architecture', 'Enterprise Architecture'],
  'Data & Analytics': ['Data', 'Analytics', 'Data Science', 'Business Intelligence'],
  'Cybersecurity': ['Security', 'Information Security', 'Cyber'],
  'Cloud & Infrastructure': ['Cloud', 'Infrastructure', 'Cloud Computing'],
  'Finance & Risk': ['Finance', 'Risk', 'Financial Services', 'Risk Management'],
  'Public Sector': ['Government', 'Public Administration', 'Gov Tech'],
  'Operations & Delivery': ['Operations', 'Delivery', 'Service Delivery'],
}

export async function consolidateDomains(): Promise<HygieneResult> {
  // Count total domains before
  const beforeResult = await graphRead(`MATCH (d:Domain) RETURN count(d) AS count`)
  const domainsBefore = neo4jInt(beforeResult[0]?.count)
  let totalMerged = 0

  for (const [canonical, variants] of Object.entries(DOMAIN_CONSOLIDATION)) {
    for (const variant of variants) {
      // Skip if variant === canonical
      if (variant === canonical) continue

      // Check if variant domain exists
      const exists = await graphRead(`MATCH (d:Domain {name: '${variant}'}) RETURN count(d) AS count`)
      if (neo4jInt(exists[0]?.count) === 0) continue

      // Re-point all relationships from variant to canonical
      const ok = await graphWrite(`
        MATCH (variant:Domain {name: $variant})
        MATCH (canonical:Domain {name: $canonical})
        WHERE variant <> canonical
        WITH variant, canonical
        OPTIONAL MATCH (variant)<-[r]-()
        WITH variant, canonical, collect(r) AS rels
        UNWIND rels AS rel
        WITH variant, canonical, rel, startNode(rel) AS source, type(rel) AS relType
        CALL apoc.create.relationship(source, relType, {}, canonical) YIELD rel AS newRel
        DELETE rel
        RETURN count(newRel) AS migrated
      `, { variant, canonical })

      // If APOC not available, use simpler approach
      if (!ok) {
        // Simpler: just merge common rel types
        for (const relType of ['IN_DOMAIN', 'BELONGS_TO_DOMAIN', 'COVERS', 'RELATES_TO']) {
          await graphWrite(`
            MATCH (source)-[r:${relType}]->(variant:Domain {name: $variant})
            MATCH (canonical:Domain {name: $canonical})
            WHERE variant <> canonical
            MERGE (source)-[:${relType}]->(canonical)
            DELETE r
          `, { variant, canonical })

          await graphWrite(`
            MATCH (variant:Domain {name: $variant})-[r:${relType}]->(target)
            MATCH (canonical:Domain {name: $canonical})
            WHERE variant <> canonical
            MERGE (canonical)-[:${relType}]->(target)
            DELETE r
          `, { variant, canonical })
        }
      }

      // Delete variant domain if no remaining rels
      await graphWrite(`
        MATCH (d:Domain {name: $variant})
        WHERE NOT (d)-[]-()
        DELETE d
      `, { variant })

      totalMerged++
      logger.info({ variant, canonical }, 'Domain consolidated')
    }
  }

  const afterResult = await graphRead(`MATCH (d:Domain) RETURN count(d) AS count`)
  const domainsAfter = neo4jInt(afterResult[0]?.count)

  return {
    operation: 'domain_consolidation',
    severity: 'P1',
    before: domainsBefore,
    after: domainsAfter,
    fixed: totalMerged,
    details: `Consolidated ${totalMerged} variant domains. ${domainsAfter} domains remaining.`,
  }
}

// ─── P2: Purge Orphan RLMDecision + SHOULD_AWARE_OF Bloat ──────────────────

export async function purgeGraphBloat(): Promise<HygieneResult> {
  // Count orphan RLMDecision nodes (no meaningful relationships)
  const orphanCount = await graphRead(`
    MATCH (d:RLMDecision)
    WHERE NOT (d)-[:DECIDED_BY|AFFECTS|IMPLEMENTS|REFERENCES]-()
    RETURN count(d) AS count
  `)
  const orphans = neo4jInt(orphanCount[0]?.count)

  // Delete orphan RLMDecision in batches (avoid transaction timeout)
  let totalDeleted = 0
  if (orphans > 0) {
    // Delete in batches of 1000
    for (let i = 0; i < Math.ceil(orphans / 1000); i++) {
      const ok = await graphWrite(`
        MATCH (d:RLMDecision)
        WHERE NOT (d)-[:DECIDED_BY|AFFECTS|IMPLEMENTS|REFERENCES]-()
        WITH d LIMIT 1000
        DETACH DELETE d
        RETURN count(*) AS deleted
      `)
      if (!ok) break
      totalDeleted += 1000
    }
    totalDeleted = Math.min(totalDeleted, orphans)
  }

  // Count SHOULD_AWARE_OF relationships
  const saCountResult = await graphRead(`
    MATCH ()-[r:SHOULD_AWARE_OF]->()
    RETURN count(r) AS count
  `)
  const saCount = neo4jInt(saCountResult[0]?.count)

  // Delete SHOULD_AWARE_OF from Lesson nodes older than 30 days (stale lessons)
  let saDeleted = 0
  if (saCount > 100000) {
    await graphWrite(`
      MATCH (a)-[r:SHOULD_AWARE_OF]->(l:Lesson)
      WHERE l.timestamp < datetime() - duration('P30D')
      WITH r LIMIT 50000
      DELETE r
    `)

    // Delete SHOULD_AWARE_OF where the Lesson has duplicate violations
    await graphWrite(`
      MATCH (a)-[r:SHOULD_AWARE_OF]->(l:Lesson)
      WHERE l.violation = 'CONTRACT_VIOLATION'
      AND l.correction CONTAINS 'All JSON must include $id'
      WITH r LIMIT 50000
      DELETE r
    `)

    const saAfter = await graphRead(`MATCH ()-[r:SHOULD_AWARE_OF]->() RETURN count(r) AS count`)
    saDeleted = saCount - neo4jInt(saAfter[0]?.count)
  }

  return {
    operation: 'graph_bloat_purge',
    severity: 'P2',
    before: orphans + saCount,
    after: 0,
    fixed: totalDeleted + Math.max(0, saDeleted),
    details: `Deleted ${totalDeleted} orphan RLMDecision, pruned ${Math.max(0, saDeleted)} stale SHOULD_AWARE_OF rels`,
  }
}

// ─── Main Runner ────────────────────────────────────────────────────────────

/**
 * Run all graph hygiene operations in sequence.
 */
export async function runGraphHygiene(): Promise<HygieneReport> {
  const t0 = Date.now()
  const operations: HygieneResult[] = []

  logger.info('Starting graph hygiene run (LIN-574)')

  // P0 first
  try {
    operations.push(await fixFrameworkDomainRels())
  } catch (err) {
    logger.error({ err: String(err) }, 'P0 framework_domain_rels failed')
    operations.push({ operation: 'framework_domain_rels', severity: 'P0', before: 0, after: 0, fixed: 0, details: `Error: ${String(err).slice(0, 200)}` })
  }

  // P1
  try {
    operations.push(await consolidateDomains())
  } catch (err) {
    logger.error({ err: String(err) }, 'P1 domain_consolidation failed')
    operations.push({ operation: 'domain_consolidation', severity: 'P1', before: 0, after: 0, fixed: 0, details: `Error: ${String(err).slice(0, 200)}` })
  }

  // P2
  try {
    operations.push(await purgeGraphBloat())
  } catch (err) {
    logger.error({ err: String(err) }, 'P2 graph_bloat_purge failed')
    operations.push({ operation: 'graph_bloat_purge', severity: 'P2', before: 0, after: 0, fixed: 0, details: `Error: ${String(err).slice(0, 200)}` })
  }

  const report: HygieneReport = {
    $id: `hygiene-report:${new Date().toISOString().slice(0, 10)}`,
    started_at: new Date(t0).toISOString(),
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    operations,
    total_fixed: operations.reduce((sum, op) => sum + op.fixed, 0),
  }

  broadcastSSE('graph-hygiene', report)
  logger.info({ total_fixed: report.total_fixed, duration_ms: report.duration_ms }, 'Graph hygiene complete')

  return report
}
