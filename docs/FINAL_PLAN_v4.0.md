# 🎯 FINAL PLAN v4.0 — WidgeTDC Value-Props Activation + Frontend Core

**Date:** 2026-04-13
**Supersedes:** `FINAL_PLAN_v3.0.md` (Week 1–5 delivered — foundation complete)
**Principle:** KONSOLIDERING — build on existing primitives, never parallel
**Golden Rule:** Steal IDEER og INDHOLD — aldrig runtime dependencies

---

## 0. Foundation Status (v3.x — COMPLETED)

| Week | Deliverable | Commit | Status |
|------|-------------|--------|--------|
| 1 | 6 Gates auto_materialize.py + regression suite | `5a154822` / `641f270a` | ✅ |
| 2A | Canonical `AgentRequest`/`AgentResponse` contract | widgetdc-contracts PR#19 | ✅ |
| 2B | MemoryConsolidator + `memory_search` + `memory_consolidate` | `500c97d` | ✅ |
| 3 | Document Converter + `IAgent` abstraction | `f1674f7` | ✅ |
| 4 | Runtime Analytics (cost/token/latency) | `4e1809e` | ✅ |
| 5 | Prompts Library + Knowledge ingestion | `21dcd19` | ✅ |
| — | Phantom BOM harvest: 85 `:ExternalKnowledge` sources | `5555d48` | ✅ |

Total: 149 MCP tools, 8-layer memory, RLM + dual-RAG, canonical IAgent contract across 3 repos.

---

## 1. Value-Prop Catalog — 10 use cases (new)

Activated by v4 — 5 direct, 5 minor-tweak. Every use case mapped to existing primitives.

### 1.1 Direct (production-ready today)

| # | Value-Prop | Exposed capability | Primary primitives |
|---|------------|-------------------|--------------------|
| **V1** | AI-Act compliance gap audit (DK consulting) | "Upload klient-stack → få AI-Act Annex III gap-rapport på 5 min" | `kg_rag.query`, `generate_deliverable`, OSCAL + ENISA + EU-AI-Act Phantom BOM sources |
| **V2** | Multi-agent PR code review | "1 PR → 3 reviewer-agenter parallelt med cost-tracking" | `document_convert` (diff), `prompts.search(code)`, `IAgent.process()`, A2A bus, `runtime_summary` |
| **V3** | Cost-attribution per client engagement | "Hvilket engagement brugte hvilken agent — hvor meget kostede det?" | `agent_metrics`, `engagement_*`, Redis 30-day metrics |
| **V4** | Consulting deliverable draft in 3 min | "PDF brief → McKinsey-kvalitets draft deck" | `document_convert`, Phantom BOM (85 sources), RLM reasoning, `generate_deliverable` |
| **V5** | Agent-drift detection via runtime analytics | "Weekly regression flag per agent → auto Linear issue" | `runtime_summary`, `flywheel-coordinator`, `linear.save_issue` |

### 1.2 Minor-tweak (<1 day glue per item)

| # | Value-Prop | Needed tweak |
|---|------------|--------------|
| **V6** | Self-updating SKILL.md corpus | Nightly crawl of 3 awesome-lists → `prompts.ingest` cron |
| **V7** | GraphRAG-Anywhere router | `adaptive_rag_query` → MS GraphRAG / HippoRAG / LightRAG fallback chain |
| **V8** | OSINT-backed pre-engagement due diligence | Wire `run_osint_scan` + MITRE ATLAS into compliance-officer workflow |
| **V9** | Autonomous prompt A/B testing (DSPy pattern) | MIPROv2-lite quality_score loop in `prompt-library.ts` |
| **V10** | Bi-temporal fact graph (Graphiti pattern) | `:Fact` + `:Lesson` get `valid_from/invalid_at`, supersession-chain |

---

## 2. Execution Plan — v4 Weeks 6-9

Same cadence as v3: Qwen builds, Claude QAs, Linear tracks, runbook gets a section per ship.

### Week 6 — Compliance + Cost (V1, V3, V5) — 5 days

**Rationale:** Revenue-bearing direct use cases. V1 unlocks DK consulting pitch. V3 enables pricing accountability. V5 stabilizes agent fleet.

**Deliverables:**
1. `src/compliance/ai-act-auditor.ts` — crosswalk agent: stack JSON → Annex III gap list
2. `src/analytics/engagement-cost-tracker.ts` — roll up `agent_metrics` per engagement_id
3. `src/cron-scheduler.ts` — new `agent-drift-monitor` cron (Monday 07:00 UTC)
4. `apps/backend/src/mcp/tools/valuepropTools.ts` — new MCP tools: `compliance_audit_gap`, `engagement_cost_report`, `agent_drift_report`
5. Runbook §9 — Value-Prop playbooks (one per V1/V3/V5)

**Constraints:**
- V1: NO new node types — use existing `:OSCALControl`, `:ComplianceGap` from Phantom BOM
- V3: MERGE idempotency on `:CostReport` nodes (Gate 2)
- V5: Drift threshold via config (default: 15% success-rate regression)
- AgentResponse wire format on every new tool

**Exit gates:**
- [ ] 3 MCP tools registered + deployed + live probe passes
- [ ] V1 demo: upload sample.json → gap report returned in <10s
- [ ] V3 demo: query metrics for synthetic engagement_id → DKK rollup
- [ ] V5 demo: trigger drift cron manually → Linear issue created
- [ ] 7/7 CI gates, regression tests for each of the 3 new tools
- [ ] Runbook §9 updated with troubleshooting table

### Week 7 — Deliverable Factory + PR Review (V2, V4) — 5 days

**Rationale:** Agent productivity multipliers. V2 replaces manual review. V4 is the headline demo.

**Deliverables:**
1. `src/deliverable/factory.ts` — orchestrator: brief → stages → deck
2. `src/review/multi-agent-reviewer.ts` — A2A fan-out pattern, waits for all 3 verdicts
3. `src/mcp/tools/deliverableTools.ts` — `deliverable_draft`, `pr_review_parallel`
4. PDF output via existing `document_convert` reverse-flow (markdown → PDF via future adapter, stub for now)
5. Runbook §10 — Deliverable Factory playbook with cost expectations

**Constraints:**
- V2: Must NOT break if agent registry < 3 reviewers; fall back to 1 or 2 with warning
- V4: Reasoning bounded by RLM budget (max 5 steps per stage); cite every claim
- Parallel A2A dispatch via `broadcastMessage` with `thread_id = request_id`
- `document_convert` handles all 5 input types (pdf/docx/xlsx/md/html) per Week 3 spec

**Exit gates:**
- [ ] 2 MCP tools live + deploy verified
- [ ] V2 demo: synthetic diff → 3-verdict merged review in <90s
- [ ] V4 demo: 2-page PDF brief → 10-slide draft with citations in <180s
- [ ] Fallback path tested (2 reviewers available)
- [ ] Regression tests with mock RLM responses
- [ ] Runbook §10

### Week 8 — Self-updating Corpus + RAG Router (V6, V7) — 5 days

**Rationale:** Platform flywheel — system gets smarter without human intervention.

**Deliverables:**
1. `src/cron-scheduler.ts` — `skill-corpus-sync` cron (daily 03:00 UTC)
2. `src/rag/adaptive-router.ts` — strategy selector (simple/multi-hop/ppr/community)
3. `src/mcp/tools/ragTools.ts` — `rag_route` tool replaces direct srag/kg_rag calls
4. Migration: existing callers → `rag_route` via facade pattern (non-breaking)
5. Runbook §11 — corpus sync troubleshooting + RAG strategy selection table

**Constraints:**
- V6: MERGE on prompt content hash to prevent duplicate ingestion
- V7: Strategy fallback transparent — caller always gets `AgentResponse`, never raw RAG
- Respect rate limits on external awesome-list repos (GitHub API)
- `search_knowledge` stays canonical entry — `rag_route` dispatches underneath

**Exit gates:**
- [ ] `skill-corpus-sync` cron runs overnight → new prompts visible next day
- [ ] `rag_route` serves 100% of RAG traffic, old callers migrated
- [ ] Strategy latency targets: simple <800ms, multi-hop <3000ms, community <8000ms
- [ ] Regression tests for each strategy
- [ ] Runbook §11

### Week 9 — OSINT Due-Diligence + Self-Improving Prompts + Bi-temporal (V8, V9, V10) — 5 days

**Rationale:** Capstone. V10 unlocks full audit replay. V9 turns prompt library into living system. V8 makes consulting defensible.

**Deliverables:**
1. `src/compliance/pre-engagement.ts` — glue: OSINT + ATLAS + compliance-officer
2. `src/prompts/quality-loop.ts` — MIPROv2-lite: promote top quality_score per category weekly
3. Cypher migration: add `valid_from, invalid_at` to all `:Fact` and `:Lesson` nodes
4. `src/memory/bitemporal-facts.ts` — helper: supersede-with-chain writes
5. Runbook §12 — bitemporal query patterns + OSINT scope ethics

**Constraints:**
- V8: OSINT scan targets must be whitelisted (no fishing expeditions); log all scans to `:OSINTScan` node
- V9: `quality_score` updates are DSPy-style compile-time, NOT hot-path
- V10: Migration must backfill `valid_from = createdAt` for existing nodes; no data loss
- Full audit trail: supersession creates new node + edge, never DELETE

**Exit gates:**
- [ ] V8 demo: new client domain → scan → ATLAS crosswalk → memo
- [ ] V9 demo: promoted prompt has measurably higher success_rate vs baseline
- [ ] V10 demo: query `MATCH (f:Fact) WHERE f.valid_from <= date('2026-03-01') AND (f.invalid_at IS NULL OR f.invalid_at > date('2026-03-01'))`
- [ ] Migration verified on AuraDB, no node count regression
- [ ] 7/7 CI + regression tests + runbook §12

---

## 3. Value-Prop → Primitive Dependency Matrix

```
         V1   V2   V3   V4   V5   V6   V7   V8   V9   V10
Wk1-5    ═    ═    ═    ═    ═    ═    ═    ═    ═    ═
IAgent                 ✓    ✓              ✓    ✓    
doc_conv       ✓         ✓              ✓    ✓         
memory_*                                                 ✓
analytics              ✓         ✓                     
prompts              ✓    ✓         ✓                   ✓
Phantom-BOM  ✓         ✓         ✓    ✓    ✓         ✓
RLM          ✓         ✓                                   
A2A              ✓                                           
SRAG/KG-RAG  ✓         ✓         ✓    ✓                   
Flywheel                         ✓                            
```

Every value-prop leverages ≥2 primitives delivered in Week 1-5. Zero greenfield infrastructure.

---

## 4. Handoff Protocol (unchanged from v3)

1. **Qwen builds** — same structure: deliverable table + constraints + Neo4j Episode
2. **Claude QA** — code read + live probe + schema compliance + regression test verification
3. **P0/P1 fixes same session**, P2/P3 → Linear backlog
4. **Deploy verify** — tool count + live probe + Railway uptime
5. **Runbook update committed** with deliverable PR — not separate
6. **Episode `phantom-qa-w{N}-2026-04-XX-claude`** persisted with outcome + lessons

---

## 5. Risk register

| Risk | Mitigation |
|------|-----------|
| V4 RLM cost explosion on large briefs | Fold context → max 2000 tokens before reasoning; hard cost cap 5 DKK/run |
| V10 bi-temporal migration locks AuraDB | Batch via `CALL { ... } IN TRANSACTIONS`, non-business hours |
| V6 awesome-list crawler blocked by GitHub rate limit | Use GraphQL API with retry + backoff; cache `last_commit_sha` per repo |
| V8 OSINT ethics/legal exposure | Whitelist + signed engagement contract before scan; log scope |
| V5 drift false positives on low-volume agents | Require ≥20 requests/week before drift eligibility |

---

## 6. Timeline

| Week | Focus | Owner | Value-Props |
|------|-------|-------|-------------|
| 6 | Compliance + Cost | Qwen builds, Claude QA | V1, V3, V5 |
| 7 | Deliverable Factory + Review | Qwen + Claude QA | V2, V4 |
| 8 | Self-updating corpus + RAG router | Qwen + Claude QA | V6, V7 |
| 9 | OSINT DD + prompt loop + bi-temporal | Qwen + Claude QA | V8, V9, V10 |
| 10-12 | **Frontend Core** — see `FRONTEND_CORE_PLAN.md` | Qwen frontend + Claude QA | UI for V1-V10 |
| 13-14 | **Mission Control** — cc-v4 as operator cockpit | Qwen frontend + backend (session.* tools) + Claude QA | O1-O10 operator actions, CLI session visibility (Claude/Qwen/Gemini) |

---

## 7. Success Metrics

| Metric | Target after Week 9 |
|--------|--------------------|
| MCP tool count | 149 → ~165 (+10 value-prop tools, +6 sub-tools) |
| Agent fleet success_rate (avg, weekly) | >82% (vs Week-5 baseline) |
| Average cost per deliverable (V4) | <15 DKK |
| V1 gap audit latency (p50) | <10 s |
| Bi-temporal migration loss | 0 nodes |
| Runbook sections | 8 → 12 |

---

## 7.5 Adoption Layer — coordination, pheromones, RAG, folding, OODA, teacher/student

**Important:** v4 value-props (V1–V10) must explicitly wire into the existing
coordination substrate, not build parallel primitives. See
**[`ADOPTION_LAYER_v4.md`](ADOPTION_LAYER_v4.md)** for the full spec.

Summary of the 8 non-negotiables every v4 tool must satisfy:

1. **Claim** before work (`:AgentMemory {type:'claim'}`), **close** after
2. **Sense pheromones** before routing, **deposit** after outcome
3. **Route through RAG** (SRAG / KG-RAG / autonomous.graphrag) for evidence —
   never raw LLM calls
4. **Fold context** when input or intermediate buffer >2000 tokens
5. **OODA via Loop Orchestrator** — no inline `while`/`for` around LLM calls
6. **`audit.lessons`** at tool boot + **`audit.run`** on major outputs
7. **Adoption telemetry** (auto — inherited from existing tool-executor wrapper)
8. **Peer-eval** on quality-sensitive output (V1, V4, V8)

Retrofit into current plan:

- **Week 6.5** (2 days) — coordination patch for V1/V3/V5 (already shipped)
- **Week 8.5** (2 days) — coordination patch for V2/V4
- **Week 8 + 9** — adoption baked in inline (normative exit gates)
- **Week 10–14 frontend** — 3 new UI primitives (`ClaimBanner`, `PheromoneStrip`,
  `LessonChain`) + adoption widgets on existing routes

See ADOPTION_LAYER_v4.md §3, §4, §6 for week-by-week detail and QA checklist.

---

## 8. Decision point before Week 10

After Week 9 sign-off, evaluate:
- Frontend scope confirm / adjust (FRONTEND_CORE_PLAN.md)
- Pricing packaging for V1-V10 (go-to-market prep)
- Open issue: drift-detection false-positive rate in production

No new value-props added without displacing one — scope is locked.
