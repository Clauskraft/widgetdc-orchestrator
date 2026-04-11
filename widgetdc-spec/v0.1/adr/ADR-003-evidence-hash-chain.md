# ADR-003: EvidenceObject Hash-Chain Contract

**Status:** Accepted  
**Date:** 2026-04-11  
**Deciders:** C2theK, WidgeTDC Architecture

---

## Context

Every mutation to the agent registry must be auditable and tamper-evident. Classical audit logs are mutable; we need cryptographic guarantees.

## Decision

Before every Neo4j write, create an `:EvidenceObject` node containing a SHA-256 hash of the mutation payload. Link consecutive evidence nodes via `[:NEXT_IN_CHAIN]` to form a hash chain.

**Hash generation:**
```python
payload_hash = hashlib.sha256(
    json.dumps(payload, sort_keys=True).encode('utf-8')
).hexdigest()
```

**Chain link:**
- Each `EvidenceObject.previous_hash` stores the `payload_hash` of its predecessor
- Integrity check: traverse `[:NEXT_IN_CHAIN*]`, verify `node[i].previous_hash == node[i-1].payload_hash`

**Critical safety pattern — OPTIONAL MATCH for subject linking:**
```cypher
WITH e
OPTIONAL MATCH (subject {external_id: $subject_ref})
FOREACH (_ IN CASE WHEN subject IS NOT NULL THEN [1] ELSE [] END |
    MERGE (e)-[:EVIDENCE_FOR]->(subject))
```
Strict `MATCH` fails the entire query if the subject node doesn't exist yet. `OPTIONAL MATCH + FOREACH` decouples the audit trail from the entity registry.

## Consequences

- Audit trail is immutable once written
- Chain verification is O(n) traversal — runs client-side in Python
- Decoupled from entity lifecycle: evidence can precede entity creation

## DeletionEvent Extension (Phase 3)

When an agent is deleted, create a `DeletionEvent` EvidenceObject and trigger KMS key revocation (TEE crypto-shredding). The chain is NOT deleted — it is sealed with the DeletionEvent as the terminal node.
