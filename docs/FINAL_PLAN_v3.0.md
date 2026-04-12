# 🎯 FINAL PLAN v3.0 — WidgeTDC Complete Platform

**Date:** 2026-04-12
**Status:** AWAITING APPROVAL — DO NOT PROCEED UNTIL CONFIRMED
**Golden Rule:** Steal IDEER og INDHOLD — aldrig runtime dependencies

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

## 2. Critical Gap: Agent Awareness & Conflict Prevention

### Current Problem

**Agents work in silos.** No mechanism exists for:

1. **System Awareness** — Agents don't know what system they're running in
2. **Peer Awareness** — Agents don't know what other agents are building
3. **Conflict Detection** — No prevention of duplicate/conflicting solutions
4. **Shared Context** — No blackboard for shared state between agents

### Evidence

**AgentRegistry.ts** (current state):
```typescript
// agents register independently — NO coordination
registry.set(handshake.agent_id, entry)
// No shared state, no peer discovery, no conflict detection
```

**Missing Components:**
- ❌ Agent-to-Agent awareness system
- ❌ Work-in-progress registry (what is each agent building?)
- ❌ Conflict detection engine
- ❌ Shared blackboard / common knowledge base
- ❌ System state broadcast mechanism

---

## 3. Complete Plan — Phased Implementation

### Phase 0: Agent Awareness & Coordination System (P0 — 3-5 days) 🔴

**WHY FIRST:** Without this, ALL future agent work creates duplicate/conflicting solutions.

#### 3.1: Agent Blackboard Protocol

**Source:** Inspired by `MemPalace/mempalace` (memory sharing patterns) + `claude-mem` (356 files of memory implementation)

**New Neo4j Schema:**
```cypher
// WorkInProgress node — what each agent is currently building
(wip:WorkInProgress {
  id: "wip-uuid",
  agentId: "qwen",
  task: "Build document converter",
  status: "in-progress",        // planned|in-progress|completed|blocked
  startedAt: datetime(),
  estimatedCompletion: datetime(),
  description: "TypeScript document converter inspired by markitdown",
  relatedSkills: ["context-engineering", "api-and-interface-design"],
  dependencies: [],
  conflicts: []                 // Populated by conflict detector
})

// SystemState node — shared system awareness
(ss:SystemState {
  id: "system-state",
  updatedAt: datetime(),
  totalAgents: 341,
  activeAgents: 287,
  currentWorkItems: 12,
  recentCompletions: ["agent-skills-ingestion", "pdf-extraction"],
  knownConflicts: 0,
  platformHealth: "healthy"
})

// Relationships
(Agent)-[:WORKING_ON]->(WorkInProgress)
(Agent)-[:AWARE_OF]->(SystemState)
(WorkInProgress)-[:DEPENDS_ON]->(WorkInProgress)
(WorkInProgress)-[:CONFLICTS_WITH]->(WorkInProgress {reason: "..."})
```

**Backend Placement:**
```
apps/backend/src/
├── services/
│   ├── AgentBlackboardService.ts     ← NEW: Shared state management
│   ├── ConflictDetectorService.ts    ← NEW: Duplicate/conflict detection
│   └── SystemAwarenessService.ts     ← NEW: System state broadcast
├── agents/
│   ├── agent-registry.ts             ← EXTENDED: Add awareness endpoints
│   └── agent-coordination.ts         ← NEW: Peer discovery
└── routes/
    ├── blackboardRoutes.ts           ← NEW: Blackboard CRUD
    └── coordinationRoutes.ts         ← NEW: Agent coordination
```

**MCP Tools (4 new):**
```typescript
// 1. blackboard_read — Read shared blackboard state
// 2. blackboard_write — Write work-in-progress to blackboard
// 3. conflict_check — Check if current work conflicts with others
// 4. system_awareness — Get current system state + active agents
```

#### 3.2: How Agents Stay 100% Aware

**On Agent Boot:**
```
1. Agent registers → AgentRegistry
2. Agent reads SystemState → "341 agents, 287 active"
3. Agent reads Blackboard → "12 work items in progress"
4. Agent publishes own work → "qwen: building document converter"
5. Conflict detector checks → "No conflicts detected" or "CONFLICT with codex"
6. Agent adjusts plan based on awareness
```

**During Agent Work:**
```
1. Agent starts task → blackboard_write("starting X")
2. Every 5 minutes → heartbeat update
3. Every 30 minutes → conflict_check()
4. On completion → blackboard_write("completed X") + publish result
```

**Conflict Detection Algorithm:**
```typescript
class ConflictDetectorService {
  async checkForConflicts(agentId: string, taskDescription: string): Promise<Conflict[]> {
    // 1. Find all active WorkInProgress nodes
    const activeWork = await neo4jService.query(`
      MATCH (wip:WorkInProgress {status: 'in-progress'})
      WHERE wip.agentId <> $agentId
      RETURN wip
    `, { agentId });

    // 2. Compare task descriptions using semantic similarity
    const conflicts = [];
    for (const other of activeWork) {
      const similarity = computeSimilarity(taskDescription, other.description);
      if (similarity > 0.7) {
        conflicts.push({
          agentId: other.agentId,
          task: other.task,
          similarity,
          suggestion: `Consider collaborating with ${other.agentId} or pivoting approach`
        });
      }
    }
    return conflicts;
  }
}
```

### Phase 1: Memory System from claude-mem (5-7 days) 🟡 P1

**Source:** `thedotmack/claude-mem` (356 files, 20 modules)

**What it provides:** Complete memory architecture for agents — short-term, long-term, episodic, semantic.

**What We Steal:** Memory patterns and architecture — NOT the code.

**Integration:**
- Extends existing Neo4j AgentMemory nodes
- Provides structured memory access for all 341 agents
- Enables agents to remember past work and learn from peers

### Phase 2: Document Converter — OUR OWN (3-5 days) 🟡 P1

**Inspiration:** `microsoft/markitdown` architecture pattern

**What We Build:** TypeScript converters using libraries we control:
- PDF: pdf-parse (npm, MIT)
- DOCX: mammoth (npm, MIT)
- HTML: turndown (npm, MIT)
- CSV: built-in Node.js

**NOT using markitdown Python package — building our own.**

### Phase 3: Agent Abstraction Layer (3-5 days) 🟡 P1

**Source:** `multica-ai/multica` agent interface patterns

**What:** IAgent interface for all 341 agents

### Phase 4: Runtime Analytics (5-7 days) 🟢 P2

**Source:** `multica-ai/multica` analytics patterns

**What:** Cost/token tracking per agent + dashboard

### Phase 5: Prompts UI from prompts.chat (3-5 days) 🟢 P2

**Source:** `f/prompts.chat` (518 files, 13 modules)

**What:** Prompt library UI + prompt management system

### Phase 6: PDF Knowledge Integration (2-3 days) 🟢 P2

**Source:** `Agentic_Design_Patterns.pdf` (1,047,072 chars extracted)

**What:** Fold insights via RLM → Neo4j KnowledgeDocument → Link to Skills

---

## 4. Agent Awareness Architecture

### Complete Flow — How Agents Never Conflict

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYSTEM AWARENESS LAYER                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Blackboard  │◄──►│  Conflict    │◄──►│  System      │      │
│  │  Service     │    │  Detector    │    │  State       │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Neo4j Graph (Shared State)                   │  │
│  │  WorkInProgress nodes, SystemState, Agent relationships   │  │
│  └──────────────────────────────────────────────────────────┘  │
│         │                                                      │
│         ▼                                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Agent Registry (Redis + Memory)              │  │
│  │  341 agents, capabilities, allowed tools, status          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

AGENT WORKFLOW (prevents conflicts):
1. Agent boots → reads SystemState
2. Agent publishes intent → blackboard_write("I'm building X")
3. Conflict detector → checks similarity with all active work
4. If conflict > 0.7 → agent receives warning + collaboration suggestion
5. Agent adjusts plan → either collaborates or pivots
6. Agent completes → publishes result to blackboard
7. Other agents become aware → can reuse/complement the work
```

---

## 5. File Changes Summary

| Phase | Files New | Files Modified | Total |
|-------|-----------|----------------|-------|
| **0. Agent Awareness** | 6 | 2 | 8 |
| **1. Memory System** | 4 | 1 | 5 |
| **2. Document Converter** | 3 | 1 | 4 |
| **3. Agent Abstraction** | 5 | 2 | 7 |
| **4. Runtime Analytics** | 4 | 1 | 5 |
| **5. Prompts UI** | 6 | 1 | 7 |
| **6. PDF Knowledge** | 2 | 1 | 3 |
| **TOTAL** | **30** | **9** | **39** |

---

## 6. Timeline

| Week | Phase | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| **1** | P0: Agent Awareness | Blackboard + Conflict Detection + System State | None |
| **2** | P1: Memory System | Memory architecture from claude-mem patterns | Phase 0 |
| **3** | P1: Document Converter | TypeScript converters (no MS dependency) | Parallel |
| **3** | P1: Agent Abstraction | IAgent interface + adapters | Parallel |
| **4** | P2: Runtime Analytics | Cost/token tracking + dashboard | Phase 2-3 |
| **5** | P2: Prompts UI | Prompt library from prompts.chat | Parallel |
| **5** | P2: PDF Knowledge | Folded insights → Neo4j | Parallel |

**Total: 5 weeks**

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RLM folding too slow | High | Low | Use /reason endpoint (works), not /fold |
| Conflict false positives | Medium | Medium | Tunable similarity threshold (0.7) |
| Neo4j query performance | Low | Medium | Index WorkInProgress.status, agentId |
| Agent adoption resistance | Medium | High | Make awareness opt-in initially |
| Duplicate work during transition | High | High | Phase 0 FIRST — prevents this |

---

## 8. Success Metrics

| Metric | Before | After Target |
|--------|--------|--------------|
| Agent awareness of system | 0% | 100% |
| Agent awareness of peers | 0% | 100% |
| Conflict detection | None | >90% accuracy |
| Duplicate work | Unknown | <5% |
| Skills available | 21 | 21 + prompt library |
| Document formats | ~5 | 10+ |
| Cost visibility | None | Per-agent |

---

## 9. Decision Points Before Proceeding

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Phase 0 first? | Yes/No | **Yes** — prevents all future conflicts |
| 2 | Conflict threshold | 0.5/0.7/0.9 | **0.7** — balance false +/- |
| 3 | Memory system source | claude-mem / build from scratch | **claude-mem patterns** (356 files analyzed) |
| 4 | Document converter | markitdown / build own | **Build own** — no MS dependency |
| 5 | Timeline | 4 weeks / 5 weeks / 6 weeks | **5 weeks** — realistic with Phase 0 first |

---

## 10. Next Step After Approval

1. Create Neo4j constraints for WorkInProgress and SystemState
2. Build AgentBlackboardService.ts
3. Build ConflictDetectorService.ts
4. Build SystemAwarenessService.ts
5. Register 4 new MCP tools
6. Test with 2 agents (Qwen + Codex) working on similar tasks
7. Verify conflict detection triggers correctly
