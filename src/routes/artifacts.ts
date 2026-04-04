/**
 * routes/artifacts.ts — Artifact Broker API (G4.2–G4.5)
 *
 * CRUD for AnalysisArtifact objects with Obsidian Markdown + HTML export.
 * Redis-backed with 30-day TTL, soft-delete via status:"archived".
 */
import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

export const artifactRouter = Router()

const ARTIFACT_PREFIX = 'orchestrator:artifact:'
const ARTIFACT_INDEX  = 'orchestrator:artifacts:index'
const TTL_SECONDS     = 2592000 // 30 days

/* ─── Types ───────────────────────────────────────────────────────────────── */

type BlockType = 'text' | 'table' | 'chart' | 'kpi_card' | 'cypher' | 'mermaid' | 'deep_link'

interface ArtifactBlock {
  type: BlockType
  label?: string
  content: unknown // varies per type
}

interface AnalysisArtifact {
  $id: string
  $schema: string
  title: string
  source: string
  blocks: ArtifactBlock[]
  graph_refs?: string[]
  tags?: string[]
  status: 'draft' | 'published' | 'archived'
  created_by: string
  created_at: string
  updated_at: string
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

// v4.0.6: export for tool-executor access (LIN-618)
export async function storeArtifact(artifact: AnalysisArtifact): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  const key = `${ARTIFACT_PREFIX}${artifact.$id}`
  try {
    await redis.set(key, JSON.stringify(artifact), 'EX', TTL_SECONDS)
    await redis.sadd(ARTIFACT_INDEX, artifact.$id)
    return true
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis store failed for artifact')
    return false
  }
}

export async function loadArtifact(id: string): Promise<AnalysisArtifact | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${ARTIFACT_PREFIX}${id}`)
    return raw ? (JSON.parse(raw) as AnalysisArtifact) : null
  } catch (err) {
    logger.warn({ err: String(err), id }, 'Redis load failed for artifact')
    return null
  }
}

export async function listAllArtifactIds(): Promise<string[]> {
  const redis = getRedis()
  if (!redis) return []
  try {
    return await redis.smembers(ARTIFACT_INDEX)
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis list failed for artifact index')
    return []
  }
}

/* ─── G4.2: POST / — Create artifact ─────────────────────────────────────── */

artifactRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>

  if (!body.title || !body.source || !Array.isArray(body.blocks) || !body.created_by) {
    res.status(400).json({ success: false, error: 'Missing required fields: title, source, blocks, created_by' })
    return
  }

  const id = `widgetdc:artifact:${randomUUID()}`
  const now = new Date().toISOString()

  const artifact: AnalysisArtifact = {
    $id: id,
    $schema: 'widgetdc:analysis:v1',
    title: String(body.title),
    source: String(body.source),
    blocks: body.blocks as ArtifactBlock[],
    graph_refs: Array.isArray(body.graph_refs) ? body.graph_refs as string[] : undefined,
    tags: Array.isArray(body.tags) ? body.tags as string[] : undefined,
    status: 'draft',
    created_by: String(body.created_by),
    created_at: now,
    updated_at: now,
  }

  const stored = await storeArtifact(artifact)
  if (!stored) {
    res.status(503).json({ success: false, error: 'Redis not available' })
    return
  }

  logger.info({ id: artifact.$id, title: artifact.title }, 'Artifact created')
  res.status(201).json({ success: true, artifact })
})

/* ─── G4.2: GET / — List artifacts ────────────────────────────────────────── */

artifactRouter.get('/', async (req: Request, res: Response) => {
  const statusFilter = req.query.status as string | undefined
  const tagFilter = req.query.tag as string | undefined
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200)
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0)

  const allIds = await listAllArtifactIds()
  const redis = getRedis()

  if (!redis) {
    res.json({ artifacts: [], total: 0, limit, offset })
    return
  }

  // Load all artifacts (pipeline for efficiency)
  const artifacts: AnalysisArtifact[] = []
  try {
    const pipeline = redis.pipeline()
    for (const id of allIds) {
      pipeline.get(`${ARTIFACT_PREFIX}${id}`)
    }
    const results = await pipeline.exec()
    if (results) {
      for (const [err, raw] of results) {
        if (!err && typeof raw === 'string') {
          try {
            artifacts.push(JSON.parse(raw) as AnalysisArtifact)
          } catch { /* skip malformed */ }
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis pipeline failed for artifact list')
  }

  // Filter
  let filtered = artifacts.filter(a => a.status !== 'archived')
  if (statusFilter) {
    filtered = filtered.filter(a => a.status === statusFilter)
  }
  if (tagFilter) {
    filtered = filtered.filter(a => a.tags?.includes(tagFilter))
  }

  // Sort newest first
  filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)

  res.json({ artifacts: page, total, limit, offset })
})

/* ─── G4.2: GET /:id — Single artifact ────────────────────────────────────── */

artifactRouter.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id

  // Check for .md or .html suffix — route to export handlers
  if (id.endsWith('.md')) {
    return renderMarkdown(req, res, id.replace(/\.md$/, ''))
  }
  if (id.endsWith('.html')) {
    return renderHtml(req, res, id.replace(/\.html$/, ''))
  }

  const artifact = await loadArtifact(id)
  if (!artifact) {
    res.status(404).json({ success: false, error: 'Artifact not found' })
    return
  }

  res.json(artifact)
})

/* ─── G4.2: PUT /:id — Update artifact ────────────────────────────────────── */

artifactRouter.put('/:id', async (req: Request, res: Response) => {
  const id = req.params.id
  const existing = await loadArtifact(id)

  if (!existing) {
    res.status(404).json({ success: false, error: 'Artifact not found' })
    return
  }

  const body = req.body as Partial<AnalysisArtifact>

  // Merge allowed fields
  if (body.title) existing.title = body.title
  if (body.source) existing.source = body.source
  if (body.blocks) existing.blocks = body.blocks
  if (body.graph_refs !== undefined) existing.graph_refs = body.graph_refs
  if (body.tags !== undefined) existing.tags = body.tags
  if (body.status && ['draft', 'published', 'archived'].includes(body.status)) {
    existing.status = body.status
  }
  existing.updated_at = new Date().toISOString()

  const stored = await storeArtifact(existing)
  if (!stored) {
    res.status(503).json({ success: false, error: 'Redis not available' })
    return
  }

  logger.info({ id, title: existing.title }, 'Artifact updated')
  res.json({ success: true, artifact: existing })
})

/* ─── G4.2: DELETE /:id — Soft delete (archive) ───────────────────────────── */

artifactRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id
  const existing = await loadArtifact(id)

  if (!existing) {
    res.status(404).json({ success: false, error: 'Artifact not found' })
    return
  }

  existing.status = 'archived'
  existing.updated_at = new Date().toISOString()

  const stored = await storeArtifact(existing)
  if (!stored) {
    res.status(503).json({ success: false, error: 'Redis not available' })
    return
  }

  logger.info({ id }, 'Artifact archived')
  res.json({ success: true })
})

/* ─── G4.3: Obsidian Markdown export ──────────────────────────────────────── */

function trendEmoji(trend?: string): string {
  if (trend === 'up') return '↑'
  if (trend === 'down') return '↓'
  return '→'
}

function blockToMarkdown(block: ArtifactBlock): string {
  const c = block.content as Record<string, unknown>

  switch (block.type) {
    case 'text':
      return String(c.body ?? c.text ?? c ?? '')

    case 'table': {
      const headers = (c.headers ?? c.columns ?? []) as string[]
      const rows = (c.rows ?? c.data ?? []) as unknown[][]
      if (headers.length === 0) return ''
      const headerLine = `| ${headers.join(' | ')} |`
      const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`
      const dataLines = rows.map(r => `| ${(r as unknown[]).map(String).join(' | ')} |`)
      return [headerLine, separatorLine, ...dataLines].join('\n')
    }

    case 'chart':
      return '```widgetdc-query\n' +
        `type: ${String(c.chart_type ?? c.type ?? 'bar')}\n` +
        `data: ${JSON.stringify(c.data ?? c)}\n` +
        '```'

    case 'cypher':
      return '```widgetdc-query\n' +
        `cypher: ${String(c.query ?? c.cypher ?? c)}\n` +
        '```'

    case 'mermaid':
      return '```mermaid\n' +
        String(c.diagram ?? c.code ?? c) + '\n' +
        '```'

    case 'kpi_card': {
      const label = String(c.label ?? block.label ?? 'KPI')
      const value = String(c.value ?? '')
      const trend = trendEmoji(c.trend as string | undefined)
      return `**${label}**: ${value} ${trend}`
    }

    case 'deep_link': {
      const label = String(c.label ?? c.title ?? 'Link')
      const uri = String(c.uri ?? c.url ?? c.href ?? '#')
      return `[${label}](${uri})`
    }

    default:
      return `<!-- unknown block type: ${block.type} -->\n${JSON.stringify(c, null, 2)}`
  }
}

async function renderMarkdown(req: Request, res: Response, id: string): Promise<void> {
  const artifact = await loadArtifact(id)
  if (!artifact) {
    res.status(404).json({ success: false, error: 'Artifact not found' })
    return
  }

  const lines: string[] = []
  lines.push(`# ${artifact.title}`)
  lines.push('')
  lines.push(`> Source: ${artifact.source} | Status: ${artifact.status} | Created: ${artifact.created_at}`)
  if (artifact.tags?.length) {
    lines.push(`> Tags: ${artifact.tags.map(t => `#${t}`).join(' ')}`)
  }
  lines.push('')

  for (const block of artifact.blocks) {
    if (block.label) {
      lines.push(`## ${block.label}`)
      lines.push('')
    }
    lines.push(blockToMarkdown(block))
    lines.push('')
  }

  if (artifact.graph_refs?.length) {
    lines.push('---')
    lines.push('## Graph References')
    for (const ref of artifact.graph_refs) {
      lines.push(`- \`${ref}\``)
    }
  }

  res.type('text/markdown').send(lines.join('\n'))
}

/* ─── G4.4: HTML fragment export ──────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function blockToHtml(block: ArtifactBlock): string {
  const c = block.content as Record<string, unknown>
  const labelHtml = block.label ? `<h3>${escapeHtml(block.label)}</h3>\n` : ''

  switch (block.type) {
    case 'text':
      return `${labelHtml}<div class="wad-text">${escapeHtml(String(c.body ?? c.text ?? c ?? ''))}</div>`

    case 'table': {
      const headers = (c.headers ?? c.columns ?? []) as string[]
      const rows = (c.rows ?? c.data ?? []) as unknown[][]
      const thRow = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')
      const bodyRows = rows.map(r =>
        `<tr>${(r as unknown[]).map(cell => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`
      ).join('\n')
      return `${labelHtml}<table><thead><tr>${thRow}</tr></thead><tbody>\n${bodyRows}\n</tbody></table>`
    }

    case 'chart': {
      const chartType = String(c.chart_type ?? c.type ?? 'bar')
      const config = JSON.stringify(c.data ?? c)
      return `${labelHtml}<div class="wad-chart" data-type="${escapeHtml(chartType)}" data-config="${escapeHtml(config)}">Chart: ${escapeHtml(chartType)}</div>`
    }

    case 'kpi_card': {
      const label = String(c.label ?? block.label ?? 'KPI')
      const value = String(c.value ?? '')
      const trend = trendEmoji(c.trend as string | undefined)
      return `${labelHtml}<div class="wad-kpi"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span><span class="trend">${trend}</span></div>`
    }

    case 'cypher':
      return `${labelHtml}<pre class="wad-cypher"><code>${escapeHtml(String(c.query ?? c.cypher ?? c))}</code></pre>`

    case 'mermaid':
      return `${labelHtml}<div class="wad-mermaid"><pre class="mermaid">${escapeHtml(String(c.diagram ?? c.code ?? c))}</pre></div>`

    case 'deep_link': {
      const label = String(c.label ?? c.title ?? 'Link')
      const uri = String(c.uri ?? c.url ?? c.href ?? '#')
      return `${labelHtml}<a class="wad-link" href="${escapeHtml(uri)}">${escapeHtml(label)}</a>`
    }

    default:
      return `${labelHtml}<div class="wad-unknown"><pre>${escapeHtml(JSON.stringify(c, null, 2))}</pre></div>`
  }
}

async function renderHtml(_req: Request, res: Response, id: string): Promise<void> {
  const artifact = await loadArtifact(id)
  if (!artifact) {
    res.status(404).json({ success: false, error: 'Artifact not found' })
    return
  }

  const parts: string[] = []
  parts.push(`<article class="wad-artifact" data-id="${escapeHtml(artifact.$id)}" data-status="${artifact.status}">`)
  parts.push(`  <h1>${escapeHtml(artifact.title)}</h1>`)
  parts.push(`  <div class="wad-meta">Source: ${escapeHtml(artifact.source)} | Status: ${artifact.status} | ${artifact.created_at}</div>`)

  if (artifact.tags?.length) {
    parts.push(`  <div class="wad-tags">${artifact.tags.map(t => `<span class="wad-tag">${escapeHtml(t)}</span>`).join(' ')}</div>`)
  }

  for (const block of artifact.blocks) {
    parts.push(`  <section class="wad-block wad-block-${block.type}">`)
    parts.push(`    ${blockToHtml(block)}`)
    parts.push('  </section>')
  }

  if (artifact.graph_refs?.length) {
    parts.push('  <footer class="wad-graph-refs">')
    parts.push('    <h3>Graph References</h3>')
    parts.push('    <ul>')
    for (const ref of artifact.graph_refs) {
      parts.push(`      <li><code>${escapeHtml(ref)}</code></li>`)
    }
    parts.push('    </ul>')
    parts.push('  </footer>')
  }

  parts.push('</article>')

  res.type('text/html').send(parts.join('\n'))
}
