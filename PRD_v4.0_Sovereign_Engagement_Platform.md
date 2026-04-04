# PRD: WidgeTDC v4.0 — Sovereign Engagement Platform

**Version:** 1.0 | **Date:** 2026-04-04 | **Author:** 7 Research Agents + Discovery Synthesis
**Status:** Draft | **Linear:** LIN-574 (parent epic)

---

## 1. Executive Summary

Transform WidgeTDC from a self-improving intelligence engine (v3.x) into the **first EU-sovereign consulting engagement platform** with a CaaS marketplace endgame.

**The Vercel Playbook:** Wedge (Sovereign EU trust) → Moat (Engagement Intelligence data flywheel) → Marketplace (CaaS network effects).

v4.0 closes the gap between "internal AI tooling" and "revenue-generating platform" by shipping Engagement Intelligence (Phase 1) and Sovereign EU compliance (Phase 2) — the two prerequisites for CaaS (Phase 3, deferred to v5.0).

**Key insight from research:** No competitor occupies AI-native consulting platform. McKinsey Lilli was breached (46.5M messages, March 2026). EU AI Act enforcement begins August 2026. There is an 18-24 month window.

---

## 2. Problem Statement

### Current State
WidgeTDC v3.2.1 is a powerful internal tool: 448 MCP tools, self-improving RAG, deliverable generation, client similarity. But:

| Pain Point | Current | Target |
|-----------|---------|--------|
| Engagement scoping | 4-8 hours manual per project | <2 hours (50% reduction) |
| Precedent search | "I remember we did something similar..." | AI-powered: "Here are 5 similar past engagements with outcomes" |
| Regulatory compliance | Spreadsheet-based compliance tracking | Graph-backed simulation: "What if NIS2 enforcement changes?" |
| Data sovereignty | Railway EU hosting but no formal compliance story | GDPR-compliant, EU-hosted, contractual guarantees |
| Revenue model | Internal cost center | Platform with external revenue potential |

### Who feels this pain?
1. **Consultants** waste 4-8 hours scoping each new engagement because precedent knowledge is tribal
2. **Partners** cannot confidently price projects because risk/outcome data is scattered
3. **Clients** in regulated sectors (finance, public sector) need EU-sovereign AI but have no options post-Lilli

---

## 3. Goals & Success Metrics

### P0 Goals (Must Ship)
| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-1 | Engagement scoping from precedent | Planning time per engagement | **50% reduction** (4h → 2h) |
| G-2 | Precedent search accuracy | Relevant matches in top-5 | >80% precision |
| G-3 | Dogfood internally | Engagements planned via v4.0 | ≥5 in first quarter |

### P1 Goals (Should Ship)
| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-4 | Regulatory simulation | Impact queries answered | >90% of NIS2/DORA questions |
| G-5 | EU sovereignty story | Marketing-ready compliance documentation | Complete |
| G-6 | EUR-Lex ingestion | EU regulations in graph | >500 regulations |

### P2 Goals (Nice to Have)
| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-7 | First external revenue | Paying customer | 1 within 12 months |
| G-8 | CaaS design doc | Architecture for multi-tenancy | Document complete |

---

## 4. Non-Goals (Explicit Boundaries)

| ID | Non-Goal | Reason |
|----|----------|--------|
| NG-1 | Multi-tenant CaaS marketplace | v5.0 — requires B+C to be battle-tested first |
| NG-2 | Sovereign LLM hosting | Use API providers with EU DPA for now |
| NG-3 | ISO 27001 / SOC 2 certification | Expensive, defer until customer demand justifies |
| NG-4 | Auto-pricing / resource optimization | Phase 1 does scoping, not financial modeling |
| NG-5 | White-label per tenant | CaaS-only feature, defer |
| NG-6 | Mobile app | Web-only platform |

---

## 5. User Personas

### Persona 1: Anna — Senior Consultant (Phase 1 primary)
- **Context:** Plans 3-4 new engagements per quarter, each taking 4-8 hours to scope
- **Pain:** "I know we did something similar for a bank last year but I can't find the deliverables or what risks materialized"
- **v4.0 value:** Engagement Intelligence finds 5 similar past engagements, generates a scoping deck with deliverable sequence, risk register, and timeline — in 30 minutes
- **Success:** Goes from "blank page" to "informed proposal" in <2 hours

### Persona 2: Lars — Compliance Manager (Phase 2 primary)
- **Context:** Tracks NIS2/DORA compliance for 15 client engagements across financial sector
- **Pain:** "When DORA enforcement timelines shift, I have to manually check every client's exposure"
- **v4.0 value:** Regulatory impact simulation: change one parameter, see cascading effects across all engagements
- **Success:** Regulatory impact assessment from 2 days → 2 hours

### Persona 3: CEO/Partner — Revenue Decision-Maker
- **Context:** Evaluating whether to invest in v4.0 or buy off-the-shelf
- **Pain:** "Every consulting AI tool is US-hosted. Post-Lilli, our clients are asking about data sovereignty"
- **v4.0 value:** EU-sovereign consulting AI with graph-backed regulatory intelligence — unique positioning
- **Success:** First customer signed based on sovereignty + engagement intelligence combination

---

## 6. Functional Requirements

### Phase 1: Engagement Intelligence Engine (Q2 2026, 4-6 weeks)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-001 | `:Engagement` node type in Neo4j | MERGE with properties: title, client, industry, scope, duration, budget, status, started_at, completed_at |
| FR-002 | `:Phase` nodes linked to Engagement | `(:Engagement)-[:HAS_PHASE]->(:Phase)` with sequence, duration, deliverables |
| FR-003 | `:Risk` nodes linked to Engagement | `(:Engagement)-[:FACED_RISK]->(:Risk)` with severity, materialized (boolean), mitigation |
| FR-004 | Engagement similarity matching | Extends existing client similarity: match on industry + scope + duration + deliverable types |
| FR-005 | `engagement.plan` MCP tool | Input: client brief (text). Output: proposed phases, deliverables, risks, timeline based on precedent |
| FR-006 | `engagement.create` MCP tool | Create engagement from plan, link to client, assign team |
| FR-007 | `precedent.match` MCP tool | Find top-5 similar past engagements with outcome data |
| FR-008 | `risk.predict` MCP tool | Based on engagement type + industry, predict top-5 likely risks from historical data |
| FR-009 | Scoping deck generation | `generate_deliverable` type: "scoping" that uses engagement plan + precedent |
| FR-010 | Chain engine integration | Engagement planning as a sequential chain: brief → precedent → plan → risk → scoping deck |

### Phase 2: Sovereign EU Regulatory Intelligence (Q3 2026, 6-8 weeks)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-020 | EUR-Lex ingestion cron | Weekly cron fetches new EU regulations via SPARQL, MERGEs as `:Regulation` nodes |
| FR-021 | `:Regulation` node type | Properties: identifier, title, enforcement_date, scope, affected_sectors |
| FR-022 | National transposition tracking | `(:Regulation)-[:TRANSPOSED_BY]->(:NationalLaw)` for DK, SE, NO, FI |
| FR-023 | `regulation.ingest` MCP tool | Manual ingestion of specific regulations |
| FR-024 | `impact.simulate` MCP tool | Input: regulation change. Output: affected clients, engagements, compliance gaps |
| FR-025 | `compliance.score` MCP tool | Score a client/engagement against applicable regulations |
| FR-026 | Regulatory channel in dual-rag.ts | 5th RAG channel for regulatory queries |
| FR-027 | GDPR data subject endpoints | `GET /api/privacy/export`, `DELETE /api/privacy/forget` per data subject |
| FR-028 | Encryption at rest | All Neo4j data, Redis data, and Railway volumes encrypted |
| FR-029 | EU data residency documentation | Formal document: where data lives, who can access, DPA terms |

### Phase 3: CaaS Foundation (Design Only — Implementation in v5.0)

| ID | Requirement | Acceptance Criteria |
|----|------------|-------------------|
| FR-040 | Multi-tenancy design document | Architecture for Neo4j data isolation (label-based vs instance-per-tenant) |
| FR-041 | Billing integration design | Stripe/usage metering architecture |
| FR-042 | Tenant onboarding flow design | Self-service content ingestion UX |

---

## 7. Architecture

### Phase 1: Engagement Intelligence

```
POST /api/engagements/plan  {client_brief: string}
     │
     ▼
┌─────────────────────────────────────────┐
│  Chain Engine — mode: "sequential"       │
│                                          │
│  Step 1: PARSE BRIEF                     │
│    LLM extracts: industry, scope, size   │
│                                          │
│  Step 2: PRECEDENT MATCH                 │
│    similarity-engine + graph traversal    │
│    → top-5 similar past engagements      │
│                                          │
│  Step 3: PLAN GENERATION                 │
│    LLM generates phases + deliverables   │
│    based on precedent patterns           │
│                                          │
│  Step 4: RISK PREDICTION                 │
│    Graph query: what risks materialized  │
│    in similar engagements?               │
│                                          │
│  Step 5: SCOPING DECK                    │
│    deliverable-engine type: "scoping"    │
│    → PDF/markdown with plan + risks      │
└─────────────────────────────────────────┘
     │
     ▼
  { engagement_id, plan, risks, scoping_deck_url }
```

### Neo4j Schema Extension

```
(:Engagement {
  id, title, client_id, industry, scope, duration_weeks,
  budget_range, status, started_at, completed_at
})
-[:HAS_PHASE]-> (:Phase {sequence, name, duration_weeks, deliverables})
-[:FACED_RISK]-> (:Risk {name, severity, materialized, mitigation})
-[:PRODUCED]-> (:Deliverable {type, title})
-[:SERVED]-> (:Client)
-[:SIMILAR_TO]-> (:Engagement)  // computed by similarity engine
-[:REQUIRED_COMPLIANCE]-> (:Regulation)  // Phase 2
```

---

## 8. Implementation Phases

### Phase 1: Engagement Intelligence (Weeks 1-6)

| Week | Task | Output |
|------|------|--------|
| 1 | Neo4j schema: :Engagement, :Phase, :Risk nodes + relationships | Graph schema |
| 2 | `precedent.match` + `engagement.plan` MCP tools | Core tools |
| 3 | `risk.predict` + `engagement.create` tools | Risk engine |
| 4 | Chain pipeline: brief → precedent → plan → risk → deck | E2E pipeline |
| 5 | Scoping deck template + deliverable-engine "scoping" type | Output format |
| 6 | Internal dogfood: plan 3 real engagements, measure time saved | Validation |

**Gate:** 3 engagements planned internally with measurable time savings before Phase 2.

### Phase 2: Sovereign EU Regulatory (Weeks 7-14, overlaps with Phase 1 refinement)

| Week | Task | Output |
|------|------|--------|
| 7-8 | EUR-Lex SPARQL ingestion cron + :Regulation nodes | Regulatory graph |
| 9-10 | `impact.simulate` + `compliance.score` tools | Simulation engine |
| 11-12 | GDPR endpoints + encryption at rest + data residency docs | Compliance layer |
| 13-14 | 5th RAG channel (regulatory) + integration testing | Full stack |

### Phase 3: CaaS Design (Weeks 15-16, design only)

| Week | Task | Output |
|------|------|--------|
| 15 | Multi-tenancy architecture document | Design doc |
| 16 | Billing + onboarding UX design | Design doc |

---

## 9. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Insufficient engagement data for precedent matching | Blocks Phase 1 value | Medium | Seed with 20+ synthetic engagements from historical project data |
| EUR-Lex SPARQL API changes or rate limits | Blocks Phase 2 ingestion | Low | Cache locally, fallback to bulk download |
| Neo4j AuraDB limits for regulatory data volume | Performance | Medium | Dedicated label indexes, pagination |
| Team capacity (1-2 people, 14 weeks) | Scope creep | High | Strict MVP scope, defer CaaS entirely |
| Competitive response from Palantir/Glean | Market | Low (18mo window) | Speed of execution is the moat |
| Mercury/LLM provider outage during engagement planning | UX | Medium | Cascading fallback (Mercury → Groq → Gemini) already built |

---

## 10. Competitive Positioning

### What We Have That Nobody Else Does

| Capability | McKinsey Lilli | Palantir AIP | Glean | WidgeTDC v4.0 |
|-----------|---------------|-------------|-------|---------------|
| Knowledge graph (520K+ nodes) | Internal only | Generic | None | **Yes** |
| Engagement-centric reasoning | No | No | No | **Yes (Phase 1)** |
| EU sovereign hosting | **BREACHED** | US-hosted | US-hosted | **Yes (Phase 2)** |
| Regulatory impact simulation | No | No | No | **Yes (Phase 2)** |
| Self-improving RAG | No | No | No | **Yes (v3.x)** |
| CaaS marketplace | No | No | No | **Planned (v5.0)** |
| Price | Internal only | $500K+ | $50K+ | **<$50/mo** |

### Competitive Window

- **12-18 months** post-Lilli trust vacuum
- **18-24 months** before hyperscaler sovereign clouds mature
- **EU AI Act August 2026** creates mandatory compliance demand
- **No incumbent** in AI-native consulting engagement platform

---

## 11. Success Criteria

### Phase 1 Complete When:
- [ ] 5 engagements planned via v4.0 internally
- [ ] Average scoping time reduced from 4h to <2h (measured)
- [ ] Precedent search returns relevant matches >80% of the time
- [ ] Scoping deck generation works end-to-end

### Phase 2 Complete When:
- [ ] >500 EU regulations in graph
- [ ] Impact simulation answers NIS2/DORA "what-if" queries correctly
- [ ] GDPR data subject endpoints functional
- [ ] EU data residency formally documented

### v4.0 Release When:
- [ ] Phase 1 + Phase 2 complete
- [ ] 102+ E2E tests still passing
- [ ] No P0/P1 security findings
- [ ] Internal feedback: "I would not go back to the old way"

---

## 12. Self-Score (100-point PRD Framework)

| Category | Score | Notes |
|----------|-------|-------|
| **AI-Specific Optimization** | 24/25 | Compound loops, precedent learning, regulatory simulation. Missing: explicit eval dataset. |
| **Traditional PRD Core** | 23/25 | Personas, requirements, phases complete. Missing: stakeholder sign-off. |
| **Implementation Clarity** | 28/30 | Week-by-week plan, gates, schema. Chain pipeline diagram. |
| **Completeness** | 18/20 | Risks, non-goals, competitive matrix. Missing: detailed rollback plan. |
| **Total** | **93/100** | |

---

## 13. Research Sources

This PRD was informed by 7 parallel research agents (2026-04-04):
1. CaaS market + business model — $1-3B TAM, hybrid revenue model, 3-4 month multi-tenancy build
2. Engagement Intelligence analysis — deepest moat (9/10), 70% v3.x reuse, 4-6 weeks
3. Sovereign EU AI moat — 18-24 month window, 20-40% price premium, post-Lilli vacuum
4. Sequencing analysis — B→C→A optimal, each enables the next
5. Competitive window timing — 12-18 month trust vacuum, EU AI Act Aug 2026
6. Technical feasibility — B: 2-3K LoC, C: 2.5-3.5K LoC, A: 4-5.5K LoC
7. ROI + moat scoring — CaaS highest long-term but needs B+C foundation
