import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

function OpenClawPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['openclaw-status'],
    queryFn: () => apiGet('/api/openclaw/status'),
    refetchInterval: 30000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load OpenClaw status.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">OpenClaw</h1>
        <p className="text-muted-foreground mt-1">Gateway integration</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gateway Status</CardTitle>
          <CardDescription>OpenClaw integration status</CardDescription>
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
          <CardTitle>Available Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { endpoint: '/v1/models', status: 'active', latency: '24ms' },
              {
                endpoint: '/v1/chat/completions',
                status: 'active',
                latency: '156ms',
              },
              {
                endpoint: '/v1/embeddings',
                status: 'active',
                latency: '89ms',
              },
              {
                endpoint: '/v1/agent/execute',
                status: 'active',
                latency: '342ms',
              },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm font-mono">
                    {item.endpoint}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Latency: {item.latency}
                  </div>
                </div>
                <Badge variant="default">{item.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div>
            <span className="text-muted-foreground">Host:</span>{' '}
            api.widgetdc.dev
          </div>
          <div>
            <span className="text-muted-foreground">Version:</span> 1.0
          </div>
          <div>
            <span className="text-muted-foreground">Auth:</span> Bearer token
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/openclaw')({
  component: OpenClawPage,
})
