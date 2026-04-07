# WidgeTDC Orchestrator — Stabilization Audit & HyperAgent Target Registry v2

**Date:** 2026-04-07 | **Auditor:** Claude Opus 4.6 + Platform Telemetry | **Status:** CANONICAL

---

## 1. Executive Summary

This document synthesizes all stabilization signals — Linear backlog (137 items), 2 In Progress tickets, GitHub PRs (12 closed), Railway deploy history (60 deploys, 42% success), memory architecture audit (26 files, 4-tier, 0 ghost layers), OWUI drift check analysis, and Qwen's 6 Sovereign Edge scores — into an **updated 59-target HyperAgent registry** mapped to the autonomous feedback loop architecture.

**Platform snapshot (2026-04-07 live):**

| Signal | Value | Health |
|--------|-------|--------|
| Neo4j | 557,816 nodes / 5,248,245 rels (+19,735 24h) | ONLINE (128ms) |
| Relationships | 5,248,245 (+168,183 24h) | GROWING |
| Tools | 32 canonical (100% adoption) | STABLE |
| Crons | 33 jobs (27 enabled, 6 disabled) | OPERATIONAL |
| Deploy success (2w) | 25/60 = 42% | CRITICAL |
| Railway logging | 246,723+ messages dropped (rate limit) | CRITICAL |
| Deploy/local drift | 3 different commit refs (95a7f7e5 / eb1c9fc9 / ac4857d3) | CRITICAL |
| Agent liveness | 10/10 agents lastSeen=null | BROKEN |
| Q-Learning | 94 states, 15K episodes, recovered | STABLE |
| Embedding coverage | 28-34% (disputed) | NEEDS RECONCILIATION |
| Learning propagation | "Failed to propagate learning" in logs | FAILING |
| Overall Edge Score | 9.6/10 (Qwen) | HIGH but 3 edges below 9.5 target |

---

## 2. Sovereign Edge Gap Analysis (Target: 9.5/10 per edge)

| Edge | Current | Target | Gap | Top Blocker |
|------|---------|--------|-----|-------------|
| Husker (Memory) | 9.0 | 9.5 | -0.5 | Embedding coverage 28-34%, lesson dedup 9710+ |
| Laerer (Learning) | 8.3 | 9.5 | **-1.2** | adaptive_rag_retrain broken (LIN-632), Q-learning stale |
| Heler (Healing) | 8.0 | 9.5 | **-1.5** | 42% deploy rate, 246K log flood, ghost agents (LIN-633), DriftGate empty (LIN-634) |
| Forklarer (Explaining) | 9.0 | 9.5 | -0.5 | SRAG bounded missing (LIN-597), DataContract empty (LIN-631) |
| Vokser (Growing) | 8.5 | 9.5 | **-1.0** | OSINT 1600+ not ingested (LIN-480), bulk re-embed missing (LIN-637) |
| Integrerer (Integrating) | 8.5 | 9.5 | **-1.0** | Ghost-tier 6 tools (LIN-617), OWUI facade gaps (LIN-636), consulting 404, agent liveness null |

**Biggest gaps: Heler (-1.5), Laerer (-1.2), Vokser (-1.0), Integrerer (-1.0)**

> **NEW (runtime telemetry):** Heler gap likely **worse than 8.0** given logging flood (246K dropped), deploy/local drift (3 commit refs), and agent liveness broken. Laerer also degraded further — learning propagation actively failing in logs.

---

## 3. Critical Findings (P0 — Must Fix)

### 3.1 Deploy Stability: 42% Success Rate
- **Period:** 2026-03-24 to 2026-04-07 (14 days)
- **Total deploys:** 60 | **Successful:** 25 | **Failed:** 35
- **Root cause:** Rapid iteration on April 4 (v4.0.x series) without CI gate
- **Impact:** Heler edge degraded, production instability risk
- **Fix:** Add build+healthcheck gate in Railway pipeline; consider staging environment
- **Target:** >90% deploy success rate within 2 weeks

### 3.2 adaptive_rag_retrain Broken (LIN-632, Urgent)
- Model update pipeline returns error
- Q-Learning recovered but weights may be stale
- **Impact:** Laerer edge severely degraded — no active learning loop
- **Fix:** Debug retrain endpoint, verify model artifact path, re-run retrain cycle

### 3.3 DataContract Nodes Unpopulated (LIN-631, Urgent)
- Neo4j has DataContract label but 0 populated nodes
- Contracts exist in @widgetdc/contracts TypeBox schemas but never MERGE'd to graph
- **Impact:** Forklarer edge — no queryable contract metadata

### 3.4 SRAG Embedding Mismatch (LIN-630, Urgent)
- 26% zero-result queries due to dimension mismatch
- Embedding coverage disputed: 28% (Qwen) vs 33.9% (GraphHealthSnapshot)
- **Impact:** Husker + Forklarer edges — core search degraded

### 3.5 Obsidian Vault ENOENT (LIN-629, Urgent)
- `get_vault_stats` fails — path configuration broken
- **Impact:** Integrerer edge — Obsidian bridge non-functional

### 3.6 OSINT 1600+ Not Ingested (LIN-480, Urgent)
- 1600+ OSINT findings harvested but never written to Neo4j
- **Impact:** Vokser edge — competitive intelligence data inaccessible to graph queries

### 3.7 Railway Logging Flood: 246,723+ Messages Dropped (NEW)
- Railway rate limit (500 logs/sec) exceeded continuously
- **Root cause:** graph self-heal + AgentLearningLoop generating massive log volume
- **Impact:** Heler edge — production observability blind spots; cannot debug failures from logs
- **Fix:** Reduce log level for `graph.self_heal` and `AgentLearningLoop` to WARN; add sampling for high-frequency paths
- **Target:** 0 dropped messages under normal operation

### 3.8 Deploy/Local Drift: 3 Different Commit References (NEW)
- Deployed commit `95a7f7e5` not found in local repo (local HEAD = `eb1c9fc9`)
- Railway UI shows `ac4857d3` — third reference
- **Impact:** Heler edge — cannot verify what code is running in production; rollback unreliable
- **Fix:** Audit Railway deploy config, force redeploy from known main commit, add commit SHA to healthcheck endpoint

---

## 4. High-Priority Findings (P1 — Should Fix This Sprint)

| # | Issue | Edge | Description |
|---|-------|------|-------------|
| 4.1 | LIN-617 (In Progress) | Integrerer | Ghost-tier audit: 13 routers bypass TOOL_REGISTRY, 6 tools need registration |
| 4.2 | LIN-597 (In Progress) | Forklarer | SRAG bounded results + token folding — queries return unbounded docs |
| 4.3 | LIN-637 | Vokser | Bulk re-embed pipeline — needed to fix embedding coverage gap |
| 4.4 | LIN-636 | Integrerer | OWUI facade incomplete — 6 agent types missing tool routing |
| 4.5 | LIN-635 | Heler | OpenClaw circuit breaker 30s timeout too aggressive |
| 4.6 | LIN-634 | Heler | DriftGate governance nodes empty in Neo4j |
| 4.7 | LIN-633 | Heler | Ghost agent cleanup — stale agents in registry |
| 4.8 | LIN-487 | Husker | Lesson dedup — 9710+ identical CONTRACT_VIOLATION entries |
| 4.9 | LIN-483 | Vokser | Risk Score model — weighted scoring across OSINT sources |
| 4.10 | LIN-478 | Vokser | Daily CT-log scanning pipeline (50 domains) |
| 4.11 | LIN-479 | Vokser | CVR-scanning + vendor cascade tracking |
| 4.12 | OWUI Drift | Integrerer | Missing OWUI_PASSWORD/OWUI_TOKEN in GitHub Actions secrets |
| **4.13** | **Log flood** | **Heler** | **Railway 246K+ logs dropped — graph.self_heal + learning loop log volume** |
| **4.14** | **Deploy drift** | **Heler** | **3 commit refs across local/Railway/UI — deployed code unverifiable** |
| **4.15** | **Consulting 404** | **Integrerer** | **consulting-production-b5d8 returning 404 on root — service down/misconfigured** |
| **4.16** | **Agent liveness** | **Integrerer** | **All 10 agents lastSeen=null — swarm liveness tracking not writing timestamps** |
| **4.17** | **Learning propagation** | **Laerer** | **"Failed to propagate learning" in deploy logs — AgentLearningLoop broken** |
| **4.18** | **Local dirty state** | **Heler** | **5 modified + 6 untracked files (HF ingesters) — need commit or stash** |
| **4.19** | **get_sentinel_status** | **Integrerer** | **Tool not found — renamed or removed in recent refactor** |

---

## 5. Updated HyperAgent Target Registry v2.1 (59 Targets)

### Category A: Linear Bugs & Stability (19 targets)

| ID | Source | Target Metric | Current | Goal | Edge |
|----|--------|--------------|---------|------|------|
| A-01 | LIN-632 | adaptive_rag_retrain success | ERROR | PASS | Laerer |
| A-02 | LIN-631 | DataContract nodes in Neo4j | 0 | >50 | Forklarer |
| A-03 | LIN-630 | SRAG zero-result rate | 26% | <5% | Husker |
| A-04 | LIN-629 | Obsidian vault_stats | ENOENT | OK | Integrerer |
| A-05 | LIN-480 | OSINT findings in Neo4j | 0 | >1600 | Vokser |
| A-06 | LIN-617 | Ghost-tier tools registered | 26/32 | 32/32 | Integrerer |
| A-07 | LIN-597 | SRAG bounded responses | NO | YES | Forklarer |
| A-08 | LIN-633 | Stale agents in registry | >0 | 0 | Heler |
| A-09 | LIN-634 | DriftGate nodes populated | 0 | >10 | Heler |
| A-10 | LIN-635 | OpenClaw circuit breaker | 30s | 90s | Heler |
| A-11 | LIN-636 | OWUI agent type routing | 2/8 | 8/8 | Integrerer |
| A-12 | Deploy | Deploy success rate (rolling 2w) | 42% | >90% | Heler |
| **A-13** | **Telemetry** | **Railway logs dropped (rate limit)** | **246,723+** | **0** | **Heler** |
| **A-14** | **Telemetry** | **Deploy/local commit drift** | **3 refs** | **1 ref** | **Heler** |
| **A-15** | **Telemetry** | **Consulting frontend HTTP status** | **404** | **200** | **Integrerer** |
| **A-16** | **Telemetry** | **Agent liveness (lastSeen populated)** | **0/10** | **10/10** | **Integrerer** |
| **A-17** | **Telemetry** | **Learning propagation success** | **FAILING** | **PASS** | **Laerer** |
| **A-18** | **Telemetry** | **Local dirty state (uncommitted)** | **11 files** | **0** | **Heler** |
| **A-19** | **Telemetry** | **get_sentinel_status tool available** | **NOT FOUND** | **FOUND** | **Integrerer** |

### Category B: Graph Health & Data Quality (8 targets)

| ID | Source | Target Metric | Current | Goal | Edge |
|----|--------|--------------|---------|------|------|
| B-01 | GraphHealth | Embedding coverage | 28-34% | >70% | Husker |
| B-02 | LIN-637 | Bulk re-embed pipeline | MISSING | ACTIVE | Vokser |
| B-03 | LIN-487 | Lesson dedup (identical entries) | 9710+ | <100 | Husker |
| B-04 | Healers | Self-correct healer pass rate | ~85% | >95% | Heler |
| B-05 | Community | Community summaries freshness | weekly | weekly | Husker |
| B-06 | LIN-529 | Arch MCP graph audit (72->1018) | unverified | verified | Husker |
| B-07 | Hygiene | Graph hygiene daily pass | OK | OK | Heler |
| B-08 | DataContract | Contract→Graph sync | 0 nodes | full sync | Forklarer |

### Category C: Adoption & Integration Quality (8 targets)

| ID | Source | Target Metric | Current | Goal | Edge |
|----|--------|--------------|---------|------|------|
| C-01 | SNOUT | Tool registry parity | 32/32 | 32/32 | Integrerer |
| C-02 | SNOUT | Executor parity | 32+default | 32+default | Integrerer |
| C-03 | LIN-617 | Ghost-tier router coverage | 24/37 | 37/37 | Integrerer |
| C-04 | OWUI | Open WebUI tools functional | 5/8 | 8/8 | Integrerer |
| C-05 | OWUI | OWUI drift check CI | FAIL | PASS | Integrerer |
| C-06 | E2E | E2E test pass rate | 80/80 | 102+/102+ | Heler |
| C-07 | Contracts | Cross-repo TypeBox schemas | 12/12 | 12/12 | Integrerer |
| C-08 | Boot | Boot sequence steps complete | 8/8 | 8/8 | Integrerer |

### Category D: OSINT & Competitive Intelligence (8 targets)

| ID | Source | Target Metric | Current | Goal | Edge |
|----|--------|--------------|---------|------|------|
| D-01 | LIN-480 | OSINT findings ingested | 0 | >1600 | Vokser |
| D-02 | LIN-478 | CT-log scanning (50 domains) | MISSING | DAILY | Vokser |
| D-03 | LIN-479 | CVR vendor cascade tracking | MISSING | ACTIVE | Vokser |
| D-04 | LIN-482 | Leak detection scanning | MISSING | WEEKLY | Vokser |
| D-05 | LIN-481 | NIS2 compliance tracker | MISSING | ACTIVE | Vokser |
| D-06 | LIN-483 | Risk Score model | MISSING | ACTIVE | Vokser |
| D-07 | Competitive | Competitive crawl freshness | weekly | weekly | Vokser |
| D-08 | DataPulse | Source health avg (LIN-530) | 55% | >80% | Vokser |

### Category E: PRD v4.0 Engagement Intelligence (8 targets)

| ID | Source | Target Metric | Current | Goal | Edge |
|----|--------|--------------|---------|------|------|
| E-01 | FR-001 | :Engagement nodes in Neo4j | 0 | >20 seed | Husker |
| E-02 | FR-004 | Engagement similarity matching | MISSING | ACTIVE | Husker |
| E-03 | FR-005 | engagement.plan MCP tool | MISSING | REGISTERED | Integrerer |
| E-04 | FR-007 | precedent.match accuracy | unknown | >80% top-5 | Forklarer |
| E-05 | FR-009 | Scoping deck generation | MISSING | E2E working | Forklarer |
| E-06 | FR-010 | Chain: brief→precedent→plan→risk→deck | MISSING | ACTIVE | Laerer |
| E-07 | G-1 | Engagement scoping time | 4h manual | <2h | Laerer |
| E-08 | G-3 | Internal dogfood engagements | 0 | >5 | Laerer |

### Category F: Intelligence & Autonomous Scores (8 targets)

| ID | Source | Target Metric | Current | Goal | Edge |
|----|--------|--------------|---------|------|------|
| F-01 | Edge | Husker score | 9.0 | 9.5 | Husker |
| F-02 | Edge | Laerer score | 8.3 | 9.5 | Laerer |
| F-03 | Edge | Heler score | 8.0 | 9.5 | Heler |
| F-04 | Edge | Forklarer score | 9.0 | 9.5 | Forklarer |
| F-05 | Edge | Vokser score | 8.5 | 9.5 | Vokser |
| F-06 | Edge | Integrerer score | 8.5 | 9.5 | Integrerer |
| F-07 | Q-Learn | Q-Learning exploration rate | 0.2 | <0.1 | Laerer |
| F-08 | Evolution | Evolution loop enabled | DISABLED | ENABLED | Laerer |

---

## 6. Autonomous Feedback Loop → Target Mapping

### LOOP-1-OODA (Evolution) — Laerer Edge
**Trigger:** evolution-loop cron (currently DISABLED)
**Targets served:** A-01, A-17, E-06, E-07, E-08, F-02, F-07, F-08

| Step | Action | Affected Targets |
|------|--------|-----------------|
| Observe | Read graph health + failure history | B-04, B-07 |
| Orient | RLM plan generation | E-06 |
| Act | executeChain() with plan | E-07, E-08 |
| Learn | Persist EvolutionEvent + Lesson nodes | F-02, F-07 |

**Blocker:** F-08 (evolution loop disabled). Enable to activate this entire loop.

### LOOP-2-HEAL (Self-Healing) — Heler Edge
**Trigger:** graph-self-correct (2h), graph-hygiene-daily (04:00), health-pulse (5min)
**Targets served:** A-08, A-09, A-10, A-12, A-13, A-14, A-18, B-04, B-07, C-06, F-03

| Step | Action | Affected Targets |
|------|--------|-----------------|
| Detect | 14 parallel healers scan graph | B-04 |
| Diagnose | Categorize: orphan, stale, drift | A-08, A-09 |
| Heal | Auto-MERGE/DELETE corrective actions | B-07 |
| Verify | Re-scan post-heal | F-03 |

**Blockers:** A-12 (deploy stability), A-13 (log flood drowning observability), A-14 (deploy drift — can't verify what's running).

### LOOP-3-GROW (Growth) — Vokser Edge
**Trigger:** competitive-crawl (weekly), failure-harvester (4h), intel-knowledge-synthesis (30min)
**Targets served:** D-01 through D-08, B-01, B-02, F-05

| Step | Action | Affected Targets |
|------|--------|-----------------|
| Harvest | OSINT scan, CT-log, CVR, competitive crawl | D-01, D-02, D-03, D-07 |
| Ingest | MERGE findings → Neo4j | D-01, B-01 |
| Score | Risk model + DataPulse health | D-06, D-08 |
| Embed | Bulk re-embed new nodes | B-02, F-05 |

**Blocker:** D-01 (1600+ OSINT not ingested). Without ingest, the entire growth flywheel stalls.

### LOOP-4-GOVERN (Adoption) — Integrerer Edge
**Trigger:** cia-guardian (10min), adoption audits (manual)
**Targets served:** C-01 through C-08, A-04, A-06, A-11, F-06

| Step | Action | Affected Targets |
|------|--------|-----------------|
| Audit | Registry parity, ghost-tier scan | C-01, C-03 |
| Integrate | Register missing tools, fix routing | A-06, A-11 |
| Verify | OWUI drift check, E2E tests | C-05, C-06 |
| Report | Adoption matrix update | F-06 |

**Blocker:** C-05 (OWUI drift CI fails). Fix by adding OWUI_PASSWORD/OWUI_TOKEN to GitHub secrets.

---

## 7. Recommended Execution Sequence

### Sprint 1: Stabilize Heler + Stop the Bleeding (Week of 2026-04-07)

| Priority | Target | Action | Est. |
|----------|--------|--------|------|
| **P0** | **A-13** | **Fix log flood: reduce graph.self_heal + learning loop log level to WARN** | **1h** |
| **P0** | **A-14** | **Resolve deploy drift: audit Railway config, force redeploy from main** | **2h** |
| **P0** | **A-17** | **Fix learning propagation: debug AgentLearningLoop failure path** | **3h** |
| P0 | A-12 | Add Railway build+healthcheck gate | 2h |
| P0 | A-01 | Debug adaptive_rag_retrain endpoint | 3h |
| P0 | A-03 | Fix SRAG embedding dimension mismatch | 4h |
| P0 | A-04 | Fix Obsidian vault path config | 1h |
| **P1** | **A-16** | **Fix agent liveness: populate lastSeen timestamps in swarm heartbeat** | **2h** |
| **P1** | **A-15** | **Investigate consulting frontend 404 — redeploy or fix routing** | **2h** |
| **P1** | **A-18** | **Commit or stash 11 dirty files (HF ingesters)** | **30min** |
| P1 | A-08 | Ghost agent cleanup script | 2h |
| P1 | A-09 | Populate DriftGate governance nodes | 2h |
| P1 | C-05 | Add OWUI secrets to GitHub Actions | 30min |

**Gate:** Deploy success >80%, 0 dropped logs, deploy drift resolved, adaptive_rag_retrain PASS, SRAG zero-result <10%, learning propagation PASS

### Sprint 2: Activate Vokser (Week of 2026-04-14)

| Priority | Target | Action | Est. |
|----------|--------|--------|------|
| P0 | D-01/A-05 | Ingest 1600+ OSINT findings to Neo4j | 4h |
| P0 | B-01/B-02 | Bulk re-embed pipeline + run first batch | 6h |
| P1 | B-03 | Lesson dedup (deduplicate 9710+ entries) | 3h |
| P1 | D-06 | Risk Score model MVP | 4h |
| P1 | A-02 | MERGE DataContract nodes from TypeBox schemas | 3h |

**Gate:** Embedding coverage >50%, OSINT nodes >1600, lesson entries <500

### Sprint 3: Close Laerer & Integrerer Gaps (Week of 2026-04-21)

| Priority | Target | Action | Est. |
|----------|--------|--------|------|
| P0 | F-08 | Enable evolution-loop cron | 1h |
| P0 | A-06 | Register 6 ghost-tier tools (LIN-617) | 4h |
| P0 | A-07 | Ship SRAG bounded results (LIN-597) | 4h |
| P1 | A-11 | Complete OWUI facade routing | 4h |
| P1 | E-01 | Seed 20+ synthetic :Engagement nodes | 4h |
| P1 | E-03 | Register engagement.plan MCP tool | 4h |

**Gate:** All 6 edges >9.0, evolution loop running, engagement planning E2E

---

## 8. Backlog Triage (137 Items)

| Priority | Count | Examples |
|----------|-------|---------|
| Urgent (P0) | 6 | LIN-632, LIN-631, LIN-630, LIN-629, LIN-480, LIN-394 |
| High (P1) | 28 | LIN-637, LIN-636, LIN-635, LIN-634, LIN-633, LIN-626-628, LIN-483, LIN-478-479, etc. |
| Medium (P2) | 22 | LIN-640, LIN-639, LIN-638, LIN-487, LIN-486, LIN-482, LIN-481, etc. |
| Low (P3) | 24 | LIN-602, LIN-569, LIN-556, LIN-504, LIN-489, etc. |
| None/Epic | 57 | System cards, agent definitions, foundry items, old epics |

**Active work:** LIN-617 (ghost-tier, Urgent, In Progress), LIN-597 (SRAG bounded, High, In Progress)

**Recommended deferral:** 57 items with priority "None" are mostly system cards, agent definitions, and old foundry/RLM-HOT items that predate the current architecture. These should be triaged in a dedicated backlog grooming session — many are likely obsolete.

---

## 9. Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Deploy stability stays <50% | Blocks all autonomous loops | High | Sprint 1: Railway build gate + staging env |
| **Log flood blinds observability** | **Cannot debug production issues from Railway logs** | **High** | **Reduce log level for graph.self_heal + AgentLearningLoop** |
| **Deploy drift causes wrong code in prod** | **Rollback impossible, bug attribution broken** | **High** | **Audit Railway config, add commit SHA to /health** |
| Evolution loop causes regressions when enabled | Compound failures | Medium | Enable in read_only policy first, graduated to staged_write |
| **Learning propagation failure cascades** | **Q-learning weights stale, no new lessons** | **Medium** | **Fix AgentLearningLoop, then retrain** |
| OSINT bulk ingest overwhelms Neo4j | Graph performance degradation | Medium | Batch ingest with rate limiting (100 nodes/min) |
| Embedding re-index takes >24h | Blocks Sprint 2 gate | Low | Parallel batch workers, priority queue for high-value nodes |
| Lesson dedup deletes wrong entries | Knowledge loss | Low | Dry-run dedup first, preserve audit trail |

---

## 10. Version History

| Version | Date | Targets | Delta |
|---------|------|---------|-------|
| v1 (Redis) | 2026-04-07 | 38 | Initial registry from cross-repo dryruns |
| v2 | 2026-04-07 | 52 | +14 from backlog cross-ref, edge gap analysis, deploy stability |
| v2.1 | 2026-04-07 | 59 | +7 from runtime telemetry: log flood, deploy drift, consulting 404, agent liveness, learning propagation, dirty state, sentinel tool |
| **v2.2 (this doc)** | **2026-04-07** | **72** | **+13 from OWUI chat analysis: Category G (data ingestion, folding combinations, KPI framework, token optimization). See HYPERAGENT_ARCHITECTURE_BLUEPRINT_v1.md §10-11** |

---

*Generated by stabilization audit pipeline. Next review: after Sprint 1 gate (2026-04-14).*
