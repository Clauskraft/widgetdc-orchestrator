import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

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

      {/* Top Tools Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Top Tools by Usage</CardTitle>
          <CardDescription>Most frequently called MCP tools</CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const topData = (metrics?.top_tools?.map(t => ({ name: t.name, calls: t.calls }))
              ?? tel?.top_tools?.map(t => ({ name: t.tool, calls: t.count }))
              ?? []).slice(0, 10)
            return topData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topData} layout="vertical" margin={{ top: 4, right: 40, left: 100, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={95} />
                  <Tooltip />
                  <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                    {topData.map((_, i) => (
                      <Cell key={i} fill={i < 3 ? '#6366f1' : i < 6 ? '#818cf8' : '#a5b4fc'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">No usage data yet.</div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Namespace Breakdown Chart */}
      {metrics?.namespaces && metrics.namespaces.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Calls by Namespace</CardTitle>
              <CardDescription>Tool invocations per MCP namespace</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={metrics.namespaces.map(ns => ({ name: ns.namespace, calls: ns.calls }))}
                  layout="vertical"
                  margin={{ top: 4, right: 40, left: 70, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={65} />
                  <Tooltip />
                  <Bar dataKey="calls" fill="#22c55e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tools per Namespace</CardTitle>
              <CardDescription>Coverage — how many tools per namespace</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={metrics.namespaces.map(ns => ({ name: ns.namespace, tools: ns.tools }))}
                  layout="vertical"
                  margin={{ top: 4, right: 40, left: 70, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={65} />
                  <Tooltip />
                  <Bar dataKey="tools" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
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
