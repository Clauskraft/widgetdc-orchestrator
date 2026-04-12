/**
 * memory-tier-migration.ts — CoALA memory taxonomy Cypher migration.
 *
 * Backfill: MATCH...SET tier on all :AgentMemory nodes based on existing type.
 * Run in Neo4j Browser or via AuraDB console.
 *
 * CoALA taxonomy:
 *   working   — current task context (TTL ~5 min)
 *   short     — recent agent exchanges (TTL ~24h)
 *   episodic  — event traces (TTL ~30d, existing default)
 *   semantic  — facts, patterns (persistent, merge via similarity only)
 *   procedural— skills, routines (persistent, promoted via V9 quality loop)
 */

// Backfill migration — run in Neo4j Browser:
export const BACKFILL_CYPHER = `
MATCH (m:AgentMemory)
WHERE m.tier IS NULL
SET m.tier = CASE
  WHEN m.type IN ['heartbeat','a2a_message'] THEN 'working'
  WHEN m.type IN ['claim','wip'] THEN 'short'
  WHEN m.type IN ['closure','broadcast'] THEN 'episodic'
  WHEN m.type IN ['teaching','intelligence','insight','fact','lesson'] THEN 'semantic'
  WHEN m.type IN ['skill','prompt','procedure'] THEN 'procedural'
  ELSE 'short'
END
RETURN count(m) AS backfilled
`;

// Create index for tier-filtered queries
export const TIER_INDEX = `
CREATE INDEX agentMemory_tier IF NOT EXISTS FOR (m:AgentMemory) ON (m.tier)
`;

// PhantomPatch node for this migration
export const PHANTOM_PATCH = `
MERGE (pp:PhantomPatch {id: 'coala-memory-taxonomy-2026-04-13'})
SET pp.phantom = 'coala-paper',
    pp.score = 0.90,
    pp.category = 'B',
    pp.status = 'applied',
    pp.description = 'Added tier ∈ {working, short, episodic, semantic, procedural} to :AgentMemory. Tier-aware MemoryConsolidator.',
    pp.appliedAt = datetime(),
    pp.appliedBy = 'qwen',
    pp.exit_gates = [
      ':AgentMemory.tier backfilled on all existing nodes (default: short)',
      'MemoryConsolidator respects tier in promotion',
      'memory_search accepts tier filter',
      'Regression tests for tier-aware relevance',
      'Runbook §8 extended with CoALA taxonomy'
    ]
`;
