# HyperAgent Architecture Blueprint v1.0

**Date:** 2026-04-07 | **Source:** RLM Engine (4 reasoning passes) + Stabilization Audit v2.1 | **Status:** CANONICAL

---

## 1. The Triangle: HyperAgent + Orchestrator + Neural Bridge

```
                    ┌─────────────────────┐
                    │     HyperAgent      │
                    │  goal→plan→approve→  │
                    │  execute→evaluate    │
                    │  Policy Profiles     │
                    │  Circuit Breaker     │
                    └──────┬──────┬───────┘
                           │      │
              plan requests│      │evaluation signals
                           │      │
                ┌──────────▼──┐ ┌─▼──────────────┐
                │ Orchestrator│ │  Neural Bridge  │
                │ Chain Engine│ │  Cognitive Proxy │
                │ 5 modes     │ │  Dual RAG       │
                │ State Machine│ │  Q-Learning     │
                │ Cron Sched. │ │  Context Fold   │
                └──────┬──────┘ └──┬──────────────┘
                       │           │
                       └─────┬─────┘
                             │
                    ┌────────▼────────┐
                    │   Neo4j + Redis │
                    │   557K nodes    │
                    │   5.2M rels     │
                    │   KPI store     │
                    └─────────────────┘
```

**Value proposition:** HyperAgent provides *intent* (what to achieve), Orchestrator provides *execution* (how to achieve it), Neural Bridge provides *cognition* (why this approach, what did we learn). The triangle becomes self-improving when all three feedback loops are closed.

---

## 2. Chain Mode Selection Matrix (RLM-Validated)

Each of the 59 targets belongs to a category. The chain mode determines HOW the orchestrator executes the plan.

| Category | Default Mode | Rationale | Fallback Mode |
|----------|-------------|-----------|---------------|
| **A: Bug Fixes & Stability** | `sequential` | Deterministic: identify→diagnose→fix→verify. No race conditions. | `loop` (for retry-able fixes like deploys) |
| **B: Graph Health & Data Quality** | `parallel` | Independent checks: embedding, dedup, hygiene run concurrently. | `loop` (iterative: re-embed→check→re-embed) |
| **C: Adoption & Integration** | `loop` | Repeated audit cycles: register→verify→test→confirm score. | `debate` (for governance decisions) |
| **D: OSINT & Competitive Intel** | `parallel` | Embarrassingly parallel: CT-log, CVR, leak detection, crawl. | `sequential` (for dependent deep-dives) |
| **E: Product Features (PRD v4.0)** | `debate` | Multi-perspective: architect→critic→synthesizer consensus. | `sequential` (for implementation) |
| **F: Intelligence Score Optimization** | `adaptive` | Meta-optimization: Q-learning selects best mode per state. | `debate` (for strategy review) |

**Implementation in HyperAgent `selectChainMode()`:**
```typescript
function selectChainMode(target: Target): ChainMode {
  const modeMap: Record<string, ChainMode> = {
    'A': 'sequential', 'B': 'parallel', 'C': 'loop',
    'D': 'parallel',   'E': 'debate',   'F': 'adaptive'
  };
  const category = target.id.charAt(0);
  // F-category delegates to Q-learning state machine
  if (category === 'F') return qLearningSelectMode(target);
  return modeMap[category] || 'sequential';
}
```

---

## 3. Priority Scoring Formula (RLM-Derived)

```
priority(target_i) = w₁ · (edge_gap / max_gap)
                   + w₂ · target_gap_normalized
                   + w₃ · (1 / (1 + dependency_count))
                   - w₄ · effort_normalized
```

**Weights:** w₁=0.40 (edge gap dominance), w₂=0.30 (target gap), w₃=0.15 (dependency simplicity), w₄=0.15 (effort penalty)

**Current edge gaps (from 9.5 target):**

| Edge | Score | Gap | Normalized |
|------|-------|-----|-----------|
| Heler | 8.0 | 1.5 | 1.000 |
| Laerer | 8.3 | 1.2 | 0.800 |
| Vokser | 8.5 | 1.0 | 0.667 |
| Integrerer | 8.5 | 1.0 | 0.667 |
| Husker | 9.0 | 0.5 | 0.333 |
| Forklarer | 9.0 | 0.5 | 0.333 |

**Computed Priority Ranking (Top 12):**

| Rank | Target | Score | Edge | Action |
|------|--------|-------|------|--------|
| 1 | A-13 | **0.820** | Heler | Fix log flood (246K+ dropped) |
| 2 | A-14 | **0.805** | Heler | Resolve deploy/local drift |
| 3 | A-18 | **0.745** | Heler | Commit 11 dirty files |
| 4 | A-12 | **0.730** | Heler | Deploy success >90% |
| 5 | A-01 | **0.710** | Laerer | Fix adaptive_rag_retrain |
| 6 | A-16 | **0.672** | Integrerer | Fix agent liveness (lastSeen) |
| 7 | A-05 | **0.642** | Vokser | Ingest 1600+ OSINT to Neo4j |
| 8 | F-08 | **0.640** | Laerer | Enable evolution-loop cron |
| 9 | A-17 | **0.635** | Laerer | Fix learning propagation |
| 10 | A-15 | **0.612** | Integrerer | Fix consulting frontend 404 |
| 11 | A-03 | **0.448** | Husker | Fix SRAG embedding mismatch |
| 12 | B-01 | **0.358** | Husker | Increase embedding coverage |

**Key insight:** The formula mathematically confirms the intuitive Sprint 1 focus — **Heler targets sweep the top 4 positions** because the edge gap (1.5) is the largest and the fixes are low-effort/low-dependency.

---

## 4. Neural Bridge Cognitive Feedback Architecture

### 4.1 Current State (Broken Pipes)

```
Chain Execution → [outcome lost] → no reward signal → Q-weights stale
                                  → learning propagation fails
                                  → RAG retrain broken
```

### 4.2 Target State (Closed Loop)

```
Chain Execution
    │
    ├─→ outcome_event {chain_id, mode, target_id, success, edge_delta, duration}
    │
    ├─→ adaptive_rag_reward(outcome)  ←── automatic post-chain
    │       │
    │       └─→ Q-learning state transition: S + A + R → S'
    │
    ├─→ failure_harvester (if failed)
    │       │
    │       └─→ SOAR-style impasse → sub-plan to diagnose failure cause
    │
    └─→ KPI persistence → Neo4j (:EdgeScore, :ChainOutcome nodes)
            │
            └─→ Weekly retrain: accumulated rewards → updated RAG weights
```

### 4.3 Cognitive Architecture Patterns (RLM-Recommended)

**SOAR-Inspired Impasse Handling:**
When a HyperAgent plan execution fails, instead of simple failure logging, trigger an impasse that creates a diagnostic sub-plan. The sub-plan queries failure memory (`FailureMemory: 3,199 nodes`) for similar past failures and their resolutions.

```typescript
async function handlePlanFailure(plan: Plan, error: Error) {
  // 1. Record failure
  await failureHarvest(plan, error);
  // 2. SOAR impasse: create diagnostic sub-plan
  const similarFailures = await searchKnowledge(`failure pattern: ${error.message}`);
  const diagPlan = await createPlan({
    goal: `Diagnose why plan ${plan.id} failed: ${error.message}`,
    context: { original_plan: plan, similar_failures: similarFailures },
    policy: 'read_only' // diagnostic plans are always read-only
  });
  // 3. Execute diagnosis (sequential mode, safe)
  return executePlan(diagPlan);
}
```

**ACT-R-Inspired Spreading Activation for SRAG:**
Boost retrieval scores for nodes connected to the current chain's execution context. When executing a Heler-edge target, nodes tagged with `edge:heler` or connected to recent `:ChainOutcome` nodes get activation boost.

**Q-Learning State-Action Space:**
- **State:** `(target_category, edge_gap_bucket, recent_success_rate_bucket)`
  - target_category: A-F (6 values)
  - edge_gap_bucket: low(<0.5), medium(0.5-1.0), high(>1.0) (3 values)
  - recent_success_rate: low(<50%), medium(50-80%), high(>80%) (3 values)
  - = 54 useful states (current: 94 states, some redundant)
- **Action:** chain_mode (5 values: sequential, parallel, loop, debate, adaptive)
- **Reward:** edge_score_delta after execution (positive = improvement)
- **Target exploration rate:** 0.2 → 0.05 over Phase 1-3 (anneal)

---

## 5. Graduated Autonomy Activation Plan

### PHASE 0: Stop the Bleeding (NOW)

**Entry gate:** None — this is the current phase.
**Policy profile:** `manual` (no HyperAgent autonomy)
**Duration:** 1-2 weeks

| Action | Target | Chain Mode | Gate |
|--------|--------|-----------|------|
| Fix log flood | A-13 | manual | 0 dropped logs for 24h |
| Resolve deploy drift | A-14 | manual | single commit ref confirmed |
| Commit dirty state | A-18 | manual | git status clean |
| Deploy gate + success rate | A-12 | manual | >80% for 48h |
| Fix learning propagation | A-17 | manual | propagation success in logs |
| Fix adaptive_rag_retrain | A-01 | manual | retrain endpoint returns 200 |
| Fix SRAG embedding mismatch | A-03 | manual | zero-result rate <10% |

**Exit criteria:** All 7 items green → proceed to Phase 1.
**Rollback:** N/A (this is ground state).

### PHASE 1: Read-Only Autonomy — Observe & Recommend

**Entry gate:** Phase 0 complete + all metrics green for **48 hours**.
**Policy profile:** `read_only`
**Duration:** 2 weeks

| Loops Active | Mode Restriction | HyperAgent Behavior |
|-------------|-----------------|-------------------|
| LOOP-2-HEAL (observe) | sequential only | Creates plans, requires human approval |
| LOOP-4-GOVERN (observe) | sequential only | Generates audit reports, no writes |

**Allowed actions:** Graph queries, health checks, plan creation, KPI reads, report generation.
**Forbidden actions:** Any write to Neo4j, Redis, filesystem, or external APIs.
**Rollback trigger:** Any edge score drops >0.3 from Phase 0 exit baseline.
**Success metric:** All 6 edges stable or improving for 2 weeks. HyperAgent plan quality >80% (judged by human approval rate).

### PHASE 2: Staged Write — Act with Approval Gate

**Entry gate:** Phase 1 complete + all edges >8.5 for **1 week**.
**Policy profile:** `staged_write`
**Duration:** 3-4 weeks

| Loops Active | Mode Restriction | HyperAgent Behavior |
|-------------|-----------------|-------------------|
| LOOP-2-HEAL (active) | sequential + parallel | Auto-executes read_only targets |
| LOOP-3-GROW (active) | parallel | Requires approval for writes |
| LOOP-4-GOVERN (active) | loop | Auto-executes audit cycles |

**Allowed actions:** All read-only + graph MERGEs for data quality, OSINT ingest, embedding operations.
**Approval required for:** Schema changes, agent registry mutations, cron modifications, deploy triggers.
**Circuit breaker:** 3 consecutive chain failures → pause loop, alert, revert to Phase 1.
**Rollback trigger:** Any edge drops below 8.0 OR deploy success <70%.
**Success metric:** All edges >9.0, OSINT ingested, embedding coverage >50%.

### PHASE 3: Production Write — Full Closed-Loop Autonomy

**Entry gate:** Phase 2 complete + all edges >9.0 for **2 weeks** + zero P0 targets.
**Policy profile:** `production_write`
**Duration:** Ongoing

| Loops Active | Mode Restriction | HyperAgent Behavior |
|-------------|-----------------|-------------------|
| All 4 loops including LOOP-1-OODA | All 5 modes incl. adaptive | Full autonomous goal pursuit |

**Allowed actions:** All operations including evolution loop, chain mode adaptation, automatic plan generation + execution + evaluation.
**OODA cycle:** Observe (edge scores + graph health) → Orient (RLM plan) → Act (chain execution) → Learn (reward signals + weight retrain).
**Circuit breaker:** 5 consecutive failures OR any edge <8.5 → auto-downgrade to Phase 2.
**Rollback trigger:** Any edge drops below 8.5 → Phase 2. Any P0 target resurfaces → Phase 1.
**Success metric:** All 6 edges ≥9.5 sustained for 30 days.

---

## 6. Self-Improving Fitness Function

The fitness function is not static — it evolves based on outcomes:

```
F(t) = Σᵢ wᵢ · edgeᵢ(t)    where i ∈ {Husker, Laerer, Heler, Forklarer, Vokser, Integrerer}
```

**Initial weights:** Equal (wᵢ = 1/6 for all edges).

**Weight adaptation (after each chain execution):**
```
wᵢ(t+1) = wᵢ(t) + α · (target_score - edgeᵢ(t)) · edge_deltaᵢ(t)
```

Where:
- `α = 0.01` (learning rate)
- `target_score = 9.5`
- `edge_deltaᵢ(t)` = change in edge i after the chain execution

This means: edges that are further from target AND improving get MORE weight (resource allocation follows momentum). Edges that are close to target get LESS weight (diminishing returns).

**Q-Learning integration:**
The Q-table maps `(current_fitness_state, action) → expected_reward`. After each chain:
1. Compute reward = `F(t+1) - F(t)` (overall fitness delta)
2. Update Q-value: `Q(s,a) = Q(s,a) + α · (reward + γ·max(Q(s',a')) - Q(s,a))`
3. Select next target by: `argmax(priority(target) + β·Q(state(target), mode(target)))`
   - β starts at 0.3 (low trust in Q-values) and increases to 0.7 as exploration decreases

**Exploration annealing:**
```
ε(phase) = { Phase 1: 0.3, Phase 2: 0.15, Phase 3: 0.05 }
```
Higher exploration in early phases (still learning which chain modes work). Near-zero exploration in Phase 3 (exploit known-good patterns).

---

## 7. Neural Bridge Evolution Roadmap

| Phase | Capability | Depends On | Edge Impact |
|-------|-----------|-----------|-------------|
| **NB-1: Fix Broken Pipes** | Repair retrain endpoint (A-01), learning propagation (A-17), embedding mismatch (A-03) | Phase 0 | Laerer +0.5, Husker +0.3 |
| **NB-2: Auto-Reward Wiring** | Chain outcome → adaptive_rag_reward called automatically post-execution | NB-1 | Laerer +0.3 |
| **NB-3: SOAR Impasse Handling** | Failed plans trigger diagnostic sub-plans querying FailureMemory (3,199 nodes) | NB-2 | Heler +0.3, Laerer +0.2 |
| **NB-4: Spreading Activation** | Context-aware SRAG retrieval — boost scores for nodes connected to active chain context | NB-1, embedding >50% | Husker +0.4, Forklarer +0.3 |
| **NB-5: Full Closed-Loop** | RAG weight retrain weekly from accumulated rewards, Q-learning drives mode selection | NB-2, NB-3, NB-4 | All edges +0.2 |

**Projected edge scores after NB-5:**

| Edge | Current | After NB-5 (projected) | Target |
|------|---------|----------------------|--------|
| Husker | 9.0 | 9.7 | 9.5 |
| Laerer | 8.3 | 9.3→9.5 | 9.5 |
| Heler | 8.0 | 8.3→9.5 (Phase 0 fixes + NB-3) | 9.5 |
| Forklarer | 9.0 | 9.3→9.5 | 9.5 |
| Vokser | 8.5 | 9.0→9.5 (OSINT ingest + growth loop) | 9.5 |
| Integrerer | 8.5 | 9.0→9.5 (ghost-tier + OWUI + liveness) | 9.5 |

---

## 8. Risk Mitigations for Autonomous Operation

| Risk | Mitigation | Implemented In |
|------|-----------|---------------|
| Autonomous action causes data loss | Circuit breaker (3 failures → pause) | HyperAgent circuit breaker |
| Edge score regression during autonomy | Phase-gated rollback triggers | Graduated activation plan |
| Q-learning exploits bad policy | Exploration annealing (0.3→0.05) | Fitness function |
| Log flood returns during autonomous operation | Log sampling + level control per module | Phase 0 fix (A-13) |
| Deploy drift re-emerges | Commit SHA in healthcheck endpoint | Phase 0 fix (A-14) |
| SOAR impasse loops infinitely | Max impasse depth = 3, timeout = 30s | NB-3 implementation |
| Fitness weights diverge | Weight clipping: wᵢ ∈ [0.05, 0.40] | Fitness function |

---

## 9. Implementation Sequence (Aligned with Stabilization Sprints)

| Sprint | Phase | Key Deliverables | Gate |
|--------|-------|-----------------|------|
| Sprint 1 (Apr 7) | Phase 0 | Fix A-13, A-14, A-18, A-12, A-17, A-01, A-03 | All 7 green for 48h |
| Sprint 2 (Apr 14) | Phase 0→1 | NB-1 + NB-2, OSINT ingest, bulk re-embed | Retrain working, edges stable |
| Sprint 3 (Apr 21) | Phase 1 | NB-3 (SOAR impasse), ghost-tier, evolution loop enabled | Plans quality >80%, edges >8.5 |
| Sprint 4 (Apr 28) | Phase 1→2 | NB-4 (spreading activation), staged write activation | All edges >8.5 for 1 week |
| Sprint 5 (May 5) | Phase 2 | Full GROW + GOVERN loops, embedding >50% | All edges >9.0 |
| Sprint 6 (May 12) | Phase 2→3 | NB-5 (full closed-loop), OODA enabled, adaptive mode | All edges >9.0 for 2 weeks |
| Sprint 7+ (May 19+) | Phase 3 | Autonomous maintenance, fitness function self-tuning | All edges ≥9.5 sustained 30d |

---

## 10. Chat Export Analysis: Folding Strategy + Data Ingestion Pipeline (NEW)

Source: OWUI chat exports (1775570009137 + 1775528848729), analyzed via RLM + context_fold.

### 10.1 Folding Combination Matrix (Not Yet Implemented)

| Combination | Use Case | Expected Token Savings | Edge Impact |
|-------------|----------|----------------------|-------------|
| **Folding + RAG** | Pre-compress context before SRAG retrieval | 30-40% | Husker, Forklarer |
| **Folding + RLM** | Compress chain context before reason/analyze/plan | 40-50% | Laerer |
| **Folding + Swarm** | Compress inter-agent A2A context | 35-45% | Integrerer |
| **Folding + Long Doc** | Compress intermediate drafts in report generation | 25-35% | Forklarer |

**Status:** Concepts validated in chat but NO production implementation exists. No KPI pipeline for quality vs compression vs DKK savings.

### 10.2 A2A Channel (Verified Working)

```
Claude → Neo4j signal → Qwen (via MCP proxy) → Autonomous execution → Closure node
```

- 7 claims + 2 closures + 3 autonomous graph queries in single session
- Qwen proxy: geo-provisioner-production.up.railway.app/v1/chat/completions
- **This is the backbone for LOOP-1-OODA cross-agent orchestration**
- Strengthens Integrerer edge (+0.2 potential)

### 10.3 Data Ingestion Pipeline (521K Rows, 22 Datasets)

**Current:** 557K nodes, 26% embedded, 6 RLM domains empty, RAG training at 2K samples.

**RLM-validated batch sequence:**

| Batch | Datasets | Rows | Key Impact | Priority |
|-------|----------|------|-----------|----------|
| **1: Highest ROI** | MITRE ATT&CK v18.1, NIST Cyber (525K pre-embedded), RAGBench | ~635K | Embedding 26%→89%, Cybersecurity from empty→full, RAG calibrated | **SPRINT 2** |
| **2: Domain Fill** | LegalBench (91K), CustomerSupport (61K), FinanceTasks (23K), FinSentiment (12K) | ~187K | Legal 266→91K, Finance 13K→48K, Operations domain filled | Sprint 3 |
| **3: Platform** | text2cypher (40K), function-calling (113K), RAG-12K, MCP-eval (9.8K) | ~175K | RAG training 2K→25K, Cypher query quality, SkillForge patterns | Sprint 4 |
| **4: Niche** | 11 datasets (ESG, Telecom, SOC, Danish eval, etc.) | ~420K | Domain completeness, niche consulting capability | Sprint 5+ |

**Edge impact per batch (RLM-analyzed):**

| Edge | Batch 1 | Batch 2 | Batch 3 | Batch 4 |
|------|---------|---------|---------|---------|
| Husker | **+1.0** (embedding fix) | +0.3 | +0.2 | +0.1 |
| Laerer | +0.3 (RAG calibration) | +0.2 | **+0.5** (training data) | +0.1 |
| Heler | +0.1 | +0.1 | +0.2 | +0.1 |
| Forklarer | +0.3 (SRAG works) | **+0.5** (legal/finance) | +0.2 | +0.2 |
| Vokser | **+0.5** (cyber domain) | +0.3 | +0.3 (SkillForge) | +0.3 |
| Integrerer | +0.1 | +0.1 | +0.2 (MCP eval) | +0.1 |

**Critical insight:** Batch 1 alone (NIST pre-embedded) would jump embedding from 26% to ~89% — this is the single highest-ROI action for Husker edge. Combined with MITRE ATT&CK structured graph data, it eliminates the largest data gap.

### 10.4 Token Cost Optimization Program

From RLM Token Optimization chat — 19+ methods identified:

| Method | Category | Status | Est. Savings |
|--------|----------|--------|-------------|
| Context folding (in/out) | Compression | Partial (mercury-2 active) | 30-50% per call |
| Capped free tier rotation | Account mgmt | Planned (geo-provisioner created, empty) | $0 for dev traffic |
| Subscription vs API key | Billing | Research needed | 20-40% for high volume |
| Regional pricing (CN/US/EU) | Geo-arbitrage | Research done, not implemented | 30-60% for some providers |
| Model routing by task type | LLM proxy | Active (llm-proxy.ts) | 40% (cheap for simple, expensive for complex) |
| RAG pre-filter | Query optimization | Not implemented | 50% (fewer tokens in context) |

**geo-provisioner Railway service:** Created (8c6ec212) but EMPTY BUILD FAILURE (only .gitkeep). Either deploy code or decommission.

---

## 11. Updated Target Registry: Category G — Data & Cost Optimization (NEW)

| ID | Source | Target Metric | Current | Goal | Edge |
|----|--------|--------------|---------|------|------|
| G-01 | Chat | Folding+RAG pipeline implemented | NO | YES | Husker, Forklarer |
| G-02 | Chat | Folding+RLM pre/post compression | NO | YES | Laerer |
| G-03 | Chat | Folding KPI dashboard (quality/compression/DKK) | NO | YES | Laerer |
| G-04 | Chat | Execute T1-T10 testsuite vs production | 0/10 | 10/10 | Heler |
| G-05 | Chat | geo-provisioner build failure fixed or decommissioned | FAIL | RESOLVED | Heler |
| G-06 | Chat | Steel Browser wired into OSINT crawl | NO | YES | Vokser |
| G-07 | Chat | Folding+Swarm inter-agent compression | NO | YES | Integrerer |
| G-08 | Dataset | Batch 1 ingestion (MITRE+NIST+RAGBench) | 0 | 635K rows | Husker, Vokser |
| G-09 | Dataset | Embedding coverage post-NIST | 26% | >85% | Husker |
| G-10 | Dataset | RLM domains with 0 patterns | 6 | 0 | Forklarer |
| G-11 | Dataset | RAG training samples | 2K | >15K | Laerer |
| G-12 | Dataset | Batch 2 ingestion (Legal+Finance+Ops) | 0 | 187K rows | Forklarer |
| G-13 | Token | Token cost per 1K calls tracked in KPI | NO | YES | Laerer |

**Total targets: 59 (v2.1) + 13 (Category G) = 72 targets**

---

## 12. Revised Sprint Plan (with Data Ingestion)

| Sprint | Phase | Key Deliverables | Gate |
|--------|-------|-----------------|------|
| **Sprint 1** (Apr 7) | Phase 0 | Fix A-13 log flood, A-14 deploy drift, A-12 deploy rate, A-17 learning, A-01 retrain, A-03 SRAG | All 7 green 48h |
| **Sprint 2** (Apr 14) | Phase 0→1 | **G-08 Batch 1 ingestion** (MITRE+NIST 635K), G-09 embedding >85%, NB-1+NB-2, OSINT ingest | Embedding >85%, retrain working |
| **Sprint 3** (Apr 21) | Phase 1 | G-12 Batch 2 (Legal+Finance), G-01 Folding+RAG, G-10 all RLM domains, ghost-tier, evolution loop | Plans quality >80%, edges >8.5 |
| **Sprint 4** (Apr 28) | Phase 1→2 | Batch 3 (platform), G-02 Folding+RLM, G-03 KPI dashboard, NB-3+NB-4 | RAG training >15K, all edges >8.5 1wk |
| **Sprint 5** (May 5) | Phase 2 | G-04 full testsuite, GROW+GOVERN active, embedding >90% | All edges >9.0 |
| **Sprint 6** (May 12) | Phase 2→3 | NB-5 closed-loop, OODA enabled, adaptive mode, Batch 4 niche | All edges >9.0 2wks |
| **Sprint 7+** (May 19+) | Phase 3 | Autonomous: fitness self-tuning, continuous ingestion, token optimization | All edges ≥9.5 sustained 30d |

---

## Version History

| Version | Date | Source |
|---------|------|--------|
| v1.0 | 2026-04-07 | 4x RLM reason/analyze/plan + context_fold + stabilization audit v2.1 (59 targets) |
| **v1.1** | **2026-04-07** | **+OWUI chat analysis (2 chats, 196 msgs) → +13 targets (Category G), data ingestion pipeline, folding strategy, token optimization** |

*Blueprint feeds into HyperAgent target registry v2.2 (72 targets) and Sprint execution plan.*
