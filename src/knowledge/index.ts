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

      const tier = routeTier(score)
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
