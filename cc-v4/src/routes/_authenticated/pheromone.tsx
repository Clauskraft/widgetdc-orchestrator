import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

function PheromonePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pheromone-status'],
    queryFn: () => apiGet('/api/monitor/pheromone'),
    refetchInterval: 15000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load pheromone status.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pheromone Layer</h1>
        <p className="text-muted-foreground mt-1">Signal layer activity</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Active deposits and signal trails</CardDescription>
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
          <CardTitle>Active Deposits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { type: 'attraction', label: 'Attraction Signals', count: 12 },
              { type: 'repellent', label: 'Repellent Signals', count: 3 },
              { type: 'trail', label: 'Trails', count: 8 },
            ].map((item) => (
              <div key={item.type} className="flex items-center gap-2">
                <Badge variant="outline">{item.label}</Badge>
                <span className="text-sm text-muted-foreground">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trail Strengths</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              { trail: 'Research', strength: 0.92 },
              { trail: 'Analysis', strength: 0.87 },
              { trail: 'Chain Execution', strength: 0.79 },
            ].map((item) => (
              <div key={item.trail} className="flex justify-between">
                <span>{item.trail}</span>
                <span className="font-mono text-muted-foreground">
                  {(item.strength * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/pheromone')({
  component: PheromonePage,
})
