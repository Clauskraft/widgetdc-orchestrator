import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, BriefcaseBusiness } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/session'

type BannerRoute =
  | '/engagement-workspace'
  | '/deliverable/draft'
  | '/compliance/audit'
  | '/obsidian'
  | '/project-board'

const ROUTE_ACTIONS: Array<{ label: string; to: BannerRoute }> = [
  { label: 'Workspace', to: '/engagement-workspace' },
  { label: 'Deliverable', to: '/deliverable/draft' },
  { label: 'Compliance', to: '/compliance/audit' },
  { label: 'Obsidian', to: '/obsidian' },
  { label: 'Board', to: '/project-board' },
]

export function EngagementScopeBanner({
  current,
  description,
}: {
  current: BannerRoute
  description?: string
}) {
  const navigate = useNavigate()
  const engagementId = useSessionStore((state) => state.engagementId)
  const activeClient = useSessionStore((state) => state.activeClient)

  if (!engagementId && !activeClient) return null

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-900">
            <BriefcaseBusiness className="h-4 w-4" />
            Engagement scope active
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {activeClient && <Badge className="bg-sky-700 text-white">{activeClient}</Badge>}
            {engagementId && <Badge variant="outline">{engagementId}</Badge>}
          </div>
          <p className="mt-3 text-sm text-sky-900/80">
            {description ?? 'This surface is operating inside the active consulting engagement context.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {ROUTE_ACTIONS.filter((action) => action.to !== current).map((action) => (
            <Button key={action.to} variant="outline" size="sm" onClick={() => navigate({ to: action.to })}>
              {action.label}
              <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
