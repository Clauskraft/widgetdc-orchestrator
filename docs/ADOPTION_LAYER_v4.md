# Adoption Layer v4 — Coordination, Knowledge Sharing, Flywheel Integration

**Date:** 2026-04-13
**Purpose:** Wire every v4 value-prop (V1–V10) into the existing WidgeTDC coordination and learning substrate, so agents genuinely share state, learn from each other, and close the flywheel.
**Status:** Missing-from-v4 gap identified post-Week-7 QA; retrofitted into Week 6–9 plus new Week 6.5 / 8.5 adoption spikes.
**Owner:** Same handoff protocol — Qwen builds, Claude QAs.

---

## 0. What already exists (the coordination substrate)

v4 must not build parallel primitives — these are already in production:

| Primitive | Where | Purpose |
|-----------|-------|---------|
| `:AgentMemory {key:'claim-*'}` | Neo4j via `graph.write_cypher` | WIP claim before work (ADR-004 + `auto_materialize.py` Gate 3) |
| `:AgentMemory {key:'closure-*'}` | Neo4j | Session close broadcast |
| Pheromone layer | `src/swarm/pheromone-layer.ts` + 4 MCP tools (`pheromone_deposit/sense/heatmap/status`) | Stigmergic signals — success/failure trails |
| SRAG semantic search | `srag.query` MCP tool | Vector + graph hybrid retrieval |
| KG-RAG multi-hop | `kg_rag.query` MCP tool | Graph-grounded evidence with max_evidence |
| Autonomous GraphRAG | `autonomous.graphrag` MCP tool | Deep multi-hop (3 hops default) |
| Context Folding | RLM `/fold/context` + `context_folding.fold` MCP tool | Compress before reason |
| Loop Orchestrator | `src/state-machine.ts` + chain-engine loop mode | Canonical OODA engine |
| Teacher/Student lessons | `audit.lessons` / `audit.acknowledge` / `audit.run` MCP tools | Cross-agent immunity |
| Adoption telemetry | `src/flywheel/adoption-telemetry.ts` — `recordToolCall()` | Tool usage index, feeds flywheel |
| Peer-eval fleet | `src/swarm/peer-eval.ts` | Cross-agent quality scoring |
| Flywheel coordinator | `src/flywheel/flywheel-coordinator.ts` — 5-pillar compound | Weekly health score |
| A2A bus | `broadcastMessage` with `thread_id` | Real-time cross-agent chat |

**v4 gap:** V1–V10 were specified without wiring any of these in. That breaks the Golden Rule ("konsolidering, ikke parallel opbygning") at adoption level.

---

## 1. Coordination contract — every value-prop MUST satisfy

### 1.1 Claim-before-work (agent awareness)

Before any v4 value-prop executes destructive or long-running work, it must write a claim node and read other active claims in the same scope.

```cypher
// write claim
MERGE (m:AgentMemory {agentId: $agentId, key: 'claim-' + $scope + '-' + $timestamp})
SET m.value = $scope_description, m.type = 'claim', m.expiresAt = datetime() + duration('PT1H'),
    m.vprop = $vprop_id,
    m.updatedAt = datetime()

// read recent claims in same scope (detect overlap)
MATCH (m:AgentMemory) WHERE m.type='claim' AND m.value CONTAINS $scope_prefix
  AND m.updatedAt > datetime() - duration('PT30M')
RETURN m.agentId, m.value, m.vprop, m.updatedAt
```

**Scope per value-prop:**
| V-prop | Scope key | Overlap policy |
|---|---|---|
| V1 compliance audit | `compliance-<client_id>` | Block if same client mid-audit (<15 min) |
| V2 PR review | `pr-review-<repo>-<pr>` | Block duplicate review (<60 min) |
| V3 cost report | `cost-<engagement_id>` | Advisory only — concurrent reads OK |
| V4 deliverable | `deliverable-<engagement_id>-<type>` | Block if same type in-progress |
| V5 drift cron | `drift-<window>` | Block concurrent cron runs |
| V6 corpus sync | `corpus-<source_host>` | Block per-host rate-limit |
| V7 RAG route | — | Read-only, no claim needed |
| V8 OSINT DD | `osint-<target_domain>` | Block if scan running (<10 min) |
| V9 quality loop | `prompt-tune-<category>` | Block concurrent tuning |
| V10 bi-temporal | `bitemporal-<fact_type>` | Block migration overlap |

### 1.2 Closure broadcast

Every v4 tool call writes a closure AgentMemory on exit with outcome + key metrics:

```cypher
MERGE (m:AgentMemory {agentId: $agentId, key: 'closure-' + $scope + '-' + $timestamp})
SET m.value = $summary_json, m.type = 'closure',
    m.vprop = $vprop_id,
    m.outcome = $outcome,  // 'success' | 'partial' | 'failed'
    m.updatedAt = datetime()
```

---

## 2. Primitive-by-primitive adoption matrix

### 2.1 Pheromones — stigmergic routing

**When deposited:**
- V1 → `pheromone_deposit({type:'SUCCESS', domain:'compliance', agentId:'compliance-officer', intensity: auditReport.compliance_score / 100})`
- V2 → deposit per reviewer verdict (`type='SUCCESS'` if verdict converged, `type='ALERT'` if split)
- V4 → deposit `type='ATTRACTION'` on Phantom BOM sources cited in deliverable (future V-props find best sources via heatmap)
- V5 → deposit `type='ALERT'` on drift-flagged agents (other agents sense "stay away")
- V8 → deposit `type='INTEL'` on OSINT findings

**When sensed (before dispatch):**
- V2 reviewer selection: `pheromone_sense({domain:'code-review', agent_type:'reviewer'})` → pick highest-intensity recent trail
- V4 source retrieval: `pheromone_heatmap({domain:'knowledge'})` → bias KG-RAG toward attraction-high sources
- V7 RAG router: read pheromone state for strategy selection (successful strategies have fresher SUCCESS trails)

**Benefit:** Agents don't re-learn routing — successful paths strengthen, failing paths decay.

### 2.2 RAG integration — SRAG + KG-RAG + autonomous.graphrag

Every v4 tool that needs external evidence MUST use the RAG abstraction, not ad-hoc LLM calls.

| V-prop | RAG call | Min evidence |
|---|---|---|
| V1 | `kg_rag.query({question: 'EU AI Act Annex III requirements for ' + stack_category, max_evidence: 15})` → feed into requirement check | 5 evidence nodes |
| V2 | `srag.query({query: 'known vulnerability patterns for ' + lang})` → inject into security-category reviewer prompt | 3 sources |
| V4 | canonical: already uses RAG for citations via Lego Factory `generateDeliverable` | ≥5 citations default |
| V5 | `kg_rag.query({question: 'regression patterns for ' + agent_id})` → correlate drift with :Lesson | all relevant lessons |
| V7 | **is** the RAG router facade — must wrap SRAG/KG-RAG/autonomous.graphrag + pheromone-based strategy selection | — |
| V8 | `autonomous.graphrag({query: target + ' threat matrix', maxHops: 3})` against MITRE ATLAS subgraph | 3-hop depth |
| V9 | `srag.query` on baseline vs. tuned prompt outputs → compare evidence overlap for quality delta | — |
| V10 | `graph.read_cypher` with bi-temporal predicate — RAG on historical snapshot | — |

**Failure mode to prevent:** A v4 tool that hard-codes LLM calls without going through RAG facade is a P0 adoption violation.

### 2.3 Context Folding — when to fold

**Rule:** Any input or intermediate buffer >2000 estimated tokens MUST be folded before reasoning.

```typescript
// canonical pattern — reuse across v4
async function foldIfLarge(text: string, query: string, budget = 2000) {
  const estTokens = Math.ceil(text.length / 4)
  if (estTokens <= budget) return text
  const folded = await fetch(`${RLM}/fold/context`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ text, query, budget, strategy: 'auto' }),
  }).then(r => r.json())
  return folded.folded_text ?? text
}
```

| V-prop | Fold trigger |
|---|---|
| V1 | stack >50 items → fold each item to 200 tokens before requirement checks |
| V2 | any single file diff >4000 tokens → fold per file |
| V4 | brief >2000 tokens → fold before RLM reasoning (already in risk register §5) |
| V6 | README/prompt corpus entries >3000 tokens → fold before `prompts.ingest` |
| V8 | OSINT raw output >5000 tokens → fold per target |
| V9 | prompt output samples >2000 tokens → fold before quality scoring |

### 2.4 OODA loops via Loop Orchestrator (not DIY)

v4 tools that need iteration MUST call into the Loop Orchestrator chain-engine, not hand-roll their own loops.

- V9 DSPy quality loop: `run_chain({mode:'loop', max_iterations:5, convergence:'quality_score_delta<0.01'})`
- V4 reasoning steps: loop-orchestrator handles Plan→Retrieve→Write→Assemble→Render with OODA-style checkpoints
- V5 drift cron: `run_chain({mode:'sequential', steps:[observe, orient, decide, act]})` — OODA explicit

**Failure mode:** Inline `while` / `for` loops around LLM calls in v4 tools = P1 finding (bypasses orchestration, bypasses cost caps, bypasses verification gate).

### 2.5 Teacher/Student — audit + lesson propagation

Every v4 tool boot must call `audit.lessons` (MANDATORY per v3 Boot Sequence Phase 0):

```bash
curl -s -H "Authorization: Bearer $BACKEND_KEY" -H "Content-Type: application/json" \
  -d '{"tool":"audit.lessons","payload":{"agentId":"<v-prop-tool-name>"}}' \
  $BACKEND/api/mcp/route
```

Then integrate pending lessons into the tool's current strategy and `audit.acknowledge`.

After significant output (V1 audit report, V4 deliverable, V8 DD memo), call `audit.run`:

```bash
curl -s -H "Authorization: Bearer $BACKEND_KEY" -H "Content-Type: application/json" \
  -d '{"tool":"audit.run","payload":{"agentId":"<agent>","output":"<generated>"}}' \
  $BACKEND/api/mcp/route
```

**Observation from W6/W7 QA:** Qwen's deliverables did not include lesson-check in tool-executor cases. This is a retrofit task.

### 2.6 Adoption telemetry — automatic for new tools

Existing `recordToolCall(toolName)` is called from `tool-executor.ts` wrapper. v4 tools inherit this free. Verification step per week:

```bash
# after tool registered, verify it shows up in adoption index
curl -s -H "Authorization: Bearer $ORCH_KEY" \
  $ORCH/api/adoption/telemetry | jq '.tools[] | select(.name == "<new_tool>")'
```

### 2.7 Peer-eval — cross-agent quality signal

v4 tools that produce quality-sensitive output (V1 gap report, V4 deliverable, V8 memo) auto-register with peer-eval:

```typescript
import { evaluatePeer } from '../swarm/peer-eval.js'
const peerScore = await evaluatePeer({
  evaluator_id: 'peer-eval',
  target_agent: 'compliance-officer',
  task_type: 'ai-act-audit',
  output: auditReport.summary,
  rubric: ['accuracy','coverage','actionability'],
})
```

Feeds into `peer_eval_analyze` for weekly fleet intelligence.

### 2.8 Flywheel — pillar contributions

v4 value-props contribute to the 5-pillar compound score:

| Pillar | V-prop contribution |
|--------|---------------------|
| Cost Efficiency | V3 rollup → direct input to `scoreCostEfficiency` |
| Fleet Intelligence | V2 reviewer fleet quality → peer-eval scores |
| Adoption | V1/V4/V6 new tools increment advanced-tool usage |
| Pheromone Signal | every V-prop deposits + senses → raises `activePheromones` |
| Platform Health | V5 drift monitor → directly feeds `scorePlatformHealth` |

**Verification per week:** `flywheel_metrics` compound score should tick up weekly as v-props mature.

---

## 3. Retrofit plan — Weeks 6.5 and 8.5 adoption spikes

Don't reopen delivered weeks. Add two 2-day adoption spikes to patch coordination into live value-props.

### Week 6.5 — Adoption Patch for V1/V3/V5 (2 days)

Deliverables:
1. `src/coordination/claim-helper.ts` — shared helper `writeClaim(scope, vprop)`, `readOverlap(scope_prefix)`, `writeClosure(scope, outcome, summary)`
2. Wire into `compliance_gap_audit`, `engagement_cost_report`, `agent_drift_report` tool-executor cases
3. Pheromone deposits on V1 completion (`intensity = compliance_score/100`), V5 alert on flagged agents
4. `audit.lessons` + `audit.acknowledge` at tool boot
5. Regression test: run two V1 audits for same client within 15 min → second returns `conflict` advisory per `:AgentConflict` contract
6. Runbook §9 extended with coordination troubleshooting

Exit gates:
- [ ] Every W6 tool writes claim before work, closure after
- [ ] Pheromone deposits visible in `pheromone_status` after V1/V5 runs
- [ ] `audit.lessons` called at boot (log confirms)
- [ ] Peer-eval writes scores for V1 outputs
- [ ] Adoption telemetry shows V1/V3/V5 tool hits

### Week 8.5 — Adoption Patch for V2/V4 (2 days, after Week 8)

Deliverables:
1. Wire V2 pheromone sensing into reviewer selection
2. Wire V4 pheromone deposits on cited sources
3. Wire V2/V4 claim-before-work
4. V2 fold per-file for diffs >4000 tokens
5. V4 `audit.run` on generated deliverable
6. Regression tests for each
7. Runbook §10 troubleshooting extended

Exit gates same shape as 6.5.

---

## 4. Integration into Week 8 and 9 (inline, not retrofit)

Week 8 and 9 have not shipped yet — adoption gets baked in as normative constraints.

### Week 8 (V6, V7) adds:

- V6 corpus sync: **pheromone deposit** per ingested prompt (`type='INTEL', domain='prompts'`) so v-props can sense which prompt categories are freshly updated
- V7 RAG router: **pheromone-weighted strategy selection** — router reads `pheromone_heatmap({domain:'rag'})` before picking simple/multi-hop/ppr/community
- V7 audit trail: every router decision writes `:AgentMemory {type:'routing-decision'}` for operator observability (O4 in Mission Control)

New exit gates for W8:
- [ ] V6 ingestion pheromone visible within 5 min
- [ ] V7 router decision recorded per call (sampling: every 10th)
- [ ] Both tools call `audit.lessons` at boot

### Week 9 (V8, V9, V10) adds:

- V8 OSINT: each scan writes `:OSINTScan` node AND pheromone deposit (`type='INTEL', intensity = findings_severity`)
- V9 DSPy loop: **OODA via Loop Orchestrator** — no hand-rolled iteration. Each iteration writes `:AgentMemory {key:'tuning-<prompt_id>-<iter>'}` for observability
- V10 bi-temporal: **teacher/student on lesson supersession** — when a `:Lesson` is superseded, the replacing lesson auto-propagates via `SHOULD_AWARE_OF` to all agents (old lesson becomes `invalid_at=now`, new lesson `valid_from=now`)

New exit gates for W9:
- [ ] V8 generates `:OSINTScan` + pheromone
- [ ] V9 uses `run_chain({mode:'loop'})` (grep confirms no raw `while/for` around LLM calls)
- [ ] V10 migration preserves `SHOULD_AWARE_OF` chain — query proves old lesson has `invalid_at`, new has `valid_from`

---

## 5. Frontend (Week 10–12 + 13–14) — surface adoption signal

Mission Control routes already include A2A bus + episode browser. Add explicit adoption widgets:

| Route | New widget | Data source |
|-------|-----------|-------------|
| `/mission/fleet` | **Claim badges** on each agent card | `:AgentMemory {type:'claim'}` last 30 min |
| `/mission/a2a-bus` | **Pheromone overlay** (intensity + decay) | `pheromone_heatmap` SSE |
| `/fleet/drift` | **Lesson chain** linked to each drift | `:Lesson`-`[:SHOULD_AWARE_OF]`-`(:Agent)` |
| `/skills` | **Adoption score** per prompt (usage × quality) | `adoption-telemetry` + peer-eval |
| `/mission/episodes` | **OODA phase indicator** on loop-orch episodes | `:Episode.phase ∈ {observe,orient,decide,act}` |

Shared UI primitive addition (§3 of FRONTEND_CORE_PLAN):

- **`<ClaimBanner />`** — if viewing a resource (engagement, PR, client) with active claim, show who's working on it + expected completion
- **`<PheromoneStrip />`** — tiny heatmap for a domain (top of search / dispatch dialogs)
- **`<LessonChain />`** — timeline of superseded lessons for a given topic

---

## 6. QA additions — Claude's expanded checklist (applied retroactively to W6/W7)

For every future Qwen delivery, Claude QA must verify:

| Check | Pass criteria |
|-------|---------------|
| Claim-before-work | grep tool handler → finds `writeClaim` / `graph.write_cypher` with `type:'claim'` |
| Closure broadcast | grep tool handler → finds closure write on success AND failure paths |
| Pheromone deposit (where applicable) | `pheromone_deposit` called post-success |
| RAG instead of ad-hoc LLM | grep for `fetch.*openai\|anthropic\|gemini` outside `llm-proxy.ts` → 0 hits |
| Context folding on large inputs | `foldIfLarge` helper used before RLM/LLM call |
| OODA via Loop Orchestrator | no raw `while.*LLM\|for.*LLM` loops in v-prop code |
| `audit.lessons` at boot | tool handler opens with lesson check |
| `audit.run` on major output | after V1/V4/V8 output generation |
| Adoption telemetry auto-increment | new tool visible in `/api/adoption/telemetry` within 1 hour of first call |

Any failure → CONDITIONAL BLOCK; patch in next Adoption Spike.

---

## 7. Success metrics (additive to v4 §7)

| Metric | Target after Week 9 |
|--------|--------------------|
| Claim-before-work adoption rate (v4 tools) | 100% (all 10 V-props write claims) |
| Pheromone deposits/day (from v-props) | >50 |
| RAG calls / total tool calls (v-prop-originated) | >0.6 |
| Lessons acknowledged / pending ratio | >0.9 |
| Flywheel compound score weekly delta | +0.03 (from 0.40 → ~0.52 over 4 weeks) |
| OODA cycle opt-in rate (iterative v-props) | 100% (V5/V9 use loop-orch) |
| Peer-eval coverage on output-generating v-props | V1/V4/V8 every call |

---

## 8. What this costs (timebox)

- Week 6.5 adoption patch: 2 days (Qwen + Claude QA)
- Week 8.5 adoption patch: 2 days
- Inline W8/W9 additions: +1 day per week (absorbed in plan)
- Frontend widgets: +2 days in W10-12

Total: ~7 days over the v4 roadmap — keeps us inside the 14-week horizon.

---

## 9. Summary — what changes in v4

The value-prop code isn't the problem; the missing adoption wire-up is. v4 now explicitly requires every tool to:

1. **Claim** before work, **close** after
2. **Sense pheromones** before routing decisions, **deposit** after outcome
3. **Go through RAG** for any evidence need (never raw LLM)
4. **Fold context** when >2000 tokens
5. **Loop via Loop Orchestrator** (never inline while/for around LLM)
6. **Check + acknowledge lessons** at boot; **audit.run** on major outputs
7. **Adoption telemetry** auto-registers (free via existing hook)
8. **Peer-eval** on quality-sensitive outputs

This is not "new work" — it's gluing what already exists. The plan just made it explicit.
