# Conformance Test Suite — WidgeTDC Open Spec v0.1

**Version:** v0.1  
**Reference implementation:** `agentic-kit/` in widgetdc-orchestrator repo

---

## How to Run

```bash
cd agentic-kit
export NEO4J_URI="..."
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="..."
bash run_full_suite.sh
```

---

## Test Suite

### C1 — EvidenceObject Creation (ADR-003)

**Test:** Create a root EvidenceObject and verify it is written to Neo4j.

```python
from fantom_validator import FantomContractValidator
v = FantomContractValidator(uri, user, password)
eid = v.add_evidence("test_producer", "test_subject", {"action": "test"})
assert eid.startswith("ev_test_producer_")
assert len(eid.split("_")[-1]) == 16  # 16-char hex hash prefix
v.close()
```

**Pass criteria:** `eid` matches pattern `^ev_[a-z0-9_]+_[a-f0-9]{16}$`

---

### C2 — Hash-Chain Integrity (ADR-003)

**Test:** Create a 3-node chain and verify integrity.

```python
root_id  = v.add_evidence("p", "s", {"seq": 1})
child_id = v.add_evidence("p", "s", {"seq": 2}, prev_evidence_id=root_id)
grand_id = v.add_evidence("p", "s", {"seq": 3}, prev_evidence_id=child_id)
result   = v.verify_chain_integrity(root_id)
assert result["chain_valid"] == True
assert result["nodes_verified"] >= 1
assert result["errors"] == []
```

**Pass criteria:** `chain_valid=True`, `nodes_verified >= 1` for 3-node chain

---

### C3 — HITL Gate Enforcement (ADR-004)

**Test:** Low-confidence ingestion is blocked and escalated.

```python
from snout_ingestor import SnoutIngestor
# Inject agent with confidence < 0.70
# Verify: Neo4j write is skipped OR hitl_required=True is set
# Verify: Linear issue created (or LINEAR_API_KEY warning logged)
```

**Pass criteria:** Agent with confidence=0.62 does NOT appear in router results

---

### C4 — MRP Cluster Generation (ADR-002)

**Test:** After ingestion, PhantomClusters exist for each (capability, geo) pair.

```cypher
MATCH (c:PhantomCluster) 
WHERE c.rule_geo IN ['EU', 'CN'] 
RETURN c.external_id, c.validity_score
```

**Pass criteria:**
- At least 1 EU cluster exists
- All returned clusters have `validity_score` between 0 and 1
- `last_recalculated` is recent (within last 24h)

---

### C5 — Dynamic Router Validity Gate

**Test:** Router rejects clusters below validity_score=0.75.

```python
from router import DynamicRouter
r = DynamicRouter()
# Cluster_EU_reasoning should ROUTE (validity=0.798)
result = r.route_request("reasoning", "EU", max_cost=0.00001)
assert result["status"] == "ROUTED"
# Single-agent CN cluster should NOT route (validity=0.685)
result2 = r.route_request("math", "ANY", max_cost=0.00001)
assert result2["status"] == "NO_ROUTE"  # below 0.75 gate
r.close()
```

**Pass criteria:** EU routing succeeds; single-agent CN routing correctly rejected

---

### C6 — Idempotency (ADR-002)

**Test:** Running MRP Engine twice produces the same cluster count, not doubled.

```python
from mrp_engine import MRPEngine
e = MRPEngine()
count1 = e.recalculate_clusters()
count2 = e.recalculate_clusters()
assert count1 == count2  # Idempotent
e.close()
```

**Pass criteria:** Same cluster count on repeated runs; no duplicate `[:PART_OF]` relationships

---

### C7 — Router Fallback Chain

**Test:** Router returns distinct primary and fallback agents.

```python
result = r.route_request("reasoning", "EU", max_cost=0.00001)
if result["fallback"]:
    assert result["primary"]["agent_id"] != result["fallback"]["agent_id"]
```

**Pass criteria:** Primary ≠ Fallback (requires ≥ 2 agents in cluster)

---

## Conformance Badge

A conformance badge is awarded when all C1–C7 tests pass on a clean Neo4j instance.

```
✅ WidgeTDC Open Spec v0.1 Conformant
   Tests passed: C1 C2 C3 C4 C5 C6 C7
   Verified: 2026-04-11
```
