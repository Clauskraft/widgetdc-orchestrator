# EU AI Act Compliance Mapping — WidgeTDC Agent-MRP

**Version:** v0.1  
**Regulation:** EU AI Act (Regulation 2024/1689)  
**Last reviewed:** 2026-04-11

---

## Risk Classification

The WidgeTDC Agent-MRP system is classified as a **General-Purpose AI (GPAI) orchestration layer** — not a standalone AI model. The system routes to third-party models; it does not train or deploy its own models.

| Component | AI Act Classification | Rationale |
|-----------|----------------------|-----------|
| Snout Ingestor | Not an AI system | Discovery + parsing tool |
| MRP Engine | Not an AI system | Rule-based clustering |
| Dynamic Router | Not an AI system | Constraint-based selection |
| Routed agents (e.g. Qwen, DeepSeek) | GPAI model (Art. 51) | Third-party responsibility |
| HITL Gate | Safeguard / human oversight | Art. 14 compliant |

## Article Mapping

| AI Act Article | Requirement | WidgeTDC Control | Status |
|---------------|-------------|------------------|--------|
| Art. 9 | Risk management system | Validity gate + HITL escalation | ✅ Implemented |
| Art. 12 | Record keeping | ADR-003 EvidenceObject chain | ✅ Implemented |
| Art. 13 | Transparency | BOM schema published (this spec) | ✅ Implemented |
| Art. 14 | Human oversight | HITL gate at confidence < 0.70 | ✅ Implemented |
| Art. 17 | Quality management | MRP validity scoring + PeerEval | ✅ Implemented |
| Art. 72 | GPAI obligations | Passed through to model providers | 🟡 Delegated |

## Conformance Notes

- All agent ingestions are logged with EvidenceObjects (Art. 12 record keeping)
- HITL gate ensures no sub-threshold agent operates autonomously (Art. 14)
- BOM schema and ADR documents constitute transparency documentation (Art. 13)
- Third-party model providers (Alibaba, DeepSeek, Mistral) bear GPAI obligations
