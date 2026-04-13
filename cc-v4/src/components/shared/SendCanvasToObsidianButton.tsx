import { useState } from 'react'
import { AppWindow, ExternalLink } from 'lucide-react'
import { apiPost, normalizeError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import type { CanvasPayload } from '@/lib/visualization-contract'

type CanvasResponse = {
  success: boolean
  path: string
  uri: string
  mode: 'live' | 'github'
}

type Props = {
  payload: CanvasPayload
  disabled?: boolean
}

export function SendCanvasToObsidianButton({ payload, disabled }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [savedUri, setSavedUri] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleSend = async () => {
    setIsSubmitting(true)
    setMessage(null)

    try {
      const result = await apiPost<CanvasResponse>('/api/obsidian/canvas', {
        title: payload.title,
        kind: payload.kind,
        folder: payload.folder,
        properties: payload.properties,
        nodes: payload.nodes,
        edges: payload.edges,
        open_after_write: false,
      })
      setSavedUri(result.uri)
      setMessage(`Canvas saved to ${result.path}`)
    } catch (error) {
      setMessage(normalizeError(error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={handleSend} disabled={disabled || isSubmitting}>
        <AppWindow className="mr-2 h-4 w-4" />
        {isSubmitting ? 'Sending canvas...' : 'Send Canvas'}
      </Button>
      {savedUri && (
        <Button variant="ghost" onClick={() => { window.location.href = savedUri }}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open canvas
        </Button>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
