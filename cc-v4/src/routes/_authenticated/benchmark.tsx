import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { RefreshCw, Play, FlaskConical, TrendingUp, Trophy, Clock } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BenchmarkTask {
  id: string
  name: string
  description: string
  paperBaseline?: number
  paperRounds?: number
  paperSource?: string
  defaultMaxRounds: number
  tags: string[]
}

interface BenchmarkRun {
  runId: string
  taskId: string
  strategy: string
  maxRounds: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: string
  completedAt?: string
  bestScore: number
  bestRound: number
  scoreHistory: number[]
  solutionDiversity: number
  totalRounds: number
  inventorExperimentName: string
  paperBaseline?: number
  gainVsBaseline?: number
  error?: string
}

interface AblationStrategy {
  strategy: string
  run: BenchmarkRun
  rank: number
  convergenceRound: number
  efficiencyScore: number
}

interface AblationReport {
  taskId: string
  generatedAt: string
  strategies: AblationStrategy[]
  winner: string
  recommendation: string
  paperBaseline?: number
  bestAchieved: number
  gapToPaper: number
}

interface TasksResponse { success: boolean; tasks: BenchmarkTask[] }
interface RunsResponse { success: boolean; runs: BenchmarkRun[]; total: number }
interface AblationResponse { success: boolean; available: boolean; report?: AblationReport }

// ─── Constants ────────────────────────────────────────────────────────────────

const STRATEGY_COLORS: Record<string, string> = {
  ucb1: '#6366f1',
  greedy: '#22c55e',
  random: '#f59e0b',
  island: '#ec4899',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  completed: 'default',
  running: 'secondary',
  pending: 'secondary',
  failed: 'destructive',
  stopped: 'secondary',
}

// ─── Score Chart ──────────────────────────────────────────────────────────────

function ScoreHistoryChart({ runs, paperBaseline }: { runs: BenchmarkRun[]; paperBaseline?: number }) {
  const maxLen = Math.max(...runs.map(r => r.scoreHistory.length), 1)
  const data = Array.from({ length: maxLen }, (_, i) => {
    const pt: Record<string, number> = { round: i + 1 }
    for (const r of runs) {
      if (r.scoreHistory[i] != null) {
        pt[r.strategy] = parseFloat((r.scoreHistory[i] * 100).toFixed(1))
      }
    }
    return pt
  })

  const normalised = paperBaseline != null ? parseFloat((paperBaseline / 4.0 * 100).toFixed(1)) : undefined

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: -8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="round" tick={{ fontSize: 11 }} label={{ value: 'Round', position: 'insideBottom', offset: -2, fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
        <Tooltip formatter={(v: number) => [`${v}%`, '']} labelFormatter={(l) => `Round ${l}`} />
        <Legend />
        {runs.map(r => (
          <Line
            key={r.strategy}
            type="monotone"
            dataKey={r.strategy}
            stroke={STRATEGY_COLORS[r.strategy] ?? '#6366f1'}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
        {normalised != null && (
          <ReferenceLine
            y={normalised}
            stroke="#f59e0b"
            strokeDasharray="6 3"
            label={{ value: `Paper SOTA ${normalised}%`, position: 'insideTopRight', fontSize: 10, fill: '#f59e0b' }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function BenchmarkPage() {
  const queryClient = useQueryClient()
  const [selectedTask, setSelectedTask] = useState<string>('circle-packing')
  const [selectedStrategy, setSelectedStrategy] = useState<string>('ucb1')
  const [maxRounds, setMaxRounds] = useState<number>(25)
  const [launching, setLaunching] = useState(false)
  const [ablating, setAblating] = useState(false)

  const { data: tasksRes, isLoading: tasksLoading } = useQuery<TasksResponse>({
    queryKey: ['benchmark-tasks'],
    queryFn: () => apiGet('/api/benchmark/tasks'),
    staleTime: Infinity,
  })

  const { data: runsRes, isLoading: runsLoading } = useQuery<RunsResponse>({
    queryKey: ['benchmark-runs', selectedTask],
    queryFn: () => apiGet(`/api/benchmark/runs?taskId=${selectedTask}`),
    refetchInterval: 10000,
  })

  const { data: ablationRes } = useQuery<AblationResponse>({
    queryKey: ['benchmark-ablation', selectedTask],
    queryFn: () => apiGet(`/api/benchmark/ablation/${selectedTask}/report`),
    refetchInterval: 30000,
  })

  const tasks = tasksRes?.tasks ?? []
  const runs = runsRes?.runs ?? []
  const activeTask = tasks.find(t => t.id === selectedTask)
  const ablationReport = ablationRes?.available ? ablationRes.report : null

  // Runs per strategy for chart (best run per strategy by score)
  const chartRuns = Object.values(
    runs.reduce<Record<string, BenchmarkRun>>((acc, r) => {
      if (!acc[r.strategy] || r.bestScore > acc[r.strategy].bestScore) {
        acc[r.strategy] = r
      }
      return acc
    }, {})
  ).filter(r => r.scoreHistory.length > 0)

  async function launchRun() {
    setLaunching(true)
    try {
      await apiPost('/api/benchmark/run', {
        taskId: selectedTask,
        strategy: selectedStrategy,
        maxRounds,
      })
      await queryClient.invalidateQueries({ queryKey: ['benchmark-runs', selectedTask] })
    } finally {
      setLaunching(false)
    }
  }

  async function launchAblation() {
    setAblating(true)
    try {
      await apiPost('/api/benchmark/ablation', {
        taskId: selectedTask,
        maxRoundsPerStrategy: maxRounds,
      })
      await queryClient.invalidateQueries({ queryKey: ['benchmark-runs', selectedTask] })
      await queryClient.invalidateQueries({ queryKey: ['benchmark-ablation', selectedTask] })
    } finally {
      setAblating(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Benchmark</h1>
          <p className="text-muted-foreground mt-1">
            Inventor vs. research baselines — circle-packing SOTA ≈ 2.635 (arXiv:2603.29640)
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['benchmark-runs', selectedTask] })
            queryClient.invalidateQueries({ queryKey: ['benchmark-ablation', selectedTask] })
          }}
          className="flex items-center gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Task selector */}
            <div className="flex flex-col gap-1.5 min-w-[220px]">
              <span className="text-xs text-muted-foreground font-medium">Task</span>
              {tasksLoading ? <Skeleton className="h-9 w-full" /> : (
                <Select value={selectedTask} onValueChange={setSelectedTask}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tasks.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Strategy selector */}
            <div className="flex flex-col gap-1.5 min-w-[140px]">
              <span className="text-xs text-muted-foreground font-medium">Strategy</span>
              <Select value={selectedStrategy} onValueChange={setSelectedStrategy}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['ucb1', 'greedy', 'random', 'island'].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Max rounds */}
            <div className="flex flex-col gap-1.5 min-w-[100px]">
              <span className="text-xs text-muted-foreground font-medium">Max Rounds</span>
              <input
                type="number"
                min={5}
                max={100}
                value={maxRounds}
                onChange={e => setMaxRounds(parseInt(e.target.value) || 25)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pb-0.5">
              <Button
                size="sm"
                onClick={launchRun}
                disabled={launching}
                className="flex items-center gap-1.5"
              >
                {launching
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <Play className="h-3.5 w-3.5" />}
                {launching ? 'Launching…' : 'Run'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={launchAblation}
                disabled={ablating}
                className="flex items-center gap-1.5"
              >
                {ablating
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <FlaskConical className="h-3.5 w-3.5" />}
                {ablating ? 'Starting…' : 'Ablation (4 strategies)'}
              </Button>
            </div>
          </div>

          {/* Task description */}
          {activeTask && (
            <div className="mt-4 text-sm text-muted-foreground border-t pt-3">
              <span className="font-medium text-foreground">{activeTask.name}</span>
              {' · '}
              {activeTask.description}
              {activeTask.paperBaseline != null && (
                <span className="ml-2 font-mono text-amber-500">
                  Paper SOTA: {activeTask.paperBaseline} ({activeTask.paperSource})
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runsLoading ? <Skeleton className="h-8 w-12" /> : (
              <>
                <div className="text-2xl font-bold">{runs.length}</div>
                <p className="text-xs text-muted-foreground">for {selectedTask}</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Best Score</CardTitle>
          </CardHeader>
          <CardContent>
            {runsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold text-green-500">
                  {runs.length > 0
                    ? `${(Math.max(...runs.map(r => r.bestScore)) * 100).toFixed(0)}%`
                    : '—'}
                </div>
                <p className="text-xs text-muted-foreground">across all strategies</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-amber-500" />
              vs. Paper SOTA
            </CardTitle>
          </CardHeader>
          <CardContent>
            {runsLoading ? <Skeleton className="h-8 w-16" /> : (
              (() => {
                const best = runs.length > 0 ? Math.max(...runs.map(r => r.bestScore)) : null
                const pb = activeTask?.paperBaseline
                if (best == null || pb == null) return (
                  <div className="text-2xl font-bold text-muted-foreground">—</div>
                )
                const gap = best - pb / 4.0
                return (
                  <>
                    <div className={`text-2xl font-bold tabular-nums ${gap >= 0 ? 'text-green-500' : 'text-amber-500'}`}>
                      {gap >= 0 ? '+' : ''}{(gap * 100).toFixed(1)}%
                    </div>
                    <p className="text-xs text-muted-foreground">normalised gap</p>
                  </>
                )
              })()
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            {runsLoading ? <Skeleton className="h-8 w-12" /> : (
              <>
                <div className="text-2xl font-bold">
                  {runs.filter(r => r.status === 'running' || r.status === 'pending').length}
                </div>
                <p className="text-xs text-muted-foreground">running / pending</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Score History Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Score Convergence</CardTitle>
          <CardDescription>
            Best-score-per-round across strategies
            {activeTask?.paperBaseline != null && ` — dashed line = paper SOTA (${activeTask.paperBaseline})`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartRuns.length > 0 ? (
            <ScoreHistoryChart runs={chartRuns} paperBaseline={activeTask?.paperBaseline} />
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              No runs yet — select a task and click Run.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ablation Report */}
      {ablationReport ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-400" />
              Ablation Report
            </CardTitle>
            <CardDescription>
              Strategy comparison — generated {new Date(ablationReport.generatedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Recommendation */}
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-4 py-3 text-sm">
              {ablationReport.recommendation}
            </div>

            {/* Strategy table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 font-medium">Rank</th>
                    <th className="text-left py-2 font-medium">Strategy</th>
                    <th className="text-right py-2 font-medium">Best Score</th>
                    <th className="text-right py-2 font-medium">Converge Round</th>
                    <th className="text-right py-2 font-medium">Efficiency</th>
                    <th className="text-right py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ablationReport.strategies.map((s) => (
                    <tr key={s.strategy} className="border-b last:border-0">
                      <td className="py-2">
                        {s.rank === 1
                          ? <Trophy className="h-4 w-4 text-amber-500" />
                          : <span className="text-muted-foreground">#{s.rank}</span>}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: STRATEGY_COLORS[s.strategy] ?? '#6366f1' }}
                          />
                          <span className="font-mono">{s.strategy}</span>
                          {s.strategy === ablationReport.winner && (
                            <Badge className="text-xs" variant="default">winner</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono">
                        {(s.run.bestScore * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 text-right text-muted-foreground">
                        {s.convergenceRound > 0 ? `round ${s.convergenceRound}` : '—'}
                      </td>
                      <td className="py-2 text-right text-muted-foreground font-mono">
                        {s.efficiencyScore.toFixed(1)}
                      </td>
                      <td className="py-2 text-right">
                        <Badge variant={STATUS_VARIANT[s.run.status] ?? 'secondary'} className="text-xs">
                          {s.run.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ablationReport.paperBaseline != null && (
              <div className="text-xs text-muted-foreground">
                Paper SOTA: {ablationReport.paperBaseline} →
                normalised {(ablationReport.paperBaseline / 4.0 * 100).toFixed(1)}%.
                Best achieved: {(ablationReport.bestAchieved * 100).toFixed(1)}%.
                Gap: {(ablationReport.gapToPaper * 100).toFixed(1)} points.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Run History */}
      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
          <CardDescription>All runs for {selectedTask} — newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : runs.length > 0 ? (
            <div className="space-y-2">
              {runs.map(r => (
                <div key={r.runId} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: STRATEGY_COLORS[r.strategy] ?? '#6366f1' }}
                      />
                      <span className="font-mono text-xs text-muted-foreground truncate">{r.runId}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'} className="text-xs">
                        {r.status}
                      </Badge>
                      <span className="font-mono text-sm font-bold text-green-500">
                        {(r.bestScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>strategy: <span className="font-mono">{r.strategy}</span></span>
                    <span>rounds: {r.totalRounds}/{r.maxRounds}</span>
                    <span>best @round {r.bestRound}</span>
                    {r.error && <span className="text-red-400 truncate max-w-xs">{r.error}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-6">
              No runs yet for {selectedTask}. Click Run or Ablation to start.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/benchmark')({
  component: BenchmarkPage,
})
