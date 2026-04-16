/**
 * knowledge/index.ts — Wires KnowledgeBus → tier router → L2/L3/L4 writers.
 *
 * Import this once in src/index.ts to activate the bus.
 * initKnowledgeBus() is idempotent — safe to call multiple times.
 */
import { onKnowledge } from './knowledge-bus.js'
import { routeTier } from './tier-router.js'
import { writeL2 } from './l2-writer.js'
import { writeL3 } from './l3-writer.js'
import { writeL4 } from './l4-writer.js'
import { autoTag } from './auto-tagger.js'
import { judgeResponse } from '../llm/agent-judge.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

// ─── Knowledge dedup (topic 7/15) ────────────────────────────────────────────
// Fingerprint-based dedup before L3/L4 promotion.
// Prevents duplicate nodes from repeated session folds or re-emitted events.

const DEDUP_PREFIX = 'knowledge:dedup:'
const DEDUP_TTL = 7 * 24 * 3600 // 7-day window

function knowledgeFingerprint(title: string, source: string): string {
  // Normalize: lowercase, strip punctuation, keep first 60 chars
  const normalized = `${source}:${title}`.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-').slice(0, 80)
  return normalized
}

async function isDuplicate(title: string, source: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  const key = `${DEDUP_PREFIX}${knowledgeFingerprint(title, source)}`
  const exists = await redis.exists(key).catch(() => 0)
  return exists > 0
}

async function markSeen(title: string, source: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const key = `${DEDUP_PREFIX}${knowledgeFingerprint(title, source)}`
  await redis.set(key, '1', 'EX', DEDUP_TTL).catch(() => {})
}

export { emitKnowledge, onKnowledge } from './knowledge-bus.js'
export type { KnowledgeEvent } from './knowledge-bus.js'

let initialized = false

export function initKnowledgeBus(): void {
  if (initialized) return
  initialized = true

  onKnowledge(async (event) => {
    try {
      // Score via PRISM if not already scored
      let score = event.score
      if (score === undefined) {
        const judgeResult = await judgeResponse(
          `Evaluate this agent knowledge/protocol for quality and reusability: ${event.title}`,
          event.content.slice(0, 2000),
          `Source: ${event.source}. Tags: ${event.tags.join(', ')}. Repo: ${event.repo}.`,
          'deepseek',
        )
        // aggregate is 0-10 scale — normalize to 0-1
        const raw = judgeResult.score.aggregate
        score = Math.min(1, Math.max(0, raw > 1 ? raw / 10 : raw))
        event = { ...event, score }
      }

      // Auto-enrich tags before tier routing
      event = autoTag(event)

      const tier = routeTier(score)

      // Dedup check before L3/L4 promotion
      if (tier === 'l3' || tier === 'l4') {
        const dup = await isDuplicate(event.title, event.source)
        if (dup) {
          logger.debug({ title: event.title, source: event.source }, 'KnowledgeBus: dedup hit — skipping promotion')
          return
        }
        await markSeen(event.title, event.source)
      }

      logger.info({ title: event.title, score, tier }, 'KnowledgeBus: routing event')

      if (tier === 'l4') {
        await writeL4(event)
        await writeL3(event)  // also persist to L3 for runtime agent query
      } else if (tier === 'l3') {
        await writeL3(event)
      } else {
        await writeL2(event)
      }
    } catch (err) {
      logger.error({ err: String(err), event_id: event.event_id }, 'KnowledgeBus: routing error — event dropped to L2')
      // Best-effort fallback: stage to L2 so nothing is silently lost
      try {
        await writeL2(event)
      } catch {
        // Redis unavailable — already logged inside writeL2
      }
    }
  })

  logger.info('KnowledgeBus: initialized (bus → router → L2/L3/L4 writers)')
}
