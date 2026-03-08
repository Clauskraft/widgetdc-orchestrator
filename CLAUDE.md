# WidgeTDC Orchestrator — Multi-Agent Coordination Layer

TypeScript orchestration service bridging AI agents to Railway MCP backend.

## Repo Map

```
src/
  agents/            Agent definitions and routing
  coordination/      Multi-agent task coordination
  bridges/           MCP backend bridge adapters
  types/             TypeScript type definitions
```

## Essential Commands

```bash
npm run dev                # Dev server
npm run build              # Production build
npm run test               # Run tests
npm run lint               # ESLint
```

## Rules (Ufravigelige)

1. ESM only — import/export, never require()
2. TypeScript strict mode
3. Auth: Authorization Bearer on all backend/RLM calls
4. A2A protocol for agent delegation to RLM Engine
5. Neo4j writes: MERGE only, AuraDB only, parameterized Cypher
6. Conventional commits (feat:, fix:, docs:, refactor:)

## Danger Zones

- Never call backend without Authorization header
- Never bypass rate limiting on MCP tool calls
- Agent coordination must handle timeouts gracefully

## Key Integrations

- Backend MCP: https://backend-production-d3da.up.railway.app/api/mcp/route
- RLM A2A: https://rlm-engine-production.up.railway.app/a2a/tasks/send

## Cross-Repo

Part of WidgeTDC platform (Clauskraft/). Monorepo: WidgeTDC.
Contracts: widgetdc-contracts (snake_case JSON, $id required).
Production: https://orchestrator-production-c27e.up.railway.app

## More Context

- Agent compliance: see monorepo docs/AGENT_COMPLIANCE.md
- Architecture: see monorepo docs/ARCHITECTURE.md
