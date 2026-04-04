# PRD — v4.0 Engagement Intelligence Engine (Platform-Aligned)

**Status:** APPROVED (supersedes PRD_v4.0_Sovereign_Engagement_Platform.md)
**Date:** 2026-04-04
**Authors:** Claude Opus (orchestrator) + Omega Sentinel (governance)
**Phase:** Define (Double Diamond)

## Summary

The Engagement Intelligence Engine (EIE) makes consulting engagements first-class entities in the WidgeTDC knowledge graph, enabling AI-driven precedent matching, plan generation, and outcome-based learning. **Crucially, EIE does not reinvent planning — it consumes the platform's native `/cognitive/analyze` endpoint which already returns structured engagement plans (phases, risks, skills, methodology integration) with self-assessed confidence and quality scoring.**

## Why this supersedes the previous PRD

The earlier PRD (Sovereign Engagement Platform) was correct in data model but wrong in intelligence path. It proposed a custom plan-generation pipeline using `callCognitive('plan')` with JSON-parsing of stringified output. Discovery phase revealed:

1. **`/cognitive/analyze` already returns structured engagement plans** with richer fields than we were building manually (phase_breakdown, key_challenges_and_mitigations, resource_allocation, methodology_integration, insights, recommendations, confidence, quality self-score, routing metadata).
2. **`cognitive-proxy.ts` unwrap has a latent bug** — it only looks for `result/answer/reasoning/plan` top-level fields, and discards structured responses like `analysis/insights/recommendations`. This affects 8+ orchestrator consumers that silently fall back to text extraction.
3. **Raw LLM cascade bypasses the moat.** An earlier draft proposed `Mercury → DeepSeek → Claude → Groq → Gemini` as the planning path. Omega Sentinel blocked this as architectural dilution — it reduces EIE to a commoditized LLM wrapper.
4. **The platform stack is not optional:** RLM cognitive endpoints, context folding, swarm consensus, SRAG, KG-RAG, and autonomous GraphRAG are the moat. Bypassing them is governance drift.

## Non-goals (explicit)

- **No custom LLM orchestration.** EIE calls platform cognitive endpoints directly.
- **No parallel retrieval system.** EIE uses `dualChannelRAG` (which already uses `autonomous.graphrag` as primary) + optional `kg_rag.query` upgrade.
- **No Command Center frontend work.** StitchLive v4.0 in Open WebUI remains the presentation layer (confirmed by overlap audit in earlier PRD).
- **No swarm consensus in MVP.** Swarm requires `consensus.vote` workflow that doesn't exist yet — deferred to v4.0.1.
- **No cognitive-proxy.ts refactor.** That's a P1 tech debt ticket that affects 8+ consumers; out of scope for EIE MVP.

## Architecture — platform-aligned

```
EIE Plan Generation Pipeline (CORRECT)
════════════════════════════════════════════════════════════════

1. RETRIEVAL (via dualChannelRAG — already uses the deep stack)
   ├── autonomous.graphrag (maxHops: 2)  ← primary, relational
   ├── srag.query                         ← semantic parallel
   └── cypher queries                     ← structural
       ↓
       Returns: RAGResult[] with {source, content, score}

2. PRECEDENT MATCHING
   └── matchPrecedents() filters RAG results to engagement precedents
       Returns: EngagementMatch[] with similarity, reasoning, grade

3. STRUCTURED PLANNING (the key fix)
   └── fetch POST /cognitive/analyze  ← DIRECT call, bypasses
                                        cognitive-proxy unwrap bug
       Input: { task, context, analysis_dimensions, agent_id }
       Output: {
         analysis: {
           engagement_overview,
           phase_breakdown[],         ← maps to EngagementPlan.phases
           resource_allocation,       ← maps to required_skills
           methodology_integration,
           key_challenges_and_mitigations[]  ← maps to risks
         },
         insights[],
         recommendations[],
         confidence,                  ← uses platform self-score
         quality: { overall_score, parsability, relevance, completeness },
         routing: { provider, model, cost, latency_ms }  ← for adaptive-rag feedback
       }

4. FALLBACK CHAIN (only if /cognitive/analyze returns null/empty)
   ├── llm.generate via MCP (Mercury)     ← tail fallback 1
   └── synthesizeFallbackPhases()         ← last resort (4-phase template)

5. OUTCOME FEEDBACK LOOP (existing, correct)
   └── sendQLearningReward → adaptive-rag Q-learning
       Uses platform cost + routing metadata for strategy scoring

6. GRAPH PERSISTENCE (existing, correct)
   ├── MERGE (:Engagement) with USES_METHODOLOGY edges
   ├── MERGE (:EngagementOutcome) with HAS_OUTCOME edges
   └── raptor.index for semantic precedent retrieval
```

## Requirements

### P0 — MVP Non-Negotiables

1. **Direct `/cognitive/analyze` consumption** in `engagement-engine.ts::generatePlan`
   - Bypass `cognitive-proxy.ts` (known unwrap bug)
   - Use `fetch` with `Authorization: Bearer ${config.backendApiKey}`
   - Map `analysis.phase_breakdown` → `phases`
   - Map `analysis.key_challenges_and_mitigations` → `risks`
   - Map `analysis.resource_allocation.roles` → `required_skills`
   - Use `Math.max(confidence, quality.overall_score)` as avg_confidence
   - Log `routing.provider` and `routing.cost` for observability

2. **Remove LLM cascade bypass** (my earlier wrong edit)
   - Remove `chatLLM` import
   - Remove `llmAttempts[]` array
   - Remove `llmProviderUsed` variable (will be replaced by RLM routing metadata)

3. **Fallback hierarchy preserved**
   - Tier 1: `/cognitive/analyze` direct (platform native)
   - Tier 2: `llm.generate` via MCP (Mercury, for graceful degradation only)
   - Tier 3: `synthesizeFallbackPhases` template (last resort)
   - Log which tier was used per plan generation

4. **Variance verification test**
   - KPI harness must show plans with **varying** phase counts (not all 4), varying risk counts, varying skill counts
   - If all plans show identical 4/2/4 structure, fallback is firing → blocker

5. **Neo4j schema + seeds preserved**
   - No changes to existing `Engagement`, `EngagementOutcome` node schema
   - 25 seeded engagements remain valid (no data migration)
   - Routes + endpoints unchanged

### P1 — Deferred to v4.0.1

- `kg_rag.query` as parallel retrieval channel (currently `dualChannelRAG` is sufficient)
- `context_folding.fold` for plans with evidence >2K tokens (current plans fit)
- `autonomous.graphrag` multi-hop upgrade (3 hops vs 2) for cross-domain plans
- Swarm consensus via `consensus.vote` + `autonomous.agentteam.coordinate`
- `rlm.start_mission` for complex multi-step plans (>40 week engagements)
- Stale precedent penalty (engagements older than 18 months)
- `cognitive-proxy.ts` unwrap fix (affects 8+ consumers — separate ticket)

### P2 — Out of scope

- Command Center engagements panel (StitchLive in Open WebUI is the surface)
- Multi-tenant isolation beyond `orgId`
- Billing/time tracking/invoicing
- External consultant marketplace (v4.1+ CaaS direction)

## Success Criteria

| KPI | Target | Measurement | Blocker? |
|-----|--------|-------------|----------|
| Plan phase count variance | Std dev > 0 across 10 diverse queries | `measure-eie-kpis.mjs` output | **YES** — proves not fallback |
| Plan citation density | ≥10 citations per plan | Same harness | Yes |
| Plan avg confidence | >0.70 | Same harness | Yes |
| Zero-result rate | <10% | Same harness | Yes |
| RLM routing captured | 100% of plans have `provider` + `cost` logged | Log inspection | Yes |
| Neo4j MERGE integrity | 100% MERGE-only, 0 orphans | Omega Sentinel audit | Yes |
| Precedent match latency | <3s p95 | E2E test timing | Yes |
| Plan generation latency | <30s p95 | E2E test timing | Yes |
| E2E tests passing | 23/23 (current) + variance check = 24/24 | `verify-engagements-e2e.mjs` | Yes |
| `frontend/index.html` unchanged | Empty diff | `git diff` | Yes |

## Verification protocol (Omega Sentinel-certified)

1. **Probe before fix** — curl `/cognitive/analyze` with real engagement input, confirm structured response
2. **Narrow fix** — single function in `engagement-engine.ts::generatePlan`
3. **Build + type-check** — `npm run build` + `node --check dist/index.js`
4. **Deploy to Railway** — `railway up --service orchestrator`
5. **Probe after deploy** — curl orchestrator `/api/engagements/plan` with test payload
6. **KPI variance test** — run `measure-eie-kpis.mjs`, verify phase counts vary
7. **Omega audit** — `audit.run` on generated plan output
8. **Governance closure** — episodic memory + lesson propagation

## Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `/cognitive/analyze` response schema changes | High | Defensive field access with optional chaining; log unknown keys |
| RLM engine down during plan request | High | Fallback to `llm.generate` → template. Both logged distinctly |
| RLM rate limits | Medium | Existing orchestrator rate limiter (20 req/min per key) |
| Plans produced by fallback template | Medium | KPI variance check catches this; alerts if >20% plans are template |
| cognitive-proxy unwrap bug affects other modules | Medium | Out of scope for EIE; file P1 ticket separately |
| Routing metadata format varies by provider | Low | Map defensively: `routing?.provider ?? "unknown"` |

## Linear issue

Created as LIN-XXX (see implementation). Issue tracks:
- Revert LLM cascade (my earlier wrong edit)
- Implement direct `/cognitive/analyze` consumption
- Add structured response mapping
- Re-run KPI with variance check
- Governance closure + lesson propagation

## Alignment matrix — every platform capability addressed

| Capability | EIE usage | Status |
|------------|-----------|--------|
| RLM Engine | `/cognitive/analyze` direct call | ✅ Primary planning path |
| Cognitive Proxy endpoints | Bypassed due to unwrap bug (P1 fix separate) | ⚠️ Documented workaround |
| Context Folding | Deferred — current plans <2K tokens | ⏸️ v4.0.1 |
| Swarm Consensus | Deferred — consensus.vote not implemented | ⏸️ v4.0.1 |
| SRAG | Via `dualChannelRAG` | ✅ Used |
| KG-RAG | Deferred — `autonomous.graphrag` sufficient for MVP | ⏸️ v4.0.1 |
| Autonomous GraphRAG | Via `dualChannelRAG` (already primary) | ✅ Used |
| 8-layer memory | Redis (working) + Neo4j (graph) | ✅ Used |
| Agent Learning Loop | `sendQLearningReward` on outcome | ✅ Used |
| Audit integrity | `audit.run` in verification protocol | ✅ Mandatory |
| Contracts law | snake_case + `$id` + `$schema` | ✅ Compliant |
| raptor.index | Precedent indexing via metadata `{type: "engagement"}` | ✅ Used |
| adaptive-rag.ts | Q-learning reward on outcome + routing metadata | ✅ Used |
| compound-hooks.ts | Available for future citation-edge writing | ⏸️ v4.0.1 |

## Definition of Done

- [ ] Linear issue created and assigned
- [ ] `src/engagement-engine.ts` fix applied (LLM cascade removed, `/cognitive/analyze` direct)
- [ ] Build green + `node --check` passes
- [ ] Deployed to Railway orchestrator service
- [ ] `/api/engagements/plan` probe returns structured plan with `provider` metadata
- [ ] KPI harness (`measure-eie-kpis.mjs`) shows **variance** in phase/risk/skill counts
- [ ] E2E tests: 23/23 (existing) + variance check pass
- [ ] `git diff frontend/index.html` empty (no frontend changes)
- [ ] Omega Sentinel audit passed
- [ ] Episodic memory recorded + lesson propagated
- [ ] Linear issue closed with KPI numbers
- [ ] This PRD committed to repo as reference

## Sequence

```
T+0:   Revert LLM cascade in engagement-engine.ts
T+5:   Add callRlmAnalyze() + structured response mapping
T+15:  Build + deploy to Railway
T+25:  Wait for deploy, verify health
T+30:  Probe /api/engagements/plan (single test)
T+32:  Run measure-eie-kpis.mjs (10 plans) — verify variance
T+40:  Run verify-engagements-e2e.mjs (23 tests)
T+45:  Commit + push
T+47:  Omega Sentinel audit
T+50:  Linear closure
```

Target: 50 minutes end-to-end. Autonomous.
