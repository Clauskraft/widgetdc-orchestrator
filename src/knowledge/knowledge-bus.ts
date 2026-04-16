/**
 * knowledge-bus.ts — Singleton EventEmitter for the Knowledge Normalization Bus.
 *
 * All source adapters (inventor, session_fold, phantom_bom, commit, manual)
 * emit KnowledgeEvents here. Writers (Neo4j, embedding, audit) subscribe via onKnowledge().
 */
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
    logger.info(
      { source: payload.source, title: payload.title, score: payload.score },
      'KnowledgeBus: event received',
    )
    return super.emit(event, payload)
  }
}

export const knowledgeBus = new KnowledgeBus()
knowledgeBus.setMaxListeners(50)

export function emitKnowledge(
  event: Omit<KnowledgeEvent, 'event_id' | 'created_at'> & {
    event_id?: string
    created_at?: string
  },
): void {
  knowledgeBus.emit('knowledge', {
    ...event,
    event_id: event.event_id ?? uuid(),
    created_at: event.created_at ?? new Date().toISOString(),
  })
}

export function onKnowledge(handler: (event: KnowledgeEvent) => void): void {
  knowledgeBus.on('knowledge', handler)
}
