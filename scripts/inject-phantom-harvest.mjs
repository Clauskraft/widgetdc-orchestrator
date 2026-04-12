#!/usr/bin/env node
/**
 * inject-phantom-harvest.mjs — Batch inject Phantom BOM Harvest candidates into Neo4j.
 *
 * Runs MERGE on source_url so already-injected candidates (Gemini's 15) aren't duplicated.
 * Links every candidate DISCOVERED_BY the mission.
 * Augments existing Gemini nodes with missing fields.
 * Updates mission meta (completed_at, cost, telemetry, final_count).
 * Posts closure AgentMemory.
 */
import { readFileSync } from 'node:fs'

const BACKEND = 'https://backend-production-d3da.up.railway.app'
const API_KEY = 'Heravej_22'
const MISSION_ID = 'phantom-bom-harvest-gemini-2026-04-12'

async function mcp(tool, payload) {
  const r = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(60000),
  })
  return r.json()
}

const file = JSON.parse(readFileSync('phantom-bom-harvest-2026-04-12.json', 'utf8'))
const candidates = file.candidates

console.log(`Loaded ${candidates.length} candidates`)

// ─── Stage 1: Batch inject (MERGE on source) ──────────────────────────────
const injectQuery = `
UNWIND $candidates AS c
MERGE (ek:ExternalKnowledge {source: c.source_url})
ON CREATE SET
  ek.id = randomUUID(),
  ek.name = c.name,
  ek.category = c.category,
  ek.source_type = c.source_type,
  ek.license = c.license,
  ek.primary_language = c.primary_language,
  ek.monster_value_score = c.monster_value_score,
  ek.extractable_patterns = c.extractable_patterns,
  ek.priority = c.priority,
  ek.rejection_risks = c.rejection_risks,
  ek.mission_id = $mission,
  ek.extractedAt = datetime(),
  ek.verifiedBy = 'claude-code',
  ek.source_agent = 'claude-code-harvest'
ON MATCH SET
  ek.priority = coalesce(ek.priority, c.priority),
  ek.rejection_risks = coalesce(ek.rejection_risks, c.rejection_risks),
  ek.source_type = coalesce(ek.source_type, c.source_type)
WITH ek
MATCH (rm:ResearchMission {id: $mission})
MERGE (ek)-[:DISCOVERED_BY]->(rm)
RETURN count(ek) AS touched
`

console.log('Stage 1: batch injecting...')
const injectResult = await mcp('graph.write_cypher', {
  query: injectQuery,
  params: { candidates, mission: MISSION_ID },
})
console.log('  →', JSON.stringify(injectResult.result?.results ?? injectResult))

// ─── Stage 2: Augment Gemini's existing nodes with missing fields ────────
const augmentQuery = `
MATCH (ek:ExternalKnowledge)-[:DISCOVERED_BY]->(rm:ResearchMission {id: $mission})
WHERE ek.source_agent IS NULL OR ek.source_agent = 'gemini'
SET ek.source_agent = coalesce(ek.source_agent, 'gemini'),
    ek.dimension_scores = coalesce(ek.dimension_scores, 'unverified_needs_live_check'),
    ek.osint_flags = coalesce(ek.osint_flags, 'unverified_needs_live_check'),
    ek.priority = coalesce(ek.priority, CASE
      WHEN ek.monster_value_score >= 0.9 THEN 'P0'
      WHEN ek.monster_value_score >= 0.8 THEN 'P1'
      WHEN ek.monster_value_score >= 0.7 THEN 'P2'
      ELSE 'P3' END)
RETURN count(ek) AS augmented
`

console.log('Stage 2: augmenting Gemini nodes...')
const augmentResult = await mcp('graph.write_cypher', { query: augmentQuery, params: { mission: MISSION_ID } })
console.log('  →', JSON.stringify(augmentResult.result?.results ?? augmentResult))

// ─── Stage 3: Update mission meta ────────────────────────────────────────
const metaQuery = `
MATCH (rm:ResearchMission {id: $mission})
OPTIONAL MATCH (ek:ExternalKnowledge)-[:DISCOVERED_BY]->(rm)
WITH rm, count(ek) AS total
SET rm.status = 'COMPLETED',
    rm.completed_at = datetime(),
    rm.final_count = total,
    rm.injected_count = total,
    rm.cost_dkk = 31.2,
    rm.cost_note = 'Gemini reported 342 tool calls and 31.2 DKK; not instrumented per-call — Claude merged batch adds ~0 DKK (direct Cypher)',
    rm.telemetry_note = 'Gemini telemetry not persisted; Claude harvest via 8 parallel research subagents, no live OSINT scan, licenses need live verification',
    rm.executors = ['gemini (partial)', 'claude-code (merge + augment)']
RETURN rm.final_count AS final_count, rm.status AS status
`

console.log('Stage 3: updating mission meta...')
const metaResult = await mcp('graph.write_cypher', { query: metaQuery, params: { mission: MISSION_ID } })
console.log('  →', JSON.stringify(metaResult.result?.results ?? metaResult))

// ─── Stage 4: Closure AgentMemory ────────────────────────────────────────
const closureQuery = `
MERGE (m:AgentMemory {agentId: $aid, key: $key})
SET m.value = $val,
    m.type = 'closure',
    m.updatedAt = datetime(),
    m.source = 'claude-code',
    m.mission_id = $mission
RETURN m.key
`

console.log('Stage 4: posting closure broadcast...')
const closureResult = await mcp('graph.write_cypher', {
  query: closureQuery,
  params: {
    aid: 'claude-code',
    key: 'mission-closure-phantom-bom-2026-04-12',
    val: `Phantom BOM harvest merged: ${candidates.length} Claude candidates + 15 Gemini candidates injected. Total ExternalKnowledge nodes linked to mission. Licenses need live verification before agentic_snout_ingest. Next: Qwen Week 3 ingestion.`,
    mission: MISSION_ID,
  },
})
console.log('  →', JSON.stringify(closureResult.result?.results ?? closureResult))

// ─── Stage 5: Final verification ─────────────────────────────────────────
console.log('Stage 5: verifying final state...')
const verifyResult = await mcp('graph.read_cypher', {
  query: `MATCH (ek:ExternalKnowledge)-[:DISCOVERED_BY]->(rm:ResearchMission {id: $mission})
          RETURN ek.category AS cat, count(ek) AS n ORDER BY cat`,
  params: { mission: MISSION_ID },
})
console.log('  → category distribution:', JSON.stringify(verifyResult.result?.results ?? verifyResult))

console.log('\n✅ Done')
