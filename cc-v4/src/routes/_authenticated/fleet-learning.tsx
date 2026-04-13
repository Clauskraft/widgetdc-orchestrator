import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface PeerEvalStatus {
  totalEvals: number
  totalPeerReviews: number
  totalBestPracticesShared: number
  taskTypesTracked: number
  lastEvalAt: string | null
}

interface FleetEntry {
  taskType: string
  totalEvals: number
  avgScore: number
  avgCost?: number
  avgLatency: number
  bestAgent?: string
  bestScore: number
  bestPractices?: string[]
  bestPracticeCount?: number
  lastUpdated: string
  reliable?: boolean
}

function FleetLearningPage() {
  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<PeerEvalStatus>({
    queryKey: ['peer-eval-status'],
    queryFn: () =>
      apiPost('/api/tools/peer_eval_status', {}).then(
        (r: any) => {
          const d = r?.data?.result
          return typeof d === 'string' ? JSON.parse(d) : d
        }
      ),
    refetchInterval: 15000,
  })

  const { data: fleet, isLoading: fleetLoading, error: fleetError } = useQuery<FleetEntry[]>({
    queryKey: ['peer-eval-fleet'],
    queryFn: () =>
      apiPost('/api/tools/peer_eval_fleet', {}).then(
        (r: any) => {
          const d = r?.data?.result
          const arr = typeof d === 'string' ? JSON.parse(d) : d
          return Array.isArray(arr) ? arr : []
        }
      ),
    refetchInterval: 15000,
  })

  if (statusError || fleetError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load fleet learning data.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const fleetData: FleetEntry[] = Array.isArray(fleet) ? fleet : []
  const uniqueAgents = [...new Set(fleetData.map(f => f.bestAgent).filter(Boolean))]
  const avgScoreOverall = fleetData.length > 0
    ? fleetData.reduce((s, f) => s + (f.avgScore ?? 0), 0) / fleetData.length
    : 0

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fleet Learning</h1>
        <p className="text-muted-foreground mt-1">PeerEval fleet intelligence — EMA-weighted scores across agent swarm</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statusLoading ? (
          [1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Evaluations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{status?.totalEvals ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {status?.lastEvalAt ? `Last: ${new Date(status.lastEvalAt).toLocaleTimeString()}` : 'No evals yet'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Task Types</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{status?.taskTypesTracked ?? 0}</div>
                <p className="text-xs text-muted-foreground">Distinct task types tracked</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Fleet Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(avgScoreOverall * 100).toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">{fleetData.length} task types tracked</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Agents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{uniqueAgents.length}</div>
                <p className="text-xs text-muted-foreground">Agents with best scores</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Fleet Performance by Task Type */}
      <Card>
        <CardHeader>
          <CardTitle>Performance by Task Type</CardTitle>
          <CardDescription>EMA-weighted scores per task type — best agent and latency</CardDescription>
        </CardHeader>
        <CardContent>
          {fleetLoading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : fleetData.length > 0 ? (
            <div className="space-y-3">
              {[...fleetData]
                .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0))
                .map((entry) => (
                <div key={entry.taskType} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm font-mono">{entry.taskType}</span>
                      {entry.reliable && <Badge variant="outline" className="text-green-700 text-xs">reliable</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {entry.bestAgent && <>Best: <span className="font-medium">{entry.bestAgent}</span> · </>}
                      {entry.totalEvals ?? 0} evals ·
                      {((entry.avgLatency ?? 0)).toFixed(0)}ms avg
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <div className="font-mono text-sm font-medium">{((entry.avgScore ?? 0) * 100).toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">best: {((entry.bestScore ?? 0) * 100).toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No fleet evaluations recorded yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Best Practices */}
      <Card>
        <CardHeader>
          <CardTitle>Best Practices</CardTitle>
          <CardDescription>Shared across the fleet ({status?.totalBestPracticesShared ?? 0} total)</CardDescription>
        </CardHeader>
        <CardContent>
          {(status?.totalBestPracticesShared ?? 0) > 0 ? (
            <div className="text-sm text-muted-foreground">
              {status?.totalBestPracticesShared} best practices shared across {status?.taskTypesTracked ?? 0} task types.
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No best practices shared yet. Fleet needs more evaluations to surface patterns.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/fleet-learning')({
  component: FleetLearningPage,
})
