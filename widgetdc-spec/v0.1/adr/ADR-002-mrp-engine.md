# ADR-002: MRP Engine — Cluster Generation & Validity Scoring

**Status:** Accepted  
**Date:** 2026-04-11  
**Deciders:** C2theK, WidgeTDC Architecture

---

## Context

Static agent lists are insufficient for dynamic routing. We need a mechanism to group agents by shared constraints and produce a validity score that reflects cluster health.

## Decision

The MRP (Minimum Redundancy Placement) Engine groups agents by `(capability, sov_data_residency)` using a Cypher UNWIND aggregation pattern, then materialises `:PhantomCluster` nodes with a composite validity score.

**Validity Formula:**
```
validity = 0.4 × avg(confidence_score)
         + 0.3 × min(agent_count / 4.0, 1.0)
         + 0.2 × avg(coalesce(uptime_30d, 0.8))
         + 0.1 × compliance_weight   # 1.0 for EU, 0.7 otherwise
```

**Router gate:** Only routes to clusters with `validity_score > 0.75`.

**Key Cypher pattern (correct — avoids avg() scope bug):**
```cypher
MATCH (a:Agent)
UNWIND a.capabilities AS cap
WITH cap, a.sov_data_residency AS geo,
     collect(a.agent_id)             AS agent_ids,
     count(a)                        AS agent_count,
     avg(a.confidence_score)         AS avg_conf,
     avg(coalesce(a.uptime_30d, 0.8)) AS avg_uptime
WHERE agent_count >= 1
```

**Idempotent relationship MERGE:**
```cypher
MERGE (a)-[r:PART_OF]->(c)
ON CREATE SET r.joined_at = datetime()
```
Note: `datetime()` must NOT appear inside the MERGE pattern itself — it produces duplicate relationships on re-runs.

## Consequences

- Clusters auto-update on every Snout ingestion cycle
- Validity gate enforces cluster quality before routing
- Idempotent MERGE prevents relationship duplication

## Failure Mode Documented

Using `MERGE (a)-[:PART_OF {joined_at: datetime()}]->(c)` creates duplicate relationships because `datetime()` differs each invocation. Fixed by using `ON CREATE SET` on the named relationship variable.
