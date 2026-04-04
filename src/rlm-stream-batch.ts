/**
 * rlm-stream-batch.ts — Batch pipeline via RLM SSE streaming
 *
 * Runs 3 tasks concurrently through RLM Engine A2A streaming:
 *   1. Graph enrichment — ingest consulting docs via research-curation skill
 *   2. Entity extraction — batch extract via cognitive-reasoning skill
 *   3. Evolution loops — seed Q-learning via knowledge-query skill
 *
 * All via RLM /a2a/tasks/sendSubscribe with SSE streaming.
 * Uses DeepSeek preference where possible (cheaper than Gemini for batch).
 */
import { logger } from './logger.js'
import { config } from './config.js'

const RLM_URL = config.rlmUrl

interface A2AMessage {
  role: 'user' | 'assistant'
  parts: Array<{ type: 'text'; text: string }>
}

interface A2AStreamEvent {
  event: 'task_status_update' | 'task_artifact_update' | 'task_complete'
  task_id: string
  status?: { state: string; message?: string }
  artifact?: { name: string; parts: Array<{ type: string; text: string }> }
}

/**
 * Stream A2A task execution via SSE.
 * Returns accumulated artifacts from the stream.
 */
export async function streamA2ATask(
  skillId: string,
  prompt: string,
  timeoutMs = 60000,
): Promise<{ artifacts: string[]; duration_ms: number; task_id: string | null }> {
  const t0 = Date.now()
  const artifacts: string[] = []
  let taskId: string | null = null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const messages: A2AMessage[] = [{ role: 'user', parts: [{ type: 'text', text: prompt }] }]
    const res = await fetch(`${RLM_URL}/a2a/tasks/sendSubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ messages, skill_id: skillId }),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`RLM A2A stream failed: HTTP ${res.status}`)
    }

    // Parse SSE stream
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue
        const dataStr = line.slice(5).trim()
        if (dataStr === '[DONE]') continue

        try {
          const event = JSON.parse(dataStr) as A2AStreamEvent
          taskId = event.task_id

          if (event.event === 'task_artifact_update' && event.artifact) {
            for (const part of event.artifact.parts) {
              if (part.type === 'text' && part.text) {
                artifacts.push(part.text)
              }
            }
          }

          if (event.event === 'task_status_update' && event.status?.state === 'completed') {
            break
          }
        } catch { /* skip malformed events */ }
      }
    }
  } finally {
    clearTimeout(timer)
  }

  return { artifacts, duration_ms: Date.now() - t0, task_id: taskId }
}

/**
 * Batch pipeline: runs 3 tasks concurrently via RLM streams.
 */
export async function runBatchStreamPipeline(options: {
  documents?: Array<{ content: string; filename: string; domain: string }>
  queries?: string[]
  enrichmentTopics?: string[]
}): Promise<{
  enrichment: Array<{ topic: string; artifacts: number; duration_ms: number }>
  extraction: Array<{ filename: string; entities: number; duration_ms: number }>
  queries: Array<{ query: string; response_length: number; duration_ms: number }>
  total_duration_ms: number
}> {
  const t0 = Date.now()
  logger.info({
    enrichment: options.enrichmentTopics?.length ?? 0,
    documents: options.documents?.length ?? 0,
    queries: options.queries?.length ?? 0,
  }, 'RLM batch stream pipeline: starting')

  // Task 1: Graph enrichment via research-curation skill (parallel)
  const enrichmentPromises = (options.enrichmentTopics ?? []).map(async topic => {
    const t1 = Date.now()
    try {
      const result = await streamA2ATask(
        'research-curation',
        `Research and curate knowledge about: ${topic}. Extract key facts, regulations, frameworks, and organizations. Reply with structured findings.`,
        90000,
      )
      return { topic, artifacts: result.artifacts.length, duration_ms: Date.now() - t1 }
    } catch (err) {
      logger.warn({ topic, error: String(err) }, 'Enrichment stream failed')
      return { topic, artifacts: 0, duration_ms: Date.now() - t1 }
    }
  })

  // Task 2: Entity extraction via cognitive-reasoning skill (parallel)
  const extractionPromises = (options.documents ?? []).map(async doc => {
    const t1 = Date.now()
    try {
      const prompt = `Extract named entities from this document. Reply ONLY as JSON: {"entities":[{"name":"...","type":"Organization|Regulation|Framework|Service"}]}\n\nDocument: ${doc.content.slice(0, 3000)}`
      const result = await streamA2ATask('cognitive-reasoning', prompt, 60000)
      const merged = result.artifacts.join(' ')
      const match = merged.match(/\{[\s\S]*"entities"[\s\S]*\}/)
      const entities = match ? (JSON.parse(match[0]).entities?.length ?? 0) : 0
      return { filename: doc.filename, entities, duration_ms: Date.now() - t1 }
    } catch (err) {
      logger.warn({ filename: doc.filename, error: String(err) }, 'Extraction stream failed')
      return { filename: doc.filename, entities: 0, duration_ms: Date.now() - t1 }
    }
  })

  // Task 3: Evolution queries via knowledge-query skill (parallel)
  const queryPromises = (options.queries ?? []).map(async query => {
    const t1 = Date.now()
    try {
      const result = await streamA2ATask('knowledge-query', query, 45000)
      const responseLength = result.artifacts.join(' ').length
      return { query: query.slice(0, 50), response_length: responseLength, duration_ms: Date.now() - t1 }
    } catch (err) {
      logger.warn({ query, error: String(err) }, 'Query stream failed')
      return { query: query.slice(0, 50), response_length: 0, duration_ms: Date.now() - t1 }
    }
  })

  // Run all 3 tasks concurrently with Promise.allSettled
  const [enrichmentResults, extractionResults, queryResults] = await Promise.all([
    Promise.allSettled(enrichmentPromises),
    Promise.allSettled(extractionPromises),
    Promise.allSettled(queryPromises),
  ])

  const enrichment = enrichmentResults.map(r => r.status === 'fulfilled' ? r.value : { topic: 'failed', artifacts: 0, duration_ms: 0 })
  const extraction = extractionResults.map(r => r.status === 'fulfilled' ? r.value : { filename: 'failed', entities: 0, duration_ms: 0 })
  const queries = queryResults.map(r => r.status === 'fulfilled' ? r.value : { query: 'failed', response_length: 0, duration_ms: 0 })

  const total_duration_ms = Date.now() - t0
  logger.info({
    enrichment_count: enrichment.length,
    extraction_count: extraction.length,
    query_count: queries.length,
    total_ms: total_duration_ms,
  }, 'RLM batch stream pipeline: complete')

  return { enrichment, extraction, queries, total_duration_ms }
}
