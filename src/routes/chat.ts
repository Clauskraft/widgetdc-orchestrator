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
import { callCognitive, isRlmAvailable } from '../cognitive-proxy.js'
import { executeChain } from '../chain-engine.js'
import { chatLLM } from '../llm-proxy.js'
import { AgentRegistry } from '../agent-registry.js'
import type { AgentMessage } from '@widgetdc/contracts/orchestrator'

// ─── Memory helpers — persist to multiple memory layers ──────────────────────

/** Call MCP tool via backend */
async function mcpCall(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
    },
    body: JSON.stringify({ tool, args }),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json().catch(() => null)
  return data?.result ?? data
}

/** Store to episodic memory via memory_operation RECORD_EPISODE */
async function storeEpisode(title: string, description: string, events: string[], outcome: string, tags: string[]): Promise<void> {
  try {
    await mcpCall('memory_operation', {
      action: 'RECORD_EPISODE',
      data: {
        title,
        description,
        events,
        outcome,
        lessons: [outcome],
        tags,
        timestamp: new Date().toISOString(),
      },
    })
    logger.info({ title, tags }, 'Episode stored to episodic memory')
  } catch (err) {
    logger.warn({ err: String(err), title }, 'Episodic memory store failed (non-fatal)')
  }
}

/** Store to graph memory via graph.write_cypher (AgentMemory node) */
async function storeGraphMemory(agentId: string, type: string, content: string, tags: string[]): Promise<void> {
  try {
    const cypher = `CREATE (m:AgentMemory {
      agent_id: $agent_id,
      type: $type,
      content: $content,
      tags: $tags,
      created_at: datetime(),
      source: 'command-center-chat'
    }) RETURN m`
    await mcpCall('graph.write_cypher', {
      query: cypher,
      parameters: { agent_id: agentId, type, content: content.slice(0, 4000), tags },
    })
    logger.info({ agentId, type, tags }, 'Memory stored to Neo4j graph')
  } catch (err) {
    logger.warn({ err: String(err), type }, 'Graph memory store failed (non-fatal)')
  }
}

/** Store to SRAG semantic memory */
async function storeSRAG(content: string, tags: string[], source: string): Promise<void> {
  try {
    await mcpCall('srag.ingest', {
      content,
      source,
      tags,
      metadata: { captured_at: new Date().toISOString() },
    })
    logger.info({ tags, source }, 'Content stored to SRAG')
  } catch (err) {
    logger.warn({ err: String(err) }, 'SRAG store failed (non-fatal)')
  }
}

/** Persist to all memory layers (best-effort, non-blocking) */
function persistToMemory(opts: {
  title: string
  content: string
  tags: string[]
  agentId?: string
  type?: string
  events?: string[]
}): void {
  const { title, content, tags, agentId = 'command-center', type = 'insight', events = [] } = opts
  // Fire all three in parallel, don't await
  Promise.allSettled([
    storeEpisode(title, content, events.length ? events : [content.slice(0, 500)], title, tags),
    storeGraphMemory(agentId, type, content, tags),
    storeSRAG(content, [...tags, 'auto-memory'], 'command-center-chat'),
  ]).then(results => {
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    logger.debug({ succeeded, total: 3, title }, 'Memory persistence completed')
  })
}

// ─── Agent Auto-Reply — AI-powered agent responses ──────────────────────────

/** Agent persona system prompts based on capabilities */
const AGENT_PERSONAS: Record<string, string> = {
  omega: `Du er Omega Sentinel — omniscient architecture guardian for WidgeTDC. Du svarer kort og præcist på dansk. Du overvåger alle services, kontrakter og arkitektur. Du har adgang til Neo4j graph, SRAG, compliance matrix og alle agents. Svar altid med konkrete facts og handlinger.`,
  trident: `Du er Trident Security — threat hunter og OSINT specialist. Du svarer på dansk. Du analyserer trusler, angrebsflader, CVR-data, certstream og CTI. Vær direkte og konkret.`,
  prometheus: `Du er Prometheus Engine — code analysis og reinforcement learning specialist. Du svarer på dansk. Du analyserer kode, embeddings, og governance patterns.`,
  master: `Du er Master Orchestrator — central koordinator for hele WidgeTDC agent-swarm. Du svarer på dansk. Du delegerer, koordinerer, og holder overblik over alle aktive opgaver.`,
  graph: `Du er Neo4j Graph Agent. Du svarer på dansk. Du kender grafstrukturen, Cypher queries, og kan analysere relationer mellem entiteter i knowledge graph.`,
  consulting: `Du er Consulting Intelligence — specialist i indsigter, mønstre og forretningsmæssig analyse. Du svarer på dansk med konkrete anbefalinger.`,
  legal: `Du er Legal & Compliance — specialist i retsinformation, EU-funding, GDPR, og blast radius analyser. Du svarer på dansk.`,
  rlm: `Du er RLM Reasoning Engine — deep reasoning, planlægning og context folding specialist. Du svarer på dansk med strukturerede analyser.`,
  harvest: `Du er Harvest Collector — web crawling, data ingestion, M365, SharePoint specialist. Du svarer på dansk.`,
  nexus: `Du er Nexus Analyzer — dekomponering, gap-analyse og idégenerering specialist. Du svarer på dansk med strukturerede nedbrydninger og muligheder.`,
  autonomous: `Du er Autonomous Swarm — GraphRAG, state graphs og evolution specialist. Du svarer på dansk.`,
  cma: `Du er Context Memory Agent — memory management, kontekst-retrieval og vidensstyring. Du svarer på dansk.`,
  docgen: `Du er DocGen Factory — PowerPoint, Word, Excel og diagram specialist. Du svarer på dansk.`,
  custodian: `Du er Custodian Guardian — chaos testing, patrol og governance specialist. Du svarer på dansk.`,
  roma: `Du er Roma Self-Healer — self-healing, incident response specialist. Du svarer på dansk.`,
  vidensarkiv: `Du er Vidensarkiv — knowledge search og file management specialist. Du svarer på dansk.`,
  'the-snout': `Du er The Snout OSINT — domain intel, email intel og extraction specialist. Du svarer på dansk.`,
  'llm-router': `Du er LLM Cost Router — multi-model routing, cost tracking og budget optimering. Du svarer på dansk.`,
}

/** Generate AI reply on behalf of an agent */
async function agentAutoReply(agentId: string, userMessage: string, from: string, threadId?: string): Promise<void> {
  const agentEntry = AgentRegistry.get(agentId)
  const displayName = agentEntry?.handshake.display_name || agentId
  const capabilities = agentEntry?.handshake.capabilities || []

  // Build system prompt from persona or generate generic
  const persona = AGENT_PERSONAS[agentId] ||
    `Du er ${displayName} med capabilities: ${capabilities.join(', ')}. Du svarer kort og præcist på dansk.`

  // Get recent conversation context (last 10 messages)
  try {
    const recentMsgs = await getHistory(10, 0)
    const context = recentMsgs
      .reverse()
      .map(m => `[${m.from}→${m.to}] ${(m.message || '').slice(0, 200)}`)
      .join('\n')

    const messages = [
      { role: 'system' as const, content: `${persona}\n\nDine capabilities: ${capabilities.join(', ')}\n\nSeneste samtale-kontekst:\n${context}` },
      { role: 'user' as const, content: `${from} siger: ${userMessage}` },
    ]

    const result = await chatLLM({
      provider: 'deepseek',
      messages,
      max_tokens: 800,
      temperature: 0.7,
    })

    // Broadcast agent's reply
    broadcastMessage({
      from: agentId,
      to: from as any,
      source: 'agent' as any,
      type: 'Message',
      message: result.content,
      timestamp: new Date().toISOString(),
      ...(threadId ? { thread_id: threadId } : {}),
      metadata: { provider: result.provider, model: result.model, duration_ms: result.duration_ms },
    } as any)

    logger.info({ agent: agentId, from, model: result.model, ms: result.duration_ms }, 'Agent auto-reply sent')
  } catch (err) {
    logger.error({ err: String(err), agent: agentId }, 'Agent auto-reply failed')
    broadcastMessage({
      from: agentId,
      to: from as any,
      source: 'system' as any,
      type: 'Message',
      message: `⚠️ ${displayName} kunne ikke svare: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toISOString(),
    } as any)
  }
}

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

  // Trigger agent auto-reply if message targets a specific registered agent
  const noReply = req.body.no_reply === true
  if (!noReply && msg.to && msg.to !== 'All' && msg.source !== 'system' && msg.source !== 'agent') {
    const targetAgent = AgentRegistry.get(msg.to)
    if (targetAgent) {
      // Fire-and-forget — don't block the response
      agentAutoReply(msg.to, msg.message, msg.from, req.body.thread_id).catch(() => {})
    }
  }

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

    // Persist summary to all memory layers
    const summaryStr = typeof summary === 'string' ? summary : JSON.stringify(summary)
    persistToMemory({
      title: `Chat Summary: ${target || thread_id || 'general'}`,
      content: summaryStr,
      tags: ['chat-summary', 'auto-summary', ...(target ? [`conversation:${target}`] : [])],
      type: 'summary',
      events: messages.slice(0, 10).map(m => `[${m.from}] ${(m.message || '').slice(0, 100)}`),
    })

    res.json({ success: true, data: { summary, message_count: messages.length, persisted: true } })
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

    const synthStr = typeof synthesis === 'string' ? synthesis : JSON.stringify(synthesis)

    broadcastMessage({
      from: 'System',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `📊 **Debate Synthesis**: "${topic}"\n\n${synthStr}`,
      timestamp: new Date().toISOString(),
      thread_id: debateId,
    } as any)

    // Persist debate to all memory layers
    const debateContent = `Debate: "${topic}"\nParticipants: ${agents.join(', ')}\nRounds: ${rounds}\n\nArguments:\n${allArgs}\n\nSynthesis:\n${synthStr}`
    persistToMemory({
      title: `Debate: ${topic}`,
      content: debateContent,
      tags: ['debate', 'consensus', ...agents.map(a => `agent:${a}`)],
      type: 'debate',
      events: responses.map(r => `[${r.agent} R${r.round}] ${r.response.slice(0, 100)}`),
    })
  } catch {}
}

// ─── POST /think — Sequential thinking via chain engine ──────────────────────
chatRouter.post('/think', async (req: Request, res: Response) => {
  const { question, depth, steps: customSteps } = req.body
  if (!question) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'question required' } })
    return
  }

  const thinkId = `think-${Date.now().toString(36)}`
  const thinkDepth = Math.min(depth || 3, 5)

  // Announce thinking
  broadcastMessage({
    from: 'System',
    to: 'All',
    source: 'system',
    type: 'Message',
    message: `🧠 **Sequential Thinking** started: "${question}" (depth: ${thinkDepth})`,
    timestamp: new Date().toISOString(),
    thread_id: thinkId,
  } as any)

  // Build chain: reason → plan → analyze → fold (synthesize)
  const defaultSteps = [
    { agent_id: 'rlm', cognitive_action: 'reason', prompt: `Deep reason about: ${question}`, timeout_ms: 60000 },
    { agent_id: 'rlm', cognitive_action: 'plan', prompt: `Based on reasoning: {{prev}}\n\nCreate actionable plan for: ${question}`, timeout_ms: 60000 },
    { agent_id: 'rlm', cognitive_action: 'analyze', prompt: `Analyze this plan for gaps and improvements: {{prev}}\n\nOriginal question: ${question}`, timeout_ms: 60000 },
  ]

  // Add extra depth steps if requested
  if (thinkDepth >= 4) {
    defaultSteps.push({ agent_id: 'rlm', cognitive_action: 'fold', prompt: `Synthesize all findings into a concise conclusion: {{prev}}\n\nOriginal question: ${question}`, timeout_ms: 60000 })
  }
  if (thinkDepth >= 5) {
    defaultSteps.push({ agent_id: 'rlm', cognitive_action: 'enrich', prompt: `Enrich with additional context and recommendations: {{prev}}\n\nOriginal question: ${question}`, timeout_ms: 60000 })
  }

  const steps = customSteps || defaultSteps

  // Execute as sequential chain
  runThink(thinkId, question, steps).catch(err => {
    logger.error({ err: String(err), thinkId }, 'Think failed')
    broadcastMessage({
      from: 'System',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `❌ Thinking failed: ${err.message}`,
      timestamp: new Date().toISOString(),
      thread_id: thinkId,
    } as any)
  })

  res.json({ success: true, data: { think_id: thinkId, question, depth: thinkDepth, steps: steps.length } })
})

async function runThink(thinkId: string, question: string, steps: any[]) {
  const chainDef = {
    name: `think: ${question.slice(0, 50)}`,
    mode: 'sequential' as const,
    steps,
  }

  const execution = await executeChain(chainDef)

  // Broadcast each step result in the thread
  for (const result of execution.results) {
    const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)
    broadcastMessage({
      from: 'RLM-Engine',
      to: 'All',
      source: 'system',
      type: 'Message',
      message: `**[${result.action}]** ${output.slice(0, 3000)}`,
      timestamp: new Date().toISOString(),
      thread_id: thinkId,
    } as any)
  }

  // Final result
  const finalOutput = typeof execution.final_output === 'string'
    ? execution.final_output
    : JSON.stringify(execution.final_output, null, 2)

  broadcastMessage({
    from: 'System',
    to: 'All',
    source: 'system',
    type: 'Message',
    message: `🧠 **Thinking Complete**: "${question}"\n\n${(finalOutput || '(no result)').slice(0, 3000)}\n\n_${execution.steps_completed}/${execution.steps_total} steps in ${execution.duration_ms}ms_`,
    timestamp: new Date().toISOString(),
    thread_id: thinkId,
  } as any)

  // Persist to all memory layers
  const allOutputs = execution.results.map(r => {
    const o = typeof r.output === 'string' ? r.output : JSON.stringify(r.output)
    return `[${r.action}]: ${o}`
  }).join('\n\n')

  persistToMemory({
    title: `Sequential Thinking: ${question.slice(0, 100)}`,
    content: `Question: ${question}\n\nThinking Steps:\n${allOutputs}\n\nConclusion:\n${finalOutput || '(no result)'}`,
    tags: ['thinking', 'sequential', 'cognitive'],
    type: 'thinking',
    events: execution.results.map(r => `${r.action}: ${r.status} (${r.duration_ms}ms)`),
  })
}

// ─── POST /remember — Store to all memory layers explicitly ──────────────────
chatRouter.post('/remember', async (req: Request, res: Response) => {
  const { content, title, tags, message_ids } = req.body
  if (!content && !message_ids?.length) {
    res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'content or message_ids required' } })
    return
  }

  let memContent = content || ''
  if (message_ids?.length) {
    const all = await getHistory(2000, 0)
    const selected = all.filter((m: any) => message_ids.includes(m.id))
    const transcript = selected.map((m: any) => `[${m.from}] ${m.message}`).join('\n')
    memContent = content ? `${content}\n\n---\n${transcript}` : transcript
  }

  const memTitle = title || `Chat Memory: ${memContent.slice(0, 60)}`
  const memTags = tags || ['manual-remember']

  persistToMemory({
    title: memTitle,
    content: memContent,
    tags: memTags,
    type: 'memory',
  })

  broadcastMessage({
    from: 'System',
    to: 'All',
    source: 'system',
    type: 'Message',
    message: `🧠 Remembered: "${memTitle}" → Episodic + Graph + SRAG (tags: ${memTags.join(', ')})`,
    timestamp: new Date().toISOString(),
  } as any)

  res.json({ success: true, data: { title: memTitle, tags: memTags, layers: ['episodic', 'graph', 'srag'] } })
})

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
