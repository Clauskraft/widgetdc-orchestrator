import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface InventorStatus {
  isRunning: boolean
  experimentName: string
  currentStep: number
  totalSteps: number
  nodesCreated: number
  bestScore: number
  bestNodeId: string
  samplingAlgorithm: string
  startedAt: string | null
  lastStepAt: string | null
  lastError: string | null
}

interface InventorNode {
  id: string
  score: number
  parentId: string | null
  strategy: string
  prompt: string
  result: string
  createdAt: string
}

interface NodesResponse {
  success: boolean
  data: InventorNode[]
  total: number
}

function InventorPage() {
  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<InventorStatus>({
    queryKey: ['inventor-status'],
    queryFn: () => apiGet('/api/inventor/status'),
    refetchInterval: 5000,
  })

  const { data: nodes } = useQuery<NodesResponse>({
    queryKey: ['inventor-nodes'],
    queryFn: () => apiGet('/api/inventor/nodes?limit=10&sort=score'),
    refetchInterval: 10000,
  })

  if (statusError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load inventor status.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const s = status

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventor</h1>
          <p className="text-muted-foreground mt-1">ASI-Evolve closed-loop evolution engine — LEARN → DESIGN → EXPERIMENT → ANALYZE</p>
        </div>
        {s && (
          <Badge variant={s.isRunning ? 'default' : 'secondary'} className="text-sm px-3 py-1">
            {s.isRunning ? 'Running' : 'Idle'}
          </Badge>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statusLoading ? (
          [1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Nodes Created</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s?.nodesCreated ?? 0}</div>
                <p className="text-xs text-muted-foreground">Trial solutions generated</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Best Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s?.bestScore != null ? (s.bestScore * 100).toFixed(1) + '%' : '—'}</div>
                <p className="text-xs text-muted-foreground font-mono">{s?.bestNodeId ?? '—'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {s?.totalSteps ? `${s.currentStep}/${s.totalSteps}` : `Step ${s?.currentStep ?? 0}`}
                </div>
                <p className="text-xs text-muted-foreground">
                  {s?.samplingAlgorithm ?? 'unknown'} sampling
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Experiment</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-lg font-bold truncate">{s?.experimentName || 'None active'}</div>
                <p className="text-xs text-muted-foreground">
                  {s?.startedAt ? `Started: ${new Date(s.startedAt).toLocaleString()}` : '—'}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Error Alert */}
      {s?.lastError && (
        <Alert variant="destructive">
          <AlertDescription className="font-mono text-xs">{s.lastError}</AlertDescription>
        </Alert>
      )}

      {/* Top Nodes */}
      <Card>
        <CardHeader>
          <CardTitle>Top Trial Nodes</CardTitle>
          <CardDescription>Best-scoring solutions from the evolution tree</CardDescription>
        </CardHeader>
        <CardContent>
          {nodes?.data && nodes.data.length > 0 ? (
            <div className="space-y-3">
              {nodes.data
                .sort((a, b) => b.score - a.score)
                .map((node, i) => (
                <div key={node.id} className="flex items-start justify-between border-b pb-2 last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{node.id}</span>
                      {i === 0 && <Badge className="text-xs">Best</Badge>}
                      <Badge variant="outline" className="text-xs">{node.strategy}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate max-w-lg">
                      {node.prompt?.substring(0, 120) || 'No prompt recorded'}
                    </p>
                    {node.parentId && (
                      <span className="text-xs text-muted-foreground">Parent: {node.parentId}</span>
                    )}
                  </div>
                  <div className="text-right ml-4">
                    <div className="font-mono text-sm font-medium">{(node.score * 100).toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(node.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              {nodes.total > 10 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Showing top 10 of {nodes.total} nodes
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No trial nodes yet. Start an experiment to begin evolution.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Last Step */}
      <Card>
        <CardHeader>
          <CardTitle>Timing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Last Step:</span>{' '}
              <span className="font-medium">
                {s?.lastStepAt ? new Date(s.lastStepAt).toLocaleString() : 'Never'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Started:</span>{' '}
              <span className="font-medium">
                {s?.startedAt ? new Date(s.startedAt).toLocaleString() : 'Never'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/inventor')({
  component: InventorPage,
})
