/**
 * routes/chat.ts — AgentMessage REST endpoints.
 *
 * Provides: message broadcast, persistent history, threads,
 * search, knowledge capture, templates, debate, summaries.
 */
import { Router, Request, Response } from 'express'
import { broadcastMessage, getConnectionStats } from '../chat-broadcaster.js'
import { logger } from '../logger.js'
import { notifyChatMessage } from '../slack.js'
import { validate, validateMessage } from '../validation.js'
import { getHistory, getThread, searchMessages, togglePin, getPinnedMessages, getConversationSummaries, msgId } from '../chat-store.js'
import { config } from '../config.js'
import type { AgentMessage } from '@widgetdc/contracts/orchestrator'

export const chatRouter = Router()

// ─── POST /message — Broadcast + persist ─────────────────────────────────────
chatRouter.post('/message', (req: Request, res: Response) => {
  const result = validate<AgentMessage>(validateMessage, req.body)

  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid AgentMessage payload',
        details: result.errors,
        status_code: 400,
      },
    })
    return
  }

  const msg = {
    ...result.data,
    id: msgId(),
    timestamp: new Date().toISOString(),
    thread_id: req.body.thread_id,
    parent_id: req.body.parent_id,
    files: req.body.files,
  }

  broadcastMessage(msg as any)
  notifyChatMessage(msg.from, msg.to, msg.message)
  logger.info({ from: msg.from, to: msg.to, type: msg.type }, 'Chat message broadcast')
  res.json({ success: true, data: { id: msg.id, timestamp: msg.timestamp } })
})

// ─── GET /history — Persistent message history ───────────────────────────────
chatRouter.get('/history', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
  const offset = parseInt(req.query.offset as string) || 0
  const target = req.query.target as string | undefined

  const messages = await getHistory(limit, offset, target)
  res.json({ success: true, data: { messages, total: messages.length, limit, offset } })
})

// ─── GET /threads/:id — Thread replies ───────────────────────────────────────
chatRouter.get('/threads/:id', async (req: Request, res: Response) => {
  const messages = await getThread(req.params.id)
  res.json({ success: true, data: { thread_id: req.params.id, messages, count: messages.length } })
})

// ─── POST /threads — Start a thread from any message ─────────────────────────
chatRouter.post('/threads', (req: Request, res: Response) => {
  const { parent_id, from, message, type } = req.body
  if (!parent_id || !from || !message) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'parent_id, from, message required' } })
    return
  }

  const threadMsg = {
    from,
    to: 'All',
    source: 'human',
    type: type || 'Message',
    message,
    timestamp: new Date().toISOString(),
    thread_id: parent_id, // replies are linked to the parent
    parent_id,
  }

  broadcastMessage(threadMsg as any)
  res.json({ success: true, data: { thread_id: parent_id, timestamp: threadMsg.timestamp } })
})

// ─── GET /search — Search messages ───────────────────────────────────────────
chatRouter.get('/search', async (req: Request, res: Response) => {
  const query = req.query.q as string
  if (!query || query.length < 2) {
    res.status(400).json({ success: false, error: { code: 'QUERY_TOO_SHORT', message: 'Search query must be at least 2 characters' } })
    return
  }
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
  const results = await searchMessages(query, limit)
  res.json({ success: true, data: { query, results, count: results.length } })
})

// ─── POST /pin — Pin/unpin a message ─────────────────────────────────────────
chatRouter.post('/pin', async (req: Request, res: Response) => {
  const { message_id, pin } = req.body
  if (!message_id) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'message_id required' } })
    return
  }
  await togglePin(message_id, pin !== false)
  res.json({ success: true, data: { message_id, pinned: pin !== false } })
})

// ─── GET /pinned — Get pinned messages ───────────────────────────────────────
chatRouter.get('/pinned', async (_req: Request, res: Response) => {
  const pinned = await getPinnedMessages()
  res.json({ success: true, data: { messages: pinned, count: pinned.length } })
})

// ─── GET /conversations — Conversation summaries for sidebar ─────────────────
chatRouter.get('/conversations', (_req: Request, res: Response) => {
  const conversations = getConversationSummaries()
  res.json({ success: true, data: { conversations } })
})

// ─── POST /capture — Knowledge Capture → SRAG ───────────────────────────────
chatRouter.post('/capture', async (req: Request, res: Response) => {
  const { message_ids, summary, tags } = req.body
  if (!message_ids?.length && !summary) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'message_ids or summary required' } })
    return
  }

  try {
    // Collect messages to capture
    let context = summary || ''
    if (message_ids?.length) {
      const all = await getHistory(2000, 0)
      const selected = all.filter(m => message_ids.includes(m.id))
      context = selected.map(m => `[${m.from}] ${m.message}`).join('\n')
      if (summary) context = summary + '\n\n---\nSource messages:\n' + context
    }

    // Send to backend SRAG for knowledge ingestion
    const sragRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify({
        tool: 'srag.ingest',
        args: {
          content: context,
          source: 'command-center-chat',
          tags: tags || ['chat-capture'],
          metadata: { captured_at: new Date().toISOString(), message_count: message_ids?.length || 0 },
        },
      }),
      signal: AbortSignal.timeout(30000),
    })

    const sragData = await sragRes.json().catch(() => null)

    // Broadcast capture confirmation
    broadcastMessage({
      from: 'System',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `📚 Knowledge captured: ${message_ids?.length || 0} messages → SRAG (tags: ${(tags || ['chat-capture']).join(', ')})`,
      timestamp: new Date().toISOString(),
    } as any)

    logger.info({ message_count: message_ids?.length, tags }, 'Chat knowledge captured to SRAG')
    res.json({ success: true, data: { captured: message_ids?.length || 1, srag_result: sragData } })
  } catch (err) {
    logger.error({ err: String(err) }, 'Knowledge capture failed')
    res.status(502).json({ success: false, error: { code: 'CAPTURE_FAILED', message: String(err) } })
  }
})

// ─── POST /summarize — AI-generated conversation summary ─────────────────────
chatRouter.post('/summarize', async (req: Request, res: Response) => {
  const { target, limit: msgLimit, thread_id } = req.body
  const limit = Math.min(msgLimit || 50, 200)

  try {
    let messages
    if (thread_id) {
      messages = await getThread(thread_id)
    } else {
      messages = await getHistory(limit, 0, target)
    }

    if (messages.length === 0) {
      res.json({ success: true, data: { summary: 'No messages to summarize.' } })
      return
    }

    // Build transcript
    const transcript = messages
      .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
      .map(m => `[${(m.timestamp || '').slice(11, 19)}] ${m.from}: ${m.message}`)
      .join('\n')
      .slice(0, 8000) // limit context size

    // Use LLM to summarize
    const llmRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify({
        tool: 'llm.chat',
        args: {
          model: 'deepseek-chat',
          messages: [{
            role: 'user',
            content: `Summarize this conversation concisely. Include key decisions, action items, and outcomes. Reply in the same language as the conversation.\n\n${transcript}`,
          }],
          max_tokens: 500,
        },
      }),
      signal: AbortSignal.timeout(60000),
    })

    const llmData = await llmRes.json().catch(() => null)
    const summary = llmData?.result?.content || llmData?.result?.message || llmData?.result || 'Summary generation failed'

    // Broadcast summary
    broadcastMessage({
      from: 'System',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `📋 **Conversation Summary**\n${typeof summary === 'string' ? summary : JSON.stringify(summary)}`,
      timestamp: new Date().toISOString(),
    } as any)

    res.json({ success: true, data: { summary, message_count: messages.length } })
  } catch (err) {
    logger.error({ err: String(err) }, 'Summarize failed')
    res.status(502).json({ success: false, error: { code: 'SUMMARIZE_FAILED', message: String(err) } })
  }
})

// ─── POST /debate — Multi-agent debate ───────────────────────────────────────
chatRouter.post('/debate', async (req: Request, res: Response) => {
  const { agents, topic, rounds } = req.body
  if (!agents?.length || agents.length < 2 || !topic) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'agents (2+) and topic required' } })
    return
  }

  const debateId = `debate-${Date.now().toString(36)}`
  const maxRounds = Math.min(rounds || 2, 5)

  // Announce debate start
  broadcastMessage({
    from: 'System',
    to: 'All',
    source: 'system',
    type: 'Message',
    message: `🎯 **Debate Started**: "${topic}"\nParticipants: ${agents.join(', ')} | Rounds: ${maxRounds}`,
    timestamp: new Date().toISOString(),
    thread_id: debateId,
  } as any)

  // Run debate asynchronously
  runDebate(debateId, agents, topic, maxRounds).catch(err => {
    logger.error({ err: String(err), debateId }, 'Debate failed')
    broadcastMessage({
      from: 'System',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `❌ Debate "${topic}" failed: ${err.message}`,
      timestamp: new Date().toISOString(),
      thread_id: debateId,
    } as any)
  })

  res.json({ success: true, data: { debate_id: debateId, agents, topic, rounds: maxRounds } })
})

async function runDebate(debateId: string, agents: string[], topic: string, rounds: number) {
  const responses: Array<{ agent: string; round: number; response: string }> = []

  for (let round = 1; round <= rounds; round++) {
    for (const agent of agents) {
      // Build context from previous responses
      const prevContext = responses.length > 0
        ? '\n\nPrevious arguments:\n' + responses.map(r => `[${r.agent} R${r.round}]: ${r.response}`).join('\n')
        : ''

      const prompt = round === 1
        ? `You are agent "${agent}" in a structured debate. Topic: "${topic}". Present your argument concisely (max 200 words).`
        : `You are agent "${agent}" in round ${round} of a debate on "${topic}". Review the previous arguments and provide your rebuttal or refined position (max 200 words).${prevContext}`

      try {
        const llmRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
          },
          body: JSON.stringify({
            tool: 'llm.chat',
            args: {
              model: 'deepseek-chat',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 300,
            },
          }),
          signal: AbortSignal.timeout(60000),
        })

        const data = await llmRes.json().catch(() => null)
        const response = data?.result?.content || data?.result?.message || data?.result || '(no response)'
        const responseStr = typeof response === 'string' ? response : JSON.stringify(response)
        responses.push({ agent, round, response: responseStr })

        broadcastMessage({
          from: agent,
          to: 'All',
          source: 'system',
          type: 'Message',
          message: `**[Round ${round}]** ${responseStr}`,
          timestamp: new Date().toISOString(),
          thread_id: debateId,
        } as any)
      } catch {
        responses.push({ agent, round, response: '(timeout)' })
      }
    }
  }

  // Final synthesis
  const allArgs = responses.map(r => `[${r.agent} R${r.round}]: ${r.response}`).join('\n')
  try {
    const synthRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify({
        tool: 'llm.chat',
        args: {
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: `Synthesize the following debate on "${topic}" into a final summary. Identify areas of agreement, disagreement, and recommended action. Be concise (max 300 words).\n\n${allArgs}` }],
          max_tokens: 400,
        },
      }),
      signal: AbortSignal.timeout(60000),
    })

    const synthData = await synthRes.json().catch(() => null)
    const synthesis = synthData?.result?.content || synthData?.result?.message || synthData?.result || '(synthesis failed)'

    broadcastMessage({
      from: 'System',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `📊 **Debate Synthesis**: "${topic}"\n\n${typeof synthesis === 'string' ? synthesis : JSON.stringify(synthesis)}`,
      timestamp: new Date().toISOString(),
      thread_id: debateId,
    } as any)
  } catch {}
}

// ─── GET /templates — Conversation workflow templates ─────────────────────────
const CHAT_TEMPLATES = [
  {
    id: 'incident-response',
    name: 'Incident Response',
    description: 'Alert agents, gather status, coordinate fix',
    steps: [
      { action: 'message', to: 'All', message: '🚨 INCIDENT: {topic} — all agents report status' },
      { action: 'command', command: '/chain health-check omega:graph.health command-center:graph.stats' },
      { action: 'message', to: 'omega', message: '@omega run SITREP for {topic}' },
    ],
  },
  {
    id: 'knowledge-harvest',
    name: 'Knowledge Harvest',
    description: 'Query SRAG + graph, capture insights',
    steps: [
      { action: 'command', command: '/rag {topic}' },
      { action: 'command', command: '/reason Analyze knowledge gaps for: {topic}' },
      { action: 'capture', tags: ['harvest', 'knowledge'] },
    ],
  },
  {
    id: 'agent-debrief',
    name: 'Agent Debrief',
    description: 'Collect status from all agents, summarize',
    steps: [
      { action: 'message', to: 'All', message: '📋 Debrief request: all agents report current status and findings' },
      { action: 'command', command: '/chain debrief omega:graph.stats' },
      { action: 'summarize' },
    ],
  },
  {
    id: 'competitive-analysis',
    name: 'Competitive Analysis',
    description: 'Cross-domain intelligence via debate + RAG',
    steps: [
      { action: 'command', command: '/rag {topic} competitive landscape' },
      { action: 'debate', agents: ['omega', 'master'], topic: '{topic}' },
      { action: 'capture', tags: ['competitive', 'analysis'] },
    ],
  },
  {
    id: 'daily-standup',
    name: 'Daily Standup',
    description: 'Quick health check + summary of yesterday',
    steps: [
      { action: 'command', command: '/chain standup command-center:graph.stats' },
      { action: 'summarize', limit: 100 },
      { action: 'message', to: 'All', message: '✅ Standup complete. Next actions logged.' },
    ],
  },
]

chatRouter.get('/templates', (_req: Request, res: Response) => {
  res.json({ success: true, data: { templates: CHAT_TEMPLATES } })
})

chatRouter.post('/templates/:id/run', async (req: Request, res: Response) => {
  const template = CHAT_TEMPLATES.find(t => t.id === req.params.id)
  if (!template) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Template ${req.params.id} not found` } })
    return
  }

  const topic = req.body.topic || 'general'

  // Announce template execution
  broadcastMessage({
    from: 'System',
    to: 'All',
    source: 'system',
    type: 'Message',
    message: `🚀 Running template: **${template.name}** — ${template.description} (topic: ${topic})`,
    timestamp: new Date().toISOString(),
  } as any)

  // Execute steps sequentially (fire-and-forget for async ops)
  let stepsRun = 0
  for (const step of template.steps) {
    if (step.action === 'message') {
      const msg = (step.message || '').replace(/\{topic\}/g, topic)
      broadcastMessage({
        from: 'command-center',
        to: step.to || 'All',
        source: 'system',
        type: 'Message',
        message: msg,
        timestamp: new Date().toISOString(),
      } as any)
      stepsRun++
    }
    // Other step types are hints for the frontend to execute
  }

  res.json({
    success: true,
    data: {
      template_id: template.id,
      name: template.name,
      topic,
      steps_total: template.steps.length,
      steps_executed: stepsRun,
      steps: template.steps.map(s => ({
        ...s,
        message: s.message?.replace(/\{topic\}/g, topic),
        command: s.command?.replace(/\{topic\}/g, topic),
        topic: s.topic?.replace(/\{topic\}/g, topic),
      })),
    },
  })
})

// ─── GET /ws-stats ───────────────────────────────────────────────────────────
chatRouter.get('/ws-stats', (_req: Request, res: Response) => {
  res.json({ success: true, data: getConnectionStats() })
})
