/**
 * routes/obsidian.ts — Proxy to Obsidian Local REST API or GitHub vault fallback (LIN-652)
 *
 * Mode 1 (Live): Set OBSIDIAN_API_URL=http://localhost:27123 (or tunnel URL) and
 *   OBSIDIAN_API_TOKEN=<your-api-key>. Requires Obsidian running with Local REST API plugin.
 *
 * Mode 2 (GitHub): Set GITHUB_TOKEN=<pat> (and optionally OBSIDIAN_GITHUB_REPO=owner/repo).
 *   Reads vault files directly from GitHub. Works without Obsidian running.
 *
 * Obsidian REST API plugin: https://github.com/coddingtonbear/obsidian-local-rest-api
 */
import { Router } from 'express'
import { config } from '../config.js'
import { logger } from '../logger.js'

export const obsidianRouter = Router()

const TIMEOUT_MS = 8_000

// ─── Mode helpers ─────────────────────────────────────────────────────────────

function isLiveMode(): boolean { return !!config.obsidianUrl }
function isGithubMode(): boolean { return !config.obsidianUrl && !!config.githubToken }

// ─── Live mode: Obsidian Local REST API ──────────────────────────────────────

async function obsidianFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const base = config.obsidianUrl.replace(/\/$/, '')
  const url = `${base}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (config.obsidianToken) {
    headers['Authorization'] = `Bearer ${config.obsidianToken}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── GitHub mode: GitHub Contents API ────────────────────────────────────────

async function ghFetch(path: string): Promise<Response> {
  const [owner, repo] = config.obsidianGithubRepo.split('/')
  const base = `https://api.github.com/repos/${owner}/${repo}`
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Authorization': `Bearer ${config.githubToken}`,
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${base}${path}`, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

interface GhEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  sha: string
  size: number
  download_url: string | null
  content?: string
  encoding?: string
}

type NoteOperation = 'replace' | 'append' | 'prepend'

type NoteWritePayload = {
  path: string
  content: string
  operation?: NoteOperation
}

type MaterializePayload = {
  kind: string
  title: string
  folder?: string
  properties?: Record<string, string | number | boolean | null>
  content_markdown: string
  open_after_write?: boolean
}

type CanvasNodePayload = {
  id: string
  type: 'text' | 'file' | 'link'
  x: number
  y: number
  width: number
  height: number
  color?: string
  text?: string
  file?: string
  url?: string
}

type CanvasEdgePayload = {
  id: string
  fromNode: string
  fromSide: 'top' | 'right' | 'bottom' | 'left'
  toNode: string
  toSide: 'top' | 'right' | 'bottom' | 'left'
  color?: string
  label?: string
}

type CanvasMaterializePayload = {
  kind: string
  title: string
  folder?: string
  properties?: Record<string, string | number | boolean | null>
  nodes: CanvasNodePayload[]
  edges?: CanvasEdgePayload[]
  open_after_write?: boolean
}

function extractMetadataFromNoteContent(content: string): Record<string, string> {
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4)
    if (end !== -1) {
      const raw = content.slice(4, end)
      const properties: Record<string, string> = {}
      for (const line of raw.split('\n')) {
        const separator = line.indexOf(':')
        if (separator === -1) continue
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim().replace(/^"(.*)"$/, '$1')
        if (key) properties[key] = value
      }
      return properties
    }
  }

  try {
    const parsed = JSON.parse(content) as { widgetdc?: Record<string, unknown> }
    if (parsed.widgetdc && typeof parsed.widgetdc === 'object') {
      return Object.fromEntries(
        Object.entries(parsed.widgetdc).map(([key, value]) => [key, String(value)])
      )
    }
  } catch {
    // ignore parse errors
  }

  return {}
}

async function ghListDir(path: string): Promise<GhEntry[]> {
  const encodedPath = path ? `/contents/${path}` : '/contents'
  const r = await ghFetch(encodedPath)
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${r.statusText}`)
  return r.json() as Promise<GhEntry[]>
}

async function ghGetFile(path: string): Promise<string> {
  const r = await ghFetch(`/contents/${encodeURIComponent(path)}`)
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${r.statusText}`)
  const data = await r.json() as GhEntry
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')
  }
  throw new Error('Unexpected encoding from GitHub API')
}

async function ghGetFileSha(path: string): Promise<string | null> {
  const r = await ghFetch(`/contents/${encodeURIComponent(path)}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${r.statusText}`)
  const data = await r.json() as GhEntry
  return data.sha
}

async function ghWriteFile(path: string, content: string, message: string): Promise<{ sha: string }> {
  const [owner, repo] = config.obsidianGithubRepo.split('/')
  const base = `https://api.github.com/repos/${owner}/${repo}`
  const sha = await ghGetFileSha(path)
  const r = await fetch(`${base}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': `Bearer ${config.githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  })
  if (!r.ok) throw new Error(`GitHub write ${r.status}: ${r.statusText}`)
  const data = await r.json() as { content?: { sha?: string } }
  return { sha: data.content?.sha ?? sha ?? '' }
}

async function ghSearchCode(query: string): Promise<Array<{ filename: string; score: number; context?: string[] }>> {
  const [owner, repo] = config.obsidianGithubRepo.split('/')
  const q = `${encodeURIComponent(query)}+repo:${owner}/${repo}`
  const r = await fetch(
    `https://api.github.com/search/code?q=${q}&per_page=20`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Authorization': `Bearer ${config.githubToken}`,
      },
    }
  )
  if (!r.ok) throw new Error(`GitHub search ${r.status}: ${r.statusText}`)
  const data = await r.json() as { items: Array<{ name: string; path: string }> }
  return (data.items ?? []).map(item => ({
    filename: item.path,
    score: 1.0,
    context: [`${item.name}`],
  }))
}

async function ghGetTreeStats(): Promise<{ file_count: number; dir_count: number; sha: string }> {
  // Get default branch commit
  const repoR = await ghFetch('')
  if (!repoR.ok) throw new Error(`GitHub API ${repoR.status}`)
  const repoData = await repoR.json() as { default_branch: string }
  const branchR = await ghFetch(`/branches/${repoData.default_branch}`)
  if (!branchR.ok) throw new Error(`GitHub API ${branchR.status}`)
  const branchData = await branchR.json() as { commit: { commit: { tree: { sha: string } } } }
  const treeSha = branchData.commit.commit.tree.sha

  const treeR = await ghFetch(`/git/trees/${treeSha}?recursive=1`)
  if (!treeR.ok) throw new Error(`GitHub tree API ${treeR.status}`)
  const treeData = await treeR.json() as { tree: Array<{ type: string }> }
  const files = treeData.tree.filter(n => n.type === 'blob')
  const dirs = treeData.tree.filter(n => n.type === 'tree')
  return { file_count: files.length, dir_count: dirs.length, sha: treeSha }
}

function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function formatFrontmatterValue(value: string | number | boolean | null): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (/^[a-zA-Z0-9._:/ -]+$/.test(value)) return `"${value.replace(/"/g, '\\"')}"`
  return `"${value.replace(/"/g, '\\"')}"`
}

function buildFrontmatter(properties: Record<string, string | number | boolean | null> = {}): string {
  const entries = Object.entries(properties).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return ''
  const lines = entries.map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`)
  return `---\n${lines.join('\n')}\n---\n\n`
}

function buildVaultName(): string {
  return config.obsidianGithubRepo.split('/')[1] || 'Obsidian'
}

function buildObsidianUri(path: string, action: 'open' | 'new' = 'open'): string {
  const vault = encodeURIComponent(buildVaultName())
  const file = encodeURIComponent(path.replace(/\.(md|canvas)$/i, ''))
  return `obsidian://${action}?vault=${vault}&file=${file}`
}

function applyNoteOperation(existing: string, incoming: string, operation: NoteOperation): string {
  if (operation === 'append') return `${existing}${existing.endsWith('\n') ? '' : '\n'}${incoming}`
  if (operation === 'prepend') return `${incoming}${incoming.endsWith('\n') ? '' : '\n'}${existing}`
  return incoming
}

async function writeLiveNote(path: string, content: string, operation: NoteOperation): Promise<void> {
  const normalizedPath = normalizeVaultPath(path)
  if (operation === 'replace') {
    const r = await obsidianFetch(`/vault/${encodeURIComponent(normalizedPath)}`, {
      method: 'PUT',
      body: content,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return
  }

  const existingR = await obsidianFetch(`/vault/${encodeURIComponent(normalizedPath)}`)
  const existing = existingR.ok ? await existingR.text() : ''
  const next = applyNoteOperation(existing, content, operation)
  const writeR = await obsidianFetch(`/vault/${encodeURIComponent(normalizedPath)}`, {
    method: 'PUT',
    body: next,
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
  if (!writeR.ok) throw new Error(`HTTP ${writeR.status}`)
}

async function writeGithubNote(path: string, content: string, operation: NoteOperation): Promise<{ sha: string }> {
  const normalizedPath = normalizeVaultPath(path)
  let nextContent = content
  if (operation !== 'replace') {
    const existing = await ghGetFile(normalizedPath).catch(() => '')
    nextContent = applyNoteOperation(existing, content, operation)
  }
  return ghWriteFile(normalizedPath, nextContent, `obsidian-sync: ${normalizedPath}`)
}

async function writeNote(path: string, content: string, operation: NoteOperation): Promise<{ path: string; uri: string; mode: 'live' | 'github'; sha?: string }> {
  const normalizedPath = normalizeVaultPath(path)
  if (isLiveMode()) {
    await writeLiveNote(normalizedPath, content, operation)
    return { path: normalizedPath, uri: buildObsidianUri(normalizedPath), mode: 'live' }
  }

  if (isGithubMode()) {
    const result = await writeGithubNote(normalizedPath, content, operation)
    return { path: normalizedPath, uri: buildObsidianUri(normalizedPath), mode: 'github', sha: result.sha }
  }

  throw new Error('Not configured')
}

// ─── Status ───────────────────────────────────────────────────────────────────

obsidianRouter.get('/status', async (_req, res) => {
  if (isLiveMode()) {
    try {
      const r = await obsidianFetch('/')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as Record<string, unknown>
      res.json({ connected: true, mode: 'live', ...data })
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Obsidian live status check failed')
      res.status(503).json({ connected: false, mode: 'live', error: err.message })
    }
    return
  }

  if (isGithubMode()) {
    try {
      const r = await ghFetch('')
      if (!r.ok) throw new Error(`GitHub API ${r.status}`)
      const data = await r.json() as { name: string; full_name: string; default_branch: string }
      res.json({
        connected: true,
        mode: 'github',
        vault_name: data.name,
        repo: data.full_name,
        default_branch: data.default_branch,
        versions: { obsidian: 'GitHub', api: 'v1' },
      })
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Obsidian GitHub status check failed')
      res.status(503).json({ connected: false, mode: 'github', error: err.message })
    }
    return
  }

  res.status(503).json({
    connected: false,
    error: 'OBSIDIAN_API_URL not configured',
    setup: [
      'Option A (Live): Set OBSIDIAN_API_URL=http://your-tunnel + OBSIDIAN_API_TOKEN in Railway env vars.',
      'Option B (GitHub): Set GITHUB_TOKEN=ghp_... in Railway env vars (reads vault from Clauskraft/Obsidian-Vault).',
    ].join('\n'),
  })
})

// ─── Vault stats ──────────────────────────────────────────────────────────────

obsidianRouter.get('/vault/stats', async (_req, res) => {
  if (isLiveMode()) {
    try {
      const r = await obsidianFetch('/vault/')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      res.json(await r.json())
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  if (isGithubMode()) {
    try {
      const stats = await ghGetTreeStats()
      res.json({
        vault_name: config.obsidianGithubRepo.split('/')[1],
        recursive_file_count: stats.file_count,
        recursive_dir_count: stats.dir_count,
      })
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  res.status(503).json({ error: 'Not configured' })
})

// ─── List directory ───────────────────────────────────────────────────────────

obsidianRouter.get('/vault/list', async (req, res) => {
  if (isLiveMode()) {
    const path = (req.query.path as string) ?? '/'
    try {
      const r = await obsidianFetch(`/vault${path}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      res.json(await r.json())
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  if (isGithubMode()) {
    const path = ((req.query.path as string) ?? '').replace(/^\//, '')
    try {
      const entries = await ghListDir(path)
      res.json({
        files: entries.map(e => ({ path: e.path, type: e.type === 'dir' ? 'dir' : 'file' })),
      })
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  res.status(503).json({ error: 'Not configured' })
})

// ─── Search notes ─────────────────────────────────────────────────────────────

obsidianRouter.get('/search', async (req, res) => {
  const query = req.query.q as string
  if (!query) return res.status(400).json({ error: 'q parameter required' })

  if (isLiveMode()) {
    try {
      const r = await obsidianFetch(`/search/simple/?query=${encodeURIComponent(query)}&contextLength=100`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      res.json(await r.json())
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  if (isGithubMode()) {
    try {
      const results = await ghSearchCode(query)
      res.json(results)
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  res.status(503).json({ error: 'Not configured' })
})

// ─── Read note ────────────────────────────────────────────────────────────────

obsidianRouter.get('/note', async (req, res) => {
  const path = req.query.path as string
  if (!path) return res.status(400).json({ error: 'path parameter required' })

  if (isLiveMode()) {
    try {
      const r = await obsidianFetch(`/vault/${encodeURIComponent(path)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const content = await r.text()
      res.json({ path, content })
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  if (isGithubMode()) {
    try {
      const content = await ghGetFile(path)
      res.json({ path, content })
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  res.status(503).json({ error: 'Not configured' })
})

obsidianRouter.get('/metadata', async (req, res) => {
  const path = req.query.path as string
  if (!path) return res.status(400).json({ error: 'path parameter required' })

  try {
    const content =
      isLiveMode()
        ? await (async () => {
            const r = await obsidianFetch(`/vault/${encodeURIComponent(path)}`)
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            return r.text()
          })()
        : isGithubMode()
          ? await ghGetFile(path)
          : Promise.reject(new Error('Not configured'))

    const resolvedContent = await content
    res.json({
      path,
      properties: extractMetadataFromNoteContent(resolvedContent),
    })
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

// ─── List tags ────────────────────────────────────────────────────────────────

obsidianRouter.get('/tags', async (_req, res) => {
  if (isLiveMode()) {
    try {
      const r = await obsidianFetch('/search/simple/?query=%23&contextLength=0')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      res.json(await r.json())
    } catch (err: any) {
      res.status(503).json({ error: err.message })
    }
    return
  }

  if (isGithubMode()) {
    // GitHub mode: return empty tags (tag extraction requires scanning all files)
    res.json({})
    return
  }

  res.status(503).json({ error: 'Not configured' })
})

// ─── Write note ───────────────────────────────────────────────────────────────

obsidianRouter.post('/note', async (req, res) => {
  const body = req.body as NoteWritePayload
  if (!body?.path || typeof body.path !== 'string') return res.status(400).json({ error: 'path is required' })
  if (typeof body.content !== 'string') return res.status(400).json({ error: 'content is required' })

  try {
    const result = await writeNote(body.path, body.content, body.operation ?? 'replace')
    res.json({ success: true, ...result })
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

obsidianRouter.patch('/note', async (req, res) => {
  const body = req.body as NoteWritePayload
  if (!body?.path || typeof body.path !== 'string') return res.status(400).json({ error: 'path is required' })
  if (typeof body.content !== 'string') return res.status(400).json({ error: 'content is required' })

  try {
    const result = await writeNote(body.path, body.content, body.operation ?? 'append')
    res.json({ success: true, ...result })
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

obsidianRouter.post('/daily', async (req, res) => {
  const body = (req.body ?? {}) as { date?: string; folder?: string; title?: string; content?: string }
  const date = body.date ?? new Date().toISOString().slice(0, 10)
  const title = body.title?.trim() || date
  const folder = normalizeVaultPath(body.folder ?? 'Daily')
  const path = `${folder}/${slugify(title) || date}.md`

  try {
    const result = await writeNote(path, body.content ?? '', 'append')
    res.json({ success: true, date, ...result })
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

obsidianRouter.post('/open', async (req, res) => {
  const body = (req.body ?? {}) as { path?: string }
  if (!body.path || typeof body.path !== 'string') return res.status(400).json({ error: 'path is required' })
  const normalizedPath = normalizeVaultPath(body.path)
  res.json({
    success: true,
    path: normalizedPath,
    uri: buildObsidianUri(normalizedPath),
  })
})

obsidianRouter.post('/materialize', async (req, res) => {
  const body = req.body as MaterializePayload
  if (!body?.kind || typeof body.kind !== 'string') return res.status(400).json({ error: 'kind is required' })
  if (!body?.title || typeof body.title !== 'string') return res.status(400).json({ error: 'title is required' })
  if (typeof body.content_markdown !== 'string') return res.status(400).json({ error: 'content_markdown is required' })

  const folder = normalizeVaultPath(body.folder ?? `WidgeTDC/${body.kind}`)
  const fileName = `${slugify(body.title) || 'artifact'}.md`
  const path = `${folder}/${fileName}`
  const properties = {
    widgetdc_kind: body.kind,
    generated_at: new Date().toISOString(),
    ...body.properties,
  }
  const content = `${buildFrontmatter(properties)}${body.content_markdown}`

  try {
    const result = await writeNote(path, content, 'replace')
    res.json({
      success: true,
      kind: body.kind,
      title: body.title,
      path,
      uri: body.open_after_write ? buildObsidianUri(path) : result.uri,
      mode: result.mode,
      sha: result.sha,
      properties,
    })
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

obsidianRouter.post('/canvas', async (req, res) => {
  const body = req.body as CanvasMaterializePayload
  if (!body?.kind || typeof body.kind !== 'string') return res.status(400).json({ error: 'kind is required' })
  if (!body?.title || typeof body.title !== 'string') return res.status(400).json({ error: 'title is required' })
  if (!Array.isArray(body.nodes) || body.nodes.length === 0) return res.status(400).json({ error: 'nodes are required' })

  const folder = normalizeVaultPath(body.folder ?? `WidgeTDC/${body.kind}`)
  const fileName = `${slugify(body.title) || 'artifact'}.canvas`
  const path = `${folder}/${fileName}`
  const properties = {
    widgetdc_kind: body.kind,
    generated_at: new Date().toISOString(),
    ...body.properties,
  }
  const content = JSON.stringify({
    widgetdc: properties,
    nodes: body.nodes,
    edges: body.edges ?? [],
  }, null, 2)

  try {
    const result = await writeNote(path, content, 'replace')
    res.json({
      success: true,
      kind: body.kind,
      title: body.title,
      path,
      uri: body.open_after_write ? buildObsidianUri(path) : result.uri,
      mode: result.mode,
      sha: result.sha,
      properties,
    })
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})
