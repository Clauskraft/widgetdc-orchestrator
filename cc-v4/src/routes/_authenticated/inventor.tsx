import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

function InventorPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['inventor-status'],
    queryFn: () => apiGet('/api/inventor/status'),
    refetchInterval: 15000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load inventor status.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inventor</h1>
        <p className="text-muted-foreground mt-1">Evolution experiments</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Experiment</CardTitle>
          <CardDescription>Active evolution trial</CardDescription>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Trial Nodes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">127</div>
            <p className="text-xs text-muted-foreground">
              Generated this cycle
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Best Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0.847</div>
            <p className="text-xs text-muted-foreground">
              Current best result
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Diversity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12</div>
            <p className="text-xs text-muted-foreground">
              Distinct phenotypes
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { name: 'Trial #127', score: 0.847, mutations: 5 },
              { name: 'Trial #115', score: 0.823, mutations: 3 },
              { name: 'Trial #103', score: 0.812, mutations: 4 },
            ].map((result, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{result.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {result.mutations} mutations
                  </div>
                </div>
                <Badge>{(result.score * 100).toFixed(1)}%</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/inventor')({
  component: InventorPage,
})
