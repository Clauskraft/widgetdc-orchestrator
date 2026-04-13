import { createFileRoute } from '@tanstack/react-router'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { dispatch } from '@/lib/agent-client'
import {
  buildCanvasPayload,
  buildVisualizationProperties,
  parseFrontmatter,
  resolveVisualizationContractFromProperties,
} from '@/lib/visualization-contract'
import { AgentResponseCard } from '@/components/shared/AgentResponseCard'
import { JobProgress } from '@/components/shared/JobProgress'
import { SendCanvasToObsidianButton } from '@/components/shared/SendCanvasToObsidianButton'
import { SendToObsidianButton } from '@/components/shared/SendToObsidianButton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ExternalLink, RefreshCw, Search as SearchIcon, Sparkles } from 'lucide-react'
import { useJobStore } from '@/stores/jobs'

interface ObsidianStatus {
  connected: boolean
  mode?: 'live' | 'github'
  error?: string
  setup?: string
  versions?: Record<string, string>
  vault_name?: string
  repo?: string
}

interface VaultEntry {
  path: string
  type: 'file' | 'dir'
}

interface VaultStats {
  vault_name?: string
  root_count?: number
  recursive_file_count?: number
  recursive_dir_count?: number
}

interface SearchResult {
  filename: string
  score: number
  context?: string[]
}

interface TagCloud {
  [tag: string]: number
}

type OpenNoteResponse = {
  success: boolean
  path: string
  uri: string
}

type NoteMetadata = {
  path: string
  properties: Record<string, string>
}

const ARTIFACT_FOLDERS = [
  { key: 'deliverables', label: 'Deliverables', path: 'WidgeTDC/Deliverables', tone: 'bg-amber-100 text-amber-800' },
  { key: 'compliance', label: 'Compliance Audits', path: 'WidgeTDC/Compliance Audits', tone: 'bg-emerald-100 text-emerald-800' },
] as const

function MetadataPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function parseCanvas(content: string): { widgetdc?: Record<string, string>; nodesCount: number; edgesCount: number } | null {
  try {
    const parsed = JSON.parse(content) as { widgetdc?: Record<string, string>; nodes?: unknown[]; edges?: unknown[] }
    return {
      widgetdc: parsed.widgetdc,
      nodesCount: Array.isArray(parsed.nodes) ? parsed.nodes.length : 0,
      edgesCount: Array.isArray(parsed.edges) ? parsed.edges.length : 0,
    }
  } catch {
    return null
  }
}

function makeRefinementTitle(path: string, mode: 'analyze' | 'deliverable'): string {
  const base = path.split('/').at(-1)?.replace(/\.(md|canvas)$/i, '') ?? 'artifact'
  return `${base} ${mode === 'analyze' ? 'analysis' : 'deliverable'} v2`
}

function buildLineageChain(selectedPath: string | null, metadataEntries: NoteMetadata[]): NoteMetadata[] {
  if (!selectedPath) return []
  const byPath = new Map(metadataEntries.map((entry) => [entry.path, entry]))
  const chain: NoteMetadata[] = []

  let current = byPath.get(selectedPath)
  const seen = new Set<string>()
  while (current && !seen.has(current.path)) {
    chain.unshift(current)
    seen.add(current.path)
    const refinedFrom = current.properties.refined_from
    current = refinedFrom ? byPath.get(refinedFrom) : undefined
  }

  let child = metadataEntries.find((entry) => entry.properties.refined_from === selectedPath)
  while (child && !seen.has(child.path)) {
    chain.push(child)
    seen.add(child.path)
    child = metadataEntries.find((entry) => entry.properties.refined_from === child?.path)
  }

  return chain
}

function readLineageMetrics(chain: NoteMetadata[]) {
  if (chain.length === 0) {
    return null
  }

  const head = chain[chain.length - 1]
  const tail = chain[0]
  return {
    hops: Math.max(0, chain.length - 1),
    headPath: head.path,
    rootPath: tail.path,
    latestMode: head.properties.refinement_mode ?? 'root',
    headStatus: head.properties.status ?? 'unknown',
    headKind: head.properties.widgetdc_kind ?? 'unknown',
    citationsCount: Number(head.properties.citations_count ?? 0) || 0,
  }
}

function recommendNextAction(metrics: ReturnType<typeof readLineageMetrics>) {
  if (!metrics) return null

  if (metrics.headStatus !== 'success') {
    return {
      action: 'analyze_again',
      label: 'Analyze again',
      rationale: 'Latest head is not marked successful, so the safest next move is another analysis pass.',
      confidence: 'high',
    } as const
  }

  if (metrics.headKind === 'knowledge_artifact') {
    return {
      action: 'materialize_deliverable',
      label: 'Generate deliverable',
      rationale: 'Knowledge artifacts are usually intermediate thinking surfaces and should often be converted into a client-facing deliverable.',
      confidence: 'high',
    } as const
  }

  if (metrics.headKind === 'compliance_audit' && metrics.latestMode === 'root') {
    return {
      action: 'analyze_again',
      label: 'Analyze audit',
      rationale: 'A root compliance audit usually benefits from one structured analysis/refinement loop before it becomes stable working memory.',
      confidence: 'medium',
    } as const
  }

  if (metrics.headKind === 'deliverable_draft' && metrics.hops < 2) {
    return {
      action: 'refine_deliverable',
      label: 'Refine deliverable',
      rationale: 'Early deliverable heads typically improve with at least one more refinement hop.',
      confidence: 'medium',
    } as const
  }

  return {
    action: 'done',
    label: 'Done',
    rationale: 'This artifact chain already looks mature enough to treat the current head as the working version.',
    confidence: 'medium',
  } as const
}

function NextActionConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const className =
    confidence === 'high'
      ? 'bg-emerald-600 text-white'
      : confidence === 'medium'
        ? 'bg-amber-500 text-white'
        : 'bg-slate-500 text-white'
  return <Badge className={className}>{confidence} confidence</Badge>
}

function readOutcomeSignals(metrics: ReturnType<typeof readLineageMetrics>, selectedPath: string | null) {
  if (!metrics) return null

  const maturity =
    metrics.hops === 0
      ? 'root'
      : metrics.headStatus === 'success' && metrics.hops >= 2
        ? 'mature'
        : 'evolving'

  const evidence =
    metrics.citationsCount >= 5
      ? 'strong'
      : metrics.citationsCount > 0
        ? 'light'
        : 'none'

  return {
    maturity,
    evidence,
    isHeadSelected: metrics.headPath === selectedPath,
    isRootSelected: metrics.rootPath === selectedPath,
  } as const
}

function OutcomeBadge({ tone, children }: { tone: 'root' | 'evolving' | 'mature' | 'strong' | 'light' | 'none'; children: ReactNode }) {
  const className =
    tone === 'mature' || tone === 'strong'
      ? 'bg-emerald-600 text-white'
      : tone === 'evolving' || tone === 'light'
        ? 'bg-amber-500 text-white'
        : tone === 'root'
          ? 'bg-sky-600 text-white'
          : 'bg-slate-500 text-white'
  return <Badge className={className}>{children}</Badge>
}

function ObsidianPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const [artifactTab, setArtifactTab] = useState<(typeof ARTIFACT_FOLDERS)[number]['key']>('deliverables')
  const [openError, setOpenError] = useState<string | null>(null)
  const [roundtripMode, setRoundtripMode] = useState<'analyze' | 'deliverable'>('analyze')
  const [roundtripResponse, setRoundtripResponse] = useState<any | null>(null)
  const [roundtripError, setRoundtripError] = useState<string | null>(null)
  const [isRoundtripping, setIsRoundtripping] = useState(false)
  const upsertJob = useJobStore((state) => state.upsertJob)
  const removeJob = useJobStore((state) => state.removeJob)
  const jobs = useJobStore((state) => state.jobs)
  const activeRoundtripJob = useMemo(() => jobs.find((job) => job.id === 'obsidian-roundtrip'), [jobs])

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<ObsidianStatus>({
    queryKey: ['obsidian-status'],
    queryFn: () => apiGet('/api/obsidian/status'),
    retry: 1,
  })

  const { data: vault, isLoading: vaultLoading } = useQuery<{ files: VaultEntry[] }>({
    queryKey: ['obsidian-vault'],
    queryFn: () => apiGet('/api/obsidian/vault/list'),
    enabled: status?.connected === true,
    retry: 1,
  })

  const { data: vaultStats, isLoading: statsLoading } = useQuery<VaultStats>({
    queryKey: ['obsidian-vault-stats'],
    queryFn: () => apiGet('/api/obsidian/vault/stats'),
    enabled: status?.connected === true,
    retry: 1,
  })

  const { data: searchResults, isLoading: searching } = useQuery<SearchResult[]>({
    queryKey: ['obsidian-search', activeSearch],
    queryFn: () => apiGet(`/api/obsidian/search?q=${encodeURIComponent(activeSearch)}`),
    enabled: activeSearch.length > 2 && status?.connected === true,
    retry: 1,
  })

  const { data: tags, isLoading: tagsLoading } = useQuery<TagCloud>({
    queryKey: ['obsidian-tags'],
    queryFn: () => apiGet('/api/obsidian/tags'),
    enabled: status?.connected === true,
    retry: 1,
  })

  const { data: noteContent } = useQuery<{ path: string; content: string }>({
    queryKey: ['obsidian-note', selectedNote],
    queryFn: () => apiGet(`/api/obsidian/note?path=${encodeURIComponent(selectedNote!)}`),
    enabled: selectedNote != null && status?.connected === true,
    retry: 1,
  })

  const { data: deliverableArtifacts, isLoading: deliverablesLoading } = useQuery<{ files: VaultEntry[] }>({
    queryKey: ['obsidian-artifacts', 'deliverables'],
    queryFn: () => apiGet(`/api/obsidian/vault/list?path=${encodeURIComponent('/WidgeTDC/Deliverables')}`),
    enabled: status?.connected === true,
    retry: 1,
  })

  const { data: complianceArtifacts, isLoading: complianceLoading } = useQuery<{ files: VaultEntry[] }>({
    queryKey: ['obsidian-artifacts', 'compliance'],
    queryFn: () => apiGet(`/api/obsidian/vault/list?path=${encodeURIComponent('/WidgeTDC/Compliance Audits')}`),
    enabled: status?.connected === true,
    retry: 1,
  })
  const artifactMetadataQueries = useQueries({
    queries: [
      ...((deliverableArtifacts?.files ?? []).filter((file) => file.type === 'file' && (file.path.endsWith('.md') || file.path.endsWith('.canvas')))),
      ...((complianceArtifacts?.files ?? []).filter((file) => file.type === 'file' && (file.path.endsWith('.md') || file.path.endsWith('.canvas')))),
    ]
      .slice(0, 24)
      .map((file) => ({
        queryKey: ['obsidian-metadata', file.path],
        queryFn: () => apiGet<NoteMetadata>(`/api/obsidian/metadata?path=${encodeURIComponent(file.path)}`),
        enabled: status?.connected === true,
        retry: 1,
      })),
  })

  const handleRefresh = () => {
    refetchStatus()
    queryClient.invalidateQueries({ queryKey: ['obsidian-vault'] })
    queryClient.invalidateQueries({ queryKey: ['obsidian-vault-stats'] })
    queryClient.invalidateQueries({ queryKey: ['obsidian-tags'] })
    queryClient.invalidateQueries({ queryKey: ['obsidian-artifacts'] })
    queryClient.invalidateQueries({ queryKey: ['obsidian-metadata'] })
  }

  const handleOpenNote = async (path: string) => {
    setOpenError(null)
    setSelectedNote(path)
    try {
      const data = await apiPost<OpenNoteResponse>('/api/obsidian/open', { path })
      window.location.href = data.uri
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error))
    }
  }

  if (statusLoading) {
    return (
      <div className="p-8 flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!status?.connected) {
    return (
      <div className="p-8 flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Obsidian Vault</h1>
          <p className="text-muted-foreground mt-1">Browse and search your Obsidian knowledge base</p>
        </div>
        <Alert>
          <AlertTitle>Obsidian not connected</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-2">{status?.error ?? 'No vault mode configured.'}</p>
          </AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>Setup — choose a mode</CardTitle>
            <CardDescription>Connect your Obsidian vault to the Command Center</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <div>
              <p className="font-semibold mb-2">Option A — GitHub mode (recommended, no Obsidian required)</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground mb-3">
                <li>Create a GitHub Personal Access Token with <strong className="text-foreground">repo</strong> scope</li>
                <li>Set it in Railway env vars:</li>
              </ol>
              <div className="bg-muted rounded p-3 font-mono text-xs space-y-1">
                <div>GITHUB_TOKEN=ghp_your-token-here</div>
                <div className="text-muted-foreground"># Optional: OBSIDIAN_GITHUB_REPO=Clauskraft/Obsidian-Vault</div>
              </div>
            </div>
            <div>
              <p className="font-semibold mb-2">Option B — Live mode (requires Obsidian running + tunnel)</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground mb-3">
                <li>Install <strong className="text-foreground">Local REST API</strong> plugin in Obsidian + copy API key</li>
                <li>Expose port 27123 via ngrok or Cloudflare Tunnel</li>
                <li>Set in Railway env vars:</li>
              </ol>
              <div className="bg-muted rounded p-3 font-mono text-xs space-y-1">
                <div>OBSIDIAN_API_URL=https://your-tunnel.ngrok.io</div>
                <div>OBSIDIAN_API_TOKEN=your-obsidian-api-key</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const files = vault?.files ?? []
  const mdFiles = files.filter(f => f.type === 'file' && (f.path.endsWith('.md') || f.path.endsWith('.canvas')))
  const folders = files.filter(f => f.type === 'dir')
  const deliverableFiles = (deliverableArtifacts?.files ?? []).filter((file) => file.type === 'file' && (file.path.endsWith('.md') || file.path.endsWith('.canvas')))
  const complianceFiles = (complianceArtifacts?.files ?? []).filter((file) => file.type === 'file' && (file.path.endsWith('.md') || file.path.endsWith('.canvas')))
  const activeArtifactFiles = artifactTab === 'deliverables' ? deliverableFiles : complianceFiles
  const parsedNote = noteContent ? parseFrontmatter(noteContent.content) : null
  const canvasPreview = noteContent && selectedNote?.endsWith('.canvas') ? parseCanvas(noteContent.content) : null
  const metadataEntries = artifactMetadataQueries
    .map((query) => query.data)
    .filter((entry): entry is NoteMetadata => Boolean(entry))
  const visualizationContract =
    selectedNote?.endsWith('.canvas')
      ? (canvasPreview?.widgetdc ? resolveVisualizationContractFromProperties(canvasPreview.widgetdc) : null)
      : (parsedNote ? resolveVisualizationContractFromProperties(parsedNote.properties) : null)
  const lineageChain = buildLineageChain(selectedNote, metadataEntries)
  const lineageMetrics = readLineageMetrics(lineageChain)
  const outcomeSignals = readOutcomeSignals(lineageMetrics, selectedNote)
  const nextAction = recommendNextAction(lineageMetrics)
  const selectedBody = selectedNote?.endsWith('.canvas')
    ? noteContent?.content ?? ''
    : parsedNote?.body ?? ''
  const refinementTitle = selectedNote ? makeRefinementTitle(selectedNote, roundtripMode) : 'artifact refinement'
  const roundtripNoteProperties = useMemo(() => {
    if (!selectedNote || !roundtripResponse) return null
    return buildVisualizationProperties(
      roundtripMode === 'deliverable'
        ? { kind: 'deliverable_draft', deliverableType: 'analysis' }
        : { kind: 'knowledge_artifact' },
      {
        client:
          parsedNote?.properties.client
          ?? canvasPreview?.widgetdc?.client
          ?? 'Unknown',
        source_tool: roundtripMode === 'deliverable' ? 'deliverable_draft' : 'reason_deeply',
        status: roundtripResponse.status,
        refined_from: selectedNote,
        refinement_mode: roundtripMode,
      }
    )
  }, [canvasPreview?.widgetdc?.client, parsedNote?.properties.client, roundtripMode, roundtripResponse, selectedNote])
  const roundtripCanvasPayload = useMemo(() => {
    if (!selectedNote || !roundtripResponse) return null
    return buildCanvasPayload(
      roundtripMode === 'deliverable'
        ? { kind: 'deliverable_draft', deliverableType: 'analysis' }
        : { kind: 'knowledge_artifact' },
      {
        title: refinementTitle,
        markdown: roundtripResponse.output,
        client:
          parsedNote?.properties.client
          ?? canvasPreview?.widgetdc?.client
          ?? 'Unknown',
        sourceTool: roundtripMode === 'deliverable' ? 'deliverable_draft' : 'reason_deeply',
        status: roundtripResponse.status,
      }
    )
  }, [canvasPreview?.widgetdc?.client, parsedNote?.properties.client, refinementTitle, roundtripMode, roundtripResponse, selectedNote])

  // Sort tags by frequency, get top 20
  const sortedTags = tags ? Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 20) : []

  const handleRoundtrip = async (modeOverride?: 'analyze' | 'deliverable') => {
    if (!selectedNote || !selectedBody.trim()) return
    const mode = modeOverride ?? roundtripMode
    setRoundtripError(null)
    setRoundtripResponse(null)
    setIsRoundtripping(true)
    const startedAt = new Date().toISOString()

    upsertJob({
      id: 'obsidian-roundtrip',
      title: mode === 'analyze' ? 'Obsidian note analysis' : 'Obsidian note to deliverable',
      status: 'running',
      progress: 20,
      detail: mode === 'analyze' ? 'Sending selected note through reason_deeply' : 'Sending selected note through deliverable_draft',
      startedAt,
    })

    try {
      const response = mode === 'analyze'
        ? await dispatch({
            agent_id: 'cc-v4',
            task: `Analyze Obsidian artifact ${selectedNote}`,
            capabilities: ['analysis', 'reasoning'],
            context: {
              tool_name: 'reason_deeply',
              tool_args: {
                task: `Analyze the following Obsidian artifact for structure, risks, opportunities, and next actions.\n\nArtifact path: ${selectedNote}\nVisualization contract: ${visualizationContract ? JSON.stringify(visualizationContract) : 'none'}\n\nContent:\n${selectedBody}`,
                mode: 'analyze',
              },
            },
            priority: 'high',
          })
        : await dispatch({
            agent_id: 'cc-v4',
            task: `Generate deliverable from Obsidian artifact ${selectedNote}`,
            capabilities: ['document-generation', 'consulting'],
            context: {
              tool_name: 'deliverable_draft',
              tool_args: {
                prompt: `Turn the following Obsidian artifact into a client-ready consulting deliverable. Preserve the strongest insights, impose a clear structure, and keep it concise.\n\nArtifact path: ${selectedNote}\nVisualization contract: ${visualizationContract ? JSON.stringify(visualizationContract) : 'none'}\n\nContent:\n${selectedBody}`,
                type: 'analysis',
                format: 'markdown',
                max_sections: 6,
                include_citations: true,
              },
            },
            priority: 'high',
          })

      setRoundtripResponse(response)
      upsertJob({
        id: 'obsidian-roundtrip',
        title: mode === 'analyze' ? 'Obsidian note analysis' : 'Obsidian note to deliverable',
        status: response.status === 'success' ? 'completed' : 'failed',
        progress: 100,
        detail: response.status === 'success' ? 'Roundtrip result ready for review' : 'Roundtrip returned an error response',
        startedAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setRoundtripError(message)
      upsertJob({
        id: 'obsidian-roundtrip',
        title: mode === 'analyze' ? 'Obsidian note analysis' : 'Obsidian note to deliverable',
        status: 'failed',
        progress: 100,
        detail: message,
        startedAt,
      })
    } finally {
      setIsRoundtripping(false)
      window.setTimeout(() => removeJob('obsidian-roundtrip'), 3000)
    }
  }

  const handleRecommendedAction = async () => {
    if (!nextAction || nextAction.action === 'done') return
    const mode = nextAction.action === 'materialize_deliverable' || nextAction.action === 'refine_deliverable'
      ? 'deliverable'
      : 'analyze'
    setRoundtripMode(mode)
    await handleRoundtrip(mode)
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Obsidian Vault</h1>
          <p className="text-muted-foreground mt-1">Browse and search your knowledge base</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={statusLoading || vaultLoading || statsLoading}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Badge className="bg-green-600 text-white">
            {status?.mode === 'github' ? 'GitHub mode' : 'Live'}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vaultLoading || statsLoading ? '…' : vaultStats?.recursive_file_count ?? mdFiles.length}</div>
            <p className="text-xs text-muted-foreground">Markdown files</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Folders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vaultLoading || statsLoading ? '…' : vaultStats?.recursive_dir_count ?? folders.length}</div>
            <p className="text-xs text-muted-foreground">Directories</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tagsLoading ? '…' : sortedTags.length}</div>
            <p className="text-xs text-muted-foreground">Unique tags</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.versions?.obsidian ?? 'Live'}</div>
            <p className="text-xs text-muted-foreground">Obsidian version</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80">
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
            <Sparkles className="h-4 w-4" />
            WidgeTDC Artifact Workbench
          </div>
          <CardTitle>Recent proof artifacts</CardTitle>
          <CardDescription>Browse the deliverables and audits generated from the proof flows, then open them directly in Obsidian.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={artifactTab} onValueChange={(value) => setArtifactTab(value as (typeof ARTIFACT_FOLDERS)[number]['key'])}>
            <TabsList>
              {ARTIFACT_FOLDERS.map((folder) => (
                <TabsTrigger key={folder.key} value={folder.key}>{folder.label}</TabsTrigger>
              ))}
            </TabsList>
            {ARTIFACT_FOLDERS.map((folder) => {
              const filesForFolder = folder.key === 'deliverables' ? deliverableFiles : complianceFiles
              const isLoading = folder.key === 'deliverables' ? deliverablesLoading : complianceLoading
              return (
                <TabsContent key={folder.key} value={folder.key}>
                  <div className="grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
                    <div className="space-y-2">
                      {isLoading ? (
                        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
                      ) : filesForFolder.length > 0 ? (
                        filesForFolder.slice(0, 12).map((file) => (
                          <button
                            key={file.path}
                            type="button"
                            onClick={() => setSelectedNote(file.path)}
                            className={`flex w-full items-start justify-between rounded-lg border p-3 text-left transition-colors ${selectedNote === file.path ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{file.path.split('/').at(-1)?.replace(/\.md$/i, '') ?? file.path}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <p className="truncate text-xs text-muted-foreground">{file.path}</p>
                                <Badge variant="outline" className="text-[10px] uppercase">
                                  {file.path.endsWith('.canvas') ? 'canvas' : 'note'}
                                </Badge>
                              </div>
                            </div>
                            <Badge className={folder.tone}>{folder.label}</Badge>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                          No {folder.label.toLowerCase()} materialized yet.
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Folder path</p>
                      <p className="mt-2 font-mono text-sm">{folder.path}</p>
                      <p className="mt-4 text-sm text-muted-foreground">
                        Use the V1 and V4 routes to push artifacts here. This is the bridge from proof flow to vault-native working memory.
                      </p>
                    </div>
                  </div>
                </TabsContent>
              )
            })}
          </Tabs>

          {openError && (
            <Alert>
              <AlertTitle>Open in Obsidian failed</AlertTitle>
              <AlertDescription>{openError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">{activeArtifactFiles.length} artifacts in current folder</Badge>
            {selectedNote && (
              <Button variant="outline" size="sm" onClick={() => void handleOpenNote(selectedNote)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open selected note
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tag Cloud */}
      {sortedTags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tag Cloud</CardTitle>
            <CardDescription>Most frequently used tags in vault</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {sortedTags.map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => setActiveSearch(`#${tag}`)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-sm"
                >
                  <span className="font-medium text-primary">#{tag}</span>
                  <Badge variant="secondary" className="h-fit text-xs">{count}</Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Search Notes</CardTitle>
          <CardDescription>Full-text search across your vault</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search notes… (press Enter)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchQuery.length > 2) setActiveSearch(searchQuery) }}
              className="flex-1"
            />
            <Button
              onClick={() => searchQuery.length > 2 && setActiveSearch(searchQuery)}
              disabled={searching || searchQuery.length < 3}
              size="sm"
            >
              <SearchIcon className="h-4 w-4 mr-1" />
              Search
            </Button>
          </div>
          {searching && <div className="text-sm text-muted-foreground animate-pulse">Searching…</div>}
          {searchResults && searchResults.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {searchResults.map((r, i) => (
                <div
                  key={i}
                  className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedNote(r.filename)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium truncate flex-1">{r.filename}</span>
                    <Badge variant="outline" className="text-xs ml-2">score {r.score?.toFixed(2)}</Badge>
                  </div>
                  {r.context && r.context.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.context[0]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {searchResults && searchResults.length === 0 && activeSearch && (
            <div className="text-sm text-muted-foreground">No results for "{activeSearch}"</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Explorer */}
        <Card>
          <CardHeader>
            <CardTitle>Vault Explorer</CardTitle>
            <CardDescription>Root-level structure</CardDescription>
          </CardHeader>
          <CardContent>
            {vaultLoading ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              <div className="space-y-0.5 max-h-72 overflow-y-auto text-sm">
                {folders.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                    <span>📁</span><span className="text-muted-foreground">{f.path}</span>
                  </div>
                ))}
                {mdFiles.slice(0, 25).map((f, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${selectedNote === f.path ? 'bg-muted' : 'hover:bg-muted/50'}`}
                    onClick={() => setSelectedNote(f.path)}
                  >
                    <span>{f.path.endsWith('.canvas') ? '🗺️' : '📄'}</span><span className="truncate">{f.path}</span>
                  </div>
                ))}
                {mdFiles.length > 25 && (
                  <div className="text-xs text-muted-foreground px-2 py-1">…and {mdFiles.length - 25} more</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Note Viewer */}
        <Card>
          <CardHeader>
            <CardTitle>Note Viewer</CardTitle>
            <CardDescription className="truncate">{selectedNote ?? 'Select a note to view'}</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedNote && noteContent ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{selectedNote.split('/')[0] ?? 'vault'}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => void handleOpenNote(selectedNote)}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in Obsidian
                  </Button>
                </div>
                {!selectedNote.endsWith('.canvas') && parsedNote && Object.keys(parsedNote.properties).length > 0 && (
                  <div className="grid gap-2 md:grid-cols-2">
                    {parsedNote.properties.widgetdc_kind && (
                      <MetadataPill label="Artifact kind" value={parsedNote.properties.widgetdc_kind} />
                    )}
                    {parsedNote.properties.client && (
                      <MetadataPill label="Client" value={parsedNote.properties.client} />
                    )}
                    {parsedNote.properties.source_tool && (
                      <MetadataPill label="Source tool" value={parsedNote.properties.source_tool} />
                    )}
                    {parsedNote.properties.generated_at && (
                      <MetadataPill label="Generated at" value={parsedNote.properties.generated_at} />
                    )}
                    {parsedNote.properties.status && (
                      <MetadataPill label="Status" value={parsedNote.properties.status} />
                    )}
                    {parsedNote.properties.citations_count && (
                      <MetadataPill label="Citations" value={parsedNote.properties.citations_count} />
                    )}
                  </div>
                )}
                {selectedNote.endsWith('.canvas') && canvasPreview?.widgetdc && (
                  <div className="space-y-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      {canvasPreview.widgetdc.widgetdc_kind && (
                        <MetadataPill label="Artifact kind" value={canvasPreview.widgetdc.widgetdc_kind} />
                      )}
                      {canvasPreview.widgetdc.client && (
                        <MetadataPill label="Client" value={canvasPreview.widgetdc.client} />
                      )}
                      {canvasPreview.widgetdc.canvas_template_id && (
                        <MetadataPill label="Canvas template" value={canvasPreview.widgetdc.canvas_template_id} />
                      )}
                      <MetadataPill label="Nodes" value={String(canvasPreview.nodesCount)} />
                      <MetadataPill label="Edges" value={String(canvasPreview.edgesCount)} />
                    </div>
                  </div>
                )}
                {visualizationContract && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-sky-600 text-white">{visualizationContract.family}</Badge>
                      <Badge variant="outline">{visualizationContract.templateId}</Badge>
                      <Badge variant="outline">audience: {visualizationContract.audience}</Badge>
                      <Badge variant="outline">abstraction: {visualizationContract.abstractionLevel}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-sky-900">{visualizationContract.rationale}</p>
                  </div>
                )}
                {lineageChain.length > 0 && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Lineage</p>
                    {lineageMetrics && (
                      <div className="mt-3 grid gap-2 md:grid-cols-4">
                        <MetadataPill label="Refinement hops" value={String(lineageMetrics.hops)} />
                        <MetadataPill label="Latest mode" value={lineageMetrics.latestMode} />
                        <MetadataPill label="Head status" value={lineageMetrics.headStatus} />
                        <MetadataPill label="Current head" value={lineageMetrics.headPath === selectedNote ? 'Yes' : 'No'} />
                      </div>
                    )}
                    {outcomeSignals && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <OutcomeBadge tone={outcomeSignals.maturity}>{outcomeSignals.maturity}</OutcomeBadge>
                        <OutcomeBadge tone={outcomeSignals.evidence}>{outcomeSignals.evidence} evidence</OutcomeBadge>
                        <Badge variant="outline">{outcomeSignals.isHeadSelected ? 'selected = head' : 'selected ≠ head'}</Badge>
                        <Badge variant="outline">{outcomeSignals.isRootSelected ? 'selected = root' : 'selected ≠ root'}</Badge>
                      </div>
                    )}
                    {nextAction && (
                      <div className="mt-3 rounded-lg border border-violet-300 bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="bg-violet-600 text-white">{nextAction.label}</Badge>
                          <Badge variant="outline">{nextAction.action}</Badge>
                          <NextActionConfidenceBadge confidence={nextAction.confidence} />
                          {nextAction.action !== 'done' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleRecommendedAction()}
                              disabled={!selectedNote || !selectedBody.trim() || isRoundtripping}
                            >
                              Run recommended action
                            </Button>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-violet-900">{nextAction.rationale}</p>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {lineageChain.map((entry, index) => (
                        <div key={entry.path} className="flex items-center gap-2">
                          <button
                            type="button"
                            className={`rounded-md border px-3 py-1 text-xs ${entry.path === selectedNote ? 'border-violet-500 bg-violet-100 text-violet-900' : 'border-violet-200 bg-white text-violet-700'}`}
                            onClick={() => setSelectedNote(entry.path)}
                          >
                            {(entry.properties.refinement_mode ?? 'root').toUpperCase()} · {entry.path.split('/').at(-1)?.replace(/\.(md|canvas)$/i, '') ?? entry.path}
                          </button>
                          {index < lineageChain.length - 1 && <span className="text-violet-500">→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-72 whitespace-pre-wrap font-mono leading-relaxed">
                  {selectedNote.endsWith('.canvas')
                    ? `${noteContent.content.slice(0, 3000)}${noteContent.content.length > 3000 ? '\n\n…(truncated at 3000 chars)' : ''}`
                    : `${parsedNote?.body.slice(0, 3000) ?? ''}${(parsedNote?.body.length ?? 0) > 3000 ? '\n\n…(truncated at 3000 chars)' : ''}`}
                </pre>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                Click a note in the explorer or search results
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80">
        <CardHeader>
          <CardTitle>Roundtrip to orchestrator</CardTitle>
          <CardDescription>Send the selected note or canvas back into the proof engine for analysis or document generation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={roundtripMode} onValueChange={(value) => setRoundtripMode(value as 'analyze' | 'deliverable')}>
            <TabsList>
              <TabsTrigger value="analyze">Analyze</TabsTrigger>
              <TabsTrigger value="deliverable">Generate deliverable</TabsTrigger>
            </TabsList>
          </Tabs>

          {activeRoundtripJob ? (
            <JobProgress job={activeRoundtripJob} />
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Select an artifact, then route it back into the orchestrator.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">{selectedNote ? selectedNote : 'No artifact selected'}</Badge>
            {visualizationContract && <Badge variant="outline">{visualizationContract.templateId}</Badge>}
            <Button onClick={() => void handleRoundtrip()} disabled={!selectedNote || !selectedBody.trim() || isRoundtripping}>
              {isRoundtripping
                ? (roundtripMode === 'analyze' ? 'Analyzing...' : 'Generating...')
                : (roundtripMode === 'analyze' ? 'Analyze selected artifact' : 'Generate deliverable from artifact')}
            </Button>
          </div>

          {roundtripError && (
            <Alert>
              <AlertTitle>Roundtrip failed</AlertTitle>
              <AlertDescription>{roundtripError}</AlertDescription>
            </Alert>
          )}

          {roundtripResponse && (
            <div className="space-y-4">
              <AgentResponseCard
                response={roundtripResponse}
                title={roundtripMode === 'analyze' ? 'Obsidian artifact analysis' : 'Obsidian artifact deliverable'}
              />
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Materialize refinement</CardTitle>
                  <CardDescription>Write the roundtrip result back to Obsidian as the next artifact version.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {roundtripNoteProperties && (
                      <SendToObsidianButton
                        title={refinementTitle}
                        kind={roundtripMode === 'deliverable' ? 'deliverable_draft' : 'knowledge_artifact'}
                        folder={roundtripMode === 'deliverable' ? 'WidgeTDC/Deliverables/Refinements' : 'WidgeTDC/Knowledge/Refinements'}
                        contentMarkdown={roundtripResponse.output}
                        properties={roundtripNoteProperties}
                      />
                    )}
                    {roundtripCanvasPayload && <SendCanvasToObsidianButton payload={roundtripCanvasPayload} />}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/obsidian')({
  component: ObsidianPage,
})
