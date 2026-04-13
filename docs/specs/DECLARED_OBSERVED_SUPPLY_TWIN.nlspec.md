# NLSpec: Declared-Observed-Supply Twin

**Version:** 1.0 | **Date:** 2026-04-13 | **Strategic Position:** Hill 2 moat target for Q3 2026
**Parent:** [ARCHITECTURE_UNIFICATION_COCKPIT.nlspec.md](/C:/Users/claus/Projetcs/widgetdc-orchestrator/docs/specs/ARCHITECTURE_UNIFICATION_COCKPIT.nlspec.md:1)
**Target:** `widgetdc-orchestrator` | **Effort:** 8-12 weeks full implementation

---

## System

The platform introduces a unified graph model called the **Declared-Observed-Supply Twin**.

It merges three currently fragmented truth sources into one orchestrator-native model:

- **Declared Architecture** — what the platform says it is
- **Observed Architecture** — what the platform is actually doing at runtime
- **Supply + Capability Intelligence** — what the platform is built from and can draw upon

This twin is stored in Neo4j, served through orchestrator contracts, and used by cockpit views, impact mode, PR-risk analysis, routing, self-heal, compliance, and consulting delivery.

## Problem Statement

Today the platform has strong but disconnected assets:

- the mindmap / architecture concepts exist as static declarations
- `arch-mcp-server` exists as a separate architecture graph
- Phantom BOM / Fantomstykliste exists as a live software- and provider-intelligence pipeline
- runtime health, PRs, deploys, chains, and agents exist in separate operational surfaces

The result is fragmentation:

- no single graph answers what the platform says it is, does, and depends on
- no explicit architecture drift model
- no unified impact analysis across service, runtime, supply chain, and work backlog

## Core Principle

Every material platform fact should land in exactly one of three profiles:

1. **Declared**
   Source-controlled intent, topology, ownership, horizons, and architectural assertions

2. **Observed**
   Runtime state, deployments, PR deltas, traces, health, incidents, and live behavior

3. **Supply**
   Components, dependencies, providers, datasets, external knowledge, capabilities, vulnerabilities, and confidence

The value comes from **linking these profiles** and measuring their mismatches.

## Actors

| Actor | Role |
|-------|------|
| **Declared Ingestor** | Converts versioned architecture sources such as the mindmap into graph nodes |
| **Observed Ingestor** | Ingests health, PR, deploy, chain, A2A, and trace-derived state |
| **Supply Ingestor** | Reuses Phantom BOM, provider ingest, clusters, and external knowledge harvest |
| **Twin Query Service** | Orchestrator service composing declared, observed, and supply facts |
| **Cockpit UI** | Renders truth gap, impact mode, PR risk, and graph exploration |
| **Standards Mapper** | Maps internal graph slices to CycloneDX/SPDX-compatible export shapes |

## Behaviors

### B-1: Declared Source of Intent

**WHEN** the platform team curates a canonical architecture model  
**THEN** it is stored as a versioned source artifact  
**AND** ingested as `Declared*` nodes into Neo4j  
**AND** linked to a `DeclaredSnapshot`

### B-2: Observed Source of Reality

**WHEN** runtime, deployment, PR, chain, A2A, or trace events occur  
**THEN** orchestrator or its internal workers ingest them as `Observed*` nodes and relationships  
**AND** they are queryable independently of declared facts

### B-3: Supply Source of Capability

**WHEN** Phantom BOM, Fantomstykliste, provider ingest, cluster generation, or harvest missions run  
**THEN** the resulting components, providers, clusters, and external knowledge become `Supply*` nodes  
**AND** retain confidence, provenance, and risk metadata

### B-4: Truth Gap Detection

**WHEN** a declared node has no observed counterpart  
**OR** an observed node contradicts its declared model  
**OR** a supply risk affects a declared or observed asset  
**THEN** orchestrator creates or updates one or more explicit gap types:

- `MissingObservedNode`
- `ContradictionGap`
- `SupplyRiskExposure`

**AND** related `ArchFinding` nodes only when escalation, ownership, or remediation tracking is needed

### B-5: Impact Composition

**WHEN** the operator asks for impact on a service, PR, chain, deployment, namespace, or agent  
**THEN** orchestrator traverses all three profiles in one query composition  
**AND** returns a unified impact response

### B-6: Export without Losing Native Semantics

**WHEN** the platform exports architecture or BOM views externally  
**THEN** it maps to CycloneDX/SPDX-compatible shapes  
**BUT** internal graph semantics remain richer than the export format

## Constraints

| ID | Constraint |
|----|-----------|
| C-1 | Internal graph is the master model; standards exports are derived views |
| C-2 | Declared, Observed, and Supply nodes must remain distinguishable even when referring to the same service/module |
| C-3 | Every cross-profile merge must preserve provenance and confidence |
| C-4 | Read-back verification is required after material graph writes |
| C-5 | The twin must support partial ingestion; missing profile data is allowed but must be explicit |
| C-6 | The first implementation must reuse existing Phantom BOM and graph surfaces rather than replacing them |

## Neo4j Ontology

### Profile Labels

| Label | Meaning |
|-------|---------|
| `DeclaredSnapshot` | Versioned declaration source |
| `DeclaredService` | Service declared in architecture source |
| `DeclaredModule` | Declared software module or subsystem |
| `DeclaredNamespace` | Declared MCP or capability namespace |
| `DeclaredAgent` | Declared agent role or capability owner |
| `ObservedSnapshot` | Runtime ingestion batch |
| `ObservedService` | Live service state |
| `ObservedDeployment` | Deployment event |
| `ObservedPullRequest` | PR event entity |
| `ObservedChainUsage` | Runtime chain or tool usage aggregate |
| `ObservedTraceAggregate` | Trace- or metric-derived aggregate |
| `SupplySnapshot` | Supply/capability ingest batch |
| `SupplyComponent` | Internal or external software component |
| `SupplyProvider` | LLM/provider intelligence entity |
| `SupplyCluster` | MRP / Phantom clustering result |
| `SupplyDataset` | Dataset, benchmark, or corpus asset |
| `SupplyKnowledge` | ExternalKnowledge / evidence source |
| `TruthGap` | Mismatch between profiles |
| `ArchFinding` | Architecture/risk finding |

### Canonical Shared Labels

These may already exist and should be linked rather than duplicated:

- `Agent`
- `Chain`
- `LinearIssue`
- `CVE`
- `Decision`
- `AgentMemory`

### Required Core Relations

| From | Relation | To |
|------|----------|----|
| `DeclaredSnapshot` | `DECLARES` | `DeclaredService` |
| `DeclaredService` | `CONTAINS` | `DeclaredModule` |
| `DeclaredService` | `DECLARES_NAMESPACE` | `DeclaredNamespace` |
| `DeclaredAgent` | `OWNS` | `DeclaredService` |
| `ObservedSnapshot` | `OBSERVES` | `ObservedService` |
| `ObservedDeployment` | `DEPLOYS` | `ObservedService` |
| `ObservedPullRequest` | `CHANGES` | `ObservedService` |
| `ObservedPullRequest` | `CHANGES` | `DeclaredModule` |
| `SupplySnapshot` | `SUPPLIES` | `SupplyComponent` |
| `SupplyProvider` | `SUPPORTS` | `DeclaredService` |
| `SupplyComponent` | `IMPLEMENTS` | `DeclaredModule` |
| `SupplyComponent` | `USES_PROVIDER` | `SupplyProvider` |
| `SupplyProvider` | `HAS_VULNERABILITY` | `CVE` |
| `ObservedService` | `INSTANCE_OF` | `DeclaredService` |
| `ObservedService` | `USES_COMPONENT` | `SupplyComponent` |
| `Chain` | `USES_MODULE` | `DeclaredModule` |
| `LinearIssue` | `TRACKS` | `ArchFinding` |
| `TruthGap` | `ABOUT_DECLARED` | `DeclaredService` |
| `TruthGap` | `ABOUT_OBSERVED` | `ObservedService` |
| `TruthGap` | `ABOUT_SUPPLY` | `SupplyComponent` |

## What Lives in Graph vs Runtime

### Store in Neo4j

- stable declared topology
- versioned snapshots of declared architecture
- provider capabilities, cost model metadata, geo restrictions, compliance flags
- component relationships and capability mappings
- PR graph deltas and deployment exposures
- findings, truth gaps, linked issues, decisions, provenance
- supply-side evidence and external knowledge sources

### Keep in Runtime Services / Derived Stores

- raw live SSE streams
- transient A2A message payloads
- hot-path response caches
- detailed trace spans before aggregation
- large raw documents that are better stored in object/document storage and referenced by URI

## Declared Source Format

The production declared source should **not** rely on the mindmap as the sole source of truth.

The correct direction is:

- canonical declared facts generated from higher-trust sources such as contracts, service definitions, repo metadata, and curated architecture descriptors
- the mindmap used as a visualization/export/input source where useful

The first generated source can still be represented as a versioned JSON artifact.

### Suggested JSON shape

```json
{
  "version": "2026-04-13",
  "source": "widgetdc-mindmap-v2",
  "nodes": [
    {
      "id": "declared.service.arch-mcp",
      "profile": "declared",
      "kind": "service",
      "name": "Arch MCP",
      "category": "Infrastructure",
      "summary": "Architecture graph service",
      "properties": {
        "url": "https://arch-mcp-server-production.up.railway.app",
        "health_claim": 97
      }
    }
  ],
  "edges": [
    {
      "from": "declared.service.arch-mcp",
      "to": "declared.namespace.graph",
      "type": "DECLARES_NAMESPACE"
    }
  ]
}
```

## Mapping from Existing Phantom BOM

### Existing Internal Nodes

| Existing | Twin profile |
|----------|--------------|
| `PhantomBOMRun` | `SupplySnapshot` |
| `PhantomComponent` | `SupplyComponent` |
| `PhantomProvider` | `SupplyProvider` |
| `PhantomCluster` | `SupplyCluster` |
| `ExternalKnowledge` | `SupplyKnowledge` |

### Standards Mapping

| Internal concept | CycloneDX | SPDX |
|------------------|-----------|------|
| `SupplyComponent` | SBOM component | software package / element |
| `SupplyProvider` | SaaSBOM service / ML-BOM model provider | AI/service profile |
| `ObservedService` | OBOM service/runtime element | runtime/build/service profile |
| `SupplyProvider` + `CVE` | VEX / BOV linkage | vulnerability relationship |
| `ArchFinding` with evidence | CDXA / VDR-like statement | security or annotation profile |
| `SupplySnapshot` to `DeclaredSnapshot` link | BOM-Link | external relationship |

## API Contracts

### 1. Truth Gap Query

```http
POST /api/architecture/truth-gap/query
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "subject": {
    "type": "service",
    "id": "arch-mcp"
  }
}
```

```json
{
  "subject": { "type": "service", "id": "arch-mcp" },
  "declared": {
    "exists": true,
    "snapshot": "decl-2026-04-13"
  },
  "observed": {
    "exists": true,
    "health": "ok"
  },
  "supply": {
    "providers": 2,
    "components": 14
  },
  "gaps": [
    {
      "id": "gap_001",
      "type": "metric_drift",
      "severity": "medium",
      "summary": "Declared architecture claims differ from observed graph counts"
    }
  ]
}
```

### 2. Twin Profile Query

```http
GET /api/architecture/twin/{profile}/{kind}/{id}
Authorization: Bearer <token>
```

Where `profile ∈ declared|observed|supply`.

### 3. Supply Mapping Export

```http
GET /api/architecture/export/cyclonedx?scope=service&target=orchestrator
Authorization: Bearer <token>
```

Returns a CycloneDX-compatible derived document.

### 4. Declared Snapshot Ingest

```http
POST /internal/architecture/declared/ingest
X-Service-Token: <internal-token>
Content-Type: application/json
```

```json
{
  "source": "widgetdc-mindmap-v2",
  "version": "2026-04-13",
  "document": {
    "nodes": [],
    "edges": []
  }
}
```

### 5. Observed Event Ingest

```http
POST /internal/architecture/observed/event
X-Service-Token: <internal-token>
Content-Type: application/json
```

```json
{
  "event_type": "deployment.completed",
  "service": "orchestrator",
  "version": "4.4.0",
  "timestamp": "2026-04-13T18:00:00Z"
}
```

## Implementation Strategy

### Phase A: Hill 2 Foundation

- create declared JSON schema and conversion from mindmap HTML/JS
- ingest declared snapshots into Neo4j
- alias existing Phantom nodes into Supply profile semantics
- add `truth-gap/query`

Before this phase starts, a dedicated sub-spec is required for cross-profile linking and entity resolution.

### Phase B: Cross-Profile Linking

- map `ObservedService` to `DeclaredService`
- map `SupplyComponent` to `DeclaredModule`
- link deployments, PRs, chains, and issues
- generate `TruthGap` and `ArchFinding` nodes

### Phase C: Standards and Cockpit

- add standards export endpoints
- add cockpit `Truth Gap` panel
- add cross-profile graph explorer

## Work Packages

### WP-1: Declared Model Extractor
- parse mindmap into stable JSON
- validate schema
- persist `DeclaredSnapshot`

### WP-2: Twin Graph Service
- build graph read/write helpers
- add profile-aware query functions
- add read-back verification

### WP-3: Phantom Alias Layer
- map existing Phantom labels into Supply semantics without destructive migration
- preserve existing routes and tools

### WP-4: Truth Gap Engine
- define gap rules
- generate findings from cross-profile mismatches

### WP-5: Standards Export
- derive CycloneDX/SPDX shapes from graph slices
- keep exports read-only and derived

## Acceptance Tests

| ID | Test | Expected |
|----|------|----------|
| T-1 | Ingest mindmap-derived declared snapshot | `DeclaredSnapshot` + `Declared*` nodes exist |
| T-2 | Query a known PhantomComponent through supply profile | Returned as supply entity without breaking existing Phantom route |
| T-3 | Observed deployment links to declared service | `ObservedService-[:INSTANCE_OF]->DeclaredService` exists |
| T-4 | Truth gap query on drifted service | Returns at least one `gap` item |
| T-5 | Export service to CycloneDX view | Returns standards-compatible JSON |
| T-6 | Existing Phantom BOM routes still work | No regression in `/api/phantom-bom/*` |

## Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Mean time to detect architecture drift | manual / undefined | < 1 day |
| % truth gaps resolved within SLA | 0% | > 70% |
| # consulting engagements using truth-gap output | 0 | 3+ in first moat quarter |
| # pre-deploy contradictions caught before incident | 0 | measurable, tracked quarterly |
| % high-severity supply exposures linked to services/issues | low / undefined | > 80% |

## Recommendation

Do **not** replace Phantom BOM.

Do **not** build a new separate architecture service.

Do:
- elevate Phantom BOM to the Supply profile
- bring declared architecture into the same graph
- add observed runtime as the missing profile
- let orchestrator own the twin facade

This is the correct **Hill 2 moat architecture**, not the correct Hill 1 delivery priority.

Recommended sequencing:

1. Q2: run [TRUTH_GAP_SPIKE_v0.1.nlspec.md](/C:/Users/claus/Projetcs/widgetdc-orchestrator/docs/specs/TRUTH_GAP_SPIKE_v0.1.nlspec.md:1)
2. Q3: if the spike proves value, execute this full twin model as moat work
