/**
 * project-overview.tsx — Executive summary dashboard
 *
 * ONE purpose: high-level KPIs for engagements, decisions, and platform health.
 * Drill down into details via navigation.
 *
 * NOT here: flywheel radar, chain charts, pheromone stats, hyperagent details,
 * grafana metrics, anomaly patterns. Those live in /observability.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, normalizeError } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  TrendingUp, FileText, GitCommit, AlertCircle, WifiOff, RefreshCw,
  BarChart3, Zap,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Engagement {
  id: string
  client: string
  domain: string
  objective: string
  status: string
  grade?: string
  createdAt: string
  targetEndDate?: string
  budgetDkk?: number
}

interface Decision {
  id: string
  title: string
  status: string
  createdAt: string
}

interface ApiErrorInfo {
  message: string
  status?: number
  isOffline: boolean
  isRetryable: boolean
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ProjectOverviewPage() {
  const [selectedEngagement, setSelectedEngagement] = useState<Engagement | null>(null)
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null)
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null)

  // Fetch engagements
  const {
    data: engagements,
    isLoading: loadingEngagements,
    error: engagementsError,
    refetch: refetchEngagements,
  } = useQuery<Engagement[]>({
    queryKey: ['engagements'],
    queryFn: async () => {
      try {
        setApiError(null)
        const resp = await apiGet<{ success: boolean; data: Engagement[] }>('/api/engagements?limit=15')
        return resp?.data ?? []
      } catch (e) {
        const err = normalizeError(e)
        setApiError(err)
        throw e
      }
    },
    refetchInterval: 30000,
    retry: (count, error) => {
      const err = normalizeError(error)
      return err.isRetryable && count < 2
    },
  })

  // Fetch decisions
  const {
    data: decisions,
    isLoading: loadingDecisions,
  } = useQuery<Decision[]>({
    queryKey: ['decisions'],
    queryFn: async () => {
      const resp = await apiGet<{ success: boolean; data: Decision[] }>('/api/decisions?limit=15')
      return resp?.data ?? []
    },
    refetchInterval: 30000,
    retry: false,
  })

  // ─── KPI Summary ────────────────────────────────────────────────────────

  const totalEngagements = engagements?.length ?? 0
  const activeEngagements = engagements?.filter(e => e.status === 'active' || e.status === 'in_progress').length ?? 0
  const completedEngagements = engagements?.filter(e => e.status === 'completed').length ?? 0
  const totalDecisions = decisions?.length ?? 0

  // Engagement domain breakdown
  const domainBreakdown = engagements?.reduce<Record<string, number>>((acc, e) => {
    acc[e.domain] = (acc[e.domain] ?? 0) + 1
    return acc
  }, {}) ?? {}

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Project Overview</h1>
          <p className="text-muted-foreground mt-1">
            Executive summary — engagements, decisions, and platform KPIs
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchEngagements()} disabled={loadingEngagements}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loadingEngagements ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.location.href = '/observability'}>
            <BarChart3 className="w-3 h-3 mr-1" /> Observability
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.location.href = '/project-board'}>
            <FileText className="w-3 h-3 mr-1" /> Project Board
          </Button>
        </div>
      </div>

      {/* Offline indicator */}
      {apiError?.isOffline && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Connection lost</AlertTitle>
          <AlertDescription>
            Cannot reach the engagement API. Retrying automatically...
            <Button variant="outline" size="sm" className="ml-2" onClick={() => refetchEngagements()}>
              Retry now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* API error (non-offline) */}
      {apiError && !apiError.isOffline && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>API Error</AlertTitle>
          <AlertDescription>
            {apiError.message}
            {apiError.status === 401 && ' — Please sign in again.'}
            {apiError.status === 404 && ' — Engagement API not deployed.'}
          </AlertDescription>
        </Alert>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Engagements" value={totalEngagements} icon={FileText} sub={`${activeEngagements} active`} color="var(--color-primary)" />
        <KpiCard label="Active" value={activeEngagements} icon={Zap} sub={`${completedEngagements} completed`} color="var(--color-success)" />
        <KpiCard label="Decisions" value={totalDecisions} icon={GitCommit} sub="certified" color="var(--color-secondary)" />
        <KpiCard label="Domains" value={Object.keys(domainBreakdown).length} icon={TrendingUp} sub="active areas" color="var(--color-warning)" />
      </div>

      {/* Main content: 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Column 1: Engagements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Engagements</CardTitle>
            <CardDescription>
              {totalEngagements} total · {activeEngagements} active · Click for details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingEngagements ? (
              <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !engagements || engagements.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No engagements yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {engagements.map(e => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer transition-colors group"
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

        {/* Column 2: Architecture Decisions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Architecture Decisions</CardTitle>
            <CardDescription>
              {totalDecisions} certified decisions · Click for details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingDecisions ? (
              <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !decisions || decisions.length === 0 ? (
              <div className="text-center py-12">
                <GitCommit className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No decisions yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {decisions.map(d => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer transition-colors group"
                    onClick={() => setSelectedDecision(d)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{d.title}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {d.id.slice(0, 12)}... · {new Date(d.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <Badge variant="outline" className="text-xs">{d.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Domain breakdown */}
      {Object.keys(domainBreakdown).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Domain Distribution</CardTitle>
            <CardDescription>Engagements by domain</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(domainBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([domain, count]) => (
                  <div
                    key={domain}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors"
                  >
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{domain}</span>
                    <Badge variant="secondary" className="text-xs">{count}</Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Drill-Down Dialogs ──────────────────────────────────────────── */}

      {/* Engagement Detail Dialog */}
      <Dialog open={!!selectedEngagement} onOpenChange={() => setSelectedEngagement(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedEngagement?.objective}</DialogTitle>
            <DialogDescription>
              {selectedEngagement?.client} · {selectedEngagement?.domain}
              {selectedEngagement?.createdAt && ` · Created ${new Date(selectedEngagement.createdAt).toLocaleDateString()}`}
              {selectedEngagement?.targetEndDate && ` · Target ${new Date(selectedEngagement.targetEndDate).toLocaleDateString()}`}
            </DialogDescription>
          </DialogHeader>
          {selectedEngagement && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={selectedEngagement.status} />
                {selectedEngagement.grade && <Badge>{selectedEngagement.grade}</Badge>}
                {selectedEngagement.budgetDkk && (
                  <Badge variant="secondary">{(selectedEngagement.budgetDkk / 1000).toFixed(0)}K DKK</Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedEngagement(null)}
                >
                  Close
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
            <DialogDescription className="font-mono text-xs">
              {selectedDecision?.id}
              {selectedDecision?.createdAt && ` · ${new Date(selectedDecision.createdAt).toLocaleDateString()}`}
            </DialogDescription>
          </DialogHeader>
          {selectedDecision && (
            <div className="space-y-4">
              <Badge variant="outline">{selectedDecision.status}</Badge>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedDecision(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub: string; color: string; icon: React.ElementType
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      </div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
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
    backlog: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200',
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
