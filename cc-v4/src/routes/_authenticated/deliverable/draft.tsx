import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { FileText, LayoutTemplate, Sparkles, Wand2 } from 'lucide-react'
import type { AgentResponse } from '@widgetdc/contracts/agent'
import { apiGet } from '@/lib/api-client'
import { dispatch, type ParsedAgentResponse } from '@/lib/agent-client'
import { buildCanvasPayload, buildVisualizationProperties } from '@/lib/visualization-contract'
import { CitationList } from '@/components/shared/CitationList'
import { EngagementScopeBanner } from '@/components/shared/EngagementScopeBanner'
import { JobProgress } from '@/components/shared/JobProgress'
import { AgentResponseCard } from '@/components/shared/AgentResponseCard'
import { SendCanvasToObsidianButton } from '@/components/shared/SendCanvasToObsidianButton'
import { SendToObsidianButton } from '@/components/shared/SendToObsidianButton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useJobStore } from '@/stores/jobs'
import { useSessionStore } from '@/stores/session'

type DeliverableType = 'analysis' | 'roadmap' | 'assessment'

type DeliverableDraftParsed = {
  id: string
  title: string
  type: DeliverableType
  format: 'pdf' | 'markdown'
  status: string
  sections_count: number
  total_citations: number
  generation_ms: number
  preview: string
  url: string
  markdown_url: string
}

type DeliverableRecord = {
  $id: string
  title: string
  type: DeliverableType
  status: string
  markdown: string
  sections: Array<{
    title: string
    markdown: string
    confidence: 'high' | 'medium' | 'low'
    citations: Array<{ title: string }>
  }>
  metadata: {
    total_citations: number
    sections_count: number
    generation_ms: number
    avg_confidence: number
  }
}

const DELIVERABLE_BRIEFS: Record<'analysis' | 'roadmap' | 'assessment', { client: string; title: string; prompt: string }> = {
  analysis: {
    client: 'NordicFin',
    title: 'AI Act readiness brief',
    prompt:
      'Create a client-ready executive analysis for NordicFin on EU AI Act readiness across underwriting, fraud detection, and customer support AI. Include current-state gaps, regulatory exposure, top remediation priorities, and a pragmatic 90-day action plan. Keep it board-readable and cite supporting evidence.',
  },
  roadmap: {
    client: 'CareFlow',
    title: 'Transformation roadmap',
    prompt:
      'Draft a consulting roadmap for CareFlow to operationalize AI governance across triage, clinical summarization, and patient service workflows. Structure it as a phased roadmap with workstreams, milestones, dependencies, and immediate actions for the next 12 weeks.',
  },
  assessment: {
    client: 'MercuryOps',
    title: 'Capability assessment',
    prompt:
      'Produce an assessment of MercuryOps current AI operating model, covering decision rights, tooling, observability, risk controls, and delivery maturity. Conclude with capability strengths, major risks, and the three highest-leverage investments.',
  },
}

function parseInlineCitations(markdown: string): string[] {
  const matches = [...markdown.matchAll(/\[\d+\]\s+([^\|\n]+)/g)]
  const titles = matches.map((match) => match[1].trim()).filter(Boolean)
  return Array.from(new Set(titles))
}

function readAverageConfidence(record: DeliverableRecord | null): string {
  if (!record) return 'N/A'
  const value = record.metadata?.avg_confidence
  if (typeof value !== 'number' || Number.isNaN(value)) return 'N/A'
  return `${Math.round(value * 100)}%`
}

function DeliverableMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function DeliverableDraftPage() {
  const [clientName, setClientName] = useState(DELIVERABLE_BRIEFS.analysis.client)
  const [type, setType] = useState<DeliverableType>('analysis')
  const [prompt, setPrompt] = useState(DELIVERABLE_BRIEFS.analysis.prompt)
  const [response, setResponse] = useState<ParsedAgentResponse<DeliverableDraftParsed> | null>(null)
  const [deliverable, setDeliverable] = useState<DeliverableRecord | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const upsertJob = useJobStore((state) => state.upsertJob)
  const removeJob = useJobStore((state) => state.removeJob)
  const jobs = useJobStore((state) => state.jobs)
  const activeJob = useMemo(() => jobs.find((job) => job.id === 'deliverable-draft'), [jobs])
  const setActiveClient = useSessionStore((state) => state.setActiveClient)
  const engagementId = useSessionStore((state) => state.engagementId)

  const parsed = response?.parsed as DeliverableDraftParsed | undefined
  const citationTitles = useMemo(() => {
    if (deliverable) {
      return Array.from(
        new Set(deliverable.sections.flatMap((section) => section.citations.map((citation) => citation.title.trim()).filter(Boolean)))
      )
    }
    return parseInlineCitations(markdown)
  }, [deliverable, markdown])
  const canvasPayload = useMemo(() => {
    if (!markdown) return null
    return buildCanvasPayload(
      { kind: 'deliverable_draft', deliverableType: type },
      {
        title: deliverable?.title ?? `${clientName || 'Client'} ${type} draft`,
        markdown,
        client: clientName || 'Unknown',
        sourceTool: 'deliverable_draft',
        status: deliverable?.status ?? response?.status ?? 'unknown',
        citationsCount: deliverable?.metadata.total_citations ?? parsed?.total_citations ?? 0,
      }
    )
  }, [clientName, deliverable?.metadata.total_citations, deliverable?.status, deliverable?.title, markdown, parsed?.total_citations, response?.status, type])

  useEffect(() => {
    let cancelled = false

    async function hydrateMarkdown() {
      if (!parsed?.markdown_url || response?.status !== 'success') return

      try {
        const [rawMarkdown, recordResponse] = await Promise.all([
          apiGet<string>(parsed.markdown_url, { responseType: 'text' }),
          apiGet<{ success: boolean; data: DeliverableRecord }>(parsed.url),
        ])

        if (cancelled) return
        setMarkdown(rawMarkdown)
        setDeliverable(recordResponse.data)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    void hydrateMarkdown()

    return () => {
      cancelled = true
    }
  }, [parsed?.markdown_url, parsed?.url, response?.status])

  const applyPreset = (nextType: DeliverableType) => {
    const preset = DELIVERABLE_BRIEFS[nextType]
    setType(nextType)
    setClientName(preset.client)
    setPrompt(preset.prompt)
    setError(null)
  }

  const handleRun = async () => {
    setError(null)
    setResponse(null)
    setDeliverable(null)
    setMarkdown('')

    if (!prompt.trim() || prompt.trim().length < 10) {
      setError('Prompt must be at least 10 characters before generating a deliverable.')
      return
    }

    setActiveClient(clientName || 'Unnamed client')
    setIsSubmitting(true)
    const startedAt = new Date().toISOString()

    upsertJob({
      id: 'deliverable-draft',
      title: 'Consulting deliverable draft',
      status: 'running',
      progress: 10,
      detail: 'Framing brief and selecting deliverable pattern',
      startedAt,
    })

    try {
      upsertJob({
        id: 'deliverable-draft',
        title: 'Consulting deliverable draft',
        status: 'running',
        progress: 45,
        detail: 'Running deliverable_draft through the Lego Factory pipeline',
        startedAt,
      })

      const nextResponse = await dispatch<DeliverableDraftParsed>({
        agent_id: 'cc-v4',
        task: `Generate ${type} deliverable for ${clientName || 'client brief'}`,
        capabilities: ['document-generation', 'consulting'],
        context: {
          tool_name: 'deliverable_draft',
          tool_args: {
            prompt: prompt.trim(),
            type,
            format: 'markdown',
            max_sections: 6,
            include_citations: true,
            engagement_id: engagementId ?? undefined,
          },
        },
        priority: 'high',
      })

      setResponse(nextResponse)
      upsertJob({
        id: 'deliverable-draft',
        title: 'Consulting deliverable draft',
        status: nextResponse.status === 'success' ? 'completed' : 'failed',
        progress: 100,
        detail: nextResponse.status === 'success' ? 'Draft ready for review' : 'Deliverable generation returned an error',
        startedAt,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      upsertJob({
        id: 'deliverable-draft',
        title: 'Consulting deliverable draft',
        status: 'failed',
        progress: 100,
        detail: message,
        startedAt,
      })
    } finally {
      setIsSubmitting(false)
      window.setTimeout(() => removeJob('deliverable-draft'), 3000)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <EngagementScopeBanner
        current="/deliverable/draft"
        description="Deliverable Studio is running inside the active engagement scope. Use it to turn the current mission into a client-facing artifact without losing context."
      />

      <section className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
        <Card className="border-border/80">
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
              <Sparkles className="h-4 w-4" />
              V4 Proof Flow
            </div>
            <CardTitle className="text-3xl">Deliverable Draft Factory</CardTitle>
            <CardDescription className="max-w-2xl">
              Turn a client brief into a structured consulting deliverable with sections, citations, and a downloadable markdown artifact.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pipeline shape</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Plan → Retrieve → Write → Assemble → Render. The frontend’s job is to make that visible and trustworthy.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Best demo move</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use NordicFin first. It gives the clearest executive narrative and the most legible output for a client-style walkthrough.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => applyPreset('analysis')}>
                NordicFin analysis
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset('roadmap')}>
                CareFlow roadmap
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset('assessment')}>
                MercuryOps assessment
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-lg">What a strong brief contains</CardTitle>
            <CardDescription>Clear scope, target audience, desired shape, and explicit evidence expectations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">executive audience</Badge>
              <Badge variant="outline">problem framing</Badge>
              <Badge variant="outline">90-day actions</Badge>
              <Badge variant="outline">citations required</Badge>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              The best prompts are client-specific, outcome-oriented, and opinionated about structure. Generic prompts generate generic deliverables.
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Brief builder</CardTitle>
            <CardDescription>Compose the prompt sent to `deliverable_draft` and choose the deliverable shape.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deliverable-client">Client name</Label>
              <Input
                id="deliverable-client"
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder="NordicFin"
              />
            </div>

            <div className="space-y-2">
              <Label>Deliverable type</Label>
              <Tabs value={type} onValueChange={(value) => setType(value as DeliverableType)}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="analysis">Analysis</TabsTrigger>
                  <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
                  <TabsTrigger value="assessment">Assessment</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deliverable-prompt">Prompt</Label>
              <Textarea
                id="deliverable-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-[300px]"
                placeholder="Describe the deliverable the client should receive..."
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Deliverable generation failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleRun} disabled={isSubmitting}>
                <Wand2 className="mr-2 h-4 w-4" />
                {isSubmitting ? 'Generating draft...' : 'Generate draft'}
              </Button>
              <Button variant="ghost" onClick={() => applyPreset(type)} disabled={isSubmitting}>
                Reset to preset
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Execution and output</CardTitle>
              <CardDescription>Show the pipeline state first, then the artifact and supporting evidence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeJob ? (
                <JobProgress job={activeJob} />
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Start a generation to track the deliverable pipeline here.
                </div>
              )}

              {parsed && (
                <div className="grid gap-3 md:grid-cols-4">
                  <DeliverableMetric label="Sections" value={parsed.sections_count} />
                  <DeliverableMetric label="Citations" value={parsed.total_citations} />
                  <DeliverableMetric label="Duration" value={`${(parsed.generation_ms / 1000).toFixed(1)}s`} />
                  <DeliverableMetric label="Confidence" value={readAverageConfidence(deliverable)} />
                </div>
              )}
            </CardContent>
          </Card>

          {citationTitles.length > 0 && (
            <CitationList citations={citationTitles} title="Evidence surfaced in the draft" />
          )}

          {markdown && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Vault handoff</CardTitle>
                <CardDescription>Publish this draft into Obsidian as a reusable consulting artifact.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  <SendToObsidianButton
                    title={deliverable?.title ?? `${clientName || 'Client'} ${type} draft`}
                    kind="deliverable_draft"
                    folder="WidgeTDC/Deliverables"
                    contentMarkdown={markdown}
                    properties={buildVisualizationProperties({ kind: 'deliverable_draft', deliverableType: type }, {
                      engagement_id: engagementId ?? null,
                      client: clientName || 'Unknown',
                      source_tool: 'deliverable_draft',
                      source_deliverable_id: deliverable?.$id ?? parsed?.id ?? null,
                      status: deliverable?.status ?? response?.status ?? 'unknown',
                      citations_count: deliverable?.metadata.total_citations ?? parsed?.total_citations ?? 0,
                    })}
                  />
                  {canvasPayload && (
                    <SendCanvasToObsidianButton
                      payload={{
                        ...canvasPayload,
                        properties: {
                          ...canvasPayload.properties,
                          engagement_id: engagementId ?? '',
                          source_deliverable_id: deliverable?.$id ?? parsed?.id ?? '',
                        },
                      }}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {markdown && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <LayoutTemplate className="h-4 w-4" />
              Generated artifact
            </div>
            <CardTitle className="text-xl">{deliverable?.title ?? parsed?.title ?? 'Deliverable preview'}</CardTitle>
            <CardDescription>
              Review the markdown artifact directly. This is the surface a client-ready export should preserve.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="preview">
              <TabsList>
                <TabsTrigger value="preview">Markdown preview</TabsTrigger>
                <TabsTrigger value="raw">Raw response</TabsTrigger>
              </TabsList>
              <TabsContent value="preview">
                <div className="rounded-lg border bg-muted/20 p-5">
                  <pre className="overflow-auto whitespace-pre-wrap text-sm leading-7">{markdown}</pre>
                </div>
              </TabsContent>
              <TabsContent value="raw">
                {response && <AgentResponseCard response={response} title={`${clientName} deliverable response`} />}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {!markdown && response && (
        <AgentResponseCard response={response} title={`${clientName} deliverable response`} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Why this route matters</CardTitle>
          <CardDescription>V4 is the strongest “show, don’t tell” frontend proof after compliance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Brief discipline
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Strong prompts produce stronger deliverables. This route should teach operators how to frame the brief, not hide it.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              Trust through process
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Users need to see that the system is planning, retrieving evidence, and assembling an artifact, not just hallucinating markdown.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
              Client-readiness
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The route is successful when the draft looks like the beginning of a deliverable, not a debug payload.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/deliverable/draft')({
  component: DeliverableDraftPage,
})
