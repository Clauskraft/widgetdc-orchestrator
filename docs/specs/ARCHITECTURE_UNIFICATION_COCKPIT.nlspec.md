# NLSpec: Architecture Unification Cockpit

**Version:** 1.0 | **Date:** 2026-04-13 | **Parent:** [VISION_UNIFIED_COCKPIT.md](/C:/Users/claus/Projetcs/widgetdc-orchestrator/docs/VISION_UNIFIED_COCKPIT.md:63)
**Target:** `widgetdc-orchestrator` | **Effort:** 3 phases / 4-8 weeks

---

## System

The platform converges `arch-mcp-server-production.up.railway.app` into the orchestrator operating model.

The target state is:
- One cockpit
- One public URL
- One auth model
- One canonical architecture graph in Neo4j
- One internal `arch-analysis` worker behind orchestrator

Architecture insight becomes a native orchestrator capability rather than a sidecar product. The orchestrator exposes typed `/api/architecture/*` contracts, stores architecture memory as first-class graph entities, and composes architecture data with chains, agents, PRs, deployments, issues, and runtime health.

## Actors

| Actor | Role |
|-------|------|
| **Cockpit UI** | Human-facing operator workbench inside orchestrator frontend |
| **Architecture Facade** | New orchestrator API surface under `/api/architecture/*` |
| **Arch Analysis Worker** | Internal compute service for harvesting, graph-delta analysis, anti-pattern detection, and PR-impact jobs |
| **Neo4j Graph** | Canonical persistence for runtime graph + architecture memory |
| **Event Ingestor** | Internal orchestrator endpoint receiving PR, deployment, chain, and analysis events |
| **Linear Bridge** | Links findings to issues and delivery state |
| **Git/PR Integrator** | Supplies changed files, branch refs, commit SHAs, and PR metadata |

## Behaviors

### B-1: One Front Door

**WHEN** a user or agent needs architecture data  
**THEN** the request goes to the orchestrator domain only  
**AND** no public UI or frontend flow depends on direct calls to `arch-mcp-server-production.up.railway.app`

### B-2: Architecture Facade

**WHEN** the frontend requests architecture overview, graph, impact, PR-risk, or findings  
**THEN** orchestrator serves stable JSON contracts under `/api/architecture/*`  
**AND** orchestrator may proxy legacy arch-service data during migration  
**BUT** the frontend never sees legacy payload shapes

### B-3: First-Class Architecture Memory

**WHEN** architecture analysis runs  
**THEN** results are written into Neo4j as first-class nodes and relations  
**AND** they can be traversed together with `:Agent`, `:Chain`, `:LinearIssue`, `:Deployment`, and runtime entities

### B-4: Impact Mode

**WHEN** an operator selects a service, PR, chain, deployment, or module  
**THEN** orchestrator returns a single impact view containing:
- impacted modules
- findings and severities
- chains that use those modules
- related agents and claims
- linked Linear issues
- deployment exposure
- runtime risk summary

### B-5: PR-Aware Architecture

**WHEN** a PR is opened or synchronized  
**THEN** orchestrator creates or updates a `:PullRequest` node  
**AND** the arch-analysis worker computes graph delta, dependency risk, affected chains, affected issues, and findings introduced/resolved  
**AND** the result is queryable via `/api/architecture/pull-requests/{repo}/{number}`

### B-6: Deployment-Aware Risk

**WHEN** a deployment completes  
**THEN** an internal event is ingested by orchestrator  
**AND** a `:Deployment` node is linked to affected services  
**AND** active unresolved findings on those services/modules become part of runtime risk summaries

### B-7: Worker Behind Orchestrator

**WHEN** heavyweight architecture analysis is required  
**THEN** orchestrator creates an internal analysis job  
**AND** the `arch-analysis` worker executes it asynchronously  
**AND** status is exposed through orchestrator job endpoints  
**AND** raw worker endpoints are not public contracts

### B-8: Verified Writes

**WHEN** orchestrator links findings to issues, modules to services, PRs to modules, or jobs to snapshots  
**THEN** writes use parameterized Cypher only  
**AND** material writes return read-back verification before success is reported

### B-9: Retirement of Standalone Arch App

**WHEN** phase 3 is complete  
**THEN** the standalone arch frontend is retired  
**AND** the old public URL redirects to orchestrator architecture surfaces  
**AND** Neo4j becomes the sole canonical architecture store

## Constraints

| ID | Constraint |
|----|-----------|
| C-1 | Public consumers only talk to orchestrator contracts |
| C-2 | Legacy arch-service payloads must be normalized at the orchestrator boundary |
| C-3 | All graph writes use parameterized Cypher and read-back verification |
| C-4 | Impact mode must tolerate partial data and declare degraded sources explicitly |
| C-5 | Architecture entities must coexist with existing Neo4j ontology without label collisions |
| C-6 | PR and deployment ingestion must be idempotent on repeated events |
| C-7 | Worker failures must not break cockpit availability; job state degrades independently |
| C-8 | Auth remains `Authorization: Bearer <token>` at the public orchestrator surface; internal worker auth is service-to-service only |

## Neo4j Model

### Labels

| Label | Required properties |
|-------|---------------------|
| `ArchService` | `id`, `name`, `repo`, `tier` |
| `ArchModule` | `id`, `name`, `path`, `repo` |
| `ArchInterface` | `id`, `name`, `kind` |
| `ArchFinding` | `id`, `type`, `severity`, `title`, `status` |
| `ArchSnapshot` | `id`, `generatedAt`, `source`, `ref` |
| `PullRequest` | `id`, `repo`, `number`, `headSha`, `baseSha`, `status` |
| `Deployment` | `id`, `service`, `env`, `version`, `deployedAt` |

### Core Relations

| From | Relation | To |
|------|----------|----|
| `ArchService` | `CONTAINS` | `ArchModule` |
| `ArchModule` | `DEPENDS_ON` | `ArchModule` |
| `ArchModule` | `EXPOSES` | `ArchInterface` |
| `ArchFinding` | `AFFECTS` | `ArchModule` |
| `ArchFinding` | `OBSERVED_IN` | `ArchSnapshot` |
| `PullRequest` | `CHANGES` | `ArchModule` |
| `PullRequest` | `INTRODUCES_RISK` | `ArchFinding` |
| `PullRequest` | `RESOLVES_RISK` | `ArchFinding` |
| `Deployment` | `DEPLOYS` | `ArchService` |
| `Chain` | `USES_MODULE` | `ArchModule` |
| `Agent` | `OWNS` | `ArchFinding` |
| `LinearIssue` | `TRACKS` | `ArchFinding` |

## API Contracts

### 1. Overview

```http
GET /api/architecture/overview?scope=platform|repo|service&target=<id>
Authorization: Bearer <token>
```

```json
{
  "scope": "service",
  "target": "orchestrator",
  "summary": {
    "services": 12,
    "modules": 1018,
    "findings_open": 42,
    "deployments_at_risk": 3
  },
  "health": {
    "avg_health": 91,
    "critical_count": 2
  },
  "top_findings": [
    {
      "id": "af_123",
      "type": "orphan_module",
      "severity": "high",
      "title": "Unreferenced module in chat pipeline"
    }
  ],
  "sources": ["neo4j", "runtime-health", "arch-worker"],
  "generated_at": "2026-04-13T17:10:00Z"
}
```

### 2. Graph

```http
GET /api/architecture/graph?scope=service&target=backend&depth=2&include=findings,chains,issues,deployments
```

```json
{
  "nodes": [
    { "id": "svc_backend", "label": "ArchService", "properties": { "name": "backend" } },
    { "id": "mod_chat", "label": "ArchModule", "properties": { "path": "src/routes/chat.ts" } }
  ],
  "edges": [
    { "from": "svc_backend", "to": "mod_chat", "type": "CONTAINS" }
  ],
  "meta": {
    "scope": "service",
    "target": "backend",
    "depth": 2,
    "degraded_sources": []
  }
}
```

### 3. Impact Query

```http
POST /api/architecture/impact/query
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "subject": {
    "type": "service",
    "id": "orchestrator"
  },
  "include": [
    "modules",
    "findings",
    "chains",
    "agents",
    "issues",
    "deployments",
    "runtime_risks"
  ]
}
```

```json
{
  "subject": { "type": "service", "id": "orchestrator" },
  "affected_modules": [
    { "id": "mod_tool_executor", "path": "src/tools/tool-executor.ts", "risk": "high" }
  ],
  "active_findings": [
    { "id": "af_441", "severity": "high", "title": "Bypass surface in tool execution" }
  ],
  "affected_chains": [
    { "id": "reason_deeply", "name": "Reason pipeline", "risk": "medium" }
  ],
  "related_issues": [
    { "id": "LIN-766", "state": "In Progress", "priority": 2 }
  ],
  "agents": [
    { "agent_id": "codex", "relation": "owns_fix" }
  ],
  "runtime_risks": [
    { "kind": "deployment_exposure", "service": "orchestrator", "level": "high" }
  ],
  "sources": ["neo4j", "linear", "runtime-health"]
}
```

### 4. PR-Aware Architecture

```http
GET /api/architecture/pull-requests/{repo}/{number}
Authorization: Bearer <token>
```

```json
{
  "pr": {
    "repo": "widgetdc-orchestrator",
    "number": 412,
    "head_sha": "abc123",
    "status": "open"
  },
  "changed_modules": [
    { "id": "mod_tool_executor", "path": "src/tools/tool-executor.ts" }
  ],
  "expected_graph_delta": {
    "nodes_added": 2,
    "nodes_removed": 0,
    "edges_added": 5,
    "edges_removed": 1
  },
  "dependency_risk": "medium",
  "affected_chains": ["reason_deeply", "chat.summarize"],
  "affected_agents": ["codex"],
  "affected_issues": ["LIN-766"],
  "findings_introduced": [],
  "findings_resolved": ["af_441"]
}
```

### 5. Analysis Job Create

```http
POST /api/architecture/jobs/analyze
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "mode": "pr_delta",
  "repo": "widgetdc-orchestrator",
  "ref": "refs/pull/412/head",
  "options": {
    "include_dependency_graph": true,
    "include_findings": true,
    "include_runtime_links": true
  }
}
```

```json
{
  "job_id": "archjob_01",
  "status": "queued"
}
```

### 6. Analysis Job Status

```http
GET /api/architecture/jobs/{job_id}
Authorization: Bearer <token>
```

```json
{
  "job_id": "archjob_01",
  "status": "completed",
  "result_ref": "/api/architecture/pull-requests/widgetdc-orchestrator/412"
}
```

### 7. Internal Event Ingest

```http
POST /internal/architecture/events
Content-Type: application/json
X-Service-Token: <internal-token>
```

```json
{
  "event_type": "deployment.completed",
  "service": "orchestrator",
  "deployment_id": "dep_778",
  "version": "4.4.0",
  "timestamp": "2026-04-13T17:12:00Z"
}
```

### 8. Verified Link Write

```http
POST /api/architecture/findings/{id}/link-issue
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "linear_issue_id": "LIN-766"
}
```

```json
{
  "ok": true,
  "write": {
    "finding_id": "af_441",
    "linear_issue_id": "LIN-766"
  },
  "read_back": {
    "verified": true,
    "relation": "TRACKS"
  }
}
```

## Migration Phases

### Phase 1: Facade + Front Door

**Goal:** Make orchestrator the only public architecture surface without requiring immediate full graph migration.

**Changes**
- Add `/api/architecture/*` routes in orchestrator
- Normalize legacy arch-service payloads into stable contracts
- Add cockpit panels: `Architecture`, `Impact`, `PR Risk`
- Route all frontend architecture calls through orchestrator
- Keep arch service internal or semi-private during the transition

**Exit Gates**
- No public frontend requests hit arch-service directly
- One auth model across cockpit and architecture surfaces
- Overview, graph, and findings views work through orchestrator contracts

### Phase 2: Graph Convergence + Impact Mode

**Goal:** Make Neo4j the canonical architecture memory and unlock cross-domain traversal.

**Changes**
- Ingest architecture snapshots into Neo4j
- Materialize `ArchService`, `ArchModule`, `ArchFinding`, `ArchSnapshot`, `PullRequest`, and `Deployment`
- Link architecture entities to `Chain`, `Agent`, `LinearIssue`
- Implement `impact/query`
- Add event ingestion for PR and deployment updates

**Exit Gates**
- Impact mode returns graph + runtime + issue + chain context in one response
- PR-aware architecture results are queryable by repo and number
- Active findings can be traced to modules, chains, deployments, and issues

### Phase 3: Worker Internalization + Retirement

**Goal:** Remove the standalone arch product boundary.

**Changes**
- Rename operational role of arch service to `arch-analysis-worker`
- Restrict it to internal job execution
- Redirect old public entrypoints to orchestrator
- Remove duplicate graph truth outside Neo4j

**Exit Gates**
- Old public arch URL is retired or redirected
- Orchestrator is sole public control plane
- Neo4j is sole canonical architecture store

## File Map

| File | Change | Purpose |
|------|--------|---------|
| `src/routes/architecture.ts` | **NEW** | Public architecture facade routes |
| `src/services/architecture-service.ts` | **NEW** | Contract normalization, orchestration, and query composition |
| `src/services/architecture-worker-client.ts` | **NEW** | Internal worker client for async jobs |
| `src/services/impact-query.ts` | **NEW** | Cross-graph impact mode composition |
| `src/services/architecture-graph.ts` | **NEW** | Neo4j reads/writes for architecture entities |
| `src/routes/internal-architecture.ts` | **NEW** | Internal event ingest for deployment/PR/job events |
| `src/openapi.ts` | **MODIFY** | Add `/api/architecture/*` and internal contracts |
| `src/index.ts` | **MODIFY** | Mount routes and health/job telemetry |
| `cc-v4/src/routes/_authenticated/architecture/*` | **NEW** | Cockpit views for architecture, impact, PR risk |
| `cc-v4/src/lib/architecture-client.ts` | **NEW** | Typed frontend facade for architecture routes |

## Work Packages

### WP-1: Contract and Routing Foundation
- Define request/response schemas for all `/api/architecture/*` routes
- Add OpenAPI docs and runtime validation
- Build normalization layer for legacy arch-service payloads

### WP-2: Graph Schema and Persistence
- Create canonical Cypher MERGE patterns for `Arch*` entities
- Add read-back verification helpers
- Add snapshot ingestion and idempotent event handling

### WP-3: Impact Mode
- Build graph query composition for service, PR, chain, deployment, and module subjects
- Join runtime-health, Linear, agents, and chain data into a single response
- Add degraded-source reporting

### WP-4: PR and Deployment Awareness
- Ingest PR sync/open events
- Ingest deployment completed events
- Compute expected graph delta and dependency risk

### WP-5: Worker Internalization
- Move heavy analysis flows to async job execution
- Keep worker private behind orchestrator
- Add job lifecycle telemetry

### WP-6: Cockpit Integration
- Add architecture workbench panels
- Add graph explorer + impact inspector + PR risk view
- Remove direct references to standalone arch app

## Acceptance Tests

| ID | Test | Expected |
|----|------|----------|
| T-1 | Frontend loads architecture overview from orchestrator | No direct arch-service call |
| T-2 | `GET /api/architecture/graph` for a service | Returns normalized nodes/edges/meta |
| T-3 | `POST /api/architecture/impact/query` for a service | Returns modules, findings, chains, issues, agents, runtime risks |
| T-4 | PR sync event ingested twice | Idempotent graph state, no duplicate nodes |
| T-5 | Deployment event on service with open finding | Runtime risk includes deployment exposure |
| T-6 | Link finding to Linear issue | Success only after read-back verification |
| T-7 | Worker job fails | Cockpit remains available, job status becomes `failed` |
| T-8 | Old arch public URL is hit after phase 3 | Redirect or equivalent retirement behavior |

## Recommended Execution Order

1. Implement `src/routes/architecture.ts` + OpenAPI contracts
2. Add `architecture-service.ts` normalization layer around legacy arch payloads
3. Materialize `Arch*` nodes in Neo4j and verify read-back helpers
4. Implement `impact/query`
5. Add PR/deployment event ingest
6. Move heavy analysis to worker jobs
7. Wire cockpit panels
8. Retire standalone arch surface

## Completeness Score

| Dimension | Score | Notes |
|-----------|-------|-------|
| Target architecture clarity | 10/10 | One URL, one auth, one graph, one worker model |
| Migration sequencing | 10/10 | Three phases with exit gates |
| API contracts | 10/10 | Eight concrete contract shapes |
| Graph model | 9/10 | Core labels and relations defined; indexing details left to implementation |
| Testability | 9/10 | Eight acceptance tests, all automatable |
| **Total** | **48/50** | |
