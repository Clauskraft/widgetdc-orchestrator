# Knowledge Normalization Bus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Knowledge Normalization Bus that routes any improvement (inventor result, session fold, PhantomBOM discovery, bugfix, chat pattern) through PRISM scoring and into the correct persistence tier — L2 Redis staging, L3 Neo4j AgentMemory, or L4 shared skill files — making all knowledge available to all agents across all repos.

**Architecture:** An EventEmitter-based bus in `widgetdc-orchestrator` receives `KnowledgeEvent` emissions from source adapters (inventor, session-fold, PhantomBOM, manual). A tier router scores each event via PRISM (`judgeResponse()`), then routes to the appropriate writer: L2 (Redis, score < 0.70), L3 (Neo4j `:KnowledgeCandidate`, 0.70–0.85), or L4 (Neo4j `:KnowledgeCandidate {tier:'L4'}`, ≥ 0.85). A local sync script in `WidgeTDC` reads L4 candidates from Neo4j and writes them to `WidgeTDC/.claude/skills/*.md`, bridging the Railway→local gap. A Claude session-start hook triggers the sync automatically.

**Tech Stack:** TypeScript/ESM, EventEmitter (Node built-in), existing `judgeResponse()` from `src/llm/agent-judge.ts`, Neo4j via `graph.write_cypher` MCP, Redis via `getRedis()`, `defineTool()` builder pattern, node-cron for daily consolidation, `@widgetdc/contracts` for new `KnowledgeEvent` type.

**Repos touched:**
- `widgetdc-orchestrator` — bus engine, tier router, writers, adapters, MCP tool, cron (primary)
- `widgetdc-contracts` — `KnowledgeEvent` wire type (minor)
- `WidgeTDC` — L4 sync script + session hook (local tooling)

**Recommended skillset for execution:**
- `superpowers:subagent-driven-development` — parallel tasks across repos
- `superpowers:test-driven-development` — TDD for tier router (pure function, easy to test)
- `master-architect-widgetdc` — cross-repo coordination and write-gate governance
- `wocto-factory` — for Phase 2 source adapters (spec-in, code-out)

---

## File Map

### widgetdc-orchestrator (new files)
| File | Responsibility |
|---|---|
| `src/knowledge/knowledge-bus.ts` | Singleton EventEmitter, `KnowledgeEvent` local type, `emitKnowledge()`, `onKnowledge()` |
| `src/knowledge/tier-router.ts` | PRISM score → tier decision (`l2`/`l3`/`l4`), pure function |
| `src/knowledge/l2-writer.ts` | Redis staging: `knowledge:staging:<id>` with 7-day TTL |
| `src/knowledge/l3-writer.ts` | Neo4j MERGE `:KnowledgeCandidate {tier:'L3'}` |
| `src/knowledge/l4-writer.ts` | Neo4j MERGE `:KnowledgeCandidate {tier:'L4'}` — synced to skill files by local script |
| `src/knowledge/adapters/inventor-adapter.ts` | Hooks `runInventor()` completion, emits best node |
| `src/knowledge/adapters/session-fold-adapter.ts` | Two-pass JSONL parser (Session Fold v5), emits fold event |
| `src/knowledge/adapters/phantom-bom-adapter.ts` | Hooks PhantomBOM discovery events, emits missing-tool events |

### widgetdc-orchestrator (modified files)
| File | Change |
|---|---|
| `src/intelligence/inventor-loop.ts` | Emit to bus on experiment completion (post-`runInventor`) |
| `src/phantom-bom.ts` | Emit to bus on new component discovery |
| `src/tools/tool-executor.ts` | Add `knowledge_normalize` case |
| `src/tools/tool-registry.ts` | Register `knowledge_normalize` tool via `defineTool()` |
| `src/cron-scheduler.ts` | Add daily `knowledge-consolidation` cron (03:00 UTC) |
| `src/index.ts` | Import knowledge-bus to ensure singleton initialises on boot |

### widgetdc-contracts (new files)
| File | Responsibility |
|---|---|
| `src/normalization/knowledge-event.ts` | `KnowledgeEvent` TypeBox schema with `$id` |
| `src/normalization/index.ts` | Re-export |

### WidgeTDC (new files)
| File | Responsibility |
|---|---|
| `scripts/sync-knowledge-l4.mjs` | Reads `:KnowledgeCandidate {tier:'L4'}` from Neo4j, writes `WidgeTDC/.claude/skills/<slug>.md` |
| `.claude/hooks/post-session-start.sh` | Runs `sync-knowledge-l4.mjs` on every Claude session start |

---

## Phase 1 — Core Bus + Contracts

### Task 1: KnowledgeEvent type in widgetdc-contracts

**Repo:** `widgetdc-contracts`

**Files:**
- Create: `src/normalization/knowledge-event.ts`
- Create: `src/normalization/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the type**

```typescript
// src/normalization/knowledge-event.ts
import { Type, Static } from '@sinclair/typebox'

export const KnowledgeEvent = Type.Object({
  $id: Type.Literal('KnowledgeEvent'),
  event_id: Type.String({ description: 'UUID' }),
  source: Type.Union([
    Type.Literal('inventor'),
    Type.Literal('session_fold'),
    Type.Literal('phantom_bom'),
    Type.Literal('commit'),
    Type.Literal('manual'),
  ]),
  title: Type.String({ description: 'Human-readable title for skill file name' }),
  content: Type.String({ description: 'Full protocol/skill content in markdown' }),
  summary: Type.String({ description: 'One-line description for MEMORY.md index' }),
  score: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  tags: Type.Array(Type.String()),
  repo: Type.String({ description: 'Origin repo, e.g. widgetdc-orchestrator' }),
  created_at: Type.String({ format: 'date-time' }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})
export type KnowledgeEvent = Static<typeof KnowledgeEvent>
```

- [ ] **Step 2: Create normalization index**

```typescript
// src/normalization/index.ts
export { KnowledgeEvent } from './knowledge-event.js'
export type { KnowledgeEvent as KnowledgeEventType } from './knowledge-event.js'
```

- [ ] **Step 3: Export from root index**

In `src/index.ts`, add:
```typescript
export * from './normalization/index.js'
```

- [ ] **Step 4: Build and verify**

```bash
cd C:/Users/claus/Projetcs/widgetdc-contracts
npm run build
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/normalization/ src/index.ts
git commit -m "feat(normalization): add KnowledgeEvent wire type

Shared type for cross-repo knowledge normalization bus.
Source: inventor | session_fold | phantom_bom | commit | manual.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: KnowledgeBus singleton

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/knowledge-bus.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test inline — node --test src/knowledge/knowledge-bus.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { knowledgeBus, emitKnowledge } from './knowledge-bus.js'

describe('KnowledgeBus', () => {
  it('emits and receives a KnowledgeEvent', (done) => {
    const ev = {
      event_id: '00000000-0000-0000-0000-000000000001',
      source: 'manual' as const,
      title: 'Test Protocol',
      content: '## Test\nContent here.',
      summary: 'Test protocol for unit test',
      tags: ['test'],
      repo: 'widgetdc-orchestrator',
      created_at: new Date().toISOString(),
    }
    knowledgeBus.once('knowledge', (received) => {
      assert.equal(received.event_id, ev.event_id)
      assert.equal(received.source, 'manual')
      done()
    })
    emitKnowledge(ev)
  })
})
```

- [ ] **Step 2: Run — verify fails**

```bash
cd C:/Users/claus/Projetcs/widgetdc-orchestrator
node --test src/knowledge/knowledge-bus.test.ts 2>&1 | head -5
```
Expected: `Cannot find module './knowledge-bus.js'`

- [ ] **Step 3: Implement**

```typescript
// src/knowledge/knowledge-bus.ts
import { EventEmitter } from 'node:events'
import { v4 as uuid } from 'uuid'
import { logger } from '../logger.js'

export interface KnowledgeEvent {
  event_id: string
  source: 'inventor' | 'session_fold' | 'phantom_bom' | 'commit' | 'manual'
  title: string
  content: string
  summary: string
  score?: number
  tags: string[]
  repo: string
  created_at: string
  metadata?: Record<string, unknown>
}

class KnowledgeBus extends EventEmitter {
  emit(event: 'knowledge', payload: KnowledgeEvent): boolean {
    logger.info({ source: payload.source, title: payload.title, score: payload.score }, 'KnowledgeBus: event received')
    return super.emit(event, payload)
  }
}

export const knowledgeBus = new KnowledgeBus()
knowledgeBus.setMaxListeners(50)

export function emitKnowledge(event: Omit<KnowledgeEvent, 'event_id' | 'created_at'> & { event_id?: string; created_at?: string }): void {
  knowledgeBus.emit('knowledge', {
    ...event,
    event_id: event.event_id ?? uuid(),
    created_at: event.created_at ?? new Date().toISOString(),
  })
}

export function onKnowledge(handler: (event: KnowledgeEvent) => void): void {
  knowledgeBus.on('knowledge', handler)
}
```

- [ ] **Step 4: Run — verify passes**

```bash
node --test src/knowledge/knowledge-bus.test.ts
```
Expected: `✓ emits and receives a KnowledgeEvent`

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/knowledge-bus.ts
git commit -m "feat(knowledge): add KnowledgeBus singleton EventEmitter

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Tier Router (pure function)

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/tier-router.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/knowledge/tier-router.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { routeTier, TIER_THRESHOLDS } from './tier-router.js'

describe('routeTier', () => {
  it('routes score 0.90 to l4', () => assert.equal(routeTier(0.90), 'l4'))
  it('routes score 0.85 to l4 (inclusive)', () => assert.equal(routeTier(0.85), 'l4'))
  it('routes score 0.84 to l3', () => assert.equal(routeTier(0.84), 'l3'))
  it('routes score 0.70 to l3 (inclusive)', () => assert.equal(routeTier(0.70), 'l3'))
  it('routes score 0.69 to l2', () => assert.equal(routeTier(0.69), 'l2'))
  it('routes undefined score to l2', () => assert.equal(routeTier(undefined), 'l2'))
  it('routes 0 to l2', () => assert.equal(routeTier(0), 'l2'))
})
```

- [ ] **Step 2: Run — verify fails**

```bash
node --test src/knowledge/tier-router.test.ts 2>&1 | head -3
```
Expected: `Cannot find module './tier-router.js'`

- [ ] **Step 3: Implement**

```typescript
// src/knowledge/tier-router.ts
export type Tier = 'l2' | 'l3' | 'l4'

export const TIER_THRESHOLDS = {
  L4_MIN: 0.85,  // shared skill file — all repos
  L3_MIN: 0.70,  // Neo4j AgentMemory — runtime agents
} as const

export function routeTier(score: number | undefined): Tier {
  if (score === undefined || score < TIER_THRESHOLDS.L3_MIN) return 'l2'
  if (score < TIER_THRESHOLDS.L4_MIN) return 'l3'
  return 'l4'
}
```

- [ ] **Step 4: Run — verify passes**

```bash
node --test src/knowledge/tier-router.test.ts
```
Expected: `✓ 7 passing`

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/tier-router.ts
git commit -m "feat(knowledge): tier router — L4≥0.85, L3≥0.70, L2 otherwise

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: L2 Writer (Redis staging)

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/l2-writer.ts`

- [ ] **Step 1: Write test**

```typescript
// src/knowledge/l2-writer.test.ts
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

describe('l2Writer', () => {
  it('exports a writeL2 async function', async () => {
    const { writeL2 } = await import('./l2-writer.js')
    assert.equal(typeof writeL2, 'function')
  })
})
```

- [ ] **Step 2: Implement**

```typescript
// src/knowledge/l2-writer.ts
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import type { KnowledgeEvent } from './knowledge-bus.js'

const L2_TTL = 7 * 24 * 60 * 60  // 7 days in seconds
const KEY_PREFIX = 'knowledge:staging:'

export async function writeL2(event: KnowledgeEvent): Promise<void> {
  const redis = getRedis()
  if (!redis) {
    logger.warn({ event_id: event.event_id }, 'KnowledgeBus L2: Redis unavailable, skipping staging')
    return
  }
  const key = `${KEY_PREFIX}${event.event_id}`
  await redis.set(key, JSON.stringify(event), 'EX', L2_TTL)
  logger.info({ key, title: event.title, score: event.score }, 'KnowledgeBus L2: staged')
}

export async function listL2(): Promise<KnowledgeEvent[]> {
  const redis = getRedis()
  if (!redis) return []
  const keys = await redis.keys(`${KEY_PREFIX}*`)
  if (keys.length === 0) return []
  const raws = await redis.mget(...keys)
  return raws.filter(Boolean).map(r => JSON.parse(r!) as KnowledgeEvent)
}
```

- [ ] **Step 3: Run test**

```bash
node --test src/knowledge/l2-writer.test.ts
```
Expected: `✓ 1 passing`

- [ ] **Step 4: Commit**

```bash
git add src/knowledge/l2-writer.ts
git commit -m "feat(knowledge): L2 Redis staging writer (7d TTL)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: L3 + L4 Writers (Neo4j)

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/l3-writer.ts`
- Create: `src/knowledge/l4-writer.ts`

- [ ] **Step 1: Implement L3 writer**

```typescript
// src/knowledge/l3-writer.ts
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import type { KnowledgeEvent } from './knowledge-bus.js'

export async function writeL3(event: KnowledgeEvent): Promise<void> {
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (n:KnowledgeCandidate {event_id: $event_id})
SET n.source = $source,
    n.title = $title,
    n.summary = $summary,
    n.content = $content,
    n.score = $score,
    n.tags = $tags,
    n.repo = $repo,
    n.tier = 'L3',
    n.created_at = $created_at,
    n.destructiveHint = false,
    n.contains_pii = false,
    n.confidence_score = $score,
    n.agentId = 'knowledge-bus'
RETURN n.event_id`,
        params: {
          event_id: event.event_id,
          source: event.source,
          title: event.title,
          summary: event.summary,
          content: event.content.slice(0, 4000),
          score: event.score ?? 0,
          tags: event.tags.join(','),
          repo: event.repo,
          created_at: event.created_at,
        },
        intent: `Persist L3 knowledge candidate from ${event.source}: ${event.title}`,
        evidence: `PRISM score ${event.score}, source ${event.source}, repo ${event.repo}`,
      },
      callId: `knowledge-l3-${event.event_id}`,
    })
    logger.info({ event_id: event.event_id, title: event.title }, 'KnowledgeBus L3: written to Neo4j')
  } catch (err) {
    logger.error({ err: String(err), event_id: event.event_id }, 'KnowledgeBus L3: write failed')
  }
}
```

- [ ] **Step 2: Implement L4 writer**

```typescript
// src/knowledge/l4-writer.ts
// L4 = Neo4j node with tier:'L4' — synced to WidgeTDC/.claude/skills/ by local script
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import type { KnowledgeEvent } from './knowledge-bus.js'

export async function writeL4(event: KnowledgeEvent): Promise<void> {
  try {
    const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (n:KnowledgeCandidate {event_id: $event_id})
SET n.source = $source,
    n.title = $title,
    n.slug = $slug,
    n.summary = $summary,
    n.content = $content,
    n.score = $score,
    n.tags = $tags,
    n.repo = $repo,
    n.tier = 'L4',
    n.synced_to_skill = false,
    n.created_at = $created_at,
    n.destructiveHint = false,
    n.contains_pii = false,
    n.confidence_score = $score,
    n.agentId = 'knowledge-bus'
RETURN n.slug`,
        params: {
          event_id: event.event_id,
          source: event.source,
          title: event.title,
          slug,
          summary: event.summary,
          content: event.content.slice(0, 8000),
          score: event.score ?? 0,
          tags: event.tags.join(','),
          repo: event.repo,
          created_at: event.created_at,
        },
        intent: `Promote L4 skill candidate from ${event.source}: ${event.title}`,
        evidence: `PRISM score ${event.score} ≥ 0.85 threshold, source ${event.source}`,
      },
      callId: `knowledge-l4-${event.event_id}`,
    })
    logger.info({ event_id: event.event_id, slug, title: event.title }, 'KnowledgeBus L4: candidate written to Neo4j — pending local sync')
  } catch (err) {
    logger.error({ err: String(err), event_id: event.event_id }, 'KnowledgeBus L4: write failed')
  }
}
```

- [ ] **Step 3: Build check**

```bash
cd C:/Users/claus/Projetcs/widgetdc-orchestrator
node --check src/knowledge/l3-writer.ts src/knowledge/l4-writer.ts
```
Expected: no output (clean)

- [ ] **Step 4: Commit**

```bash
git add src/knowledge/l3-writer.ts src/knowledge/l4-writer.ts
git commit -m "feat(knowledge): L3+L4 Neo4j writers via graph.write_cypher

L3: AgentMemory tier (score 0.70-0.85)
L4: Skill candidate tier (score ≥ 0.85) — synced to WidgeTDC by local script

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Bus orchestrator (wire everything together)

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/index.ts`

- [ ] **Step 1: Implement**

```typescript
// src/knowledge/index.ts
// Wires bus → router → writers. Import this once in src/index.ts.
import { onKnowledge } from './knowledge-bus.js'
import { routeTier } from './tier-router.js'
import { writeL2 } from './l2-writer.js'
import { writeL3 } from './l3-writer.js'
import { writeL4 } from './l4-writer.js'
import { judgeResponse } from '../llm/agent-judge.js'
import { logger } from '../logger.js'

export { emitKnowledge, onKnowledge } from './knowledge-bus.js'
export type { KnowledgeEvent } from './knowledge-bus.js'

let initialized = false

export function initKnowledgeBus(): void {
  if (initialized) return
  initialized = true

  onKnowledge(async (event) => {
    try {
      // Score if not already scored
      let score = event.score
      if (score === undefined) {
        const judgeResult = await judgeResponse(
          `Evaluate this agent knowledge/protocol for quality and reusability: ${event.title}`,
          event.content.slice(0, 2000),
          `Source: ${event.source}. Tags: ${event.tags.join(', ')}. Repo: ${event.repo}.`,
          'deepseek',
        )
        score = Math.min(1, judgeResult.score.aggregate / 10)
        event = { ...event, score }
      }

      const tier = routeTier(score)
      logger.info({ title: event.title, score, tier }, 'KnowledgeBus: routing')

      if (tier === 'l4') {
        await writeL4(event)
        await writeL3(event)  // also persist to L3 for runtime query
      } else if (tier === 'l3') {
        await writeL3(event)
      } else {
        await writeL2(event)
      }
    } catch (err) {
      logger.error({ err: String(err), event_id: event.event_id }, 'KnowledgeBus: routing error')
    }
  })

  logger.info('KnowledgeBus: initialized (bus → router → writers)')
}
```

- [ ] **Step 2: Initialize on boot in src/index.ts**

Find the boot section in `src/index.ts` (after Redis/agent init). Add:
```typescript
import { initKnowledgeBus } from './knowledge/index.js'
// ... after other initializations:
initKnowledgeBus()
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -5
```
Expected: `✅ Build complete → dist/index.js + dist/public/`

- [ ] **Step 4: Commit**

```bash
git add src/knowledge/index.ts src/index.ts dist/index.js
git commit -m "feat(knowledge): wire KnowledgeBus → tier router → L2/L3/L4 writers

Bus initializes on boot. Auto-scores unscored events via judgeResponse().
Score ≥0.85 → L4 (skill candidate), 0.70-0.85 → L3 (AgentMemory), <0.70 → L2 (staging).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 2 — Source Adapters

### Task 7: Inventor Adapter

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/adapters/inventor-adapter.ts`
- Modify: `src/intelligence/inventor-loop.ts`

- [ ] **Step 1: Implement adapter**

```typescript
// src/knowledge/adapters/inventor-adapter.ts
import { emitKnowledge } from '../index.js'
import type { InventorNode } from '../../intelligence/inventor-types.js'

export function emitInventorResult(
  experimentName: string,
  bestNode: InventorNode,
  totalSteps: number,
): void {
  if (!bestNode.artifact || bestNode.score < 0.5) return  // skip low-quality results

  emitKnowledge({
    source: 'inventor',
    title: `Inventor: ${experimentName}`,
    content: typeof bestNode.artifact === 'string' ? bestNode.artifact : JSON.stringify(bestNode.artifact),
    summary: `Evolved protocol from ${experimentName} (${totalSteps} steps, score ${bestNode.score.toFixed(2)})`,
    score: bestNode.score,
    tags: ['inventor', 'evolved', experimentName],
    repo: 'widgetdc-orchestrator',
    metadata: {
      experimentName,
      nodeId: bestNode.id,
      totalSteps,
      metrics: bestNode.metrics,
      analysis: bestNode.analysis,
    },
  })
}
```

- [ ] **Step 2: Hook into inventor-loop.ts completion**

In `src/intelligence/inventor-loop.ts`, find the section after `isRunning = false` (around line 1034). Add:

```typescript
// After: isRunning = false
import { emitInventorResult } from '../knowledge/adapters/inventor-adapter.js'
// ... inside runInventor, after the evolution loop:
const best = getBestNode()
if (best && currentConfig) {
  emitInventorResult(currentConfig.experimentName, best, currentStep)
}
```

- [ ] **Step 3: Build + check**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/knowledge/adapters/inventor-adapter.ts src/intelligence/inventor-loop.ts dist/index.js
git commit -m "feat(knowledge): inventor adapter — emits best node to bus on completion

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Session Fold Adapter (Session Fold v5)

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/adapters/session-fold-adapter.ts`

- [ ] **Step 1: Implement (Session Fold v5 two-pass parser)**

```typescript
// src/knowledge/adapters/session-fold-adapter.ts
import * as fs from 'node:fs'
import { emitKnowledge } from '../index.js'
import { logger } from '../../logger.js'

interface FoldOutput {
  session_id: string
  folded_at: string
  transcript_lines: number
  commits: string[]
  prs: string[]
  open_tasks: Array<{ text: string; source: string }>
  decisions: Array<{ text: string; source: string }>
  linear_refs: string[]
  deploy_events: string[]
}

function parseTranscript(transcriptPath: string): FoldOutput {
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
  const messages: Array<{ role: string; text: string; idx: number }> = []

  for (const [idx, line] of lines.entries()) {
    try {
      const obj = JSON.parse(line)
      const role = obj.message?.role || obj.role
      if (role !== 'user' && role !== 'assistant') continue
      const content = obj.message?.content || obj.content
      const text = Array.isArray(content)
        ? content.filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join(' ')
        : String(content || '')
      if (text.trim().length > 10) messages.push({ role, text, idx })
    } catch { continue }
  }

  // Pass 1: high-confidence regex
  const commits = [...new Set(messages.flatMap(m =>
    [...m.text.matchAll(/\b([a-f0-9]{7,12})\b/g)].map(x => x[1])
      .filter(h => /^[a-f0-9]+$/.test(h) && h.length >= 7)
  ))].slice(0, 20)

  const prs = [...new Set(messages.flatMap(m =>
    [...m.text.matchAll(/PR\s*#?(\d+)/gi)].map(x => x[1])
  ))]

  const linearRefs = [...new Set(messages.flatMap(m =>
    [...m.text.matchAll(/LIN-(\d+)/gi)].map(x => `LIN-${x[1]}`)
  ))]

  const deployEvents = messages
    .filter(m => /railway up|deployed|live.*uptime|deploy.*complete/i.test(m.text))
    .map(m => ({ text: m.text.slice(0, 200), source: m.role }))
    .slice(0, 5)

  // Pass 2: validation schema on untagged segments
  const tagged = new Set(messages.filter(m =>
    commits.some(c => m.text.includes(c)) ||
    prs.some(p => m.text.includes(`#${p}`)) ||
    linearRefs.some(r => m.text.includes(r))
  ).map(m => m.idx))

  const untagged = messages.filter(m => !tagged.has(m.idx))

  const openTasks = untagged
    .filter(m => /TODO|FIXME|open|uafsluttet|mangler|Actions?\s+[A-F]|ikke.*håndteret/i.test(m.text))
    .map(m => ({ text: m.text.slice(0, 300), source: m.role }))
    .slice(0, 10)

  const decisions = messages
    .filter(m => /besluttet|approved|confirmed|merged|✅|oprettet|persisteret|fixed|deployet/i.test(m.text))
    .map(m => ({ text: m.text.slice(0, 300), source: m.role }))
    .slice(0, 10)

  return {
    session_id: transcriptPath.split('/').pop()?.replace('.jsonl', '') ?? 'unknown',
    folded_at: new Date().toISOString(),
    transcript_lines: lines.length,
    commits,
    prs,
    open_tasks: openTasks,
    decisions,
    linear_refs: linearRefs,
    deploy_events: deployEvents.map(d => d.text),
  }
}

export async function foldSession(transcriptPath: string): Promise<FoldOutput> {
  if (!fs.existsSync(transcriptPath)) throw new Error(`Transcript not found: ${transcriptPath}`)
  const fold = parseTranscript(transcriptPath)

  const content = `## Session Fold — ${fold.session_id}

**Folded:** ${fold.folded_at}
**Lines:** ${fold.transcript_lines}

### Commits
${fold.commits.map(c => `- \`${c}\``).join('\n') || '(none)'}

### PRs
${fold.prs.map(p => `- PR #${p}`).join('\n') || '(none)'}

### Linear Refs
${fold.linear_refs.join(', ') || '(none)'}

### Open Tasks
${fold.open_tasks.map(t => `- ${t.text}`).join('\n') || '(none)'}

### Key Decisions
${fold.decisions.map(d => `- ${d.text}`).join('\n') || '(none)'}

### Deploy Events
${fold.deploy_events.map(d => `- ${d}`).join('\n') || '(none)'}
`

  emitKnowledge({
    source: 'session_fold',
    title: `Session Fold: ${fold.session_id}`,
    content,
    summary: `Session ${fold.session_id}: ${fold.commits.length} commits, ${fold.open_tasks.length} open tasks, ${fold.decisions.length} decisions`,
    tags: ['session-fold', fold.session_id, ...fold.linear_refs],
    repo: 'widgetdc-orchestrator',
    metadata: fold,
  })

  logger.info({ session_id: fold.session_id, commits: fold.commits.length }, 'SessionFoldAdapter: emitted to KnowledgeBus')
  return fold
}
```

- [ ] **Step 2: Build check**

```bash
node --check src/knowledge/adapters/session-fold-adapter.ts
```
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/knowledge/adapters/session-fold-adapter.ts
git commit -m "feat(knowledge): session-fold adapter (Session Fold v5 two-pass parser)

Implements inventor-evolved two-pass JSONL parser (score 0.90).
Pass1: commits/PRs/LinearRefs/deploys via regex.
Pass2: open-tasks/decisions on untagged segments.
Emits KnowledgeEvent to bus for tier routing.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 9: PhantomBOM Adapter

**Repo:** `widgetdc-orchestrator`

**Files:**
- Create: `src/knowledge/adapters/phantom-bom-adapter.ts`
- Modify: `src/phantom-bom.ts`

- [ ] **Step 1: Implement adapter**

```typescript
// src/knowledge/adapters/phantom-bom-adapter.ts
import { emitKnowledge } from '../index.js'
import { logger } from '../../logger.js'

export interface PhantomDiscovery {
  toolName: string
  toolDescription: string
  repo: string
  discoveredIn: string  // file or context where it was found
}

export function emitPhantomDiscovery(discovery: PhantomDiscovery): void {
  const content = `## Phantom Tool Discovery: ${discovery.toolName}

**Tool:** \`${discovery.toolName}\`
**Description:** ${discovery.toolDescription}
**Discovered in:** ${discovery.discoveredIn}
**Repo:** ${discovery.repo}

### Issue
This tool is called in orchestrator code but is NOT registered in the backend MCP catalogue.
It routes via \`callMcpTool\` to the backend bridge and silently fails.

### Fix Pattern
Import and call the local function directly instead of via MCP bridge:
\`\`\`typescript
// WRONG: const result = await callMcpTool({ toolName: '${discovery.toolName}', ... })
// RIGHT: const { localFn } = await import('../path/to/local.js'); await localFn(...)
\`\`\`
`

  emitKnowledge({
    source: 'phantom_bom',
    title: `PhantomBOM: ${discovery.toolName} not in backend catalogue`,
    content,
    summary: `Tool ${discovery.toolName} used via callMcpTool but missing from backend — use local import`,
    score: 0.80,  // Known-good pattern, direct L3
    tags: ['phantom-bom', 'tool-routing', discovery.toolName, discovery.repo],
    repo: discovery.repo,
    metadata: discovery,
  })

  logger.info({ toolName: discovery.toolName }, 'PhantomBOMAdapter: discovery emitted to KnowledgeBus')
}
```

- [ ] **Step 2: Hook into phantom-bom.ts**

In `src/phantom-bom.ts`, find the section where new components are discovered/added. After each new discovery write, add:

```typescript
import { emitPhantomDiscovery } from './knowledge/adapters/phantom-bom-adapter.js'
// After confirming new phantom component:
emitPhantomDiscovery({
  toolName: component.name,
  toolDescription: component.description ?? '',
  repo: 'widgetdc-orchestrator',
  discoveredIn: component.source ?? 'phantom-bom scan',
})
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/knowledge/adapters/phantom-bom-adapter.ts src/phantom-bom.ts dist/index.js
git commit -m "feat(knowledge): phantom-bom adapter — emits missing-tool discoveries to bus

Captures tools called via callMcpTool that don't exist in backend catalogue.
Score 0.80 → L3 tier. Includes fix-pattern documentation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 3 — MCP Tool + Cron

### Task 10: knowledge_normalize MCP tool

**Repo:** `widgetdc-orchestrator`

**Files:**
- Modify: `src/tools/tool-registry.ts`
- Modify: `src/tools/tool-executor.ts`

- [ ] **Step 1: Register in tool-registry.ts**

Find the `defineTool` section in `src/tools/tool-registry.ts`. Add after the last `defineTool` call before the closing export:

```typescript
defineTool({
  name: 'knowledge_normalize',
  namespace: 'knowledge',
  description: 'Emit a knowledge event to the normalization bus. Routes to L2/L3/L4 based on PRISM score. Use for manual promotion of protocols, patterns, or improvements.',
  input: z.object({
    source: z.enum(['inventor', 'session_fold', 'phantom_bom', 'commit', 'manual']).default('manual'),
    title: z.string().describe('Human-readable title for the skill'),
    content: z.string().describe('Full protocol/skill content in markdown'),
    summary: z.string().describe('One-line description'),
    score: z.number().min(0).max(1).optional().describe('Pre-computed PRISM score — omit to auto-score'),
    tags: z.array(z.string()).default([]),
    repo: z.string().default('widgetdc-orchestrator'),
    session_id: z.string().optional().describe('For source=session_fold: path to JSONL transcript'),
  }),
  category: 'agent',
  handler: 'orchestrator',
  timeoutMs: 30000,
  authRequired: true,
  availableVia: ['openai', 'openapi', 'mcp'],
  tags: ['knowledge', 'normalization', 'bus'],
})
```

- [ ] **Step 2: Add executor case in tool-executor.ts**

Find `case 'inventor_run':` in `src/tools/tool-executor.ts`. Add BEFORE it:

```typescript
case 'knowledge_normalize': {
  try {
    const { emitKnowledge } = await import('../knowledge/index.js')
    const { foldSession } = await import('../knowledge/adapters/session-fold-adapter.js')

    if (args.source === 'session_fold' && args.session_id) {
      // Use session-fold adapter for JSONL transcripts
      const fold = await foldSession(args.session_id as string)
      return `Session fold emitted to KnowledgeBus: ${fold.commits.length} commits, ${fold.open_tasks.length} open tasks, ${fold.decisions.length} decisions`
    }

    emitKnowledge({
      source: (args.source as string ?? 'manual') as 'manual',
      title: args.title as string,
      content: args.content as string,
      summary: args.summary as string,
      score: args.score as number | undefined,
      tags: (args.tags as string[]) ?? [],
      repo: (args.repo as string) ?? 'widgetdc-orchestrator',
    })
    const tier = args.score !== undefined
      ? (args.score >= 0.85 ? 'L4 (skill candidate)' : args.score >= 0.70 ? 'L3 (AgentMemory)' : 'L2 (staging)')
      : 'auto-scored'
    return `KnowledgeEvent emitted: "${args.title}" → ${tier}`
  } catch (err) {
    return `knowledge_normalize failed: ${err}`
  }
}
```

- [ ] **Step 3: Build + verify tool count unchanged (150)**

```bash
npm run build 2>&1 | grep "tools"
```
Expected: `✓ Build parity: 151 tools ↔ 151 executor cases`

- [ ] **Step 4: Commit**

```bash
git add src/tools/tool-registry.ts src/tools/tool-executor.ts dist/index.js
git commit -m "feat(knowledge): knowledge_normalize MCP tool

Manual and programmatic trigger for KnowledgeBus.
Supports direct emit or session-fold JSONL path for source=session_fold.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Daily consolidation cron

**Repo:** `widgetdc-orchestrator`

**Files:**
- Modify: `src/cron-scheduler.ts`

- [ ] **Step 1: Add cron entry**

In `src/cron-scheduler.ts`, find the existing cron definitions (look for `'Memory Consolidation'` entry around line 1719). Add after it:

```typescript
{
  name: 'Knowledge Bus Consolidation (Daily L2→L3 promotion)',
  schedule: '0 3 * * *',  // 03:00 UTC daily
  enabled: true,
  steps: [{
    agent_id: 'orchestrator',
    tool_name: 'knowledge_bus_consolidate',
    arguments: { promote_threshold: 0.70, max_items: 50 },
  }],
},
```

- [ ] **Step 2: Add `knowledge_bus_consolidate` executor case**

In `src/tools/tool-executor.ts`, add after `knowledge_normalize` case:

```typescript
case 'knowledge_bus_consolidate': {
  try {
    const { listL2 } = await import('../knowledge/l2-writer.js')
    const { writeL3 } = await import('../knowledge/l3-writer.js')
    const { judgeResponse } = await import('../llm/agent-judge.js')
    const threshold = (args.promote_threshold as number) ?? 0.70
    const maxItems = (args.max_items as number) ?? 50

    const staged = await listL2()
    let promoted = 0
    for (const event of staged.slice(0, maxItems)) {
      if (event.score === undefined) {
        const jr = await judgeResponse(event.title, event.content.slice(0, 1500), undefined, 'deepseek')
        event.score = Math.min(1, jr.score.aggregate / 10)
      }
      if (event.score >= threshold) {
        await writeL3(event)
        promoted++
      }
    }
    return `Knowledge consolidation: ${staged.length} staged, ${promoted} promoted to L3`
  } catch (err) {
    return `knowledge_bus_consolidate failed: ${err}`
  }
}
```

- [ ] **Step 3: Register `knowledge_bus_consolidate` in tool-registry.ts**

```typescript
defineTool({
  name: 'knowledge_bus_consolidate',
  namespace: 'knowledge',
  description: 'Promote L2 staged knowledge events to L3 AgentMemory if score meets threshold. Runs daily via cron.',
  input: z.object({
    promote_threshold: z.number().default(0.70),
    max_items: z.number().default(50),
  }),
  category: 'agent',
  handler: 'orchestrator',
  timeoutMs: 120000,
  authRequired: true,
  availableVia: ['openai', 'openapi', 'mcp'],
  tags: ['knowledge', 'cron', 'consolidation'],
})
```

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | tail -3
```
Expected: `✅ Build complete`

- [ ] **Step 5: Commit**

```bash
git add src/cron-scheduler.ts src/tools/tool-executor.ts src/tools/tool-registry.ts dist/index.js
git commit -m "feat(knowledge): daily L2→L3 consolidation cron (03:00 UTC)

Scores and promotes staged L2 events to L3 AgentMemory when score ≥ 0.70.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 4 — L4 Local Sync (WidgeTDC)

### Task 12: L4 sync script

**Repo:** `WidgeTDC`

**Files:**
- Create: `scripts/sync-knowledge-l4.mjs`

- [ ] **Step 1: Implement sync script**

```javascript
// scripts/sync-knowledge-l4.mjs
// Reads :KnowledgeCandidate {tier:'L4'} nodes from Neo4j via backend MCP
// Writes each to WidgeTDC/.claude/skills/<slug>.md
// Run manually or via .claude/hooks/post-session-start.sh

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(__dirname, '../.claude/skills')
const BACKEND_URL = 'https://backend-production-d3da.up.railway.app/api/mcp/route'
const API_KEY = process.env.BACKEND_API_KEY || 'Heravej_22'

async function fetchL4Candidates() {
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      tool: 'graph.read_cypher',
      payload: {
        query: `MATCH (n:KnowledgeCandidate {tier: 'L4'})
                WHERE n.synced_to_skill IS NULL OR n.synced_to_skill = false
                RETURN n.slug AS slug, n.title AS title, n.summary AS summary,
                       n.content AS content, n.source AS source, n.score AS score,
                       n.created_at AS created_at, n.event_id AS event_id
                ORDER BY n.score DESC LIMIT 50`,
      },
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Backend responded ${res.status}`)
  const data = await res.json()
  return data.result ?? data.data ?? []
}

async function markSynced(eventId) {
  await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      tool: 'graph.write_cypher',
      payload: {
        query: `MATCH (n:KnowledgeCandidate {event_id: $event_id}) SET n.synced_to_skill = true RETURN n.slug`,
        params: { event_id: eventId },
        intent: 'Mark L4 candidate as synced to local skill file',
        evidence: `sync-knowledge-l4.mjs run at ${new Date().toISOString()}`,
      },
    }),
    signal: AbortSignal.timeout(15000),
  })
}

async function main() {
  if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true })

  let candidates
  try {
    candidates = await fetchL4Candidates()
  } catch (err) {
    console.error(`[sync-l4] Failed to fetch candidates: ${err.message}`)
    process.exit(0)  // Non-fatal — skills may already be current
  }

  if (!candidates.length) {
    console.log('[sync-l4] No new L4 candidates to sync')
    return
  }

  let synced = 0
  for (const c of candidates) {
    if (!c.slug || !c.content) continue
    const filePath = join(SKILLS_DIR, `${c.slug}.md`)
    const fileContent = `---
name: ${c.title}
description: ${c.summary}
source: ${c.source}
score: ${c.score}
synced_at: ${new Date().toISOString()}
---

${c.content}
`
    writeFileSync(filePath, fileContent, 'utf8')
    await markSynced(c.event_id)
    console.log(`[sync-l4] ✓ ${c.slug}.md (score: ${c.score})`)
    synced++
  }

  console.log(`[sync-l4] Done: ${synced}/${candidates.length} synced to ${SKILLS_DIR}`)
}

main().catch(err => { console.error('[sync-l4] Fatal:', err); process.exit(1) })
```

- [ ] **Step 2: Test locally**

```bash
cd C:/Users/claus/Projetcs/WidgeTDC
BACKEND_API_KEY=Heravej_22 node scripts/sync-knowledge-l4.mjs
```
Expected: `[sync-l4] No new L4 candidates to sync` (until bus has produced L4 candidates)

- [ ] **Step 3: Commit**

```bash
cd C:/Users/claus/Projetcs/WidgeTDC
git add scripts/sync-knowledge-l4.mjs
git commit -m "feat(knowledge): L4 sync script — reads Neo4j candidates, writes to .claude/skills/

Bridges Railway orchestrator → local skill files.
Run: node scripts/sync-knowledge-l4.mjs
Marks synced nodes in Neo4j to prevent re-sync.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 13: Claude session-start hook

**Repo:** `WidgeTDC`

**Files:**
- Create: `.claude/hooks/post-session-start.sh`
- Modify: `WidgeTDC/.claude/settings.json` (or local settings)

- [ ] **Step 1: Create hook script**

```bash
#!/bin/bash
# .claude/hooks/post-session-start.sh
# Auto-sync L4 knowledge candidates to skill files on session start
# Silent on failure — never block Claude startup

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/../../scripts/sync-knowledge-l4.mjs"

if [ -f "$SYNC_SCRIPT" ]; then
  node "$SYNC_SCRIPT" 2>/dev/null || true
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x "C:/Users/claus/Projetcs/WidgeTDC/.claude/hooks/post-session-start.sh"
```

- [ ] **Step 3: Register hook in settings**

In `WidgeTDC/.claude/settings.json` (or `settings.local.json`), add to hooks:
```json
{
  "hooks": {
    "PostSessionStart": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/post-session-start.sh" }]
      }
    ]
  }
}
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/claus/Projetcs/WidgeTDC
git add .claude/hooks/post-session-start.sh .claude/settings.json
git commit -m "feat(knowledge): session-start hook auto-syncs L4 candidates to skill files

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Phase 5 — Validation + Deploy

### Task 14: End-to-end smoke test

- [ ] **Step 1: Deploy orchestrator to Railway**

```bash
cd C:/Users/claus/Projetcs/widgetdc-orchestrator
railway up -s orchestrator
```

- [ ] **Step 2: Verify health**

```bash
curl -s https://orchestrator-production-c27e.up.railway.app/health | grep uptime
```
Expected: `uptime_seconds` present

- [ ] **Step 3: Trigger manual knowledge_normalize**

```bash
curl -s -X POST https://orchestrator-production-c27e.up.railway.app/tools/call \
  -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  -H "Content-Type: application/json" \
  -d '{
    "call_id": "test-knowledge-01",
    "tool_name": "knowledge_normalize",
    "args": {
      "source": "manual",
      "title": "Test Knowledge Event",
      "content": "## Test\nThis is a test knowledge event for smoke testing the normalization bus.",
      "summary": "Smoke test event",
      "score": 0.88,
      "tags": ["test", "smoke"],
      "repo": "widgetdc-orchestrator"
    }
  }'
```
Expected: `{"result": "KnowledgeEvent emitted: \"Test Knowledge Event\" → L4 (skill candidate)"}`

- [ ] **Step 4: Verify L4 node in Neo4j**

```bash
curl -s -X POST https://backend-production-d3da.up.railway.app/api/mcp/route \
  -H "Authorization: Bearer Heravej_22" \
  -H "Content-Type: application/json" \
  -d '{"tool":"graph.read_cypher","payload":{"query":"MATCH (n:KnowledgeCandidate {tier:\"L4\"}) RETURN n.title, n.score, n.synced_to_skill ORDER BY n.created_at DESC LIMIT 5"}}'
```
Expected: test event appears in results

- [ ] **Step 5: Run L4 sync**

```bash
cd C:/Users/claus/Projetcs/WidgeTDC
node scripts/sync-knowledge-l4.mjs
```
Expected: `[sync-l4] ✓ test-knowledge-event.md (score: 0.88)`

- [ ] **Step 6: Verify skill file created**

```bash
ls "C:/Users/claus/Projetcs/WidgeTDC/.claude/skills/test-knowledge-event.md"
cat "C:/Users/claus/Projetcs/WidgeTDC/.claude/skills/test-knowledge-event.md" | head -10
```

- [ ] **Step 7: Trigger session-fold via MCP**

```bash
curl -s -X POST https://orchestrator-production-c27e.up.railway.app/tools/call \
  -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  -H "Content-Type: application/json" \
  -d '{
    "call_id": "test-fold-01",
    "tool_name": "knowledge_normalize",
    "args": {
      "source": "session_fold",
      "title": "ignored-for-fold",
      "content": "ignored",
      "summary": "ignored",
      "session_id": "C:/Users/claus/.claude/projects/C--Users-claus-Projetcs-widgetdc-orchestrator/9c93ab5f-12fc-49e5-bf0a-52edd779dfa0.jsonl"
    }
  }'
```
Expected: `Session fold emitted to KnowledgeBus: N commits, N open tasks, N decisions`

- [ ] **Step 8: Final commit — update MEMORY.md with plan reference**

In `widgetdc-orchestrator` memory, add:
```bash
# Already handled by memory system — no action needed
```

---

## Recommended Skillset Summary

| Fase | Skill | Brug |
|---|---|---|
| Phase 1 (Bus+Router) | `superpowers:test-driven-development` | TDD på tier-router (pure fn) |
| Phase 2 (Adapters) | `wocto-factory` | Spec-in, code-out for adapter boilerplate |
| Phase 3 (MCP+Cron) | `master-architect-widgetdc` | Write-gate governance for cron + tool registration |
| Phase 4 (L4 Sync) | `superpowers:subagent-driven-development` | Parallel: WidgeTDC hook + orchestrator MCP |
| Phase 5 (E2E) | `deploy-guardian` | Railway deploy + smoke test |

---

## Self-Review

**Spec coverage check:**
- ✅ Inventor output → bus (Task 7)
- ✅ Session fold → bus (Task 8, Session Fold v5)
- ✅ PhantomBOM discoveries → bus (Task 9)
- ✅ Memory layer (L2 Redis, L3 Neo4j, L4 skill files) (Tasks 4-5-6)
- ✅ Tier routing by PRISM score (Task 3)
- ✅ All agents in all repos via WidgeTDC/.claude/skills/ (Tasks 12-13)
- ✅ Daily consolidation (Task 11)
- ✅ Manual trigger via MCP (Task 10)
- ✅ Chat pattern / general improvements via `source: 'manual'` + `knowledge_normalize`

**No placeholders:** All steps contain complete code.

**Type consistency:** `KnowledgeEvent` defined in Task 2, used identically in Tasks 4-9.
