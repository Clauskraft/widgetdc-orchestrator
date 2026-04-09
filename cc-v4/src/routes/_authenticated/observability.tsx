/**
 * observability.tsx — Real-time platform observability dashboard
 *
 * Streams metrics from:
 * - Grafana Cloud (Prometheus queries via /api/grafana)
 * - Backend health endpoint
 * - Orchestrator health endpoint
 * - Failure harvester
 * - Pheromone layer
 * - HyperAgent status
 * - Chain execution stats
 * - Linear issues
 *
 * Shows live charts, anomaly alerts, and agent activity.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, Legend, Cell,
} from 'recharts'
import { Activity, AlertTriangle, CheckCircle, TrendingUp, Zap, Clock, Server, Database, RefreshCw } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface GrafanaQueryResult {
  data?: {
    result: Array<{
      metric: Record<string, string>
      value: [number, string]
    }>
  }
}

interface HealthResponse {
  status: string
  uptime_seconds?: number
  version?: string
  resources?: {
    memory_mb?: number
    neo4j_connected?: boolean
    redis_connected?: boolean
    postgres_connected?: boolean
  }
  components?: {
    database?: { status: string }
    neo4j?: { status: string }
    redis?: { status: string }
  }
  capabilities?: {
    total?: number
    healthSummary?: { active: number; unstable: number; offline: number }
  }
}

interface PheromoneStatus {
  activePheromones: number
  totalDeposits: number
  totalAmplifications: number
  totalDecays: number
}

interface FlywheelReport {
  compoundScore: number
  weeklyDelta: number
  pillars: Array<{ name: string; score: number; trend: string; headline: string }>
}

interface ChainResponse {
  chains?: Array<{
    name: string
    status: string
    mode: string
    duration?: string
  }>
}

interface AnomalyState {
  totalScans: number
  activeAnomalies: number
  patterns: Array<{ type: string; count: number; lastSeen: string; knownFix: string | null }>
}

interface FailureHarvest {
  total_events: number
  by_category: Record<string, number>
}

interface HyperagentStatus {
  isRunning: boolean
  currentPhase: string
  currentStep: string
  fitnessScore?: number
  totalCycles: number
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ObservabilityPage() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const refreshInterval = autoRefresh ? 15000 : 0

  // ─── Health Queries ──────────────────────────────────────────────────
  const { data: backendHealth, isLoading: loadingBackend } = useQuery<HealthResponse>({
    queryKey: ['backend-health'],
    queryFn: () => apiGet('/health'),
    refetchInterval: refreshInterval,
  })

  const { data: orchestratorHealth, isLoading: loadingOrchestrator } = useQuery<HealthResponse>({
    queryKey: ['orchestrator-health'],
    queryFn: () => apiGet('/api/grafana/health'),
    refetchInterval: refreshInterval,
  })

  // ─── Platform Metrics ──────────────────────────────────────────────
  const { data: pheromones, isLoading: loadingPheromones } = useQuery<PheromoneStatus>({
    queryKey: ['pheromones'],
    queryFn: () => apiGet('/api/pheromone/status'),
    refetchInterval: refreshInterval,
  })

  const { data: flywheel, isLoading: loadingFlywheel } = useQuery<{ report: FlywheelReport | null }>({
    queryKey: ['flywheel'],
    queryFn: () => apiGet('/api/flywheel/metrics'),
    refetchInterval: 60000,
  })

  const { data: chains, isLoading: loadingChains } = useQuery<ChainResponse>({
    queryKey: ['chains'],
    queryFn: () => apiGet('/chains?limit=20'),
    refetchInterval: refreshInterval,
  })

  const { data: anomalies, isLoading: loadingAnomalies } = useQuery<AnomalyState>({
    queryKey: ['anomalies'],
    queryFn: () => apiGet('/api/anomaly-watcher/status'),
    refetchInterval: refreshInterval,
  })

  const { data: hyperagent, isLoading: loadingHyperagent } = useQuery<HyperagentStatus>({
    queryKey: ['hyperagent'],
    queryFn: () => apiGet('/api/hyperagent/auto/status'),
    refetchInterval: refreshInterval,
  })

  const { data: failures, isLoading: loadingFailures } = useQuery<FailureHarvest>({
    queryKey: ['failures'],
    queryFn: () => apiGet('/api/failures?window_hours=24'),
    refetchInterval: refreshInterval,
  })

  // ─── Grafana Streaming Metrics ─────────────────────────────────────
  const { data: grafanaMemory } = useQuery<GrafanaQueryResult>({
    queryKey: ['grafana-memory'],
    queryFn: () => apiGet('/api/grafana/query?query=nodejs_heap_size_used_bytes&range=1'),
    refetchInterval: 30000,
  })

  const { data: grafanaUptime } = useQuery<GrafanaQueryResult>({
    queryKey: ['grafana-uptime'],
    queryFn: () => apiGet('/api/grafana/query?query=process_uptime_seconds&range=1'),
    refetchInterval: 30000,
  })

  // ─── Derived Data ──────────────────────────────────────────────────
  const backendUp = backendHealth?.status === 'healthy' || backendHealth?.resources?.neo4j_connected
  const orchestratorUp = orchestratorHealth?.status === 'healthy'
  const totalTools = backendHealth?.capabilities?.total ?? 0
  const offlineTools = backendHealth?.capabilities?.healthSummary?.offline ?? 0
  const unstableTools = backendHealth?.capabilities?.healthSummary?.unstable ?? 0

  const chainStatusData = chains?.chains ? (() => {
    const counts: Record<string, number> = {}
    chains.chains.forEach(c => { counts[c.status] = (counts[c.status] ?? 0) + 1 })
    return Object.entries(counts).map(([status, count]) => ({ status, count }))
  })() : []

  const failureData = failures ? Object.entries(failures.by_category).map(([category, count]) => ({
    category,
    count,
    fill: category === '502' || category === 'timeout' ? '#ef4444'
      : category === 'validation' ? '#f59e0b'
      : category === 'unknown' ? '#94a3b8'
      : '#22c55e',
  })) : []

  const pillarData = flywheel?.report?.pillars?.map(p => ({
    metric: p.name.split(' ')[0],
    score: Math.round(p.score * 100),
    fullMark: 100,
  })) ?? []

  // ─── Anomaly pattern timeline ──────────────────────────────────────
  const patternData = anomalies?.patterns?.map(p => ({
    type: p.type.replace(/_/g, ' '),
    count: p.count,
    lastSeen: p.lastSeen ? new Date(p.lastSeen).toLocaleDateString() : '—',
  })) ?? []

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Observability</h1>
          <p className="text-muted-foreground mt-1">
            Real-time platform health — Grafana streaming, anomalies, failures, agents
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant={autoRefresh ? 'default' : 'outline'} className="text-xs">
            <Activity className="w-3 h-3 mr-1" />
            {autoRefresh ? 'Live (15s)' : 'Paused'}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh(!autoRefresh)}>
            <RefreshCw className={`w-3 h-3 mr-1 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <HealthCard
          label="Backend"
          status={backendUp ? 'healthy' : 'down'}
          value={backendUp ? 'OK' : 'DOWN'}
          icon={Server}
          color={backendUp ? 'var(--color-success)' : 'var(--color-destructive)'}
        />
        <HealthCard
          label="Orchestrator"
          status={orchestratorUp ? 'healthy' : 'down'}
          value={orchestratorUp ? 'OK' : 'DOWN'}
          icon={Server}
          color={orchestratorUp ? 'var(--color-success)' : 'var(--color-destructive)'}
        />
        <HealthCard
          label="Neo4j Aura"
          status={backendHealth?.resources?.neo4j_connected ? 'connected' : 'disconnected'}
          value={backendHealth?.resources?.neo4j_connected ? 'Connected' : '—'}
          icon={Database}
          color={backendHealth?.resources?.neo4j_connected ? 'var(--color-success)' : 'var(--color-destructive)'}
        />
        <HealthCard
          label="Redis"
          status={backendHealth?.resources?.redis_connected ? 'connected' : 'disconnected'}
          value={backendHealth?.resources?.redis_connected ? 'Connected' : '—'}
          icon={Zap}
          color={backendHealth?.resources?.redis_connected ? 'var(--color-success)' : 'var(--color-destructive)'}
        />
        <HealthCard
          label="Tools"
          status={offlineTools > 0 ? 'degraded' : 'healthy'}
          value={`${totalTools - offlineTools}/${totalTools}`}
          icon={Activity}
          color={offlineTools > 0 ? 'var(--color-warning)' : 'var(--color-success)'}
        />
        <HealthCard
          label="Failures 24h"
          status={(failures?.total_events ?? 0) > 50 ? 'critical' : (failures?.total_events ?? 0) > 10 ? 'warning' : 'healthy'}
          value={String(failures?.total_events ?? 0)}
          icon={AlertTriangle}
          color={(failures?.total_events ?? 0) > 50 ? 'var(--color-destructive)' : (failures?.total_events ?? 0) > 10 ? 'var(--color-warning)' : 'var(--color-success)'}
        />
        <HealthCard
          label="Anomalies"
          status={(anomalies?.activeAnomalies ?? 0) > 0 ? 'warning' : 'healthy'}
          value={String(anomalies?.activeAnomalies ?? 0)}
          icon={AlertTriangle}
          color={(anomalies?.activeAnomalies ?? 0) > 0 ? 'var(--color-warning)' : 'var(--color-success)'}
        />
        <HealthCard
          label="HyperAgent"
          status={hyperagent?.isRunning ? 'running' : 'idle'}
          value={hyperagent?.currentPhase ?? '—'}
          icon={Zap}
          color={hyperagent?.isRunning ? 'var(--color-primary)' : 'var(--color-muted)'}
        />
      </div>

      {/* Main grid: 3 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1: Flywheel + Failure Trends */}
        <div className="space-y-6">
          {/* Flywheel Radar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Flywheel Health</CardTitle>
              <CardDescription>5-pillar compound: {Math.round((flywheel?.report?.compoundScore ?? 0) * 100)}%</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFlywheel || !flywheel?.report ? (
                <Skeleton className="h-48 w-full" />
              ) : pillarData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <RadarChart data={pillarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
                    <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No flywheel data</p>
              )}
            </CardContent>
          </Card>

          {/* Failure Categories */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Failure Breakdown (24h)</CardTitle>
              <CardDescription>{failures?.total_events ?? 0} total events</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFailures || !failureData.length ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={failureData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="category" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {failureData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Anomaly Patterns */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Known Failure Patterns</CardTitle>
              <CardDescription>{anomalies?.patterns?.length ?? 0} patterns · {anomalies?.totalScans ?? 0} scans</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAnomalies || !patternData.length ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="space-y-2">
                  {patternData.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <span className="font-medium">{p.type}</span>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">{p.count}×</Badge>
                        <span className="text-xs text-muted-foreground">{p.lastSeen}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Column 2: Chain Status + Pheromones + HyperAgent */}
        <div className="space-y-6">
          {/* Chain Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Chain Executions</CardTitle>
              <CardDescription>Recent chain activity</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingChains || !chainStatusData.length ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chainStatusData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {chainStatusData.map((entry, i) => (
                        <Cell key={i} fill={
                          entry.status === 'completed' ? 'hsl(var(--success))'
                            : entry.status === 'failed' ? 'hsl(var(--destructive))'
                            : 'hsl(var(--warning))'
                        } />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div className="mt-2 text-xs text-muted-foreground text-center">
                {chains?.chains?.length ?? 0} recent chains
              </div>
            </CardContent>
          </Card>

          {/* Pheromone Layer */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pheromone Signals</CardTitle>
              <CardDescription>Stigmergic communication layer</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPheromones ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="space-y-3">
                  <MetricRow label="Active" value={pheromones?.activePheromones ?? 0} icon={Activity} color="var(--color-primary)" />
                  <MetricRow label="Total Deposits" value={pheromones?.totalDeposits ?? 0} icon={TrendingUp} color="var(--color-success)" />
                  <MetricRow label="Amplifications" value={pheromones?.totalAmplifications ?? 0} icon={Zap} color="var(--color-warning)" />
                  <MetricRow label="Decay Cycles" value={pheromones?.totalDecays ?? 0} icon={Clock} color="var(--color-muted)" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* HyperAgent */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">HyperAgent</CardTitle>
              <CardDescription>Autonomous execution engine</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingHyperagent ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge variant={hyperagent?.isRunning ? 'default' : 'outline'} className="text-xs">
                      {hyperagent?.isRunning ? 'Running' : 'Idle'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Phase</span>
                    <Badge variant="outline" className="text-xs">{hyperagent?.currentPhase ?? '—'}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Cycles</span>
                    <span className="text-sm font-mono">{hyperagent?.totalCycles ?? 0}</span>
                  </div>
                  {hyperagent?.currentStep && hyperagent.currentStep !== 'idle' && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Step</span>
                      <span className="text-sm font-mono">{hyperagent.currentStep}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Column 3: Recent Chains + Agent Activity + Uptime */}
        <div className="space-y-6">
          {/* Recent Chains Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Chains</CardTitle>
              <CardDescription>Last 10 executions</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingChains || !chains?.chains?.length ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="space-y-2">
                  {chains.chains.slice(0, 10).map((chain, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{chain.name}</div>
                        <div className="text-xs text-muted-foreground">{chain.mode}</div>
                      </div>
                      <Badge
                        variant={chain.status === 'completed' ? 'default' : chain.status === 'failed' ? 'destructive' : 'outline'}
                        className="text-xs ml-2"
                      >
                        {chain.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tool Health */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tool Health</CardTitle>
              <CardDescription>{totalTools} registered tools</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBackend ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Active</span>
                    <span className="text-lg font-mono font-bold" style={{ color: 'var(--color-success)' }}>
                      {totalTools - offlineTools - unstableTools}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Unstable</span>
                    <span className="text-lg font-mono font-bold" style={{ color: 'var(--color-warning)' }}>
                      {unstableTools}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Offline</span>
                    <span className="text-lg font-mono font-bold" style={{ color: 'var(--color-destructive)' }}>
                      {offlineTools}
                    </span>
                  </div>
                  {/* Health bar */}
                  <div className="mt-2">
                    <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{ width: `${totalTools > 0 ? ((totalTools - offlineTools - unstableTools) / totalTools) * 100 : 0}%` }}
                      />
                      <div
                        className="h-full bg-yellow-500 transition-all"
                        style={{ width: `${totalTools > 0 ? (unstableTools / totalTools) * 100 : 0}%` }}
                      />
                      <div
                        className="h-full bg-red-500 transition-all"
                        style={{ width: `${totalTools > 0 ? (offlineTools / totalTools) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Uptime */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Uptime</CardTitle>
              <CardDescription>Backend & Orchestrator</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBackend || loadingOrchestrator ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <div className="space-y-3">
                  <MetricRow
                    label="Backend"
                    value={backendHealth?.uptime_seconds ? `${Math.round(backendHealth.uptime_seconds / 60)} min` : '—'}
                    icon={Server}
                    color={backendUp ? 'var(--color-success)' : 'var(--color-destructive)'}
                  />
                  <MetricRow
                    label="Version"
                    value={backendHealth?.version ?? '—'}
                    icon={Activity}
                    color="var(--color-muted)"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function HealthCard({ label, status, value, icon: Icon, color }: {
  label: string; status: string; value: string | number; icon: React.ElementType; color: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      <Badge
        variant="outline"
        className="mt-1 text-[10px]"
        style={{ borderColor: color, color }}
      >
        {status}
      </Badge>
    </div>
  )
}

function MetricRow({ label, value, icon: Icon, color }: {
  label: string; value: string | number; icon: React.ElementType; color: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-mono font-medium">{value}</span>
    </div>
  )
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_authenticated/observability')({
  component: ObservabilityPage,
})
