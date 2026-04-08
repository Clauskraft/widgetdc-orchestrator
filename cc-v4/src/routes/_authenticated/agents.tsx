import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'

interface AgentEntry {
  agent_id: string
  display_name: string
  source: string
  version: string
  status: string
  capabilities: string[]
  allowed_tool_namespaces: string[]
  active_calls: number
  registered_at: string
  last_seen_at: string
}

interface DashboardData {
  agents: AgentEntry[]
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  online: 'default',
  idle: 'secondary',
  busy: 'secondary',
  offline: 'outline',
  error: 'destructive',
}

const STATUS_DOT: Record<string, string> = {
  online: 'bg-green-500',
  idle: 'bg-blue-400',
  busy: 'bg-yellow-500',
  offline: 'bg-slate-400',
  error: 'bg-red-500',
}

type SortKey = 'name' | 'status' | 'calls' | 'seen'
type SortDir = 'asc' | 'desc'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function AgentsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('seen')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard-agents'],
    queryFn: () => apiGet('/api/dashboard/data'),
    refetchInterval: 10000,
  })

  const agents = data?.agents ?? []

  const statuses = useMemo(() => {
    const s = new Set(agents.map(a => a.status))
    return ['all', ...Array.from(s)]
  }, [agents])

  const filtered = useMemo(() => {
    let list = agents
    if (statusFilter !== 'all') list = list.filter(a => a.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.display_name.toLowerCase().includes(q) ||
        a.agent_id.toLowerCase().includes(q) ||
        a.source?.toLowerCase().includes(q) ||
        a.capabilities?.some(c => c.toLowerCase().includes(q))
      )
    }
    return [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.display_name.localeCompare(b.display_name)
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status)
      else if (sortKey === 'calls') cmp = (a.active_calls ?? 0) - (b.active_calls ?? 0)
      else if (sortKey === 'seen') cmp = new Date(a.last_seen_at).getTime() - new Date(b.last_seen_at).getTime()
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [agents, search, statusFilter, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const online = agents.filter(a => a.status === 'online' || a.status === 'idle').length
  const busy = agents.filter(a => a.active_calls > 0).length
  const totalCalls = agents.reduce((s, a) => s + (a.active_calls ?? 0), 0)

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
        <p className="text-muted-foreground mt-1">Registered agents — status, capabilities, and live activity</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardHeader><Skeleton className="h-4 w-20" /></CardHeader><CardContent><Skeleton className="h-7 w-12" /></CardContent></Card>
        )) : (
          <>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{agents.length}</div><p className="text-xs text-muted-foreground">Registered</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{online}</div><p className="text-xs text-muted-foreground">Online / idle</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Busy</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold text-yellow-600">{busy}</div><p className="text-xs text-muted-foreground">With active calls</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Active Calls</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{totalCalls}</div><p className="text-xs text-muted-foreground">Across all agents</p></CardContent></Card>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search agents, capabilities…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <div className="flex gap-1 flex-wrap">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} agents</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-foreground">
                        Agent {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('status')} className="flex items-center gap-1 hover:text-foreground">
                        Status {sortKey === 'status' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Capabilities</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('calls')} className="hover:text-foreground">
                        Calls {sortKey === 'calls' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('seen')} className="hover:text-foreground">
                        Last Seen {sortKey === 'seen' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((agent) => (
                    <>
                      <tr
                        key={agent.agent_id}
                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setExpanded(e => e === agent.agent_id ? null : agent.agent_id)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[agent.status] ?? 'bg-slate-400'}`} />
                            <div>
                              <div className="font-medium">{agent.display_name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{agent.source ?? agent.agent_id.slice(0, 20)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[agent.status] ?? 'outline'} className="capitalize text-xs">
                            {agent.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(agent.capabilities ?? []).slice(0, 3).map(c => (
                              <span key={c} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{c}</span>
                            ))}
                            {(agent.capabilities ?? []).length > 3 && (
                              <span className="text-xs text-muted-foreground">+{agent.capabilities.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {(agent.active_calls ?? 0) > 0
                            ? <span className="text-yellow-600 font-medium">{agent.active_calls}</span>
                            : <span className="text-muted-foreground">0</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {timeAgo(agent.last_seen_at)}
                        </td>
                      </tr>
                      {expanded === agent.agent_id && (
                        <tr key={`${agent.agent_id}-detail`} className="bg-muted/20">
                          <td colSpan={5} className="px-6 py-4 text-sm">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-xs font-medium text-muted-foreground mb-1">Agent ID</div>
                                <div className="font-mono text-xs">{agent.agent_id}</div>
                              </div>
                              <div>
                                <div className="text-xs font-medium text-muted-foreground mb-1">Version</div>
                                <div className="font-mono text-xs">{agent.version}</div>
                              </div>
                              <div>
                                <div className="text-xs font-medium text-muted-foreground mb-1">Registered</div>
                                <div className="text-xs">{new Date(agent.registered_at).toLocaleString()}</div>
                              </div>
                              <div>
                                <div className="text-xs font-medium text-muted-foreground mb-1">Tool Namespaces</div>
                                <div className="flex flex-wrap gap-1">
                                  {(agent.allowed_tool_namespaces ?? []).map(ns => (
                                    <span key={ns} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{ns}</span>
                                  ))}
                                  {(agent.allowed_tool_namespaces ?? []).length === 0 && <span className="text-xs text-muted-foreground">all</span>}
                                </div>
                              </div>
                              {agent.capabilities && agent.capabilities.length > 3 && (
                                <div className="col-span-2">
                                  <div className="text-xs font-medium text-muted-foreground mb-1">All Capabilities</div>
                                  <div className="flex flex-wrap gap-1">
                                    {agent.capabilities.map(c => (
                                      <span key={c} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{c}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No agents match your filters.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/agents')({
  component: AgentsPage,
})
