import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'

interface StepResult {
  step_id: string
  agent_id: string
  action: string
  status: 'success' | 'error' | 'timeout'
  output: unknown
  duration_ms: number
  confidence?: number
  verified?: boolean
}

interface ChainExecution {
  execution_id: string
  chain_id: string
  name: string
  mode: string
  status: 'running' | 'completed' | 'failed'
  steps_completed: number
  steps_total: number
  results: StepResult[]
  started_at: string
  completed_at?: string
  duration_ms?: number
  error?: string
}

interface ChainsResponse {
  success: boolean
  data: { executions: ChainExecution[]; total: number }
}

const CHAIN_MODE_COLORS: Record<string, string> = {
  sequential: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  parallel: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  loop: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  debate: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  adaptive: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  funnel: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  completed: 'secondary',
  failed: 'destructive',
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
}

const STEP_STATUS_DOT: Record<string, string> = {
  success: 'bg-green-500',
  error: 'bg-red-500',
  timeout: 'bg-amber-500',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function fmtDuration(ms?: number): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return '—'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type SortKey = 'name' | 'status' | 'mode' | 'started' | 'duration'
type SortDir = 'asc' | 'desc'

function ChainsPage() {
  const [search, setSearch] = useState('')
  const [modeFilter, setModeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('started')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { data: raw, isLoading } = useQuery<ChainsResponse>({
    queryKey: ['chains'],
    queryFn: () => apiGet('/chains'),
    refetchInterval: 8000,
  })

  const executions: ChainExecution[] = raw?.data?.executions ?? []

  // KPIs
  const running = executions.filter(e => e.status === 'running').length
  const completed = executions.filter(e => e.status === 'completed').length
  const failed = executions.filter(e => e.status === 'failed').length
  const avgDuration = (() => {
    const done = executions.filter(e => e.duration_ms != null)
    if (!done.length) return null
    return Math.round(done.reduce((s, e) => s + (e.duration_ms ?? 0), 0) / done.length)
  })()

  const modes = useMemo(() => {
    const s = new Set(executions.map(e => e.mode))
    return ['all', ...Array.from(s)]
  }, [executions])

  const filtered = useMemo(() => {
    let list = executions
    if (modeFilter !== 'all') list = list.filter(e => e.mode === modeFilter)
    if (statusFilter !== 'all') list = list.filter(e => e.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.execution_id.toLowerCase().includes(q) ||
        e.mode.toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status)
      else if (sortKey === 'mode') cmp = a.mode.localeCompare(b.mode)
      else if (sortKey === 'started') cmp = new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      else if (sortKey === 'duration') cmp = (a.duration_ms ?? 0) - (b.duration_ms ?? 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [executions, modeFilter, statusFilter, search, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortIndicator = ({ k }: { k: SortKey }) =>
    sortKey === k ? <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span> : null

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Chains</h1>
        <p className="text-muted-foreground mt-1">Agent chain execution history — click a row to inspect steps</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardHeader><Skeleton className="h-4 w-20" /></CardHeader><CardContent><Skeleton className="h-7 w-12" /></CardContent></Card>
        )) : <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{executions.length}</div><p className="text-xs text-muted-foreground">Executions (24h)</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Running</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-blue-600">{running}</div><p className="text-xs text-muted-foreground">In progress</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-red-600">{failed}</div><p className="text-xs text-muted-foreground">Of {completed + failed} finished</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Avg Duration</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{fmtDuration(avgDuration ?? undefined)}</div><p className="text-xs text-muted-foreground">Completed chains</p></CardContent>
          </Card>
        </>}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search chains…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-52"
        />
        {/* Mode pills */}
        <div className="flex gap-1 flex-wrap">
          {modes.map(m => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${modeFilter === m ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
            >
              {m}
            </button>
          ))}
        </div>
        {/* Status pills */}
        <div className="flex gap-1">
          {['all', 'running', 'completed', 'failed'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} chains</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-foreground">
                        Chain <SortIndicator k="name" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('mode')} className="hover:text-foreground">
                        Mode <SortIndicator k="mode" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('status')} className="hover:text-foreground">
                        Status <SortIndicator k="status" />
                      </button>
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Steps</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('duration')} className="hover:text-foreground">
                        Duration <SortIndicator k="duration" />
                      </button>
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort('started')} className="hover:text-foreground">
                        Started <SortIndicator k="started" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(exec => (
                    <>
                      <tr
                        key={exec.execution_id}
                        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setExpanded(e => e === exec.execution_id ? null : exec.execution_id)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[exec.status] ?? 'bg-slate-400'}`} />
                            <div>
                              <div className="font-medium">{asText(exec.name)}</div>
                              <div className="text-xs text-muted-foreground font-mono">{exec.execution_id.slice(0, 16)}…</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${CHAIN_MODE_COLORS[exec.mode] ?? 'bg-muted text-muted-foreground'}`}>
                            {asText(exec.mode)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[exec.status] ?? 'outline'} className="capitalize text-xs">
                            {exec.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs font-mono">{exec.steps_completed}/{exec.steps_total}</span>
                          <div className="w-16 h-1 bg-muted rounded-full mt-1 mx-auto overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${exec.status === 'failed' ? 'bg-red-500' : 'bg-primary'}`}
                              style={{ width: `${exec.steps_total ? (exec.steps_completed / exec.steps_total) * 100 : 0}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtDuration(exec.duration_ms)}</td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">{timeAgo(exec.started_at)}</td>
                      </tr>

                      {/* Expanded detail: step drill-down */}
                      {expanded === exec.execution_id && (
                        <tr key={`${exec.execution_id}-detail`} className="bg-muted/10">
                          <td colSpan={6} className="px-6 py-4">
                            {exec.error && (
                              <div className="mb-3 text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-3 py-2 font-mono">
                                ⚠ {exec.error}
                              </div>
                            )}
                            {exec.results && exec.results.length > 0 ? (
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground mb-2">
                                  Step Results ({exec.results.length})
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground border-b">
                                      <th className="text-left pb-1.5 pr-4 font-medium">#</th>
                                      <th className="text-left pb-1.5 pr-4 font-medium">Agent</th>
                                      <th className="text-left pb-1.5 pr-4 font-medium">Action</th>
                                      <th className="text-left pb-1.5 pr-4 font-medium">Status</th>
                                      <th className="text-right pb-1.5 pr-4 font-medium">Duration</th>
                                      <th className="text-right pb-1.5 font-medium">Confidence</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {exec.results.map((step, i) => (
                                      <tr key={step.step_id ?? i} className="border-b border-muted/40 last:border-0">
                                        <td className="py-1.5 pr-4 text-muted-foreground font-mono">{i + 1}</td>
                                        <td className="py-1.5 pr-4 font-mono">{asText(step.agent_id)}</td>
                                        <td className="py-1.5 pr-4 text-muted-foreground truncate max-w-[180px]">{asText(step.action)}</td>
                                        <td className="py-1.5 pr-4">
                                          <span className="flex items-center gap-1">
                                            <span className={`w-1.5 h-1.5 rounded-full ${STEP_STATUS_DOT[step.status] ?? 'bg-slate-400'}`} />
                                            <span className="capitalize">{asText(step.status)}</span>
                                            {step.verified && <span className="text-green-600 ml-1">✓</span>}
                                          </span>
                                        </td>
                                        <td className="py-1.5 pr-4 text-right font-mono">{fmtDuration(step.duration_ms)}</td>
                                        <td className="py-1.5 text-right text-muted-foreground">
                                          {step.confidence != null ? `${Math.round(step.confidence * 100)}%` : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">No step results recorded.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No chains match your filters.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/chains')({
  component: ChainsPage,
})
