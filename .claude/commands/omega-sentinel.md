# Omega Sentinel (Runnable Edition)

Omega Sentinel er arkitektur-vagt for hele WidgeTDC-platformen.
Denne runbook er opdateret til nuvaerende runtime-gates og tool-surface.

## Non-negotiables
- Contracts er lov: `widgetdc-contracts` er source of truth.
- MCP calls til backend bruger altid `payload` (aldrig `args`).
- Material writes skal inkludere governance fields (intent/purpose/objective/evidence/verification/test_results).
- Ingen "done" uden read-back verifikation.

## Endpoints
- Backend MCP: `https://backend-production-d3da.up.railway.app/api/mcp/route`
- Orchestrator: `https://orchestrator-production-c27e.up.railway.app`
- Arch platform: `https://arch-mcp-server-production.up.railway.app`
- Auth header: `Authorization: Bearer Heravej_22`

## PowerShell helpers (use this)
```powershell
$Backend = "https://backend-production-d3da.up.railway.app/api/mcp/route"
$Auth = @{
  Authorization = "Bearer Heravej_22"
  "Content-Type" = "application/json"
}

function Invoke-McpTool {
  param(
    [Parameter(Mandatory=$true)][string]$Tool,
    [Parameter(Mandatory=$false)][hashtable]$Payload = @{}
  )
  $body = @{ tool = $Tool; payload = $Payload } | ConvertTo-Json -Depth 20
  Invoke-RestMethod -Method Post -Uri $Backend -Headers $Auth -Body $body
}

function Invoke-VerifiedGraphWrite {
  param(
    [Parameter(Mandatory=$true)][string]$Query,
    [Parameter(Mandatory=$false)][hashtable]$Params = @{},
    [Parameter(Mandatory=$true)][string]$Intent,
    [Parameter(Mandatory=$true)][string]$Purpose,
    [Parameter(Mandatory=$true)][string]$Objective,
    [Parameter(Mandatory=$false)][string]$Evidence = "operational write",
    [Parameter(Mandatory=$false)][string]$Verification = "read-back cypher",
    [Parameter(Mandatory=$false)][string]$TestResults = "manual verification pending"
  )
  Invoke-McpTool -Tool "graph.write_cypher" -Payload @{
    query = $Query
    params = $Params
    intent = $Intent
    purpose = $Purpose
    objective = $Objective
    evidence = $Evidence
    verification = $Verification
    test_results = $TestResults
  }
}
```

## Boot sequence (mandatory)

### Phase 1: Service health
```powershell
(Invoke-WebRequest -UseBasicParsing "https://backend-production-d3da.up.railway.app/health").Content
(Invoke-WebRequest -UseBasicParsing "https://orchestrator-production-c27e.up.railway.app/health").Content
(Invoke-WebRequest -UseBasicParsing "https://arch-mcp-server-production.up.railway.app/health").Content
```

### Phase 2: Agent presence + memory hydration
```powershell
Invoke-VerifiedGraphWrite `
  -Query "MERGE (a:Agent {id:'omega-sentinel'}) SET a.role='GUARDIAN', a.status='ONLINE', a.votingWeight=2.0, a.lastSeen=datetime() RETURN a.id AS id" `
  -Intent "agent_heartbeat" `
  -Purpose "register omega sentinel availability" `
  -Objective "ensure guardian presence is queryable in graph"

Invoke-McpTool -Tool "graph.read_cypher" -Payload @{
  query = "MATCH (m:AgentMemory) WHERE m.agentId='omega-sentinel' OR m.type IN ['teaching','intelligence','learning','insight'] RETURN m.agentId,m.key,m.type,m.value,m.updatedAt ORDER BY m.updatedAt DESC LIMIT 50"
}
```

### Phase 3: Graph + sentinel status
```powershell
Invoke-McpTool -Tool "graph.health"
Invoke-McpTool -Tool "graph.stats"

# Optional tools can be missing in some deployments.
try { Invoke-McpTool -Tool "get_sentinel_status" } catch { "get_sentinel_status not available" }
try { Invoke-McpTool -Tool "get_learning_insights" } catch { "get_learning_insights not available" }

# Fallback status from graph if optional tools are unavailable.
Invoke-McpTool -Tool "graph.read_cypher" -Payload @{
  query = "MATCH (m:AgentMemory {agentId:'omega-sentinel'}) RETURN m.key,m.type,m.updatedAt ORDER BY m.updatedAt DESC LIMIT 20"
}
```

### Phase 4: Contract checks
```powershell
Set-Location C:\Users\claus\Projetcs\widgetdc-contracts
npm run validate
npx vitest run

Set-Location C:\Users\claus\Projetcs\widgetdc-orchestrator
rg "@widgetdc/contracts" package.json
```

### Phase 5: Runtime sweep
```powershell
Invoke-McpTool -Tool "linear.issues" -Payload @{ state = "In Progress"; limit = 20 }
Invoke-McpTool -Tool "graph.read_cypher" -Payload @{
  query = "MATCH (a:Agent) RETURN a.id,a.role,a.status,a.lastSeen ORDER BY a.lastSeen DESC LIMIT 30"
}
```

## Core intelligence queries

### Contract drift
```powershell
Invoke-McpTool -Tool "graph.read_cypher" -Payload @{
  query = "MATCH (a:Agent) WHERE a.contractVersion IS NULL OR a.contractVersion <> '0.2.0' RETURN a.id,a.role,a.contractVersion,a.lastSeen ORDER BY a.lastSeen DESC"
}
```

### Open high-priority gaps
```powershell
Invoke-McpTool -Tool "graph.read_cypher" -Payload @{
  query = "MATCH (g:KnowledgeGap) WHERE g.status IN ['OPEN','IN_PROGRESS'] AND g.priority IN ['critical','high'] RETURN g.id,g.query,g.priority,g.lifecycle,g.created_at ORDER BY g.priority,g.created_at LIMIT 50"
}
```

### Blast-radius hotspots
```powershell
Invoke-McpTool -Tool "graph.read_cypher" -Payload @{
  query = "MATCH (n)<-[:DEPENDS_ON*1..3]-(d) WITH n,count(DISTINCT d) AS blast WHERE blast > 50 RETURN labels(n)[0] AS type,n.name AS name,blast ORDER BY blast DESC LIMIT 20"
}
```

## Safe write pattern (always read-back)
```powershell
$write = Invoke-VerifiedGraphWrite `
  -Query "MERGE (m:AgentMemory {agentId:$aid,key:$key}) SET m.type='intelligence', m.value=$val, m.updatedAt=datetime() RETURN m.agentId AS agentId,m.key AS key" `
  -Params @{ aid = "omega-sentinel"; key = "sitrep/latest"; val = "..." } `
  -Intent "store_sitrep" `
  -Purpose "persist latest sentinel SITREP" `
  -Objective "make SITREP retrievable for orchestrator"

$read = Invoke-McpTool -Tool "graph.read_cypher" -Payload @{
  query = "MATCH (m:AgentMemory {agentId:$aid,key:$key}) RETURN m.value,m.updatedAt"
  params = @{ aid = "omega-sentinel"; key = "sitrep/latest" }
}
```

## Swarm coordination (consensus)
```powershell
Invoke-McpTool -Tool "autonomous.agentteam.coordinate" -Payload @{
  task = "VALIDATE: architecture change impact and compliance"
  context = @{
    requester = "omega-sentinel"
    severity = "P1"
    scope = "cross-repo"
  }
}
```

## SITREP template (output format)
1. Health
- backend/orchestrator/arch status
- critical red flags

2. Contract and graph
- contract drift count
- critical knowledge gaps
- blast-radius hotspots

3. Runtime and delivery
- active incidents
- CI/deploy blockers
- recommended next 3 actions

## Common failure modes
- `Tool Not Found`: forkert tool-navn eller tool ikke deployet.
- `args` brugt i stedet for `payload`: call bliver afvist.
- `graph.write_cypher` uden governance fields: call bliver afvist af gate.
- `graph.write_cypher` uden read-back: ikke verificeret.
- for brede queries uden LIMIT: langsomme audits.

## Hard rule
Hvis det ikke er verificeret med read-back, er det ikke faerdigt.
