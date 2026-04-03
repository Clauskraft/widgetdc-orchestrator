# WidgeTDC Memory Architecture — Definitive Map

**Date:** 2026-04-03 | **Source:** LIN-596 SNOUT-14 audit | **Status:** Canonical

## 4 Active Memory Tiers

### Tier 1: Ephemeral (seconds-minutes)
| Layer | Repo | Backend | Purpose |
|-------|------|---------|---------|
| `chat-store.ts` | orchestrator | Redis + in-memory | Chat message history (7d TTL) |
| `memoryController.ts` | backend | In-memory Map | CMA request cache (5min TTL) |
| `SimpleEngramCache.ts` | backend | In-memory Map | LLM proxy response cache |
| `blackboard.ts` | orchestrator | Redis | Per-task agent shared state (24h TTL) |

### Tier 2: Session (hours-days)
| Layer | Repo | Backend | Purpose |
|-------|------|---------|---------|
| `working-memory.ts` | orchestrator | Redis | Per-agent key-value state (24h TTL) |
| `checkpoint-saver.ts` | orchestrator | Redis | FSM/chain/evolution checkpoints (3-14d TTL) |
| `WorkingMemoryStore.ts` | backend | PostgreSQL + Redis | Org/user state snapshots |

### Tier 3: Cognitive (days-weeks)
| Layer | Repo | Backend | Purpose |
|-------|------|---------|---------|
| `CognitiveMemory.ts` | backend | SQLite (sql.js) | MCP query patterns + failure tracking |
| `PatternMemory.ts` | backend | SQLite | Health metrics + learning patterns |
| `CognitiveMemory` (Python) | rlm-engine | In-memory (3-tier) | CoreMemory + RecallStore + ArchivalStore |
| `ReasoningChainStore` | rlm-engine | Neo4j/PG | Reasoning chain persistence |

### Tier 4: Permanent (months-years)
| Layer | Repo | Backend | Purpose |
|-------|------|---------|---------|
| `AgentMemoryCortex` | rlm-engine | Neo4j | Agent recall/store with temporal decay |
| `Context Folding` | rlm-engine | Neo4j | FoldedNode trajectories, hierarchical compression |
| Neo4j Knowledge Graph | backend | Neo4j | 475K+ nodes, canonical knowledge |

## Storage Backend Summary

| Backend | Used By | Purpose |
|---------|---------|---------|
| **Redis** | orchestrator (5 layers), backend (1 layer) | Session state, caches, checkpoints |
| **PostgreSQL** | backend (1 layer) | Working memory snapshots |
| **SQLite** | backend (2 layers) | Cognitive patterns, health metrics |
| **Neo4j** | rlm-engine (3 layers), backend (graph) | Permanent knowledge, agent memory |
| **In-memory** | orchestrator (2 fallbacks), backend (2 caches) | Ephemeral caches, fallbacks |

## Ghost Layers Found: 0

All identified memory layers are actively imported and used. No dead code found.

## Canonical Ownership

| Concern | Owner | Endpoint |
|---------|-------|----------|
| Agent working memory | **Orchestrator** | `POST /api/memory/store` |
| Chat history | **Orchestrator** | Redis `chat:*` keys |
| Checkpoints | **Orchestrator** | `checkpoint-saver.ts` (3 namespaces) |
| Knowledge graph | **Backend** | Neo4j via MCP |
| Agent cortex | **RLM Engine** | `AgentMemoryCortex` |
| Context folding | **RLM Engine** | `/fold` endpoint |

## Migration Notes

- `WorkingMemoryStore.ts` (backend, PostgreSQL) is **deprecated** by `working-memory.ts` (orchestrator, Redis) per LIN-582 SNOUT-4
- Backend should delegate working memory ops to orchestrator `/api/memory/*`
- RLM cortex remains independent (Neo4j-native, different access pattern)
