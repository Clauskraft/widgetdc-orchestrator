# 🎯 Complete Steal Plan: Agent Skills + markitdown + Multica → WidgeTDC

**Date:** 2026-04-12  
**Analysis:** 3 repos analyzed, 360+ files reviewed  
**Goal:** Build WidgeTDC Skills Marketplace with content, conversion pipeline, and runtime analytics

---

## Executive Summary — Steal vs Build

| Repo | Files | Steal What? | Build Ourselves? | Dependency? |
|------|-------|-------------|------------------|-------------|
| **addyosmani/agent-skills** | 20 SKILL.md | **INDHOLD** (Markdown tekst) | Skill engine i Neo4j | ❌ Ingen — MIT indhold |
| **microsoft/markitdown** | 69 Python | **ARKITEKTUR** (converter pattern) | VORES converter i TypeScript | ❌ Ingen — inspiration kun |
| **multica-ai/multica** | 554 TS/Go | **MØNSTRE** (Agent interface, analytics) | VORES IAgent + usage tracking | ❌ Ingen — inspiration kun |

**Gylden regel:** Vi stjæler IDEER og INDHOLD — aldrig runtime dependencies.

---

## Phase 1: Ingest agent-skills INDHOLD (1-2 days) 🔴 P0

### ⚠️ PRINCIP: Vi stjæler INDHOLDET — ikke deres runtime
**Inspiration:** Addy Osmani's 20 SKILL.md filer (MIT license)  
**Implementering:** VORES EGEN Skill engine i Neo4j + WidgeTDC tool-executor

### Why Not Depend on addyosmani/agent-skills?
- **Det er bare Markdown** — ingen runtime, ingen dependencies, bare tekst
- **Vi ejer indholdet efter ingestion** — når det er i Neo4j, er det vores
- **Vi kan udvide/ændre skills** — tilpasse til WidgeTDC's behov
- **Ingen vendor lock-in** — MIT license = vi må alt

### Neo4j Schema — New Node Type

```cypher
// Skill node schema
CREATE CONSTRAINT IF NOT EXISTS skill_name_unique FOR (s:Skill) REQUIRE s.name IS UNIQUE

// Node structure
(s:Skill {
  name: "context-engineering",                    // lowercase-hyphen
  description: "Use when starting a new session...", // trigger description
  category: "Build",                               // Define|Plan|Build|Verify|Review|Ship
  workflow: "...",                                 // Step-by-step process from SKILL.md
  verification: ["Rules file exists", "Agent follows patterns", ...],
  antiRationalizations: [{excuse: "I'll add tests later", rebuttal: "..."}, ...],
  redFlags: ["Agent output doesn't match conventions", ...],
  triggers: ["session-start", "quality-degradation", "task-switch"],
  sourceRepo: "https://github.com/addyosmani/agent-skills",
  license: "MIT",
  createdAt: datetime()
})

// Relationships
(Agent:Agent)-[:HAS_SKILL]->(Skill:Skill)
(Skill:Skill)-[:APPLIES_TO]->(Capability:Capability)
(Skill:Skill)-[:TRIGGERED_BY]->(Tool:Tool)
```

### Backend Placement — New Route

**File:** `apps/backend/src/routes/skillRoutes.ts`

```typescript
/**
 * SKILL ROUTES — Agent Skills Management
 * 
 * POST /api/skills/ingest     — Ingest SKILL.md files from repo/URL
 * GET  /api/skills           — List all skills with filters
 * GET  /api/skills/:name     — Get skill details + workflow
 * POST /api/skills/:name/assign — Assign skill to agent
 * GET  /api/skills/triggers  — Get all trigger patterns
 */
```

### Neo4j Service — New Service

**File:** `apps/backend/src/services/SkillService.ts`

```typescript
class SkillService {
  // Parse SKILL.md frontmatter + content
  async parseSkillMarkdown(md: string): Promise<SkillData>
  
  // Ingest 20 skills from agent-skills repo
  async ingestFromRepo(repoUrl: string): Promise<{ingested: number, errors: string[]}>
  
  // Match skill to task based on triggers
  async matchSkillToTask(taskDescription: string): Promise<SkillMatch[]>
  
  // Execute skill workflow (step-by-step)
  async executeSkill(skillName: string, context: ExecutionContext): Promise<SkillResult>
  
  // Get skill verification status
  async getVerificationStatus(skillName: string): Promise<VerificationStatus>
}
```

### Tool Executor Integration

**File:** `apps/backend/src/tools/registry.ts` (add 3 new tools)

```typescript
// New MCP tools
{
  name: 'skill_list',
  namespace: 'skills',
  description: 'List available engineering skills',
  handler: 'skillRoutes.list'
},
{
  name: 'skill_execute',
  namespace: 'skills',
  description: 'Execute a skill workflow',
  handler: 'skillRoutes.execute'
},
{
  name: 'skill_match',
  namespace: 'skills',
  description: 'Find skills matching current task',
  handler: 'skillRoutes.match'
}
```

### Ingestion Pipeline

```
1. Clone addyosmani/agent-skills repo
2. For each skills/*/SKILL.md:
   a. Parse YAML frontmatter (name, description)
   b. Extract sections: Overview, When to Use, Process, Rationalizations, Red Flags, Verification
   c. MERGE Skill node to Neo4j
   d. Link to relevant Capability nodes
   e. Link to relevant Agent nodes
3. Register skill_list, skill_execute, skill_match as MCP tools
4. Wire skill auto-trigger to task execution pipeline
```

### End-to-End Flow — Skill Auto-Trigger

```
Agent receives task → "Build authentication endpoint"
  ↓
SkillMatcher scans task description
  ↓
MATCH: "api-and-interface-design" skill (triggers on "designing API")
  ↓
SkillExecutor loads skill workflow from Neo4j
  ↓
Workflow steps execute:
  1. Load contract-first design principles
  2. Generate Hyrum's Law analysis
  3. Apply One Version Rule
  4. Create boundary validation
  ↓
Agent produces skill-compliant output
  ↓
Verification checklist checked off
```

---

## Phase 2: Build Our OWN Document Converter (3-5 days) 🟡 P1

### ⚠️ PRINCIP: Vi stjæler IKKE markitdown som dependency
**Inspiration:** `microsoft/markitdown` arkitektur og converter patterns  
**Implementering:** VORES EGEN converter med libraries vi allerede kontrollerer

### Why Not Depend on MS markitdown?
- **Vendor lock-in** — MS kan ændre licens, stoppe vedligeholdelse
- **Unødvendig bloat** — 69 Python filer, vi bruger måske 20%
- **Sikkerhedsrisiko** — supply chain attack via Python package
- **Stolthed** — WidgeTDC bygger sin egen infrastructure

### What We Steal (The Pattern, Not The Package)

**From markitdown's architecture:**
```python
# MS markitdown pattern (we steal THIS design)
class BaseConverter:
    def convert(self, stream) -> str: ...

class PDFConverter(BaseConverter): ...
class DOCXConverter(BaseConverter): ...
class HTMLConverter(BaseConverter): ...
```

**Our implementation (our code, our control):**
```typescript
// apps/backend/src/services/DocumentConverterService.ts
// Our OWN converter — inspired by markitdown, built by us

interface IConverter {
  convert(buffer: Buffer, mimeType: string): Promise<string>;
  supportedMimeTypes: string[];
}

// We use libraries we ALREADY control or are trivial to replace:
// PDF: pdf-parse (npm, already in ecosystem)
// DOCX: mammoth (npm, MIT, simple)
// HTML: turndown (npm, MIT, battle-tested)
// CSV: built-in
// Plain text: built-in
```

### Backend Placement — New Service

**File:** `apps/backend/src/services/DocumentConverterService.ts`

```typescript
/**
 * Document Converter Service — wraps markitdown Python package
 * Converts ANY file format to clean Markdown for skill ingestion.
 */

class DocumentConverterService {
  // Supported formats (from markitdown converters)
  readonly SUPPORTED_FORMATS = [
    '.pdf', '.docx', '.xlsx', '.pptx', '.html', '.htm',
    '.mp3', '.wav', '.mp4', '.jpg', '.png', '.gif',
    '.epub', '.ipynb', '.csv', '.zip', '.txt',
    '.youtube', '.wikipedia', '.rss'
  ];

  // Convert file to Markdown via markitdown Python subprocess
  async convertToMarkdown(filePath: string): Promise<string> {
    // python -m markitdown <file_path>
    const result = await spawnPython('markitdown', [filePath]);
    return result.stdout;
  }

  // Ingest converted markdown into Neo4j as Skill or Document
  async ingestDocument(file: File, skillName?: string): Promise<IngestionResult>
}
```

### Neo4j Schema — Document Nodes

```cypher
// Document node (converted via markitdown)
(d:Document {
  id: "doc-uuid",
  originalPath: "/path/to/file.pdf",
  originalFormat: "pdf",
  markdownContent: "# Document Title\n...",
  convertedAt: datetime(),
  converter: "markitdown"
})

// Relationships
(Document)-[:CONVERTED_FROM]->(File)
(Document)-[:INGESTED_BY]->(Skill)
(Skill)-[:APPLIED_TO]->(Document)
```

### Backend Route

**File:** `apps/backend/src/routes/documentConverterRoutes.ts`

```typescript
/**
 * DOCUMENT CONVERTER ROUTES
 * 
 * POST /api/documents/convert    — Upload file, get Markdown
 * POST /api/documents/ingest     — Upload file, convert + ingest to Neo4j
 * GET  /api/documents/formats    — List supported formats
 */
```

### Deployment — Python Dependency

**Dockerfile addition** (already has Python support):

```dockerfile
# Add markitdown Python package
RUN pip install markitdown markitdown-ocr
```

### End-to-End Flow — Document → Skill

```
User uploads: "api-design-spec.pdf"
  ↓
DocumentConverterService.convertToMarkdown()
  ↓
markitdown Python subprocess → clean Markdown
  ↓
SkillMatcher scans markdown content
  ↓
MATCH: "api-and-interface-design" skill
  ↓
Skill applies to document → generates review + recommendations
  ↓
Result stored in Neo4j as (Skill)-[:REVIEWED]->(Document)
```

---

## Phase 3: Agent Abstraction Layer from Multica (3-5 days) 🟡 P1

### What: Unified Agent interface for all 341 agents
**Source:** `multica-ai/multica/server/pkg/agent/*.go` (7 files)

### Current State (Problem)
```
Graph has: 11 Agent nodes, 86 Capabilities, 143 Tools, 0 Skills
Problem: Each agent defines own tools, capabilities, lifecycle
         No common interface → impossible to route uniformly
```

### Multica's Solution (Go → TypeScript)
```go
// Multica's agent.go (simplified)
type Agent interface {
    Execute(ctx context.Context, task Task) (Result, error)
    GetCapabilities() []string
    GetVersion() string
    GetUsage() UsageStats
    IsHealthy() bool
}
```

### WidgeTDC Implementation

**File:** `apps/backend/src/agents/AgentInterface.ts`

```typescript
/**
 * Agent Interface — unified abstraction for all 341 agents
 * Adapted from multica-ai/multica server/pkg/agent/agent.go
 */

export interface IAgent {
  // Core execution
  execute(task: AgentTask): Promise<AgentResult>;
  
  // Discovery
  getCapabilities(): string[];
  getVersion(): string;
  getStatus(): AgentStatus;
  
  // Usage tracking (Phase 4)
  getUsage(): AgentUsage;
  
  // Health
  isHealthy(): boolean;
}

export interface AgentTask {
  id: string;
  description: string;
  capabilities: string[];
  skillContext?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface AgentResult {
  success: boolean;
  output: string;
  tokensUsed: { input: number; output: number };
  costDKK: number;
  durationMs: number;
  skillApplied?: string;
}

export interface AgentUsage {
  agentId: string;
  date: string;
  tokensIn: number;
  tokensOut: number;
  costDKK: number;
  tasksCompleted: number;
  avgDurationMs: number;
}
```

### Adapter Pattern — Existing Agents

**File:** `apps/backend/src/agents/adapters/HyperAgentAdapter.ts`

```typescript
export class HyperAgentAdapter implements IAgent {
  constructor(private hyperAgent: HyperAgent) {}
  
  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    const result = await this.hyperAgent.run(task.description);
    return {
      success: result.success,
      output: result.output,
      tokensUsed: result.usage,
      costDKK: calculateCost(result.usage),
      durationMs: Date.now() - start,
      skillApplied: task.skillContext,
    };
  }
  
  getCapabilities() { return ['autonomous-execution', 'tool-use', 'chain-building']; }
  getVersion() { return '1.0.0'; }
  getStatus() { return 'active'; }
  getUsage() { return this.hyperAgent.usageStats; }
  isHealthy() { return this.hyperAgent.health === 'healthy'; }
}
```

### Neo4j Schema Update

```cypher
// Agent nodes get new properties
MATCH (a:Agent)
SET a.interface = 'IAgent',
    a.version = a.version ?? 'unknown',
    a.executionModel = a.executionModel ?? 'async'

// New relationship types
(Agent:Agent)-[:IMPLEMENTS]->(Interface:IAgent)
(Agent:Agent)-[:HAS_USAGE]->(Usage:AgentUsage)
(Agent:Agent)-[:APPLIED_SKILL]->(Skill:Skill)
```

### Backend Route

**File:** `apps/backend/src/routes/agentRoutes.ts` (add 2 endpoints)

```typescript
/**
 * AGENT ROUTES — Extended with abstraction layer
 * 
 * POST /api/agents/execute     — Execute task on any agent (unified interface)
 * GET  /api/agents/:id/usage   — Get usage stats for agent
 * POST /api/agents/register    — Register new agent with IAgent interface
 */
```

---

## Phase 4: Runtime Analytics from Multica (5-7 days) 🟢 P2

### What: Cost/token tracking per agent + dashboard charts
**Source:** `multica-ai/multica/packages/views/runtimes/` + `server/internal/daemon/usage/`

### Neo4j Schema — Usage Tracking

```cypher
// AgentUsage node (created per execution)
(u:AgentUsage {
  id: "usage-uuid",
  agentId: "hyperagent-001",
  date: "2026-04-12",
  tokensIn: 15000,
  tokensOut: 8000,
  costDKK: 0.045,
  model: "deepseek-chat",
  tasksCompleted: 12,
  avgDurationMs: 3500,
  skillsUsed: ["context-engineering", "api-design"]
})

// Relationships
(Agent:Agent)-[:HAS_USAGE]->(AgentUsage:AgentUsage)
(AgentUsage)-[:USED_SKILL]->(Skill:Skill)
```

### Backend Service

**File:** `apps/backend/src/services/AgentUsageService.ts`

```typescript
class AgentUsageService {
  // Record usage after each agent execution
  async recordUsage(result: AgentResult, agentId: string): Promise<void>
  
  // Aggregate queries
  async getDailyUsage(agentId: string, days: number): Promise<DailyUsage[]>
  async getCostByAgent(days: number): Promise<AgentCost[]>
  async getModelDistribution(days: number): Promise<ModelDistribution[]>
  async getActivityHeatmap(agentId: string): Promise<ActivityHeatmap>
}
```

### Backend Route

**File:** `apps/backend/src/routes/agentAnalyticsRoutes.ts`

```typescript
/**
 * AGENT ANALYTICS ROUTES
 * 
 * GET  /api/analytics/usage/:agentId      — Daily usage for agent
 * GET  /api/analytics/cost                — Cost by agent (last 30d)
 * GET  /api/analytics/models              — Model distribution
 * GET  /api/analytics/heatmap/:agentId    — Activity heatmap
 * GET  /api/analytics/skills             — Most used skills
 */
```

### Dashboard Components (Frontend)
Reuse existing WidgeTDC React patterns:

```
src/components/analytics/
├── DailyCostChart.tsx          — Recharts bar chart
├── ModelDistributionChart.tsx  — Recharts pie chart
├── ActivityHeatmap.tsx         — Calendar heatmap
├── SkillUsageChart.tsx         — Horizontal bar chart
└── AgentComparisonTable.tsx    — sortable table
```

---

## Complete Architecture — Where Everything Lives

```
WidgeTDC Backend (apps/backend/src/)
├── routes/
│   ├── skillRoutes.ts                    ← NEW: Skills CRUD + ingestion
│   ├── documentConverterRoutes.ts        ← NEW: markitdown conversion
│   ├── agentRoutes.ts                    ← EXTENDED: unified execute
│   └── agentAnalyticsRoutes.ts           ← NEW: usage analytics
├── services/
│   ├── SkillService.ts                   ← NEW: Skill parsing, matching, execution
│   ├── DocumentConverterService.ts       ← NEW: markitdown wrapper
│   └── AgentUsageService.ts              ← NEW: usage tracking
├── agents/
│   ├── AgentInterface.ts                 ← NEW: IAgent interface
│   └── adapters/
│       ├── HyperAgentAdapter.ts          ← NEW: HyperAgent → IAgent
│       ├── OmegaSentinelAdapter.ts       ← NEW: Omega → IAgent
│       └── SnoutAdapter.ts               ← NEW: Snout → IAgent
├── tools/
│   └── registry.ts                       ← EXTENDED: +6 skill tools
└── python/
    └── markitdown/                       ← NEW: Python package (pip install)

Neo4j Graph
├── Nodes
│   ├── Agent (11 → 341 unified)
│   ├── Skill (0 → 20 ingested)           ← NEW
│   ├── Document (0 → N via markitdown)   ← NEW
│   ├── AgentUsage (0 → N)                ← NEW
│   ├── Capability (86)
│   ├── Tool (127)
│   └── MCPTool (222)
├── Relationships
│   ├── (Agent)-[:HAS_SKILL]->(Skill)
│   ├── (Skill)-[:APPLIES_TO]->(Capability)
│   ├── (Skill)-[:APPLIED_TO]->(Document)
│   ├── (Document)-[:CONVERTED_FROM]->(File)
│   ├── (Agent)-[:HAS_USAGE]->(AgentUsage)
│   └── (AgentUsage)-[:USED_SKILL]->(Skill)
└── Constraints
    ├── skill_name_unique
    └── (existing 12)
```

---

## End-to-End Flow: Complete User Journey

```
User Action: "Review this PDF contract and suggest improvements"
  ↓
1. Document Upload → POST /api/documents/ingest
   ↓
2. markitdown converts PDF → Markdown
   ↓
3. SkillMatcher scans markdown content
   MATCH: "code-review-and-quality" + "security-and-hardening"
   ↓
4. AgentSelector picks best agent for task
   MATCH: HyperAgent (capability: code-review, validity: 0.92)
   ↓
5. Agent executes via IAgent interface
   task = { description: "Review contract...", skillContext: "code-review" }
   ↓
6. Skill workflow activates
   - Load review checklist from Neo4j
   - Apply anti-rationalization tables
   - Execute verification steps
   ↓
7. Result returned with usage tracking
   - Output: "Found 3 security issues..."
   - Usage: { tokensIn: 12000, tokensOut: 5000, costDKK: 0.034 }
   ↓
8. Neo4j updated
   - (Agent)-[:HAS_USAGE]->(AgentUsage {date: today, costDKK: 0.034})
   - (Agent)-[:APPLIED_SKILL]->(Skill {name: "security-and-hardening"})
   ↓
9. Dashboard updated
   - Daily cost chart +0.034
   - Security skill usage +1
   - Agent activity heatmap updated
```

---

## Timeline & Milestones

| Week | Phase | Deliverable | Files Changed | Status |
|------|-------|-------------|---------------|--------|
| **1** | P0: Ingest agent-skills | 20 Skill nodes + skillRoutes.ts + SkillService.ts | 4 new, 2 modified | **Ready to start** |
| **1** | P0: Wire to tool-executor | skill_list, skill_execute, skill_match MCP tools | 1 modified | **Ready to start** |
| **2** | P1: markitdown integration | DocumentConverterService.ts + documentConverterRoutes.ts | 3 new, 1 modified | **Depends on Phase 1** |
| **2** | P1: Agent Abstraction | IAgent interface + 3 adapters | 5 new, 1 modified | **Parallel to markitdown** |
| **3** | P1: Runtime Analytics | AgentUsageService.ts + agentAnalyticsRoutes.ts | 4 new, 1 modified | **Depends on Phase 2** |
| **4** | P2: Skills UI Dashboard | 5 Recharts components + routes | 6 new, 1 modified | **Depends on Phase 3** |

**Total: ~30 files changed/created across 4 weeks**

---

## Deployment Checklist

### Pre-Deployment
- [ ] Neo4j constraints: `skill_name_unique`
- [ ] Python packages: `pip install markitdown markitdown-ocr`
- [ ] Dockerfile: Add markitdown to Python layer
- [ ] Neo4j indexes: `Skill.name`, `AgentUsage.date`, `Document.originalFormat`

### Deployment
- [ ] Backend deploy (apps/backend/src/)
- [ ] Neo4j schema migration (new constraints + indexes)
- [ ] Skill ingestion (20 SKILL.md → Neo4j)
- [ ] Tool registration (6 new MCP tools)
- [ ] Frontend deploy (analytics components)

### Post-Deployment Verification
- [ ] GET /api/skills → returns 20 skills
- [ ] POST /api/documents/convert → PDF → Markdown
- [ ] POST /api/agents/execute → IAgent interface works
- [ ] GET /api/analytics/cost → returns cost data
- [ ] Skill auto-trigger → matches task description
- [ ] Usage tracking → AgentUsage nodes created

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| markitdown Python dependency conflicts | Medium | Low | Use venv, isolate in Docker |
| Skill ingestion fails on malformed MD | Low | Low | Validate frontmatter before MERGE |
| IAgent interface breaks existing agents | Medium | High | Adapter pattern, gradual rollout |
| Usage tracking adds latency | Low | Medium | Async recording, batch writes |
| Neo4j schema migration fails | Low | High | Test on staging first |

---

## ROI Estimate

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Skills available | 0 | 20 | **∞** |
| Document formats supported | ~5 | 20+ | **4x** |
| Agent routing efficiency | Manual | Automatic | **10x faster** |
| Cost visibility | None | Per-agent | **100% visibility** |
| Quality enforcement | None | 20 skill gates | **Zero unverified changes** |

---

## Sources

1. **addyosmani/agent-skills** — https://github.com/addyosmani/agent-skills (20 SKILL.md, MIT)
2. **microsoft/markitdown** — https://github.com/microsoft/markitdown (69 Python files, MIT)
3. **multica-ai/multica** — https://github.com/multica-ai/multica (554 TS/Go files, MIT)
4. **WidgeTDC Backend** — `apps/backend/src/` (existing routes + services)
5. **WidgeTDC Orchestrator** — `src/tools/` (existing tool registry)
6. **WidgeTDC Graph** — Neo4j (existing 11 Agents, 86 Capabilities, 143 Tools)
