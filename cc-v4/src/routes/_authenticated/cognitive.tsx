import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface Feature {
  id: number
  name: string
  source: string
  status: string
  description: string
}

interface FeaturesResponse {
  success: boolean
  data: {
    features: Feature[]
  }
}

function CognitivePage() {
  const { data: features, isLoading, error } = useQuery<FeaturesResponse>({
    queryKey: ['cognitive-features'],
    queryFn: () => apiGet('/monitor/features'),
    refetchInterval: 30000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load cognitive status.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const featureList = features?.data?.features ?? []

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cognitive Proxy</h1>
        <p className="text-muted-foreground mt-1">RLM Engine interface — deep reasoning, context folding, and research features</p>
      </div>

      {/* Feature Cards */}
      <Card>
        <CardHeader>
          <CardTitle>Intelligence Features</CardTitle>
          <CardDescription>{featureList.length} research features tracked</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : featureList.length > 0 ? (
            <div className="space-y-4">
              {featureList.map((f) => (
                <div key={f.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{f.name}</span>
                      <span className="text-xs text-muted-foreground">({f.source})</span>
                    </div>
                    <Badge variant={
                      f.status === 'active' ? 'default' :
                      f.status === 'available' ? 'secondary' :
                      f.status === 'registered' ? 'outline' : 'secondary'
                    }>
                      {f.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{f.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No features data available.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card>
        <CardHeader>
          <CardTitle>RLM Capabilities</CardTitle>
          <CardDescription>Available cognitive operations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { name: 'reason_deeply', desc: 'Multi-step PDR reasoning', endpoint: '/cognitive/reason' },
              { name: 'context_fold', desc: 'Compress large contexts for token efficiency', endpoint: '/api/fold' },
              { name: 'knowledge_query', desc: 'Semantic search + graph-RAG', endpoint: '/api/knowledge/cards' },
              { name: 'domain_analysis', desc: 'Architecture and consulting analysis', endpoint: 'A2A' },
              { name: 'cognitive_reasoning', desc: 'Recursive reasoning with PDR', endpoint: 'A2A' },
              { name: 'adaptive_agent_selection', desc: 'Auto-select best agent for task', endpoint: 'A2A' },
            ].map((cap) => (
              <div key={cap.name} className="border rounded px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium">{cap.name}</span>
                  <Badge variant="outline" className="text-xs">{cap.endpoint}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{cap.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/cognitive')({
  component: CognitivePage,
})
