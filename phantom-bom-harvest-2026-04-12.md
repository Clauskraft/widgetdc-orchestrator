# Phantom BOM Harvest — Executive Summary

**Mission:** `phantom-bom-harvest-gemini-2026-04-12`
**Completed:** 2026-04-12
**Final count:** 85 `:ExternalKnowledge` nodes linked to mission in Neo4j AuraDB
**Executors:** Gemini (15 injected, meta incomplete) + Claude-code (75 merged + augmented Gemini nodes + updated meta + closure)

---

## 1. Delivery vs. brief

| Target | Delivered | Status |
|---|---|---|
| ≥40 candidates | **85** | ✅ 212% of target |
| ≥5 per category A–G | A=12, B=11, C=10, D=13, E=11, F=12, G=10 | ✅ All met |
| H (wildcard) | 6 | ✅ |
| `:ResearchMission` COMPLETED with final_count | ✅ |
| `DISCOVERED_BY` relationships | 85/85 |
| Closure AgentMemory broadcast | ✅ (claude-code) |

Gap vs. original brief: `mission_telemetry` and `cost_dkk` only partially captured (Gemini reported 342 tool calls / 31.2 DKK but did not instrument per-call; Claude batch-injected via direct Cypher with ~0 marginal cost). Field `cost_note` documents this.

---

## 2. Top 12 by `monster_value_score`

| # | Name | Cat | Score | Priority | Source |
|---|---|---|---|---|---|
| 1 | getzep/graphiti | B | 0.96 | P0 | claude |
| 2 | nibzard/awesome-agentic-patterns | A | 0.95 | P0 | gemini |
| 3 | microsoft/graphrag | B | 0.95 | P0 | claude |
| 4 | open-telemetry/semantic-conventions | G | 0.95 | P0 | claude |
| 5 | ReAct + Reflexion + ToT bundle | A | 0.95 | P0 | claude |
| 6 | sickn33/antigravity-awesome-skills | F | 0.94 | P0 | gemini |
| 7 | princeton-nlp/SWE-bench | C | 0.94 | P0 | claude |
| 8 | tree-sitter/tree-sitter | E | 0.94 | P0 | claude |
| 9 | HKUDS/LightRAG | B | 0.93 | P0 | claude |
| 10 | OSU-NLP-Group/HippoRAG | B | 0.92 | P0 | gemini |
| 11 | EleutherAI/lm-evaluation-harness | C | 0.92 | P0 | claude |
| 12 | NIST OSCAL | D | 0.92 | P0 | claude |

---

## 3. P0 ingestion order for Week 3–4 (recommended)

**Week 3 — foundation primitives** (4 items, parallel):
1. **ReAct + Reflexion + ToT bundle** — re-implement Thought/Action/Observation trace into `chain-engine.ts` as first-class type
2. **tree-sitter + ast-grep** — establish polyglot AST foundation for code intelligence agents
3. **OpenTelemetry semantic-conventions (gen_ai.\*)** — adopt as wire format for LLM tracing across 60 agents
4. **NIST OSCAL schemas** — seed compliance ontology in Neo4j for regulatory-navigator agent

**Week 4 — graph + memory + eval** (4 items):
5. **Graphiti** — bi-temporal edge validity → Neo4j `valid_from/invalid_at` on all `:Fact` nodes
6. **HippoRAG** — Personalized PageRank math on our existing GDS setup
7. **SWE-bench harness + pass@k estimator** — baseline agent-code evaluation
8. **DSPy** — compile-time prompt optimization for the matrix dispatch layer

---

## 4. Category coverage

```
A Agent frameworks & orchestration    : 12
B Knowledge graphs & memory           : 11
C Eval harnesses & benchmarks         : 10
D Consulting/strategy/compliance      : 13
E Code intelligence                   : 11
F Prompts & SKILL libraries           : 12
G AI observability & reliability      : 10
H Wildcard / ontology anchors         :  6
---------------------------------------------
Total                                   : 85
```

---

## 5. OSINT red flags (rejected or flagged)

| Candidate | Reason |
|---|---|
| AutoGPT `/autogpt_platform/backend` | PolyForm Shield license — reject subtree; keep `/classic` + `/forge` (MIT) |
| AutoGen full repo | Mixed MIT (code) + CC-BY (docs) — scope to `/python/packages/autogen-core` |
| `schema.org` full fork | CC-BY-SA-3.0 reciprocity — vocabulary use OK, fork triggers SA |
| `the-stack-v2` dataset | Per-file license attribution required |
| `github/semantic` | Archived — reference only, not active ingest |
| `EU TED eForms-SDK` | EUPL-1.2 reciprocity — extract data, do not fork library code |
| AutoGPT / BabyAGI (Gemini-reported) | Abandonment signal >0.8 |
| LangChain / LlamaIndex cores | Runtime-dep traps — patterns only |

---

## 6. Notable surprises

- **nibzard/awesome-agentic-patterns** (Gemini, score 0.95) — curated agent-pattern library we didn't know existed; immediately useful as ingestion corpus
- **getzep/graphiti** (claude, 0.96) — only production bi-temporal KG engine; directly solves our `AgentMemory` drift problem at DB level
- **MITRE ATLAS** (Gemini, 0.89) — AI-specific threat matrix (superior to plain ATT&CK for our consulting-security agents)
- **OSCAL** (claude, 0.92) — machine-readable NIST 800-53 + FedRAMP crosswalks unblock automated compliance gap analysis

---

## 7. Systemic gaps (did not fill)

- **Danish public-sector** beyond FDA: no high-value open dataset for procurement intelligence (TED covers EU-wide, but DK-specific tenders need udbud.dk API — not OSS)
- **Financial advisory** beyond FIBO: no high-quality open McKinsey/BCG exec-deck corpus (IP risk — explicitly avoided)
- **Multimodal / voice** agent stacks: outside mission scope; deferred

---

## 8. Verification commands

```bash
# Count per category
curl -s -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"tool":"graph.read_cypher","payload":{"query":"MATCH (ek:ExternalKnowledge)-[:DISCOVERED_BY]->(rm:ResearchMission {id:\"phantom-bom-harvest-gemini-2026-04-12\"}) RETURN ek.category, count(ek) ORDER BY ek.category"}}' \
  $BACKEND/api/mcp/route

# Top 10 by score
curl -s -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"tool":"graph.read_cypher","payload":{"query":"MATCH (ek:ExternalKnowledge)-[:DISCOVERED_BY]->(rm:ResearchMission {id:\"phantom-bom-harvest-gemini-2026-04-12\"}) RETURN ek.name, ek.category, ek.monster_value_score ORDER BY ek.monster_value_score DESC LIMIT 10"}}' \
  $BACKEND/api/mcp/route
```

---

## 9. Caveats for Qwen's Week 3 ingestion

1. **Live-verify licenses** before `agentic_snout_ingest` on each candidate — Claude's 75 came from subagent training knowledge (May 2025 cutoff), not live WebFetch
2. **`dimension_scores` and `osint_flags`** are placeholders on Gemini's 15 — augment or re-run proper OSINT scan if critical
3. **Some URLs may be stale** — 3 candidates flagged "verify repo exists" / "verify URL"
4. **RLM deep-scoring** ran on the top-10 via `rlm_reason` (gemini-flash, domain=Strategy, confidence=0.85) — output aligned with monster_value_score rankings
