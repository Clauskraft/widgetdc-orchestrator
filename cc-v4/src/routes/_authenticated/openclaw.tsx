import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface OpenClawStatus {
  success: boolean
  data: {
    healthy: boolean
    url: string | null
    models?: string[]
    latency_ms?: number
  }
}

function OpenClawPage() {
  const { data, isLoading, error } = useQuery<OpenClawStatus>({
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

  const d = data?.data

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">OpenClaw</h1>
        <p className="text-muted-foreground mt-1">OpenAI-compatible gateway proxy</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gateway Status</CardTitle>
          <CardDescription>OpenClaw integration health</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-4 w-48" />
              ))}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Health</span>
                <Badge variant={d?.healthy ? 'default' : 'destructive'}>
                  {d?.healthy ? 'Healthy' : 'Unhealthy'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>URL</span>
                <span className="font-mono text-muted-foreground">{d?.url ?? 'Not configured'}</span>
              </div>
              {d?.latency_ms != null && (
                <div className="flex items-center justify-between">
                  <span>Latency</span>
                  <span className="font-mono text-muted-foreground">{d.latency_ms}ms</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {d?.models && d.models.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Available Models</CardTitle>
            <CardDescription>Models accessible via OpenClaw proxy</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {d.models.map((model) => (
                <Badge key={model} variant="outline" className="font-mono text-xs">
                  {model}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>OpenAI-Compatible Endpoints</CardTitle>
          <CardDescription>Proxied through orchestrator at /api/openclaw</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              { endpoint: '/v1/models', desc: 'List available models' },
              { endpoint: '/v1/chat/completions', desc: 'Chat completion (streaming)' },
              { endpoint: '/v1/embeddings', desc: 'Text embeddings' },
            ].map((item) => (
              <div key={item.endpoint} className="flex items-center justify-between">
                <span className="font-mono">{item.endpoint}</span>
                <span className="text-muted-foreground">{item.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/openclaw')({
  component: OpenClawPage,
})
