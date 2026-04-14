import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Activity,
  Bot,
  Boxes,
  ExternalLink,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Workflow,
  Zap,
} from 'lucide-react'
import { apiGet, apiPost, normalizeError } from '@/lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type ProviderStatus = {
  id: string
  name: string
  model: string
  available: boolean
}

type CockpitOverview = {
  timestamp: string
  services: {
    rlm_available: boolean
    openclaw_healthy: boolean
    backend_circuit_breaker: {
      failures: number
      open: boolean
      cooldown_remaining_ms?: number
    }
    rate_limit_backpressure: {
      current_delay_ms: number
      hits_in_window: number
      threshold: number
      window_ms: number
    }
  }
  mcp: {
    orchestrator: {
      healthy: boolean
      status_code: number
      protocol_version: string | null
      server_name: string
      server_version: string | null
      tool_count: number
    }
    backend: {
      healthy: boolean
      tool_count: number
      error: string | null
    }
    checked_at: string
  }
  providers: ProviderStatus[]
  agents: {
    total: number
    active: number
  }
  chains: {
    total: number
    running: number
  }
  cron: {
    total: number
    enabled: number
  }
  connections: {
    ws_total: number
    sse_total: number
  }
  signals: {
    anomaly_active: number
    anomaly_scans: number
    pheromone_active: number
    pheromone_deposits: number
    peer_evals: number
    write_rejections: number
  }
}

type CockpitEnvelope = {
  success: boolean
  data: CockpitOverview
}

function StatusBadge({
  ok,
  goodLabel = 'healthy',
  badLabel = 'attention',
}: {
  ok: boolean
  goodLabel?: string
  badLabel?: string
}) {
  return <Badge variant={ok ? 'default' : 'destructive'}>{ok ? goodLabel : badLabel}</Badge>
}

function MetricCard({
  title,
  value,
  description,
}: {
  title: string
  value: string | number
  description: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function CockpitPage() {
  const navigate = useNavigate()
  const overviewQuery = useQuery<CockpitEnvelope>({
    queryKey: ['cockpit-overview'],
    queryFn: () => apiGet('/api/cockpit/overview'),
    refetchInterval: 30000,
  })

  const commandMutation = useMutation({
    mutationFn: async (command: string) => {
      return apiPost<{ success: boolean; data: { summary?: string; command: string; result?: unknown } }>(
        '/api/cockpit/commands/execute',
        { command },
      )
    },
  })

  const overview = overviewQuery.data?.data
  const availableProviders = overview?.providers.filter((provider) => provider.available) ?? []
  const latestCommandMessage = commandMutation.data?.data?.summary
  const commandError = commandMutation.error ? normalizeError(commandMutation.error).message : null
  const guardMetrics = (commandMutation.data?.data?.result as { metrics?: Record<string, unknown>; gates?: Record<string, boolean> } | undefined)
    ?.metrics
  const guardGates = (commandMutation.data?.data?.result as { metrics?: Record<string, unknown>; gates?: Record<string, boolean> } | undefined)
    ?.gates

  return (
    <div className="flex flex-col gap-6 p-8">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
            <ShieldCheck className="h-4 w-4" />
            Cockpit Mode
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Operator Cockpit</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Start MCP, inspect provider availability, trigger harvest and signal loops, and keep WidgeTDC operational
            without leaving the main frontend shell.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate({ to: '/chat' })}>
            Chat
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/observability' })}>
            Observability
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/omega' })}>
            Architecture
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open('https://open-webui-production-25cb.up.railway.app', '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open WebUI
          </Button>
        </div>
      </section>

      {commandError && (
        <Alert variant="destructive">
          <AlertTitle>Command failed</AlertTitle>
          <AlertDescription>{commandError}</AlertDescription>
        </Alert>
      )}

      {latestCommandMessage && !commandError && (
        <Alert>
          <AlertTitle>Operator action completed</AlertTitle>
          <AlertDescription>{latestCommandMessage}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {overviewQuery.isLoading || !overview ? (
          Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard
              title="System Status"
              value={overview.mcp.orchestrator.healthy && overview.mcp.backend.healthy ? 'Ready' : 'Attention'}
              description={`MCP ${overview.mcp.orchestrator.healthy && overview.mcp.backend.healthy ? 'healthy' : 'needs check'}`}
            />
            <MetricCard
              title="Providers Ready"
              value={`${availableProviders.length}/${overview.providers.length}`}
              description="Available model providers"
            />
            <MetricCard
              title="Active Runtime Risk"
              value={overview.signals.anomaly_active}
              description={`${overview.signals.write_rejections} write rejections`}
            />
          </>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Primary Operator Actions</CardTitle>
            <CardDescription>Minimal control surface: start guard loop, run harvest, sync signals.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {[
              { command: 'harvest.guard', label: 'Run Harvest Guard', icon: ShieldCheck },
              { command: 'harvest.full', label: 'Run Full Harvest', icon: RefreshCw },
              { command: 'flywheel.sync', label: 'Sync Flywheel', icon: Activity },
              { command: 'pheromone.decay', label: 'Run Nudge Decay', icon: Sparkles },
              { command: 'mcp.initialize', label: 'Initialize MCP', icon: Zap },
              { command: 'providers.list', label: 'Refresh Providers', icon: Bot },
            ].map(({ command, label, icon: Icon }) => (
              <Button
                key={command}
                variant={command === 'harvest.guard' ? 'default' : 'outline'}
                className="justify-start"
                disabled={commandMutation.isPending}
                onClick={() => commandMutation.mutate(command)}
              >
                <Icon className="mr-2 h-4 w-4" />
                {commandMutation.isPending && commandMutation.variables === command ? 'Running…' : label}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Harvest Guard Snapshot</CardTitle>
            <CardDescription>Aligned to visualization harvest execution gates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!guardMetrics ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Run <span className="font-medium">Harvest Guard</span> to get a compact gate summary.
              </div>
            ) : (
              <>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Domains harvested</p>
                  <p className="text-lg font-semibold">{String(guardMetrics.domains_harvested ?? 0)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Providers available</p>
                  <p className="text-lg font-semibold">
                    {String(guardMetrics.providers_available ?? 0)}/{String(guardMetrics.providers_total ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Compound health</p>
                  <p className="text-lg font-semibold">{String(guardMetrics.compound_health_score ?? 'n/a')}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Gates</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {Object.entries(guardGates ?? {}).map(([key, passed]) => (
                      <Badge key={key} variant={passed ? 'default' : 'destructive'}>
                        {key.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <details className="rounded-lg border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Advanced telemetry (optional)</summary>
        {overview && (
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Cron" value={overview.cron.enabled} description={`${overview.cron.total} jobs`} />
            <MetricCard title="Connections" value={overview.connections.ws_total} description={`${overview.connections.sse_total} SSE`} />
            <MetricCard title="Pheromones" value={overview.signals.pheromone_active} description={`${overview.signals.pheromone_deposits} deposits`} />
            <MetricCard title="Peer Eval" value={overview.signals.peer_evals} description="Fleet events" />
          </div>
        )}
      </details>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/')({
  component: CockpitPage,
})
