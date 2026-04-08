import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PlusCircle, RefreshCw } from 'lucide-react'

interface PheromoneStatus {
  success: boolean
  data: {
    totalDeposits: number
    totalDecays: number
    totalAmplifications: number
    activePheromones: number
    trailCount: number
    lastDecayAt: string | null
    lastPersistAt: string | null
  }
}

interface PheromoneSignal {
  id: string
  type: string
  domain: string
  strength: number
  message: string
  tags: string[]
  depositor: string
  createdAt: string
}

interface SenseResponse {
  success: boolean
  data: PheromoneSignal[]
}

interface HeatmapEntry {
  domain: string
  attraction: number
  repellent: number
  trail: number
  external: number
  amplification: number
  total: number
}

interface HeatmapResponse {
  success: boolean
  data: HeatmapEntry[]
}

function PheromonePage() {
  const queryClient = useQueryClient()
  const [depositType, setDepositType] = useState<string>('attraction')
  const [depositDomain, setDepositDomain] = useState('')
  const [depositMessage, setDepositMessage] = useState('')
  const [depositStrength, setDepositStrength] = useState('0.8')
  const [depositing, setDepositing] = useState(false)
  const [depositResult, setDepositResult] = useState<string | null>(null)

  async function deposit() {
    if (!depositDomain.trim() || !depositMessage.trim() || depositing) return
    setDepositing(true)
    setDepositResult(null)
    try {
      await apiPost('/api/pheromone/deposit', {
        type: depositType,
        domain: depositDomain.trim(),
        message: depositMessage.trim(),
        strength: parseFloat(depositStrength) || 0.8,
        depositor: 'command-center',
        tags: ['cc-deposit'],
      })
      setDepositResult('ok')
      setDepositMessage('')
      await queryClient.invalidateQueries({ queryKey: ['pheromone-status'] })
      await queryClient.invalidateQueries({ queryKey: ['pheromone-sense'] })
      await queryClient.invalidateQueries({ queryKey: ['pheromone-heatmap'] })
    } catch (err: any) {
      setDepositResult(`error: ${err?.response?.data?.error ?? err?.message}`)
    } finally {
      setDepositing(false)
      setTimeout(() => setDepositResult(null), 5000)
    }
  }

  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<PheromoneStatus>({
    queryKey: ['pheromone-status'],
    queryFn: () => apiGet('/api/pheromone/status'),
    refetchInterval: 15000,
  })

  const { data: signals } = useQuery<SenseResponse>({
    queryKey: ['pheromone-sense'],
    queryFn: () => apiGet('/api/pheromone/sense?limit=20'),
    refetchInterval: 15000,
  })

  const { data: heatmap } = useQuery<HeatmapResponse>({
    queryKey: ['pheromone-heatmap'],
    queryFn: () => apiGet('/api/pheromone/heatmap'),
    refetchInterval: 30000,
  })

  if (statusError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load pheromone status.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const d = status?.data

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pheromone Layer</h1>
        <p className="text-muted-foreground mt-1">Stigmergic signal substrate — 5 pheromone types, TTL decay, cross-pillar amplification</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statusLoading ? (
          [1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Deposits</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.totalDeposits?.toLocaleString() ?? '—'}</div>
                <p className="text-xs text-muted-foreground">All-time signals deposited</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Pheromones</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.activePheromones ?? '—'}</div>
                <p className="text-xs text-muted-foreground">Above decay threshold</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Amplifications</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.totalAmplifications ?? '—'}</div>
                <p className="text-xs text-muted-foreground">Cross-pillar reinforcements</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Decay Cycles</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{d?.totalDecays ?? '—'}</div>
                <p className="text-xs text-muted-foreground">
                  {d?.lastDecayAt ? `Last: ${new Date(d.lastDecayAt).toLocaleTimeString()}` : 'No decay yet'}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Heatmap */}
      <Card>
        <CardHeader>
          <CardTitle>Domain Heatmap</CardTitle>
          <CardDescription>Pheromone distribution by domain and type</CardDescription>
        </CardHeader>
        <CardContent>
          {heatmap?.data && heatmap.data.length > 0 ? (
            <div className="space-y-2">
              {heatmap.data.map((entry) => (
                <div key={entry.domain} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-32 truncate">{entry.domain}</span>
                  <div className="flex gap-1 flex-1">
                    {entry.attraction > 0 && <Badge className="bg-green-600 text-xs">{entry.attraction} attr</Badge>}
                    {entry.repellent > 0 && <Badge className="bg-red-600 text-xs">{entry.repellent} rep</Badge>}
                    {entry.trail > 0 && <Badge className="bg-blue-600 text-xs">{entry.trail} trail</Badge>}
                    {entry.external > 0 && <Badge className="bg-purple-600 text-xs">{entry.external} ext</Badge>}
                    {entry.amplification > 0 && <Badge className="bg-amber-600 text-xs">{entry.amplification} amp</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">{entry.total}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No active pheromone domains. Signals may have decayed.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deposit Console */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            Deposit Signal
          </CardTitle>
          <CardDescription>Manually deposit a pheromone signal into the substrate</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <Select value={depositType} onValueChange={setDepositType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['attraction', 'repellent', 'trail', 'external', 'amplification'].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Domain</label>
              <Input
                placeholder="e.g. graph, rag, chain"
                value={depositDomain}
                onChange={e => setDepositDomain(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Strength (0–1)</label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={depositStrength}
                onChange={e => setDepositStrength(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message</label>
            <Textarea
              placeholder="Signal message…"
              value={depositMessage}
              onChange={e => setDepositMessage(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={deposit} disabled={depositing || !depositDomain.trim() || !depositMessage.trim()}
              size="sm" className="flex items-center gap-2">
              {depositing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="h-3.5 w-3.5" />}
              {depositing ? 'Depositing…' : 'Deposit'}
            </Button>
            {depositResult && (
              <span className={`text-xs ${depositResult === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {depositResult === 'ok' ? '✓ Deposited successfully' : depositResult}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Signals */}
      <Card>
        <CardHeader>
          <CardTitle>Active Signals</CardTitle>
          <CardDescription>Recent pheromone deposits ranked by strength</CardDescription>
        </CardHeader>
        <CardContent>
          {signals?.data && signals.data.length > 0 ? (
            <div className="space-y-3">
              {signals.data.map((sig) => (
                <div key={sig.id} className="flex items-start justify-between border-b pb-2 last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={
                        sig.type === 'attraction' ? 'default' :
                        sig.type === 'repellent' ? 'destructive' :
                        sig.type === 'amplification' ? 'default' : 'secondary'
                      }>
                        {sig.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{sig.domain}</span>
                    </div>
                    <p className="text-sm mt-1 truncate max-w-lg">{sig.message}</p>
                    {sig.tags?.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {sig.tags.map(t => <span key={t} className="text-xs bg-muted px-1 rounded">{t}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-4">
                    <div className="font-mono text-sm font-medium">{(sig.strength * 100).toFixed(0)}%</div>
                    <div className="text-xs text-muted-foreground">{sig.depositor}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No active signals. All pheromones may have decayed below threshold.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trail Count + Persist Status */}
      <Card>
        <CardHeader>
          <CardTitle>Persistence</CardTitle>
          <CardDescription>Trails persisted to Neo4j and last sync</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Persistent Trails:</span>{' '}
              <span className="font-medium">{d?.trailCount ?? 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Last Persist:</span>{' '}
              <span className="font-medium">
                {d?.lastPersistAt ? new Date(d.lastPersistAt).toLocaleTimeString() : 'Never'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/pheromone')({
  component: PheromonePage,
})
