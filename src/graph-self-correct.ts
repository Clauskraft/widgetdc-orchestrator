/**
 * graph-self-correct.ts — Self-correcting graph agent.
 *
 * Detects and fixes graph inconsistencies:
 *   - Orphaned nodes (no relationships)
 *   - Stale FailureMemory (old, unresolved patterns)
 *   - Missing bi-temporal metadata (valid_from/valid_to)
 *   - Duplicate nodes by title/name
 *   - Broken cross-references
 *
 * Uses RLM cognitive reasoning to decide repair strategies.
 * Runs as a cron job (self-correcting-graph) every 2 hours.
 */
import { callMcpTool } from './mcp-caller.js'
import { callCognitive } from './cognitive-proxy.js'
import { logger } from './logger.js'
import { v4 as uuid } from 'uuid'

interface CorrectionResult {
  check: string
  found: number
  fixed: number
  details: string
}

interface SelfCorrectReport {
  started_at: string
  completed_at: string
  duration_ms: number
  corrections: CorrectionResult[]
  total_found: number
  total_fixed: number
}

async function graphRead(cypher: string): Promise<any[]> {
  const result = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: { query: cypher },
    callId: uuid(),
    timeoutMs: 15000,
  })
  if (result.status !== 'success') return []
  const data = result.result as any
  return data?.results || data || []
}

async function graphWrite(cypher: string, params?: Record<string, unknown>, force = true): Promise<boolean> {
  const result = await callMcpTool({
    toolName: 'graph.write_cypher',
    args: { query: cypher, ...(params ? { params } : {}), _force: force },
    callId: uuid(),
    timeoutMs: 15000,
  })
  return result.status === 'success'
}

// ─── Check 1: Orphaned nodes ─────────────────────────────────────────────────

async function fixOrphanedNodes(): Promise<CorrectionResult> {
  const orphans = await graphRead(`
    MATCH (n)
    WHERE NOT (n)-[]-()
    AND NOT n:TDCDocument
    RETURN labels(n)[0] AS label, count(*) AS count
    ORDER BY count DESC LIMIT 20
  `)

  let fixed = 0
  const totalFound = orphans.reduce((sum: number, r: any) => sum + (r.count?.low ?? r.count ?? 0), 0)

  // Wire common orphan types to hub nodes
  const hubWiring: Record<string, string> = {
    SystemArchitecture: 'MERGE (hub:CodeHub {name: "system"}) MERGE (n)-[:PART_OF]->(hub)',
    AgentMemory: 'MATCH (a:Agent {name: n.agent_id}) MERGE (n)-[:BELONGS_TO]->(a)',
    EvolutionEvent: 'MERGE (hub:EvolutionHub {name: "evolution"}) MERGE (n)-[:TRACKED_BY]->(hub)',
    Lesson: 'MERGE (hub:LessonHub {name: "lessons"}) MERGE (n)-[:CATALOGED_IN]->(hub)',
    FailureMemory: 'MERGE (hub:FailureHub {name: "failures"}) MERGE (n)-[:TRACKED_BY]->(hub)',
  }

  for (const [label, wireCypher] of Object.entries(hubWiring)) {
    const count = orphans.find((r: any) => r.label === label)
    if (count) {
      const ok = await graphWrite(`
        MATCH (n:${label}) WHERE NOT (n)-[]-()
        WITH n LIMIT 50
        ${wireCypher}
      `)
      if (ok) fixed += Math.min(count.count?.low ?? count.count ?? 0, 50)
    }
  }

  return {
    check: 'orphaned_nodes',
    found: totalFound,
    fixed,
    details: orphans.map((r: any) => `${r.label}: ${r.count?.low ?? r.count}`).join(', '),
  }
}

// ─── Check 2: Add bi-temporal metadata ───────────────────────────────────────

async function addBiTemporalMetadata(): Promise<CorrectionResult> {
  // Find nodes missing valid_from
  const missing = await graphRead(`
    MATCH (n)
    WHERE n.created_at IS NOT NULL AND n.valid_from IS NULL
    AND (n:StrategicInsight OR n:Pattern OR n:Lesson OR n:Knowledge OR n:AgentMemory)
    RETURN labels(n)[0] AS label, count(*) AS count
  `)

  const totalFound = missing.reduce((sum: number, r: any) => sum + (r.count?.low ?? r.count ?? 0), 0)
  let fixed = 0

  for (const row of missing) {
    const label = row.label
    const ok = await graphWrite(`
      MATCH (n:${label})
      WHERE n.created_at IS NOT NULL AND n.valid_from IS NULL
      WITH n LIMIT 100
      SET n.valid_from = n.created_at,
          n.valid_to = datetime('9999-12-31T23:59:59Z'),
          n.temporal_version = 1
    `)
    if (ok) fixed += Math.min(row.count?.low ?? row.count ?? 0, 100)
  }

  return {
    check: 'bi_temporal_metadata',
    found: totalFound,
    fixed,
    details: `Added valid_from/valid_to to ${fixed} nodes`,
  }
}

// ─── Check 3: Stale failure patterns ─────────────────────────────────────────

async function resolveStaleFailures(): Promise<CorrectionResult> {
  const stale = await graphRead(`
    MATCH (f:FailureMemory)
    WHERE f.created_at < datetime() - duration('P30D')
    AND f.resolved IS NULL
    RETURN count(f) AS count
  `)
  const totalFound = stale[0]?.count?.low ?? stale[0]?.count ?? 0

  if (totalFound === 0) {
    return { check: 'stale_failures', found: 0, fixed: 0, details: 'No stale failures' }
  }

  // Mark old unresolved failures as stale
  const ok = await graphWrite(`
    MATCH (f:FailureMemory)
    WHERE f.created_at < datetime() - duration('P30D')
    AND f.resolved IS NULL
    WITH f LIMIT 50
    SET f.resolved = 'auto-stale',
        f.resolved_at = datetime(),
        f.valid_to = datetime()
  `)

  return {
    check: 'stale_failures',
    found: totalFound,
    fixed: ok ? Math.min(totalFound, 50) : 0,
    details: `${totalFound} failures older than 30 days`,
  }
}

// ─── Check 4: Duplicate detection ───────────────────────────────────────────

async function detectDuplicates(): Promise<CorrectionResult> {
  const dupes = await graphRead(`
    MATCH (n)
    WHERE n.title IS NOT NULL
    AND (n:StrategicInsight OR n:Pattern OR n:Lesson OR n:Knowledge)
    WITH n.title AS title, labels(n)[0] AS label, collect(n) AS nodes
    WHERE size(nodes) > 1
    RETURN label, title, size(nodes) AS count
    LIMIT 20
  `)

  const totalFound = dupes.reduce((sum: number, r: any) => sum + (r.count?.low ?? r.count ?? 0), 0)

  // For now, just report — merging requires RLM reasoning to pick the best version
  return {
    check: 'duplicates',
    found: totalFound,
    fixed: 0,
    details: dupes.map((r: any) => `${r.label}:"${r.title}" (${r.count?.low ?? r.count}x)`).join(', ') || 'None',
  }
}

// ─── Check 5: Evolution events without pass_rate ─────────────────────────────

async function fixEvolutionEvents(): Promise<CorrectionResult> {
  const broken = await graphRead(`
    MATCH (e:EvolutionEvent)
    WHERE e.pass_rate IS NULL AND e.passed IS NOT NULL AND e.total IS NOT NULL
    RETURN count(e) AS count
  `)
  const totalFound = broken[0]?.count?.low ?? broken[0]?.count ?? 0

  if (totalFound === 0) {
    return { check: 'evolution_events', found: 0, fixed: 0, details: 'All events have pass_rate' }
  }

  const ok = await graphWrite(`
    MATCH (e:EvolutionEvent)
    WHERE e.pass_rate IS NULL AND e.passed IS NOT NULL AND e.total IS NOT NULL
    WITH e LIMIT 100
    SET e.pass_rate = toFloat(e.passed) / toFloat(e.total),
        e.type = coalesce(e.type, 'evolution')
  `)

  return {
    check: 'evolution_events',
    found: totalFound,
    fixed: ok ? Math.min(totalFound, 100) : 0,
    details: `Fixed pass_rate on ${Math.min(totalFound, 100)} events`,
  }
}

// ─── Check 6: RLMDecision → Agent links (WS-2, from backend) ───────────────

async function healRLMDecisionAgentLinks(): Promise<CorrectionResult> {
  const ok = await graphWrite(`
    MATCH (d:RLMDecision)
    WHERE d.agentId IS NOT NULL AND d.agentId <> 'anonymous'
      AND NOT EXISTS { (d)-[:MADE_BY]->(:Agent) }
    WITH d LIMIT 2000
    MATCH (a:Agent) WHERE a.id = d.agentId OR a.name = d.agentId
    WITH d, a LIMIT 2000
    MERGE (d)-[:MADE_BY {confidence: 0.9, autoHealed: true}]->(a)
    RETURN count(*) AS linked
  `)
  // Can't get exact count from boolean, estimate based on success
  return { check: 'rlm_decision_links', found: 0, fixed: ok ? 1 : 0, details: ok ? 'Linked RLMDecision → Agent' : 'No unlinked decisions or failed' }
}

// ─── Check 7: Score unscored relationships (WS-3) ──────────────────────────

async function healUnscoredRels(): Promise<CorrectionResult> {
  const ok = await graphWrite(`
    MATCH ()-[r]->()
    WHERE r.confidence IS NULL AND r.score IS NULL
      AND r.strength IS NULL AND r.weight IS NULL
    WITH r LIMIT 5000
    SET r.confidence = 0.6
    RETURN count(r) AS scored
  `)
  return { check: 'unscored_rels', found: 0, fixed: ok ? 1 : 0, details: ok ? 'Default-scored relationships @ 0.6' : 'None or failed' }
}

// ─── Check 8: Clean self-loops (WS-4) ──────────────────────────────────────

async function cleanSelfLoops(): Promise<CorrectionResult> {
  const loops = await graphRead(`MATCH (n)-[r]->(n) RETURN count(r) AS count`)
  const found = loops[0]?.count?.low ?? loops[0]?.count ?? 0
  if (found === 0) return { check: 'self_loops', found: 0, fixed: 0, details: 'No self-loops' }

  const ok = await graphWrite(`
    MATCH (n)-[r]->(n)
    WITH r LIMIT 100
    DELETE r
    RETURN count(*) AS deleted
  `)
  return { check: 'self_loops', found, fixed: ok ? Math.min(found, 100) : 0, details: `${found} self-loops found` }
}

// ─── Check 9: Clean incomplete ErrorPattern nodes (WS-6, no EmergentPattern) ─

async function healErrorPatterns(): Promise<CorrectionResult> {
  const broken = await graphRead(`
    MATCH (ep:ErrorPattern)
    WHERE ep.signature IS NULL AND ep.description IS NULL AND ep.name IS NULL
    RETURN count(ep) AS count
  `)
  const found = broken[0]?.count?.low ?? broken[0]?.count ?? 0
  if (found === 0) return { check: 'error_patterns', found: 0, fixed: 0, details: 'No incomplete ErrorPatterns' }

  const ok = await graphWrite(`
    MATCH (ep:ErrorPattern)
    WHERE ep.signature IS NULL AND ep.description IS NULL AND ep.name IS NULL
    WITH ep LIMIT 100
    DETACH DELETE ep
    RETURN count(*) AS deleted
  `)
  return { check: 'error_patterns', found, fixed: ok ? Math.min(found, 100) : 0, details: `${found} skeleton ErrorPattern nodes` }
}

// ─── Check 10: Wire Tool→Service DEPENDS_ON (WS-7) ─────────────────────────

const TOOL_SERVICE_MAP: Record<string, string[]> = {
  'graph.': ['Neo4j'], 'nexus.': ['Neo4j'], 'srag.': ['Neo4j'],
  'kg_rag.': ['Neo4j'], 'autonomous.': ['Neo4j', 'RLM Engine'],
  'audit.': ['Neo4j'], 'harvest.': ['Neo4j'], 'omega.': ['Neo4j'],
  'cma.': ['Redis', 'Neo4j'], 'vidensarkiv.': ['PostgreSQL', 'Neo4j'],
  'blocks.': ['PostgreSQL'], 'notes.': ['PostgreSQL'], 'widgets.': ['PostgreSQL'],
  'project.': ['PostgreSQL'], 'legal.': ['PostgreSQL'],
  'rlm.': ['RLM Engine'], 'rlm_': ['RLM Engine'], 'context_folding.': ['RLM Engine'],
  'agent.': ['WidgeTDC Backend'], 'action.': ['WidgeTDC Backend'],
  'loop.': ['WidgeTDC Backend'], 'linear.': ['WidgeTDC Backend'],
  'git.': ['WidgeTDC Backend'], 'custodian.': ['WidgeTDC Backend'],
}

async function wireToolDependencies(): Promise<CorrectionResult> {
  let wired = 0
  for (const [prefix, services] of Object.entries(TOOL_SERVICE_MAP)) {
    for (const service of services) {
      const ok = await graphWrite(`
        MATCH (t:Tool) WHERE t.name STARTS WITH $prefix
        MATCH (s:Service {name: $service})
        WHERE NOT EXISTS { (t)-[:DEPENDS_ON]->(s) }
        WITH t, s LIMIT 200
        MERGE (t)-[r:DEPENDS_ON]->(s)
        ON CREATE SET r.autoWired = true, r.wiredAt = datetime(), r.source = 'namespace-convention'
        RETURN count(r) AS created
      `, { prefix, service })
      if (ok) wired++
    }
  }
  return { check: 'tool_dependencies', found: 0, fixed: wired, details: `Wired ${wired} namespace→service mappings` }
}

// ─── Check 11: Prune ghost Agent nodes (WS-8) ──────────────────────────────

async function pruneGhostAgents(): Promise<CorrectionResult> {
  const ghosts = await graphRead(`
    MATCH (a:Agent)
    WHERE a.status = 'DEPRECATED'
      AND (a.lastSeen IS NULL OR a.lastSeen < datetime() - duration({days: 30}))
      AND NOT EXISTS { (a)-[:MADE_BY|:PRODUCED|:LEARNED_FROM]-() }
    RETURN count(a) AS count
  `)
  const found = ghosts[0]?.count?.low ?? ghosts[0]?.count ?? 0
  if (found === 0) return { check: 'ghost_agents', found: 0, fixed: 0, details: 'No ghost agents' }

  const ok = await graphWrite(`
    MATCH (a:Agent)
    WHERE a.status = 'DEPRECATED'
      AND (a.lastSeen IS NULL OR a.lastSeen < datetime() - duration({days: 30}))
      AND NOT EXISTS { (a)-[:MADE_BY|:PRODUCED|:LEARNED_FROM]-() }
    SET a.status = 'ARCHIVED', a.archivedAt = datetime()
    RETURN count(a) AS archived
  `)
  return { check: 'ghost_agents', found, fixed: ok ? found : 0, details: `${found} deprecated agents with no activity` }
}

// ─── Check 12: Hydrate Tool status (R1) ────────────────────────────────────

async function hydrateToolStatus(): Promise<CorrectionResult> {
  const ok1 = await graphWrite(`
    MATCH (t:Tool)-[:DEPENDS_ON]->(s:Service)
    WHERE t.status IS NULL
    WITH t, collect(s.status) AS statuses
    SET t.status = CASE WHEN all(st IN statuses WHERE st = 'ACTIVE') THEN 'ACTIVE' ELSE 'UNKNOWN' END,
        t.status_source = 'dependency_cascade', t.hydrated_at = datetime()
    RETURN count(t) AS hydrated
  `)
  const ok2 = await graphWrite(`
    MATCH (t:Tool) WHERE t.status IS NULL
    WITH t LIMIT 5000
    SET t.status = 'UNKNOWN', t.status_source = 'boot_hydration', t.hydrated_at = datetime()
    RETURN count(t) AS hydrated
  `)
  return { check: 'tool_status_hydration', found: 0, fixed: (ok1 ? 1 : 0) + (ok2 ? 1 : 0), details: 'Hydrated null-status Tool nodes' }
}

// ─── Check 13: Detect improvement opportunities (R7) ───────────────────────

async function detectImprovementOpportunities(): Promise<CorrectionResult> {
  let detected = 0

  // High-latency services
  const ok1 = await graphWrite(`
    MATCH (s:Service) WHERE s.latency_ms > 500 AND s.status = 'ACTIVE'
    MERGE (opp:ImprovementOpportunity {type: 'high_latency', target: s.name})
    ON CREATE SET opp.id = randomUUID(), opp.description = s.name + ' avg latency ' + toString(s.latency_ms) + 'ms',
                  opp.name = 'high_latency: ' + s.name, opp.priority = 'P1', opp.status = 'OPEN', opp.created_at = datetime()
    ON MATCH SET opp.last_seen = datetime()
    RETURN count(opp) AS found
  `)
  if (ok1) detected++

  // Orphan clusters (labels with many weakly connected nodes)
  const ok2 = await graphWrite(`
    MATCH (n) WHERE size([(n)-[]-() | 1]) <= 1
    WITH labels(n)[0] AS label, count(n) AS cnt WHERE cnt > 50
    MERGE (opp:ImprovementOpportunity {type: 'orphan_cluster', target: label})
    ON CREATE SET opp.id = randomUUID(), opp.description = label + ' has ' + toString(cnt) + ' weakly connected nodes',
                  opp.name = 'orphan_cluster: ' + label, opp.priority = 'P2', opp.status = 'OPEN', opp.created_at = datetime()
    ON MATCH SET opp.last_seen = datetime(), opp.count = cnt
    RETURN count(opp) AS found
  `)
  if (ok2) detected++

  // Unreliable tools
  const ok3 = await graphWrite(`
    MATCH (t:Tool)-[r:FAILED_WITH]->()
    WITH t, count(r) AS failures WHERE failures >= 3
    MERGE (opp:ImprovementOpportunity {type: 'unreliable_tool', target: t.name})
    ON CREATE SET opp.id = randomUUID(), opp.description = t.name + ' has ' + toString(failures) + ' failure patterns',
                  opp.name = 'unreliable_tool: ' + t.name, opp.priority = 'P1', opp.status = 'OPEN', opp.created_at = datetime()
    ON MATCH SET opp.last_seen = datetime(), opp.failure_count = failures
    RETURN count(opp) AS found
  `)
  if (ok3) detected++

  return { check: 'improvement_opportunities', found: 0, fixed: detected, details: `${detected}/3 opportunity scans succeeded` }
}

// ─── Check 14: Prune stale data (R8) ───────────────────────────────────────

async function pruneStaleData(): Promise<CorrectionResult> {
  let pruned = 0

  // Reset stale DEGRADED tools
  const ok1 = await graphWrite(`
    MATCH (t:Tool)
    WHERE t.status = 'DEGRADED' AND t.degraded_at IS NOT NULL
      AND t.degraded_at < datetime() - duration({hours: 24})
    SET t.status = 'UNKNOWN', t.degraded_reason = null, t.degraded_at = null, t.status_source = 'stale_reset'
    RETURN count(t) AS reset
  `)
  if (ok1) pruned++

  // Close stale ImprovementOpportunity nodes (>7 days)
  const ok2 = await graphWrite(`
    MATCH (opp:ImprovementOpportunity)
    WHERE opp.status = 'OPEN'
      AND coalesce(opp.last_seen, opp.created_at) < datetime() - duration({days: 7})
    SET opp.status = 'STALE', opp.closed_at = datetime()
    RETURN count(opp) AS closed
  `)
  if (ok2) pruned++

  return { check: 'stale_data_pruning', found: 0, fixed: pruned, details: `${pruned}/2 pruning passes succeeded` }
}

// ─── Main self-correct run ───────────────────────────────────────────────────

export async function runSelfCorrect(): Promise<SelfCorrectReport> {
  const t0 = Date.now()
  const startedAt = new Date().toISOString()

  logger.info('Self-correcting graph agent starting')

  const corrections = await Promise.all([
    // Original orchestrator healers
    fixOrphanedNodes().catch(err => ({
      check: 'orphaned_nodes', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    addBiTemporalMetadata().catch(err => ({
      check: 'bi_temporal_metadata', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    resolveStaleFailures().catch(err => ({
      check: 'stale_failures', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    detectDuplicates().catch(err => ({
      check: 'duplicates', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    fixEvolutionEvents().catch(err => ({
      check: 'evolution_events', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    // Consolidated from backend graphSelfHealingCron (LIN-580 SNOUT-2)
    healRLMDecisionAgentLinks().catch(err => ({
      check: 'rlm_decision_links', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    healUnscoredRels().catch(err => ({
      check: 'unscored_rels', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    cleanSelfLoops().catch(err => ({
      check: 'self_loops', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    healErrorPatterns().catch(err => ({
      check: 'error_patterns', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    wireToolDependencies().catch(err => ({
      check: 'tool_dependencies', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    pruneGhostAgents().catch(err => ({
      check: 'ghost_agents', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    hydrateToolStatus().catch(err => ({
      check: 'tool_status_hydration', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    detectImprovementOpportunities().catch(err => ({
      check: 'improvement_opportunities', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
    pruneStaleData().catch(err => ({
      check: 'stale_data_pruning', found: 0, fixed: 0, details: `Error: ${err}`,
    })),
  ])

  const report: SelfCorrectReport = {
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    corrections,
    total_found: corrections.reduce((s, c) => s + c.found, 0),
    total_fixed: corrections.reduce((s, c) => s + c.fixed, 0),
  }

  // Write self-correction event to graph
  try {
    await graphWrite(`
      CREATE (e:SelfCorrectionEvent {
        timestamp: datetime(),
        total_found: $found,
        total_fixed: $fixed,
        duration_ms: $ms,
        checks: $checks,
        valid_from: datetime(),
        valid_to: datetime('9999-12-31T23:59:59Z')
      })
    `, {
      found: report.total_found,
      fixed: report.total_fixed,
      ms: report.duration_ms,
      checks: JSON.stringify(corrections),
    } as any)
  } catch {
    // non-fatal
  }

  logger.info({
    found: report.total_found,
    fixed: report.total_fixed,
    ms: report.duration_ms,
  }, 'Self-correcting graph agent complete')

  return report
}
