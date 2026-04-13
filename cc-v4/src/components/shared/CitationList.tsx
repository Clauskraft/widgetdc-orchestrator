import { BookOpenText } from 'lucide-react'

export function CitationList({ citations, title = 'Sources' }: { citations: string[]; title?: string }) {
  if (citations.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BookOpenText className="h-4 w-4 text-muted-foreground" />
        {title}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {citations.map((citation, index) => (
          <span
            key={`${citation}-${index}`}
            className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground"
          >
            [{index + 1}] {citation}
          </span>
        ))}
      </div>
    </div>
  )
}
