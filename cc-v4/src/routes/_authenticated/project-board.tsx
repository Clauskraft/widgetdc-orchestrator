/**
 * project-board.tsx — Linear-backed project board with backlog management
 *
 * Shows issues by status (Backlog → Todo → In Progress → Done),
 * allows creating/editing issues, and assigns agents to work.
 * Connects to Linear via the orchestrator's Linear MCP proxy.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Plus, Edit2, CheckCircle2, Circle, Play, Pause } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface LinearIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  state: string
  priority: number | null
  assignee: { name: string; displayName: string } | null
  labels: { name: string; color: string }[]
  createdAt: string
  updatedAt: string
  estimate: number | null
  branchName: string | null
}

interface LinearLabel {
  id: string
  name: string
  color: string
  description: string | null
}

interface CreateIssuePayload {
  title: string
  description?: string
  team?: string
  priority?: number
  assignee?: string
  labels?: string[]
  state?: string
  estimate?: number
}

// ─── Priority helpers ────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'None', color: 'bg-gray-500' },
  1: { label: 'Urgent', color: 'bg-red-500' },
  2: { label: 'High', color: 'bg-orange-500' },
  3: { label: 'Normal', color: 'bg-blue-500' },
  4: { label: 'Low', color: 'bg-gray-400' },
}

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-slate-500',
  todo: 'bg-blue-500',
  'in progress': 'bg-yellow-500',
  completed: 'bg-green-500',
  canceled: 'bg-red-500',
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ProjectBoardPage() {
  const queryClient = useQueryClient()
  const [createDialog, setCreateDialog] = useState(false)
  const [editIssue, setEditIssue] = useState<LinearIssue | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<LinearIssue | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')

  // Fetch issues from Linear via orchestrator
  const { data: issues, isLoading: loadingIssues } = useQuery<LinearIssue[]>({
    queryKey: ['linear-issues'],
    queryFn: () => apiGet('/api/linear/issues?limit=100'),
    refetchInterval: 30000,
  })

  // Fetch labels
  const { data: labels, isLoading: loadingLabels } = useQuery<LinearLabel[]>({
    queryKey: ['linear-labels'],
    queryFn: () => apiGet('/api/linear/labels'),
    refetchInterval: 60000,
  })

  // Filter issues
  const filteredIssues = issues?.filter(issue => {
    if (filterStatus !== 'all' && issue.state.toLowerCase() !== filterStatus.toLowerCase()) return false
    if (filterAssignee !== 'all') {
      const assigneeName = issue.assignee?.name || 'Unassigned'
      if (assigneeName.toLowerCase() !== filterAssignee.toLowerCase()) return false
    }
    return true
  }) ?? []

  // Group by status
  const grouped = filteredIssues.reduce<Record<string, LinearIssue[]>>((acc, issue) => {
    const state = issue.state.toLowerCase()
    if (!acc[state]) acc[state] = []
    acc[state].push(issue)
    return acc
  }, {})

  // Create issue mutation
  const createMutation = useMutation({
    mutationFn: (payload: CreateIssuePayload) =>
      apiPost('/api/linear/issues', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linear-issues'] })
      setCreateDialog(false)
    },
  })

  // Update issue mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }: CreateIssuePayload & { id: string }) =>
      apiPost(`/api/linear/issues/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linear-issues'] })
      setEditIssue(null)
    },
  })

  // Quick state change
  const quickStateMutation = useMutation({
    mutationFn: ({ id, state }: { id: string; state: string }) =>
      apiPost(`/api/linear/issues/${id}`, { state }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['linear-issues'] }),
  })

  // Unique assignees
  const assignees = [...new Set(
    issues?.map(i => i.assignee?.name || 'Unassigned')
  )].sort()

  // Stats
  const totalIssues = issues?.length ?? 0
  const inProgress = issues?.filter(i => i.state.toLowerCase() === 'in progress').length ?? 0
  const completed = issues?.filter(i => i.state.toLowerCase() === 'completed').length ?? 0
  const urgent = issues?.filter(i => i.priority === 1).length ?? 0

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Project Board</h1>
          <p className="text-muted-foreground mt-1">
            Linear backlog — view, edit, and assign work to agents
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Issue
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Issues" value={totalIssues} sub="Linear" color="var(--color-primary)" />
        <KpiCard label="In Progress" value={inProgress} sub="active work" color="var(--color-warning)" />
        <KpiCard label="Completed" value={completed} sub="this sprint" color="var(--color-success)" />
        <KpiCard label="Urgent" value={urgent} sub="P0 priority" color={urgent > 0 ? 'var(--color-destructive)' : 'var(--color-success)'} />
        <KpiCard label="Agents Active" value="0" sub="of 56 online" color="var(--color-primary)" />
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="flex gap-2">
          {['all', 'backlog', 'todo', 'in progress', 'completed'].map(status => (
            <Button
              key={status}
              variant={filterStatus === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus(status)}
            >
              {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>
        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            {assignees.map(a => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Board columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {(['backlog', 'todo', 'in progress', 'completed'] as const).map(column => (
          <div key={column} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-3 h-3 rounded-full ${STATE_COLORS[column] ?? 'bg-gray-500'}`} />
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                {column === 'in progress' ? 'In Progress' : column.charAt(0).toUpperCase() + column.slice(1)}
              </h2>
              <span className="text-xs text-muted-foreground">
                {(grouped[column] ?? []).length}
              </span>
            </div>

            {(grouped[column] ?? []).map(issue => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onEdit={() => setEditIssue(issue)}
                onSelect={() => setSelectedIssue(issue)}
                onStateChange={(state) => quickStateMutation.mutate({ id: issue.id, state })}
              />
            ))}

            {(!grouped[column] || grouped[column].length === 0) && (
              <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">
                No {column} issues
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create Issue Dialog */}
      <IssueDialog
        open={createDialog}
        onOpenChange={setCreateDialog}
        title="Create Issue"
        onSubmit={(payload) => createMutation.mutate(payload)}
        isSubmitting={createMutation.isPending}
        labels={labels}
      />

      {/* Edit Issue Dialog */}
      {editIssue && (
        <IssueDialog
          open={!!editIssue}
          onOpenChange={() => setEditIssue(null)}
          title={`Edit ${editIssue.identifier}`}
          initialData={{
            title: editIssue.title,
            description: editIssue.description ?? '',
            priority: editIssue.priority ?? 3,
            state: editIssue.state.toLowerCase(),
          }}
          onSubmit={(payload) => updateMutation.mutate({ id: editIssue.id, ...payload })}
          isSubmitting={updateMutation.isPending}
          labels={labels}
        />
      )}

      {/* Issue Detail Dialog */}
      {selectedIssue && (
        <Dialog open={!!selectedIssue} onOpenChange={() => setSelectedIssue(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedIssue.identifier}: {selectedIssue.title}</DialogTitle>
              <DialogDescription>
                Created {new Date(selectedIssue.createdAt).toLocaleDateString()}
                {selectedIssue.assignee && ` · Assigned to ${selectedIssue.assignee.displayName}`}
              </DialogDescription>
            </DialogHeader>
            {selectedIssue.description && (
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">
                  {selectedIssue.description}
                </pre>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-4">
              {selectedIssue.labels.map(l => (
                <Badge key={l.name} variant="outline" style={{ borderColor: l.color, color: l.color }}>
                  {l.name}
                </Badge>
              ))}
              {selectedIssue.priority !== null && selectedIssue.priority !== undefined && (
                <PriorityBadge priority={selectedIssue.priority} />
              )}
              {selectedIssue.estimate && (
                <Badge variant="secondary">{selectedIssue.estimate} pts</Badge>
              )}
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setEditIssue(selectedIssue); setSelectedIssue(null) }}>
                <Edit2 className="w-3 h-3 mr-1" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickStateMutation.mutate({ id: selectedIssue.id, state: 'In Progress' })}>
                <Play className="w-3 h-3 mr-1" /> Start
              </Button>
              <Button variant="outline" size="sm" onClick={() => quickStateMutation.mutate({ id: selectedIssue.id, state: 'Completed' })}>
                <CheckCircle2 className="w-3 h-3 mr-1" /> Complete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  )
}

function PriorityBadge({ priority }: { priority: number }) {
  const config = PRIORITY_LABELS[priority] ?? { label: 'Unknown', color: 'bg-gray-500' }
  return (
    <Badge variant="outline" className={`${config.color} text-white text-xs`}>
      P{priority} {config.label}
    </Badge>
  )
}

function IssueCard({
  issue,
  onEdit,
  onSelect,
  onStateChange,
}: {
  issue: LinearIssue
  onEdit: () => void
  onSelect: () => void
  onStateChange: (state: string) => void
}) {
  const priorityConfig = issue.priority !== null && issue.priority !== undefined
    ? PRIORITY_LABELS[issue.priority]
    : null

  return (
    <div
      className="p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{issue.title}</div>
          <div className="text-xs text-muted-foreground font-mono">{issue.identifier}</div>
        </div>
        <div className="flex gap-1">
          <button onClick={(e) => { e.stopPropagation(); onEdit() }} className="p-1 hover:bg-muted rounded">
            <Edit2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {issue.description && (
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {issue.description}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-2">
        {priorityConfig && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityConfig.color} text-white`}>
            P{issue.priority}
          </span>
        )}
        {issue.assignee && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-secondary text-secondary-foreground">
            {issue.assignee.displayName}
          </span>
        )}
        {issue.labels.slice(0, 2).map(l => (
          <span key={l.name} className="px-1.5 py-0.5 rounded text-[10px] border" style={{ borderColor: l.color, color: l.color }}>
            {l.name}
          </span>
        ))}
        {issue.labels.length > 2 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground">+{issue.labels.length - 2}</span>
        )}
      </div>

      {issue.estimate && (
        <div className="text-xs text-muted-foreground mt-1">{issue.estimate} estimate points</div>
      )}
    </div>
  )
}

function IssueDialog({
  open,
  onOpenChange,
  title,
  initialData,
  onSubmit,
  isSubmitting,
  labels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  initialData?: { title?: string; description?: string; priority?: number; state?: string }
  onSubmit: (payload: CreateIssuePayload) => void
  isSubmitting: boolean
  labels?: LinearLabel[]
}) {
  const [formTitle, setFormTitle] = useState(initialData?.title ?? '')
  const [formDescription, setFormDescription] = useState(initialData?.description ?? '')
  const [formPriority, setFormPriority] = useState(initialData?.priority ?? 3)
  const [formState, setFormState] = useState(initialData?.state ?? 'backlog')
  const [formAssignee, setFormAssignee] = useState('')
  const [formLabels, setFormLabels] = useState<string[]>([])

  const handleSubmit = () => {
    if (!formTitle.trim()) return
    onSubmit({
      title: formTitle.trim(),
      description: formDescription.trim() || undefined,
      priority: formPriority,
      state: formState.charAt(0).toUpperCase() + formState.slice(1),
      assignee: formAssignee || undefined,
      labels: formLabels.length > 0 ? formLabels : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Create or edit a Linear issue. Changes sync to Linear immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Title</label>
            <Input
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              placeholder="Issue title..."
            />
          </div>

          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder="Describe the issue..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Priority</label>
              <Select value={String(formPriority)} onValueChange={v => setFormPriority(parseInt(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">P0 — None</SelectItem>
                  <SelectItem value="1">P1 — Urgent</SelectItem>
                  <SelectItem value="2">P2 — High</SelectItem>
                  <SelectItem value="3">P3 — Normal</SelectItem>
                  <SelectItem value="4">P4 — Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">State</label>
              <Select value={formState} onValueChange={setFormState}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="backlog">Backlog</SelectItem>
                  <SelectItem value="todo">Todo</SelectItem>
                  <SelectItem value="in progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Assignee (agent name)</label>
            <Input
              value={formAssignee}
              onChange={e => setFormAssignee(e.target.value)}
              placeholder="e.g., qwen, claude, codex, gemini..."
            />
          </div>

          <div>
            <label className="text-sm font-medium">Labels</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {labels?.map(label => (
                <button
                  key={label.name}
                  onClick={() => setFormLabels(prev =>
                    prev.includes(label.name) ? prev.filter(l => l !== label.name) : [...prev, label.name]
                  )}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    formLabels.includes(label.name) ? 'bg-accent' : 'bg-transparent'
                  }`}
                  style={{ borderColor: label.color, color: label.color }}
                >
                  {label.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !formTitle.trim()}>
            {isSubmitting ? 'Saving...' : initialData ? 'Update Issue' : 'Create Issue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/_authenticated/project-board')({
  component: ProjectBoardPage,
})
