/**
 * observability.tsx — Real-time platform observability dashboard
 *
 * ONE purpose: real-time platform health — streaming metrics, alerts, failures.
 * NOT here: flywheel radar, engagement KPIs, decisions, project stats.
 * Those live in /project-overview and /flywheel.
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
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts'
import {
  Activity, AlertTriangle, CheckCircle, TrendingUp, Zap, Clock, Server,
  Database, RefreshCw, WifiOff, AlertCircle, AlertOctagon,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface ApiErrorInfo {
  message: string
  status?: number
  isOffline: boolean
  isRetryable: boolean
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ObservabilityPage() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [apiErrors, setApiErrors] = useState<ApiErrorInfo[]>([])
  const refreshInterval = autoRefresh ? 15000 : 0

  const addError = (e: unknown) => {
    const err = normalizeError(e)
    setApiErrors(prev => {
      const exists = prev.find(p => p.message === err.message)
      return exists ? prev : [...prev, err]
    })
  }

  const clearErrors = () => setApiErrors([])

  // ─── Health Queries ──────────────────────────────────────────────────
  const {
    data: backendHealth,
    isLoading: loadingBackend,
    refetch: refetchBackend,
  } = useQuery<HealthResponse>({
    queryKey: ['backend-health'],
    queryFn: async () => {
      try {
        return await apiGet<HealthResponse>('/health')
      } catch (e) { addError(e); throw e }
    },
    refetchInterval: refreshInterval,
    retry: (count, error) => normalizeError(error).isRetryable && count < 2,
  })

  const {
    data: orchestratorHealth,
    isLoading: loadingOrchestrator,
    refetch: refetchOrchestrator,
  } = useQuery<HealthResponse>({
    queryKey: ['orchestrator-health'],
    queryFn: async () => {
      try {
        return await apiGet<HealthResponse>('/api/orchestrator/health')
      } catch (e) { addError(e); throw e }
    },
    refetchInterval: refreshInterval,
    retry: false, // non-critical secondary health
  })

  // ─── Platform Metrics ──────────────────────────────────────────────
  const {
    data: pheromones,
    isLoading: loadingPheromones,
    refetch: refetchPheromones,
  } = useQuery<PheromoneStatus>({
    queryKey: ['pheromones'],
    queryFn: async () => {
      try {
        return await apiGet<PheromoneStatus>('/api/pheromone/status')
      } catch (e) { addError(e); throw e }
    },
    refetchInterval: refreshInterval,
    retry: (count, error) => normalizeError(error).isRetryable && count < 2,
  })

  const {
    data: chains,
    isLoading: loadingChains,
    refetch: refetchChains,
  } = useQuery<ChainResponse>({
    queryKey: ['chains'],
    queryFn: async () => {
      try {
        return await apiGet<ChainResponse>('/chains?limit=20')
      } catch (e) { addError(e); throw e }
    },
    refetchInterval: refreshInterval,
    retry: (count, error) => normalizeError(error).isRetryable && count < 2,
  })

  const {
    data: anomalies,
    isLoading: loadingAnomalies,
    refetch: refetchAnomalies,
  } = useQuery<AnomalyState>({
    queryKey: ['anomalies'],
    queryFn: async () => {
      try {
        return await apiGet<AnomalyState>('/api/anomaly-watcher/status')
      } catch (e) { addError(e); throw e }
    },
    refetchInterval: refreshInterval,
    retry: false,
  })

  const {
    data: hyperagent,
    isLoading: loadingHyperagent,
    refetch: refetchHyperagent,
  } = useQuery<HyperagentStatus>({
    queryKey: ['hyperagent'],
    queryFn: async () => {
      try {
        return await apiGet<HyperagentStatus>('/api/hyperagent/auto/status')
      } catch (e) { addError(e); throw e }
    },
    refetchInterval: refreshInterval,
    retry: (count, error) => normalizeError(error).isRetryable && count < 2,
  })

  const {
    data: failures,
    isLoading: loadingFailures,
    refetch: refetchFailures,
  } = useQuery<FailureHarvest>({
    queryKey: ['failures'],
    queryFn: async () => {
      try {
        return await apiGet<FailureHarvest>('/api/failures?window_hours=24')
      } catch (e) { addError(e); throw e }
    },
    refetchInterval: refreshInterval,
    retry: false,
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

  // Anomaly pattern timeline
  const patternData = anomalies?.patterns?.map(p => ({
    type: p.type.replace(/_/g, ' '),
    count: p.count,
    lastSeen: p.lastSeen ? new Date(p.lastSeen).toLocaleDateString() : '—',
    knownFix: p.knownFix,
  })) ?? []

  const anyOffline = apiErrors.some(e => e.isOffline)
  const hasNonOfflineErrors = apiErrors.some(e => !e.isOffline)

  const refetchAll = () => {
    clearErrors()
    refetchBackend()
    refetchOrchestrator()
    refetchPheromones()
    refetchChains()
    refetchAnomalies()
    refetchHyperagent()
    refetchFailures()
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Observability</h1>
          <p className="text-muted-foreground mt-1">
            Real-time platform health — metrics, alerts, failures, agent activity
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
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-3 h-3 mr-1" /> Refresh All
          </Button>
        </div>
      </div>

      {/* Error alerts */}
      {anyOffline && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Connection issues detected</AlertTitle>
          <AlertDescription>
            Some services are unreachable. Auto-retry is active.
            <Button variant="outline" size="sm" className="ml-2" onClick={refetchAll}>
              Retry all now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {hasNonOfflineErrors && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>API Errors</AlertTitle>
          <AlertDescription>
            {apiErrors.filter(e => !e.isOffline).map((e, i) => (
              <div key={i} className="text-sm mt-1">
                {e.message}
                {e.status === 404 && ' — Endpoint not deployed.'}
                {e.status === 403 && ' — Permission denied.'}
                {e.status === 429 && ' — Rate limited.'}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* KPI Strip — Health cards only */}
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
          status={orchestratorUp ? 'healthy' : 'unknown'}
          value={orchestratorUp ? 'OK' : '—'}
          icon={Server}
          color={orchestratorUp ? 'var(--color-success)' : 'var(--color-muted)'}
        />
        <HealthCard
          label="Neo4j"
          status={backendHealth?.resources?.neo4j_connected ? 'connected' : 'disconnected'}
          value={backendHealth?.resources?.neo4j_connected ? 'OK' : '—'}
          icon={Database}
          color={backendHealth?.resources?.neo4j_connected ? 'var(--color-success)' : 'var(--color-destructive)'}
        />
        <HealthCard
          label="Redis"
          status={backendHealth?.resources?.redis_connected ? 'connected' : 'disconnected'}
          value={backendHealth?.resources?.redis_connected ? 'OK' : '—'}
          icon={Zap}
          color={backendHealth?.resources?.redis_connected ? 'var(--color-success)' : 'var(--color-destructive)'}
        />
        <HealthCard
          label="Tools"
          status={offlineTools > 0 ? 'degraded' : 'healthy'}
          value={`${totalTools - offlineTools - unstableTools}`}
          icon={Activity}
          color={offlineTools > 0 ? 'var(--color-warning)' : 'var(--color-success)'}
          sub={`/${totalTools || '—'}`}
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
          icon={AlertOctagon}
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

        {/* Column 1: Failure Trends + Anomaly Patterns */}
        <div className="space-y-6">
          {/* Failure Categories */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Failure Breakdown (24h)</CardTitle>
              <CardDescription>{failures?.total_events ?? 0} total events</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFailures ? (
                <Skeleton className="h-40 w-full" />
              ) : !failureData.length ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-8 h-8 mx-auto text-green-500 mb-2" />
                  <p className="text-sm text-muted-foreground">No failures in the last 24 hours</p>
                </div>
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
              {loadingAnomalies ? (
                <Skeleton className="h-40 w-full" />
              ) : !patternData.length ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-8 h-8 mx-auto text-green-500 mb-2" />
                  <p className="text-sm text-muted-foreground">No known failure patterns</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {patternData.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0 group">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{p.type}</span>
                        {p.knownFix && (
                          <div className="text-xs text-muted-foreground truncate">Fix: {p.knownFix}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-2">
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

        {/* Column 2: Chain Status + Pheromones */}
        <div className="space-y-6">
          {/* Chain Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Chain Executions</CardTitle>
              <CardDescription>Recent chain activity</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingChains ? (
                <Skeleton className="h-40 w-full" />
              ) : !chainStatusData.length ? (
                <div className="text-center py-8">
                  <Activity className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No chain executions</p>
                </div>
              ) : (
                <div>
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
                  <div className="mt-2 text-xs text-muted-foreground text-center">
                    {chains?.chains?.length ?? 0} recent chains
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Chains Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Chains</CardTitle>
              <CardDescription>Last 10 executions</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingChains ? (
                <Skeleton className="h-40 w-full" />
              ) : !chains?.chains?.length ? (
                <div className="text-center py-8">
                  <Activity className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No chain executions</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {chains.chains.slice(0, 10).map((chain, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{chain.name}</div>
                        <div className="text-xs text-muted-foreground">{chain.mode}{chain.duration ? ` · ${chain.duration}` : ''}</div>
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
                  <MetricRow label="Deposits" value={pheromones?.totalDeposits ?? 0} icon={TrendingUp} color="var(--color-success)" />
                  <MetricRow label="Amplifications" value={pheromones?.totalAmplifications ?? 0} icon={Zap} color="var(--color-warning)" />
                  <MetricRow label="Decay Cycles" value={pheromones?.totalDecays ?? 0} icon={Clock} color="var(--color-muted)" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Column 3: Tool Health + Uptime + HyperAgent */}
        <div className="space-y-6">
          {/* Tool Health */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tool Health</CardTitle>
              <CardDescription>{totalTools || '—'} registered tools</CardDescription>
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
              <CardDescription>Backend service</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingBackend ? (
                <Skeleton className="h-20 w-full" />
              ) : (
                <div className="space-y-3">
                  <MetricRow
                    label="Backend"
                    value={backendHealth?.uptime_seconds ? `${Math.round(backendHealth.uptime_seconds / 3600)}h ${Math.round((backendHealth.uptime_seconds % 3600) / 60)}m` : '—'}
                    icon={Server}
                    color={backendUp ? 'var(--color-success)' : 'var(--color-destructive)'}
                  />
                  <MetricRow
                    label="Version"
                    value={backendHealth?.version ?? '—'}
                    icon={Activity}
                    color="var(--color-muted)"
                  />
                  {backendHealth?.resources?.memory_mb && (
                    <MetricRow
                      label="Memory"
                      value={`${Math.round(backendHealth.resources.memory_mb)} MB`}
                      icon={Database}
                      color="var(--color-muted)"
                    />
                  )}
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
                  {hyperagent?.fitnessScore !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Fitness</span>
                      <span className="text-sm font-mono font-medium">{Math.round(hyperagent.fitnessScore * 100)}%</span>
                    </div>
                  )}
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
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function HealthCard({ label, status, value, icon: Icon, color, sub }: {
  label: string; status: string; value: string | number; icon: React.ElementType; color: string; sub?: string
}) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>
        {value}{sub && <span className="text-sm text-muted-foreground ml-0.5">{sub}</span>}
      </div>
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
