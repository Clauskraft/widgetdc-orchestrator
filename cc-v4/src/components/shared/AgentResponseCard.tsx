import type { AgentResponse } from '@widgetdc/contracts/agent'
import { AlertTriangle, CheckCircle2, XCircle, GitCompareArrows } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function StatusBadge({ status }: { status: AgentResponse['status'] }) {
  if (status === 'success') return <Badge>Success</Badge>
  if (status === 'partial') return <Badge variant="secondary">Partial</Badge>
  if (status === 'conflict') return <Badge variant="destructive">Conflict</Badge>
  return <Badge variant="destructive">Failed</Badge>
}

function StatusIcon({ status }: { status: AgentResponse['status'] }) {
  if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (status === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-500" />
  if (status === 'conflict') return <GitCompareArrows className="h-4 w-4 text-destructive" />
  return <XCircle className="h-4 w-4 text-destructive" />
}

export function AgentResponseCard({ response, title = 'Agent Response' }: { response: AgentResponse; title?: string }) {
  const renderedOutput =
    typeof response.output === 'string'
      ? response.output
      : JSON.stringify(response.output, null, 2)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-1 font-mono text-xs">{response.request_id}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon status={response.status} />
            <StatusBadge status={response.status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-5 whitespace-pre-wrap">
          {renderedOutput}
        </pre>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Input {response.tokens_used.input}</Badge>
          <Badge variant="outline">Output {response.tokens_used.output}</Badge>
          <Badge variant="outline">{response.cost_dkk.toFixed(2)} DKK</Badge>
          <Badge variant="outline">{response.agent_id}</Badge>
        </div>

        {response.conflicts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conflicts</p>
            <div className="space-y-2">
              {response.conflicts.map((conflict) => (
                <div key={`${conflict.other_agent_id}-${conflict.other_task}`} className="rounded-md border p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={conflict.mode === 'blocking' ? 'destructive' : 'secondary'}>
                      {conflict.mode}
                    </Badge>
                    <span className="font-medium">{conflict.other_agent_id}</span>
                    <span className="text-muted-foreground">{Math.round(conflict.similarity * 100)}% overlap</span>
                  </div>
                  <p className="mt-2 text-muted-foreground">{conflict.other_task}</p>
                  {conflict.suggestion && <p className="mt-2">{conflict.suggestion}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
