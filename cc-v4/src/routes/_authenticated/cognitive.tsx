import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Brain, Zap, BookOpen, Layers, RefreshCw } from 'lucide-react'

interface Feature {
  id: number
  name: string
  source: string
  status: string
  description: string
}

interface FeaturesResponse {
  success: boolean
  data: { features: Feature[] }
}

interface RlmStatusResponse {
  success: boolean
  data: { available: boolean; reason?: string; url?: string }
}

const ACTIONS = [
  { value: 'reason', label: 'reason', desc: 'Multi-step PDR recursive reasoning' },
  { value: 'analyze', label: 'analyze', desc: 'Domain analysis with graph enrichment' },
  { value: 'plan', label: 'plan', desc: 'Strategic planning + task decomposition' },
  { value: 'fold', label: 'fold', desc: 'Context compression for token efficiency' },
  { value: 'learn', label: 'learn', desc: 'Extract lessons + enrich knowledge graph' },
] as const

type Action = typeof ACTIONS[number]['value']

interface ConsoleResult {
  action: Action
  prompt: string
  response: string
  durationMs: number
  ts: string
}

function CognitivePage() {
  const { data: features, isLoading } = useQuery<FeaturesResponse>({
    queryKey: ['cognitive-features'],
    queryFn: () => apiGet('/monitor/features'),
    refetchInterval: 60000,
  })

  const { data: rlmStatus } = useQuery<RlmStatusResponse>({
    queryKey: ['rlm-status'],
    queryFn: () => apiGet('/api/cognitive/status'),
    refetchInterval: 30000,
  })

  const [action, setAction] = useState<Action>('reason')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<ConsoleResult[]>([])
  const [currentResult, setCurrentResult] = useState<ConsoleResult | null>(null)

  const featureList = features?.data?.features ?? []
  const rlm = rlmStatus?.data

  async function runCognitive() {
    if (!prompt.trim() || running) return
    setRunning(true)
    setCurrentResult(null)
    const t0 = Date.now()
    try {
      const resp = await apiPost<any>('/api/cognitive', { action, prompt, stream: false })
      const content = resp?.result ?? resp?.output ?? resp?.content ?? resp?.response ?? JSON.stringify(resp, null, 2)
      const result: ConsoleResult = {
        action,
        prompt: prompt.slice(0, 200),
        response: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        durationMs: Date.now() - t0,
        ts: new Date().toISOString(),
      }
      setCurrentResult(result)
      setHistory(h => [result, ...h].slice(0, 10))
    } catch (err: any) {
      const errResult: ConsoleResult = {
        action,
        prompt: prompt.slice(0, 200),
        response: `Error: ${err?.response?.data?.error?.message ?? err?.response?.data?.error ?? err?.message ?? String(err)}`,
        durationMs: Date.now() - t0,
        ts: new Date().toISOString(),
      }
      setCurrentResult(errResult)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cognitive Proxy</h1>
          <p className="text-muted-foreground mt-1">RLM Engine — deep reasoning, context folding, research features</p>
        </div>
        <Badge variant={rlm?.available ? 'default' : 'secondary'} className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5" />
          {rlm?.available ? 'RLM online' : (rlm?.reason ?? 'Checking…')}
        </Badge>
      </div>

      {/* Test Console */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            RLM Test Console
          </CardTitle>
          <CardDescription>Run cognitive operations against the RLM Engine directly</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 items-center">
            <Select value={action} onValueChange={v => setAction(v as Action)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map(a => (
                  <SelectItem key={a.value} value={a.value}>
                    <span className="font-mono">{a.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {ACTIONS.find(a => a.value === action)?.desc}
            </span>
          </div>

          <Textarea
            placeholder="Enter your prompt or query…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={4}
            className="font-mono text-sm resize-none"
          />

          <div className="flex items-center justify-between">
            <Button onClick={runCognitive} disabled={running || !prompt.trim()}
              className="flex items-center gap-2">
              {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              {running ? 'Running…' : 'Run'}
            </Button>
            {rlm && !rlm.available && (
              <span className="text-xs text-amber-600">RLM Engine unavailable · {rlm.reason}</span>
            )}
          </div>

          {/* Current result */}
          {currentResult && (
            <div className="border rounded-lg p-4 bg-muted/40">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">{currentResult.action}</Badge>
                  <span className="text-xs text-muted-foreground">{currentResult.durationMs}ms</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(currentResult.ts).toLocaleTimeString()}
                </span>
              </div>
              <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto">
                {currentResult.response}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Query History
            </CardTitle>
            <CardDescription>Last {history.length} runs this session</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((h, i) => (
                <button key={i} onClick={() => setCurrentResult(h)}
                  className="w-full text-left border rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="font-mono text-[10px]">{h.action}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(h.ts).toLocaleTimeString()} · {h.durationMs}ms</span>
                  </div>
                  <p className="text-sm truncate text-muted-foreground">{h.prompt}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Features grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Intelligence Features
          </CardTitle>
          <CardDescription>{featureList.length} research features tracked</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : featureList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {featureList.map((f) => (
                <div key={f.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{f.name}</span>
                    <Badge
                      variant={f.status === 'active' ? 'default' : f.status === 'available' ? 'secondary' : 'outline'}
                      className="text-[10px]">
                      {f.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                  <span className="text-[10px] text-muted-foreground">source: {f.source}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No features data available.</p>
          )}
        </CardContent>
      </Card>

      {/* Capabilities reference */}
      <Card>
        <CardHeader>
          <CardTitle>A2A Skills</CardTitle>
          <CardDescription>21 RLM Engine skills available via agent-to-agent protocol</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              { name: 'cognitive-reasoning', desc: 'Multi-step recursive reasoning with PDR' },
              { name: 'domain-analysis', desc: 'Architecture + consulting analysis + graph enrichment' },
              { name: 'knowledge-query', desc: 'Semantic search + graph-RAG over Neo4j' },
              { name: 'context-folding', desc: 'Compress large contexts for token efficiency' },
              { name: 'adaptive-agent-selection', desc: 'Auto-select best agent for task type' },
              { name: 'research-curation', desc: 'Paper discovery + scoring + graph injection' },
              { name: 'knowledge-gap-analysis', desc: 'Detect coverage gaps, produce remediation' },
              { name: 'sona-optimization', desc: 'Self-optimizing: observe-identify-propose-apply-verify' },
            ].map((cap) => (
              <div key={cap.name} className="border rounded px-3 py-2">
                <span className="font-mono text-sm font-medium block">{cap.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{cap.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/cognitive')({
  component: CognitivePage,
})
