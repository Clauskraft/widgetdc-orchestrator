import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface MonitorStatus {
  success: boolean
  data: {
    timestamp: string
    evolution: {
      events_last_7d: number
      avg_pass_rate: number | null
      latest_event: string | null
    }
    failure_memory: {
      total: number
      resolved: number
      unresolved: number
    }
    self_corrections: {
      total_runs: number
      total_fixed: number
      latest_run: string | null
    }
    bi_temporal: {
      nodes_with_temporal_metadata: number
    }
    features: Record<string, string>
    cron_jobs: Array<{
      id: string
      name: string
      schedule: string
      enabled: boolean
      last_run: string | null
      last_status: string | null
      run_count: number
    }>
    recent_chains: Array<{
      name: string
      mode: string
      status: string
      steps: string
      duration_ms: number
      started_at: string
    }>
    graph_stats: Array<{ label: string; count: number }>
  }
}

function OmegaPage() {
  const { data, isLoading, error } = useQuery<MonitorStatus>({
    queryKey: ['omega-sitrep'],
    queryFn: () => apiGet('/monitor/status'),
    refetchInterval: 30000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load SITREP.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const d = data?.data

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Omega SITREP</h1>
        <p className="text-muted-foreground mt-1">
          Platform governance, evolution status, and feature health
        </p>
      </div>

      {/* Evolution + Failure + Self-Correction */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {isLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Evolution (7d)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.evolution?.events_last_7d ?? 0} events</div>
                <p className="text-xs text-muted-foreground">
                  Avg pass rate: {d?.evolution?.avg_pass_rate != null ? (d.evolution.avg_pass_rate * 100).toFixed(0) + '%' : 'N/A'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Failure Memory</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {d?.failure_memory?.unresolved ?? 0}
                  <span className="text-sm font-normal text-muted-foreground ml-1">unresolved</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {d?.failure_memory?.resolved ?? 0} resolved / {d?.failure_memory?.total ?? 0} total
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Self-Corrections</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.self_corrections?.total_fixed ?? 0} fixed</div>
                <p className="text-xs text-muted-foreground">
                  {d?.self_corrections?.total_runs ?? 0} runs ·
                  {d?.self_corrections?.latest_run ? ` Last: ${new Date(d.self_corrections.latest_run).toLocaleDateString()}` : ' Never'}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Research Features</CardTitle>
          <CardDescription>6 production intelligence features</CardDescription>
        </CardHeader>
        <CardContent>
          {d?.features ? (
            <div className="space-y-2">
              {Object.entries(d.features).map(([key, status]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm">{key.replace(/^\d+_/, '').replace(/_/g, ' ')}</span>
                  <Badge variant={
                    status === 'active' ? 'default' :
                    status === 'available' ? 'secondary' :
                    status === 'registered' ? 'outline' : 'secondary'
                  }>
                    {status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </CardContent>
      </Card>

      {/* Graph Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Graph Stats</CardTitle>
          <CardDescription>Top 15 node labels by count · {d?.bi_temporal?.nodes_with_temporal_metadata ?? 0} temporal nodes</CardDescription>
        </CardHeader>
        <CardContent>
          {d?.graph_stats && d.graph_stats.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {d.graph_stats.map((s) => (
                <div key={s.label} className="flex justify-between text-sm border rounded px-3 py-1.5">
                  <span className="truncate">{s.label}</span>
                  <span className="font-mono text-muted-foreground ml-2">{s.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </CardContent>
      </Card>

      {/* Recent Chains */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Chains</CardTitle>
        </CardHeader>
        <CardContent>
          {d?.recent_chains && d.recent_chains.length > 0 ? (
            <div className="space-y-2">
              {d.recent_chains.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground ml-2">{c.mode}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{c.steps} steps · {c.duration_ms}ms</span>
                    <Badge variant={c.status === 'completed' ? 'default' : c.status === 'failed' ? 'destructive' : 'secondary'}>
                      {c.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">No recent chain executions</div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/omega')({
  component: OmegaPage,
})
