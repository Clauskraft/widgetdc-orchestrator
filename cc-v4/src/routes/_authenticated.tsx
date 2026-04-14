import { Outlet, createFileRoute, redirect, useLocation, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { findRouteMeta } from '@/components/layout/sidebar-data'
import { CommandPalette } from '@/components/layout/command-palette'
import { CostBadge } from '@/components/shared/CostBadge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAuthStore } from '@/stores/auth-store'
import { useSessionStore } from '@/stores/session'
import { getAppModeForPath, getModeLabel } from '@/lib/app-shell'

function AuthenticatedLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeClient = useSessionStore((state) => state.activeClient)
  const engagementId = useSessionStore((state) => state.engagementId)
  const routeMeta = findRouteMeta(location.pathname)
  const appMode = getAppModeForPath(location.pathname)
  const [commandFeedback, setCommandFeedback] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)

  const quickActions = appMode === 'workspace'
    ? [
        { label: 'Engagement Workspace', to: '/engagement-workspace' as const, variant: 'outline' as const },
        { label: 'Compliance Audit', to: '/compliance/audit' as const, variant: 'outline' as const },
        { label: 'Deliverable Draft', to: '/deliverable/draft' as const, variant: 'outline' as const },
        { label: 'Project Board', to: '/project-board' as const, variant: 'ghost' as const },
      ]
    : [
        { label: 'Cockpit Overview', to: '/' as const, variant: 'outline' as const },
        { label: 'Chat', to: '/chat' as const, variant: 'outline' as const },
        { label: 'Observability', to: '/observability' as const, variant: 'outline' as const },
        { label: 'Architecture', to: '/omega' as const, variant: 'ghost' as const },
      ]

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
          <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Unified WidgeTDC Shell
              </p>
              <div className="mt-1 flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
                <h1 className="truncate text-xl font-semibold">
                  {routeMeta?.title ?? 'Command Center'}
                </h1>
                <span className="text-sm text-muted-foreground">
                  {getModeLabel(appMode)}
                </span>
                {activeClient && (
                  <span className="text-sm text-muted-foreground">
                    Client: {activeClient}
                  </span>
                )}
                {engagementId && (
                  <span className="text-sm text-muted-foreground">
                    Engagement: {engagementId}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {routeMeta?.description ?? 'Mode-aware shell for consulting execution and platform operations.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={appMode === 'workspace' ? 'default' : 'outline'}
                size="sm"
                onClick={() => navigate({ to: '/engagement-workspace' })}
              >
                Workspace
              </Button>
              <Button
                variant={appMode === 'cockpit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => navigate({ to: '/' })}
              >
                Cockpit
              </Button>
              {quickActions.map((action) => (
                <Button
                  key={action.to}
                  variant={action.variant}
                  size="sm"
                  onClick={() => navigate({ to: action.to })}
                >
                  {action.label}
                </Button>
              ))}
              <CommandPalette mode={appMode} onResult={setCommandFeedback} />
              <CostBadge />
            </div>
          </div>
          {commandFeedback && (
            <div className="px-4 pb-4">
              <Alert variant={commandFeedback.kind === 'error' ? 'destructive' : 'default'}>
                <AlertDescription>{commandFeedback.message}</AlertDescription>
              </Alert>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
  beforeLoad: async ({ location }) => {
    const token = useAuthStore.getState().accessToken
    if (!token) {
      throw redirect({
        to: '/sign-in',
        search: {
          redirect: location.href,
        },
      })
    }
  },
})
