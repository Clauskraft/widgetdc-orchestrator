import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { RefreshCw, TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts'

interface PillarScore {
  name: string
  score: number
  trend: 'up' | 'flat' | 'down'
  headline: string
  details: string[]
}

interface FlywheelReport {
  generatedAt: string
  compoundScore: number
  pillars: PillarScore[]
  nextOptimizations: Array<{ title: string; pillar: string; impact: number; action: string }>
  weeklyDelta: number
}

interface FlywheelResponse {
  success: boolean
  available: boolean
  report: FlywheelReport | null
  pillars?: PillarScore[]
}

interface ConsolidationCandidate {
  id: string
  category: 'stale-tool' | 'dominant-route' | 'degraded-agent'
  agentId?: string
  taskType?: string
  toolName?: string
  reason: string
  evidence: string[]
  riskLevel: 'low' | 'medium' | 'high'
  suggestedAction: string
}

interface ConsolidationReport {
  generatedAt: string
  candidates: ConsolidationCandidate[]
  autoExecuted: number
  manualReview: number
  summary: string
}

interface ConsolidationResponse {
  success: boolean
  available: boolean
  report: ConsolidationReport | null
}

const PILLAR_COLORS = {
  'Cost Efficiency': '#6366f1',
  'Fleet Intelligence': '#22c55e',
  'Adoption': '#f59e0b',
  'Pheromone Signal': '#ec4899',
  'Platform Health': '#14b8a6',
} as const

function TrendIcon({ trend }: { trend: 'up' | 'flat' | 'down' }) {
  if (trend === 'up') return <TrendingUp className="h-3.5 w-3.5 text-green-500" />
  if (trend === 'down') return <TrendingDown className="h-3.5 w-3.5 text-red-500" />
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />
}

function scoreColor(score: number): string {
  if (score >= 0.7) return 'text-green-500'
  if (score >= 0.4) return 'text-amber-500'
  return 'text-red-500'
}

function riskBadgeVariant(risk: string): 'default' | 'destructive' | 'secondary' {
  if (risk === 'high') return 'destructive'
  if (risk === 'medium') return 'default'
  return 'secondary'
}

function FlywheelPage() {
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [scanning, setScanning] = useState(false)

  const { data: fw, isLoading: fwLoading, error: fwError } = useQuery<FlywheelResponse>({
    queryKey: ['flywheel-metrics'],
    queryFn: () => apiGet('/api/flywheel/metrics'),
    refetchInterval: 60000,
  })

  const { data: cons, isLoading: consLoading } = useQuery<ConsolidationResponse>({
    queryKey: ['flywheel-consolidation'],
    queryFn: () => apiGet('/api/flywheel/consolidation'),
    refetchInterval: 120000,
  })

  async function triggerSync() {
    setSyncing(true)
    try {
      await apiPost('/api/flywheel/metrics', {})
      await queryClient.invalidateQueries({ queryKey: ['flywheel-metrics'] })
    } finally {
      setSyncing(false)
    }
  }

  async function triggerScan() {
    setScanning(true)
    try {
      await apiPost('/api/flywheel/consolidation', {})
      await queryClient.invalidateQueries({ queryKey: ['flywheel-consolidation'] })
    } finally {
      setScanning(false)
    }
  }

  if (fwError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load flywheel data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const report = fw?.report
  const pillars = report?.pillars ?? []
  const compound = report?.compoundScore ?? 0
  const delta = report?.weeklyDelta ?? 0

  const radarData = pillars.map(p => ({
    pillar: p.name.replace(' ', '\n'),
    score: parseFloat((p.score * 100).toFixed(0)),
  }))

  const consReport = cons?.report
  const candidates = consReport?.candidates ?? []

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Value Flywheel</h1>
          <p className="text-muted-foreground mt-1">
            5-pillar compound health — Cost Efficiency · Fleet Intelligence · Adoption · Pheromone · Platform Health
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={triggerScan} disabled={scanning} className="flex items-center gap-1.5">
            {scanning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {scanning ? 'Scanning…' : 'Scan'}
          </Button>
          <Button size="sm" onClick={triggerSync} disabled={syncing} className="flex items-center gap-1.5">
            {syncing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {syncing ? 'Syncing…' : 'Sync Flywheel'}
          </Button>
        </div>
      </div>

      {/* Compound Score + Delta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="col-span-2 md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Compound Score</CardTitle>
          </CardHeader>
          <CardContent>
            {fwLoading ? <Skeleton className="h-10 w-24" /> : (
              <>
                <div className={`text-4xl font-bold tabular-nums ${scoreColor(compound)}`}>
                  {(compound * 100).toFixed(0)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">Geometric mean of 5 pillars</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Weekly Δ</CardTitle>
          </CardHeader>
          <CardContent>
            {fwLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className={`text-2xl font-bold tabular-nums ${delta >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {delta >= 0 ? '+' : ''}{(delta * 100).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">vs. last week</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Optimizations</CardTitle>
          </CardHeader>
          <CardContent>
            {fwLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">{report?.nextOptimizations?.length ?? 0}</div>
                <p className="text-xs text-muted-foreground">Pillars below target</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Consolidation</CardTitle>
          </CardHeader>
          <CardContent>
            {consLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className={`text-2xl font-bold ${candidates.length > 0 ? 'text-amber-500' : ''}`}>
                  {candidates.length}
                </div>
                <p className="text-xs text-muted-foreground">Deprecation candidates</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pillar Grid + Radar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pillar Scores */}
        <Card>
          <CardHeader>
            <CardTitle>Pillar Scores</CardTitle>
            <CardDescription>Individual health scores with trend</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {fwLoading ? (
              [1,2,3,4,5].map(i => <Skeleton key={i} className="h-14" />)
            ) : pillars.length > 0 ? pillars.map((p) => (
              <div key={p.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <TrendIcon trend={p.trend} />
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${scoreColor(p.score)}`}>
                    {(p.score * 100).toFixed(0)}%
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(p.score * 100).toFixed(0)}%`,
                      backgroundColor: PILLAR_COLORS[p.name as keyof typeof PILLAR_COLORS] ?? '#6366f1',
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">{p.headline}</p>
              </div>
            )) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No flywheel data. Click Sync to generate.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Radar Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Flywheel Radar</CardTitle>
            <CardDescription>Compound coverage across all 5 pillars</CardDescription>
          </CardHeader>
          <CardContent>
            {fwLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="pillar" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9 }} />
                  <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'Score']} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                No data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pillar Details */}
      {pillars.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pillar Details</CardTitle>
            <CardDescription>Drill-down metrics per pillar</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pillars.map(p => (
                <div key={p.name} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge
                      className="text-xs"
                      style={{ backgroundColor: PILLAR_COLORS[p.name as keyof typeof PILLAR_COLORS] ?? '#6366f1', color: '#fff', border: 'none' }}
                    >
                      {(p.score * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  <ul className="space-y-0.5">
                    {p.details.map((d, i) => (
                      <li key={i} className="text-xs text-muted-foreground">{d}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next Optimizations */}
      {(report?.nextOptimizations?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Optimization Opportunities</CardTitle>
            <CardDescription>Ranked by potential compound score impact</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report!.nextOptimizations.map((opt, i) => (
                <div key={i} className="flex items-start justify-between border-b pb-2 last:border-0 gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium">{opt.title}</span>
                      <Badge variant="secondary" className="text-xs">{opt.pillar}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{opt.action}</p>
                  </div>
                  <div className="font-mono text-sm text-amber-500 whitespace-nowrap">
                    +{(opt.impact * 100).toFixed(0)}% impact
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Consolidation Candidates */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Consolidation Candidates</CardTitle>
              <CardDescription>
                {consReport
                  ? `${consReport.summary} — generated ${new Date(consReport.generatedAt).toLocaleDateString()}`
                  : 'Weekly deprecation/archival scan — all actions require human review'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {consLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : candidates.length > 0 ? (
            <div className="space-y-3">
              {candidates.map((c) => (
                <div key={c.id} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={riskBadgeVariant(c.riskLevel)} className="text-xs">{c.riskLevel}</Badge>
                        <Badge variant="secondary" className="text-xs">{c.category}</Badge>
                        {c.agentId && <span className="font-mono text-xs text-muted-foreground">{c.agentId}</span>}
                        {c.toolName && <span className="font-mono text-xs text-muted-foreground">{c.toolName}</span>}
                      </div>
                      <p className="text-sm">{c.reason}</p>
                      <ul className="mt-1 space-y-0.5">
                        {c.evidence.map((e, i) => (
                          <li key={i} className="text-xs text-muted-foreground">· {e}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-blue-400 border-t pt-2">{c.suggestedAction}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-6">
              {cons?.available
                ? 'No consolidation candidates — platform is clean.'
                : 'No scan data. Click Scan to run the consolidation engine.'}
            </div>
          )}
        </CardContent>
      </Card>

      {report?.generatedAt && (
        <p className="text-xs text-muted-foreground text-right">
          Last synced: {new Date(report.generatedAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/flywheel')({
  component: FlywheelPage,
})
