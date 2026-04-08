import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface LlmProvider {
  id: string
  name: string
  models: string[]
  status: string
}

interface LlmProvidersResponse {
  success: boolean
  providers: LlmProvider[]
}

interface DashboardData {
  agents: any[]
  chains: any[]
  cronJobs: any[]
  rlmAvailable: boolean
  config: {
    llm_providers: string[]
  }
}

function CostPage() {
  const { data: providers, isLoading: providersLoading, error } = useQuery<LlmProvidersResponse>({
    queryKey: ['llm-providers'],
    queryFn: () => apiGet('/api/llm/providers'),
    refetchInterval: 60000,
  })

  const { data: dashboard } = useQuery<DashboardData>({
    queryKey: ['dashboard-for-cost'],
    queryFn: () => apiGet('/api/dashboard/data'),
    refetchInterval: 60000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load cost data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const providerList = providers?.providers ?? []
  const activeProviders = providerList.filter(p => p.status === 'active' || p.models?.length > 0)

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cost Intel</h1>
        <p className="text-muted-foreground mt-1">LLM provider routing, token economics, and cost optimization</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Providers</CardTitle>
          </CardHeader>
          <CardContent>
            {providersLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">{activeProviders.length}</div>
                <p className="text-xs text-muted-foreground">
                  {providerList.length} configured
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Models</CardTitle>
          </CardHeader>
          <CardContent>
            {providersLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">
                  {providerList.reduce((sum, p) => sum + (p.models?.length ?? 0), 0)}
                </div>
                <p className="text-xs text-muted-foreground">Across all providers</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">RLM Engine</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.rlmAvailable ? 'Online' : 'Offline'}</div>
            <p className="text-xs text-muted-foreground">Reasoning & folding engine</p>
          </CardContent>
        </Card>
      </div>

      {/* Provider Details */}
      <Card>
        <CardHeader>
          <CardTitle>LLM Providers</CardTitle>
          <CardDescription>Configured model routing — cheapest capable model per task type</CardDescription>
        </CardHeader>
        <CardContent>
          {providersLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : providerList.length > 0 ? (
            <div className="space-y-3">
              {providerList.map((provider) => (
                <div key={provider.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{provider.name}</span>
                    <Badge variant={provider.status === 'active' ? 'default' : 'secondary'}>
                      {provider.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {provider.models?.map((model) => (
                      <span key={model} className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                        {model}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No LLM providers configured.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cost Optimization Strategies */}
      <Card>
        <CardHeader>
          <CardTitle>Optimization Strategies</CardTitle>
          <CardDescription>Available token cost reduction methods</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              { strategy: 'Context Folding + RAG', savings: '30-40%', status: 'active' },
              { strategy: 'Context Folding + RLM', savings: '40-50%', status: 'active' },
              { strategy: 'Context Folding + Swarm', savings: '35-45%', status: 'active' },
              { strategy: 'Model Geo-Arbitrage (CN vs US)', savings: '50-80%', status: 'available' },
              { strategy: 'Batch Embedding Reuse', savings: '20-30%', status: 'active' },
            ].map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span>{s.strategy}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">{s.savings}</span>
                  <Badge variant={s.status === 'active' ? 'default' : 'secondary'} className="text-xs">{s.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/cost')({
  component: CostPage,
})
