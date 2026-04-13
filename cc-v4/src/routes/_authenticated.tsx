import { Outlet, createFileRoute, redirect, useLocation, useNavigate } from '@tanstack/react-router'
import { Sidebar } from '@/components/layout/sidebar'
import { sidebarData } from '@/components/layout/sidebar-data'
import { CostBadge } from '@/components/shared/CostBadge'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useSessionStore } from '@/stores/session'

function findRouteMeta(pathname: string) {
  const items = sidebarData.flatMap((group) => group.items)

  if (pathname === '/') {
    return items.find((item) => item.path === '/')
  }

  return items.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

function AuthenticatedLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeClient = useSessionStore((state) => state.activeClient)
  const routeMeta = findRouteMeta(location.pathname)

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
          <div className="flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Proof-Facing Frontend
              </p>
              <div className="mt-1 flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
                <h1 className="truncate text-xl font-semibold">
                  {routeMeta?.title ?? 'Command Center'}
                </h1>
                {activeClient && (
                  <span className="text-sm text-muted-foreground">
                    Client: {activeClient}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {routeMeta?.description ?? 'Thin typed shell for WidgeTDC value-props and operator workflows.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/compliance/audit' })}
              >
                Run V1 Audit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/deliverable/draft' })}
              >
                Run V4 Draft
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ to: '/project-overview' })}
              >
                Client Overview
              </Button>
              <CostBadge />
            </div>
          </div>
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
