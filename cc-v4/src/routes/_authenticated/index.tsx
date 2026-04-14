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
      return apiPost<{ success: boolean; data: { summary?: string; command: string } }>(
        '/api/cockpit/commands/execute',
        { command },
      )
    },
  })

  const overview = overviewQuery.data?.data
  const availableProviders = overview?.providers.filter((provider) => provider.available) ?? []
  const latestCommandMessage = commandMutation.data?.data?.summary
  const commandError = commandMutation.error ? normalizeError(commandMutation.error).message : null

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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overviewQuery.isLoading || !overview ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard
              title="Orchestrator MCP"
              value={overview.mcp.orchestrator.healthy ? 'Online' : 'Down'}
              description={`${overview.mcp.orchestrator.tool_count} tools visible`}
            />
            <MetricCard
              title="Backend MCP"
              value={overview.mcp.backend.healthy ? 'Online' : 'Down'}
              description={`${overview.mcp.backend.tool_count} tools reported`}
            />
            <MetricCard
              title="Providers"
              value={availableProviders.length}
              description={`${overview.providers.length} configured surfaces checked`}
            />
            <MetricCard
              title="Agents"
              value={overview.agents.total}
              description={`${overview.agents.active} active · ${overview.chains.running} chains running`}
            />
          </>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Live MCP and runtime state</CardTitle>
            <CardDescription>These values come from production-facing probes and current orchestrator internals.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {overviewQuery.isLoading || !overview ? (
              Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)
            ) : (
              <>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Orchestrator MCP</p>
                      <p className="text-xs text-muted-foreground">Protocol {overview.mcp.orchestrator.protocol_version ?? 'unknown'}</p>
                    </div>
                    <StatusBadge ok={overview.mcp.orchestrator.healthy} />
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Backend Neural Bridge</p>
                      <p className="text-xs text-muted-foreground">
                        {overview.mcp.backend.error ?? `${overview.mcp.backend.tool_count} tools reachable`}
                      </p>
                    </div>
                    <StatusBadge ok={overview.mcp.backend.healthy} />
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">RLM Engine</p>
                      <p className="text-xs text-muted-foreground">Reasoning proxy availability</p>
                    </div>
                    <StatusBadge ok={overview.services.rlm_available} goodLabel="available" badLabel="offline" />
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">OpenClaw</p>
                      <p className="text-xs text-muted-foreground">External executor bridge</p>
                    </div>
                    <StatusBadge ok={overview.services.openclaw_healthy} goodLabel="healthy" badLabel="degraded" />
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <TriangleAlert className="h-4 w-4 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium">Anomalies</p>
                      <p className="text-xs text-muted-foreground">
                        {overview.signals.anomaly_active} active · {overview.signals.anomaly_scans} total scans
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    <div>
                      <p className="text-sm font-medium">Signals</p>
                      <p className="text-xs text-muted-foreground">
                        {overview.signals.pheromone_active} active pheromones · {overview.signals.write_rejections} rejected writes
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operator actions</CardTitle>
            <CardDescription>Typed actions for MCP, harvest, nudge, and evolution loops.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { command: 'mcp.initialize', label: 'Initialize MCP', icon: Zap },
              { command: 'mcp.list_tools', label: 'List MCP Tools', icon: Boxes },
              { command: 'providers.list', label: 'List Providers', icon: Bot },
              { command: 'harvest.full', label: 'Run Full Harvest', icon: RefreshCw },
              { command: 'flywheel.sync', label: 'Run Flywheel Sync', icon: Activity },
              { command: 'pheromone.decay', label: 'Run Pheromone Decay', icon: Sparkles },
            ].map(({ command, label, icon: Icon }) => (
              <Button
                key={command}
                variant="outline"
                className="w-full justify-start"
                disabled={commandMutation.isPending}
                onClick={() => commandMutation.mutate(command)}
              >
                <Icon className="mr-2 h-4 w-4" />
                {commandMutation.isPending && commandMutation.variables === command ? 'Running…' : label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Provider availability</CardTitle>
            <CardDescription>Explicit-select provider model for cockpit and chat flows.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {overviewQuery.isLoading || !overview ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)
            ) : (
              overview.providers.map((provider) => (
                <div key={provider.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{provider.name}</p>
                      <p className="text-xs text-muted-foreground">{provider.model}</p>
                    </div>
                    <StatusBadge ok={provider.available} goodLabel="available" badLabel="offline" />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operator links</CardTitle>
            <CardDescription>Fast pivots into the rest of the cockpit and external surfaces.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Button variant="outline" className="justify-start" onClick={() => navigate({ to: '/chat' })}>
              <Bot className="mr-2 h-4 w-4" />
              Open Chat
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate({ to: '/observability' })}>
              <Activity className="mr-2 h-4 w-4" />
              Open Observability
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate({ to: '/omega' })}>
              <Workflow className="mr-2 h-4 w-4" />
              Open Architecture
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate({ to: '/openclaw' })}>
              <Zap className="mr-2 h-4 w-4" />
              Open OpenClaw
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => navigate({ to: '/pheromone' })}>
              <Sparkles className="mr-2 h-4 w-4" />
              Open Signals
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => window.open('https://arch-mcp-server-production.up.railway.app', '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open arch-mcp
            </Button>
          </CardContent>
        </Card>
      </section>

      {overview && (
        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard
            title="Cron"
            value={overview.cron.enabled}
            description={`${overview.cron.total} jobs registered`}
          />
          <MetricCard
            title="Connections"
            value={overview.connections.ws_total}
            description={`${overview.connections.sse_total} SSE clients`}
          />
          <MetricCard
            title="Pheromones"
            value={overview.signals.pheromone_deposits}
            description={`${overview.signals.pheromone_active} active`}
          />
          <MetricCard
            title="Peer Eval"
            value={overview.signals.peer_evals}
            description="Fleet learning events recorded"
          />
        </section>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/')({
  component: CockpitPage,
})
