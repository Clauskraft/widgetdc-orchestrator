import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface AuditEntry {
  id: string
  action: string
  user: string
  timestamp: string
  status: string
}

function AuditPage() {
  const { data: entries = [], isLoading, error } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => apiGet<AuditEntry[]>('/api/audit'),
    refetchInterval: 10000,
  })

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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground mt-1">System audit trail</p>
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
          : entries.length > 0
          ? entries.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{entry.action}</div>
                      <div className="text-sm text-muted-foreground">
                        {entry.user} • {entry.timestamp}
                      </div>
                    </div>
                    <Badge
                      variant={
                        entry.status === 'success'
                          ? 'default'
                          : 'destructive'
                      }
                    >
                      {entry.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          : (
              <Card>
                <CardContent className="p-6">
                  <p className="text-muted-foreground text-center">
                    No audit entries found
                  </p>
                </CardContent>
              </Card>
            )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/audit')({
  component: AuditPage,
})
