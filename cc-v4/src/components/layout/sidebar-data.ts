import {
  Zap,
  Layers,
  MessageSquare,
  Brain,
  Sparkles,
  BookOpen,
  ShieldAlert,
  TrendingUp,
  Users,
  Settings,
  HelpCircle,
  Network,
  Home,
  Bot,
  AlertTriangle,
  RefreshCw,
  Lightbulb,
  Activity,
  RotateCw,
  FlaskConical,
  LayoutDashboard,
  Kanban,
  ShieldCheck,
  FileSearch,
  Presentation,
  BriefcaseBusiness,
  GitBranch,
  Workflow,
} from 'lucide-react'
import type { AppMode } from '@/lib/app-shell'

export interface NavItem {
  title: string
  path: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
}

export interface NavGroup {
  label: string
  mode: AppMode | 'shared'
  items: NavItem[]
}

export const sidebarData: NavGroup[] = [
  {
    label: 'Workspace',
    mode: 'workspace',
    items: [
      {
        title: 'Engagement Workspace',
        path: '/engagement-workspace',
        icon: BriefcaseBusiness,
        description: 'Unified consulting shell for context, precedents, planning, and handoff',
      },
      {
        title: 'Compliance Audit',
        path: '/compliance/audit',
        icon: ShieldCheck,
        description: 'V1 AI Act gap audit for client stacks',
      },
      {
        title: 'Project Overview',
        path: '/project-overview',
        icon: LayoutDashboard,
        description: 'Executive summary for active client work',
      },
      {
        title: 'Deliverable Draft',
        path: '/deliverable/draft',
        icon: Presentation,
        description: 'V4 consulting deliverable factory',
      },
      {
        title: 'Knowledge',
        path: '/knowledge',
        icon: FileSearch,
        description: 'Search graph-backed context and evidence',
      },
      {
        title: 'Process Workspace',
        path: '/process-workspace',
        icon: GitBranch,
        description: 'Infer, curate, and align client process trees against standard packs',
      },
    ],
  },
  {
    label: 'Execution',
    mode: 'workspace',
    items: [
      {
        title: 'Project Board',
        path: '/project-board',
        icon: Kanban,
        description: 'Execution board for backlog, starts, and completion loops',
      },
      {
        title: 'Obsidian Docs',
        path: '/obsidian',
        icon: BookOpen,
        description: 'Canonical docs, lineage, and roundtrip artifacts',
      },
    ],
  },
  {
    label: 'Cockpit',
    mode: 'cockpit',
    items: [
      {
        title: 'Cockpit Overview',
        path: '/',
        icon: Home,
        description: 'MCP, provider, runtime, and operator control surface',
      },
      {
        title: 'Chat',
        path: '/chat',
        icon: MessageSquare,
        description: 'Operator chat and Open WebUI-adjacent conversations',
      },
      {
        title: 'Observability',
        path: '/observability',
        icon: Activity,
        description: 'Runtime health, Grafana, anomalies, and failures',
      },
      {
        title: 'Architecture',
        path: '/omega',
        icon: Workflow,
        description: 'Governance, architecture drift, and system integrity',
      },
      {
        title: 'Agents',
        path: '/agents',
        icon: Bot,
        description: 'Agent status and capabilities',
      },
    ],
  },
  {
    label: 'Operations',
    mode: 'cockpit',
    items: [
      {
        title: 'Chains',
        path: '/chains',
        icon: Layers,
        description: 'Chain execution history',
      },
      {
        title: 'Cron',
        path: '/cron',
        icon: RefreshCw,
        description: 'Scheduled jobs and triggers',
      },
      {
        title: 'Value Flywheel',
        path: '/flywheel',
        icon: RotateCw,
        description: '5-pillar compound health and harvest-adjacent signals',
      },
      {
        title: 'Pheromone',
        path: '/pheromone',
        icon: Sparkles,
        description: 'Signal layer activity and nudge substrate',
      },
      {
        title: 'OpenClaw',
        path: '/openclaw',
        icon: Zap,
        description: 'OpenClaw gateway',
      },
    ],
  },
  {
    label: 'Signals',
    mode: 'cockpit',
    items: [
      {
        title: 'Fleet Learning',
        path: '/fleet-learning',
        icon: Users,
        description: 'Agent fleet performance',
      },
      {
        title: 'Inventor',
        path: '/inventor',
        icon: Lightbulb,
        description: 'Evolution experiments',
      },
      {
        title: 'Benchmark',
        path: '/benchmark',
        icon: FlaskConical,
        description: 'Inventor vs. research baselines',
      },
      {
        title: 'Anomaly',
        path: '/anomaly',
        icon: AlertTriangle,
        description: 'Anomaly detection and active issues',
      },
      {
        title: 'Adoption',
        path: '/adoption',
        icon: Network,
        description: 'Tool adoption metrics and Phantom loop routing',
      },
      {
        title: 'Cost Intel',
        path: '/cost',
        icon: TrendingUp,
        description: 'Token and DKK costs',
      },
      {
        title: 'Audit Log',
        path: '/audit',
        icon: Activity,
        description: 'System audit trail',
      },
      {
        title: 'Cognitive',
        path: '/cognitive',
        icon: Brain,
        description: 'RLM reasoning status',
      },
    ],
  },
  {
    label: 'System',
    mode: 'shared',
    items: [
      {
        title: 'Settings',
        path: '/settings',
        icon: Settings,
        description: 'Configuration and preferences',
      },
    ],
  },
]

export function getSidebarGroupsForMode(mode: AppMode): NavGroup[] {
  return sidebarData.filter((group) => group.mode === mode || group.mode === 'shared')
}

export function findRouteMeta(pathname: string) {
  const items = sidebarData.flatMap((group) => group.items)

  if (pathname === '/') {
    return items.find((item) => item.path === '/')
  }

  return items.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

export const settingsSubPages = [
  { title: 'Account', path: '/settings/account', icon: Settings },
  { title: 'Appearance', path: '/settings/appearance', icon: Settings },
  { title: 'Activity', path: '/settings/activity', icon: Activity },
  { title: 'Integrations', path: '/settings/integrations', icon: Network },
  { title: 'API Keys', path: '/settings/api-keys', icon: Zap },
]
