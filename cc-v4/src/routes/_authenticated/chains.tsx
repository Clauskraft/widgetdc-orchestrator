import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Chain {
  id: string
  name: string
  status: string
  mode: string
  agentCount: number
  duration: number
}

function ChainsPage() {
  const { data: chains = [], isLoading, error } = useQuery({
    queryKey: ['chains'],
    queryFn: () => apiGet<Chain[]>('/api/chains'),
    refetchInterval: 10000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load chains.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Chains</h1>
        <p className="text-muted-foreground mt-1">Chain execution history</p>
      </div>

      <div className="space-y-4">
        {isLoading
          ? [1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-40 mb-2" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))
          : chains.length > 0
          ? chains.map((chain) => (
              <Card key={chain.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{chain.name}</CardTitle>
                    <Badge>{chain.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-muted-foreground">Mode:</span>{' '}
                      {chain.mode}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Agents:</span>{' '}
                      {chain.agentCount}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Duration:
                      </span>{' '}
                      {chain.duration}ms
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          : (
              <Card>
                <CardContent className="p-6">
                  <p className="text-muted-foreground text-center">
                    No chains found
                  </p>
                </CardContent>
              </Card>
            )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/chains')({
  component: ChainsPage,
})
