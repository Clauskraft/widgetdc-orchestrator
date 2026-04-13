import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AlertTriangle, FileJson, PlayCircle, ShieldCheck } from 'lucide-react'
import type { AgentResponse } from '@widgetdc/contracts/agent'
import { dispatch } from '@/lib/agent-client'
import { buildCanvasPayload, buildVisualizationProperties } from '@/lib/visualization-contract'
import { useJobStore } from '@/stores/jobs'
import { useSessionStore } from '@/stores/session'
import { AgentResponseCard } from '@/components/shared/AgentResponseCard'
import { JobProgress } from '@/components/shared/JobProgress'
import { SendCanvasToObsidianButton } from '@/components/shared/SendCanvasToObsidianButton'
import { SendToObsidianButton } from '@/components/shared/SendToObsidianButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

type StackItem = {
  name: string
  category: string
  provider?: string
  risk_level?: 'minimal' | 'limited' | 'high' | 'unacceptable'
  data_types?: string[]
  has_human_oversight?: boolean
  has_risk_assessment?: boolean
  has_transparency_notice?: boolean
  has_data_governance?: boolean
  has_monitoring?: boolean
  has_documentation?: boolean
  logs_retention_days?: number
}

const SAMPLE_STACKS: Record<string, StackItem[]> = {
  fintech: [
    {
      name: 'Loan Eligibility Model',
      category: 'ml-model',
      provider: 'OpenAI',
      risk_level: 'high',
      data_types: ['financial', 'personal', 'behavioral'],
      has_human_oversight: false,
      has_risk_assessment: false,
      has_transparency_notice: true,
      has_data_governance: false,
      has_monitoring: true,
      has_documentation: false,
      logs_retention_days: 30,
    },
    {
      name: 'Applicant Data Pipeline',
      category: 'data-pipeline',
      provider: 'Azure',
      risk_level: 'high',
      data_types: ['financial', 'personal'],
      has_human_oversight: true,
      has_risk_assessment: false,
      has_transparency_notice: false,
      has_data_governance: false,
      has_monitoring: true,
      has_documentation: false,
      logs_retention_days: 14,
    },
  ],
  health: [
    {
      name: 'Triage Recommendation Engine',
      category: 'ml-model',
      provider: 'Anthropic',
      risk_level: 'high',
      data_types: ['health', 'personal', 'biometric'],
      has_human_oversight: true,
      has_risk_assessment: true,
      has_transparency_notice: false,
      has_data_governance: false,
      has_monitoring: true,
      has_documentation: false,
      logs_retention_days: 45,
    },
    {
      name: 'Clinical Monitoring Dashboard',
      category: 'monitoring',
      provider: 'Datadog',
      risk_level: 'limited',
      data_types: ['health'],
      has_human_oversight: true,
      has_risk_assessment: true,
      has_transparency_notice: true,
      has_data_governance: true,
      has_monitoring: true,
      has_documentation: true,
      logs_retention_days: 120,
    },
  ],
}

function formatStack(stack: StackItem[]): string {
  return JSON.stringify(stack, null, 2)
}

function readMetric(output: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = output.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`))
  return match?.[1]?.trim() ?? null
}

function readSeverity(output: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = output.match(new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*(\\d+)\\s*\\|`))
  return match ? Number(match[1]) : null
}

function AuditSummary({ response }: { response: AgentResponse }) {
  const score = readMetric(response.output, 'Compliance Score')
  const components = readMetric(response.output, 'Components Audited')
  const critical = readSeverity(response.output, '🔴 Critical')
  const high = readSeverity(response.output, '🟠 High')

  return (
    <div className="grid gap-3 md:grid-cols-4">
      <MetricCard label="Compliance score" value={score ?? 'N/A'} tone="default" />
      <MetricCard label="Components" value={components ?? 'N/A'} tone="default" />
      <MetricCard label="Critical gaps" value={critical ?? '0'} tone={critical && critical > 0 ? 'danger' : 'success'} />
      <MetricCard label="High gaps" value={high ?? '0'} tone={high && high > 0 ? 'warning' : 'success'} />
    </div>
  )
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

function ComplianceAuditPage() {
  const [clientName, setClientName] = useState('NordicFin Demo')
  const [stackJson, setStackJson] = useState(formatStack(SAMPLE_STACKS.fintech))
  const [response, setResponse] = useState<AgentResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const setActiveClient = useSessionStore((state) => state.setActiveClient)
  const upsertJob = useJobStore((state) => state.upsertJob)
  const removeJob = useJobStore((state) => state.removeJob)
  const jobs = useJobStore((state) => state.jobs)
  const activeJob = useMemo(() => jobs.find((job) => job.id === 'compliance-audit'), [jobs])
  const canvasPayload = useMemo(() => {
    if (!response || response.status !== 'success') return null
    return buildCanvasPayload(
      { kind: 'compliance_audit' },
      {
        title: `${clientName || 'Client'} AI Act compliance audit`,
        markdown: response.output,
        client: clientName || 'Unknown',
        sourceTool: 'compliance_gap_audit',
        status: response.status,
      }
    )
  }, [clientName, response])

  const handlePreset = (preset: keyof typeof SAMPLE_STACKS, nextClient: string) => {
    setClientName(nextClient)
    setStackJson(formatStack(SAMPLE_STACKS[preset]))
    setError(null)
  }

  const handleRun = async () => {
    setError(null)
    setResponse(null)

    let stack: StackItem[]
    try {
      stack = JSON.parse(stackJson) as StackItem[]
      if (!Array.isArray(stack) || stack.length === 0) {
        setError('Stack JSON must be a non-empty array of components.')
        return
      }
    } catch {
      setError('Stack JSON is invalid. Fix the JSON before running the audit.')
      return
    }

    setIsSubmitting(true)
    setActiveClient(clientName || 'Unnamed client')
    upsertJob({
      id: 'compliance-audit',
      title: 'EU AI Act Annex III audit',
      status: 'running',
      progress: 15,
      detail: 'Validating client stack and preparing compliance checks',
      startedAt: new Date().toISOString(),
    })

    try {
      upsertJob({
        id: 'compliance-audit',
        title: 'EU AI Act Annex III audit',
        status: 'running',
        progress: 55,
        detail: 'Running compliance_gap_audit against the orchestrator tool surface',
        startedAt: new Date().toISOString(),
      })

      const nextResponse = await dispatch({
        agent_id: 'cc-v4',
        task: `Run EU AI Act compliance audit for ${clientName || 'client stack'}`,
        capabilities: ['compliance', 'audit'],
        context: {
          tool_name: 'compliance_gap_audit',
          tool_args: { stack },
        },
        priority: 'high',
      })

      setResponse(nextResponse)
      upsertJob({
        id: 'compliance-audit',
        title: 'EU AI Act Annex III audit',
        status: nextResponse.status === 'success' ? 'completed' : 'failed',
        progress: 100,
        detail: nextResponse.status === 'success' ? 'Audit report ready for review' : 'Audit returned an error response',
        startedAt: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      upsertJob({
        id: 'compliance-audit',
        title: 'EU AI Act Annex III audit',
        status: 'failed',
        progress: 100,
        detail: message,
        startedAt: new Date().toISOString(),
      })
    } finally {
      setIsSubmitting(false)
      window.setTimeout(() => removeJob('compliance-audit'), 2500)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
        <Card className="border-border/80">
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
              V1 Proof Flow
            </div>
            <CardTitle className="text-3xl">AI Act Compliance Audit</CardTitle>
            <CardDescription className="max-w-2xl">
              Upload a client stack as JSON and get an EU AI Act Annex III gap report with severity, affected articles, and remediation steps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">What this proves</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  WidgeTDC can turn a raw client stack into a consulting-grade risk view in one operator flow.
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Best demo setup</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Use the fintech preset to show critical gaps quickly, then switch to health to show a more mature posture.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => handlePreset('fintech', 'NordicFin Demo')}>
                Load fintech preset
              </Button>
              <Button variant="outline" size="sm" onClick={() => handlePreset('health', 'CareFlow Pilot')}>
                Load health preset
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-lg">Suggested input shape</CardTitle>
            <CardDescription>Each component should describe risk level, oversight, governance, monitoring, and logging.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">ml-model</Badge>
              <Badge variant="outline">data-pipeline</Badge>
              <Badge variant="outline">deployment</Badge>
              <Badge variant="outline">monitoring</Badge>
              <Badge variant="outline">governance</Badge>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              High-risk components without human oversight, data governance, transparency notices, or sufficient log retention surface the strongest remediation signal.
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Client stack input</CardTitle>
            <CardDescription>Paste or edit the JSON payload that will be sent to `compliance_gap_audit`.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client-name">Client name</Label>
              <Input
                id="client-name"
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                placeholder="NordicFin Demo"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stack-json">Stack JSON</Label>
              <Textarea
                id="stack-json"
                value={stackJson}
                onChange={(event) => setStackJson(event.target.value)}
                className="min-h-[420px] font-mono text-xs"
                spellCheck={false}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p>{error}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={handleRun} disabled={isSubmitting} className="min-w-40">
                <PlayCircle className="mr-2 h-4 w-4" />
                {isSubmitting ? 'Running audit...' : 'Run audit'}
              </Button>
              <Button variant="ghost" onClick={() => setStackJson(formatStack(SAMPLE_STACKS.fintech))} disabled={isSubmitting}>
                Reset JSON
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Execution</CardTitle>
              <CardDescription>Long-running proof flows need explicit progress and readable outputs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeJob ? (
                <JobProgress job={activeJob} />
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Start an audit to stream the operator-facing job state here.
                </div>
              )}

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileJson className="h-4 w-4 text-muted-foreground" />
                  Audit payload discipline
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Keep the stack as a clean array of components. This route deliberately stays contract-first and avoids ad-hoc upload formats.
                </p>
              </div>
            </CardContent>
          </Card>

          {response && response.status === 'success' && (
            <div className="space-y-4">
              <AuditSummary response={response} />
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Vault handoff</CardTitle>
                  <CardDescription>Materialize this audit into Obsidian as a structured engagement artifact.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    <SendToObsidianButton
                      title={`${clientName || 'Client'} AI Act compliance audit`}
                      kind="compliance_audit"
                      folder="WidgeTDC/Compliance Audits"
                      contentMarkdown={response.output}
                      properties={buildVisualizationProperties({ kind: 'compliance_audit' }, {
                        client: clientName || 'Unknown',
                        source_tool: 'compliance_gap_audit',
                        status: response.status,
                      })}
                    />
                    {canvasPayload && <SendCanvasToObsidianButton payload={canvasPayload} />}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {response && (
            <AgentResponseCard
              response={response}
              title={clientName ? `${clientName} compliance audit` : 'Compliance audit'}
            />
          )}
        </div>
      </section>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/compliance/audit')({
  component: ComplianceAuditPage,
})
