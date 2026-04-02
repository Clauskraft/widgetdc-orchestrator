# Triple-Protocol ABI — Canonical Tool IR for WidgeTDC

**Status:** RFC Draft
**Author:** Omega Sentinel + Multi-AI Debate Consensus
**Date:** 2026-04-02
**Linear:** LIN-542 (parent), LIN-543–548 (sub-issues)

## Problem

WidgeTDC exposes tools through 3 protocols with **inconsistent schemas, auth, tracking, and result shapes**:

| Aspect | OpenAI (chat) | REST/OpenAPI | MCP Gateway |
|--------|---------------|-------------|-------------|
| Schema | `{type:'function', function:{name,description,parameters}}` | OpenAPI path objects | `{name,description,inputSchema}` |
| Auth | Implicit (chat context) | Bearer token + ACL | Bearer token (HTTP layer) |
| Tracking | `tool_call_id` only | `call_id, agent_id, trace_id` | JSON-RPC `id` |
| Status | Inferred from content | Explicit enum | `isError` boolean |
| Result | Always stringified | Typed JSON | `content:[{type:'text',text}]` |
| Tools | 13 orchestrator | 450+ MCP (no orchestrator!) | Both (188 merged) |

**Critical Gap:** Orchestrator tools (search_knowledge, run_chain, etc.) are NOT available via REST. OpenAPI spec only documents MCP tools.

## Solution: Canonical Intermediate Representation

Define tools ONCE in a canonical format. Compile to all 3 protocols.

```
                    ┌─────────────────┐
                    │  Canonical Tool  │
                    │   Registry (IR)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌─────────────┐ ┌──────────────┐ ┌──────────────┐
    │ OpenAI      │ │ OpenAPI 3.0  │ │ MCP          │
    │ Function    │ │ Paths +      │ │ tools/list   │
    │ Calling     │ │ Swagger UI   │ │ tools/call   │
    └─────────────┘ └──────────────┘ └──────────────┘
```

## Canonical Tool Definition (the IR)

```typescript
interface CanonicalTool {
  // Identity
  name: string                    // e.g. "search_knowledge"
  namespace: string               // e.g. "orchestrator" | "backend.graph" | "backend.srag"
  version: string                 // semver, e.g. "1.0.0"

  // Documentation
  description: string             // Human-readable, used by all 3 protocols
  category: ToolCategory          // knowledge | graph | cognitive | chains | agents | ...
  tags: string[]                  // Freeform tags for discovery

  // Schema
  inputSchema: JSONSchema7        // Standard JSON Schema for parameters
  outputSchema?: JSONSchema7      // Optional: expected result shape

  // Execution
  handler: 'orchestrator' | 'mcp-proxy'  // Where it runs
  backendTool?: string            // If mcp-proxy: which backend tool(s)
  timeoutMs: number               // Default timeout
  idempotent: boolean             // Safe to retry?

  // Access Control
  authRequired: boolean           // Requires Bearer token?
  requiredScopes?: string[]       // Fine-grained permissions
  rateLimit?: { max: number, windowMs: number }

  // Observability
  trackTokens: boolean            // Count tokens in/out?
  foldResult: boolean             // Apply Mercury folding to large results?
  auditLog: boolean               // Write to audit trail?

  // Availability
  availableVia: ('openai' | 'openapi' | 'mcp')[]  // Which protocols expose this
  availableIn: string[]           // UI surfaces: command-center, open-webui, obsidian
}

type ToolCategory =
  | 'knowledge'    // search, RAG, documents
  | 'graph'        // Neo4j Cypher, graph ops
  | 'cognitive'    // RLM reasoning, analysis, planning
  | 'chains'       // Multi-agent chain execution
  | 'agents'       // Agent registry, fleet management
  | 'assembly'     // Architecture assembly composition
  | 'decisions'    // Decision certification, lineage
  | 'adoption'     // Metrics, trends, snapshots
  | 'linear'       // Project management
  | 'compliance'   // Verification, loose-end detection
  | 'llm'          // LLM provider proxy
  | 'monitor'      // Platform health, cron, audit
  | 'mcp'          // Dynamic MCP tool passthrough
```

## Unified Invocation Envelope

```typescript
// All protocols normalize to this before execution
interface InvocationEnvelope {
  call_id: string           // UUID, required
  trace_id?: string         // Correlation across chains
  agent_id: string          // Who's calling (or "anonymous")
  tool_name: string         // Canonical tool name
  arguments: Record<string, unknown>
  timeout_ms: number
  source_protocol: 'openai' | 'openapi' | 'mcp'
  received_at: string       // ISO 8601
}

// All protocols return this
interface ExecutionResult {
  call_id: string
  status: 'success' | 'error' | 'timeout' | 'unauthorized' | 'rate_limited'
  result: unknown           // Preserves type (never auto-stringify)
  error_message?: string
  error_code?: string
  duration_ms: number
  completed_at: string
  trace_id?: string
  tokens_input?: number
  tokens_output?: number
  was_folded: boolean       // Was Mercury folding applied?
}
```

## Protocol Compilers

### 1. → OpenAI Function Calling
```typescript
function toOpenAITool(tool: CanonicalTool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}
```

### 2. → OpenAPI 3.0 Path
```typescript
function toOpenAPIPath(tool: CanonicalTool) {
  const operationId = toCamelCase(tool.name)
  return {
    [`/api/tools/${tool.name}`]: {
      post: {
        operationId,
        summary: tool.description.slice(0, 80),
        description: tool.description,
        tags: [tool.category],
        security: tool.authRequired ? [{ BearerAuth: [] }] : [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: tool.inputSchema } },
        },
        responses: {
          '200': {
            description: 'Tool result',
            content: { 'application/json': {
              schema: tool.outputSchema ?? { type: 'object' },
            }},
          },
        },
      },
    },
  }
}
```

### 3. → MCP Tool Descriptor
```typescript
function toMCPTool(tool: CanonicalTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }
}
```

## Implementation Plan

### Phase 1: Registry (Week 1-2)
- Create `src/tool-registry.ts` with all 13 orchestrator tools in canonical format
- Import backend tool names and wrap as canonical tools
- Single source of truth — delete duplicated definitions

### Phase 2: Compilers (Week 2-3)
- `toOpenAITools()` — replaces hardcoded ORCHESTRATOR_TOOLS array
- `toOpenAPISpec()` — replaces hand-written openapi.ts spec paths
- `toMCPTools()` — replaces manual MCP tool list builder

### Phase 3: Unified Execution (Week 3-4)
- All 3 protocol handlers normalize to InvocationEnvelope
- Single `executeTool(envelope)` function handles routing
- Unified ExecutionResult returned to all protocols

### Phase 4: REST Exposure (Week 4-5)
- Generate `/api/tools/{name}` REST endpoints for ALL tools (not just MCP)
- The 13 orchestrator tools become REST-callable for the first time
- OpenAPI spec auto-generated from registry

### Phase 5: Observability (Week 5-6)
- Token tracking per tool per protocol
- Mercury folding opt-in per tool
- Audit trail for all invocations
- Dashboard panel showing protocol distribution

## Use Cases Enabled

1. **ChatGPT Custom GPT** — imports /openapi.json, calls any tool via REST
2. **Claude Desktop** — connects via MCP, gets all 188+ tools
3. **Open WebUI** — adds as OpenAPI Tool Server, full tool access
4. **Gemini** — function calling via gemini-agent.mjs or MCP
5. **Cursor/Devin** — MCP connection to full tool suite
6. **Internal agents** — unified execution regardless of protocol
7. **Third-party developers** — build on OpenAPI, no protocol knowledge needed
8. **Monitoring** — single dashboard for all tool usage across protocols

## Migration Path

1. Build registry alongside existing code (no breaking changes)
2. Wire compilers to generate from registry
3. Verify generated output matches current behavior
4. Switch to registry as source of truth
5. Delete old hardcoded definitions

## Success Metrics

- All 13 orchestrator tools available via all 3 protocols
- Zero schema inconsistencies between protocols
- Single file change to add a new tool (registry only)
- Token/cost tracking per tool per protocol
- < 5ms overhead from normalization layer
