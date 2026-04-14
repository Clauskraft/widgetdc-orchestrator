import { Router, Request, Response } from 'express'
import { getEngagement } from '../engagement/engagement-engine.js'

export const processesRouter = Router()

type ProcessMode = 'inferred' | 'curated'

type StandardFamily = 'structural' | 'control' | 'method'
type AlignmentStatus = 'matched' | 'partial' | 'missing' | 'custom' | 'technology_weak' | 'control_weak'

type StandardLibrary = {
  pack_id: string
  version: string
  title: string
  family: StandardFamily
  description: string
  primary: boolean
}

type ProcessNode = {
  process_id: string
  title: string
  parent_process_id: string | null
  phase: string
  confidence: number
  status: 'inferred' | 'curated'
  alignment: {
    structural: AlignmentStatus
    control: AlignmentStatus
    method: AlignmentStatus
    coverage_score: number
    matched_standard_refs: string[]
  }
  evidence: Array<{ id: string; title: string; kind: string }>
  technology_links: Array<{ id: string; title: string; kind: string; support_score: number }>
}

// Bounded LRU + TTL to prevent unbounded memory growth.
// Engagements expire after 24h of no curate activity; cap at MAX_ENGAGEMENTS to
// guard against worst-case unique-engagement bursts. (Persistent store is a
// separate decision — this guard prevents OOM in single-instance mode.)
const MAX_ENGAGEMENTS = 200
const ENGAGEMENT_TTL_MS = 24 * 60 * 60 * 1000  // 24h
type CuratedEntry = { ids: Set<string>; lastTouchedAt: number }
const curatedState = new Map<string, CuratedEntry>()

function touchCuratedEntry(engagementId: string): CuratedEntry {
  const now = Date.now()
  // Sweep stale entries
  for (const [key, entry] of curatedState.entries()) {
    if (now - entry.lastTouchedAt > ENGAGEMENT_TTL_MS) curatedState.delete(key)
  }
  let entry = curatedState.get(engagementId)
  if (entry) {
    entry.lastTouchedAt = now
    // LRU: re-insert to move to end of insertion order
    curatedState.delete(engagementId)
    curatedState.set(engagementId, entry)
    return entry
  }
  entry = { ids: new Set<string>(), lastTouchedAt: now }
  curatedState.set(engagementId, entry)
  // Cap on size — evict oldest (first key in insertion order = oldest LRU)
  while (curatedState.size > MAX_ENGAGEMENTS) {
    const oldestKey = curatedState.keys().next().value
    if (!oldestKey) break
    curatedState.delete(oldestKey)
  }
  return entry
}

const defaultLibraries: StandardLibrary[] = [
  {
    pack_id: 'apqc-cross-industry',
    version: '1.0.0',
    title: 'APQC Cross-Industry Process Backbone',
    family: 'structural',
    description: 'Structural baseline for canonical process decomposition and coverage checks.',
    primary: true,
  },
  {
    pack_id: 'eu-ai-governance-controls',
    version: '1.0.0',
    title: 'EU AI Governance Controls',
    family: 'control',
    description: 'Control overlay for governance, documentation, monitoring, and human oversight.',
    primary: false,
  },
  {
    pack_id: 'widgetdc-consulting-method',
    version: '1.0.0',
    title: 'WidgeTDC Consulting Method Pack',
    family: 'method',
    description: 'Preferred consulting methods, review checkpoints, and delivery patterns.',
    primary: false,
  },
]

function domainPreset(domain: string) {
  const lower = domain.toLowerCase()
  if (lower.includes('governance') || lower.includes('ai')) {
    return [
      {
        key: 'intake',
        title: 'Engagement Intake and Scoping',
        structural: 'matched',
        control: 'partial',
        method: 'matched',
      },
      {
        key: 'inventory',
        title: 'System and Model Inventory',
        structural: 'matched',
        control: 'technology_weak',
        method: 'matched',
      },
      {
        key: 'risk',
        title: 'Risk and Control Assessment',
        structural: 'partial',
        control: 'control_weak',
        method: 'matched',
      },
      {
        key: 'operating-model',
        title: 'Operating Model and Governance Design',
        structural: 'custom',
        control: 'partial',
        method: 'matched',
      },
    ] as const
  }

  return [
    {
      key: 'intake',
      title: 'Current-State Discovery',
      structural: 'matched',
      control: 'partial',
      method: 'matched',
    },
    {
      key: 'design',
      title: 'Target Process Design',
      structural: 'partial',
      control: 'missing',
      method: 'matched',
    },
    {
      key: 'delivery',
      title: 'Execution and Adoption Planning',
      structural: 'custom',
      control: 'partial',
      method: 'matched',
    },
  ] as const
}

function scoreFor(status: AlignmentStatus): number {
  switch (status) {
    case 'matched':
      return 0.92
    case 'partial':
      return 0.72
    case 'custom':
      return 0.68
    case 'technology_weak':
    case 'control_weak':
      return 0.51
    case 'missing':
    default:
      return 0.33
  }
}

function buildNodes(engagementId: string, client: string, domain: string): ProcessNode[] {
  const curatedIds = curatedState.get(engagementId)?.ids ?? new Set<string>()
  return domainPreset(domain).map((preset, index) => {
    const processId = `${engagementId}:${preset.key}`
    const isCurated = curatedIds.has(processId)
    const structuralScore = scoreFor(preset.structural as AlignmentStatus)
    const controlScore = scoreFor(preset.control as AlignmentStatus)
    const methodScore = scoreFor(preset.method as AlignmentStatus)
    const coverageScore = Number(((structuralScore + controlScore + methodScore) / 3).toFixed(2))
    return {
      process_id: processId,
      title: preset.title,
      parent_process_id: null,
      phase: `P${index + 1}`,
      confidence: Number((0.61 + index * 0.09).toFixed(2)),
      status: isCurated ? 'curated' : 'inferred',
      alignment: {
        structural: preset.structural as AlignmentStatus,
        control: preset.control as AlignmentStatus,
        method: preset.method as AlignmentStatus,
        coverage_score: coverageScore,
        matched_standard_refs: [
          `apqc-cross-industry:${preset.key}`,
          `widgetdc-consulting-method:${preset.key}`,
        ],
      },
      evidence: [
        { id: `${processId}:objective`, title: `${client} objective`, kind: 'engagement' },
        { id: `${processId}:plan`, title: `${preset.title} plan signal`, kind: 'plan' },
      ],
      technology_links: [
        { id: `${processId}:orchestrator`, title: 'widgetdc-orchestrator', kind: 'service', support_score: 0.88 },
        { id: `${processId}:obsidian`, title: 'Obsidian process docs', kind: 'documentation', support_score: 0.74 },
      ],
    }
  })
}

function averageSupportScore(links: ProcessNode['technology_links']): number {
  if (links.length === 0) return 0
  return Number((links.reduce((sum, entry) => sum + entry.support_score, 0) / links.length).toFixed(2))
}

async function engagementOr404(req: Request, res: Response) {
  const engagementId = String(req.query.engagement_id ?? req.body?.engagement_id ?? '')
  if (!engagementId) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'engagement_id is required', status_code: 400 } })
    return null
  }

  const engagement = await getEngagement(engagementId)
  if (!engagement) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Engagement not found', status_code: 404 } })
    return null
  }

  return engagement
}

processesRouter.get('/libraries', (_req, res) => {
  res.json({ success: true, data: { libraries: defaultLibraries } })
})

processesRouter.get('/tree', async (req, res) => {
  const engagement = await engagementOr404(req, res)
  if (!engagement) return

  const mode = (req.query.mode === 'curated' ? 'curated' : 'inferred') as ProcessMode
  const nodes = buildNodes(engagement.$id, engagement.client, engagement.domain)
  const filtered = mode === 'curated' ? nodes.filter((node) => node.status === 'curated') : nodes

  res.json({
    success: true,
    data: {
      engagement_id: engagement.$id,
      client: engagement.client,
      domain: engagement.domain,
      mode,
      nodes: filtered,
      summary: {
        total_nodes: filtered.length,
        curated_nodes: nodes.filter((node) => node.status === 'curated').length,
        inferred_nodes: nodes.filter((node) => node.status === 'inferred').length,
        avg_coverage_score: filtered.length > 0
          ? Number((filtered.reduce((sum, node) => sum + node.alignment.coverage_score, 0) / filtered.length).toFixed(2))
          : 0,
      },
    },
  })
})

processesRouter.post('/infer', async (req, res) => {
  const engagement = await engagementOr404(req, res)
  if (!engagement) return

  const nodes = buildNodes(engagement.$id, engagement.client, engagement.domain)
  res.json({
    success: true,
    data: {
      engagement_id: engagement.$id,
      inferred_at: new Date().toISOString(),
      nodes,
    },
  })
})

processesRouter.post('/curate', async (req, res) => {
  const engagement = await engagementOr404(req, res)
  if (!engagement) return

  const processId = String(req.body?.process_id ?? '')
  if (!processId) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'process_id is required', status_code: 400 } })
    return
  }

  // Validate the process_id actually belongs to this engagement's inferred nodes.
  // Prevents "curated" responses for IDs that never appear in /tree?mode=curated.
  const validNode = buildNodes(engagement.$id, engagement.client, engagement.domain)
    .find((entry) => entry.process_id === processId)
  if (!validNode) {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `process_id '${processId}' is not part of engagement ${engagement.$id}`,
        status_code: 404,
      },
    })
    return
  }

  const entry = touchCuratedEntry(engagement.$id)
  entry.ids.add(processId)

  res.json({
    success: true,
    data: {
      engagement_id: engagement.$id,
      process_id: processId,
      curated: true,
      curated_at: new Date().toISOString(),
      curated_count: entry.ids.size,
    },
  })
})

processesRouter.get('/:process_id/alignment', async (req, res) => {
  const engagement = await engagementOr404(req, res)
  if (!engagement) return

  const processId = String(req.params.process_id ?? '')
  if (!processId) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'process_id is required', status_code: 400 },
    })
    return
  }

  const node = buildNodes(engagement.$id, engagement.client, engagement.domain)
    .find((entry) => entry.process_id === processId)

  if (!node) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Process node not found', status_code: 404 },
    })
    return
  }

  res.json({
    success: true,
    data: {
      engagement_id: engagement.$id,
      process_id: node.process_id,
      title: node.title,
      alignment: node.alignment,
      technology_support_score: averageSupportScore(node.technology_links),
      evidence_count: node.evidence.length,
      technology_link_count: node.technology_links.length,
      review_required:
        node.alignment.structural !== 'matched'
        || node.alignment.control !== 'matched'
        || node.alignment.method !== 'matched',
    },
  })
})
