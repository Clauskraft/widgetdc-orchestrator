import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend,
} from 'recharts'

interface AgentEntry {
  agent_id: string
  display_name: string
  status: string
  active_calls: number
  registered_at: string
  last_seen_at: string
}

interface ChainEntry {
  execution_id: string
  mode: string
  status: string
  started_at: string
  completed_at?: string
}

interface AdoptionTrend {
  ts: number
  tool: string
  agent: string
}

interface DashboardData {
  agents: AgentEntry[]
  chains: ChainEntry[]
  cronJobs: any[]
  rlmAvailable: boolean
  adoptionTrends: AdoptionTrend[]
  timestamp: string
}

const CHAIN_COLORS: Record<string, string> = {
  sequential: '#6366f1',
  parallel: '#22c55e',
  loop: '#f59e0b',
  debate: '#ec4899',
  adaptive: '#14b8a6',
}

const STATUS_COLORS: Record<string, string> = {
  online: '#22c55e',
  idle: '#6366f1',
  busy: '#f59e0b',
  offline: '#94a3b8',
  error: '#ef4444',
}

function DashboardPage() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard-data'],
    queryFn: () => apiGet('/api/dashboard/data'),
    refetchInterval: 15000,
  })

  // Agent status distribution
  const agentStatusData = data ? Object.entries(
    data.agents.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value })) : []

  // Chain mode distribution
  const chainModeData = data ? Object.entries(
    data.chains.reduce((acc, c) => {
      acc[c.mode] = (acc[c.mode] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([mode, count]) => ({ mode, count })) : []

  // Adoption trends: bucket into 7-day hourly windows if available
  const trendData = data?.adoptionTrends?.length
    ? (() => {
        const buckets: Record<string, number> = {}
        data.adoptionTrends.forEach(t => {
          const d = new Date(t.ts)
          const key = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}h`
          buckets[key] = (buckets[key] ?? 0) + 1
        })
        return Object.entries(buckets)
          .slice(-24)
          .map(([time, calls]) => ({ time, calls }))
      })()
    : []

  const totalAgents = data?.agents.length ?? 0
  const onlineAgents = data?.agents.filter(a => a.status === 'online' || a.status === 'idle').length ?? 0
  const totalChains = data?.chains.length ?? 0
  const runningChains = data?.chains.filter(c => c.status === 'running').length ?? 0
  const totalCrons = data?.cronJobs.length ?? 0

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Platform overview — agents, chains, cron jobs, adoption</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardHeader><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Agents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalAgents}</div>
                <p className="text-xs text-muted-foreground">{onlineAgents} active</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Chains</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalChains}</div>
                <p className="text-xs text-muted-foreground">
                  {runningChains > 0 ? <span className="text-green-600">{runningChains} running</span> : 'none running'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Cron Jobs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCrons}</div>
                <p className="text-xs text-muted-foreground">Scheduled loops</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">RLM Engine</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data?.rlmAvailable ? 'Online' : 'Offline'}</div>
                <Badge variant={data?.rlmAvailable ? 'default' : 'destructive'} className="text-xs mt-1">
                  {data?.rlmAvailable ? 'operational' : 'down'}
                </Badge>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Agent Status Donut */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Status</CardTitle>
            <CardDescription>Distribution across {totalAgents} registered agents</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-56 w-full" /> : agentStatusData.length > 0 ? (
              <div className="h-56 flex items-center justify-center gap-6">
                <ResponsiveContainer width="60%" height="100%">
                  <PieChart>
                    <Pie data={agentStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                      {agentStatusData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 text-sm">
                  {agentStatusData.map(d => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS[d.name] ?? '#94a3b8' }} />
                      <span className="capitalize">{d.name}</span>
                      <span className="font-mono font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No agents registered</div>
            )}
          </CardContent>
        </Card>

        {/* Chain Mode Bar */}
        <Card>
          <CardHeader>
            <CardTitle>Chain Executions by Mode</CardTitle>
            <CardDescription>Last {totalChains} chains — sequential / parallel / loop / debate / adaptive</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-56 w-full" /> : chainModeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={224}>
                <BarChart data={chainModeData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mode" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {chainModeData.map((entry) => (
                      <Cell key={entry.mode} fill={CHAIN_COLORS[entry.mode] ?? '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">No chain history</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Adoption Trends */}
      {trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tool Call Activity</CardTitle>
            <CardDescription>Adoption trend — last 24 hours</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trendData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                <defs>
                  <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="calls" stroke="#6366f1" fill="url(#callGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Chains */}
      {(data?.chains?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Chains</CardTitle>
            <CardDescription>Last {Math.min(data!.chains.length, 8)} executions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data!.chains.slice(0, 8).map((c) => (
                <div key={c.execution_id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-mono capitalize" style={{ borderColor: CHAIN_COLORS[c.mode] ?? '#6366f1', color: CHAIN_COLORS[c.mode] ?? '#6366f1' }}>
                      {c.mode}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">{c.execution_id.slice(0, 12)}…</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.status === 'completed' ? 'default' : c.status === 'running' ? 'secondary' : 'destructive'} className="text-xs">
                      {c.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.started_at).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/')({
  component: DashboardPage,
})
