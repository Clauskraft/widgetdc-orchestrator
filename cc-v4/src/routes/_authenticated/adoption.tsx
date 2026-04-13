import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

interface AdoptionMetrics {
  total_tools: number
  tools_called_at_least_once: number
  adoption_rate_percent: number
  top_tools: Array<{ name: string; calls: number }>
  bottom_tools: Array<{ name: string; calls: number }>
  namespaces: Array<{ namespace: string; tools: number; calls: number }>
  generated_at: string
}

interface TelemetryData {
  success: boolean
  data: {
    total_calls: number
    unique_tools: number
    unique_agents: number
    top_tools: Array<{ tool: string; count: number }>
    top_agents: Array<{ agent: string; count: number }>
    period: string
  }
}

interface LoopPattern {
  pattern: string
  weight: number
  evidenceFactors: string[]
}

interface PhantomRecommendation {
  intent: string
  repo_or_domain: string
  confidence: number
  recommended_loop: {
    id: string
    name: string
    description: string
    skills: string[]
  }
  recommended_pattern: string
  recommended_patterns: LoopPattern[]
  phantom_evidence: {
    componentCount: number
    externalSourceCount: number
    canonicalNodeCount: number
    knownCapabilityMatches: number
    unknownRelationCount: number
    avgConfidence: number
    hasRuntimeSurface: boolean
    coverageScore: number
  }
  reuse_suggestions: string[]
  warnings: string[]
  selection_reasons: string[]
}

interface PhantomRecommendationResponse {
  success: boolean
  data: PhantomRecommendation
}

const RECOMMENDATION_PRESETS = [
  {
    label: 'Frontend hardening',
    intent: 'Improve the cc-v4 frontend adoption surface and ship against existing platform patterns',
    repo_or_domain: 'widgetdc-orchestrator',
  },
  {
    label: 'New repo discovery',
    intent: 'Harvest a new external repo and convert its strongest patterns into reusable platform capabilities',
    repo_or_domain: 'new-repo',
  },
  {
    label: 'Tool adoption',
    intent: 'Improve tool adoption, ranking quality, and discovery signals for Mission Control skills',
    repo_or_domain: 'mission-control',
  },
]

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function MetricCard({ label, value, tone }: { label: string; value: string | number; tone: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-border bg-card text-foreground'

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function AdoptionPage() {
  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useQuery<AdoptionMetrics>({
    queryKey: ['adoption-metrics'],
    queryFn: () => apiGet('/api/adoption/metrics'),
    refetchInterval: 30000,
  })

  const { data: telemetry } = useQuery<TelemetryData>({
    queryKey: ['adoption-telemetry'],
    queryFn: () => apiGet('/api/adoption/telemetry'),
    refetchInterval: 30000,
  })

  const [intent, setIntent] = useState(RECOMMENDATION_PRESETS[0].intent)
  const [repoOrDomain, setRepoOrDomain] = useState(RECOMMENDATION_PRESETS[0].repo_or_domain)
  const [recommendation, setRecommendation] = useState<PhantomRecommendation | null>(null)
  const [recommendationError, setRecommendationError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (metricsError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load adoption data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const tel = telemetry?.data

  const handleRunRecommendation = async () => {
    setRecommendationError(null)
    setIsSubmitting(true)

    try {
      const response = await apiPost<PhantomRecommendationResponse>('/api/adoption/skills/recommend', {
        intent,
        repo_or_domain: repoOrDomain,
      })
      setRecommendation(response.data)
    } catch (error) {
      setRecommendation(null)
      setRecommendationError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const applyPreset = (preset: typeof RECOMMENDATION_PRESETS[number]) => {
    setIntent(preset.intent)
    setRepoOrDomain(preset.repo_or_domain)
    setRecommendation(null)
    setRecommendationError(null)
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Adoption</h1>
        <p className="mt-1 text-muted-foreground">Tool adoption metrics, telemetry, and Phantom-guided operator routing</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {metricsLoading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics?.total_tools ?? 0}</div>
                <p className="text-xs text-muted-foreground">MCP tools registered</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Adoption Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metrics?.adoption_rate_percent ?? 0}%</div>
                <p className="text-xs text-muted-foreground">
                  {metrics?.tools_called_at_least_once ?? 0} tools used at least once
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tel?.total_calls?.toLocaleString() ?? '—'}</div>
                <p className="text-xs text-muted-foreground">{tel?.unique_agents ?? 0} unique agents</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Active Tools</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tel?.unique_tools ?? '—'}</div>
                <p className="text-xs text-muted-foreground">In current period</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phantom Skill Loop Recommender</CardTitle>
          <CardDescription>
            Choose the next autonomous improvement loop from Phantom BOM evidence instead of generic workflow guesswork.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {RECOMMENDATION_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="repo-domain">Repo or domain</Label>
              <Input
                id="repo-domain"
                value={repoOrDomain}
                onChange={(event) => setRepoOrDomain(event.target.value)}
                placeholder="widgetdc-orchestrator"
              />
            </div>
            <div className="flex items-end">
              <Button className="w-full md:w-auto" onClick={handleRunRecommendation} disabled={isSubmitting}>
                {isSubmitting ? 'Routing…' : 'Recommend loop'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="loop-intent">Intent</Label>
            <Textarea
              id="loop-intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              className="min-h-[120px]"
              placeholder="Describe the task or outcome you want the platform to route."
            />
          </div>

          {recommendationError && (
            <Alert variant="destructive">
              <AlertDescription>{recommendationError}</AlertDescription>
            </Alert>
          )}

          {recommendation && (
            <div className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">{recommendation.recommended_loop.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{recommendation.recommended_loop.description}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{percent(recommendation.confidence)} confidence</Badge>
                  <Badge variant="secondary">{recommendation.recommended_pattern}</Badge>
                  {recommendation.phantom_evidence.hasRuntimeSurface && (
                    <Badge variant="secondary">runtime surface known</Badge>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="Coverage" value={percent(recommendation.phantom_evidence.coverageScore)} tone="default" />
                <MetricCard label="Confidence" value={percent(recommendation.phantom_evidence.avgConfidence)} tone="default" />
                <MetricCard
                  label="Capability matches"
                  value={recommendation.phantom_evidence.knownCapabilityMatches}
                  tone={recommendation.phantom_evidence.knownCapabilityMatches > 0 ? 'success' : 'default'}
                />
                <MetricCard
                  label="Unknown relations"
                  value={recommendation.phantom_evidence.unknownRelationCount}
                  tone={recommendation.phantom_evidence.unknownRelationCount > 5 ? 'warning' : 'default'}
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recommended skills</p>
                <div className="flex flex-wrap gap-2">
                  {recommendation.recommended_loop.skills.map((skill) => (
                    <Badge key={skill} variant="outline">{skill}</Badge>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Selection reasons</p>
                  <div className="space-y-2">
                    {recommendation.selection_reasons.map((reason, index) => (
                      <div key={`${reason}-${index}`} className="rounded-lg border border-border/60 bg-background/60 p-3 text-sm">
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Reuse suggestions</p>
                  <div className="space-y-2">
                    {recommendation.reuse_suggestions.length > 0 ? recommendation.reuse_suggestions.map((suggestion, index) => (
                      <div key={`${suggestion}-${index}`} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {suggestion}
                      </div>
                    )) : (
                      <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-sm text-muted-foreground">
                        No explicit reuse candidates surfaced for this intent.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {recommendation.warnings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Warnings</p>
                  <div className="space-y-2">
                    {recommendation.warnings.map((warning, index) => (
                      <div key={`${warning}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {warning}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pattern ranking</p>
                <div className="space-y-2">
                  {recommendation.recommended_patterns.slice(0, 4).map((pattern) => (
                    <div key={pattern.pattern} className="rounded-lg border border-border/60 bg-background/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{pattern.pattern}</span>
                        <Badge variant="secondary">{percent(pattern.weight)}</Badge>
                      </div>
                      {pattern.evidenceFactors.length > 0 && (
                        <p className="mt-2 text-sm text-muted-foreground">{pattern.evidenceFactors.join(' · ')}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Tools by Usage</CardTitle>
          <CardDescription>Most frequently called MCP tools</CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const topData = (metrics?.top_tools?.map((t) => ({ name: t.name, calls: t.calls }))
              ?? tel?.top_tools?.map((t) => ({ name: t.tool, calls: t.count }))
              ?? []).slice(0, 10)
            return topData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={topData} layout="vertical" margin={{ top: 4, right: 40, left: 100, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={95} />
                  <Tooltip />
                  <Bar dataKey="calls" radius={[0, 4, 4, 0]}>
                    {topData.map((_, i) => (
                      <Cell key={i} fill={i < 3 ? '#6366f1' : i < 6 ? '#818cf8' : '#a5b4fc'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">No usage data yet.</div>
            )
          })()}
        </CardContent>
      </Card>

      {metrics?.namespaces && metrics.namespaces.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Calls by Namespace</CardTitle>
              <CardDescription>Tool invocations per MCP namespace</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={metrics.namespaces.map((ns) => ({ name: ns.namespace, calls: ns.calls }))}
                  layout="vertical"
                  margin={{ top: 4, right: 40, left: 70, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={65} />
                  <Tooltip />
                  <Bar dataKey="calls" fill="#22c55e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tools per Namespace</CardTitle>
              <CardDescription>Coverage — how many tools per namespace</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={metrics.namespaces.map((ns) => ({ name: ns.namespace, tools: ns.tools }))}
                  layout="vertical"
                  margin={{ top: 4, right: 40, left: 70, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={65} />
                  <Tooltip />
                  <Bar dataKey="tools" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {metrics?.bottom_tools && metrics.bottom_tools.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Least Used Tools</CardTitle>
            <CardDescription>Candidates for review or deprecation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.bottom_tools.map((tool, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="font-mono text-sm">{tool.name}</span>
                  <Badge variant="secondary">{tool.calls} calls</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/adoption')({
  component: AdoptionPage,
})
