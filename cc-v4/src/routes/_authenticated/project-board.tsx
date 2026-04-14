/**
 * project-board.tsx — Linear-backed project board with backlog management
 *
 * Shows issues by status (Backlog → Todo → In Progress → Done),
 * allows creating/editing issues, and assigns agents to work.
 * Connects to Linear via the orchestrator's Linear MCP tools.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { apiGet, apiPost, normalizeError } from '@/lib/api-client'
import { EngagementScopeBanner } from '@/components/shared/EngagementScopeBanner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Plus, Edit2, CheckCircle2, Play, AlertCircle, WifiOff, RefreshCw, Filter,
  Users, Clock, ChevronRight, ExternalLink, GitBranch, Tag,
} from 'lucide-react'

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

interface ApiErrorInfo {
  message: string
  status?: number
  isOffline: boolean
  isRetryable: boolean
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

interface ActionFeedback {
  kind: 'success' | 'error'
  message: string
}

// ─── Priority helpers ────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: 'None', color: 'text-gray-500', bg: 'bg-gray-100' },
  1: { label: 'Urgent', color: 'text-red-600', bg: 'bg-red-100' },
  2: { label: 'High', color: 'text-orange-600', bg: 'bg-orange-100' },
  3: { label: 'Normal', color: 'text-blue-600', bg: 'bg-blue-100' },
  4: { label: 'Low', color: 'text-gray-400', bg: 'bg-gray-50' },
}

const STATE_COLUMNS = [
  { key: 'backlog', label: 'Backlog', color: 'bg-slate-400' },
  { key: 'todo', label: 'Todo', color: 'bg-blue-500' },
  { key: 'in progress', label: 'In Progress', color: 'bg-yellow-500' },
  { key: 'completed', label: 'Done', color: 'bg-green-500' },
] as const

type BoardState = typeof STATE_COLUMNS[number]['key']

function formatStateLabel(state: string): string {
  return state === 'in progress'
    ? 'In Progress'
    : state.charAt(0).toUpperCase() + state.slice(1)
}

function normalizeBoardState(state: string | null | undefined): BoardState {
  const value = state?.trim().toLowerCase()
  if (value === 'todo' || value === 'unstarted') return 'todo'
  if (value === 'started' || value === 'in_progress' || value === 'in progress') return 'in progress'
  if (value === 'completed' || value === 'done' || value === 'canceled' || value === 'cancelled') return 'completed'
  return 'backlog'
}

function toLinearStatePayload(state: string): 'Backlog' | 'Todo' | 'In Progress' | 'Completed' {
  const normalized = normalizeBoardState(state)
  if (normalized === 'todo') return 'Todo'
  if (normalized === 'in progress') return 'In Progress'
  if (normalized === 'completed') return 'Completed'
  return 'Backlog'
}

function applyIssueState(issues: LinearIssue[] | undefined, id: string, state: string): LinearIssue[] {
  if (!issues) return []
  const updatedAt = new Date().toISOString()
  return issues.map(issue => issue.id === id
    ? { ...issue, state: toLinearStatePayload(state), updatedAt }
    : issue)
}

function dedupeIssues(issues: LinearIssue[] | undefined): LinearIssue[] {
  if (!issues || issues.length === 0) return []
  const byKey = new Map<string, LinearIssue>()
  for (const issue of issues) {
    const key = issue.id || issue.identifier
    if (!key) continue
    if (!byKey.has(key)) {
      byKey.set(key, issue)
      continue
    }
    const existing = byKey.get(key)!
    const existingTs = Date.parse(existing.updatedAt || existing.createdAt || '')
    const candidateTs = Date.parse(issue.updatedAt || issue.createdAt || '')
    if (!Number.isNaN(candidateTs) && (Number.isNaN(existingTs) || candidateTs >= existingTs)) {
      byKey.set(key, issue)
    }
  }
  return Array.from(byKey.values())
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ProjectBoardPage() {
  const queryClient = useQueryClient()
  const [createDialog, setCreateDialog] = useState(false)
  const [editIssue, setEditIssue] = useState<LinearIssue | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<LinearIssue | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [apiError, setApiError] = useState<ApiErrorInfo | null>(null)
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null)

  // Fetch issues from Linear via orchestrator MCP proxy
  const { data: issues, isLoading: loadingIssues, error: issuesError, refetch: refetchIssues } = useQuery<LinearIssue[]>({
    queryKey: ['linear-issues'],
    queryFn: async () => {
      try {
        setApiError(null)
        return await apiGet<LinearIssue[]>('/api/linear/issues?limit=100')
      } catch (e) {
        const err = normalizeError(e)
        setApiError(err)
        throw e
      }
    },
    refetchInterval: 30000,
    retry: (count, error) => {
      const err = normalizeError(error)
      return err.isRetryable && count < 2
    },
  })

  // Fetch labels
  const { data: labels } = useQuery<LinearLabel[]>({
    queryKey: ['linear-labels'],
    queryFn: () => apiGet<LinearLabel[]>('/api/linear/labels'),
    refetchInterval: 60000,
    retry: false, // labels are non-critical
  })

  const uniqueIssues = useMemo(() => dedupeIssues(issues), [issues])

  // Filter issues
  const filteredIssues = useMemo(() => uniqueIssues.filter(issue => {
    const state = normalizeBoardState(issue.state)
    if (filterStatus !== 'all' && state !== normalizeBoardState(filterStatus)) return false
    if (filterAssignee !== 'all') {
      const assigneeName = issue.assignee?.name || 'Unassigned'
      if (assigneeName.toLowerCase() !== filterAssignee.toLowerCase()) return false
    }
    return true
  }), [uniqueIssues, filterStatus, filterAssignee])

  // Group by status
  const grouped = filteredIssues.reduce<Record<string, LinearIssue[]>>((acc, issue) => {
    const state = normalizeBoardState(issue.state)
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
    mutationFn: ({ id, state }: { id: string; state: string; identifier?: string }) =>
      apiPost(`/api/linear/issues/${id}`, { state: toLinearStatePayload(state) }),
    onMutate: async ({ id, state }) => {
      setApiError(null)
      setActionFeedback(null)
      await queryClient.cancelQueries({ queryKey: ['linear-issues'] })
      const previousIssues = queryClient.getQueryData<LinearIssue[]>(['linear-issues'])
      queryClient.setQueryData<LinearIssue[]>(['linear-issues'], current => applyIssueState(current, id, state))
      setSelectedIssue(current => current?.id === id ? { ...current, state: toLinearStatePayload(state), updatedAt: new Date().toISOString() } : current)
      return { previousIssues }
    },
    onError: (error, variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(['linear-issues'], context.previousIssues)
        const previousSelected = context.previousIssues.find(issue => issue.id === variables.id)
        if (previousSelected) {
          setSelectedIssue(current => current?.id === variables.id ? previousSelected : current)
        }
      }
      const err = normalizeError(error)
      setApiError(err)
      setActionFeedback({
        kind: 'error',
        message: `Could not move ${variables.identifier ?? 'issue'} to ${formatStateLabel(normalizeBoardState(variables.state))}.`,
      })
    },
    onSuccess: (_data, variables) => {
      setActionFeedback({
        kind: 'success',
        message: `${variables.identifier ?? 'Issue'} moved to ${formatStateLabel(normalizeBoardState(variables.state))}.`,
      })
      queryClient.invalidateQueries({ queryKey: ['linear-issues'] })
    },
  })

  // Unique assignees
  const assignees = [...new Set(
    uniqueIssues.map(i => i.assignee?.name || 'Unassigned')
  )].sort()

  // Stats
  const totalIssues = uniqueIssues.length
  const inProgress = uniqueIssues.filter(i => normalizeBoardState(i.state) === 'in progress').length
  const completed = uniqueIssues.filter(i => normalizeBoardState(i.state) === 'completed').length
  const urgent = uniqueIssues.filter(i => i.priority === 1).length

  return (
    <div className="flex flex-col gap-6 p-8">
      <EngagementScopeBanner
        current="/project-board"
        description="Execution Board is operating within the active engagement, so issues can be treated as downstream actions from the same consulting mission."
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Project Board</h1>
          <p className="text-muted-foreground mt-1">
            Linear Kanban — view, edit, and assign work to agents
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchIssues()} disabled={loadingIssues}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loadingIssues ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Issue
          </Button>
        </div>
      </div>

      {/* Offline indicator */}
      {apiError?.isOffline && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Connection lost</AlertTitle>
          <AlertDescription>
            Cannot reach the Linear proxy. Retrying automatically...
            <Button variant="outline" size="sm" className="ml-2" onClick={() => refetchIssues()}>
              Retry now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* API error (non-offline) */}
      {apiError && !apiError.isOffline && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Linear API Error</AlertTitle>
          <AlertDescription>
            {apiError.message}
            {apiError.status === 401 && ' — Please sign in again.'}
            {apiError.status === 403 && ' — You do not have permission to access Linear.'}
            {apiError.status === 429 && ' — Rate limited. Please wait a moment.'}
          </AlertDescription>
        </Alert>
      )}

      {actionFeedback && (
        <Alert variant={actionFeedback.kind === 'error' ? 'destructive' : 'default'}>
          {actionFeedback.kind === 'error'
            ? <AlertCircle className="h-4 w-4" />
            : <CheckCircle2 className="h-4 w-4" />}
          <AlertTitle>{actionFeedback.kind === 'error' ? 'Action failed' : 'Board updated'}</AlertTitle>
          <AlertDescription>{actionFeedback.message}</AlertDescription>
        </Alert>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total" value={totalIssues} icon={Filter} sub="Linear issues" color="var(--color-primary)" />
        <KpiCard label="In Progress" value={inProgress} icon={Play} sub="active work" color="var(--color-warning)" />
        <KpiCard label="Completed" value={completed} icon={CheckCircle2} sub="done" color="var(--color-success)" />
        <KpiCard label="Urgent" value={urgent} icon={AlertCircle} sub="P0 priority" color={urgent > 0 ? 'var(--color-destructive)' : 'var(--color-success)'} />
        <KpiCard label="Assignees" value={assignees.length} icon={Users} sub="active agents" color="var(--color-secondary)" />
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        <div className="flex gap-2">
          {['all', 'backlog', 'todo', 'in progress', 'completed'].map(status => (
            <Button
              key={status}
              variant={filterStatus === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus(status)}
            >
              {status === 'all' ? 'All' : status === 'in progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)}
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
      {loadingIssues ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {STATE_COLUMNS.map(col => (
            <div key={col.key} className="space-y-3">
              <Skeleton className="h-6 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {STATE_COLUMNS.map(col => {
            const colIssues = grouped[col.key] ?? []
            return (
              <div key={col.key} className="flex flex-col gap-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${col.color}`} />
                  <h2 className="text-sm font-semibold uppercase tracking-wider">{col.label}</h2>
                  <span className="text-xs text-muted-foreground ml-auto">{colIssues.length}</span>
                </div>

                {colIssues.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">
                    No issues
                  </div>
                ) : (
                  colIssues.map(issue => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onEdit={() => setEditIssue(issue)}
                      onSelect={() => setSelectedIssue(issue)}
                      onStateChange={(state) => quickStateMutation.mutate({ id: issue.id, state, identifier: issue.identifier })}
                      isMutating={quickStateMutation.isPending && quickStateMutation.variables?.id === issue.id}
                    />
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

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
              state: normalizeBoardState(editIssue.state),
            }}
            onSubmit={(payload) => updateMutation.mutate({ id: editIssue.id, ...payload })}
            isSubmitting={updateMutation.isPending}
          labels={labels}
        />
      )}

      {/* Issue Detail Dialog */}
      {selectedIssue && (
        <Dialog open={!!selectedIssue} onOpenChange={() => setSelectedIssue(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg">{selectedIssue.identifier}: {selectedIssue.title}</DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    if (selectedIssue.branchName) {
                      navigator.clipboard.writeText(selectedIssue.branchName!)
                    }
                  }}
                  title="Copy branch name"
                >
                  <GitBranch className="w-3 h-3" />
                </Button>
              </div>
              <DialogDescription>
                Created {new Date(selectedIssue.createdAt).toLocaleDateString()}
                {selectedIssue.assignee && ` · Assigned to ${selectedIssue.assignee.displayName}`}
                {selectedIssue.updatedAt && ` · Updated ${new Date(selectedIssue.updatedAt).toLocaleDateString()}`}
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
              {selectedIssue.labels.map((l, index) => (
                <Badge key={`${selectedIssue.id}-${l.name}-${index}`} variant="outline" style={{ borderColor: l.color, color: l.color }}>
                  <Tag className="w-3 h-3 mr-1" /> {l.name}
                </Badge>
              ))}
              {selectedIssue.priority !== null && selectedIssue.priority !== undefined && (
                <PriorityBadge priority={selectedIssue.priority} />
              )}
              {selectedIssue.estimate && (
                <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> {selectedIssue.estimate} pts</Badge>
              )}
              {selectedIssue.branchName && (
                <Badge variant="outline" className="font-mono text-xs">{selectedIssue.branchName}</Badge>
              )}
            </div>
            <DialogFooter className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setEditIssue(selectedIssue); setSelectedIssue(null) }}>
                <Edit2 className="w-3 h-3 mr-1" /> Edit
              </Button>
              {normalizeBoardState(selectedIssue.state) === 'backlog' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={quickStateMutation.isPending}
                  onClick={() => quickStateMutation.mutate({ id: selectedIssue.id, state: 'todo', identifier: selectedIssue.identifier })}
                >
                  <ChevronRight className="w-3 h-3 mr-1" />
                  {quickStateMutation.isPending && quickStateMutation.variables?.id === selectedIssue.id ? 'Queuing…' : 'Queue'}
                </Button>
              )}
              {normalizeBoardState(selectedIssue.state) !== 'in progress' && (
                <Button
                  variant="default"
                  size="sm"
                  disabled={quickStateMutation.isPending}
                  onClick={() => quickStateMutation.mutate({ id: selectedIssue.id, state: 'in progress', identifier: selectedIssue.identifier })}
                >
                  <Play className="w-3 h-3 mr-1" />
                  {quickStateMutation.isPending && quickStateMutation.variables?.id === selectedIssue.id ? 'Starting…' : 'Start work'}
                </Button>
              )}
              {normalizeBoardState(selectedIssue.state) !== 'completed' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={quickStateMutation.isPending}
                  onClick={() => quickStateMutation.mutate({ id: selectedIssue.id, state: 'completed', identifier: selectedIssue.identifier })}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {quickStateMutation.isPending && quickStateMutation.variables?.id === selectedIssue.id ? 'Completing…' : 'Complete'}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`https://linear.app/widgetdc/issue/${selectedIssue.identifier}`, '_blank')}
              >
                <ExternalLink className="w-3 h-3 mr-1" /> Open in Linear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub: string; color: string; icon: React.ElementType
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      </div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  )
}

function PriorityBadge({ priority }: { priority: number }) {
  const config = PRIORITY_LABELS[priority] ?? { label: 'Unknown', color: 'text-gray-500', bg: 'bg-gray-100' }
  return (
    <Badge variant="outline" className={`${config.bg} ${config.color} text-xs`}>
      P{priority} {config.label}
    </Badge>
  )
}

function IssueCard({
  issue,
  onEdit,
  onSelect,
  onStateChange,
  isMutating,
}: {
  issue: LinearIssue
  onEdit: () => void
  onSelect: () => void
  onStateChange: (state: string) => void
  isMutating: boolean
}) {
  const priorityConfig = issue.priority !== null && issue.priority !== undefined
    ? PRIORITY_LABELS[issue.priority]
    : null

  const stateLower = normalizeBoardState(issue.state)
  const nextStates = stateLower === 'backlog'
    ? ['todo', 'in progress']
    : stateLower === 'todo'
    ? ['in progress']
    : stateLower === 'in progress'
    ? ['completed']
    : []

  return (
    <div
      className="p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors group focus:outline-none focus:ring-2 focus:ring-primary/40"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{issue.title}</div>
          <div className="text-xs text-muted-foreground font-mono">{issue.identifier}</div>
        </div>
        <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          {stateLower !== 'in progress' && stateLower !== 'completed' && (
            <button
              onClick={(e) => { e.stopPropagation(); onStateChange('in progress') }}
              className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              disabled={isMutating}
              title="Start work"
            >
              <Play className="w-3 h-3" />
              {isMutating ? 'Starting…' : 'Start'}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onEdit() }} className="p-1 hover:bg-muted rounded" title="Edit">
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
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
          {formatStateLabel(stateLower)}
        </span>
        {priorityConfig && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityConfig.bg} ${priorityConfig.color}`}>
            P{issue.priority}
          </span>
        )}
        {issue.assignee && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-secondary text-secondary-foreground">
            {issue.assignee.displayName}
          </span>
        )}
        {issue.labels.slice(0, 2).map((l, index) => (
          <span key={`${issue.id}-${l.name}-${index}`} className="px-1.5 py-0.5 rounded text-[10px] border" style={{ borderColor: l.color, color: l.color }}>
            {l.name}
          </span>
        ))}
        {issue.labels.length > 2 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground">+{issue.labels.length - 2}</span>
        )}
      </div>

      {/* Quick state transitions */}
      {nextStates.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t">
          {nextStates.map(state => (
            <button
              key={state}
              disabled={isMutating}
              onClick={(e) => { e.stopPropagation(); onStateChange(state) }}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-50 ${
                state === 'in progress'
                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {state === 'in progress' ? <Play className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {isMutating ? 'Updating…' : state === 'in progress' ? 'Start work now' : state === 'completed' ? 'Done' : formatStateLabel(state)}
            </button>
          ))}
        </div>
      )}

      {issue.estimate && (
        <div className="text-xs text-muted-foreground mt-1">{issue.estimate} pts</div>
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
  initialData?: { title?: string; description?: string; priority?: number; state?: string; team?: string }
  onSubmit: (payload: CreateIssuePayload) => void
  isSubmitting: boolean
  labels?: LinearLabel[]
}) {
  const [formTitle, setFormTitle] = useState(initialData?.title ?? '')
  const [formDescription, setFormDescription] = useState(initialData?.description ?? '')
  const [formPriority, setFormPriority] = useState(initialData?.priority ?? 3)
  const [formState, setFormState] = useState(initialData?.state ?? 'backlog')
  const [formTeam, setFormTeam] = useState(initialData?.team ?? '')
  const [formAssignee, setFormAssignee] = useState('')
  const [formLabels, setFormLabels] = useState<string[]>([])
  const isCreateMode = !initialData

  const handleSubmit = () => {
    if (!formTitle.trim() || (isCreateMode && !formTeam.trim())) return
    onSubmit({
      title: formTitle.trim(),
      description: formDescription.trim() || undefined,
      team: formTeam.trim() || undefined,
      priority: formPriority,
      state: toLinearStatePayload(formState),
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
            Create or edit a Linear issue. Changes sync to Linear.
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
            <label className="text-sm font-medium">Linear team</label>
            <Input
              value={formTeam}
              onChange={e => setFormTeam(e.target.value)}
              placeholder="e.g., WidgeTDC or team ID"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Required when creating a new issue.
            </p>
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
              {labels?.length === 0 && (
                <span className="text-xs text-muted-foreground">No labels available</span>
              )}
              {labels?.map((label, index) => (
                <button
                  key={`${label.id ?? label.name}-${index}`}
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
          <Button onClick={handleSubmit} disabled={isSubmitting || !formTitle.trim() || (isCreateMode && !formTeam.trim())}>
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
