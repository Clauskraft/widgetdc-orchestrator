/**
 * routes/notebooks.ts — Consulting Notebook API (G4.20–G4.21)
 *
 * Interactive notebooks with query, insight, data, and action cells.
 * Cells are executed sequentially: query via MCP, insight via RLM,
 * data references previous cells, action is pass-through.
 *
 * Redis-backed with 30-day TTL.
 */
import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'
import { callCognitive } from '../cognitive-proxy.js'
import { v4 as uuid } from 'uuid'

export const notebookRouter = Router()

const NOTEBOOK_PREFIX = 'orchestrator:notebook:'
const NOTEBOOK_INDEX  = 'orchestrator:notebooks:index'
const TTL_SECONDS     = 2592000 // 30 days

/* ─── G4.20: NotebookSpec types (inline TypeBox-style) ───────────────────── */

interface QueryCell {
  type: 'query'
  id: string
  query: string
  result?: unknown
}

interface InsightCell {
  type: 'insight'
  id: string
  prompt: string
  content?: string
}

interface DataCell {
  type: 'data'
  id: string
  source_cell_id: string
  visualization?: 'table' | 'chart'
  result?: unknown
}

interface ActionCell {
  type: 'action'
  id: string
  recommendation: string
  linear_issue?: string
}

type NotebookCell = QueryCell | InsightCell | DataCell | ActionCell

interface NotebookSpec {
  $id: string
  $schema: 'widgetdc:notebook:v1'
  title: string
  cells: NotebookCell[]
  created_at: string
  updated_at: string
  created_by: string
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

async function storeNotebook(notebook: NotebookSpec): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  const key = `${NOTEBOOK_PREFIX}${notebook.$id}`
  try {
    await redis.set(key, JSON.stringify(notebook), 'EX', TTL_SECONDS)
    await redis.sadd(NOTEBOOK_INDEX, notebook.$id)
    return true
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis store failed for notebook')
    return false
  }
}

async function loadNotebook(id: string): Promise<NotebookSpec | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${NOTEBOOK_PREFIX}${id}`)
    return raw ? (JSON.parse(raw) as NotebookSpec) : null
  } catch (err) {
    logger.warn({ err: String(err), id }, 'Redis load failed for notebook')
    return null
  }
}

/* ─── Cell Detection ─────────────────────────────────────────────────────── */

function isCypher(text: string): boolean {
  const cypherKeywords = /^\s*(MATCH|CREATE|MERGE|RETURN|WITH|OPTIONAL|UNWIND|CALL)\b/i
  return cypherKeywords.test(text.trim())
}

/* ─── Cell Executors ─────────────────────────────────────────────────────── */

async function executeQueryCell(cell: QueryCell, _context: string): Promise<QueryCell> {
  const query = cell.query.trim()
  try {
    if (isCypher(query)) {
      const result = await callMcpTool({
        toolName: 'graph.read_cypher',
        args: { query, params: {} },
        callId: uuid(),
        timeoutMs: 15000,
      })
      cell.result = result.status === 'success' ? result.result : { error: result.error_message }
    } else {
      // Natural language query via kg_rag
      const result = await callMcpTool({
        toolName: 'kg_rag.query',
        args: { question: query, max_evidence: 10 },
        callId: uuid(),
        timeoutMs: 20000,
      })
      cell.result = result.status === 'success' ? result.result : { error: result.error_message }
    }
  } catch (err) {
    cell.result = { error: String(err) }
  }
  return cell
}

async function executeInsightCell(cell: InsightCell, context: string): Promise<InsightCell> {
  try {
    const prompt = cell.prompt + (context ? `\n\nContext from previous cells:\n${context}` : '')
    const result = await callCognitive('reason', {
      prompt,
      context: { source: 'notebook-insight' },
      agent_id: 'notebook-executor',
    }, 45000)
    cell.content = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  } catch (err) {
    cell.content = `Insight generation failed: ${String(err)}`
  }
  return cell
}

function executeDataCell(cell: DataCell, cellResults: Map<string, unknown>): DataCell {
  const sourceResult = cellResults.get(cell.source_cell_id)
  if (!sourceResult) {
    cell.result = { error: `Source cell "${cell.source_cell_id}" not found or has no result` }
    return cell
  }

  // Format based on visualization preference
  if (cell.visualization === 'chart') {
    // Extract chart-friendly data
    if (Array.isArray(sourceResult)) {
      const columns = sourceResult.length > 0 ? Object.keys(sourceResult[0] as Record<string, unknown>) : []
      cell.result = { type: 'chart', columns, data: sourceResult }
    } else {
      cell.result = { type: 'chart', data: sourceResult }
    }
  } else {
    // Table format (default)
    if (Array.isArray(sourceResult)) {
      const columns = sourceResult.length > 0 ? Object.keys(sourceResult[0] as Record<string, unknown>) : []
      const rows = sourceResult.map(r => {
        const row = r as Record<string, unknown>
        return columns.map(c => row[c])
      })
      cell.result = { type: 'table', columns, rows, row_count: rows.length }
    } else {
      cell.result = { type: 'table', data: sourceResult }
    }
  }
  return cell
}

/* ─── G4.21: POST /execute — Execute notebook cells ──────────────────────── */

notebookRouter.post('/execute', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>

  if (!body.title || !Array.isArray(body.cells) || body.cells.length === 0) {
    res.status(400).json({ success: false, error: 'Missing required fields: title, cells (non-empty array)' })
    return
  }

  const id = `widgetdc:notebook:${randomUUID()}`
  const now = new Date().toISOString()
  const cells = body.cells as NotebookCell[]

  // Assign IDs to cells that don't have one
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].id) {
      cells[i].id = `cell-${i}`
    }
  }

  logger.info({ id, title: body.title, cellCount: cells.length }, 'Notebook execution started')

  // Execute cells sequentially, building context
  const cellResults = new Map<string, unknown>()
  let context = ''

  for (const cell of cells) {
    switch (cell.type) {
      case 'query': {
        await executeQueryCell(cell, context)
        cellResults.set(cell.id, cell.result)
        const resultStr = JSON.stringify(cell.result ?? '').slice(0, 500)
        context += `\n[Query "${cell.query.slice(0, 80)}"]: ${resultStr}`
        break
      }
      case 'insight': {
        await executeInsightCell(cell, context)
        cellResults.set(cell.id, cell.content)
        context += `\n[Insight]: ${(cell.content ?? '').slice(0, 300)}`
        break
      }
      case 'data': {
        executeDataCell(cell, cellResults)
        cellResults.set(cell.id, cell.result)
        break
      }
      case 'action': {
        // Pass-through — human-authored recommendations
        cellResults.set(cell.id, cell.recommendation)
        break
      }
    }
  }

  const notebook: NotebookSpec = {
    $id: id,
    $schema: 'widgetdc:notebook:v1',
    title: String(body.title),
    cells,
    created_at: now,
    updated_at: now,
    created_by: String(body.created_by ?? 'anonymous'),
  }

  // Store in Redis
  const stored = await storeNotebook(notebook)
  if (!stored) {
    logger.warn({ id }, 'Notebook executed but Redis storage failed')
  }

  logger.info({ id, title: notebook.title, cellsExecuted: cells.length }, 'Notebook execution complete')

  res.status(201).json({ success: true, notebook })
})

/* ─── GET /:id — Fetch stored notebook ───────────────────────────────────── */

notebookRouter.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id

  // Check for .md suffix — route to markdown export
  if (id.endsWith('.md')) {
    return renderNotebookMarkdown(req, res, id.replace(/\.md$/, ''))
  }

  const notebook = await loadNotebook(id)
  if (!notebook) {
    res.status(404).json({ success: false, error: 'Notebook not found' })
    return
  }

  res.json({ success: true, notebook })
})

/* ─── Markdown export with widgetdc-query codeblocks ─────────────────────── */

async function renderNotebookMarkdown(_req: Request, res: Response, id: string): Promise<void> {
  const notebook = await loadNotebook(id)
  if (!notebook) {
    res.status(404).json({ success: false, error: 'Notebook not found' })
    return
  }

  const lines: string[] = []
  lines.push(`# ${notebook.title}`)
  lines.push('')
  lines.push(`> Notebook: ${notebook.$id} | Created: ${notebook.created_at} | By: ${notebook.created_by}`)
  lines.push('')

  for (const cell of notebook.cells) {
    switch (cell.type) {
      case 'query': {
        const q = cell as QueryCell
        lines.push('```widgetdc-query')
        lines.push(isCypher(q.query) ? q.query : `? ${q.query}`)
        lines.push('```')
        lines.push('')
        if (q.result) {
          lines.push('> Last result:')
          const resultStr = typeof q.result === 'string' ? q.result : JSON.stringify(q.result, null, 2)
          lines.push(`> ${resultStr.slice(0, 300).replace(/\n/g, '\n> ')}`)
          lines.push('')
        }
        break
      }
      case 'insight': {
        const i = cell as InsightCell
        lines.push(`## Insight: ${i.prompt.slice(0, 80)}`)
        lines.push('')
        if (i.content) {
          lines.push(i.content)
          lines.push('')
        }
        break
      }
      case 'data': {
        const d = cell as DataCell
        lines.push(`### Data (from ${d.source_cell_id})`)
        lines.push('')
        if (d.result && typeof d.result === 'object') {
          const r = d.result as Record<string, unknown>
          if (r.type === 'table' && Array.isArray(r.columns) && Array.isArray(r.rows)) {
            const cols = r.columns as string[]
            const rows = r.rows as unknown[][]
            lines.push(`| ${cols.join(' | ')} |`)
            lines.push(`| ${cols.map(() => '---').join(' | ')} |`)
            for (const row of rows.slice(0, 50)) {
              lines.push(`| ${(row as unknown[]).map(String).join(' | ')} |`)
            }
            lines.push('')
          } else {
            lines.push('```json')
            lines.push(JSON.stringify(d.result, null, 2).slice(0, 500))
            lines.push('```')
            lines.push('')
          }
        }
        break
      }
      case 'action': {
        const a = cell as ActionCell
        lines.push(`### Action`)
        lines.push('')
        lines.push(`- [ ] ${a.recommendation}`)
        if (a.linear_issue) {
          lines.push(`  - Linear: ${a.linear_issue}`)
        }
        lines.push('')
        break
      }
    }
  }

  res.type('text/markdown').send(lines.join('\n'))
}
