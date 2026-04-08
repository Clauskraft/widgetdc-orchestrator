import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface AnomalyStatus {
  success: boolean
  data: {
    totalScans: number
    activeAnomalies: Array<{
      id: string
      type: string
      severity: string
      message: string
      detectedAt: string
      source: string
    }>
    patterns: Array<{
      id: string
      name: string
      type: string
      confidence: number
      lastSeen: string
    }>
    lastScanAt: string | null
    isScanning: boolean
  }
}

function AnomalyPage() {
  const { data, isLoading, error } = useQuery<AnomalyStatus>({
    queryKey: ['anomaly-status'],
    queryFn: () => apiGet('/api/anomaly-watcher/status'),
    refetchInterval: 15000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load anomaly data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const d = data?.data

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Anomaly Detection</h1>
          <p className="text-muted-foreground mt-1">
            DETECT → LEARN → REASON → ACT → REMEMBER pipeline
          </p>
        </div>
        {d && (
          <Badge variant={d.isScanning ? 'default' : 'secondary'} className="text-sm px-3 py-1">
            {d.isScanning ? 'Scanning' : 'Idle'}
          </Badge>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {isLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active Anomalies
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${(d?.activeAnomalies?.length ?? 0) > 0 ? 'text-red-500' : ''}`}>
                  {d?.activeAnomalies?.length ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {(d?.activeAnomalies?.length ?? 0) === 0 ? 'All clear' : 'Needs attention'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Scans
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.totalScans ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  {d?.lastScanAt ? `Last: ${new Date(d.lastScanAt).toLocaleTimeString()}` : 'No scans yet'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Known Patterns
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.patterns?.length ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  Learned detection patterns
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Active Anomalies */}
      <Card>
        <CardHeader>
          <CardTitle>Active Anomalies</CardTitle>
          <CardDescription>Currently detected issues requiring attention</CardDescription>
        </CardHeader>
        <CardContent>
          {d?.activeAnomalies && d.activeAnomalies.length > 0 ? (
            <div className="space-y-3">
              {d.activeAnomalies.map((anomaly) => (
                <div key={anomaly.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          anomaly.severity === 'critical' ? 'destructive' :
                          anomaly.severity === 'high' ? 'destructive' :
                          anomaly.severity === 'medium' ? 'default' : 'secondary'
                        }
                      >
                        {anomaly.severity}
                      </Badge>
                      <span className="font-medium text-sm">{anomaly.type}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{anomaly.message}</p>
                    <span className="text-xs text-muted-foreground">
                      Source: {anomaly.source} · Detected: {new Date(anomaly.detectedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No active anomalies. System operating within normal parameters.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Learned Patterns */}
      <Card>
        <CardHeader>
          <CardTitle>Learned Patterns</CardTitle>
          <CardDescription>Detection patterns accumulated through the LEARN phase</CardDescription>
        </CardHeader>
        <CardContent>
          {d?.patterns && d.patterns.length > 0 ? (
            <div className="space-y-3">
              {d.patterns.map((pattern) => (
                <div key={pattern.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{pattern.name}</div>
                    <div className="text-xs text-muted-foreground">
                      Type: {pattern.type} · Last seen: {new Date(pattern.lastSeen).toLocaleString()}
                    </div>
                  </div>
                  <div className="font-mono text-sm">
                    {(pattern.confidence * 100).toFixed(0)}% conf
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No patterns learned yet. The watcher accumulates patterns over scan cycles.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/anomaly')({
  component: AnomalyPage,
})
