import {
  BarChart3,
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
  LogOut,
  RefreshCw,
  Lightbulb,
  Activity,
  RotateCw,
  FlaskConical,
  LayoutDashboard,
  Kanban,
} from 'lucide-react'

export interface NavItem {
  title: string
  path: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const sidebarData: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      {
        title: 'Dashboard',
        path: '/',
        icon: Home,
        description: 'Platform overview and KPIs',
      },
      {
        title: 'Project Overview',
        path: '/project-overview',
        icon: LayoutDashboard,
        description: 'Engagements, decisions, architecture, drill-down',
      },
      {
        title: 'Project Board',
        path: '/project-board',
        icon: Kanban,
        description: 'Linear backlog — view, edit, assign agents',
      },
      {
        title: 'Agents',
        path: '/agents',
        icon: Bot,
        description: 'Agent status and capabilities',
      },
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
    ],
  },
  {
    label: 'Intelligence',
    items: [
      {
        title: 'Chat',
        path: '/chat',
        icon: MessageSquare,
        description: 'Real-time chat interface',
      },
      {
        title: 'Omega SITREP',
        path: '/omega',
        icon: ShieldAlert,
        description: 'Governance and compliance status',
      },
      {
        title: 'Knowledge',
        path: '/knowledge',
        icon: BookOpen,
        description: 'Knowledge graph search',
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
    label: 'Platform',
    items: [
      {
        title: 'Value Flywheel',
        path: '/flywheel',
        icon: RotateCw,
        description: '5-pillar compound health',
      },
      {
        title: 'Pheromone',
        path: '/pheromone',
        icon: Sparkles,
        description: 'Signal layer activity',
      },
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
        description: 'Anomaly detection',
      },
    ],
  },
  {
    label: 'Analytics',
    items: [
      {
        title: 'Audit Log',
        path: '/audit',
        icon: Activity,
        description: 'System audit trail',
      },
      {
        title: 'Cost Intel',
        path: '/cost',
        icon: TrendingUp,
        description: 'Token and DKK costs',
      },
      {
        title: 'Adoption',
        path: '/adoption',
        icon: Network,
        description: 'Tool adoption metrics',
      },
    ],
  },
  {
    label: 'Integrations',
    items: [
      {
        title: 'OpenClaw',
        path: '/openclaw',
        icon: Zap,
        description: 'OpenClaw gateway',
      },
      {
        title: 'Obsidian Vault',
        path: '/obsidian',
        icon: BookOpen,
        description: 'Vault integration',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        title: 'Settings',
        path: '/settings',
        icon: Settings,
        description: 'Configuration and preferences',
      },
      {
        title: 'Help Center',
        path: '/help',
        icon: HelpCircle,
        description: 'Documentation and support',
      },
    ],
  },
]

export const settingsSubPages = [
  { title: 'Account', path: '/settings/account', icon: Settings },
  { title: 'Appearance', path: '/settings/appearance', icon: Settings },
  { title: 'Activity', path: '/settings/activity', icon: Activity },
  { title: 'Integrations', path: '/settings/integrations', icon: Network },
  { title: 'API Keys', path: '/settings/api-keys', icon: Zap },
]
