# WidgeTDC Open Spec v0.1

Formal specification for the Agent-MRP / Fantom / BOM protocol stack.

## What is this?

This spec defines the data models, operational patterns, compliance mappings, and conformance tests for the WidgeTDC sovereign AI routing fabric. The `agentic-kit/` directory in [widgetdc-orchestrator](https://github.com/Clauskraft/widgetdc-orchestrator) is the canonical reference implementation.

## Directory Layout

```
v0.1/
├── schema/
│   ├── bom-schema.yaml          Agent Bill of Materials
│   ├── phantom-cluster.yaml     PhantomCluster node
│   └── evidence-object.yaml     ADR-003 EvidenceObject hash-chain
├── adr/
│   ├── ADR-001-agent-data-model.md
│   ├── ADR-002-mrp-engine.md
│   ├── ADR-003-evidence-hash-chain.md
│   └── ADR-004-hitl-gate.md
├── compliance/
│   ├── gdpr-mapping.md          GDPR Article mapping
│   └── ai-act-mapping.md        EU AI Act Article mapping
└── conformance/
    └── conformance-tests.md     C1–C7 test suite
```

## Core Concepts

| Concept | Description | Schema |
|---------|-------------|--------|
| **Agent BOM** | Immutable description of an AI provider | `schema/bom-schema.yaml` |
| **PhantomCluster** | Grouped agents by capability × geo | `schema/phantom-cluster.yaml` |
| **EvidenceObject** | Tamper-evident audit record | `schema/evidence-object.yaml` |
| **HITL Gate** | Human review for low-confidence ingests | ADR-004 |
| **MRP Engine** | Cluster generation + validity scoring | ADR-002 |
| **Dynamic Router** | Sovereignty-aware agent selection | `agentic-kit/router.py` |

## Conformance

Run the conformance suite:
```bash
cd agentic-kit && bash run_full_suite.sh
```

All 7 conformance tests (C1–C7) must pass on a clean Neo4j instance.

## Status

| Phase | Status |
|-------|--------|
| Phase 1: Infrastructure & Evidence | ✅ Complete |
| Phase 2: Autonomi & Skalering | ✅ Complete |
| Phase 3: TEE + RL-Canary + Open Spec | 🟡 In Progress |

## License

Apache 2.0 — open for community conformance testing.
