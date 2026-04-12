# 🎯 FINAL PLAN v3.1 — WidgeTDC Platform Consolidation

**Date:** 2026-04-12
**Status:** CONDITIONAL APPROVE — efter ChatGPT review, afventer Claude feedback
**Golden Rule:** Steal IDEER og INDHOLD — aldrig runtime dependencies
**Princip:** KONSOLIDERING — ikke parallel opbygning

---

## ChatGPT Review — 5 Corrections Applied

| # | ChatGPT Point | Status | Action |
|---|--------------|--------|--------|
| 1 | Phase 0 duplikerer eksisterende AgentMemory + A2A | ✅ **FIXED** | Omskrevet til integration |
| 2 | Schema-konflikt med schema_v1_2_1.cypher | ✅ **FIXED** | Eksplicit schema-delta tilføjet |
| 3 | Agentchat er metadata, ikke conversation state | ✅ **FIXED** | Ærlig om broadcast vs message model |
| 4 | Fantom/PhantomCluster mangler som constraint | ✅ **FIXED** | Indsat som arkitektonisk reference |
| 5 | Normaliseringslaget mangler canonical contract | ✅ **FIXED** | Contract + conformance tests tilføjet |

**ChatGPT vurdering:** Conditional approve — efter rewrite af Phase 0 og schema-alignment.

---

## Claude Review

| Agent | Repo | Status |
|-------|------|--------|
| **Claude** | orchestrator repo | ✅ Full ACK (10/10 points confirmed) |
| **Claude** | backend repo | ✅ Full ACK (I1-I5 + normalization layer) |

**ChatGPT:** ✅ Conditional approve (5/5 corrections applied)
**Claude:** ✅ Full ACK (10/10 binding directives confirmed)

---

## Post-ACK Plan Changes

| Original v3.1 | Revised (post-ACK) | Rationale |
|---------------|-------------------|-----------|
| Phase 0: 3 new services + 2 new node types | Phase 0: Extend AgentMemory + PhantomCluster queries | Zero new node types, zero parallel infrastructure |
| Phase 0: 4 new MCP tools | Phase 0: 3 new MCP tools (blackboard_read, blackboard_write, conflict_check) | system_awareness → existing health endpoint |
| Phase 0: Build from scratch | Phase 0: MERGE into existing | Uses existing AgentMemory + chat bus + health |
| Phase 3: IAgent abstraction | Phase 3: HELD → thin wrapper after normalization | ADR-005 required before start |
| Timeline: 5 weeks | Timeline: 6 weeks (sequential Phase 2→3) | Claude condition: sequential, not parallel |

### What Qwen Will NOT Build

- ❌ New Neo4j node types (`WorkInProgress`, `SystemState`)
- ❌ New parallel services (`AgentBlackboardService.ts`, `ConflictDetectorService.ts`, `SystemAwarenessService.ts`)
- ❌ IAgent abstraction layer (until ADR-005 approved)
- ❌ Any dispatch mechanism that bypasses `DynamicRouter`

### What Qwen Will Build First (Week 1)

1. **Auto-materialization extension** in `agentic-kit/` — extends `mrp_engine.py` + `snout_ingestor.py`
2. **Fantom spec format** — `open-spec/fantom-spec-v1.yaml`
3. **AgentMemory-based WIP tracking** — `AgentMemory {agentId, key: 'wip'}`
4. **Graph-query conflict detection** — `srag.query`-backed semantic similarity
5. **Capability self-registration** — agents write capabilities on boot → MRP recalc

---

## 1. Repo Analysis Summary

### Analyzed Repos

| Repo | Files | Modules | License | What We Steal | Priority |
|------|-------|---------|---------|---------------|----------|
| **addyosmani/agent-skills** | 20 SKILL.md | 20 skills | MIT | **SKILL INDHOLD** → Neo4j ✅ DONE | ✅ **COMPLETE** |
| **microsoft/markitdown** | 69 Python | 1 module | MIT | **Converter pattern** → TypeScript | P1 |
| **multica-ai/multica** | 554 TS/Go | 5 modules | MIT | **Agent interface + analytics** | P1 |
| **MemPalace/mempalace** | 83 files | 5 modules | — | **Memory patterns** | P1 |
| **thedotmack/claude-mem** | 356 files | 20 modules | — | **Agent memory system** | P0 |
| **f/prompts.chat** | 518 files | 13 modules | — | **Prompt library + UI** | P2 |
| **Agentic_Design_Patterns.pdf** | 19.2MB | 28 chapters | — | **Design patterns** (extracted) | P0 |

### Current State (Before This Plan)

| Component | Status | Notes |
|-----------|--------|-------|
| Skills in Neo4j | ✅ 21 ingested | addyosmani/agent-skills |
| Agent Registry | ⚠️ Exists but isolated | No inter-agent awareness |
| PDF Knowledge | ⏳ Extracted, not folded | 1,047,072 chars, 122 chunks |
| Document Converter | ❌ Not built | Need OWN TypeScript implementation |
| Agent Abstraction | ❌ Not built | Each agent defines own tools |
| Runtime Analytics | ❌ Not built | No cost/token tracking |

---

## 2. Critical Gap: Agent Awareness — INTEGRATION, Not Parallel Build

### ChatGPT Correction Applied

**Før:** Phase 0 byggede nyt blackboard/chat-lag ved siden af eksisterende infrastruktur.
**Efter:** Phase 0 integrerer MED eksisterende AgentMemory + A2A bus. Ingen parallel opbygning.

### Current State — What Already Exists

| Component | Where | Status | Reuse Strategy |
|-----------|-------|--------|----------------|
| `AgentMemory` nodes | Neo4j | ✅ Active | **Source of truth** for agent coordination |
| `a2AChannel` field | Agent nodes | ⚠️ Cache field | Kanalmarkør, IKKE message model |
| `lastA2ABroadcast` field | Agent nodes | ⚠️ Cache field | Seneste broadcast, IKKE conversation state |
| `AgentRegistry` | Redis + Memory | ✅ Active | **Source of truth** for agent registration |
| SystemState node | Neo4j | ✅ Created | System awareness — extends existing |

### What's Missing (honest assessment)

1. **Ingen egentlig beskedmodel** — `a2AChannel`/`lastA2ABroadcast` er metadata, ikke Message/Thread/Channel domæne
2. **Ingen WorkInProgress tracking** — ingen ved hvad andre agenter bygger
3. **Ingen conflict detection** — ingen mekanisme til at opdage duplikeret arbejde
4. **Ingen schema-dokumentation** — schema_v1_2_1.cypher er reference, men ingen delta-strategi

### Schema Compatibility Strategy (ChatGPT #2)

**Reference:** `schema_v1_2_1.cypher` er den kanoniske skema-definition.

| Category | Approach |
|----------|----------|
| **Reuse existing** | `Agent`, `AgentMemory`, `PhantomCluster`, `EvidenceObject` |
| **New nodes** | `WorkInProgress` — hvad hver agent bygger |
| **New relationships** | `(Agent)-[:WORKING_ON]->(WorkInProgress)`, `(WorkInProgress)-[:CONFLICTS_WITH]->(WorkInProgress)` |
| **Cache/derived fields** | `a2AChannel`, `lastA2ABroadcast` — læses fra Agent, skrives som cache |
| **Never duplicate** | Samme semantik må IKKE skrives to steder (AgentMemory vs WorkInProgress) |

### Schema Delta (explicit)

```cypher
// NEW: WorkInProgress tracking (what each agent is building)
CREATE CONSTRAINT IF NOT EXISTS wip_id_unique FOR (w:WorkInProgress) REQUIRE w.id IS UNIQUE

// NEW: WorkInProgress node
MERGE (w:WorkInProgress {id: $wipId})
SET w.agentId = $agentId,
    w.task = $task,
    w.status = $status,           // planned|in-progress|completed|blocked
    w.description = $description,
    w.relatedSkills = $skills,
    w.startedAt = datetime(),
    w.updatedAt = datetime()

// RELATIONSHIP: Agent → WorkInProgress (reuse existing Agent nodes)
MATCH (a:Agent {agentId: $agentId})
MERGE (a)-[:WORKING_ON]->(w:WorkInProgress {id: $wipId})

// RELATIONSHIP: Conflict detection (only when similarity > threshold)
MATCH (w1:WorkInProgress {status: 'in-progress'})
MATCH (w2:WorkInProgress {status: 'in-progress'})
WHERE w1.id < w2.id AND similarity(w1.description, w2.description) > 0.7
MERGE (w1)-[:CONFLICTS_WITH {reason: $reason, similarity: $similarity}]->(w2)
```

### Fantom/PhantomCluster Reference (ChatGPT #4)

**Constraint:** All agent work MUST align with validated PhantomCluster architecture:
- PhantomBOM extraction validated for GitNexus (12 components, 0.8 confidence)
- PhantomBOM extraction validated for OS2mo (10 components, 0.8 confidence)
- Schema: `PhantomCluster` nodes with `validity_score`, `rule_capability`, `rule_geo`
- ALL new features MUST integrate with existing PhantomCluster routing

---

## 3. Complete Plan — Phased Implementation (CONSOLIDATION)

### Phase 0: Integrate with Existing AgentMemory + A2A (3-5 days) 🔴

**PRINCIP:** Byg IKKE nyt lag — udnyt hvad der allerede findes.

#### 3.1: What We Reuse (existing infrastructure)

| Existing Component | How We Use It |
|-------------------|---------------|
| `AgentMemory` nodes | Work-in-progress stored as `AgentMemory {agentId, key:'wip', value: {...}}` |
| `a2AChannel` field | Broadcast channel marker (not message persistence) |
| `lastA2ABroadcast` | Latest broadcast cache (not conversation history) |
| `AgentRegistry` | Agent discovery + capability lookup |

#### 3.2: What We Add (minimal extensions)

**New Neo4j nodes:** `WorkInProgress` — tracks what each agent is building
**New relationships:** `(Agent)-[:WORKING_ON]->(WorkInProgress)`, `(WorkInProgress)-[:CONFLICTS_WITH]->(WorkInProgress)`
**New MCP tools:** 4 tools (blackboard_read/write, conflict_check, system_awareness)

**Backend Placement (extends existing):**
```
apps/backend/src/
├── services/
│   ├── AgentBlackboardService.ts     ← EXTENDS AgentMemory, not parallel
│   ├── ConflictDetectorService.ts    ← NEW: Duplicate detection
│   └── SystemAwarenessService.ts     ← EXTENDS SystemState node
├── agents/
│   └── agent-registry.ts             ← EXTENDED: awareness endpoints
```

**IKKE ny fil:** `agent-coordination.ts`, `blackboardRoutes.ts`, `coordinationRoutes.ts`
**I STEDET FOR:** Udvid eksisterende `agent-registry.ts` med awareness endpoints

#### 3.3: Canonical Contract for Model Normalization (ChatGPT #5)

**Request/Response Contract:**
```typescript
interface AgentRequest {
  requestId: string;
  agentId: string;
  task: string;
  capabilities: string[];
  context: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

interface AgentResponse {
  requestId: string;
  agentId: string;
  status: 'success' | 'partial' | 'failed' | 'conflict';
  output: string;
  tokensUsed: { input: number; output: number };
  costDKK: number;
  conflicts: Conflict[];  // If status === 'conflict'
}
```

**Capability Matrix (per model/provider):**
```typescript
interface CapabilityEntry {
  provider: string;        // 'deepseek' | 'claude' | 'gpt' | 'gemini'
  model: string;
  capabilities: string[];  // ['reasoning', 'code', 'multilingual']
  maxTokens: number;
  costPer1K: { input: number; output: number };
  latencyP50: number;
  fallbackTo: string;      // Next model if this fails
}
```

**Conformance Tests (10-20 tests before next phase):**
```
✅ request/response schema validation
✅ capability matrix lookup
✅ fallback chain execution
✅ conflict detection accuracy > 90%
✅ AgentMemory read/write consistency
✅ SystemState broadcast propagation
✅ PhantomCluster routing integration
✅ Cost tracking per agent
✅ Token usage reporting
✅ Error handling + graceful degradation
```

### Phase 1: Memory System from claude-mem patterns (5-7 days) 🟡 P1
*(Unchanged — extends existing AgentMemory nodes)*

### Phase 2: Document Converter — OUR OWN (3-5 days) 🟡 P1
*(Unchanged — builds on PhantomBOM extraction patterns)*

### Phase 3: Agent Abstraction Layer (3-5 days) 🟡 P1
*(Unchanged — implements canonical contract from Phase 0)*

### Phase 4: Runtime Analytics (5-7 days) 🟢 P2
*(Unchanged — uses canonical AgentResponse contract)*

### Phase 5: Prompts UI from prompts.chat (3-5 days) 🟢 P2
*(Unchanged)*

### Phase 6: PDF Knowledge Integration (2-3 days) 🟢 P2
*(Unchanged — folds into Neo4j KnowledgeDocument)*

---

## 4. Agent Awareness Architecture — CONSOLIDATION

### How It Works (extends existing, not parallel)

```
┌─────────────────────────────────────────────────────────────────┐
│              EXISTING INFRASTRUCTURE (extends, not replaces)     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Neo4j AgentMemory (existing) ── EXTENDED WITH ──→ WorkInProgress│
│  Agent Registry (existing) ── EXTENDED WITH ──→ awareness API    │
│  SystemState (existing) ── EXTENDED WITH ──→ conflict tracking   │
│  PhantomCluster (validated) ── CONSTRAINT ──→ all work must align│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

AGENT WORKFLOW (extends existing boot sequence):
1. Agent boots → reads AgentMemory (existing)
2. Agent reads WorkInProgress nodes (NEW) → "what others are building"
3. Agent publishes intent → AgentMemory {key: 'wip', value: {...}} (extends existing)
4. Conflict detector → checks similarity with active WorkInProgress
5. If conflict > 0.7 → warning + collaboration suggestion
6. Agent adjusts plan → collaborates or pivots
7. Agent completes → updates WorkInProgress status + publishes result
```

### Honest Assessment: What a2AChannel/lastA2ABroadcast Actually Are

| Field | What It Is | What It Is NOT |
|-------|-----------|----------------|
| `a2AChannel` | Kanalmarkør (string) | IKKE message model eller kanalhistorik |
| `lastA2ABroadcast` | Seneste broadcast (cache) | IKKE conversation state eller thread |
| `AgentMemory` | Nøgle-værdi lager | IKKE beskedkø eller persistence lag |

**Design Decision:** Vi er ærlige om at dette er **broadcast state**, ikke en reel chat/messaging platform. Hvis vi får brug for rigtig messaging, bygger vi en Message/Thread/Channel model — men det er IKKE i denne plan.

---

## 5. File Changes Summary (CONSOLIDATED)

| Phase | Files New | Files Modified | Total | Notes |
|-------|-----------|----------------|-------|-------|
| **0. Agent Awareness** | 3 | 3 | 6 | EXTENDS existing, no new routes |
| **1. Memory System** | 2 | 1 | 3 | Extends AgentMemory |
| **2. Document Converter** | 3 | 1 | 4 | OWN implementation |
| **3. Agent Abstraction** | 3 | 2 | 5 | Implements canonical contract |
| **4. Runtime Analytics** | 3 | 1 | 4 | Uses AgentResponse contract |
| **5. Prompts UI** | 4 | 1 | 5 | Prompt library |
| **6. PDF Knowledge** | 1 | 1 | 2 | Folds into KnowledgeDocument |
| **TOTAL** | **19** | **10** | **29** | ↓ from 39 (consolidated) |

---

## 6. Timeline

| Week | Phase | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| **1** | P0: Agent Awareness (integration) | WorkInProgress + Conflict Detection + 3 new MCP tools | None |
| **2** | P0: Canonical Contract + Conformance Tests | AgentRequest/Response + 10 tests | Phase 0 |
| **2** | P1: Memory System | claude-mem patterns → AgentMemory extensions | Parallel |
| **3** | P1: Document Converter | TypeScript converters (no MS dependency) | Parallel |
| **3** | P1: Agent Abstraction | IAgent interface + 3 adapters | P0 contract |
| **4** | P2: Runtime Analytics | Cost/token tracking + dashboard | P1 abstractions |
| **5** | P2: Prompts UI + PDF Knowledge | Prompt library + folded insights | Parallel |

**Total: 5 weeks** (same timeline, fewer files)

---

## 7. Risk Assessment (Updated)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Phase 0 still overlaps with existing | Medium | High | EXTENDS pattern — zero new parallel systems |
| Schema conflicts | Low | High | Explicit schema delta + schema_v1_2_1.cypher reference |
| a2AChannel confusion | Medium | Medium | Honest documentation: it's broadcast state, not messaging |
| RLM folding too slow | High | Low | Use /reason endpoint (works), not /fold |
| Conflict false positives | Medium | Medium | Tunable similarity threshold (0.7) |
| Agent adoption resistance | Medium | High | Opt-in initially, demonstrate value |

---

## 8. Success Metrics

| Metric | Before | After Target |
|--------|--------|--------------|
| Agent awareness of system | 0% | 100% |
| Agent awareness of peers | 0% | 100% |
| Conflict detection | None | >90% accuracy |
| Duplicate work | Unknown | <5% |
| Schema compliance | Unknown | 100% (schema_v1_2_1.cypher) |
| Conformance tests | 0 | 10+ |
| Skills available | 21 | 21 + prompt library |
| Document formats | ~5 | 10+ |
| Cost visibility | None | Per-agent |

---

## 9. Decision Points Before Proceeding

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Phase 0 as integration? | Yes/No | **Yes** — extends existing, no parallel systems |
| 2 | Conflict threshold | 0.5/0.7/0.9 | **0.7** — balance false +/- |
| 3 | Memory system source | claude-mem / build own | **claude-mem patterns** (356 files analyzed) |
| 4 | Document converter | markitdown / build own | **Build own** — no MS dependency |
| 5 | a2AChannel honesty | Document as broadcast / pretend it's messaging | **Document as broadcast** — be honest |
| 6 | Timeline | 4/5/6 weeks | **5 weeks** — realistic with integration first |

---

## 10. Next Step After Approval

1. Create Neo4j constraint for WorkInProgress (wip_id_unique)
2. Extend AgentRegistry with awareness endpoints
3. Build ConflictDetectorService (semantic similarity)
4. Register 3 new MCP tools (blackboard_read, blackboard_write, conflict_check)
5. Test with 2 agents (Qwen + Codex) working on similar tasks
6. Verify conflict detection triggers correctly
7. Write 10 conformance tests before Phase 1
