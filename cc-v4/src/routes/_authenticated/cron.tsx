import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface CronJob {
  id: string
  name: string
  schedule: string
  enabled: boolean
  lastRun?: string
}

function CronPage() {
  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ['cron'],
    queryFn: () => apiGet<CronJob[]>('/api/cron'),
    refetchInterval: 10000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load cron jobs.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cron Jobs</h1>
        <p className="text-muted-foreground mt-1">Scheduled jobs and triggers</p>
      </div>

      <div className="space-y-4">
        {isLoading
          ? [1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-40 mb-2" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                </CardContent>
              </Card>
            ))
          : jobs.length > 0
          ? jobs.map((job) => (
              <Card key={job.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{job.name}</CardTitle>
                    <Badge
                      variant={job.enabled ? 'default' : 'secondary'}
                    >
                      {job.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div>
                    <span className="text-muted-foreground">Schedule:</span>{' '}
                    {job.schedule}
                  </div>
                  {job.lastRun && (
                    <div>
                      <span className="text-muted-foreground">
                        Last Run:
                      </span>{' '}
                      {job.lastRun}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          : (
              <Card>
                <CardContent className="p-6">
                  <p className="text-muted-foreground text-center">
                    No cron jobs found
                  </p>
                </CardContent>
              </Card>
            )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/cron')({
  component: CronPage,
})
