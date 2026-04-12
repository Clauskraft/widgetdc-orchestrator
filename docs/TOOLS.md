# WidgeTDC Orchestrator — Tool Reference (105 tools)

**Auto-generated from tool-registry.ts** | **Version:** 4.2.0

## FR-3 Risk Metadata

Every tool declares governance metadata per the Neural Bridge v2 specification:

| Field | Values | Description |
|-------|--------|-------------|
| `riskLevel` | `read_only` / `staged_write` / `production_write` | Mutation risk classification |
| `requiresPlan` | `true` / `false` | Whether HyperAgent plan is required |
| `requiresApproval` | `true` / `false` | Whether approval gate is required |
| `costTier` | `micro` / `standard` / `premium` | LLM cost classification |
| `auditCategory` | string | Audit trail category for compliance |

### Risk Rules
- **read_only**: Direct execution allowed (default for most tools)
- **staged_write**: HyperAgent plan + approval required
- **production_write**: HyperAgent plan + approval + policy profile + audit required

### Quick Summary

| Risk Level | Count |
|------------|-------|
| read_only | *auto-computed* |
| staged_write | *auto-computed* |
| production_write | *auto-computed* |

| Cost Tier | Count |
|-----------|-------|
| micro | *auto-computed* |
| standard | *auto-computed* |
| premium | *auto-computed* |

---

## Quick Reference

| # | Tool | Namespace | Risk | Cost | Timeout | Description |
|---|------|-----------|------|------|---------|-------------|
| 1 | `search_knowledge` | knowledge | 20s | Search the WidgeTDC knowledge graph and semantic vector store |
| 2 | `search_documents` | knowledge | 20s | Search for specific documents, files, reports, or artifacts |
| 3 | `create_notebook` | knowledge | 60s | Create an interactive consulting notebook with executed cells |
| 4 | `precedent_search` | knowledge | 30s | Find similar clients, engagements, or use cases |
| 5 | `ingest_document` | knowledge | 60s | Ingest a document into the knowledge graph |
| 6 | `adaptive_rag_query` | knowledge | 30s | Query using adaptive RAG routing (canonical RAG endpoint) |
| 7 | `run_osint_scan` | knowledge | 600s | Run OSINT scanning pipeline on Danish public sector domains |
| 8 | `reason_deeply` | cognitive | 45s | Deep multi-step analysis via RLM reasoning engine |
| 9 | `investigate` | cognitive | 120s | Multi-agent deep investigation on a topic |
| 10 | `context_fold` | cognitive | 30s | Compress large context via RLM /cognitive/fold |
| 11 | `query_graph` | graph | 15s | Execute a Cypher query against the Neo4j knowledge graph |
| 12 | `build_communities` | graph | 120s | Build hierarchical community summaries via Leiden detection |
| 13 | `drill_start` | graph | 15s | Start hierarchical drill-down session (G4.15) |
| 14 | `drill_down` | graph | 15s | Drill into child level in active session (G4.16) |
| 15 | `drill_up` | graph | 15s | Navigate up one level in drill session (G4.17) |
| 16 | `drill_children` | graph | 10s | Fetch children at current drill position (G4.18) |
| 17 | `check_tasks` | linear | 10s | Get active tasks, issues, and project status |
| 18 | `linear_issues` | linear | 15s | Get issues from Linear project management |
| 19 | `linear_issue_detail` | linear | 15s | Get detailed info about a specific Linear issue |
| 19a | `linear_labels` | linear | 10s | List available Linear labels for issue categorization |
| 19b | `linear_save_issue` | linear | 15s | Create or update a Linear issue |
| 19c | `linear_get_issue` | linear | 10s | Get a single Linear issue by ID or identifier |
| 20 | `call_mcp_tool` | mcp | 30s | Call any of the 449+ MCP tools on the WidgeTDC backend |
| 21 | `get_platform_health` | monitor | 10s | Get health status of all platform services |
| 22 | `list_tools` | monitor | 5s | List all available orchestrator tools |
| 23 | `adaptive_rag_dashboard` | monitor | 10s | Get Adaptive RAG dashboard with routing weights and stats |
| 24 | `graph_hygiene_run` | monitor | 30s | Run graph health check with 6 metrics |
| 25 | `run_chain` | chains | 60s | Execute a multi-step agent chain |
| 26 | `run_evolution` | chains | 300s | Trigger one cycle of the autonomous OODA evolution loop |
| 27 | `verify_output` | compliance | 30s | Run verification checks on content or data |
| 28 | `governance_matrix` | compliance | 5s | Get the WidgeTDC Manifesto enforcement matrix |
| 29 | `generate_deliverable` | assembly | 120s | Generate a consulting deliverable (report, roadmap, assessment) |
| 30 | `artifact_list` | assembly | 10s | List AnalysisArtifact objects from the broker |
| 31 | `artifact_get` | assembly | 5s | Retrieve a specific AnalysisArtifact by ID |
| 32 | `adaptive_rag_retrain` | intelligence | 60s | Trigger retraining of adaptive RAG routing weights |
| 33 | `adaptive_rag_reward` | intelligence | 10s | Send a Q-learning reward signal to update RAG routing |
| 34 | `critique_refine` | intelligence | 120s | Constitutional AI generate→critique→revise pipeline |
| 35 | `judge_response` | intelligence | 60s | Score a response on 5 PRISM dimensions |
| 36 | `moa_query` | intelligence | 120s | Mixture-of-Agents routing with parallel dispatch and consensus |
| 37 | `forge_tool` | intelligence | 60s | Forge a new MCP tool at runtime via LLM |
| 38 | `forge_analyze_gaps` | intelligence | 30s | Analyze usage patterns to identify missing tools |
| 39 | `forge_list` | intelligence | 5s | List all dynamically forged tools |
| 40 | `failure_harvest` | intelligence | 30s | Harvest recent orchestrator failures for Red Queen learning |
| 41 | `competitive_crawl` | intelligence | 180s | Trigger competitive phagocytosis crawl |
| 42 | `loose_ends_scan` | intelligence | 60s | Scan synthesis funnel for loose ends |
| 43 | `research_harvest` | intelligence | 180s | Trigger S1-S4 research harvesting pipeline |
| 44 | `engagement_create` | engagement | 15s | Create a first-class Engagement entity |
| 45 | `engagement_match` | engagement | 30s | Find similar past engagements via Cypher + RAG |
| 46 | `engagement_plan` | engagement | 120s | Generate structured consulting plan via RLM |
| 47 | `engagement_outcome` | engagement | 15s | Record engagement completion outcome |
| 48 | `engagement_list` | engagement | 10s | List recent engagements from Redis + Neo4j |
| 49 | `memory_store` | memory | 5s | Store an entry in agent working memory |
| 50 | `memory_retrieve` | memory | 5s | Retrieve a specific memory entry or list all for agent |
| 51 | `memory_search` | memory | 15s | Search long-term AgentMemory nodes with filters + relevance scoring |
| 52 | `memory_consolidate` | memory | 120s | Run memory consolidation: dedup, TTL expiry, budget enforcement |
| 53 | `document_convert` | converter | 30s | Convert PDF/DOCX/XLSX/PPTX/MD/HTML/TXT → text + metadata |
| 53 | `llm_chat` | llm | 60s | Direct LLM chat proxy supporting 6 providers |
| 54 | `llm_providers` | llm | 5s | List available LLM providers with default models |
| 55 | `decision_certify` | decisions | 30s | Certify an assembly as an architecture decision |
| 56 | `decision_list` | decisions | 10s | List all certified decisions from Redis store |
| 57 | `decision_lineage` | decisions | 20s | Build full lineage chain for a decision or assembly |
| 56 | `hyperagent_auto_run` | hyperagent | 300s | Trigger autonomous execution cycle |
| 57 | `hyperagent_auto_status` | hyperagent | 10s | Get autonomous executor status |
| 58 | `hyperagent_auto_memory` | hyperagent | 15s | Read/write persistent cross-repo memory |
| 59 | `hyperagent_auto_issues` | hyperagent | 10s | List issues discovered during autonomous execution |
| 60 | `pheromone_status` | pheromone | 5s | Get pheromone layer status |
| 61 | `pheromone_sense` | pheromone | 5s | Sense pheromones in a domain |
| 62 | `pheromone_deposit` | pheromone | 5s | Deposit a pheromone signal |
| 63 | `pheromone_heatmap` | pheromone | 5s | Get cross-domain pheromone heatmap |
| 64 | `peer_eval_status` | peereval | 5s | Get fleet learning status |
| 65 | `peer_eval_fleet` | peereval | 10s | Get fleet learning data for task types |
| 66 | `peer_eval_evaluate` | peereval | 15s | Trigger manual peer evaluation |
| 67 | `peer_eval_analyze` | peereval | 45s | Run RLM-powered fleet analysis |
| 68 | `inventor_run` | inventor | 30s | Start or resume Inventor evolution experiment |
| 69 | `inventor_status` | inventor | 5s | Get Inventor experiment status |
| 70 | `inventor_nodes` | inventor | 5s | List Inventor trial nodes |
| 71 | `inventor_node` | inventor | 5s | Get specific Inventor trial node by ID |
| 72 | `inventor_best` | inventor | 5s | Get best-scoring Inventor trial node |
| 73 | `inventor_stop` | inventor | 5s | Stop running Inventor experiment |
| 74 | `inventor_history` | inventor | 5s | List Inventor experiment history |
| 74a | `hyperagent_auto_run` | hyperagent | 300s | Trigger autonomous execution cycle |
| 74b | `hyperagent_auto_status` | hyperagent | 5s | Get autonomous executor status |
| 74c | `hyperagent_auto_memory` | hyperagent | 15s | Read/write persistent cross-repo memory |
| 74d | `hyperagent_auto_issues` | hyperagent | 5s | List discovered autonomous execution issues |
| 75 | `data_graph_read` | data | 15s | Execute a read-only Cypher query against Neo4j |
| 76 | `data_graph_stats` | data | 10s | Get Neo4j graph statistics |
| 77 | `data_redis_inspect` | data | 10s | Inspect Redis state for cache health monitoring |
| 78 | `data_integrity_check` | data | 30s | Run data integrity checks |
| 79 | `system_health` | system | 10s | Get health status of all platform services |
| 80 | `system_service_status` | system | 10s | Get service status: uptime, version, resource usage |
| 81 | `system_metrics_summary` | system | 10s | Get Prometheus metrics summary |
| 82 | `system_logs_summary` | system | 15s | Get recent log summary for troubleshooting |
| 83 | `agent_list` | agent | 10s | List all registered agents with status |
| 84 | `agent_status` | agent | 10s | Get detailed status of a specific agent |
| 85 | `agent_dispatch` | agent | 15s | Dispatch a task to an agent via peer evaluation |
| 86 | `agent_memory` | agent | 10s | Get agent working memory summary |
| 87 | `agent_capabilities` | agent | 10s | Get agent capabilities and workload |
| 87a | `chat_send` | agent | 10s | Send a message to another agent or broadcast (A2A messaging) |
| 87b | `chat_read` | agent | 10s | Read recent messages from the orchestrator chat bus |
| 88 | `model_providers` | model | 10s | List available LLM providers with costs and capabilities |
| 89 | `model_route` | model | 10s | Route a task to the optimal LLM |
| 90 | `model_cost_estimate` | model | 5s | Estimate cost for a model call |
| 91 | `model_budget_status` | model | 10s | Get current budget status |
| 92 | `model_policy_check` | model | 5s | Check if a model call complies with cost governance |
| 93 | `workflow_cost_trace` | model | 10s | Get cost trace for a workflow |
| 94 | `workflow_context_compact` | model | 30s | Compact context before delegation |
| 95 | `workflow_fanout_guard` | model | 5s | Check if workflow fan-out exceeds limits |
| 96 | `workflow_premium_escalation_check` | model | 5s | Check if premium model escalation is justified |
| 97 | `governance_plan_create` | governance | 30s | Create a governance plan for cross-domain operations |
| 98 | `governance_plan_approve` | governance | 10s | Approve a pending governance plan |
| 99 | `governance_plan_execute` | governance | 60s | Execute an approved governance plan |
| 100 | `governance_plan_evaluate` | governance | 10s | Evaluate a completed governance plan |
| 101 | `governance_audit_query` | governance | 15s | Query audit log for governance events |
| 102 | `governance_policy_decide` | governance | 10s | Query or update governance policy |
| 103 | `grafana_dashboard` | grafana | 15s | Query Grafana Cloud dashboards and panels |
| 104 | `railway_deploy` | railway | 30s | Trigger Railway deployment or check status |
| 105 | `railway_env` | railway | 15s | Get or set Railway environment variables |
| 106 | `agentic_snout_ingest` | agentic | 30s | Run Snout agent discovery + ingestion cycle via Python agentic-kit |
| 107 | `agentic_mrp_recalculate` | agentic | 30s | Recalculate PhantomCluster nodes via MRP Engine |
| 108 | `agentic_mrp_route` | agentic | 15s | Dynamic sovereignty-aware routing (capability + geo + cost) |
| 109 | `agentic_hitl_escalate` | agentic | 15s | Create a Linear HITL issue for low-confidence ingests or routing failures |
| 110 | `agentic_contract_issue` | agentic | 15s | Issue an agent contract with SLA (Contractor model) |
| 111 | `agentic_canary_evaluate` | agentic | 15s | Evaluate RL-Canary window for an agent — promote or rollback |
| 112 | `agentic_reward_compute` | agentic | 10s | Compute reward R = 0.4·Q + 0.3·C + 0.3·L for an agent delivery |
| 113 | `agentic_chaos_test` | agentic | 60s | Run chaos engineering test suite (4 scenarios, <2s SLA gate) |
| 114 | `agentic_compliance_audit` | agentic | 15s | Run GDPR Art.44 compliance audit for a data processing action |
| 115 | `flywheel_metrics` | monitor | 15s | Get Value Flywheel metrics + cost summary |
| 116 | `flywheel_consolidation` | monitor | 60s | Get or trigger LLM consolidation scan |
| 117 | `anomaly_status` | monitor | 5s | Get anomaly watcher status |
| 118 | `anomaly_scan` | monitor | 30s | Trigger on-demand anomaly scan |
| 119 | `anomaly_patterns` | monitor | 5s | Get learned anomaly patterns |

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

#### `linear_labels`

**Description:** List available Linear labels for issue categorization. Returns label names, colors, and descriptions.

**Timeout:** 10,000 ms  
**Handler:** mcp-proxy → `linear.labels`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | no | Max results (default 100) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/linear_labels \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `linear_save_issue`

**Description:** Create or update a Linear issue. If `id` is provided, updates the existing issue; otherwise creates a new one. When creating, `title` and `team` are required.

**Timeout:** 15,000 ms  
**Handler:** mcp-proxy → `linear.save_issue`  
**Risk Level:** staged_write

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | no | Issue ID for update (omit for create) |
| `title` | string | no | Issue title (required when creating) |
| `description` | string | no | Issue description as Markdown |
| `team` | string | no | Team name or ID (required when creating) |
| `priority` | integer | no | 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low |
| `assignee` | string | no | User ID, name, email, or "me" |
| `labels` | array | no | Label names or IDs |
| `state` | string | no | State type, name, or ID |
| `estimate` | integer | no | Issue estimate value |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/linear_save_issue \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Fix auth bug", "team": "Backend", "priority": 2}'
```

---

#### `linear_get_issue`

**Description:** Get a single Linear issue by ID or identifier. Returns full issue details with attachments, comments, and git branch name.

**Timeout:** 10,000 ms  
**Handler:** mcp-proxy → `linear.get_issue`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Issue ID or identifier (e.g., LIN-493) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/linear_get_issue \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": "LIN-493"}'
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

**Dual-Format Args Contract (LIN-750):**

This tool accepts arguments in **two equivalent formats** and normalizes them identically:

| Format | Example | Used by |
|--------|---------|---------|
| **Payload** | `{tool_name: "chat_read", payload: {thread_id: "general"}}` | Internal orchestrator |
| **Flat** | `{tool_name: "chat_read", thread_id: "general"}` | External agents (OpenAI function calling) |

**Normalization rule:** If `payload` exists, use it as MCP args. Otherwise, strip `tool_name` and use remaining keys as args. Both formats produce identical internal calls. Verified by `test/dual-format-args.test.mjs` (CHECK 6 in CI gate).

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
| model | 9 | LLM routing, cost governance, budget controls, workflow guards |
| intelligence | 8 | Self-improvement, critique, MoA, tool forging, failure harvesting |
| knowledge | 7 | Semantic + graph search, RAG, document ingestion, OSINT |
| governance | 6 | Approval gates, policy management, audit logging |
| engagement | 5 | First-class consulting engagement entities (v4.0.4 LIN-607) |
| agent | 5 | Agent coordination, dispatch, memory, capabilities |
| system | 4 | Service health, metrics, logs, observability |
| data | 4 | Governed data access: Cypher, stats, Redis, integrity |
| monitor | 4 | Platform health, RAG dashboard, hygiene, tool listing |
| inventor | 7 | Evolution experiments: run, status, nodes, history |
| pheromone | 4 | Stigmergic communication: status, sense, deposit, heatmap |
| peereval | 4 | Fleet learning: status, fleet data, evaluate, analyze |
| hyperagent | 4 | Autonomous executor: run, status, memory, issues |
| decisions | 3 | Architecture decisions: certify, list, lineage |
| linear | 3 | Project tasks and issue tracking |
| cognitive | 3 | Deep reasoning, investigation, context folding |
| graph | 6 | Cypher queries, community detection, drill navigation (4) |
| chains | 2 | Agent chain execution, evolution loop |
| compliance | 2 | Output verification, governance matrix |
| assembly | 3 | Consulting deliverable generation, artifact list/get |
| mcp | 1 | Dynamic MCP tool proxy (449+ backend tools) |
| memory | 2 | Agent working memory: store, retrieve |
| llm | 2 | LLM chat proxy, provider listing |
| grafana | 1 | Grafana Cloud dashboard queries |
| railway | 2 | Railway deployment and environment management |

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

### `memory_search`
**Namespace:** memory | **Timeout:** 15s | **Handler:** orchestrator | **Phantom Week 2 Track B**

Search long-term AgentMemory nodes in Neo4j with structured filters and optional text query. Results are scored by relevance: `recency × importance` where recency = exp(-ageDays/30) and importance is weighted by type (closure=1.0, lesson=0.9, claim=0.8, insight=0.7, heartbeat=0.3, default=0.5).

**Optional:** `agent_id`, `type`, `tags` (array, matches ANY), `query` (text for relevance scoring), `limit` (default 50, max 100)

**Extends existing AgentMemory node type** (per ADR-004: no new node types).

### `memory_consolidate`
**Namespace:** memory | **Timeout:** 120s | **Handler:** orchestrator | **Phantom Week 2 Track B**

Run memory consolidation for an agent (or all agents). Three-phase process:
1. **TTL expiry** — deletes AgentMemory nodes >30 days old (except closure/lesson types)
2. **Dedup merge** — merges nodes with Jaccard similarity ≥0.6, combining content + tags
3. **Budget enforcement** — prunes least-relevant nodes if agent exceeds 1000-node budget

**Optional:** `agent_id` (omit to consolidate all agents)

Returns `ConsolidationReport` with `agents_consolidated`, `total_merged`, `total_expired`, `total_pruned`, and per-agent breakdown.

**Weekly cron:** Sunday 04:00 UTC (`memory-consolidation` cron job).

### `document_convert`
**Namespace:** converter | **Timeout:** 30s | **Handler:** orchestrator | **Phantom Week 3**

Convert documents (PDF, DOCX, XLSX, PPTX, MD, HTML, TXT) to canonical text + structured metadata. Steals patterns from microsoft/markitdown — zero runtime dependency. Output feeds into existing SRAG + Neo4j ingestion pipeline.

**Required:** `content` (base64 or plain text), `mime_type` | **Optional:** `source_path`, `max_text_length` (default 50000), `extract_headings` (default true), `extract_links` (default true)

**Returns:** `source_type`, `source_path`, `text` (truncated to 500 char preview), `word_count`, `char_count`, `language`, `headings` (count), `links` (count), `tables` (count), `images` (count)

**Supported formats:** PDF (via pdf-parse), DOCX (via mammoth), XLSX (via xlsx → markdown tables), PPTX (via xlsx), Markdown (native), HTML (native strip + structure), TXT (native)

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

## v4.0.6 Ghost-Tier Sweep Round 2 (LIN-618)

Seven additional tools from the ghost-tier audit. Continues closing the gap between feature routers and TOOL_REGISTRY compliance.

### `llm_chat`
**Namespace:** llm | **Timeout:** 60s | **Handler:** orchestrator

Direct LLM chat proxy supporting 6 providers (deepseek, qwen, openai, groq, gemini, claude). Returns provider/model/content/usage.

**Required:** `provider`, `messages` | **Optional:** `model`, `temperature`, `max_tokens`

### `llm_providers`
**Namespace:** llm | **Timeout:** 5s | **Handler:** orchestrator

List available LLM providers configured in the orchestrator with their default models.

**No parameters.**

### `decision_certify`
**Namespace:** decisions | **Timeout:** 30s | **Handler:** orchestrator | **LIN-536**

Certify an assembly as an architecture decision. Traverses Assembly → Blocks → Patterns → Signals lineage, produces `DecisionCertificate` with full provenance trail.

**Required:** `assembly_id`, `title` | **Optional:** `description`, `decided_by`

### `decision_list`
**Namespace:** decisions | **Timeout:** 10s | **Handler:** orchestrator

List all certified decisions from Redis store sorted by creation.

**Optional:** `limit` (default 50, max 100)

### `decision_lineage`
**Namespace:** decisions | **Timeout:** 20s | **Handler:** orchestrator | **LIN-536**

Build full lineage chain for a decision or assembly via Neo4j graph traversal. Used for audit and provenance.

**Required:** `assembly_id`

### `artifact_list`
**Namespace:** assembly | **Timeout:** 10s | **Handler:** orchestrator | **G4.2-5**

List `AnalysisArtifact` objects from the broker. Artifacts are Obsidian-Markdown exportable outputs with blocks (text, table, chart, kpi_card, cypher, mermaid).

**Optional:** `limit` (default 20)

### `artifact_get`
**Namespace:** assembly | **Timeout:** 5s | **Handler:** orchestrator | **G4.2-5**

Retrieve a specific AnalysisArtifact by ID with all blocks, graph refs, tags, and metadata.

**Required:** `artifact_id`

---

## v4.0.7 Ghost-Tier Sweep Round 3 (LIN-619)

Final ghost-tier closure: drill stack navigation (G4.15-19) + research harvesting pipeline.

### `drill_start`
**Namespace:** graph | **Timeout:** 15s | **Handler:** orchestrator | **G4.15**

Start a hierarchical drill-down session. Creates Redis session (1h TTL) and returns children at domain level. Path: Domain → Segment → Framework → KPI → Trend → Recommendation.

**Required:** `domain`

### `drill_down`
**Namespace:** graph | **Timeout:** 15s | **Handler:** orchestrator | **G4.16**

Drill into a child level in an active session. Pushes current position to stack.

**Required:** `session_id`, `target_id`, `target_level`

### `drill_up`
**Namespace:** graph | **Timeout:** 15s | **Handler:** orchestrator | **G4.17**

Navigate up one level. Pops parent from stack.

**Required:** `session_id`

### `drill_children`
**Namespace:** graph | **Timeout:** 10s | **Handler:** orchestrator | **G4.18**

Fetch children at current position without navigating. Read-only.

**Required:** `session_id`

### `research_harvest`
**Namespace:** intelligence | **Timeout:** 180s | **Handler:** orchestrator

Trigger the S1-S4 research harvesting pipeline: Extract (OSINT) → Map (cognitive analyze) → Sync/Inject (Neo4j) → Verify (audit).

**Required:** `url` | **Optional:** `source_type`, `topic`, `weights`

---

### `hyperagent_auto_run`
**Namespace:** hyperagent | **Timeout:** 300s | **Handler:** orchestrator

Trigger an autonomous execution cycle. Prioritizes targets by fitness function, plans via RLM, executes via chain engine, evaluates, discovers issues, and evolves weights. Callable from ANY repo via MCP. Persistent memory ensures continuity across sessions and repos.

**Optional:** `phase` (phase_0–phase_3), `max_targets`, `caller_repo`

---

### `hyperagent_auto_status`
**Namespace:** hyperagent | **Timeout:** 10s | **Handler:** orchestrator

Get current autonomous executor status — phase, fitness score, edge scores, running state, cycle count, last cycle results. Callable from ANY repo via MCP.

**Optional:** `include_history` (boolean), `history_limit` (number)

---

### `hyperagent_auto_memory`
**Namespace:** hyperagent | **Timeout:** 15s | **Handler:** orchestrator

Read/write persistent cross-repo memory for the autonomous executor. Stores lessons, discoveries, and execution context in Redis + Neo4j. Memory is keyed by domain and persists across sessions, repos, and restarts.

**Required:** `action` (read/write/list) | **Optional:** `domain`, `key`, `value`, `caller_repo`

---

### `hyperagent_auto_issues`
**Namespace:** hyperagent | **Timeout:** 10s | **Handler:** orchestrator

List all issues discovered during autonomous execution cycles. Issues are accumulated across all cycles and repos. Useful for cross-repo coordination and backlog grooming.

**Optional:** `limit`, `since_cycle`, `caller_repo`

---

### `pheromone_status`
**Namespace:** pheromone | **Timeout:** 5s | **Handler:** orchestrator

Get pheromone layer status: active pheromone count, total deposits, decay cycles, amplifications, trail count. Use to check flywheel health.

---

### `pheromone_sense`
**Namespace:** pheromone | **Timeout:** 5s | **Handler:** orchestrator

Sense pheromones in a domain — returns active signals ranked by strength. Use before task execution to find best trails, or to check which strategies are working in a domain.

**Optional:** `domain`, `type` (attraction/repellent/trail/external/amplification), `tags`, `min_strength`, `limit`

---

### `pheromone_deposit`
**Namespace:** pheromone | **Timeout:** 5s | **Handler:** orchestrator

Deposit a pheromone signal — attraction (good result), repellent (bad result), trail (successful path), or external (outside intelligence). Use after task completion to share learnings with the fleet.

**Required:** `type`, `domain`, `source`
**Optional:** `strength`, `label`, `tags`, `metadata`

---

### `pheromone_heatmap`
**Namespace:** pheromone | **Timeout:** 5s | **Handler:** orchestrator

Get cross-domain pheromone heatmap — shows which domains have the strongest signals and most activity. Use for strategic overview of where the flywheel is spinning fastest.

---

### `peer_eval_status`
**Namespace:** peereval | **Timeout:** 5s | **Handler:** orchestrator

Get fleet learning status: total evals, task types tracked, best practices shared. Use to check if the fleet is learning effectively.

---

### `peer_eval_fleet`
**Namespace:** peereval | **Timeout:** 10s | **Handler:** orchestrator

Get fleet learning data for a specific task type or all task types. Returns best agent, average efficiency, top strategies from pheromone trails, and EMA-aggregated scores.

**Optional:** `task_type`

---

### `peer_eval_evaluate`
**Namespace:** peereval | **Timeout:** 15s | **Handler:** orchestrator

Trigger a manual peer evaluation for an agent task. Records self-assessment, deposits pheromones, updates fleet learning, and broadcasts best practices if score + novelty are high.

**Required:** `agent_id`
**Optional:** `task_id`, `context`

---

### `peer_eval_analyze`
**Namespace:** peereval | **Timeout:** 45s | **Handler:** orchestrator

Run RLM-powered fleet analysis — identifies underperformers, top strategies, and strategic recommendations across all task types. Expensive but high-value. Runs weekly via cron.

---

### `inventor_run`
**Namespace:** inventor | **Timeout:** 30s | **Handler:** orchestrator

Start or resume an Inventor evolution experiment. Fire-and-forget — poll inventor_status for progress. Supports UCB1, greedy, random, or island (MAP-Elites) sampling.

**Required:** `experiment_name`, `task_description`
**Optional:** `initial_artifact`, `sampling_algorithm`, `sample_n`, `max_steps`, `chain_mode`, `resume`

---

### `inventor_status`
**Namespace:** inventor | **Timeout:** 5s | **Handler:** orchestrator

Get current Inventor experiment status: running state, current step, total steps, nodes created, best score, best node ID, sampling algorithm, and last error if any.

---

### `inventor_nodes`
**Namespace:** inventor | **Timeout:** 5s | **Handler:** orchestrator

List all Inventor trial nodes from current or last experiment. Sortable by score or creation time.

**Optional:** `sort` (score|created), `limit`, `offset`

---

### `inventor_node`
**Namespace:** inventor | **Timeout:** 5s | **Handler:** orchestrator

Get a specific Inventor trial node by ID. Returns full artifact, score, metrics, analysis, motivation, parent lineage.

**Required:** `node_id`

---

### `inventor_best`
**Namespace:** inventor | **Timeout:** 5s | **Handler:** orchestrator

Get the best-scoring Inventor trial node from the current or last experiment. Returns the winning solution with full artifact and metadata.

---

### `inventor_stop`
**Namespace:** inventor | **Timeout:** 5s | **Handler:** orchestrator

Stop a running Inventor evolution experiment. Returns success status and confirmation message.

---

### `inventor_history`
**Namespace:** inventor | **Timeout:** 5s | **Handler:** orchestrator

List evolution experiment history from the current or last session. Sortable and paginated results.

**Optional:** `limit` (max results, default 50)

---

## Neural Bridge v2 — Governed Control Plane (LIN-620)

31 tools across 7 new domains providing governed data access, system observability, agent coordination, model cost governance, workflow controls, governance approval gates, Grafana observability, and Railway deployment. Read-only by default. Writes require HyperAgent plan + approval.

### data — Governed Data Access (4 tools)

---

#### `data_graph_read`

**Description:** Execute a read-only Cypher query against Neo4j. Use for structured data queries, counting nodes, finding relationships, listing entities. No mutations allowed.

**Timeout:** 15,000 ms
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cypher` | string | yes | Neo4j Cypher query (read-only, parameterized) |
| `params` | object | no | Query parameters |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/data_graph_read \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"cypher": "MATCH (c:Client)-[:HAS_DOMAIN]->(d:Domain) WHERE d.name = $domain RETURN c.name LIMIT 10", "params": {"domain": "telecom"}}'
```

---

#### `data_graph_stats`

**Description:** Get Neo4j graph statistics: node counts by label, relationship counts, domain distribution. Use for data health monitoring.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.stats`

**Input Parameters:** None

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/data_graph_stats \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `data_redis_inspect`

**Description:** Inspect Redis state: key count, memory usage, connected clients. Use for cache health monitoring. No writes, no flush, no delete.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `redis.inspect`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key_pattern` | string | no | Key pattern to inspect (default: * for count only) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/data_redis_inspect \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key_pattern": "agent:*"}'
```

---

#### `data_integrity_check`

**Description:** Run data integrity checks: orphaned nodes, stale relationships, schema violations, embedding coverage. Use for data quality monitoring.

**Timeout:** 30,000 ms
**Handler:** mcp-proxy → `graph.hintegrity_run`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | no | Domain to check (default: all) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/data_integrity_check \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"domain": "telecom"}'
```

---

### system — Service Health, Metrics, Logs (4 tools)

---

#### `system_health`

**Description:** Get current health status of all platform services: backend, orchestrator, RLM engine, Neo4j, Redis. Use for system status checks.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.health + graph.stats`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | enum | no | Target service: all, backend, orchestrator, rlm, neo4j, redis (default: all) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/system_health \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service": "all"}'
```

---

#### `system_service_status`

**Description:** Get service status: uptime, version, resource usage, connection counts. Use for operational monitoring.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.health`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | string | yes | Service name (backend, orchestrator, rlm, neo4j, redis) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/system_service_status \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service": "neo4j"}'
```

---

#### `system_metrics_summary`

**Description:** Get Prometheus metrics summary: health status, uptime, agents, pheromones, peer evals, circuit breakers, rate limits. Use for observability queries.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.health`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `metric_group` | enum | no | Metric group: all, health, agents, pheromones, peer_eval, circuit_breaker, rate_limit (default: all) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/system_metrics_summary \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"metric_group": "agents"}'
```

---

#### `system_logs_summary`

**Description:** Get recent log summary: error counts, warning patterns, service restarts. Use for operational troubleshooting.

**Timeout:** 15,000 ms
**Handler:** mcp-proxy → `failure_harvest`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | string | no | Target service (default: all) |
| `window_hours` | number | no | Time window in hours (default: 1) |
| `level` | enum | no | Log level: error, warn, info (default: error) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/system_logs_summary \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"level": "warn", "window_hours": 2}'
```

---

### agent — Agent Coordination and Dispatch (5 tools)

---

#### `agent_list`

**Description:** List all registered agents with their status, capabilities, and last seen timestamp. Use for agent fleet overview.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | enum | no | Filter by status: all, online, offline, busy (default: all) |
| `namespace` | string | no | Filter by tool namespace |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agent_list \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "online"}'
```

---

#### `agent_status`

**Description:** Get detailed status of a specific agent: capabilities, active tasks, error history, trust score. Use for agent health checks.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | yes | Agent identifier |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agent_status \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "qwen"}'
```

---

#### `agent_dispatch`

**Description:** Dispatch a task to an agent via peer evaluation. Use for agent work assignment. Requires task type, agent ID, and context. Creates a peer eval entry.

**Timeout:** 15,000 ms
**Handler:** mcp-proxy → `peer_eval_evaluate`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | yes | Target agent identifier |
| `task_id` | string | yes | Task identifier |
| `task_type` | string | yes | Task type for peer evaluation tracking |
| `context` | string | yes | Task context and instructions |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agent_dispatch \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "compliance-officer", "task_id": "task-001", "task_type": "compliance_review", "context": "Review EU AI Act exposure for telecom client"}'
```

---

#### `agent_memory`

**Description:** Get agent working memory summary: stored keys, memory usage, TTL status. Use for agent state inspection.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `memory_retrieve`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | yes | Agent identifier |
| `key` | string | no | Specific memory key (default: list all) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agent_memory \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "qwen"}'
```

---

#### `agent_capabilities`

**Description:** Get agent capabilities: registered tool namespaces, allowed tools, current workload. Use for agent routing decisions.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | yes | Agent identifier |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agent_capabilities \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "compliance-officer"}'
```

---

#### `chat_send`

**Description:** Send a message to another agent or broadcast to all agents via the orchestrator chat bus. Use for A2A coordination: share findings, request review, trigger debate. `to="All"` broadcasts.

**Timeout:** 10,000 ms | **Risk:** read_only

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | string | yes | Sender agent ID (e.g. "chatgpt", "qwen") |
| `to` | string | yes | Recipient agent ID or "All" |
| `message` | string | yes | Message content |
| `thread_id` | string | no | Thread ID for conversation grouping |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/chat_send \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from": "chatgpt", "to": "qwen", "message": "My analysis: X. Please critique."}'
```

---

#### `chat_read`

**Description:** Read recent messages from the orchestrator chat bus. Use to see what other agents have said, check for replies, or follow an A2A debate thread.

**Timeout:** 10,000 ms | **Risk:** read_only

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | no | Messages to fetch (default 20, max 100) |
| `from_agent` | string | no | Filter by sender agent ID |
| `thread_id` | string | no | Filter to specific thread |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/chat_read \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10, "from_agent": "qwen"}'
```

---

### agentic — Python agentic-kit MCP Wrappers (9 tools)

Tools that spawn Python subprocesses via `agentic-kit/run_mcp.py` to execute the Phase 1–4 agentic pipeline: Snout ingestion, MRP routing, HITL, contracts, RL-Canary, chaos tests, and GDPR compliance.

---

#### `agentic_snout_ingest`

**Description:** Run Snout agent discovery + ingestion cycle. Calls `SnoutIngestor` in Python, writes Agent + Provider nodes to Neo4j with ADR-003 evidence chain.

**Timeout:** 30,000 ms | **Risk:** staged_write

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | no | `discovery` (mock cycle) or `ingest` (single agent). Default: discovery |
| `agent_data` | object | no | Required when mode=ingest. Fields: agent_id, provider, model_name, pricing_input, pricing_output, context_window, capabilities, sov_data_residency, sov_exec_residency, confidence |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_snout_ingest \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"discovery"}'
```

---

#### `agentic_mrp_recalculate`

**Description:** Recalculate PhantomCluster nodes via MRP Engine. Scans all Agent nodes, groups by (capability × geo), computes validity_score = 0.4·Q + 0.3·R + 0.2·U + 0.1·C, MERGEs clusters to Neo4j.

**Timeout:** 30,000 ms | **Risk:** staged_write

**Input Parameters:** none

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_mrp_recalculate \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `agentic_mrp_route`

**Description:** Dynamic sovereignty-aware routing. Selects optimal Agent + PhantomCluster for a capability request, enforcing validity_score > 0.75 and cost constraints.

**Timeout:** 15,000 ms | **Risk:** read_only

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `capability` | string | yes | Required capability (e.g. `reasoning`, `math`) |
| `geo` | string | no | Geo constraint: EU, US, CN, ANY. Default: ANY |
| `max_cost` | number | no | Max cost per 1K tokens. Default: 0.00001 |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_mrp_route \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"capability":"reasoning","geo":"EU","max_cost":0.00001}'
```

---

#### `agentic_hitl_escalate`

**Description:** Create a Linear HITL issue for low-confidence ingests or routing failures. Routes to human review queue.

**Timeout:** 15,000 ms | **Risk:** staged_write

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `issue_type` | string | no | Type of HITL issue. Default: Low Confidence Ingest |
| `context` | object | no | Structured context for the issue (agent_id, confidence, etc.) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_hitl_escalate \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"issue_type":"Low Confidence Ingest","context":{"agent_id":"qwen-eu-v2.5","confidence":0.63}}'
```

---

#### `agentic_contract_issue`

**Description:** Issue an agent contract with SLA via the Contractor model (Phase 4). Creates a Contract node in Neo4j with ADR-003 audit trail.

**Timeout:** 15,000 ms | **Risk:** staged_write

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `requester` | string | yes | Requesting system or agent ID |
| `contractor_agent_id` | string | yes | Agent that will fulfil the contract |
| `deliverable_spec` | object | no | Deliverable specification (task, max_tokens, etc.) |
| `sla_latency_ms` | number | no | Latency SLA in ms. Default: 5000 |
| `sla_quality_threshold` | number | no | Quality threshold. Default: 0.85 |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_contract_issue \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requester":"mrp_engine","contractor_agent_id":"qwen-eu-v2.5","deliverable_spec":{"task":"reasoning"}}'
```

---

#### `agentic_canary_evaluate`

**Description:** Evaluate RL-Canary window for an agent. Checks reward delta over last N windows and returns PROMOTE / HOLD / ROLLBACK decision.

**Timeout:** 15,000 ms | **Risk:** staged_write

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | string | yes | Agent ID to evaluate canary window for |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_canary_evaluate \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"mistral-eu-large-v2"}'
```

---

#### `agentic_reward_compute`

**Description:** Compute reward R = 0.4·Quality + 0.3·CostEfficiency + 0.3·LatencyScore for an agent delivery. Optionally persists reward log to Neo4j.

**Timeout:** 10,000 ms | **Risk:** staged_write

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `quality_score` | number | yes | Quality score 0–1 |
| `cost_per_1k` | number | yes | Cost per 1K tokens (USD) |
| `latency_ms` | number | yes | Response latency in milliseconds |
| `agent_id` | string | no | If provided, persists reward log to Neo4j |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_reward_compute \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quality_score":0.9,"cost_per_1k":0.000002,"latency_ms":320,"agent_id":"qwen-eu-v2.5"}'
```

---

#### `agentic_chaos_test`

**Description:** Run chaos engineering test suite (4 scenarios: primary timeout, single-agent cluster, full outage, geo failover). Gate: all scenarios must resolve in <2s.

**Timeout:** 60,000 ms | **Risk:** staged_write

**Input Parameters:** none

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_chaos_test \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `agentic_compliance_audit`

**Description:** Run GDPR Art.44 compliance audit for a data processing action. Checks GCP_REGION against EU allowlist; logs violations to Neo4j + Linear HITL.

**Timeout:** 15,000 ms | **Risk:** staged_write

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | no | Processing action (e.g. `vendor_scrape`, `audit`). Default: audit |
| `data_class` | string | no | Data classification: PII, CONFIDENTIAL, GENERAL. Default: GENERAL |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/agentic_compliance_audit \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"vendor_scrape","data_class":"PII"}'
```

---

#### `flywheel_metrics`

**Description:** Get the Value Flywheel metrics — 5 pillars + compound score, plus latest consolidation scan report and cost optimizer summary. Use to check platform growth health.

**Timeout:** 15,000 ms | **Handler:** orchestrator

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/flywheel_metrics \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `flywheel_consolidation`

**Description:** Get or trigger the LLM consolidation engine — scans codebase for duplicate functionality, unused dependencies, and simplification opportunities.

**Timeout:** 60,000 ms | **Handler:** orchestrator

**Optional:** `trigger` (boolean — if true, run a new scan)

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/flywheel_consolidation \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `anomaly_status`

**Description:** Get anomaly watcher status — scan count, active anomalies, learned patterns. Use for proactive system health monitoring.

**Timeout:** 10,000 ms | **Handler:** orchestrator

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/anomaly_status \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `anomaly_scan`

**Description:** Trigger an on-demand anomaly scan — checks backend/RLM/Redis reachability, detects anomalies, returns analysis. Debounced: min 30s between scans.

**Timeout:** 30,000 ms | **Handler:** orchestrator

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/anomaly_scan \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

#### `anomaly_patterns`

**Description:** Get learned anomaly patterns with frequency and known fixes.

**Timeout:** 10,000 ms | **Handler:** orchestrator

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/anomaly_patterns \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### model — LLM Routing, Cost Governance, Budget Controls (9 tools)

---

#### `model_providers`

**Description:** List available LLM providers: models, costs, capabilities, rate limits. Use for model selection and routing decisions.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `llm_providers`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | no | Filter by provider name |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/model_providers \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"provider": "deepseek"}'
```

---

#### `model_route`

**Description:** Route a task to the optimal LLM based on LLM Matrix: cost, capability, availability. Returns cheapest-first chain. Use for cost-aware model selection.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `llm_providers`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_type` | string | yes | Task type for routing (e.g., code_generation, reasoning, folding) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/model_route \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"task_type": "reasoning"}'
```

---

#### `model_cost_estimate`

**Description:** Estimate cost for a model call: tokens, price per 1K tokens, total cost in DKK. Use for cost governance before executing expensive calls.

**Timeout:** 5,000 ms
**Handler:** mcp-proxy → `llm_providers`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | yes | LLM provider (deepseek, qwen, gemini, claude, openai) |
| `model` | string | yes | Model name |
| `estimated_tokens` | number | yes | Estimated input + output tokens |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/model_cost_estimate \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"provider": "deepseek", "model": "deepseek-chat", "estimated_tokens": 8000}'
```

---

#### `model_budget_status`

**Description:** Get current budget status: tokens consumed, cost incurred, remaining budget, rate limit status. Use for cost monitoring.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.health`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | string | no | Target service (default: all) |
| `window_hours` | number | no | Time window in hours (default: 24) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/model_budget_status \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"window_hours": 48}'
```

---

#### `model_policy_check`

**Description:** Check if a model call complies with cost governance policy: Claude escalation rules, premium model limits, budget caps. Use before expensive calls.

**Timeout:** 5,000 ms
**Handler:** mcp-proxy → `llm_providers`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | yes | LLM provider |
| `model` | string | yes | Model name |
| `is_escalation` | boolean | no | Whether this is an escalation call (default: false) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/model_policy_check \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"provider": "claude", "model": "claude-sonnet-4-20250514", "is_escalation": true}'
```

---

#### `workflow_cost_trace`

**Description:** Get cost trace for a workflow: token usage per step, model calls, total cost, budget remaining. Use for workflow cost auditing.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain_id` | string | no | Chain/workflow identifier |
| `window_hours` | number | no | Time window in hours (default: 1) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/workflow_cost_trace \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chain_id": "compliance-chain-001"}'
```

---

#### `workflow_context_compact`

**Description:** Compact context before delegation: reduce token count, remove redundancy, preserve key information. Use before expensive model calls to save cost.

**Timeout:** 30,000 ms
**Handler:** mcp-proxy → `context_fold`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `context` | string | yes | Context to compact |
| `target_tokens` | number | no | Target token count (default: 4000) |
| `domain` | string | no | Domain for attention-focused folding |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/workflow_context_compact \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"context": "Full regulatory document with 50 pages...", "target_tokens": 2000}'
```

---

#### `workflow_fanout_guard`

**Description:** Check if a workflow fan-out exceeds limits: max parallel steps, max agents, max premium model calls. Use before executing parallel chains.

**Timeout:** 5,000 ms
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `parallel_steps` | number | yes | Number of parallel steps |
| `agents` | array of string | no | Agent list for fan-out |
| `premium_calls` | number | no | Number of premium model calls |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/workflow_fanout_guard \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"parallel_steps": 5, "agents": ["qwen", "claude", "gemini"], "premium_calls": 2}'
```

---

#### `workflow_premium_escalation_check`

**Description:** Check if a Claude/premium model escalation is justified: task complexity, previous failures, cost budget, policy compliance. Use before premium calls.

**Timeout:** 5,000 ms
**Handler:** mcp-proxy → `llm_providers`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `provider` | string | yes | Premium provider (claude, openai) |
| `task` | string | yes | Task description |
| `prior_failures` | number | no | Number of prior failures with cheaper models |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/workflow_premium_escalation_check \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"provider": "claude", "task": "Complex regulatory analysis", "prior_failures": 2}'
```

---

### governance — Approval Gates, Policy, Audit (6 tools)

---

#### `governance_plan_create`

**Description:** Create a governance plan for a cross-domain or write-capable operation. Requires description, scope, risk assessment. Returns plan ID for approval.

**Timeout:** 30,000 ms
**Handler:** mcp-proxy → `hyperagent_auto_run`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | yes | Plan description |
| `scope` | enum | yes | Risk scope: read_only, staged_write, production_write |
| `target_service` | string | yes | Target service |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/governance_plan_create \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description": "Update Neo4j schema for new compliance framework", "scope": "staged_write", "target_service": "neo4j"}'
```

---

#### `governance_plan_approve`

**Description:** Approve a pending governance plan. Requires plan ID and approver identity. Use for approval gate enforcement.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `hyperagent_auto_memory`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | yes | Plan identifier |
| `approver` | string | yes | Approver identity |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/governance_plan_approve \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "plan-001", "approver": "qwen"}'
```

---

#### `governance_plan_execute`

**Description:** Execute an approved governance plan. Triggers the planned operation with policy profile enforcement. Use after approval gate.

**Timeout:** 60,000 ms
**Handler:** mcp-proxy → `hyperagent_auto_run`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | yes | Approved plan identifier |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/governance_plan_execute \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "plan-001"}'
```

---

#### `governance_plan_evaluate`

**Description:** Evaluate a completed governance plan: success, failure, KPI impact, lessons learned. Use for post-execution review.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `hyperagent_auto_memory`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_id` | string | yes | Completed plan identifier |
| `outcome` | enum | yes | Execution outcome: success, partial, failed |
| `kpi_impact` | number | no | KPI impact score (-1 to 1) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/governance_plan_evaluate \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"plan_id": "plan-001", "outcome": "success", "kpi_impact": 0.3}'
```

---

#### `governance_audit_query`

**Description:** Query audit log for governance events: plan approvals, write operations, policy violations, deployment changes. Use for compliance auditing.

**Timeout:** 15,000 ms
**Handler:** mcp-proxy → `failure_harvest`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_type` | enum | no | Filter by event type: plan_approved, write_operation, policy_violation, deployment |
| `window_hours` | number | no | Time window in hours (default: 24) |
| `limit` | number | no | Max results (default: 50) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/governance_audit_query \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event_type": "plan_approved", "window_hours": 48}'
```

---

#### `governance_policy_decide`

**Description:** Query or update governance policy: tool risk classes, allowed providers, cost limits, approval thresholds. Use for policy management.

**Timeout:** 10,000 ms
**Handler:** mcp-proxy → `graph.read_cypher`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | yes | Action: get current policy or update |
| `policy_key` | string | yes | Policy key (e.g., max_tokens, claude_escalation_allowed) |
| `policy_value` | any | no | New policy value (for update action) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/governance_policy_decide \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "get", "policy_key": "max_tokens"}'
```

---

### grafana — Observability (1 tool)

---

#### `grafana_dashboard`

**Description:** Query Grafana Cloud dashboards and panels. Use for platform observability, metrics visualization, and alert status.

**Timeout:** 15,000 ms
**Handler:** mcp-proxy → `grafana.dashboard`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dashboard_uid` | string | no | Dashboard UID (default: widgetdc-platform-monitor) |
| `panel_id` | number | no | Specific panel ID |
| `from` | string | no | Time range from (default: now-6h) |
| `to` | string | no | Time range to (default: now) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/grafana_dashboard \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dashboard_uid": "widgetdc-platform-monitor", "from": "now-24h"}'
```

---

### railway — Deployment & Infrastructure (2 tools)

---

#### `railway_deploy`

**Description:** Trigger a Railway deployment or check deployment status. Use for deploy verification, health checks, and service restarts.

**Timeout:** 30,000 ms
**Handler:** mcp-proxy → `railway.deploy`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | enum | no | Target service: backend, orchestrator, rlm-engine (default: current) |
| `action` | enum | no | Action to perform: deploy, status, restart, logs (default: status) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/railway_deploy \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service": "orchestrator", "action": "status"}'
```

---

#### `railway_env`

**Description:** Get or set Railway environment variables for any service. Use for configuration changes, API key updates, and feature flags.

**Timeout:** 15,000 ms
**Handler:** mcp-proxy → `railway.env`

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | string | yes | Target service name |
| `action` | enum | yes | Action: get, set, or list env vars |
| `key` | string | no | Variable key (for get/set) |
| `value` | string | no | Variable value (for set) |

**Example:**
```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/tools/railway_env \
  -H "Authorization: Bearer $ORCHESTRATOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"service": "orchestrator", "action": "get", "key": "NEO4J_URI"}'
```

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
