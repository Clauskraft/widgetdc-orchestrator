import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Bot,
  Boxes,
  Command,
  ExternalLink,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { apiPost } from '@/lib/api-client'
import type { AppMode } from '@/lib/app-shell'
import { getSidebarGroupsForMode } from './sidebar-data'

type CommandResult = {
  kind: 'success' | 'error'
  message: string
}

type CommandEntry = {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  keywords: string[]
  run: () => Promise<void> | void
}

function summarizeCommandResponse(response: any): string {
  const summary = response?.data?.summary
  if (typeof summary === 'string' && summary.length > 0) return summary
  if (response?.data?.command) return `${response.data.command} completed`
  return 'Command completed'
}

export function CommandPalette({
  mode,
  onResult,
}: {
  mode: AppMode
  onResult: (result: CommandResult) => void
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const navigationCommands = useMemo<CommandEntry[]>(() => {
    return getSidebarGroupsForMode(mode).flatMap((group) =>
      group.items.map((item) => ({
        id: `nav:${item.path}`,
        title: item.title,
        description: item.description ?? group.label,
        icon: item.icon,
        keywords: [group.label, item.title, item.path],
        run: () => {
          navigate({ to: item.path })
          setOpen(false)
        },
      })),
    )
  }, [mode, navigate])

  const actionCommands = useMemo<CommandEntry[]>(() => {
    const executeCommand = async (command: string) => {
      const response = await apiPost<{ success: boolean; data: { summary?: string; command: string } }>(
        '/api/cockpit/commands/execute',
        { command },
      )
      onResult({ kind: 'success', message: summarizeCommandResponse(response) })
      setOpen(false)
    }

    return [
      {
        id: 'action:mcp.initialize',
        title: 'Initialize MCP',
        description: 'Run a live orchestrator MCP initialize probe.',
        icon: Zap,
        keywords: ['mcp', 'initialize', 'gateway'],
        run: () => executeCommand('mcp.initialize'),
      },
      {
        id: 'action:mcp.list-tools',
        title: 'List MCP Tools',
        description: 'Probe orchestrator and backend tool visibility.',
        icon: Boxes,
        keywords: ['mcp', 'tools', 'backend'],
        run: () => executeCommand('mcp.list_tools'),
      },
      {
        id: 'action:providers.list',
        title: 'List Providers',
        description: 'Fetch live provider availability for qwen, gemini, claude and more.',
        icon: Bot,
        keywords: ['providers', 'qwen', 'gemini', 'anthropic', 'openai'],
        run: () => executeCommand('providers.list'),
      },
      {
        id: 'action:harvest.full',
        title: 'Run Full Harvest',
        description: 'Kick off the harvest pipeline from the cockpit.',
        icon: Layers,
        keywords: ['harvest', 'sources', 'pipeline'],
        run: () => executeCommand('harvest.full'),
      },
      {
        id: 'action:flywheel.sync',
        title: 'Run Flywheel Sync',
        description: 'Trigger the compound health sync loop.',
        icon: RefreshCw,
        keywords: ['flywheel', 'sync', 'health'],
        run: () => executeCommand('flywheel.sync'),
      },
      {
        id: 'action:pheromone.decay',
        title: 'Run Pheromone Decay',
        description: 'Execute a nudge-friendly pheromone decay cycle.',
        icon: Sparkles,
        keywords: ['pheromone', 'nudge', 'signals'],
        run: () => executeCommand('pheromone.decay'),
      },
      {
        id: 'external:open-webui',
        title: 'Open Open WebUI',
        description: 'Open the external chat-centric surface in a new tab.',
        icon: ExternalLink,
        keywords: ['open webui', 'chat', 'external'],
        run: () => {
          window.open('https://open-webui-production-25cb.up.railway.app', '_blank', 'noopener,noreferrer')
          onResult({ kind: 'success', message: 'Opened Open WebUI in a new tab.' })
          setOpen(false)
        },
      },
      {
        id: 'external:arch-mcp',
        title: 'Open arch-mcp',
        description: 'Open the current architecture service in a new tab.',
        icon: ExternalLink,
        keywords: ['architecture', 'arch mcp', 'external'],
        run: () => {
          window.open('https://arch-mcp-server-production.up.railway.app', '_blank', 'noopener,noreferrer')
          onResult({ kind: 'success', message: 'Opened arch-mcp in a new tab.' })
          setOpen(false)
        },
      },
    ]
  }, [onResult])

  const commands = useMemo(() => [...actionCommands, ...navigationCommands], [actionCommands, navigationCommands])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const lower = query.toLowerCase()
    return commands.filter((command) =>
      [command.title, command.description, ...command.keywords].some((value) =>
        value.toLowerCase().includes(lower),
      ),
    )
  }, [commands, query])

  async function runCommand(command: CommandEntry) {
    try {
      setBusyId(command.id)
      await command.run()
    } catch (error) {
      onResult({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Command failed',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Command className="mr-2 h-4 w-4" />
        Cmd
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Command Palette</DialogTitle>
            <DialogDescription>
              Run operator actions, jump between views, and open external surfaces from one place.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9"
                placeholder="Search commands, routes, providers, harvest, MCP…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="max-h-[28rem] space-y-2 overflow-y-auto">
              {filtered.map((command) => {
                const Icon = command.icon
                const isBusy = busyId === command.id
                return (
                  <button
                    key={command.id}
                    type="button"
                    onClick={() => void runCommand(command)}
                    disabled={busyId !== null}
                    className="flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition hover:bg-muted/50 disabled:opacity-60"
                  >
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{command.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{command.description}</div>
                    </div>
                    {isBusy && <span className="text-xs text-muted-foreground">Running…</span>}
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No commands matched your search.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
