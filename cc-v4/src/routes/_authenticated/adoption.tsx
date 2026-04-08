import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface AdoptionMetrics {
  total_tools: number
  tools_called_at_least_once: number
  adoption_rate_percent: number
  top_tools: Array<{ name: string; calls: number }>
  bottom_tools: Array<{ name: string; calls: number }>
  namespaces: Array<{ namespace: string; tools: number; calls: number }>
  generated_at: string
}

interface TelemetryData {
  success: boolean
  data: {
    total_calls: number
    unique_tools: number
    unique_agents: number
    top_tools: Array<{ tool: string; count: number }>
    top_agents: Array<{ agent: string; count: number }>
    period: string
  }
}

function AdoptionPage() {
  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useQuery<AdoptionMetrics>({
    queryKey: ['adoption-metrics'],
    queryFn: () => apiGet('/api/adoption/metrics'),
    refetchInterval: 30000,
  })

  const { data: telemetry, isLoading: telemetryLoading } = useQuery<TelemetryData>({
    queryKey: ['adoption-telemetry'],
    queryFn: () => apiGet('/api/adoption/telemetry'),
    refetchInterval: 30000,
  })

  if (metricsError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load adoption data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const tel = telemetry?.data

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Adoption</h1>
        <p className="text-muted-foreground mt-1">Tool adoption metrics, telemetry, and usage patterns</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metricsLoading ? (
          [1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics?.total_tools ?? 0}</div>
                <p className="text-xs text-muted-foreground">MCP tools registered</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Adoption Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics?.adoption_rate_percent ?? 0}%</div>
                <p className="text-xs text-muted-foreground">
                  {metrics?.tools_called_at_least_once ?? 0} tools used at least once
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tel?.total_calls?.toLocaleString() ?? '—'}</div>
                <p className="text-xs text-muted-foreground">
                  {tel?.unique_agents ?? 0} unique agents
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tel?.unique_tools ?? '—'}</div>
                <p className="text-xs text-muted-foreground">In current period</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Top Tools */}
      <Card>
        <CardHeader>
          <CardTitle>Top Tools by Usage</CardTitle>
          <CardDescription>Most frequently called MCP tools</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics?.top_tools && metrics.top_tools.length > 0 ? (
            <div className="space-y-2">
              {metrics.top_tools.map((tool, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="font-mono text-sm">{tool.name}</span>
                  <Badge variant="outline">{tool.calls.toLocaleString()} calls</Badge>
                </div>
              ))}
            </div>
          ) : tel?.top_tools && tel.top_tools.length > 0 ? (
            <div className="space-y-2">
              {tel.top_tools.map((tool, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="font-mono text-sm">{tool.tool}</span>
                  <Badge variant="outline">{tool.count.toLocaleString()} calls</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">No usage data available yet.</div>
          )}
        </CardContent>
      </Card>

      {/* Namespace Breakdown */}
      {metrics?.namespaces && metrics.namespaces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By Namespace</CardTitle>
            <CardDescription>Tool distribution across MCP namespaces</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.namespaces.map((ns, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{ns.namespace}</span>
                    <span className="text-xs text-muted-foreground ml-2">{ns.tools} tools</span>
                  </div>
                  <span className="font-mono text-sm text-muted-foreground">{ns.calls.toLocaleString()} calls</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bottom Tools */}
      {metrics?.bottom_tools && metrics.bottom_tools.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Least Used Tools</CardTitle>
            <CardDescription>Candidates for review or deprecation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.bottom_tools.map((tool, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="font-mono text-sm">{tool.name}</span>
                  <Badge variant="secondary">{tool.calls} calls</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/adoption')({
  component: AdoptionPage,
})
