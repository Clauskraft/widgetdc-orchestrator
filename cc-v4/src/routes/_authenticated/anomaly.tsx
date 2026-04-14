import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, getApiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CheckCircle } from 'lucide-react'

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

function asLocaleTimestamp(value: unknown): string {
  const raw = asText(value)
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) return raw
  return new Date(ms).toLocaleString()
}

function AnomalyPage() {
  const queryClient = useQueryClient()
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())

  async function acknowledge(id: string) {
    setAcknowledging(id)
    try {
      await getApiClient().post(`/api/anomaly-watcher/acknowledge/${id}`)
      setAcknowledged(s => new Set([...s, id]))
      await queryClient.invalidateQueries({ queryKey: ['anomaly-status'] })
    } catch {
      // Best-effort: still mark locally acknowledged
      setAcknowledged(s => new Set([...s, id]))
    } finally {
      setAcknowledging(null)
    }
  }

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
          {d?.activeAnomalies && d.activeAnomalies.filter(a => !acknowledged.has(a.id)).length > 0 ? (
            <div className="space-y-3">
              {d.activeAnomalies.filter(a => !acknowledged.has(a.id)).map((anomaly) => (
                <div key={anomaly.id} className="flex items-start justify-between border-b pb-3 last:border-0 gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={
                          anomaly.severity === 'critical' ? 'destructive' :
                          anomaly.severity === 'high' ? 'destructive' :
                          anomaly.severity === 'medium' ? 'default' : 'secondary'
                        }
                      >
                        {asText(anomaly.severity)}
                      </Badge>
                      <span className="font-medium text-sm">{asText(anomaly.type)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{asText(anomaly.message)}</p>
                    <span className="text-xs text-muted-foreground">
                      Source: {asText(anomaly.source)} · Detected: {asLocaleTimestamp(anomaly.detectedAt)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => acknowledge(anomaly.id)}
                    disabled={acknowledging === anomaly.id}
                    className="flex items-center gap-1.5 flex-shrink-0 text-xs"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    {acknowledging === anomaly.id ? 'Ack…' : 'Acknowledge'}
                  </Button>
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
                    <div className="font-medium text-sm">{asText(pattern.name)}</div>
                    <div className="text-xs text-muted-foreground">
                      Type: {asText(pattern.type)} · Last seen: {asLocaleTimestamp(pattern.lastSeen)}
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
