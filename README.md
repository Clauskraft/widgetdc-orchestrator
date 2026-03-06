# WidgeTDC Orchestrator

Multi-agent coordination layer for the WidgeTDC platform. Bridges AI agents (Claude, Gemini, DeepSeek) to the Railway MCP backend — managing secrets, ACL, SSE aggregation, and real-time chat.

## Architecture

```
Claude/Gemini/DeepSeek
        │
        │ POST /tools/call (OrchestratorToolCall)
        ▼
  ┌─────────────────────────┐
  │  WidgeTDC Orchestrator  │  ← this service
  │  (Railway deployment)   │
  └───────────┬─────────────┘
              │ Bearer <BACKEND_API_KEY>
              │ POST /mcp/route
              ▼
  ┌─────────────────────────────────────────┐
  │  WidgeTDC Backend (Railway monolith)    │
  │  backend-production-d3da.up.railway.app │
  └─────────────────────────────────────────┘
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/tools/call` | Submit OrchestratorToolCall → returns OrchestratorToolResult |
| GET | `/tools/namespaces` | Discover available MCP tool namespaces |
| POST | `/agents/register` | Register agent with capabilities + ACL |
| GET | `/agents` | List all registered agents |
| POST | `/agents/:id/heartbeat` | Keep agent registration alive |
| POST | `/chat/message` | Send AgentMessage → broadcast to all WS connections |
| GET | `/chat/ws-stats` | WebSocket connection stats |
| WS | `/ws?agent_id=X` | Real-time AgentMessage channel |
| GET | `/health` | Health check (Railway) |
| GET | `/` | Live dashboard (HTML, auto-refresh 10s) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND_API_KEY` | ✅ | Bearer token for Railway backend |
| `BACKEND_URL` | optional | Backend URL (default: production) |
| `PORT` | optional | Server port (default: 4000) |
| `GEMINI_API_KEY` | optional | For Gemini agent health checks |
| `ANTHROPIC_API_KEY` | optional | For Claude agent health checks |
| `NOTION_TOKEN` | optional | For Global Chat persistence |
| `NOTION_CHAT_DB_ID` | optional | Notion database for chat |
| `MCP_TIMEOUT_MS` | optional | Tool call timeout (default: 60000) |
| `MAX_CONCURRENT_PER_AGENT` | optional | Rate limit per agent (default: 5) |

## Quick Start

```bash
npm install
npm run dev
```

## Deploy to Railway

Push to GitHub → Railway auto-deploys via `railway.json`.

<!-- deploy-trigger: swarm-integration -->
