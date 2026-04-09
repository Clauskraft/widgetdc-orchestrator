# WidgeTDC — Agent Boot Protocol

**Version:** 1.0.0
**Status:** Canonical — applies to all agents in all repos
**Maintained by:** widgetdc-orchestrator (PROJECT COCKPIT)

---

## Boot Sequence — MANDATORY on every session start

All agents (Claude, Gemini, Codex, Qwen, DeepSeek) MUST execute this sequence before any task:

### Step 1 — Service Health Check
```bash
curl -s https://backend-production-d3da.up.railway.app/health | grep -o '"status":"[^"]*"'
curl -s https://orchestrator-production-c27e.up.railway.app/health | grep -o '"status":"[^"]*"'
curl -s https://rlm-engine-production.up.railway.app/health | grep -o '"status":"[^"]*"'
```
**Gate**: If backend or orchestrator DOWN → halt and report to user. Do not proceed with platform-dependent tasks.

### Step 2 — Lesson Check + Acknowledgment
```json
POST https://backend-production-d3da.up.railway.app/api/mcp/route
Authorization: Bearer Heravej_22
Content-Type: application/json

{"tool":"audit.lessons","payload":{"agentId":"<AGENT_ID>"}}
```
Replace `<AGENT_ID>` with: `claude`, `gemini`, `codex`, `qwen`, or `deepseek`.

If lessons returned: acknowledge before proceeding:
```json
{"tool":"audit.acknowledge","payload":{"agentId":"<AGENT_ID>","lessonIds":["<id1>","<id2>"]}}
```

### Step 3 — A2A Presence Signal (Register in Neo4j)
```json
{"tool":"graph.write_cypher","payload":{
  "query":"MERGE (m:AgentMemory {agentId:$aid,key:'session_start'}) SET m.value=$ts,m.type='heartbeat',m.repo=$repo,m.updatedAt=datetime()",
  "params":{
    "aid":"<AGENT_ID>",
    "ts":"<ISO_TIMESTAMP>",
    "repo":"<CURRENT_REPO>"
  }
}}
```
This signals presence to peer agents and enables A2A coordination.

### Step 4 — Linear Hygiene
```json
{"tool":"linear.issues","payload":{"state":"In Progress","limit":10}}
```
Additionally scan Backlog for rot: stale issues >14d + Urgent/High priority.
Zero tolerance for backlog rot. Close false positives, deprioritize stale, highlight real blockers.

### Step 5 — Read Active Backlog Item
Start from Linear. Never start from assumptions. Every task needs:
- Linear issue ID
- Repo target
- Responsible agent
- Verification path
- Next action

---

## Communication Channels

### Channel 1: Neural Bridge (MCP — Primary Tool Execution)

All WidgeTDC platform tool calls go through the Neural Bridge:

```
POST https://backend-production-d3da.up.railway.app/api/mcp/route
Authorization: Bearer Heravej_22
Content-Type: application/json
Body: {"tool":"<TOOL_NAME>","payload":{...}}
```

**MANDATORY FORMAT**: `payload` only — never `args`. This is enforced by the MCP caller.

**448+ tools available.** Discover: `{"tool":"list_tools","payload":{}}`

Key tool categories:
| Category | Example Tools |
|----------|--------------|
| Knowledge Search | `srag.query`, `graph.read_cypher` |
| Graph Writes | `graph.write_cypher` (MERGE only, parameterized) |
| Audit | `audit.lessons`, `audit.acknowledge`, `audit.log` |
| Linear | `linear.issues`, `linear.update_issue`, `linear.create_issue` |
| Cognitive | `rlm.start_mission`, `rlm.analyze` |
| Platform | `omega.sitrep`, `harvest.run`, `list_tools` |
| Slack | `slack.post_message` |

### Channel 2: Orchestrator API (Chains, Cognitive, Coordination)

```
Base URL: https://orchestrator-production-c27e.up.railway.app
Authorization: Bearer Heravej_22

# Agent chain execution
POST /api/chains/execute
Body: {"mode":"sequential|parallel|loop|debate|adaptive","steps":[...]}

# Cognitive proxy (routes to RLM Engine)
POST /api/cognitive/reason
POST /api/cognitive/analyze
POST /api/cognitive/plan
Body: {"prompt":"...","agent_id":"<AGENT_ID>","depth":3}

# Agent registry
GET  /api/agents               # List registered agents
POST /api/agents               # Register agent
GET  /api/agents/:id/heartbeat # Check agent heartbeat

# MCP gateway (JSON-RPC 2.0)
POST /mcp
Body: {"jsonrpc":"2.0","method":"tools/call","params":{"name":"...","arguments":{...}},"id":1}

# Dashboard
GET /api/dashboard/data
GET /api/events  (SSE stream)
```

### Channel 3: A2A via Neo4j AgentMemory

Agents coordinate via `:AgentMemory` nodes. Execute via Neural Bridge `graph.write_cypher`/`graph.read_cypher`:

**Claim a scope (signal intent to work on something):**
```json
{"tool":"graph.write_cypher","payload":{
  "query":"MERGE (m:AgentMemory {agentId:$aid,key:$scope}) SET m.value=$claim,m.type='claim',m.repo=$repo,m.updatedAt=datetime()",
  "params":{"aid":"<AGENT_ID>","scope":"<UNIQUE_TASK_KEY>","claim":"<scope description>","repo":"<REPO>"}
}}
```

**Read all peer agent signals:**
```json
{"tool":"graph.read_cypher","payload":{
  "query":"MATCH (m:AgentMemory) WHERE m.type IN ['claim','heartbeat','closure'] AND m.agentId <> $myId RETURN m.agentId,m.key,m.type,m.value,m.repo,m.updatedAt ORDER BY m.updatedAt DESC LIMIT 30",
  "params":{"myId":"<AGENT_ID>"}
}}
```

**Read another agent's specific signal:**
```json
{"tool":"graph.read_cypher","payload":{
  "query":"MATCH (m:AgentMemory {agentId:$targetAgent}) RETURN m ORDER BY m.updatedAt DESC LIMIT 10",
  "params":{"targetAgent":"<TARGET_AGENT_ID>"}
}}
```

**Write closure (signal delivery):**
```json
{"tool":"graph.write_cypher","payload":{
  "query":"MATCH (m:AgentMemory {agentId:$aid,key:$scope}) SET m.type='closure',m.value=$result,m.verifiedAt=datetime(),m.updatedAt=datetime()",
  "params":{"aid":"<AGENT_ID>","scope":"<UNIQUE_TASK_KEY>","result":"<delivery description + verification>"}
}}
```

**A2A Signal Lifecycle:**
```
CLAIM → IN_PROGRESS → CLOSURE
```
Always write closure after completing work that was claimed.

### Channel 4: RLM Engine (Cognitive Reasoning)

For complex analysis, planning, architecture decisions, and learning:

```
Base URL: https://rlm-engine-production.up.railway.app
Authorization: Bearer Heravej_22

POST /reason
POST /analyze
POST /plan
POST /learn
Body: {"query":"<QUESTION>","agent_id":"<AGENT_ID>","depth":3,"mode":"reason|analyze|plan"}
```

Or via Neural Bridge:
```json
{"tool":"rlm.start_mission","payload":{"query":"<QUESTION>","agent_id":"<AGENT_ID>"}}
{"tool":"rlm.analyze","payload":{"query":"<QUESTION>","agent_id":"<AGENT_ID>","mode":"analyze"}}
```

Context folding is enforced for inputs >20K tokens (>= 85% retention target).

### Channel 5: Linear (Operational Truth)

All active work coordination happens in Linear. Use `linear.*` MCP tools:

```json
{"tool":"linear.issues","payload":{"state":"In Progress","limit":10}}
{"tool":"linear.issues","payload":{"state":"Backlog","limit":30}}
{"tool":"linear.update_issue","payload":{"id":"LIN-XXX","status":"In Progress","comment":"ACK: starting work on X"}}
{"tool":"linear.create_issue","payload":{"title":"...","description":"...","priority":"High","teamId":"e7e882f6-d598-4dc4-8766-eaa76dcf140f"}}
```

**Linear execution protocol:**
- `ACK` — acknowledge task start
- `IN_PROGRESS` — active work
- `BLOCKED: <reason>` — blocked with workaround
- `DELIVERED: <PR URL or artifact>` — delivery verified

### Channel 6: Slack (Human Escalation Only)

Bot: `kaptajn_klo`, Workspace: `T09K7Q2D1GB`

Channels: `C08...` (all-cchub), social, openclaw_chron_status, chat

Use ONLY for blockers requiring human decision. Not for status updates (those go to Linear).

```json
{"tool":"slack.post_message","payload":{
  "channel":"<CHANNEL_ID>",
  "text":"[<AGENT_ID> BLOCKER]: <reason>\nWorkaround attempted: <what you tried>\nNeeds: <what human input is needed>"
}}
```

---

## Agent Identifiers

| Agent | agentId | Primary Role |
|-------|---------|-------------|
| Claude | `claude` | Orchestrator, Project Manager |
| Gemini | `gemini` | Architecture & Topology Reviewer |
| Codex | `codex` | Implementation Owner, Runtime Hardening |
| Qwen | `qwen` | Governance Enforcer, QA Reviewer |
| DeepSeek | `deepseek` | Python Quality, Exception Hardening |

---

## Governance Rules (enforced across all agents)

1. **Linear is operational truth** — record all material status, ACK/NACK, outcomes
2. **`config/*.json` is machine policy truth** — read before any policy decision
3. **MCP calls use `payload`** — never `args`
4. **Parameterized Cypher mandatory** — never interpolate user input into queries
5. **Read-back verification required** — after all material writes
6. **Direct A2A enabled by default** — no approval loops for approved backlog scope
7. **Repo-local execution** — work in the repo where the backlog item lives
8. **No false completion** — not done until commit, push, runtime verification, and Linear update
9. **Service health first** — halt if platform is down before platform-dependent work

---

## Final Rule

If it is not enforced and verified, it is not done.
