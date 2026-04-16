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

function parseTranscript(rawContent: string, transcriptPath: string): FoldOutput {
  const lines = rawContent.split('\n').filter(Boolean)
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

  // Pass 1: high-confidence regex extraction
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
    .map(m => m.text.slice(0, 200))
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
    deploy_events: deployEvents,
  }
}

// ─── Insight extractor (Inventor session-fold-extractor-v1, score 0.76) ──────
// Scores assistant messages for knowledge value and surfaces high-signal content.

const DECISION_KEYWORDS = ['decided', 'chosen', 'rejected', 'because', 'tradeoff', 'valgt', 'besluttet']
const NUMERIC_PATTERN = /\b\d+(\.\d+)?%?\b/

function extractInsights(messages: Array<{ role: string; text: string }>): Array<{ title: string; summary: string; score: number }> {
  const insights: Array<{ title: string; summary: string; score: number }> = []

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    const content = msg.text
    let score = 0

    if (content.length > 500) score += 0.2
    if (content.includes('```')) score += 0.3
    if (DECISION_KEYWORDS.some(kw => content.toLowerCase().includes(kw))) score += 0.3
    if (NUMERIC_PATTERN.test(content)) score += 0.2
    score = Math.min(score, 1.0)

    if (score >= 0.6) {
      const firstSentence = content.match(/^[^.!?\n]+[.!?]/)
      const title = (firstSentence ? firstSentence[0] : content.slice(0, 80)).slice(0, 80).trim()
      const summary = content.slice(0, 300).trim()
      insights.push({ title, summary, score })
    }
  }

  return insights
}

export async function foldSession(transcriptPath: string): Promise<FoldOutput> {
  let raw: string
  try {
    raw = await fs.promises.readFile(transcriptPath, 'utf8')
  } catch {
    throw new Error(`Transcript not found: ${transcriptPath}`)
  }
  const fold = parseTranscript(raw, transcriptPath)

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
    metadata: fold as unknown as Record<string, unknown>,
  })

  logger.info({ session_id: fold.session_id, commits: fold.commits.length }, 'SessionFoldAdapter: emitted to KnowledgeBus')

  // Extract and emit high-value insights as individual KB candidates
  const rawMessages = raw.split('\n').filter(Boolean).flatMap(line => {
    try {
      const obj = JSON.parse(line)
      const role = obj.message?.role || obj.role
      if (role !== 'assistant') return []
      const content = obj.message?.content || obj.content
      const text = Array.isArray(content)
        ? content.filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join(' ')
        : String(content || '')
      return text.length > 10 ? [{ role, text }] : []
    } catch { return [] }
  })

  const insights = extractInsights(rawMessages)
  for (const insight of insights.slice(0, 5)) { // max 5 insights per session
    emitKnowledge({
      source: 'session_fold',
      title: insight.title || `Insight from ${fold.session_id}`,
      content: insight.summary,
      summary: insight.summary,
      score: insight.score,
      tags: ['session-insight', fold.session_id],
      repo: 'widgetdc-orchestrator',
    })
  }

  if (insights.length > 0) {
    logger.info({ session_id: fold.session_id, insights: insights.length }, 'SessionFoldAdapter: emitted high-value insights')
  }

  return fold
}
