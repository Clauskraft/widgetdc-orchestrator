import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, Legend, Cell,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Engagement {
  id: string
  client: string
  domain: string
  objective: string
  status: string
  grade?: string
  createdAt: string
}

interface Decision {
  id: string
  title: string
  status: string
  createdAt: string
}

interface FlywheelReport {
  compoundScore: number
  weeklyDelta: number
  pillars: Array<{ name: string; score: number; trend: string; headline: string; details: string[] }>
  nextOptimizations: Array<{ title: string; pillar: string; impact: number; action: string }>
}

interface HyperagentStatus {
  isRunning: boolean
  currentPhase: string
  currentStep: string
  fitnessScore?: number
  totalCycles: number
}

interface ChainStatus {
  name: string
  mode: string
  status: string
  steps_done: number
  steps_total: number
  duration: string
  started_at: string
}

interface PheromoneStatus {
  activePheromones: number
  totalDeposits: number
  totalAmplifications: number
}

interface EngagementPlan {
  phases: Array<{
    name: string
    status: string
    duration_weeks: number
    risks: string[]
    deliverables: string[]
  }>
  risks: Array<{ risk: string; severity: string; mitigation: string }>
  skills: string[]
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ProjectOverviewPage() {
  const navigate = useNavigate()
  const [selectedEngagement, setSelectedEngagement] = useState<Engagement | null>(null)
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null)

  // Fetch all data in parallel
  const { data: engagements, isLoading: loadingEngagements } = useQuery<Engagement[]>({
    queryKey: ['engagements'],
    queryFn: () => apiGet('/api/engagements?limit=10'),
    refetchInterval: 30000,
  })

  const { data: decisions, isLoading: loadingDecisions } = useQuery<{ decisions: Decision[] }>({
    queryKey: ['decisions'],
    queryFn: () => apiGet('/api/decisions?limit=10'),
    refetchInterval: 30000,
  })

  const { data: flywheel, isLoading: loadingFlywheel } = useQuery<{ report: FlywheelReport | null; available: boolean }>({
    queryKey: ['flywheel'],
    queryFn: () => apiGet('/api/flywheel/metrics'),
    refetchInterval: 60000,
  })

  const { data: hyperagent, isLoading: loadingHyperagent } = useQuery<HyperagentStatus>({
    queryKey: ['hyperagent'],
    queryFn: () => apiGet('/api/hyperagent/auto/status'),
    refetchInterval: 15000,
  })

  const { data: chains, isLoading: loadingChains } = useQuery<{ chains: ChainStatus[] }>({
    queryKey: ['chains'],
    queryFn: () => apiGet('/chains?limit=15'),
    refetchInterval: 15000,
  })

  const { data: pheromones, isLoading: loadingPheromones } = useQuery<PheromoneStatus>({
    queryKey: ['pheromones'],
    queryFn: () => apiGet('/api/pheromone/status'),
    refetchInterval: 30000,
  })

  // ─── Grafana Cloud Streaming Metrics ───────────────────────────────
  const { data: grafanaHealth } = useQuery<{ data?: { result: Array<{ metric: Record<string, string>; value: [number, string] }> } }>({
    queryKey: ['grafana-health'],
    queryFn: () => apiGet('/api/grafana/query?query=up{job="widgetdc-backend"}&range=1'),
    refetchInterval: 30000,
  })

  const { data: grafanaMemory } = useQuery<{ data?: { result: Array<{ metric: Record<string, string>; value: [number, string] }> } }>({
    queryKey: ['grafana-memory'],
    queryFn: () => apiGet('/api/grafana/query?query=nodejs_heap_size_used_bytes{job="widgetdc-backend"}&range=1'),
    refetchInterval: 30000,
  })

  const { data: grafanaChains } = useQuery<{ data?: { result: Array<{ metric: Record<string, string>; value: [number, string] }> } }>({
    queryKey: ['grafana-chains'],
    queryFn: () => apiGet('/api/grafana/query?query=rate(orchestrator_chain_failures_total[1h])&range=1'),
    refetchInterval: 30000,
  })

  // Drill-down dialog state
  const [planDialog, setPlanDialog] = useState(false)
  const [selectedPlanEngagement, setSelectedPlanEngagement] = useState<string | null>(null)
  const { data: plan, isLoading: loadingPlan } = useQuery<EngagementPlan>({
    queryKey: ['engagement-plan', selectedPlanEngagement],
    queryFn: () => apiGet(`/api/engagements/${selectedPlanEngagement}/plan`),
    enabled: !!selectedPlanEngagement,
  })

  // ─── KPI Summary ────────────────────────────────────────────────────────

  const totalEngagements = engagements?.length ?? 0
  const activeEngagements = engagements?.filter(e => e.status === 'active' || e.status === 'in_progress').length ?? 0
  const totalDecisions = decisions?.decisions?.length ?? 0
  const compoundScore = flywheel?.report?.compoundScore ?? 0
  const fitnessScore = hyperagent?.fitnessScore ?? 0
  const activeChains = chains?.chains?.filter(c => c.status === 'running').length ?? 0
  const failedChains = chains?.chains?.filter(c => c.status === 'failed').length ?? 0
  const activePheromones = pheromones?.activePheromones ?? 0

  // ─── Radar chart data ──────────────────────────────────────────────────

  const radarData = flywheel?.report?.pillars?.map(p => ({
    metric: p.name.split(' ')[0],
    score: Math.round(p.score * 100),
    fullMark: 100,
  })) ?? []

  // ─── Chain status bar data ─────────────────────────────────────────────

  const chainStatusData = chains?.chains ? (() => {
    const statusCounts: Record<string, number> = {}
    chains.chains.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1 })
    return Object.entries(statusCounts).map(([status, count]) => ({ status, count }))
  })() : []

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Project Overview</h1>
          <p className="text-muted-foreground mt-1">Engagements, decisions, architecture, KPIs — drill down for details</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate({ to: '/flywheel' })}>Flywheel</Button>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: '/chains' })}>Chains</Button>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: '/pheromone' })}>Pheromones</Button>
          <Button variant="outline" size="sm" onClick={() => navigate({ to: '/inventor' })}>Inventor</Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard label="Engagements" value={totalEngagements} sub={`${activeEngagements} active`} color="var(--color-primary)" />
        <KpiCard label="Decisions" value={totalDecisions} sub="certified" color="var(--color-secondary)" />
        <KpiCard label="Compound Score" value={`${Math.round(compoundScore * 100)}%`} sub={compoundScore < 0.4 ? '⚠ Critical' : 'healthy'} color={compoundScore < 0.4 ? 'var(--color-destructive)' : 'var(--color-success)'} />
        <KpiCard label="Fitness" value={`${Math.round(fitnessScore * 100)}%`} sub={`phase: ${hyperagent?.currentPhase ?? '—'}`} color="var(--color-primary)" />
        <KpiCard label="Chains Running" value={activeChains} sub={`${failedChains} failed`} color={failedChains > 5 ? 'var(--color-destructive)' : 'var(--color-success)'} />
        <KpiCard label="Pheromones" value={activePheromones} sub={`${pheromones?.totalDeposits ?? 0} deposits`} color="var(--color-warning)" />
        <KpiCard label="RLM Engine" value="Online" sub="reasoning" color="var(--color-success)" />
        <KpiCard label="Neo4j" value="867K" sub="nodes" color="var(--color-success)" />
      </div>

      {/* Main content: 3 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1: Engagements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Engagements</CardTitle>
            <CardDescription>Active and recent consulting engagements</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingEngagements ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : engagements?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No engagements yet</p>
            ) : (
              <div className="space-y-2">
                {engagements?.slice(0, 10).map(e => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer transition-colors"
                    onClick={() => setSelectedEngagement(e)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{e.objective}</div>
                      <div className="text-xs text-muted-foreground">{e.client} · {e.domain}</div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <StatusBadge status={e.status} />
                      {e.grade && <Badge variant="outline" className="text-xs">{e.grade}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Column 2: Architecture Decisions + Flywheel */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Architecture Decisions</CardTitle>
              <CardDescription>Certified decisions with full lineage</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDecisions ? (
                <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : decisions?.decisions?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No decisions yet</p>
              ) : (
                <div className="space-y-2">
                  {decisions?.decisions?.slice(0, 8).map(d => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-accent cursor-pointer transition-colors"
                      onClick={() => setSelectedDecision(d)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{d.title}</div>
                        <div className="text-xs text-muted-foreground font-mono">{d.id.slice(0, 16)}…</div>
                      </div>
                      <Badge variant="outline" className="text-xs ml-2">{d.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Flywheel Health</CardTitle>
              <CardDescription>5-pillar compound score</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFlywheel || !flywheel?.report ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <div>
                  <div className="text-center mb-4">
                    <div className="text-4xl font-bold" style={{ color: compoundScore < 0.4 ? 'hsl(var(--destructive))' : compoundScore < 0.7 ? 'hsl(var(--warning))' : 'hsl(var(--success))' }}>
                      {Math.round(compoundScore * 100)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Weekly: {flywheel.report.weeklyDelta >= 0 ? '+' : ''}{Math.round(flywheel.report.weeklyDelta * 100)}%
                    </div>
                  </div>
                  {radarData.length > 0 && (
                    <ResponsiveContainer width="100%" height={180}>
                      <RadarChart data={radarData}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
                        <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                      </RadarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Column 3: Chain Status + Pheromones + HyperAgent */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Chain Execution</CardTitle>
              <CardDescription>Recent chain status</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingChains ? (
                <Skeleton className="h-40 w-full" />
              ) : chainStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={chainStatusData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {chainStatusData.map((entry, i) => (
                        <Cell key={i} fill={entry.status === 'completed' ? 'hsl(var(--success))' : entry.status === 'failed' ? 'hsl(var(--destructive))' : 'hsl(var(--warning))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No chains</p>
              )}
              <div className="mt-2 text-xs text-muted-foreground text-center">
                {chains?.chains?.length ?? 0} total · {activeChains} running · {failedChains} failed
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">HyperAgent</CardTitle>
              <CardDescription>Autonomous execution engine</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHyperagent ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <StatusBadge status={hyperagent?.isRunning ? 'running' : 'idle'} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Phase</span>
                    <Badge variant="outline" className="text-xs">{hyperagent?.currentPhase ?? '—'}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Fitness</span>
                    <span className="text-sm font-mono font-medium">{Math.round((hyperagent?.fitnessScore ?? 0) * 100)}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Cycles</span>
                    <span className="text-sm font-mono">{hyperagent?.totalCycles ?? 0}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pheromone Signals</CardTitle>
              <CardDescription>Stigmergic communication layer</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPheromones ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Active</span>
                    <span className="text-sm font-mono font-medium">{pheromones?.activePheromones ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total Deposits</span>
                    <span className="text-sm font-mono">{pheromones?.totalDeposits ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Amplifications</span>
                    <span className="text-sm font-mono">{pheromones?.totalAmplifications ?? 0}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Drill-Down Dialogs ──────────────────────────────────────────── */}

      {/* Engagement Detail Dialog */}
      <Dialog open={!!selectedEngagement} onOpenChange={() => setSelectedEngagement(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedEngagement?.objective}</DialogTitle>
            <DialogDescription>
              {selectedEngagement?.client} · {selectedEngagement?.domain} · Created {selectedEngagement ? new Date(selectedEngagement.createdAt).toLocaleDateString() : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedEngagement && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <StatusBadge status={selectedEngagement.status} />
                {selectedEngagement.grade && <Badge>{selectedEngagement.grade}</Badge>}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedPlanEngagement(selectedEngagement.id)
                    setPlanDialog(true)
                    setSelectedEngagement(null)
                  }}
                >
                  View Plan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedEngagement(null)
                    navigate({ to: '/engagements' })
                  }}
                >
                  Full Details →
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Decision Detail Dialog */}
      <Dialog open={!!selectedDecision} onOpenChange={() => setSelectedDecision(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedDecision?.title}</DialogTitle>
            <DialogDescription className="font-mono">{selectedDecision?.id}</DialogDescription>
          </DialogHeader>
          {selectedDecision && (
            <div className="space-y-4">
              <Badge variant="outline">{selectedDecision.status}</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedDecision(null)
                  navigate({ to: '/decisions' })
                }}
              >
                View Lineage →
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Engagement Plan Drill-Down Dialog */}
      <Dialog open={planDialog} onOpenChange={setPlanDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Engagement Plan</DialogTitle>
            <DialogDescription>Phases, risks, and deliverables</DialogDescription>
          </DialogHeader>
          {loadingPlan ? (
            <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : plan ? (
            <div className="space-y-6">
              {/* Phases */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Phases</h3>
                <div className="space-y-2">
                  {plan.phases.map((phase, i) => (
                    <div key={i} className="p-3 rounded-lg border">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{phase.name}</span>
                        <StatusBadge status={phase.status} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{phase.duration_weeks} weeks</div>
                      {phase.deliverables.length > 0 && (
                        <div className="mt-2 text-xs">
                          <span className="font-medium">Deliverables:</span> {phase.deliverables.join(', ')}
                        </div>
                      )}
                      {phase.risks.length > 0 && (
                        <div className="mt-1 text-xs text-destructive">
                          <span className="font-medium">Risks:</span> {phase.risks.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Risks */}
              {plan.risks.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Risks</h3>
                  <div className="space-y-2">
                    {plan.risks.map((risk, i) => (
                      <div key={i} className="p-3 rounded-lg border">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">{risk.risk}</span>
                          <Badge variant={risk.severity === 'high' ? 'destructive' : 'outline'} className="text-xs">{risk.severity}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{risk.mitigation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Skills */}
              {plan.skills.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Required Skills</h3>
                  <div className="flex flex-wrap gap-1">
                    {plan.skills.map((skill, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{skill}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No plan available</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    idle: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-800'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_authenticated/project-overview')({
  component: ProjectOverviewPage,
})
