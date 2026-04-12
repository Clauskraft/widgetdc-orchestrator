# 🎯 COMPLETE STEAL PLAN — WidgeTDC v3.0

**Date:** 2026-04-12  
**Analysis:** 5 sources analyzed (3 repos + 1 PDF + PLATFORM_ARCHITECTURE.md)  
**Golden Rule:** Steal IDEER og INDHOLD — aldrig runtime dependencies  
**Total docs:** 1,176 lines (PLATFORM_ARCHITECTURE.md 916 + RUNBOOK.md 260)

---

## Sources Analyzed

| Source | Type | Lines | What We Steal |
|--------|------|-------|---------------|
| **addyosmani/agent-skills** | 20 SKILL.md (Markdown) | ~400 | Skill content → Neo4j ingestion |
| **microsoft/markitdown** | 69 Python files | ~5,000 | Converter architecture pattern only |
| **multica-ai/multica** | 554 TS/Go files | ~45,000 | Agent interface + analytics patterns |
| **Agentic_Design_Patterns.pdf** | PDF (19.2 MB) | Unknown | Design patterns → RLM folded insights |
| **PLATFORM_ARCHITECTURE.md** | Markdown | 916 | Complete platform map → integration points |
| **RUNBOOK.md** | Markdown | 260 | Ops procedures → deployment integration |

---

## Phase 0: PDF Knowledge Extraction (1-2 days) 🔴 P0

### Agentic_Design_Patterns.pdf → Extracted Structure

**Status:** ✅ PDF extraction complete (1,047,072 chars, 122 chunks)
**RLM folding:** ⚠️ Failed (DNS resolution errors — needs retry)
**Fallback:** Chunk truncation to 4000 chars

### Extracted Chapter Map (28 chapters — direct WidgeTDC relevance)

| Chapter | Topic | Pages | WidgeTDC Relevance | Priority |
|---------|-------|-------|-------------------|----------|
| **10. Model Context Protocol (MCP)** | MCP patterns | 16 | 🔴 **Direct** — WidgeTDC 200+ MCP tools | **P0** |
| **15. Inter-Agent Communication (A2A)** | A2A patterns | 15 | 🔴 **Direct** — WidgeTDC A2A protocol | **P0** |
| **17. Reasoning Techniques** | Reasoning patterns | 24 | 🔴 **Direct** — RLM Engine | **P0** |
| **18. Guardrails/Safety Patterns** | Safety patterns | 19 | 🔴 **Direct** — Governance system | **P0** |
| **19. Evaluation and Monitoring** | Eval patterns | 18 | 🔴 **Direct** — Analytics | **P0** |
| **12. Exception Handling and Recovery** | Error patterns | 8 | 🟡 **High** — Circuit breakers | **P1** |
| **13. Human-in-the-Loop** | HITL patterns | 9 | 🟡 **High** — HITL gate | **P1** |
| **14. Knowledge Retrieval (RAG)** | RAG patterns | 17 | 🟡 **High** — SRAG + GraphRAG | **P1** |
| **16. Resource-Aware Optimization** | Resource patterns | 15 | 🟡 **High** — Cost governance | **P1** |
| **20. Prioritization** | Priority patterns | 10 | 🟡 **High** — Task routing | **P1** |
| **21. Exploration and Discovery** | Discovery patterns | 13 | 🟢 **Medium** — Snout discovery | **P2** |
| **Appendix A: Advanced Prompting** | Prompting techniques | 28 | 🟢 **Medium** | **P2** |
| **Appendix C: Agentic Frameworks** | Framework comparison | 8 | 🟢 **Medium** | **P2** |
| **Appendix F: Reasoning Engines** | Engine internals | 14 | 🟢 **Medium** — RLM internals | **P2** |

### Where it lives

**File:** `apps/backend/src/services/PdfKnowledgeService.ts`

```typescript
class PdfKnowledgeService {
  // Execute pdf_chunk_fold.py via /usr/bin/python3
  async extractAndFoldPdf(pdfPath: string, query: string): Promise<string> {
    const result = await spawn('/usr/bin/python3', [
      'agentic-kit/pdf_chunk_fold.py',
      pdfPath, query, '8000', '4000'
    ], { shell: false });
    return result.stdout;
  }

  // Ingest folded knowledge into Neo4j
  async ingestFoldedKnowledge(foldedText: string, sourceDoc: string): Promise<void> {
    await neo4jService.write(
      `MERGE (d:KnowledgeDocument {source: $source})
       SET d.content = $content, d.foldedAt = datetime(),
           d.domain = 'agentic-design-patterns'`,
      { source: sourceDoc, content: foldedText }
    );
  }
}
```

**Neo4j Schema:**
```cypher
// KnowledgeDocument node
(d:KnowledgeDocument {
  source: "Agentic_Design_Patterns.pdf",
  content: "...folded insights...",
  domain: "agentic-design-patterns",
  foldedAt: datetime(),
  chapters: ["10-MCP", "15-A2A", "17-Reasoning", "18-Guardrails", "19-Evaluation"]
})

// Relationships
(KnowledgeDocument)-[:INFORMS]->(Skill)
(KnowledgeDocument)-[:APPLIES_TO]->(Capability)
```

---

## Phase 1: Ingest agent-skills Content (1-2 days) 🔴 P0

### What: 20 SKILL.md → Neo4j Skill nodes
**Source:** `skills/*/SKILL.md` from addyosmani/agent-skills

### Backend Placement

**File:** `apps/backend/src/routes/skillRoutes.ts`

```typescript
/**
 * SKILL ROUTES
 * 
 * POST /api/skills/ingest     — Ingest SKILL.md files from repo/URL
 * GET  /api/skills           — List all skills with filters
 * GET  /api/skills/:name     — Get skill details + workflow
 * POST /api/skills/:name/assign — Assign skill to agent
 * GET  /api/skills/triggers  — Get all trigger patterns
 */
```

**File:** `apps/backend/src/services/SkillService.ts`

```typescript
class SkillService {
  // Parse SKILL.md frontmatter + content
  async parseSkillMarkdown(md: string): Promise<SkillData>
  
  // Ingest 20 skills from agent-skills repo
  async ingestFromRepo(repoUrl: string): Promise<{ingested: number, errors: string[]}>
  
  // Match skill to task based on triggers
  async matchSkillToTask(taskDescription: string): Promise<SkillMatch[]>
  
  // Execute skill workflow
  async executeSkill(skillName: string, context: ExecutionContext): Promise<SkillResult>
}
```

### Neo4j Schema

```cypher
// Skill node
(s:Skill {
  name: "context-engineering",
  description: "Use when starting a new session...",
  category: "Build",
  workflow: "...",
  verification: ["Rules file exists", "Agent follows patterns"],
  antiRationalizations: [{excuse: "I'll add tests later", rebuttal: "..."}],
  redFlags: ["Agent output doesn't match conventions"],
  triggers: ["session-start", "quality-degradation"],
  sourceRepo: "https://github.com/addyosmani/agent-skills",
  license: "MIT"
})

// Relationships
(Agent)-[:HAS_SKILL]->(Skill)
(Skill)-[:APPLIES_TO]->(Capability)
(KnowledgeDocument)-[:INFORMS]->(Skill)
```

### MCP Tools (3 new)

**File:** `apps/backend/src/mcp/tools/skillTools.ts`

```typescript
// 1. skill_list — List available skills
// 2. skill_execute — Execute skill workflow
// 3. skill_match — Find skills matching current task
```

---

## Phase 2: Build OWN Document Converter (3-5 days) 🟡 P1

### ⚠️ PRINCIP: Inspiration fra markitdown — VORES EGEN implementation

**What we steal:** The converter pattern (BaseConverter → PDFConverter, DOCXConverter, etc.)  
**What we build:** TypeScript converters using libraries we already control

### Backend Placement

**File:** `apps/backend/src/services/DocumentConverterService.ts`

```typescript
interface IConverter {
  convert(buffer: Buffer, mimeType: string): Promise<string>;
  supportedMimeTypes: string[];
}

// Libraries we ALREADY use or can trivially replace:
// PDF: pdf-parse (npm, MIT)
// DOCX: mammoth (npm, MIT)
// HTML: turndown (npm, MIT)
// CSV: built-in Node.js
// Plain text: built-in
```

**File:** `apps/backend/src/routes/documentConverterRoutes.ts`

```typescript
/**
 * POST /api/documents/convert    — Upload file, get Markdown
 * POST /api/documents/ingest     — Upload file, convert + ingest to Neo4j
 * GET  /api/documents/formats    — List supported formats
 */
```

### Integration with PDF Folding

```
Upload PDF → DocumentConverterService → Markdown → 
  PdfKnowledgeService → RLM chunk fold → Neo4j KnowledgeDocument
```

---

## Phase 3: Agent Abstraction Layer (3-5 days) 🟡 P1

### What: IAgent interface for all 341 agents
**Source:** `multica-ai/multica/server/pkg/agent/*.go` (pattern only)

### Implementation

**File:** `apps/backend/src/agents/AgentInterface.ts`

```typescript
export interface IAgent {
  execute(task: AgentTask): Promise<AgentResult>;
  getCapabilities(): string[];
  getVersion(): string;
  getStatus(): AgentStatus;
  getUsage(): AgentUsage;
  isHealthy(): boolean;
}
```

**File:** `apps/backend/src/agents/adapters/`
- `HyperAgentAdapter.ts`
- `OmegaSentinelAdapter.ts`
- `SnoutAdapter.ts`

### Neo4j Update

```cypher
// Agent nodes get new properties
MATCH (a:Agent) SET a.interface = 'IAgent', a.version = a.version ?? 'unknown'

// New relationships
(Agent)-[:HAS_USAGE]->(AgentUsage)
(Agent)-[:APPLIED_SKILL]->(Skill)
```

---

## Phase 4: Runtime Analytics (5-7 days) 🟢 P2

### What: Cost/token tracking per agent + dashboard
**Source:** `multica-ai/multica/packages/views/runtimes/` (pattern only)

### Backend Service

**File:** `apps/backend/src/services/AgentUsageService.ts`

```typescript
class AgentUsageService {
  async recordUsage(result: AgentResult, agentId: string): Promise<void>
  async getDailyUsage(agentId: string, days: number): Promise<DailyUsage[]>
  async getCostByAgent(days: number): Promise<AgentCost[]>
  async getModelDistribution(days: number): Promise<ModelDistribution[]>
  async getActivityHeatmap(agentId: string): Promise<ActivityHeatmap>
}
```

**File:** `apps/backend/src/routes/agentAnalyticsRoutes.ts`

```typescript
/**
 * GET  /api/analytics/usage/:agentId   — Daily usage
 * GET  /api/analytics/cost             — Cost by agent
 * GET  /api/analytics/models           — Model distribution
 * GET  /api/analytics/heatmap/:agentId — Activity heatmap
 */
```

---

## Complete Architecture — Where Everything Lives

```
WidgeTDC Backend (apps/backend/src/)
├── routes/
│   ├── skillRoutes.ts                    ← NEW Phase 1
│   ├── documentConverterRoutes.ts        ← NEW Phase 2
│   ├── agentRoutes.ts                    ← EXTENDED Phase 3
│   └── agentAnalyticsRoutes.ts           ← NEW Phase 4
├── services/
│   ├── SkillService.ts                   ← NEW Phase 1
│   ├── DocumentConverterService.ts       ← NEW Phase 2
│   ├── PdfKnowledgeService.ts            ← NEW Phase 0
│   └── AgentUsageService.ts              ← NEW Phase 4
├── agents/
│   ├── AgentInterface.ts                 ← NEW Phase 3
│   └── adapters/                         ← NEW Phase 3
├── mcp/
│   └── tools/skillTools.ts               ← NEW Phase 1 (3 tools)
└── agentic-kit/
    ├── extract_and_fold_pdf.py           ← NEW Phase 0
    └── pdf_chunk_fold.py                 ← NEW Phase 0

Neo4j Graph (existing 993K nodes → ~1M after ingestion)
├── New Node Types
│   ├── Skill (0 → 20)                    ← Phase 1
│   ├── KnowledgeDocument (0 → N)         ← Phase 0
│   └── AgentUsage (0 → N)               ← Phase 4
├── New Relationships
│   ├── (Agent)-[:HAS_SKILL]->(Skill)
│   ├── (Skill)-[:APPLIES_TO]->(Capability)
│   ├── (KnowledgeDocument)-[:INFORMS]->(Skill)
│   ├── (Agent)-[:HAS_USAGE]->(AgentUsage)
│   └── (AgentUsage)-[:USED_SKILL]->(Skill)
└── Existing (unchanged)
    ├── Agent (11 → 341 unified)
    ├── Capability (86)
    ├── Tool (127)
    └── MCPTool (222)
```

---

## End-to-End Flow: Complete User Journey

```
User uploads: "Agentic_Design_Patterns.pdf"
  ↓
1. DocumentConverterService → extracts text (if PDF)
  ↓
2. PdfKnowledgeService → chunks + RLM fold → KnowledgeDocument
  ↓
3. SkillMatcher scans folded content
   MATCH: "context-engineering", "planning-and-task-breakdown"
  ↓
4. AgentSelector picks agent via IAgent interface
   MATCH: HyperAgent (validity: 0.92, cost: low)
  ↓
5. Agent executes task with skill context
  ↓
6. Usage recorded → AgentUsage node
  ↓
7. Neo4j updated:
   - (Agent)-[:HAS_USAGE]->(AgentUsage {costDKK: 0.034})
   - (Agent)-[:APPLIED_SKILL]->(Skill {name: "context-engineering"})
  ↓
8. Dashboard updated:
   - Daily cost chart +0.034
   - Skill usage +1
   - Agent activity heatmap updated
```

---

## Timeline & Milestones

| Week | Phase | Deliverable | Files Changed | Depends On |
|------|-------|-------------|---------------|------------|
| **0** | PDF Knowledge Extraction | pdf_chunk_fold.py + PdfKnowledgeService | 3 new | None |
| **1** | Ingest agent-skills | 20 Skill nodes + skillRoutes + SkillService | 4 new, 2 modified | Phase 0 |
| **2** | Document Converter | DocumentConverterService + routes | 3 new, 1 modified | Parallel |
| **2** | Agent Abstraction | IAgent + 3 adapters | 5 new, 1 modified | Parallel |
| **3** | Runtime Analytics | AgentUsageService + analytics routes | 4 new, 1 modified | Phase 2-3 |
| **4** | Skills UI Dashboard | 5 Recharts components | 6 new, 1 modified | Phase 1-3 |

**Total: ~30 files across 4 weeks**

---

## Deployment Checklist

### Pre-Deployment
- [ ] Neo4j constraints: `skill_name_unique`
- [ ] Python scripts: `extract_and_fold_pdf.py`, `pdf_chunk_fold.py` → agentic-kit/
- [ ] Dockerfile: Ensure `python3` installed, `COPY agentic-kit ./agentic-kit`
- [ ] Neo4j indexes: `Skill.name`, `AgentUsage.date`, `KnowledgeDocument.source`

### Deployment
- [ ] Backend deploy (PR #4310 merged first — PLATFORM_ARCHITECTURE.md)
- [ ] Neo4j schema migration
- [ ] Skill ingestion (20 SKILL.md → Neo4j)
- [ ] PDF ingestion (Agentic_Design_Patterns.pdf → KnowledgeDocument)
- [ ] Tool registration (3 skill MCP tools)
- [ ] Frontend deploy (analytics components)

### Post-Deployment Verification
- [ ] GET /api/skills → returns 20 skills
- [ ] POST /api/documents/convert → PDF → Markdown
- [ ] POST /api/agents/execute → IAgent interface works
- [ ] GET /api/analytics/cost → returns cost data
- [ ] Skill auto-trigger → matches task description
- [ ] PDF fold → KnowledgeDocument created in Neo4j
- [ ] Usage tracking → AgentUsage nodes created

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RLM fold rate limits | Medium | Low | Chunk with 0.5s delay, retries |
| PDF extraction fails | Low | Low | Multiple library fallbacks |
| Skill ingestion fails on malformed MD | Low | Low | Validate frontmatter before MERGE |
| IAgent breaks existing agents | Medium | High | Adapter pattern, gradual rollout |
| Usage tracking adds latency | Low | Medium | Async recording, batch writes |
| Neo4j schema migration fails | Low | High | Test on staging first |

---

## ROI Estimate

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Skills available | 0 | 20 | **∞** |
| Document formats | ~5 | 10+ | **2x** |
| Agent routing | Manual | Automatic via IAgent | **10x faster** |
| Cost visibility | None | Per-agent | **100%** |
| Knowledge extraction | Manual reading | RLM auto-fold | **100x faster** |
| Quality enforcement | None | 20 skill gates | **Zero unverified** |

---

## Sources

1. **addyosmani/agent-skills** — https://github.com/addyosmani/agent-skills (20 SKILL.md, MIT)
2. **microsoft/markitdown** — https://github.com/microsoft/markitdown (69 Python, MIT)
3. **multica-ai/multica** — https://github.com/multica-ai/multica (554 TS/Go, MIT)
4. **Agentic_Design_Patterns.pdf** — C:\Users\claus\Downloads\ (19.2MB PDF)
5. **PLATFORM_ARCHITECTURE.md** — WidgeTDC/docs/ (916 lines, PR #4310)
6. **RUNBOOK.md** — WidgeTDC/docs/ (260 lines, merged)
7. **WidgeTDC Backend** — apps/backend/src/ (existing routes + services)
8. **WidgeTDC Orchestrator** — src/tools/ (existing tool registry)
9. **WidgeTDC Graph** — Neo4j (993K nodes, 2.1M relationships)
