import { Loader2, CheckCircle2, AlertTriangle, PauseCircle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import type { JobEntry } from '@/stores/jobs'

const STATUS_LABEL: Record<JobEntry['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function StatusIcon({ status }: { status: JobEntry['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (status === 'failed') return <AlertTriangle className="h-4 w-4 text-destructive" />
  if (status === 'cancelled') return <XCircle className="h-4 w-4 text-muted-foreground" />
  return <PauseCircle className="h-4 w-4 text-muted-foreground" />
}

export function JobProgress({ job, className }: { job: JobEntry; className?: string }) {
  const progress = typeof job.progress === 'number' ? Math.max(0, Math.min(100, job.progress)) : null

  return (
    <Card className={cn('border-border/80', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <StatusIcon status={job.status} />
              <span className="truncate">{job.title}</span>
            </div>
            {job.detail && <p className="mt-1 text-xs text-muted-foreground">{job.detail}</p>}
          </div>
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[job.status]}</span>
        </div>

        {progress !== null && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  job.status === 'failed' ? 'bg-destructive' : 'bg-primary'
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{progress}%</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
