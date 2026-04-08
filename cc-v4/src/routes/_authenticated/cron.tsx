import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, getApiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface CronJob {
  id: string
  name: string
  schedule: string
  enabled: boolean
  last_run?: string
  run_count: number
}

interface CronResponse {
  success: boolean
  data: { jobs: CronJob[]; total: number }
}

function timeAgo(iso?: string): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// Cron expression pretty-print (best-effort)
function describeSchedule(expr: string): string {
  const known: Record<string, string> = {
    '*/30 * * * *': 'Every 30 min',
    '0 */4 * * *': 'Every 4 h',
    '0 */6 * * *': 'Every 6 h',
    '0 0 * * *':   'Daily at midnight',
    '0 */1 * * *': 'Every hour',
    '*/5 * * * *': 'Every 5 min',
    '*/15 * * * *':'Every 15 min',
  }
  return known[expr] ?? expr
}

function CronPage() {
  const queryClient = useQueryClient()
  const [toggling, setToggling] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<string | null>(null)
  const [triggerResult, setTriggerResult] = useState<Record<string, 'ok' | 'err'>>({})

  const { data: raw, isLoading } = useQuery<CronResponse>({
    queryKey: ['cron'],
    queryFn: () => apiGet('/api/cron'),
    refetchInterval: 10000,
  })

  const jobs: CronJob[] = raw?.data?.jobs ?? []
  const enabled = jobs.filter(j => j.enabled).length
  const totalRuns = jobs.reduce((s, j) => s + (j.run_count ?? 0), 0)

  async function toggleEnabled(job: CronJob) {
    setToggling(job.id)
    try {
      await getApiClient().patch(`/api/cron/${job.id}`, { enabled: !job.enabled })
      await queryClient.invalidateQueries({ queryKey: ['cron'] })
    } finally {
      setToggling(null)
    }
  }

  async function triggerNow(job: CronJob) {
    setTriggering(job.id)
    setTriggerResult(r => ({ ...r, [job.id]: 'ok' }))
    try {
      await getApiClient().post(`/api/cron/${job.id}/run`)
      setTriggerResult(r => ({ ...r, [job.id]: 'ok' }))
      await queryClient.invalidateQueries({ queryKey: ['cron'] })
    } catch {
      setTriggerResult(r => ({ ...r, [job.id]: 'err' }))
    } finally {
      setTriggering(null)
      setTimeout(() => setTriggerResult(r => { const n = { ...r }; delete n[job.id]; return n }), 3000)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cron Jobs</h1>
        <p className="text-muted-foreground mt-1">Scheduled intelligence loops — enable, disable, or trigger immediately</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardHeader><Skeleton className="h-4 w-20" /></CardHeader><CardContent><Skeleton className="h-7 w-12" /></CardContent></Card>
        )) : <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{jobs.length}</div><p className="text-xs text-muted-foreground">Registered jobs</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Enabled</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-green-600">{enabled}</div><p className="text-xs text-muted-foreground">Running on schedule</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Disabled</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold text-slate-500">{jobs.length - enabled}</div><p className="text-xs text-muted-foreground">Paused</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold">{totalRuns.toLocaleString()}</div><p className="text-xs text-muted-foreground">Since last deploy</p></CardContent>
          </Card>
        </>}
      </div>

      {/* Jobs table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Job</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Schedule</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Runs</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Last Run</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Enabled</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(job => (
                    <tr key={job.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{job.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{job.id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-mono text-muted-foreground">{job.schedule}</div>
                        <div className="text-xs text-foreground/70 mt-0.5">{describeSchedule(job.schedule)}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{(job.run_count ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{timeAgo(job.last_run)}</td>
                      <td className="px-4 py-3 text-center">
                        {/* Toggle switch */}
                        <button
                          onClick={() => toggleEnabled(job)}
                          disabled={toggling === job.id}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${job.enabled ? 'bg-green-500' : 'bg-muted border border-input'}`}
                          aria-label={job.enabled ? 'Disable job' : 'Enable job'}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${job.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => triggerNow(job)}
                          disabled={triggering === job.id}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${
                            triggerResult[job.id] === 'ok'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                              : triggerResult[job.id] === 'err'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-muted hover:bg-muted/70 text-foreground'
                          }`}
                        >
                          {triggering === job.id
                            ? <span className="animate-spin text-xs">↻</span>
                            : triggerResult[job.id] === 'ok'
                            ? '✓ Triggered'
                            : triggerResult[job.id] === 'err'
                            ? '✗ Failed'
                            : '▶ Run Now'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {jobs.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No cron jobs registered.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/cron')({
  component: CronPage,
})
