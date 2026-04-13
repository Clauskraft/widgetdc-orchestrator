import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Coins, Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { syncRuntimeTelemetry } from '@/lib/agent-client'
import { useTelemetryStore } from '@/stores/telemetry'

export function CostBadge() {
  const navigate = useNavigate()
  const totals = useTelemetryStore((state) => state.totals)

  useEffect(() => {
    void syncRuntimeTelemetry()
    const id = window.setInterval(() => { void syncRuntimeTelemetry() }, 30000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <button
      type="button"
      onClick={() => navigate({ to: '/cost' })}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      aria-label={`Session cost ${totals.costDkk.toFixed(2)} DKK across ${totals.requests} requests`}
    >
      <Coins className="h-3.5 w-3.5 text-amber-500" />
      <span>{totals.costDkk.toFixed(2)} DKK</span>
      <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">
        <Activity className="mr-1 h-3 w-3" />
        {totals.requests}
      </Badge>
    </button>
  )
}
