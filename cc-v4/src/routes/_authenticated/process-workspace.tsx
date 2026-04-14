import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, normalizeError } from '@/lib/api-client'
import { useSessionStore } from '@/stores/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SendToObsidianButton } from '@/components/shared/SendToObsidianButton'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GitBranch,
  Layers,
  Link2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

type Engagement = {
  $id: string
  client: string
  domain: string
  objective: string
}

type StandardLibrary = {
  pack_id: string
  version: string
  title: string
  family: 'structural' | 'control' | 'method'
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
    structural: string
    control: string
    method: string
    coverage_score: number
    matched_standard_refs: string[]
  }
  evidence: Array<{ id: string; title: string; kind: string }>
  technology_links: Array<{ id: string; title: string; kind: string; support_score: number }>
}

type ProcessTree = {
  engagement_id: string
  client: string
  domain: string
  mode: 'inferred' | 'curated'
  nodes: ProcessNode[]
  summary: {
    total_nodes: number
    curated_nodes: number
    inferred_nodes: number
    avg_coverage_score: number
  }
}

function AlignmentBadge({ value }: { value: string }) {
  const variant = value === 'matched'
    ? 'default'
    : value === 'partial' || value === 'custom'
      ? 'secondary'
      : 'destructive'

  return <Badge variant={variant}>{value.replace('_', ' ')}</Badge>
}

function WorkspaceStat({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub: string
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function averageSupportScore(links: ProcessNode['technology_links']) {
  if (links.length === 0) return 0
  return Number(
    (links.reduce((sum, entry) => sum + entry.support_score, 0) / links.length).toFixed(2),
  )
}

function describeDeviation(node: ProcessNode) {
  const gaps = [
    node.alignment.structural !== 'matched' ? `structural:${node.alignment.structural}` : null,
    node.alignment.control !== 'matched' ? `control:${node.alignment.control}` : null,
    node.alignment.method !== 'matched' ? `method:${node.alignment.method}` : null,
  ].filter(Boolean)

  return gaps.length > 0 ? gaps.join(', ') : 'none'
}

function buildProcessDocMarkdown(engagement: Engagement, node: ProcessNode) {
  const evidence = node.evidence
    .map((entry) => `- ${entry.title} \`${entry.kind}\``)
    .join('\n')
  const technology = node.technology_links
    .map((entry) => `- ${entry.title} \`${entry.kind}\` · support ${entry.support_score}`)
    .join('\n')
  const standards = node.alignment.matched_standard_refs
    .map((ref) => `- ${ref}`)
    .join('\n')

  return `# ${node.title}

## Process summary
- Process ID: \`${node.process_id}\`
- Engagement: \`${engagement.$id}\`
- Client: ${engagement.client}
- Domain: ${engagement.domain}
- Phase: ${node.phase}
- Status: ${node.status}
- Confidence: ${node.confidence}
- Coverage score: ${node.alignment.coverage_score}

## Alignment
- Structural: ${node.alignment.structural}
- Control: ${node.alignment.control}
- Method: ${node.alignment.method}

## Standard references
${standards || '- none'}

## Evidence
${evidence || '- none'}

## Technology linkage
${technology || '- none'}
`
}

function ProcessWorkspacePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const engagementId = useSessionStore((state) => state.engagementId)
  const setEngagementId = useSessionStore((state) => state.setEngagementId)
  const setActiveClient = useSessionStore((state) => state.setActiveClient)
  const [mode, setMode] = useState<'inferred' | 'curated'>('inferred')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const engagementsQuery = useQuery<{ success: boolean; data: Engagement[] }>({
    queryKey: ['process-workspace-engagements'],
    queryFn: () => apiGet('/api/engagements?limit=20'),
  })

  const activeEngagement = useMemo(() => {
    const items = engagementsQuery.data?.data ?? []
    if (!items.length) return null
    return items.find((engagement) => engagement.$id === engagementId) ?? items[0]
  }, [engagementId, engagementsQuery.data?.data])

  useEffect(() => {
    if (!activeEngagement) return
    if (activeEngagement.$id !== engagementId) setEngagementId(activeEngagement.$id)
    setActiveClient(activeEngagement.client)
  }, [activeEngagement, engagementId, setActiveClient, setEngagementId])

  const librariesQuery = useQuery<{ success: boolean; data: { libraries: StandardLibrary[] } }>({
    queryKey: ['process-libraries'],
    queryFn: () => apiGet('/api/processes/libraries'),
  })

  const treeQuery = useQuery<{ success: boolean; data: ProcessTree }>({
    queryKey: ['process-tree', activeEngagement?.$id, mode],
    enabled: Boolean(activeEngagement?.$id),
    queryFn: () => apiGet(`/api/processes/tree?engagement_id=${encodeURIComponent(activeEngagement!.$id)}&mode=${mode}`),
  })

  const inferMutation = useMutation({
    mutationFn: async () => {
      if (!activeEngagement) throw new Error('No active engagement')
      return apiPost('/api/processes/infer', { engagement_id: activeEngagement.$id })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['process-tree', activeEngagement?.$id] })
    },
  })

  const curateMutation = useMutation({
    mutationFn: async (processId: string) => {
      if (!activeEngagement) throw new Error('No active engagement')
      return apiPost('/api/processes/curate', { engagement_id: activeEngagement.$id, process_id: processId })
    },
    onSuccess: async (_, processId) => {
      setMode('curated')
      setSelectedNodeId(processId)
      await queryClient.invalidateQueries({ queryKey: ['process-tree', activeEngagement?.$id] })
    },
  })

  const tree = treeQuery.data?.data
  const selectedNode = useMemo(() => {
    const nodes = tree?.nodes ?? []
    if (!nodes.length) return null
    return nodes.find((node) => node.process_id === selectedNodeId) ?? nodes[0]
  }, [selectedNodeId, tree?.nodes])

  useEffect(() => {
    if (selectedNode || !(tree?.nodes?.length)) return
    setSelectedNodeId(tree.nodes[0].process_id)
  }, [selectedNode, tree?.nodes])

  const queryError = treeQuery.error ? normalizeError(treeQuery.error).message : null
  const processDocProperties = selectedNode && activeEngagement
    ? {
        process_id: selectedNode.process_id,
        library_tier: 'engagement',
        process_level: selectedNode.phase,
        parent_process_id: selectedNode.parent_process_id,
        industry_profile: activeEngagement.domain,
        pack_id: 'apqc-cross-industry',
        pack_version: '1.0.0',
        matched_standard_refs: selectedNode.alignment.matched_standard_refs.join(', '),
        coverage_score: selectedNode.alignment.coverage_score,
        alignment_score: selectedNode.alignment.coverage_score,
        deviation_reason: describeDeviation(selectedNode),
        technology_support_score: averageSupportScore(selectedNode.technology_links),
        control_support_score:
          selectedNode.alignment.control === 'matched'
            ? 0.92
            : selectedNode.alignment.control === 'partial'
              ? 0.72
              : 0.48,
        engagement_id: activeEngagement.$id,
        client: activeEngagement.client,
        source_tool: 'process_workspace',
        status: selectedNode.status,
        visualization_family: 'process_documentation',
        template_id: 'obsidian.process.documentation.v1',
      }
    : undefined

  return (
    <div className="flex flex-col gap-6 p-8">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
            <GitBranch className="h-4 w-4" />
            Workspace Mode
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Process Workspace</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Infer a client process tree, curate approved nodes, and compare the engagement against structural, control,
            and method standard packs inside the new shell.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/engagement-workspace' })}>
            Engagement Workspace
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/obsidian' })}>
            Obsidian Docs
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/project-board' })}>
            Project Board
          </Button>
        </div>
      </section>

      {queryError && (
        <Alert variant="destructive">
          <AlertTitle>Process workspace failed</AlertTitle>
          <AlertDescription>{queryError}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Engagement context</CardTitle>
            <CardDescription>The process model runs against the active engagement and its standard overlays.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            {!activeEngagement ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24 w-full" />)
            ) : (
              <>
                <WorkspaceStat label="Client" value={activeEngagement.client} sub={activeEngagement.domain} />
                <WorkspaceStat label="Mode" value={mode} sub="Inferred or curated process truth" />
                <WorkspaceStat
                  label="Coverage"
                  value={tree?.summary.avg_coverage_score ?? '—'}
                  sub="Average standard alignment coverage"
                />
                <WorkspaceStat
                  label="Curated"
                  value={tree?.summary.curated_nodes ?? 0}
                  sub={`${tree?.summary.inferred_nodes ?? 0} inferred nodes still pending`}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Standard packs</CardTitle>
            <CardDescription>Mixed packs are kept explicit: one structural backbone plus control and method overlays.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {librariesQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)
            ) : (
              (librariesQuery.data?.data.libraries ?? []).map((library) => (
                <div key={library.pack_id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{library.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{library.description}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge variant={library.primary ? 'default' : 'secondary'}>{library.family}</Badge>
                      <span className="text-[11px] text-muted-foreground">v{library.version}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <Tabs value={mode} onValueChange={(next) => setMode(next as 'inferred' | 'curated')} className="space-y-4">
        <TabsList>
          <TabsTrigger value="inferred">Inferred tree</TabsTrigger>
          <TabsTrigger value="curated">Curated tree</TabsTrigger>
        </TabsList>

        <TabsContent value="inferred" className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle>Inferred process tree</CardTitle>
                  <CardDescription>Machine-generated process candidates with confidence and alignment signals.</CardDescription>
                </div>
                <Button onClick={() => inferMutation.mutate()} disabled={!activeEngagement || inferMutation.isPending}>
                  {inferMutation.isPending ? 'Inferring…' : 'Refresh inference'}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {treeQuery.isLoading ? (
                  Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24 w-full" />)
                ) : (
                  (tree?.nodes ?? []).map((node) => (
                    <button
                      key={node.process_id}
                      type="button"
                      onClick={() => setSelectedNodeId(node.process_id)}
                      className={`w-full rounded-lg border p-4 text-left transition ${
                        selectedNode?.process_id === node.process_id ? 'border-primary bg-primary/5' : 'hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{node.phase}. {node.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Confidence {node.confidence} · Coverage {node.alignment.coverage_score}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <AlignmentBadge value={node.alignment.structural} />
                          <AlignmentBadge value={node.alignment.control} />
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Node detail</CardTitle>
                <CardDescription>Confidence, standard alignment, evidence, and technology support for the selected node.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!selectedNode ? (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    Select a process node to inspect its alignment and curation options.
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{selectedNode.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{selectedNode.process_id}</div>
                        </div>
                        <Badge variant="secondary">{selectedNode.status}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <AlignmentBadge value={selectedNode.alignment.structural} />
                        <AlignmentBadge value={selectedNode.alignment.control} />
                        <AlignmentBadge value={selectedNode.alignment.method} />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border p-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Layers className="h-4 w-4 text-muted-foreground" />
                          Evidence
                        </div>
                        <div className="mt-3 space-y-2 text-sm">
                          {selectedNode.evidence.map((entry) => (
                            <div key={entry.id} className="rounded-md bg-muted/20 px-3 py-2">
                              <div className="font-medium">{entry.title}</div>
                              <div className="text-xs text-muted-foreground">{entry.kind}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-lg border p-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                          Technology links
                        </div>
                        <div className="mt-3 space-y-2 text-sm">
                          {selectedNode.technology_links.map((entry) => (
                            <div key={entry.id} className="rounded-md bg-muted/20 px-3 py-2">
                              <div className="font-medium">{entry.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {entry.kind} · support {entry.support_score}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border p-4">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                        Standard references
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedNode.alignment.matched_standard_refs.map((ref) => (
                          <Badge key={ref} variant="outline">{ref}</Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => curateMutation.mutate(selectedNode.process_id)}
                        disabled={curateMutation.isPending}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {curateMutation.isPending ? 'Curating…' : 'Approve into curated tree'}
                      </Button>
                      <Button variant="outline" onClick={() => navigate({ to: '/obsidian' })}>
                        <BookOpen className="mr-2 h-4 w-4" />
                        Open process docs
                      </Button>
                      <Button variant="outline" onClick={() => navigate({ to: '/project-board' })}>
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Go to execution board
                      </Button>
                    </div>
                    <div className="rounded-lg border border-dashed p-4">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                        Canonical process documentation
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Curated process truth should materialize into one canonical Obsidian process note per node.
                      </p>
                      <div className="mt-3">
                        <SendToObsidianButton
                          title={`${activeEngagement?.client ?? 'engagement'} ${selectedNode.title}`}
                          kind="process_doc"
                          folder="WidgeTDC/Process Docs"
                          contentMarkdown={
                            activeEngagement
                              ? buildProcessDocMarkdown(activeEngagement, selectedNode)
                              : ''
                          }
                          properties={processDocProperties}
                          disabled={selectedNode.status !== 'curated' || !activeEngagement}
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        <TabsContent value="curated" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Curated process tree</CardTitle>
              <CardDescription>Consultant-approved process truth for this engagement.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {treeQuery.isLoading ? (
                Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24 w-full" />)
              ) : tree && tree.nodes.length > 0 ? (
                tree.nodes.map((node) => (
                  <div key={node.process_id} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{node.phase}. {node.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Coverage {node.alignment.coverage_score} · {node.technology_links.length} technology links
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Badge>{node.status}</Badge>
                        <AlignmentBadge value={node.alignment.structural} />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No curated nodes yet. Approve one or more inferred nodes to create the first declared process truth.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/process-workspace')({
  component: ProcessWorkspacePage,
})
