# WidgeTDC Orchestrator — Tool Reference (32 tools)

**Auto-generated from tool-registry.ts** | **Version:** 3.2.0

---

## Quick Reference

| # | Tool | Namespace | Timeout | Description |
|---|------|-----------|---------|-------------|
| 1 | `search_knowledge` | knowledge | 20s | Search the WidgeTDC knowledge graph and semantic vector store |
| 2 | `search_documents` | knowledge | 20s | Search for specific documents, files, reports, or artifacts |
| 3 | `create_notebook` | knowledge | 60s | Create an interactive consulting notebook with executed cells |
| 4 | `precedent_search` | knowledge | 30s | Find similar clients, engagements, or use cases |
| 5 | `ingest_document` | knowledge | 60s | Ingest a document into the knowledge graph |
| 6 | `adaptive_rag_query` | knowledge | 30s | Query using adaptive RAG routing (canonical RAG endpoint) |
| 7 | `reason_deeply` | cognitive | 45s | Deep multi-step analysis via RLM reasoning engine |
| 8 | `investigate` | cognitive | 120s | Multi-agent deep investigation on a topic |
| 9 | `query_graph` | graph | 15s | Execute a Cypher query against the Neo4j knowledge graph |
| 10 | `build_communities` | graph | 120s | Build hierarchical community summaries via Leiden detection |
| 11 | `check_tasks` | linear | 10s | Get active tasks, issues, and project status |
| 12 | `linear_issues` | linear | 15s | Get issues from Linear project management |
| 13 | `linear_issue_detail` | linear | 15s | Get detailed info about a specific Linear issue |
| 14 | `call_mcp_tool` | mcp | 30s | Call any of the 449+ MCP tools on the WidgeTDC backend |
| 15 | `get_platform_health` | monitor | 10s | Get health status of all platform services |
| 16 | `list_tools` | monitor | 5s | List all available orchestrator tools |
| 17 | `adaptive_rag_dashboard` | monitor | 10s | Get Adaptive RAG dashboard with routing weights and stats |
| 18 | `graph_hygiene_run` | monitor | 30s | Run graph health check with 6 metrics |
| 19 | `run_chain` | chains | 60s | Execute a multi-step agent chain |
| 20 | `run_evolution` | chains | 300s | Trigger one cycle of the autonomous OODA evolution loop |
| 21 | `verify_output` | compliance | 30s | Run verification checks on content or data |
| 22 | `governance_matrix` | compliance | 5s | Get the WidgeTDC Manifesto enforcement matrix |
| 23 | `generate_deliverable` | assembly | 120s | Generate a consulting deliverable (report, roadmap, assessment) |
| 24 | `adaptive_rag_retrain` | intelligence | 60s | Trigger retraining of adaptive RAG routing weights |
| 25 | `adaptive_rag_reward` | intelligence | 10s | Send a Q-learning reward signal to update RAG routing |
| 26 | `critique_refine` | intelligence | 120s | Constitutional AI generate→critique→revise pipeline |
| 27 | `judge_response` | intelligence | 60s | Score a response on 5 PRISM dimensions |
| 28 | `moa_query` | intelligence | 120s | Mixture-of-Agents routing with parallel dispatch and consensus |
| 29 | `forge_tool` | intelligence | 60s | Forge a new MCP tool at runtime via LLM |
| 30 | `forge_analyze_gaps` | intelligence | 30s | Analyze usage patterns to identify missing tools |
| 31 | `forge_list` | intelligence | 5s | List all dynamically forged tools |
| 32 | `run_osint_scan` | knowledge | 600s | Run OSINT scanning pipeline on Danish public sector domains |

---

## Tools by Namespace

### knowledge (7 tools)

---

#### `search_knowledge`

**Description:** Search the WidgeTDC knowledge graph and semantic vector store. Use for ANY question about platform data, consulting knowledge, patterns, documents, or entities. Returns merged results from SRAG (semantic) and Neo4j (graph).

**Timeout:** 20,000 ms  
**Handler:** mcp-proxy → `srag.query + graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Natural language search query |
| `max_results` | number | no | Max results (default 10) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/search_knowledge \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "TDC digital transformation strategy", "max_results": 5}'
```

---

#### `search_documents`

**Description:** Search for specific documents, files, reports, or artifacts in the platform. Returns document metadata and content snippets.

**Timeout:** 20,000 ms  
**Handler:** mcp-proxy → `srag.query`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Document search query |
| `doc_type` | string | no | Optional filter: TDCDocument, ConsultingArtifact, Pattern, etc. |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/search_documents \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "cloud migration assessment", "doc_type": "ConsultingArtifact"}'
```

---

#### `create_notebook`

**Description:** Create an interactive consulting notebook with query, insight, data, and action cells. Executes all cells and returns a full notebook with results.

**Timeout:** 60,000 ms  
**Handler:** orchestrator

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | yes | The topic to build a notebook around |
| `cells` | array | no | Custom cells. If omitted, auto-generates from topic. Each cell has: `type` (query/insight/data/action), `id`, `query`, `prompt`, `source_cell_id`, `visualization` (table/chart), `recommendation` |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/create_notebook \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"topic": "Danish public sector cloud readiness"}'
```

---

#### `precedent_search`

**Description:** Find similar clients, engagements, or use cases based on shared characteristics. Uses hybrid matching: structural (shared graph relationships) + semantic (embedding similarity). Returns ranked matches with explanation of what dimensions matched.

**Timeout:** 30,000 ms  
**Handler:** orchestrator  
**Output:** Ranked list of similar clients with scores, shared dimensions, and match method

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Client name, engagement description, or use case to find matches for |
| `dimensions` | array of enum | no | Match dimensions: industry, service, challenge, domain, size, geography, deliverable (default: industry, service, challenge, domain) |
| `max_results` | number | no | Max results (1-20, default 5) |
| `structural_weight` | number | no | Weight for structural vs semantic matching (0-1, default 0.6) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/precedent_search \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "large telco digital transformation", "dimensions": ["industry", "service"], "max_results": 3}'
```

---

#### `ingest_document`

**Description:** Ingest a document into the knowledge graph. Parses content, extracts entities via LLM, MERGEs to Neo4j, and indexes for vector search. Supports markdown, text, and PDF (via Docling).

**Timeout:** 60,000 ms  
**Handler:** orchestrator  
**Output:** Ingestion result with entities extracted, nodes merged, and parsing method

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Document content (markdown, text, or base64 PDF) |
| `filename` | string | yes | Source filename |
| `domain` | string | no | Target domain for classification |
| `extract_entities` | boolean | no | Extract and link entities (default: true) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/ingest_document \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "# Assessment Report\n...", "filename": "tdc-assessment-2026.md", "domain": "telecom"}'
```

---

#### `adaptive_rag_query`

**Description:** Query the knowledge graph using adaptive RAG routing. Automatically selects the best retrieval strategy (simple/multi_hop/structured) based on Q-learning weights. Returns merged results with channel attribution. This is the CANONICAL RAG endpoint — all other RAG calls should delegate here.

**Timeout:** 30,000 ms  
**Handler:** orchestrator  
**Output:** Merged RAG results with strategy used, channel attribution, and confidence

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | The query to search for |
| `max_results` | number | no | Maximum results to return (default: 10) |
| `force_strategy` | string | no | Force a specific strategy: simple, multi_hop, structured (bypasses adaptive routing) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/adaptive_rag_query \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the top compliance risks for Danish telcos?"}'
```

---

#### `run_osint_scan`

**Description:** Run OSINT scanning pipeline on Danish public sector domains. Scans CT logs + DMARC/SPF and ingests results to Neo4j.

**Timeout:** 600,000 ms  
**Handler:** orchestrator  
**Output:** Scan results with CT entries, DMARC results, and ingestion counts

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domains` | array of string | no | Override domain list (default: 50 DK public domains) |
| `scan_type` | enum | no | Scan type: full, ct_only, dmarc_only (default: full) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/run_osint_scan \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"scan_type": "dmarc_only", "domains": ["tdc.dk", "yousee.dk"]}'
```

---

### cognitive (2 tools)

---

#### `reason_deeply`

**Description:** Send a complex question to the RLM reasoning engine for deep multi-step analysis. Use for strategy questions, architecture analysis, comparisons, evaluations, and planning.

**Timeout:** 45,000 ms  
**Handler:** mcp-proxy → `rlm.reason`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | The complex question to reason about |
| `mode` | enum | no | Reasoning mode: reason, analyze, plan (default: reason) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/reason_deeply \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"question": "Should we migrate our SRAG pipeline from OpenAI to local embeddings?", "mode": "analyze"}'
```

---

#### `investigate`

**Description:** Run a multi-agent deep investigation on a topic. Returns a comprehensive analysis artifact with graph data, compliance, strategy, and reasoning.

**Timeout:** 120,000 ms  
**Handler:** orchestrator

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | yes | The topic to investigate deeply |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/investigate \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"topic": "Impact of EU AI Act on WidgeTDC platform compliance"}'
```

---

### graph (2 tools)

---

#### `query_graph`

**Description:** Execute a Cypher query against the Neo4j knowledge graph (475K+ nodes, 3.8M+ relationships). Use for structured data queries like counting nodes, finding relationships, listing entities.

**Timeout:** 15,000 ms  
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cypher` | string | yes | Neo4j Cypher query (read-only, parameterized) |
| `params` | object | no | Query parameters |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/query_graph \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cypher": "MATCH (c:Client)-[:HAS_DOMAIN]->(d:Domain) WHERE d.name = $domain RETURN c.name LIMIT 10", "params": {"domain": "telecom"}}'
```

---

#### `build_communities`

**Description:** Build hierarchical community summaries from the knowledge graph using Leiden community detection. Creates CommunitySummary nodes with LLM-generated summaries and MEMBER_OF relationships. Used for thematic retrieval.

**Timeout:** 120,000 ms  
**Handler:** orchestrator  
**Output:** Community build result with count, summaries generated, and method used

**Input Parameters:** None

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/build_communities \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### linear (3 tools)

---

#### `check_tasks`

**Description:** Get active tasks, issues, and project status from the knowledge graph. Use when asked about project status, next steps, blockers, sprints, or Linear issues.

**Timeout:** 10,000 ms  
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | enum | no | Task filter: active, blocked, recent, all (default: active) |
| `keyword` | string | no | Optional keyword to filter tasks |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/check_tasks \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filter": "blocked"}'
```

---

#### `linear_issues`

**Description:** Get issues from Linear project management. Use for project status, active tasks, sprint progress, blockers, or specific issue details (LIN-xxx).

**Timeout:** 15,000 ms  
**Handler:** mcp-proxy → `linear.issues`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | no | Search query or issue identifier (e.g., "LIN-493") |
| `status` | enum | no | Filter by status: active, done, backlog, all (default: active) |
| `limit` | number | no | Max results (default 10) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/linear_issues \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "active", "limit": 20}'
```

---

#### `linear_issue_detail`

**Description:** Get detailed info about a specific Linear issue by identifier (e.g., LIN-493). Returns full description, comments, status, assignee, sub-issues.

**Timeout:** 15,000 ms  
**Handler:** mcp-proxy → `linear.issue_get`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `identifier` | string | yes | Issue identifier (e.g., LIN-493) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/linear_issue_detail \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "LIN-574"}'
```

---

### mcp (1 tool)

---

#### `call_mcp_tool`

**Description:** Call any of the 449+ MCP tools on the WidgeTDC backend. Use for specific platform operations like embedding, compliance checks, memory operations, agent coordination.

**Timeout:** 30,000 ms  
**Handler:** mcp-proxy → `(dynamic)`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_name` | string | yes | MCP tool name (e.g., srag.query, graph.health, audit.dashboard) |
| `payload` | object | no | Tool payload arguments |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/call_mcp_tool \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "audit.dashboard", "payload": {}}'
```

---

### monitor (4 tools)

---

#### `get_platform_health`

**Description:** Get current health status of all WidgeTDC platform services (backend, RLM engine, Neo4j graph, Redis). Use when asked about system status, uptime, or health.

**Timeout:** 10,000 ms  
**Handler:** mcp-proxy → `graph.health + graph.stats`

**Input Parameters:** None

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/get_platform_health \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `list_tools`

**Description:** List all available orchestrator tools with their schemas, protocols, and categories. Use to discover what tools are available and how to call them.

**Timeout:** 5,000 ms  
**Handler:** orchestrator  
**Output:** List of tool definitions with schemas and metadata

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `namespace` | string | no | Filter by namespace |
| `category` | string | no | Filter by category |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/list_tools \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"namespace": "intelligence"}'
```

---

#### `adaptive_rag_dashboard`

**Description:** Get the Adaptive RAG dashboard showing current routing weights, per-strategy performance stats, compound intelligence metric (accuracy × quality × coverage), and training sample count.

**Timeout:** 10,000 ms  
**Handler:** orchestrator  
**Output:** Adaptive RAG weights, strategy stats, and compound metric

**Input Parameters:** None

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/adaptive_rag_dashboard \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `graph_hygiene_run`

**Description:** Run graph health check: 6 metrics (orphan ratio, avg rels, embedding coverage, domain count, stale nodes, pollution). Stores GraphHealthSnapshot and alerts on anomalies.

**Timeout:** 30,000 ms  
**Handler:** orchestrator  
**Output:** Health metrics with alerts if thresholds are crossed

**Input Parameters:** None

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/graph_hygiene_run \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### chains (2 tools)

---

#### `run_chain`

**Description:** Execute a multi-step agent chain. Supports sequential, parallel, debate, and loop modes. Use for complex workflows needing coordinated tool calls.

**Timeout:** 60,000 ms  
**Handler:** orchestrator

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Chain name/description |
| `mode` | enum | yes | Execution mode: sequential, parallel, debate, loop |
| `steps` | array | yes | Chain steps. Each step: `agent_id` (string, required), `tool_name` (string, optional), `cognitive_action` (string, optional — reason/analyze/plan), `prompt` (string, optional) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/run_chain \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "compliance-check-chain",
    "mode": "sequential",
    "steps": [
      {"agent_id": "compliance-officer", "cognitive_action": "analyze", "prompt": "Review EU AI Act exposure"},
      {"agent_id": "regulatory-navigator", "tool_name": "graph.read_cypher", "prompt": "MATCH (n:Regulation) RETURN n LIMIT 5"}
    ]
  }'
```

---

#### `run_evolution`

**Description:** Trigger one cycle of the autonomous evolution loop (OODA: Observe→Orient→Act→Learn). Assesses platform state, identifies improvement opportunities, executes changes, and captures lessons.

**Timeout:** 300,000 ms  
**Handler:** orchestrator  
**Output:** Evolution cycle results with observations, actions taken, and lessons learned

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `focus_area` | string | no | Optional focus area for this cycle |
| `dry_run` | boolean | no | If true, plan only without executing |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/run_evolution \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"focus_area": "RAG performance", "dry_run": true}'
```

---

### compliance (2 tools)

---

#### `verify_output`

**Description:** Run verification checks on content or data. Checks quality, accuracy, and compliance. Use after other tools to validate results.

**Timeout:** 30,000 ms  
**Handler:** orchestrator

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Content to verify |
| `checks` | array | no | Verification checks to run. Each check: `name` (string, required), `tool_name` (string, required — MCP tool for verification) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/verify_output \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "The platform handles 450K nodes...", "checks": [{"name": "accuracy", "tool_name": "graph.stats"}]}'
```

---

#### `governance_matrix`

**Description:** Get the WidgeTDC Manifesto enforcement matrix — maps all 10 principles to their runtime enforcement mechanisms. Shows status (ENFORCED/PARTIAL/GAP), enforcement layer, and gap remediation.

**Timeout:** 5,000 ms  
**Handler:** orchestrator  
**Output:** 10-principle enforcement matrix with status, mechanism, and gap remediation

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | enum | no | Filter by status: all, enforced, gaps (default: all) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/governance_matrix \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filter": "gaps"}'
```

---

### assembly (1 tool)

---

#### `generate_deliverable`

**Description:** Generate a consulting deliverable (report, roadmap, or assessment) from a natural language prompt. Uses knowledge graph + RAG to produce a structured, citation-backed document. Returns markdown with optional PDF.

**Timeout:** 120,000 ms  
**Handler:** orchestrator  
**Output:** Deliverable with sections, citations, confidence scores, and markdown content

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | yes | What the deliverable should cover (min 10 chars) |
| `type` | enum | yes | Deliverable type: analysis, roadmap, assessment |
| `format` | enum | no | Output format: pdf, markdown (default: markdown) |
| `max_sections` | number | no | Max sections (2-8, default 5) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/generate_deliverable \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Digital transformation roadmap for a mid-sized Danish telco", "type": "roadmap", "max_sections": 6}'
```

---

### intelligence (8 tools)

---

#### `adaptive_rag_retrain`

**Description:** Trigger retraining of adaptive RAG routing weights. Analyzes recent query outcomes, recalculates per-strategy performance, and updates routing weights. Should run weekly or after significant query volume.

**Timeout:** 60,000 ms  
**Handler:** orchestrator  
**Output:** Retraining result with old/new weights, training samples used, and performance delta

**Input Parameters:** None

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/adaptive_rag_retrain \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `adaptive_rag_reward`

**Description:** Send a Q-learning reward signal to update RAG routing. Call this after evaluating RAG result quality to reinforce good strategies and penalize poor ones.

**Timeout:** 10,000 ms  
**Handler:** orchestrator  
**Output:** Confirmation of reward signal with updated weight preview

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | The original query |
| `strategy` | string | yes | Strategy used: simple, multi_hop, structured |
| `reward` | number | yes | Reward signal: -1.0 (terrible) to 1.0 (perfect) |
| `reason` | string | no | Why this reward was given |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/adaptive_rag_reward \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "telco compliance landscape", "strategy": "multi_hop", "reward": 0.9, "reason": "Results were comprehensive and well-connected"}'
```

---

#### `critique_refine`

**Description:** Run Constitutional AI-inspired generate→critique→revise pipeline. Generates a response, critiques it against quality principles, then revises. Returns original, critique, and refined version.

**Timeout:** 120,000 ms  
**Handler:** orchestrator  
**Output:** Original response, critique, revised response, and timing

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | The query or task to process |
| `provider` | string | no | LLM provider (default: deepseek) |
| `principles` | array of string | no | Custom critique principles (default: 5 standard) |
| `max_rounds` | number | no | Max refine rounds (default: 1) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/critique_refine \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "Summarize the key risks of migrating to AuraDB", "max_rounds": 2}'
```

---

#### `judge_response`

**Description:** Score an agent response on 5 PRISM dimensions (Precision, Reasoning, Information, Safety, Methodology). Returns 0-10 scores per dimension plus aggregate. Based on openevals prompt templates.

**Timeout:** 60,000 ms  
**Handler:** orchestrator  
**Output:** PRISM scores (0-10 each) with aggregate and explanation

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | The original query/task |
| `response` | string | yes | The agent response to evaluate |
| `context` | string | no | Optional reference context or expected answer |
| `provider` | string | no | LLM provider for judging (default: deepseek) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/judge_response \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the main risks?", "response": "The main risks include...", "provider": "deepseek"}'
```

---

#### `moa_query`

**Description:** Mixture-of-Agents routing: classifies query complexity, selects 2-3 specialist agents by capability match, dispatches in parallel, and merges responses via LLM consensus. Use for complex queries that benefit from multiple perspectives.

**Timeout:** 120,000 ms  
**Handler:** orchestrator  
**Output:** Consensus response with agent attributions, confidence score, and classification

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | The complex query to route through MoA |
| `agents` | array of string | no | Force specific agent IDs (bypass auto-selection) |
| `max_agents` | number | no | Max agents to dispatch (default: 3) |
| `provider` | string | no | LLM provider for classify + merge (default: deepseek) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/moa_query \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What should our AI governance strategy be for 2026?", "max_agents": 3}'
```

---

#### `forge_tool`

**Description:** Forge a new MCP tool at runtime. Generates tool definition + handler via LLM, registers in runtime registry, and optionally verifies. Supports 3 handler types: mcp-proxy (forward to backend tool), llm-generate (LLM answers), cypher-query (Neo4j template).

**Timeout:** 60,000 ms  
**Handler:** orchestrator  
**Output:** Forge result with tool spec, verification status, and handler config

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Tool name (snake_case, e.g. "analyze_risk") |
| `purpose` | string | yes | What the tool should do |
| `handler_type` | string | no | Handler: mcp-proxy, llm-generate, cypher-query (default: llm-generate) |
| `backend_tool` | string | no | For mcp-proxy: backend tool name to forward to |
| `system_prompt` | string | no | For llm-generate: system prompt |
| `cypher_template` | string | no | For cypher-query: Cypher template with $params |
| `verify` | boolean | no | Run verification after creation (default: true) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/forge_tool \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "analyze_churn_risk", "purpose": "Analyze customer churn risk factors from graph data", "handler_type": "cypher-query"}'
```

---

#### `forge_analyze_gaps`

**Description:** Analyze recent tool usage patterns to identify gaps — tools that are missing, frequently failing, or requested but not available. Returns suggested new tools to forge.

**Timeout:** 30,000 ms  
**Handler:** orchestrator  
**Output:** Gap analysis with patterns, frequencies, and tool suggestions

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | no | LLM provider for analysis (default: deepseek) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/forge_analyze_gaps \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `forge_list`

**Description:** List all dynamically forged tools with their handler type, verification status, and creation date.

**Timeout:** 5,000 ms  
**Handler:** orchestrator  
**Output:** List of forged tools with specs

**Input Parameters:** None

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/forge_list \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## API Access

All 32 tools are accessible via 3 protocols simultaneously:

### REST (OpenAPI)

```
POST /api/tools/{tool_name}
Authorization: Bearer <ORCHESTRATOR_API_KEY>
Content-Type: application/json
```

Interactive docs available at: `GET /docs`  
OpenAPI schema: `GET /openapi.json`

### OpenAI Function Calling

```
POST /v1/chat/completions
Authorization: Bearer <ORCHESTRATOR_API_KEY>

{
  "model": "deepseek-chat",
  "messages": [...],
  "tools": [...],   // auto-compiled from tool-registry
  "tool_choice": "auto"
}
```

### MCP (Model Context Protocol)

```
POST /mcp
Authorization: Bearer <ORCHESTRATOR_API_KEY>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "search_knowledge",
    "arguments": { "query": "..." }
  }
}
```

---

## Example Calls

### 1. Search the knowledge graph

```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/search_knowledge \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "digital transformation patterns Danish telco", "max_results": 5}'
```

### 2. Generate a consulting deliverable

```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/generate_deliverable \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Cloud infrastructure readiness assessment for public sector",
    "type": "assessment",
    "format": "markdown",
    "max_sections": 5
  }'
```

### 3. Run a deep analysis via MoA (Mixture-of-Agents)

```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/moa_query \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the strategic risks of our current embedding infrastructure?",
    "max_agents": 3
  }'
```

### 4. Call a backend MCP tool directly

```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/call_mcp_tool \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "omega.sitrep",
    "payload": {}
  }'
```

---

## Tool Counts by Namespace

| Namespace | Count | Category |
|-----------|-------|----------|
| knowledge | 7 | Semantic + graph search, RAG, document ingestion, OSINT |
| intelligence | 8 | Self-improvement, critique, MoA, tool forging |
| engagement | 5 | First-class consulting engagement entities (v4.0.4 LIN-607) |
| monitor | 4 | Platform health, RAG dashboard, hygiene, tool listing |
| linear | 3 | Project tasks and issue tracking |
| cognitive | 2 | Deep reasoning, multi-agent investigation |
| graph | 2 | Cypher queries, community detection |
| chains | 2 | Agent chain execution, evolution loop |
| compliance | 2 | Output verification, governance matrix |
| mcp | 1 | Dynamic MCP tool proxy (449+ backend tools) |
| assembly | 1 | Consulting deliverable generation |

---

## v4.0.4 Engagement Intelligence Engine Tools (LIN-607)

First-class consulting engagement entities with precedent matching, plan generation via RLM `/cognitive/analyze`, smart gates (sanity + consensus + RLM missions), and outcome-driven Q-learning feedback. Five tools surface via REST tool-gateway, Universal MCP gateway, OpenAPI `/docs`, and adoption telemetry.

### `engagement_create`
**Namespace:** engagement | **Timeout:** 15s | **Handler:** orchestrator

Create a first-class Engagement entity. Writes to Neo4j via MERGE (`:Engagement` + `:USES_METHODOLOGY` edges) and indexes in `raptor.index` for semantic precedent retrieval.

**Required:** `client`, `domain`, `objective`, `start_date`, `target_end_date`
**Optional:** `budget_dkk`, `team_size`, `methodology_refs[]`

### `engagement_match`
**Namespace:** engagement | **Timeout:** 30s | **Handler:** orchestrator

Find similar past engagements via Cypher (actual `:Engagement` nodes ranked by outcome grade + methodology overlap + freshness) with `dualChannelRAG` 3-hop fallback. Returns top precedents with outcome grades (`exceeded`/`met`/`partial`/`missed`) and staleness flags (>540 days).

**Required:** `objective`, `domain` | **Optional:** `max_results` (default 5)

### `engagement_plan`
**Namespace:** engagement | **Timeout:** 120s | **Handler:** orchestrator | **Advanced: true**

Generate structured consulting plan (phases, risks, skills) via RLM `/cognitive/analyze` + 4-channel retrieval (`autonomous.graphrag` 3-hop + `srag.query` + `cypher` + `kg_rag.query`) + context folding. Enforces smart gates:
- **Gate 0 (sanity):** objective ≥15 chars, duration 1-260w, team 1-100, budget 0-500M DKK → 422 `PlanGateRejection`
- **Gate 1 (consensus):** `budget >20M` OR `team >20` OR `duration >40w` → `consensus.propose` + self-vote, fail-closed
- **Gate 2 (complex):** `duration >40w` → `rlm.start_mission` × 3 steps, insights injected into cognitive context

**Required:** `objective`, `domain`, `duration_weeks`, `team_size`
**Optional:** `budget_dkk`, `engagement_id`

### `engagement_outcome`
**Namespace:** engagement | **Timeout:** 15s | **Handler:** orchestrator

Record engagement completion outcome. Writes `:EngagementOutcome` node + `:HAS_OUTCOME` edge to Neo4j, sets engagement status=`completed`, and sends Q-learning reward to `adaptive-rag` based on grade + precedent accuracy.

**Required:** `engagement_id`, `grade` (exceeded/met/partial/missed), `actual_end_date`, `what_went_well`, `what_went_wrong`, `recorded_by`
**Optional:** `deliverables_shipped[]`, `precedent_match_accuracy` (0-1)

### `engagement_list`
**Namespace:** engagement | **Timeout:** 10s | **Handler:** orchestrator

List recent engagements from Redis + Neo4j. Returns most recent first by `createdAt`.

**Optional:** `limit` (default 20, max 100)

---

## v4.0.5 Ghost-Tier Feature Registration (LIN-609)

Six tools closing ghost-tier gaps found by the v4.0.5 audit. Each tool is tied to a known Linear issue that shipped without TOOL_REGISTRY compliance. Closing the Omega lesson loop.

### `memory_store`
**Namespace:** memory | **Timeout:** 5s | **Handler:** orchestrator | **LIN-582**

Store an entry in agent working memory (8-layer memory system). Backed by Redis with optional TTL.

**Required:** `agent_id`, `key`, `value` | **Optional:** `ttl` (seconds, default 3600)

### `memory_retrieve`
**Namespace:** memory | **Timeout:** 5s | **Handler:** orchestrator | **LIN-582**

Retrieve a specific memory entry or list all entries for an agent.

**Required:** `agent_id` | **Optional:** `key` (omit to list all)

### `failure_harvest`
**Namespace:** intelligence | **Timeout:** 30s | **Handler:** orchestrator | **LIN-567 Red Queen**

Harvest recent orchestrator failures (timeouts, 502s, auth, MCP errors) for Red Queen learning loop. Returns categorized summary.

**Optional:** `window_hours` (default 24)

### `context_fold`
**Namespace:** cognitive | **Timeout:** 30s | **Handler:** orchestrator | **LIN-568 CaaS Mercury**

Compress large context via RLM `/cognitive/fold`. Auto-selects strategy (baseline/neural/deepseek). Rate limited 100 req/day per API key.

**Required:** `text` | **Optional:** `query`, `budget`, `domain`

### `competitive_crawl`
**Namespace:** intelligence | **Timeout:** 180s | **Handler:** orchestrator | **LIN-566 Phagocytosis**

Trigger competitive phagocytosis crawl. Fetches competitor docs, extracts capabilities via DeepSeek LLM, MERGEs into Neo4j, produces gap report.

**No parameters.**

### `loose_ends_scan`
**Namespace:** intelligence | **Timeout:** 60s | **Handler:** orchestrator | **LIN-535**

Scan synthesis funnel for loose ends — unresolved dependencies, contradictions, orphaned blocks.

**No parameters.**

---

## Adding a New Tool

All protocols (REST, OpenAI, MCP) compile automatically from a single entry in `src/tool-registry.ts`:

```typescript
defineTool({
  name: 'my_new_tool',         // required — snake_case
  namespace: 'knowledge',      // required — determines category
  description: '...',          // required — shown in all protocols
  input: z.object({            // required — Zod schema
    param1: z.string().describe('...'),
    param2: z.number().optional(),
  }),
  timeoutMs: 30000,            // optional — default 30s
  backendTool: 'backend.tool', // optional — makes handler = mcp-proxy
  outputDescription: '...',    // optional — shown in OpenAPI responses
})
```

After adding, rebuild: `npm run build`
