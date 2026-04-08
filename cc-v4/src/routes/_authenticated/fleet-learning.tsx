import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Agent {
  name: string
  score: number
  efficiency: number
  tasksCompleted: number
}

function FleetLearningPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['fleet-learning'],
    queryFn: () => apiGet('/api/monitor/peer-eval'),
    refetchInterval: 15000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load fleet learning data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Fleet Learning</h1>
        <p className="text-muted-foreground mt-1">Agent fleet performance</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overall Status</CardTitle>
          <CardDescription>Fleet-wide learning metrics</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-4 w-48" />
              ))}
            </div>
          ) : (
            <pre className="bg-muted p-4 rounded-md overflow-auto text-xs">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Performing Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { name: 'Codex', score: 0.94, efficiency: 0.91 },
              { name: 'Gemini', score: 0.89, efficiency: 0.88 },
              { name: 'Qwen', score: 0.87, efficiency: 0.85 },
            ].map((agent, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-sm text-muted-foreground">
                    Efficiency: {(agent.efficiency * 100).toFixed(0)}%
                  </div>
                </div>
                <Badge>Score: {(agent.score * 100).toFixed(0)}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Best Practices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm space-y-2">
            <div>
              <span className="font-medium">Sequential chains</span>
              <p className="text-muted-foreground">87% success rate</p>
            </div>
            <div>
              <span className="font-medium">Parallel execution</span>
              <p className="text-muted-foreground">92% success rate</p>
            </div>
            <div>
              <span className="font-medium">Graph-based reasoning</span>
              <p className="text-muted-foreground">85% success rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/fleet-learning')({
  component: FleetLearningPage,
})
