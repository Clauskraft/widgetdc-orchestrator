# ADR-001: Agent Data Model

**Status:** Accepted  
**Date:** 2026-04-11  
**Deciders:** C2theK, WidgeTDC Architecture

---

## Context

We need a canonical data model for AI agents that captures identity, pricing, sovereignty, capabilities, and provenance — suitable for graph storage, dynamic routing, and open-spec publication.

## Decision

Agents are stored as `:Agent` nodes in Neo4j with flattened scalar properties (no nested maps). Sovereignty is captured as two explicit properties: `sov_data_residency` and `sov_exec_residency`. Capabilities are a string array.

```cypher
MERGE (a:Agent {agent_id: $agent_id})
SET a += $props, a.ingested_at = datetime()
```

Properties:
- `agent_id` — stable slug (primary key)
- `provider` — linked via `[:HOSTED_BY]` to `:Provider` node
- `model_name`, `context_window`, `pricing_input_per_1k`, `pricing_output_per_1k`
- `capabilities` — string array (e.g. `["reasoning", "code"]`)
- `sov_data_residency`, `sov_exec_residency` — enum: EU | CN | US | ANY | UNKNOWN
- `confidence_score` — Snout confidence in BOM accuracy (0.0–1.0)
- `hitl_required` — boolean; true when confidence < 0.70

## Consequences

- All routing decisions are based on graph properties — no external API calls at route time
- HITL gate enforced at ingestion time, not routing time
- Enabling open-spec publication: BOM schema is stable and versioned

## Alternatives Rejected

- Nested JSON properties: rejected due to poor Cypher query ergonomics
- Separate tables per property type: rejected due to graph model overhead
