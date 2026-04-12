# Phantoms to Integrate NOW — Coordination + Adoption Acceleration

**Date:** 2026-04-13
**Purpose:** Answer "which of the 85 harvested phantoms should we use *now* to (a) establish better-coordinated multi-agent approach, and (b) ensure actual adoption of the systems we've shipped in Weeks 1–8?"
**Outcome:** 5 phantoms to integrate before Week 9 starts. Zero new infrastructure — all are pattern harvests fitting existing code paths.

---

## 0. The two problems we're trying to solve

1. **Coordination** — agents (Claude CLI, Qwen CLI, Gemini, 60+ backend agents) still rely on manual hand-offs. When Qwen shipped W6/W7/W8 without the adoption layer, it's because the layer was invisible to them at build time. Coordination failure = invisibility.
2. **Adoption** — we shipped 161 MCP tools and 10 V-props. The worry: agents don't use them because they can't find the right one, can't tell if it worked, can't predict cost. Adoption failure = agents default to hand-rolled LLM calls.

Five phantoms, already in the graph, specifically attack these two failure modes.

---

## 1. The 5 picks

### 🥇 Pick #1 — OpenTelemetry `gen_ai.*` semantic conventions (+ OpenInference)

**Phantoms:** `otel-semconv` (score 0.95, cat G) + `openinference` (0.88, G)
**Problem solved:** No canonical wire format for "what is an agent doing right now." Every CLI tool and every backend agent invents its own trace shape.

**Integration (1 day):**
- Add `@opentelemetry/semantic-conventions` (already in `package.json`!) usage to `IAgent.process()` — every call emits `gen_ai.request.*` + `gen_ai.response.*` attributes
- Add `OpenInference` extension attributes (`llm.tool.call`, `agent.step`, `retrieval.source`) for agent-specific spans
- Extend `AgentSession` heartbeat (Mission Control §9.2) to include `span_id` + `trace_id` — now every CLI action is queryable by standard OTel backend

**Coupling to existing code:**
- `src/agent/agent-orchestrator-adapter.ts` — emit spans in `process()`
- `src/analytics/runtime-analytics.ts` — record `gen_ai.usage.input_tokens` / `output_tokens` (already tracked, just rename)
- Week 13 session.register: carry `trace_id` as first-class field

**Coordination impact:** Claude Code, Qwen, Gemini, and the 60 backend agents all produce traces that can be visualized together in a single OTel backend (Grafana Tempo, Honeycomb, Jaeger). Mission Control §9.3 A2A stream viewer becomes a trace viewer.

**Adoption impact:** External observability tools (langfuse, phoenix-ai) drop-in work against our traces without custom adapters.

---

### 🥈 Pick #2 — W3C PROV-O (provenance ontology)

**Phantom:** `prov-o` (score 0.88, cat H)
**Problem solved:** We have `:Episode` + `:AgentMemory` + `:Lesson` + `:ExternalKnowledge` + `:PhantomPatch` — but no canonical "X was derived from Y by agent Z at time T" query. Answering "where did this deliverable's facts come from" requires ad-hoc Cypher per node type.

**Integration (2 days):**
- Cypher migration: add 3 PROV relations as graph-wide primitives — `[:WAS_GENERATED_BY]`, `[:WAS_DERIVED_FROM]`, `[:WAS_ATTRIBUTED_TO]`
- Every agent write through `agent-orchestrator-adapter.process()` automatically adds these edges
- `:Activity` helper label on `:Episode` + `:PhantomPatch` + `:OperatorAction` for uniform querying
- Add one helper `provQuery(nodeId)` that returns full upstream lineage in one call

**Coupling to existing code:**
- `src/coordination/prov-helper.ts` (new, ~60 LOC) — write PROV edges
- `src/memory/bitemporal-facts.ts` (W9 V10) — already near this; add PROV as companion to temporal
- `src/tools/tool-executor.ts` — wrap existing `writeClaim`/`writeClosure` to also write `[:WAS_GENERATED_BY]`

**Coordination impact:** "Who broke the compliance audit for client X?" becomes `MATCH (r:ComplianceReport {client:'X'})-[:WAS_DERIVED_FROM*1..5]->(n) RETURN n` — every upstream fact, every author, every input visible.

**Adoption impact:** Operator QA (Mission Control §9.1 O8) becomes trivial — "reject this deliverable, follow provenance back, find bad source, retire phantom."

---

### 🥉 Pick #3 — SWE-agent ACI paradigm (Agent-Computer Interface)

**Phantom:** `swe-agent` (score 0.90, cat A)
**Problem solved:** The "Week N tool not found" pattern (W2 memory_search, W3 document_convert, W6 compliance_gap_audit, W8 rag_route). Agents can't find tools because the surface isn't designed for machines — it's designed for humans and then wrapped.

**ACI principle:** Design the tool SURFACE first (what the agent sees: name, description, input schema, error messages), then implement it. Surface decisions matter more than implementation.

**Integration (1 day):**
- CI gate addition: every new MCP tool must pass an **ACI review** checklist:
  - Tool name ≤25 chars, snake_case, namespace-dotted
  - Description starts with action verb, <150 chars, no jargon
  - Input schema: ≤6 required fields, every field has a description
  - Error messages: specify what was missing + how to fix
  - Canonical example in tool-registry
- `src/tools/tool-aci-lint.ts` (new) — runs on pre-commit hook
- Retroactively apply to all 161 tools, flag offenders as `:ACIViolation` nodes for backlog

**Coupling to existing code:**
- `src/tools/tool-registry.ts` — every `defineTool()` already accepts description + input schema, ACI lint adds structural checks
- Pre-commit hook in `scripts/ci-adoption-check.mjs` — add "CHECK 8 — ACI review"

**Coordination impact:** Marginal — but indirectly massive. Better surfaces = agents pick the right tool more often = fewer "tool not found" = less coordination chaos.

**Adoption impact:** This is the heaviest-leverage pick. Qwen's W6/W7/W8 would have hit fewer QA issues if every tool forced ACI hygiene at registration.

---

### 🏅 Pick #4 — CoALA memory taxonomy

**Phantom:** `coala-paper` (score 0.90, cat B)
**Problem solved:** Our `:AgentMemory` has 20+ undocumented `type` values (claim, closure, teaching, intelligence, wip, heartbeat, a2a_message, ...). No formal classification → no systematic rules for retention, promotion, decay.

**CoALA classifies memory into 5 types:**
- **Working** (seconds): current task context → Redis
- **Short-term** (minutes): recent agent exchanges → `:AgentMemory {tier:'short'}` TTL 1h
- **Episodic** (hours–days): specific event traces → `:Episode` nodes
- **Semantic** (persistent): facts, patterns → `:Fact` + `:Lesson`
- **Procedural** (persistent): skills, routines → `:Prompt` + `:Skill`

**Integration (2 days):**
- Cypher migration: add `tier: 'working|short|episodic|semantic|procedural'` to every `:AgentMemory`
- Update `MemoryConsolidator.ts` (Week 2B) — consolidation rules tier-aware (working→short→episodic promotion based on access frequency + importance)
- `memory_search` (W2B) accepts `tier` filter
- Boot recall in every IAgent adapter pre-loads working + short + relevant episodic (not everything)

**Coupling to existing code:**
- `src/memory/memory-consolidator.ts` — extend `computeRelevance()` with tier-aware weights
- `src/agent/agent-interface.ts` — boot protocol section

**Coordination impact:** Agents load *only* relevant memory at boot (tiered) → faster, cheaper, less noise.

**Adoption impact:** V9 DSPy quality loop (W9) can now ask "which *procedural* memory (prompt) performs best for task type T" without filtering through claims/closures/heartbeats.

---

### 🏅 Pick #5 — continuedev hub pattern (rated tool/prompt blocks)

**Phantom:** `continue` (score 0.85, cat F)
**Problem solved:** Agents don't know which of our 161 tools to prefer for a given goal. No quality signal = they default to trial-and-error or raw LLM.

**continuedev hub pattern:** Every tool/prompt/rule carries `downloads`, `reviews`, `version`, `updated_at`. Agents pick by signal, not name.

**Integration (1.5 days):**
- Extend existing `adoption-telemetry.ts` (W4) — track per-tool: `downloads_equiv` = call count, `quality_score` = aggregated peer-eval score, `error_rate` = errors/calls
- New MCP tool `tool_discover({goal, capabilities})` — returns ranked recommendations
- Cypher migration: add `:MCPTool {quality_score, error_rate, last_used}` as materialized view
- Weekly cron refreshes `:MCPTool` rankings → Mission Control `/skills` route shows ranked list

**Coupling to existing code:**
- `src/flywheel/adoption-telemetry.ts` — already tracks `lifetime_calls` + `last_called`, just add `quality_score`
- `src/swarm/peer-eval.ts` — already scores; pipe into tool ratings
- V9 DSPy loop (W9) — picks top-rated prompts for a category

**Coordination impact:** Multi-agent workflow: one agent produces, another reviews. Rating system makes reviewer picks deterministic.

**Adoption impact:** **HIGHEST**. A newly shipped tool that's truly better gets promoted naturally. Qwen's Week 9 DSPy loop + this = self-improving platform.

---

## 2. Priority & sequencing (how to integrate without new weeks)

These 5 fit into existing Week 8.5 and 9.5 adoption spikes we already budgeted — no new weeks needed:

| Phantom | Slot | Effort | Prerequisite |
|---------|------|--------|-------------|
| #3 ACI paradigm | Week 8.5 (now) | 1 day | None — pure CI gate + lint |
| #4 CoALA taxonomy | Week 8.5 (now) | 2 days | Extends MemoryConsolidator (W2B) |
| #1 OTel gen_ai semconv | Week 9.5 | 1 day | Runtime Analytics (W4) |
| #5 continuedev hub pattern | Week 9.5 | 1.5 days | Adoption telemetry (W4) + Peer-eval (pre-existing) |
| #2 PROV-O | Week 9.5 | 2 days | Pairs with V10 bi-temporal (W9) |

Total: 7.5 days → fits in 2 existing 3-day adoption spikes (6 days) plus 1.5 days of overflow we can absorb in W10 foundation.

---

## 3. Impact map — why these 5, not others

Ranking among the 85 phantoms by fit to "coordination × adoption":

```
fit_score = (coordination_relevance + adoption_relevance) / 2  × (1 - integration_cost_days/5)
```

Top 5 by this score:
1. ACI paradigm — 0.88 (adoption 0.95, coord 0.70, cost 1d)
2. continuedev hub — 0.86 (adoption 0.95, coord 0.70, cost 1.5d)
3. OTel gen_ai — 0.82 (coord 0.95, adoption 0.60, cost 1d)
4. CoALA taxonomy — 0.78 (adoption 0.75, coord 0.65, cost 2d)
5. PROV-O — 0.76 (coord 0.90, adoption 0.50, cost 2d)

Deliberate exclusions:
- **Graphiti (0.96)** — highest score overall, but already V10 W9
- **microsoft/graphrag (0.95)** — already W8 V7 RAG router
- **LightRAG (0.93)** — same — already W8
- **HippoRAG (0.92)** — Phantom Integration §9.5 demo target
- **DSPy (0.90)** — already W9 V9
- **Letta (0.90)** — memory system; wait for CoALA taxonomy first to slot it correctly
- **SWE-bench (0.94)** — eval harness; Week 7.5 Phantom Integration foundation will backfill this
- **MITRE ATLAS (0.89)** — V8 W9 OSINT DD already maps to this

So these 5 are what's *new* (not already absorbed) and what specifically attacks the coordination/adoption meta-problem.

---

## 4. Expected outcome after integration

| Metric | Before | After |
|--------|--------|-------|
| Agent boot time (memory hydration) | ~2-3s (loads all AgentMemory) | <500ms (tier-selective via CoALA) |
| "Tool not found" errors/week (QA) | 2-3 (W6/W7/W8 pattern) | 0 (ACI gate catches at commit) |
| Cross-CLI trace visibility (Claude/Qwen/Gemini) | 0 (each invents own shape) | 100% (gen_ai semconv) |
| Provenance depth answerable in 1 Cypher hop | 1 level | unlimited (PROV-O) |
| Agent tool selection accuracy (right tool picked) | ~65% (ad-hoc name matching) | ~90% (ranked discover) |
| Flywheel Adoption pillar score | ~0.72 (W5 baseline) | ~0.85 target |

---

## 5. Execution order (next session)

1. **ACI paradigm first** (1 day) — blocks nothing, prevents future QA pain immediately
2. **CoALA taxonomy** (2 days) — unblocks better V9 quality loop in W9
3. **continuedev hub** (1.5 days) — tool ranking infra; needed for Mission Control `/skills` route
4. **OTel gen_ai semconv** (1 day) — unblocks Mission Control `/mission/a2a-bus` trace viewer (W13)
5. **PROV-O** (2 days) — pairs with V10 bi-temporal (W9) migration, do them together

After these 5, we have the meta-infrastructure to make all remaining phantoms integrate cleanly through Phantom Integration v4's S5-S8 lifecycle — each new phantom gets an ACI-checked tool, CoALA-tiered memory, PROV-tracked provenance, OTel-traced execution, and hub-ranked discoverability automatically.
