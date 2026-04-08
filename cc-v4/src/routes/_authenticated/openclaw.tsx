import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Terminal, RefreshCw, Zap, Clock } from 'lucide-react'

interface OpenClawStatus {
  success: boolean
  data: {
    healthy: boolean
    url: string | null
    models?: string[]
    latency_ms?: number
  }
}

interface QueryHistoryEntry {
  model: string
  system: string
  user: string
  response: string
  durationMs: number
  tokens?: number
  ts: string
  ok: boolean
}

const DEFAULT_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-3.5-turbo',
  'claude-3-5-sonnet-20241022',
  'deepseek-chat',
]

function OpenClawPage() {
  const { data, isLoading, error } = useQuery<OpenClawStatus>({
    queryKey: ['openclaw-status'],
    queryFn: () => apiGet('/api/openclaw/status'),
    refetchInterval: 30000,
  })

  const d = data?.data
  const models = d?.models?.length ? d.models : DEFAULT_MODELS

  const [model, setModel] = useState('')
  const [system, setSystem] = useState('You are a helpful assistant.')
  const [userMsg, setUserMsg] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<QueryHistoryEntry[]>([])
  const [currentEntry, setCurrentEntry] = useState<QueryHistoryEntry | null>(null)

  const selectedModel = model || models[0] || 'gpt-4o'

  async function runQuery() {
    if (!userMsg.trim() || running) return
    setRunning(true)
    setCurrentEntry(null)
    const t0 = Date.now()
    try {
      const payload = {
        model: selectedModel,
        messages: [
          ...(system.trim() ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: userMsg },
        ],
        stream: false,
      }
      const resp = await apiPost<any>('/api/openclaw/proxy/v1/chat/completions', payload)
      const content = resp?.choices?.[0]?.message?.content ?? JSON.stringify(resp, null, 2)
      const tokens = resp?.usage?.total_tokens
      const entry: QueryHistoryEntry = {
        model: selectedModel,
        system,
        user: userMsg,
        response: content,
        durationMs: Date.now() - t0,
        tokens,
        ts: new Date().toISOString(),
        ok: true,
      }
      setCurrentEntry(entry)
      setHistory(h => [entry, ...h].slice(0, 15))
    } catch (err: any) {
      const entry: QueryHistoryEntry = {
        model: selectedModel,
        system,
        user: userMsg,
        response: `Error: ${err?.response?.data?.error?.message ?? err?.response?.data?.error ?? err?.message ?? String(err)}`,
        durationMs: Date.now() - t0,
        ts: new Date().toISOString(),
        ok: false,
      }
      setCurrentEntry(entry)
      setHistory(h => [entry, ...h].slice(0, 15))
    } finally {
      setRunning(false)
    }
  }

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load OpenClaw status.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">OpenClaw</h1>
          <p className="text-muted-foreground mt-1">OpenAI-compatible gateway proxy — multi-model LLM access</p>
        </div>
        {d && (
          <Badge variant={d.healthy ? 'default' : 'destructive'} className="flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            {d.healthy ? 'Healthy' : 'Unhealthy'}
            {d.latency_ms != null && <span className="text-[10px] opacity-70"> · {d.latency_ms}ms</span>}
          </Badge>
        )}
      </div>

      {/* Status card */}
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className={`text-lg font-bold ${d?.healthy ? 'text-green-600' : 'text-red-500'}`}>
                {d?.healthy ? 'Online' : 'Offline'}
              </div>
              <p className="text-xs text-muted-foreground">Gateway health</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-lg font-bold font-mono truncate">{d?.url ?? 'Not configured'}</div>
              <p className="text-xs text-muted-foreground">Backend URL</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-lg font-bold">{d?.models?.length ?? DEFAULT_MODELS.length}</div>
              <p className="text-xs text-muted-foreground">Available models</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Models */}
      {(d?.models ?? DEFAULT_MODELS).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Available Models</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(d?.models ?? DEFAULT_MODELS).map((m) => (
                <Badge key={m} variant="outline" className="font-mono text-xs cursor-pointer hover:bg-muted"
                  onClick={() => setModel(m)}>
                  {m}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Console */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            LLM Test Console
          </CardTitle>
          <CardDescription>Send a chat completion request through the OpenClaw proxy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Model</label>
              <Select value={selectedModel} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(d?.models ?? DEFAULT_MODELS).map(m => (
                    <SelectItem key={m} value={m}><span className="font-mono text-xs">{m}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">System prompt</label>
              <Input
                value={system}
                onChange={e => setSystem(e.target.value)}
                placeholder="System prompt…"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">User message</label>
            <Textarea
              placeholder="Enter your message…"
              value={userMsg}
              onChange={e => setUserMsg(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>

          <Button onClick={runQuery} disabled={running || !userMsg.trim() || !d?.healthy}
            className="flex items-center gap-2">
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
            {running ? 'Running…' : 'Send'}
          </Button>

          {/* Response */}
          {currentEntry && (
            <div className={`border rounded-lg p-4 ${currentEntry.ok ? 'bg-muted/40' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{currentEntry.model}</Badge>
                  <span className="text-xs text-muted-foreground">{currentEntry.durationMs}ms</span>
                  {currentEntry.tokens && (
                    <span className="text-xs text-muted-foreground">{currentEntry.tokens} tokens</span>
                  )}
                </div>
                <Badge variant={currentEntry.ok ? 'default' : 'destructive'} className="text-[10px]">
                  {currentEntry.ok ? 'OK' : 'Error'}
                </Badge>
              </div>
              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-y-auto">
                {currentEntry.response}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Query history */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Query History
            </CardTitle>
            <CardDescription>Last {history.length} queries this session</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((h, i) => (
                <button key={i} onClick={() => setCurrentEntry(h)}
                  className="w-full text-left border rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">{h.model}</Badge>
                      <Badge variant={h.ok ? 'default' : 'destructive'} className="text-[10px]">
                        {h.ok ? 'OK' : 'Error'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.ts).toLocaleTimeString()} · {h.durationMs}ms
                      {h.tokens && ` · ${h.tokens}t`}
                    </span>
                  </div>
                  <p className="text-sm truncate text-muted-foreground">{h.user}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Endpoints reference */}
      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
          <CardDescription>Proxied through orchestrator at /api/openclaw</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              { endpoint: '/api/openclaw/proxy/v1/models', method: 'GET', desc: 'List available models' },
              { endpoint: '/api/openclaw/proxy/v1/chat/completions', method: 'POST', desc: 'Chat completion (streaming)' },
              { endpoint: '/api/openclaw/proxy/v1/embeddings', method: 'POST', desc: 'Text embeddings' },
              { endpoint: '/api/openclaw/status', method: 'GET', desc: 'Gateway health check' },
            ].map((item) => (
              <div key={item.endpoint} className="flex items-center gap-3">
                <Badge variant="outline" className="font-mono text-[10px] w-12 justify-center">{item.method}</Badge>
                <span className="font-mono text-xs flex-1">{item.endpoint}</span>
                <span className="text-muted-foreground text-xs">{item.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/openclaw')({
  component: OpenClawPage,
})
