# ADR-004: HITL Gate — Human-in-the-Loop Escalation

**Status:** Accepted  
**Date:** 2026-04-11  
**Deciders:** C2theK, WidgeTDC Architecture

---

## Context

Low-confidence agent ingestions must not automatically enter the routing fabric. Human review is required before promotion.

## Decision

The HITL Gate blocks Neo4j writes when `confidence_score < 0.70` and escalates via Linear issue creation.

**Threshold:** `HITL_THRESHOLD = 0.70`

**Gate flow:**
```
ingest_agent(confidence=0.65)
  → hitlGate() → confidence < 0.70 → BLOCKED
  → linear.save_issue(team="Linear-clauskraft", priority=High)
  → returns {blocked: true, issueId: "LIN-743"}
  → Neo4j write SKIPPED
  → Agent marked hitl_required=true in graph
```

**Linear issue format:**
- Title: `[HITL] PhantomProvider low confidence: {name} ({confidence}%)`
- Team: `Linear-clauskraft` (UUID: `e7e882f6-d598-4dc4-8766-eaa76dcf140f`)
- Priority: 2 (High)
- Labels: `HITL`, `phantom-bom`

**Router behaviour:** HITL-blocked agents are filtered from cluster membership:
```python
.filter(p => !p.hitl)
```

## Consequences

- Low-quality agents never route to production traffic
- Human review creates an audit trail in Linear
- HITL-blocked agents remain in graph with `hitl_required=true` for re-evaluation

## Implementation Notes

- TypeScript: `src/phantom-bom.ts` → `hitlGate()` function
- Python: `agentic-kit/snout_ingestor.py` → `ingest_agent()` + `linear_hitl.py`
- Linear tool: `linear.save_issue` (not `linear.create_issue` — different API)
- Response mapping: `res.identifier ?? res.id` (not `res.issueId`)
