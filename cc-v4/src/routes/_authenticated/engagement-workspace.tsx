import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost, normalizeError } from '@/lib/api-client'
import { useSessionStore } from '@/stores/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  ArrowRight,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CheckCircle2,
  FileStack,
  GitBranch,
  KanbanSquare,
  Network,
  NotebookPen,
  RefreshCw,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react'

type EngagementStatus = 'draft' | 'active' | 'completed' | 'cancelled'

type Engagement = {
  $id: string
  client: string
  domain: string
  objective: string
  start_date: string
  target_end_date: string
  budget_dkk?: number
  team_size?: number
  status: EngagementStatus
  methodology_refs: string[]
  created_at: string
}

type EngagementMatch = {
  engagement_id: string
  title: string
  domain: string
  similarity: number
  match_reasoning: string
}

type EngagementPlan = {
  engagement_id: string
  phases: Array<{
    name: string
    duration_weeks: number
    deliverables: string[]
    methodology: string
  }>
  risks: Array<{
    description: string
    severity: 'high' | 'medium' | 'low'
    mitigation: string
  }>
  total_citations: number
}

type KnowledgeFeed = {
  generated_at: string
  graph_pulse?: { total_nodes?: number } | null
  top_insights?: Array<{ id: string; title: string; summary: string; domain: string }>
  gap_alerts?: Array<{ id: string; title: string; summary: string }>
}

type AdoptionMetrics = {
  adoption_rate_percent?: number
  tools_called_at_least_once?: number
}

type ApiEnvelope<T> = { success: boolean; data: T }
type ApiErrorInfo = { message: string; status?: number; isOffline: boolean; isRetryable: boolean }

function formatStatus(status: EngagementStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatDate(value: string | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

function formatBudget(value?: number) {
  if (!value) return '—'
  return `${Math.round(value / 1000)}K DKK`
}

function WorkspaceMetric({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function EngagementWorkspacePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const engagementId = useSessionStore((state) => state.engagementId)
  const setEngagementId = useSessionStore((state) => state.setEngagementId)
  const activeClient = useSessionStore((state) => state.activeClient)
  const setActiveClient = useSessionStore((state) => state.setActiveClient)

  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [matchResults, setMatchResults] = useState<EngagementMatch[]>([])
  const [generatedPlan, setGeneratedPlan] = useState<EngagementPlan | null>(null)
  const [draftClient, setDraftClient] = useState(activeClient ?? '')
  const [draftDomain, setDraftDomain] = useState('AI Governance')
  const [draftObjective, setDraftObjective] = useState('')
  const [draftStartDate, setDraftStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [draftTargetEndDate, setDraftTargetEndDate] = useState(new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10))
  const [draftBudget, setDraftBudget] = useState('450000')
  const [draftTeamSize, setDraftTeamSize] = useState('4')
  const [draftMethodologies, setDraftMethodologies] = useState('Double Diamond, NIST AI RMF, CMMI')

  const engagementsQuery = useQuery<Engagement[]>({
    queryKey: ['engagements', 'workspace'],
    queryFn: async () => {
      try {
        setApiError(null)
        const response = await apiGet<{ success: boolean; data: Engagement[] }>('/api/engagements?limit=20')
        return response.data ?? []
      } catch (error) {
        const nextError = normalizeError(error)
        setApiError(nextError)
        throw error
      }
    },
    refetchInterval: 30000,
  })

  const selectedEngagement = useMemo(() => {
    const items = engagementsQuery.data ?? []
    if (!items.length) return null
    if (engagementId) return items.find((item) => item.$id === engagementId) ?? items[0]
    return items[0]
  }, [engagementId, engagementsQuery.data])

  useEffect(() => {
    if (!selectedEngagement) return
    if (selectedEngagement.$id !== engagementId) setEngagementId(selectedEngagement.$id)
    if (selectedEngagement.client !== activeClient) setActiveClient(selectedEngagement.client)
    if (!draftObjective) {
      setDraftObjective(selectedEngagement.objective)
      setDraftClient(selectedEngagement.client)
      setDraftDomain(selectedEngagement.domain)
    }
  }, [activeClient, draftObjective, engagementId, selectedEngagement, setActiveClient, setEngagementId])

  const knowledgeFeedQuery = useQuery<KnowledgeFeed>({
    queryKey: ['knowledge-feed', 'workspace'],
    queryFn: () => apiGet<KnowledgeFeed>('/api/knowledge/feed'),
    refetchInterval: 60000,
  })

  const adoptionQuery = useQuery<AdoptionMetrics>({
    queryKey: ['adoption-metrics', 'workspace'],
    queryFn: () => apiGet<AdoptionMetrics>('/api/adoption/metrics'),
    refetchInterval: 60000,
  })

  const storedPlanQuery = useQuery<EngagementPlan | null>({
    queryKey: ['engagement-plan', selectedEngagement?.$id],
    enabled: !!selectedEngagement?.$id,
    queryFn: async () => {
      try {
        const response = await apiGet<ApiEnvelope<EngagementPlan>>(`/api/engagements/${selectedEngagement?.$id}/plan`)
        return response.data
      } catch {
        return null
      }
    },
  })

  useEffect(() => {
    if (storedPlanQuery.data) setGeneratedPlan(storedPlanQuery.data)
  }, [storedPlanQuery.data])

  const createEngagementMutation = useMutation({
    mutationFn: async () => apiPost<ApiEnvelope<Engagement>>('/api/engagements', {
      client: draftClient.trim(),
      domain: draftDomain.trim(),
      objective: draftObjective.trim(),
      start_date: draftStartDate,
      target_end_date: draftTargetEndDate,
      budget_dkk: Number(draftBudget) || undefined,
      team_size: Number(draftTeamSize) || undefined,
      methodology_refs: draftMethodologies.split(',').map((item) => item.trim()).filter(Boolean),
    }),
    onSuccess: (response) => {
      const engagement = response.data
      setEngagementId(engagement.$id)
      setActiveClient(engagement.client)
      queryClient.invalidateQueries({ queryKey: ['engagements', 'workspace'] })
    },
    onError: (error) => setApiError(normalizeError(error)),
  })

  const matchMutation = useMutation({
    mutationFn: async (engagement: Engagement) => {
      const response = await apiPost<ApiEnvelope<{ matches: EngagementMatch[] }>>('/api/engagements/match', {
        objective: engagement.objective,
        domain: engagement.domain,
        max_results: 5,
      })
      return response.data.matches
    },
    onMutate: () => {
      setMatchError(null)
      setMatchResults([])
    },
    onSuccess: (matches) => setMatchResults(matches),
    onError: (error) => setMatchError(error instanceof Error ? error.message : String(error)),
  })

  const planMutation = useMutation({
    mutationFn: async (engagement: Engagement) => {
      const durationWeeks = Math.max(1, Math.ceil((new Date(engagement.target_end_date).getTime() - new Date(engagement.start_date).getTime()) / (1000 * 60 * 60 * 24 * 7)))
      const response = await apiPost<ApiEnvelope<EngagementPlan>>('/api/engagements/plan', {
        engagement_id: engagement.$id,
        objective: engagement.objective,
        domain: engagement.domain,
        duration_weeks: durationWeeks,
        team_size: engagement.team_size ?? 4,
        budget_dkk: engagement.budget_dkk ?? 0,
      })
      return response.data
    },
    onMutate: () => setPlanError(null),
    onSuccess: (plan) => {
      setGeneratedPlan(plan)
      queryClient.invalidateQueries({ queryKey: ['engagement-plan', plan.engagement_id] })
    },
    onError: (error) => setPlanError(error instanceof Error ? error.message : String(error)),
  })

  const insights = knowledgeFeedQuery.data?.top_insights ?? []
  const gapAlerts = knowledgeFeedQuery.data?.gap_alerts ?? []

  return (
    <div className="flex flex-col gap-6 p-8">
      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <Card className="border-border/80">
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <BriefcaseBusiness className="h-4 w-4" />
              Consultant Operating Surface
            </div>
            <CardTitle className="text-3xl">Engagement Workspace</CardTitle>
            <CardDescription className="max-w-3xl">
              One shell for engagement framing, precedent retrieval, structured planning, proof-flow handoff, and deep-work continuation.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <WorkspaceMetric label="Engagements" value={engagementsQuery.data?.length ?? 0} sub="Tracked advisory work" />
            <WorkspaceMetric label="Knowledge Pulse" value={knowledgeFeedQuery.data?.graph_pulse?.total_nodes?.toLocaleString() ?? '—'} sub="Graph-backed context nodes" />
            <WorkspaceMetric label="Adoption" value={`${Math.round(adoptionQuery.data?.adoption_rate_percent ?? 0)}%`} sub={`${adoptionQuery.data?.tools_called_at_least_once ?? 0} tools used`} />
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-lg">Workspace principles</CardTitle>
            <CardDescription>The route is opinionated: engagement-first, evidence-first, and deliverable-oriented.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-lg border bg-muted/30 p-4">
              Start from a named engagement, not a blank prompt. Every recommendation should know who it is for and what decision it is trying to move.
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              Use precedents and plans before deep drafting. The shell should narrow the problem before the deliverable factory writes anything.
            </div>
          </CardContent>
        </Card>
      </section>

      {apiError && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Workspace API issue</AlertTitle>
          <AlertDescription>{apiError.message}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="h-4 w-4" />
              Engagement context
            </CardTitle>
            <CardDescription>Select an active engagement or create a new draft to scope the workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {engagementsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
              </div>
            ) : (
              <div className="space-y-3">
                {(engagementsQuery.data ?? []).map((engagement) => {
                  const isActive = engagement.$id === selectedEngagement?.$id
                  return (
                    <button
                      key={engagement.$id}
                      type="button"
                      className={`w-full rounded-lg border p-4 text-left transition-colors ${isActive ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                      onClick={() => {
                        setEngagementId(engagement.$id)
                        setActiveClient(engagement.client)
                        setMatchResults([])
                        setGeneratedPlan(null)
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{engagement.objective}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{engagement.client} · {engagement.domain}</div>
                        </div>
                        <Badge variant={isActive ? 'default' : 'outline'}>{formatStatus(engagement.status)}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(engagement.start_date)} → {formatDate(engagement.target_end_date)}</span>
                        <span>Budget {formatBudget(engagement.budget_dkk)}</span>
                        <span>Team {engagement.team_size ?? '—'}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="rounded-lg border border-dashed p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Create engagement draft</h3>
                  <p className="text-xs text-muted-foreground">Seed the workspace with one concrete advisory mission.</p>
                </div>
                <Button size="sm" onClick={() => createEngagementMutation.mutate()} disabled={createEngagementMutation.isPending || draftObjective.trim().length < 10 || draftClient.trim().length < 2}>
                  {createEngagementMutation.isPending ? 'Creating…' : 'Create draft'}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="workspace-client">Client</Label>
                  <Input id="workspace-client" value={draftClient} onChange={(event) => setDraftClient(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-domain">Domain</Label>
                  <Input id="workspace-domain" value={draftDomain} onChange={(event) => setDraftDomain(event.target.value)} />
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <Label htmlFor="workspace-objective">Objective</Label>
                <Textarea id="workspace-objective" value={draftObjective} onChange={(event) => setDraftObjective(event.target.value)} className="min-h-[96px]" placeholder="Define the target decision or transformation outcome." />
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-start">Start date</Label>
                  <Input id="workspace-start" type="date" value={draftStartDate} onChange={(event) => setDraftStartDate(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-target">Target end</Label>
                  <Input id="workspace-target" type="date" value={draftTargetEndDate} onChange={(event) => setDraftTargetEndDate(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-budget">Budget DKK</Label>
                  <Input id="workspace-budget" value={draftBudget} onChange={(event) => setDraftBudget(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-team">Team size</Label>
                  <Input id="workspace-team" value={draftTeamSize} onChange={(event) => setDraftTeamSize(event.target.value)} />
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <Label htmlFor="workspace-methodologies">Methodology refs</Label>
                <Input id="workspace-methodologies" value={draftMethodologies} onChange={(event) => setDraftMethodologies(event.target.value)} placeholder="Comma-separated methodologies" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active engagement brief</CardTitle>
            <CardDescription>Selected engagement drives precedents, plan generation, and downstream proof/deep-work flows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedEngagement ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No engagement selected yet.</div>
            ) : (
              <>
                <div className="rounded-xl border bg-muted/20 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{selectedEngagement.client}</Badge>
                    <Badge variant="outline">{selectedEngagement.domain}</Badge>
                    <Badge variant="outline">{formatStatus(selectedEngagement.status)}</Badge>
                  </div>
                  <h2 className="mt-3 text-xl font-semibold">{selectedEngagement.objective}</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <WorkspaceMetric label="Timeline" value={`${formatDate(selectedEngagement.start_date)} → ${formatDate(selectedEngagement.target_end_date)}`} sub="Planned engagement window" />
                    <WorkspaceMetric label="Budget" value={formatBudget(selectedEngagement.budget_dkk)} sub="Commercial envelope" />
                    <WorkspaceMetric label="Methods" value={selectedEngagement.methodology_refs.length || 0} sub="Referenced methodologies" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => matchMutation.mutate(selectedEngagement)} disabled={matchMutation.isPending}>
                    <GitBranch className="mr-2 h-4 w-4" />
                    {matchMutation.isPending ? 'Finding precedents…' : 'Find precedents'}
                  </Button>
                  <Button onClick={() => planMutation.mutate(selectedEngagement)} disabled={planMutation.isPending}>
                    <Brain className="mr-2 h-4 w-4" />
                    {planMutation.isPending ? 'Generating plan…' : 'Generate structured plan'}
                  </Button>
                  <Button variant="ghost" onClick={() => engagementsQuery.refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh context
                  </Button>
                </div>
                {matchError && <Alert variant="destructive"><AlertDescription>{matchError}</AlertDescription></Alert>}
                {planError && <Alert variant="destructive"><AlertDescription>{planError}</AlertDescription></Alert>}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Network className="h-4 w-4" />
              Truth room
            </CardTitle>
            <CardDescription>Graph pulse, top insights, and explicit gap signals from the knowledge fabric.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {knowledgeFeedQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <WorkspaceMetric label="Insights" value={insights.length} sub="High-signal graph cards" />
                  <WorkspaceMetric label="Gap alerts" value={gapAlerts.length} sub="Potential missing evidence" />
                  <WorkspaceMetric label="Feed age" value={knowledgeFeedQuery.data?.generated_at ? formatDate(knowledgeFeedQuery.data.generated_at) : '—'} sub="Last generated" />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Top insights</h3>
                    {insights.slice(0, 4).map((insight) => (
                      <div key={insight.id} className="rounded-lg border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{insight.title}</div>
                          <Badge variant="outline">{insight.domain}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{insight.summary || 'No summary provided.'}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Gap alerts</h3>
                    {gapAlerts.slice(0, 4).map((gap) => (
                      <div key={gap.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                          <TriangleAlert className="h-4 w-4" />
                          {gap.title}
                        </div>
                        <p className="mt-2 text-sm text-amber-900/80">{gap.summary || 'Missing evidence should be resolved before final delivery.'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-4 w-4" />
              Consultant actions
            </CardTitle>
            <CardDescription>Use precedents, generate a plan, then hand off to proof or deep-work surfaces without losing engagement context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <button type="button" className="flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent" onClick={() => navigate({ to: '/deliverable/draft' })}>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><FileStack className="h-4 w-4" />Deliverable Studio</div>
                  <p className="mt-1 text-sm text-muted-foreground">Draft the client-facing output after precedents and plan are in place.</p>
                </div>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button type="button" className="flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent" onClick={() => navigate({ to: '/compliance/audit' })}>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4" />Compliance Audit</div>
                  <p className="mt-1 text-sm text-muted-foreground">Run a proof-facing audit for the same client context.</p>
                </div>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button type="button" className="flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent" onClick={() => navigate({ to: '/obsidian' })}>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><NotebookPen className="h-4 w-4" />Obsidian Deep Work</div>
                  <p className="mt-1 text-sm text-muted-foreground">Continue synthesis, canvas mapping, and refinement lineage in the vault.</p>
                </div>
                <ArrowRight className="h-4 w-4" />
              </button>

              <button type="button" className="flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent" onClick={() => navigate({ to: '/project-board' })}>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><KanbanSquare className="h-4 w-4" />Execution Board</div>
                  <p className="mt-1 text-sm text-muted-foreground">Move approved recommendations into accountable work on the board.</p>
                </div>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><GitBranch className="h-4 w-4" />Precedents</CardTitle>
            <CardDescription>Similar engagements and why they matter for the selected mission.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {matchMutation.isPending ? (
              Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)
            ) : matchResults.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No precedents loaded yet. Run precedent matching from the active engagement brief.
              </div>
            ) : (
              matchResults.map((match) => (
                <div key={`${match.engagement_id}-${match.title}`} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">{match.title}</div>
                    <Badge variant="outline">{Math.round(match.similarity * 100)}%</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{match.domain}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{match.match_reasoning}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><BookOpen className="h-4 w-4" />Structured plan</CardTitle>
            <CardDescription>Phased consulting plan synthesized from the selected engagement context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {planMutation.isPending && <Skeleton className="h-40 w-full" />}
            {!planMutation.isPending && !generatedPlan && (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No structured plan loaded yet. Generate one from the engagement brief.
              </div>
            )}
            {generatedPlan && (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <WorkspaceMetric label="Phases" value={generatedPlan.phases.length} sub="Structured delivery path" />
                  <WorkspaceMetric label="Risks" value={generatedPlan.risks.length} sub="Captured execution risks" />
                  <WorkspaceMetric label="Citations" value={generatedPlan.total_citations} sub="Evidence references used" />
                </div>
                <div className="space-y-3">
                  {generatedPlan.phases.map((phase) => (
                    <div key={`${generatedPlan.engagement_id}-${phase.name}`} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{phase.name}</div>
                        <Badge variant="outline">{phase.duration_weeks}w</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{phase.methodology}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {phase.deliverables.map((deliverable) => (
                          <Badge key={deliverable} variant="secondary">{deliverable}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/engagement-workspace')({
  component: EngagementWorkspacePage,
})
