import { useState } from 'react'
import { ExternalLink, NotebookPen } from 'lucide-react'
import { apiPost, normalizeError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

type MaterializeResponse = {
  success: boolean
  path: string
  uri: string
  mode: 'live' | 'github'
}

type Props = {
  title: string
  kind: string
  folder: string
  contentMarkdown: string
  properties?: Record<string, string | number | boolean | null>
  disabled?: boolean
}

export function SendToObsidianButton({ title, kind, folder, contentMarkdown, properties, disabled }: Props) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [savedUri, setSavedUri] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleSend = async () => {
    setIsSubmitting(true)
    setMessage(null)

    try {
      const result = await apiPost<MaterializeResponse>('/api/obsidian/materialize', {
        title,
        kind,
        folder,
        properties,
        content_markdown: contentMarkdown,
        open_after_write: false,
      })

      setSavedPath(result.path)
      setSavedUri(result.uri)
      setMessage(`Saved to ${result.path}`)
    } catch (error) {
      setMessage(normalizeError(error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={handleSend} disabled={disabled || isSubmitting || !contentMarkdown.trim()}>
        <NotebookPen className="mr-2 h-4 w-4" />
        {isSubmitting ? 'Sending to Obsidian...' : 'Send to Obsidian'}
      </Button>
      {savedUri && (
        <Button variant="ghost" onClick={() => { window.location.href = savedUri }}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open note
        </Button>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {savedPath && !message?.includes(savedPath) && <p className="text-sm text-muted-foreground">{savedPath}</p>}
    </div>
  )
}
