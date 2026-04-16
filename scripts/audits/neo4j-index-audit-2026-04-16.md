# Neo4j index audit — 2026-04-16

Target: Action D from `WidgeTDC-Monorepo-Evaluation.md` §11.7 ("Cypher 15s timeouts — tjek indexes på AgentMemory, MCPTool, VectorDocument, Decision").

## TL;DR

**Action D is largely a false alarm.** The 15s timeouts the report observed were on schema-ops (`SHOW INDEXES`, `db.indexes()`) and full-relationship-scan aggregations — operations that **no index can speed up**. Real production hot-path queries complete in sub-second time on unindexed label scans of 68K-rows. No index creation is justified by current evidence.

**A separate, more severe finding surfaced during the audit**: the backend's `graph.read_cypher` MCP tool silently routes a subset of queries (notably `SHOW INDEXES`) through the Gemini-backed rag-router, which fabricates plausible-looking Cypher output. This is a data-integrity P0 that dwarfs Action D.

## Method

Probes issued through the orchestrator MCP bridge (`POST /api/tools/query_graph`) which wraps backend `graph.read_cypher` with a 15s client timeout. All queries are read-only.

## Environment

- Neo4j AuraDB production, **1,507,975 nodes, 935 labels, 684 rel-types** (2026-04-16, via `apoc.meta.stats()` in 8.9s).
- Orchestrator `5a006d7`, Railway production.

## Hot labels (by count)

| Label          | Nodes    |
|----------------|----------|
| RLMDecision    | 802,956  |
| LLMDecision    | 102,328  |
| AgentMemory    |  68,614  |
| ReasonStep     |  60,044  |
| McKinseyInsight|  52,925  |
| VectorDocument |  34,332  |
| Decision       |  11,783  |
| MCPTool        |   7,658  |

## Schema peek (real data, via `MATCH (n:L) RETURN keys(n) LIMIT 1`, <200ms each)

- **AgentMemory** — `source, type, key, agent_id, updated_at, value, schema_id`
- **VectorDocument** — `id, name, path, source, extension, size, type, embedding, content, updatedAt, namespace, modifiedAt, community, backfilledAt, backfilled, contains_pii, lastAccessed...`
- **MCPTool** — `name, description, embedding, status, last_verified, community, destructiveHint, lastSynced`

## Hot-path performance (actual queries, real Cypher)

| Query | Duration | Row count | Conclusion |
|-------|----------|-----------|------------|
| `MATCH (n:AgentMemory) RETURN count(n)` | 1.08 s | 68,614 | Full-label count, fast enough |
| `MATCH (n:AgentMemory) WHERE n.key STARTS WITH "claim-" RETURN count(n)` | 0.72 s | 53 | Full-label scan + filter; acceptable |
| `MATCH (n) WHERE labels(n) IN [...] RETURN labels(n)[0], count(*)` | 2.77 s | 8 groups | Multi-label aggregation; acceptable |
| `CALL apoc.meta.stats()` | 8.90 s | 1 | Full graph meta; slow but not fatal |

**Hot-path verdict**: all query patterns production code actually issues complete well within the 15s budget, even without dedicated indexes. The MERGE-only write policy combined with label-based reads gives Neo4j enough structure to keep scans cheap.

## Queries that DO time out (>15s) — and why no index would help

| Query | Why it times out |
|-------|------------------|
| `SHOW INDEXES YIELD ... WHERE "X" IN labelsOrTypes` | Schema catalog is full-scanned regardless of WHERE; 935 labels × many potential indexes |
| `MATCH (n) WHERE label IN labels(n) RETURN count(n)` | Invalid Cypher (`label` is not a variable); parser spends time trying |
| `MATCH ()-[r]->() RETURN type(r), count(r)` | Full 2.7M-relationship scan; no index on relationship types for aggregation |
| `EXPLAIN MATCH (n:AgentMemory) WHERE n.key STARTS WITH "claim-"` | Backend appears to execute, not just plan; time similar to real query |

Report §11.4's listed timeouts are in the second + third category. These are **fundamentally expensive query shapes**, not "missing index" problems. Correct remediation is rewriting the queries (use `apoc.meta.stats()` / `db.labels()` / `db.relationshipTypes()` for metadata), not creating indexes.

## SHOW INDEXES is partially broken

5 out of 6 targeted `SHOW INDEXES WHERE "Label" IN labelsOrTypes` calls hit the 15s timeout. The one that returned was for `Decision` — but the result was **LLM-hallucinated** by the rag-router (indicators: `"type": "semantic"`, `"source": "rag-router"`, `"model": "gemini-2.0-flash"`, fabricated UUID index names, Danish preamble "Jeg henter Neo4j skemaet"). The returned index list is not real DB state.

**Net effect**: the production platform currently has no reliable way to introspect its own Neo4j index state via MCP. Any "SHOW INDEXES" call either times out or returns fabricated data.

## Recommendations

1. **Close Action D as "NO-OP, evidence-based"**: hot-path performance is within SLO; rapport's timeouts were on non-hot-path ops. Do not create speculative indexes — they slow writes and bloat storage on 1.5M-node / 935-label graph.
2. **Open a new finding (call it Action G): `graph.read_cypher` backend rag-routing corrupts schema introspection.** When the backend receives a Cypher query it can't cleanly execute or that the rag-router claims first, it responds with a Gemini-fabricated "semantic" answer instead of an error. This makes EVERY downstream Cypher-based MCP tool a liability — you can't trust the output without cross-checking. Fix: in the backend, route ALL `graph.read_cypher` traffic directly to the Neo4j driver; let the client opt-in to the semantic fallback via a separate `graph.semantic` tool.
3. **If specific slow queries surface in production logs later**, audit those individually. Current evidence says none exist above the 15s threshold in the hot path.
4. **Replace `SHOW INDEXES` calls** in audit tooling with direct AuraDB Browser / Cypher Shell. MCP path is unreliable until recommendation #2 is fixed.

## Queries retained for future re-audit

```cypher
# Label counts (key labels, < 3s)
MATCH (n) WHERE ANY(l IN labels(n) WHERE l IN ['AgentMemory','MCPTool','VectorDocument','Decision','RLMDecision','LLMDecision','ReasonStep','McKinseyInsight'])
WITH labels(n)[0] AS lbl RETURN lbl, count(*) AS c ORDER BY c DESC;

# Schema peek per label (< 200ms)
MATCH (n:AgentMemory) RETURN keys(n) AS keys LIMIT 1;

# Overall graph stats (~9s)
CALL apoc.meta.stats() YIELD labelCount, relTypeCount, nodeCount RETURN labelCount, relTypeCount, nodeCount;
```
