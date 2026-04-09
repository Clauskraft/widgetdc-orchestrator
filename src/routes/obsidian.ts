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
