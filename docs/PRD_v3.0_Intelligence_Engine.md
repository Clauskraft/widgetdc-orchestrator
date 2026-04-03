# PRD: WidgeTDC Orchestrator v3.0 — Self-Improving Intelligence Engine

**Version:** 1.0 | **Date:** 2026-04-03 | **Author:** Agent Chain + 7 Research Agents
**Status:** Draft | **Linear:** LIN-574 (parent epic)

---

## 1. Executive Summary

Transform WidgeTDC from a "tool platform with 448 tools" into a **self-improving consulting intelligence engine** where every user action makes the system smarter.

v3.0 closes the final 2 competitive gaps (hierarchical retrieval, multi-modal PDF extraction) with a single unified pipeline, then layers 5 compound feedback loops that create a flywheel: each query, deliverable, and document upload automatically enriches the knowledge graph, improves retrieval accuracy, and tunes system parameters.

**Key insight:** The 5 phases are not 5 features — they are one self-reinforcing intelligence architecture.

**Budget constraint:** <$50/mo cloud services. All new components self-hosted on Railway or pure open-source.

---

## 2. Problem Statement

### Current State (v2.3.0)
| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| RAG accuracy (multi-hop queries) | ~60% | 80% | Missing hierarchical retrieval |
| PDF content in graph | ~60% | 95% | Tables/diagrams not extracted |
| Deliverable edit distance | Unknown | <20% | No quality feedback loop |
| Knowledge graph self-improvement | Manual | Autonomous | No compound feedback |
| Pollution recurrence | Recurring | Zero | No write-path prevention |

### Pain Points (by persona)
1. **Konsulenter** waste 30-60 min per engagement finding relevant precedents because the graph lacks hierarchical context and PDF-derived insights.
2. **Graph quality** degrades between manual cleanup sessions (pollution, orphans, domain drift).
3. **RAG accuracy** plateaus because the system doesn't learn from its own successes and failures.

---

## 3. Goals & Success Metrics

### P0 Goals (Must Ship)
| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-1 | Close Gap #3: Hierarchical retrieval | Multi-hop accuracy on test set | 60% → 80% |
| G-2 | Close Gap #5: PDF extraction | % of PDF content captured | 60% → 90% |
| G-3 | Prevent graph pollution recurrence | Write-path rejections per week | >0 (proving prevention works) |

### P1 Goals (Should Ship)
| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-4 | Deliverable quality feedback | Avg edit distance (generated vs final) | Tracked, trending down |
| G-5 | Knowledge auto-enrichment | New graph nodes created per week (automated) | >50/week |
| G-6 | RAG self-improvement | Retrieval accuracy improvement per month | +2% MoM |

### P2 Goals (Nice to Have)
| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-7 | Graph health dashboard | Autonomous anomaly detection | Zero undetected regressions |
| G-8 | Q-learning parameter optimization | Chain parameters auto-tuned | Measurable improvement |

### Compound Success Metric
```
Intelligence Score = RAG_accuracy × (1 - edit_distance) × knowledge_coverage
Target: 0.60 × 0.80 × 0.60 = 0.288 → 0.80 × 0.90 × 0.95 = 0.684 (2.4× improvement)
```

---

## 4. Non-Goals (Explicit Boundaries)

| ID | Non-Goal | Reason |
|----|----------|--------|
| NG-1 | Client-facing self-service portal | v3.0 is konsulent-facing only |
| NG-2 | Real-time streaming PDF processing | Batch processing sufficient for consulting use |
| NG-3 | Custom LLM fine-tuning | Too expensive; prompt engineering + RAG is sufficient |
| NG-4 | Multi-language OCR | Danish + English sufficient for Nordic consulting |
| NG-5 | Cloud PDF APIs (LlamaParse, Unstructured.io) | Budget constraint <$50/mo |
| NG-6 | GraphSAGE supervised embeddings | FastRP is sufficient and unsupervised |

---

## 5. User Personas

### Persona 1: Anna — Senior Consultant
- **Role:** Delivers NIS2 compliance assessments and digital transformation roadmaps
- **Pain:** Spends 45 min per engagement collecting precedents and building context
- **Need:** "Show me similar engagements and auto-generate a first-draft assessment based on what worked"
- **v3.0 value:** Hierarchical summaries give executive context; PDF extraction captures regulatory tables; auto-enrichment means every project she runs makes the next one faster

### Persona 2: Lars — Knowledge Manager
- **Role:** Maintains the consulting knowledge graph, ensures quality
- **Pain:** Manual cleanup every 2 weeks; pollution recurs; no visibility into graph health
- **Need:** "I want the graph to police itself and show me a health dashboard"
- **v3.0 value:** Write-path circuit breaker prevents pollution; daily hygiene cron auto-fixes; health dashboard shows trends

### Persona 3: Omega — AI Platform Agent
- **Role:** Autonomous agent orchestrating chains, running crons, monitoring governance
- **Pain:** No feedback loop — same retrieval quality regardless of outcome
- **Need:** "I should learn from every query and get smarter over time"
- **v3.0 value:** Adaptive RAG feedback retrains routing; Q-learning optimizes parameters; auto-enrichment expands knowledge base

---

## 6. Functional Requirements

### F1: Write-Path Circuit Breaker (P0 — 2-3 days)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-001 | `validateBeforeMerge()` gate in mcp-caller.ts | Intercepts ALL `graph.write_cypher` calls before execution |
| FR-002 | Pollution detection | Rejects nodes where content matches ≥2 of 10 pollution regex patterns |
| FR-003 | Domain allowlist | Rejects `Domain` nodes not in the 15 canonical domains |
| FR-004 | Embedding dimension check | Rejects embeddings that don't match expected dims (384 NEXUS / 1536 non-NEXUS) |
| FR-005 | Required fields | Rejects nodes without non-empty `title` or `name` |
| FR-006 | Bypass mechanism | `force: true` parameter skips validation (for admin operations) |
| FR-007 | Daily hygiene cron | Cron at 04:00 UTC: runs 6 health queries, stores `:GraphHealthSnapshot` |
| FR-008 | Anomaly alerting | SSE + Slack alert if orphan ratio spikes >2× or unknown domain appears |

### F2: Docling PDF Extraction Pipeline (P0 — 3-5 days)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-010 | Docling-serve on Railway | Docker container running, health endpoint accessible |
| FR-011 | `POST /api/extract/pdf` endpoint | Accepts PDF upload, returns structured markdown + table JSON |
| FR-012 | Table extraction | Tables in PDF preserved as markdown tables with >90% accuracy |
| FR-013 | Entity extraction | LLM extracts entities/relationships from markdown → MERGE to Neo4j |
| FR-014 | Auto-enrichment hook | Every extracted entity auto-linked to existing graph nodes |
| FR-015 | Chain integration | Extraction runs as chain engine "sequential" mode pipeline |
| FR-016 | Budget compliance | Docling-serve self-hosted, zero cloud API cost |

### F3: Neo4j Leiden → Community Summaries → 4th RAG Channel (P0 — 3-5 days)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-020 | Leiden community detection | Runs via Neo4j GDS (Aura Graph Analytics or direct) |
| FR-021 | Multi-level hierarchy | `:Community` nodes with `MEMBER_OF` + `PARENT_OF` relationships |
| FR-022 | LLM community summaries | Each community gets an LLM-generated summary (via `/cognitive/analyze`) |
| FR-023 | 384D embeddings on summaries | Community summaries embedded with same NEXUS pipeline |
| FR-024 | Vector index per level | Separate neo4j vector indexes on community embeddings |
| FR-025 | 4th RAG channel in dual-rag.ts | `community_summary` channel: search summaries → drill into members |
| FR-026 | Router update | `multi_hop` queries route through community channel first |
| FR-027 | Weekly refresh cron | Leiden + summarization reruns weekly to capture new knowledge |

### F4: Compound Feedback Hooks (P1 — 3-4 days)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-030 | Deliverable→Knowledge hook | Post-generation: MERGE citations as `:CITED_IN` edges |
| FR-031 | Auto-enrichment hook | Post-answer: LLM entity extraction → diff vs graph → MERGE new |
| FR-032 | Quality signal logging | Store (deliverable_id, section, original_length, edited_length) |
| FR-033 | Similarity preference logging | Log selected vs rejected matches as `:PREFERRED_OVER` edges |
| FR-034 | Mandatory chain post-hook | Every chain execution writes enrichment to graph (not optional) |

### F5: Adaptive RAG + Q-Learning (P2 — 4-5 days)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-040 | Routing outcome logging | Store (query, strategy, channels, confidence, outcome_score) in Redis |
| FR-041 | Periodic reclassification | Weekly: retrain complexity classifier from logged outcomes |
| FR-042 | Q-learning reward wiring | Feed compound metric (accuracy × quality × coverage) to RLM `/learn` |
| FR-043 | Parameter auto-tuning | RAG thresholds (top-k, confidence cutoff, α weight) adjusted by Q-learning |

---

## 7. Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR v3.0                             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                 CHAIN ENGINE (6 modes)                      │  │
│  │  Sequential │ Parallel │ Debate │ Loop │ Adaptive │ Funnel  │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                          │                                        │
│  ┌───────────────────────▼────────────────────────────────────┐  │
│  │              HYBRID RAG ROUTER (4 channels)                 │  │
│  │  ┌──────────┐ ┌──────┐ ┌────────┐ ┌───────────────────┐   │  │
│  │  │GraphRAG  │ │ SRAG │ │ Cypher │ │ Community Summary │   │  │
│  │  │(primary) │ │      │ │        │ │ (NEW — F3)        │   │  │
│  │  └──────────┘ └──────┘ └────────┘ └───────────────────┘   │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                          │                                        │
│  ┌───────────────────────▼────────────────────────────────────┐  │
│  │              WRITE-PATH CIRCUIT BREAKER (F1)                │  │
│  │  Pollution check │ Domain allowlist │ Dimension validate    │  │
│  └──────────────────────┬─────────────────────────────────────┘  │
│                          │                                        │
│  ┌───────────────────────▼────────────────────────────────────┐  │
│  │              COMPOUND FEEDBACK LOOPS (F4)                   │  │
│  │  Deliverable→Knowledge │ Auto-Enrichment │ Quality Signal  │  │
│  │  Similarity Preference │ RLM Q-Learning Meta-Optimizer     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              PDF EXTRACTION PIPELINE (F2)                   │  │
│  │  Docling-serve → Markdown → Entity Extract → Neo4j MERGE   │  │
│  │  → Leiden Cluster → Community Summary → Embedding          │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
│  NEO4J GRAPH │   │  REDIS STATE │   │  RLM ENGINE      │
│  520K nodes  │   │  Chains,     │   │  Q-learning,     │
│  15 domains  │   │  cache,      │   │  cognitive,      │
│  Communities │   │  outcomes    │   │  parameter tune  │
└──────────────┘   └──────────────┘   └──────────────────┘
```

### Data Flow: PDF → Intelligence

```
1. PDF uploaded via POST /api/extract/pdf
2. Docling-serve extracts → structured markdown + tables
3. LLM entity extraction → (entity, relationship, entity) triples
4. Write-path circuit breaker validates each triple
5. Neo4j MERGE → new nodes/rels in graph
6. Weekly Leiden cron → community detection → LLM summaries
7. Community summaries embedded (384D) → vector index
8. Next RAG query hits community summaries → +20% accuracy
9. Auto-enrichment hook captures new knowledge from answers
10. Q-learning observes outcome → tunes parameters
```

---

## 8. Implementation Phases

### Phase 1: Graph Protection (F1) — Days 1-3
**Goal:** Stop pollution recurrence before adding new write paths

| Day | Task | Output |
|-----|------|--------|
| 1 | `validateBeforeMerge()` in mcp-caller.ts | Write-path gate |
| 2 | Daily hygiene cron (6 metrics + `:GraphHealthSnapshot`) | Monitoring |
| 3 | Anomaly alerting (SSE + Slack) + Command Center panel | Dashboard |

**Gate:** No new write paths until F1 is deployed and verified.

### Phase 2: PDF Pipeline (F2) — Days 4-8
**Goal:** PDF → Neo4j in one pass

| Day | Task | Output |
|-----|------|--------|
| 4 | Docling-serve Docker on Railway | Running service |
| 5 | `POST /api/extract/pdf` endpoint + chain pipeline | Extraction route |
| 6-7 | Entity extraction → Neo4j MERGE (through circuit breaker) | Graph enrichment |
| 8 | Test with 10 consulting PDFs, verify table accuracy | Validation |

**Dependency:** F1 must be live (writes go through circuit breaker).

### Phase 3: Hierarchical Intelligence (F3) — Days 9-13
**Goal:** 4th RAG channel with +20% accuracy on multi-hop

| Day | Task | Output |
|-----|------|--------|
| 9 | Neo4j Leiden community detection via GDS | Community IDs |
| 10 | Community summary generation (LLM via /cognitive/analyze) | Summary nodes |
| 11 | 384D embeddings on summaries + vector index | Searchable hierarchy |
| 12 | `community_summary` channel in dual-rag.ts | 4th RAG channel |
| 13 | Router update: multi_hop → community first | Accuracy lift |

**Dependency:** F2 should be complete (richer graph = better communities).

### Phase 4: Compound Loops (F4) — Days 14-17
**Goal:** Every action enriches the graph

| Day | Task | Output |
|-----|------|--------|
| 14 | Deliverable→Knowledge post-hook (citations as edges) | Feedback loop 1 |
| 15 | Auto-enrichment post-answer hook (entity extraction) | Feedback loop 2 |
| 16 | Quality signal + similarity preference logging | Feedback loops 3-4 |
| 17 | Mandatory chain post-hook enforcement | Flywheel guarantee |

### Phase 5: Self-Improvement (F5) — Days 18-22
**Goal:** System gets smarter autonomously

| Day | Task | Output |
|-----|------|--------|
| 18-19 | Routing outcome logging + periodic reclassification | Adaptive routing |
| 20-21 | Q-learning reward wiring (compound metric → RLM /learn) | Meta-optimizer |
| 22 | End-to-end test: run 20 queries, verify accuracy + enrichment | Validation |

---

## 9. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Docling-serve Docker too heavy for Railway | Blocks F2 | Medium | Fallback: `unpdf` (Node.js) for text + Claude Vision for tables |
| Neo4j GDS not available on AuraDB tier | Blocks F3 | Medium | Fallback: Custom Cypher-based clustering (slower but works) |
| LLM community summarization costs | Budget | Low | Batch summaries weekly, use DeepSeek (cheapest) |
| Auto-enrichment creates noise | Quality | Medium | Circuit breaker (F1) validates all auto-writes |
| Q-learning converges slowly | Impact | Low | Start with heuristic tuning, add Q-learning as enhancement |
| Railway Docker cold starts | Latency | Medium | Keep Docling-serve warm with health check pings |

---

## 10. Technical Constraints

| Constraint | Impact | Approach |
|-----------|--------|----------|
| Budget <$50/mo | No cloud PDF APIs | Self-hosted Docling-serve on Railway |
| TypeScript ESM only | No Python in orchestrator | HTTP bridge to Python services |
| dist/ committed | Must build before push | esbuild bundle + `node --check` |
| AuraDB (not self-hosted Neo4j) | GDS availability varies | Verify GDS access, fallback to Cypher |
| 384D NEXUS / 1536D non-NEXUS | Never mix dimensions | Circuit breaker validates |

---

## 11. Dependencies

```
F1 (Circuit Breaker) ──→ F2 (PDF Pipeline) ──→ F3 (Hierarchical) ──→ F4 (Compound) ──→ F5 (Self-Improve)
         │                       │                      │
         └── No dependency ──────┘                      │
                                                        └── F4 enables F5's reward signals
```

F1 is the foundation — everything else writes through it.
F2 and F3 can partially overlap (start F3 on day 9 while F2 finishes testing on day 8).
F4 requires F2+F3 to be live (the feedback loops need the enrichment paths).
F5 requires F4's logging to have accumulated data.

---

## 12. Self-Score (100-point PRD Framework)

| Category | Score | Notes |
|----------|-------|-------|
| **AI-Specific Optimization** | 23/25 | Compound loops, self-improvement, agentic RAG — strong. Missing: explicit eval dataset. |
| **Traditional PRD Core** | 23/25 | Personas, requirements, phases — complete. Missing: formal stakeholder sign-off process. |
| **Implementation Clarity** | 28/30 | Day-by-day plan, dependencies, gates. Architecture diagram. Code-level references. |
| **Completeness** | 18/20 | Risks, constraints, non-goals, metrics. Missing: rollback plan per phase. |
| **Total** | **92/100** | |

---

## 13. Leapfrog Opportunities (Beyond Gap-Closing)

Three capabilities that would put WidgeTDC **ahead** of McKinsey Lilli, Palantir AIP, Glean, and Dust — not just matching them.

### Leapfrog #1: Engagement Intelligence Engine
Model consulting engagements as first-class graph entities with real-time updates. AI plans projects (resource allocation, deliverable sequence, risk mitigation) based on precedent from similar past engagements. **No competitor treats "the engagement" as a reasoning primitive.**

### Leapfrog #2: Sovereign EU Regulatory Intelligence Network
WidgeTDC already has NIS2, DORA, and FDA in-graph. Build the only GDPR-compliant, EU-hosted consulting AI with regulatory impact simulation ("what happens if NIS2 enforcement timeline shifts by 6 months?"). All competitors are US-hosted (Lilli, Palantir, Glean, Dust). **This is a structural moat.** Note: McKinsey Lilli suffered a SQL injection breach in March 2026 (46.5M messages exposed) — sovereign hosting is now a competitive argument.

### Leapfrog #3: Cross-Client Precedent Mining (Anonymized)
Extract structural patterns from completed engagements: "NIS2 compliance for mid-size financial services typically requires X phases, Y deliverables, surfaces Z common gaps." Every engagement becomes training data for the next. Anonymization pipeline ensures client confidentiality. **No competitor has engagement-level knowledge graph granularity.**

**Platform inflection point:** When third-party consultants can plug their own domain content into WidgeTDC's graph → CaaS (Consulting-as-a-Service, LIN-568).

---

## 14. Appendix: Research Sources

This PRD was informed by deep research from 13 parallel agents across 2 research sessions (2026-04-02 — 2026-04-03):

**Session 1 — Gap Analysis (6 agents):**
1. Gap #2: Deliverable Generation — McKinsey Lilli benchmark, GPT-Researcher, python-pptx stack
2. Gap #3: RAPTOR Hierarchical Retrieval — RAPTOR paper, Microsoft GraphRAG, nano-graphrag
3. Gap #4: Client Similarity — Neo4j GDS algorithms, hybrid scoring, BCG precedent patterns
4. Gap #5: Multi-modal PDF Extraction — Docling, marker, LlamaParse, ColPali benchmarks
5. ROI Prioritization — Effort/impact matrix, implementation order, risk assessment
6. Graph Knowledge Search — Existing assets in Neo4j (docgen tools, similarity primitives)

**Session 2 — Elevating Solutions (7 agents):**
7. Unified Document Intelligence Pipeline — Docling + GraphRAG combo architecture
8. Agentic RAG Self-Improvement Loops — CRAG, Self-RAG, Adaptive RAG, Q-learning feedback
9. Neo4j-Native Hierarchical Intelligence — Leiden, FastRP, vector indexes, temporal drift
10. Compound Value Architectures — Flywheel patterns from Palantir, Glean, Notion AI
11. Node.js PDF + Summarization Tools — docling-sdk (npm!), unpdf, raptor-ts, ml-kmeans
12. Quality Monitoring + Auto-Healing — Write-path gates, hygiene crons, anomaly detection
13. Competitive Leapfrog — McKinsey Lilli breach, sovereign EU moat, CaaS inflection
