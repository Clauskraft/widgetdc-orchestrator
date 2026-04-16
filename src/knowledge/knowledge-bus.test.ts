/**
 * knowledge-bus.test.ts — Unit tests for the KnowledgeBus singleton.
 *
 * Run: npx tsx src/knowledge/knowledge-bus.test.ts
 */

// Minimal env before importing config-dependent modules
process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.PORT = process.env.PORT || '3001'
process.env.NODE_ENV = 'test'
process.env.RLM_API_KEY = process.env.RLM_API_KEY || 'test-key'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { knowledgeBus, emitKnowledge } from './knowledge-bus.js'

describe('KnowledgeBus', () => {
  it('emits and receives a KnowledgeEvent', (_, done) => {
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

  it('auto-generates event_id and created_at when omitted', (_, done) => {
    knowledgeBus.once('knowledge', (received) => {
      assert.ok(received.event_id, 'event_id should be auto-generated')
      assert.ok(received.created_at, 'created_at should be auto-generated')
      assert.equal(received.source, 'inventor')
      done()
    })
    emitKnowledge({
      source: 'inventor',
      title: 'Auto-ID Test',
      content: 'Some content',
      summary: 'Auto ID',
      tags: ['auto'],
      repo: 'widgetdc-orchestrator',
    })
  })

  it('preserves optional score and metadata fields', (_, done) => {
    knowledgeBus.once('knowledge', (received) => {
      assert.equal(received.score, 0.95)
      assert.deepEqual(received.metadata, { pr: 42 })
      done()
    })
    emitKnowledge({
      source: 'session_fold',
      title: 'Scored Event',
      content: 'Content',
      summary: 'Scored',
      score: 0.95,
      tags: ['scored'],
      repo: 'widgetdc-orchestrator',
      metadata: { pr: 42 },
    })
  })
})
