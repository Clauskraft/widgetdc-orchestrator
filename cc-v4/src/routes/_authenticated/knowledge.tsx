import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { apiPost } from '@/lib/api-client'
import { Skeleton } from '@/components/ui/skeleton'

type KnowledgeResult = Record<string, unknown>

function KnowledgePage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeResult[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setIsLoading(true)
    try {
      const data = await apiPost<KnowledgeResult[]>('/api/knowledge/search', { query })
      setResults(data)
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Knowledge Graph</h1>
        <p className="text-muted-foreground mt-1">Search the knowledge base</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>
            Query the Neo4j knowledge graph
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              placeholder="Enter search query..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isLoading}
            />
            <Button type="submit" disabled={isLoading || !query}>
              <Search className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Results</h2>
          {results.map((result, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <pre className="bg-muted p-3 rounded-md overflow-auto text-xs">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/knowledge')({
  component: KnowledgePage,
})
