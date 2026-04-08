import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ChevronUp, ChevronDown, Search, ShieldCheck } from 'lucide-react'

interface AuditEntry {
  id: string
  action: string
  user?: string
  agent?: string
  timestamp: string
  status: string
  details?: string
  path?: string
  method?: string
  ip?: string
}

type SortKey = 'timestamp' | 'action' | 'status'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronUp className="h-3 w-3 opacity-20" />
  return sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
}

function AuditPage() {
  const { data: raw = [], isLoading, error } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => apiGet<AuditEntry[] | { entries?: AuditEntry[]; data?: AuditEntry[] }>('/api/audit/log?limit=200'),
    refetchInterval: 15000,
    select: (d: any) => {
      if (Array.isArray(d)) return d
      return d?.entries ?? d?.data ?? []
    },
  })

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'timestamp', dir: 'desc' })

  const statuses = useMemo(() => {
    const s = new Set<string>(['all'])
    raw.forEach(e => s.add(e.status))
    return [...s]
  }, [raw])

  const filtered = useMemo(() => {
    let rows = [...raw]
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.action?.toLowerCase().includes(q) ||
        e.user?.toLowerCase().includes(q) ||
        e.agent?.toLowerCase().includes(q) ||
        e.path?.toLowerCase().includes(q) ||
        e.details?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') {
      rows = rows.filter(e => e.status === statusFilter)
    }
    rows.sort((a, b) => {
      let av = a[sort.key] ?? ''
      let bv = b[sort.key] ?? ''
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [raw, search, statusFilter, sort])

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })
  }

  const successCount = raw.filter(e => e.status === 'success' || e.status === '200').length
  const errorCount = raw.filter(e => e.status === 'error' || e.status === 'failed' || Number(e.status) >= 400).length

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load audit log.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-1">Full system audit trail — every action logged</p>
        </div>
        <ShieldCheck className="h-6 w-6 text-muted-foreground" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {isLoading ? [1,2,3].map(i => <Skeleton key={i} className="h-20" />) : (
          <>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold">{raw.length}</div>
                <p className="text-xs text-muted-foreground">Total entries</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="text-2xl font-bold text-green-600">{successCount}</div>
                <p className="text-xs text-muted-foreground">Success</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-500' : ''}`}>{errorCount}</div>
                <p className="text-xs text-muted-foreground">Errors</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search action, user, path…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map(s => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Entries</CardTitle>
          <CardDescription>{filtered.length} of {raw.length} shown</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No audit entries match your filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">ID</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('action')}>
                        Action <SortIcon col="action" sort={sort} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Actor</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('timestamp')}>
                        Time <SortIcon col="timestamp" sort={sort} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('status')}>
                        Status <SortIcon col="status" sort={sort} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((entry) => {
                    const isErr = entry.status === 'error' || entry.status === 'failed' || Number(entry.status) >= 400
                    const isOk = entry.status === 'success' || entry.status === 'ok' || entry.status === '200' || Number(entry.status) < 400
                    return (
                      <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground truncate max-w-[80px]">
                          {entry.id?.slice(0, 8) ?? '—'}
                        </td>
                        <td className="px-4 py-2 font-medium">
                          {entry.method && <span className="font-mono text-xs text-muted-foreground mr-1">{entry.method}</span>}
                          {entry.action ?? entry.path ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {entry.user ?? entry.agent ?? entry.ip ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap text-xs">
                          {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={isErr ? 'destructive' : isOk ? 'default' : 'secondary'}
                            className="text-[10px]">
                            {entry.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                          {entry.details ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/audit')({
  component: AuditPage,
})
