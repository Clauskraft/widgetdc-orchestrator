import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { RefreshCw, Search as SearchIcon } from 'lucide-react'

interface ObsidianStatus {
  connected: boolean
  error?: string
  setup?: string
  versions?: Record<string, string>
}

interface VaultEntry {
  path: string
  type: 'file' | 'dir'
}

interface VaultStats {
  vault_name?: string
  root_count?: number
  recursive_file_count?: number
  recursive_dir_count?: number
}

interface SearchResult {
  filename: string
  score: number
  context?: string[]
}

interface TagCloud {
  [tag: string]: number
}

function ObsidianPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [selectedNote, setSelectedNote] = useState<string | null>(null)

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<ObsidianStatus>({
    queryKey: ['obsidian-status'],
    queryFn: () => apiGet('/api/obsidian/status'),
    retry: 1,
  })

  const { data: vault, isLoading: vaultLoading } = useQuery<{ files: VaultEntry[] }>({
    queryKey: ['obsidian-vault'],
    queryFn: () => apiGet('/api/obsidian/vault/list'),
    enabled: status?.connected === true,
    retry: 1,
  })

  const { data: vaultStats, isLoading: statsLoading } = useQuery<VaultStats>({
    queryKey: ['obsidian-vault-stats'],
    queryFn: () => apiGet('/api/obsidian/vault/stats'),
    enabled: status?.connected === true,
    retry: 1,
  })

  const { data: searchResults, isLoading: searching } = useQuery<SearchResult[]>({
    queryKey: ['obsidian-search', activeSearch],
    queryFn: () => apiGet(`/api/obsidian/search?q=${encodeURIComponent(activeSearch)}`),
    enabled: activeSearch.length > 2 && status?.connected === true,
    retry: 1,
  })

  const { data: tags, isLoading: tagsLoading } = useQuery<TagCloud>({
    queryKey: ['obsidian-tags'],
    queryFn: () => apiGet('/api/obsidian/tags'),
    enabled: status?.connected === true,
    retry: 1,
  })

  const { data: noteContent } = useQuery<{ path: string; content: string }>({
    queryKey: ['obsidian-note', selectedNote],
    queryFn: () => apiGet(`/api/obsidian/note?path=${encodeURIComponent(selectedNote!)}`),
    enabled: selectedNote != null && status?.connected === true,
    retry: 1,
  })

  const handleRefresh = () => {
    refetchStatus()
    queryClient.invalidateQueries({ queryKey: ['obsidian-vault'] })
    queryClient.invalidateQueries({ queryKey: ['obsidian-vault-stats'] })
    queryClient.invalidateQueries({ queryKey: ['obsidian-tags'] })
  }

  if (statusLoading) {
    return (
      <div className="p-8 flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!status?.connected) {
    return (
      <div className="p-8 flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Obsidian Vault</h1>
          <p className="text-muted-foreground mt-1">Browse and search your Obsidian knowledge base</p>
        </div>
        <Alert>
          <AlertTitle>Obsidian not connected</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-2">{status?.error ?? 'OBSIDIAN_API_URL is not configured.'}</p>
            {status?.setup && <p className="font-mono text-xs bg-muted p-2 rounded">{status.setup}</p>}
          </AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>Setup Instructions</CardTitle>
            <CardDescription>Connect your Obsidian vault to the Command Center</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              <li>Install the <strong className="text-foreground">Local REST API</strong> community plugin in Obsidian</li>
              <li>Enable the plugin — copy the API key from plugin settings</li>
              <li>Set <code className="bg-muted px-1 rounded font-mono text-xs">OBSIDIAN_API_URL=http://localhost:27123</code> in Railway env vars</li>
              <li>Set <code className="bg-muted px-1 rounded font-mono text-xs">OBSIDIAN_API_TOKEN=your-api-key</code> in Railway env vars</li>
              <li>For remote (Railway → local): use ngrok or Cloudflare Tunnel to expose port 27123</li>
            </ol>
            <div className="bg-muted rounded p-3 font-mono text-xs space-y-1">
              <div>OBSIDIAN_API_URL=https://your-tunnel.ngrok.io</div>
              <div>OBSIDIAN_API_TOKEN=your-obsidian-api-key</div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const files = vault?.files ?? []
  const mdFiles = files.filter(f => f.type === 'file' && f.path.endsWith('.md'))
  const folders = files.filter(f => f.type === 'dir')

  // Sort tags by frequency, get top 20
  const sortedTags = tags ? Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 20) : []

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Obsidian Vault</h1>
          <p className="text-muted-foreground mt-1">Browse and search your knowledge base</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={statusLoading || vaultLoading || statsLoading}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Badge className="bg-green-600 text-white">Connected</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vaultLoading || statsLoading ? '…' : vaultStats?.recursive_file_count ?? mdFiles.length}</div>
            <p className="text-xs text-muted-foreground">Markdown files</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Folders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vaultLoading || statsLoading ? '…' : vaultStats?.recursive_dir_count ?? folders.length}</div>
            <p className="text-xs text-muted-foreground">Directories</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tagsLoading ? '…' : sortedTags.length}</div>
            <p className="text-xs text-muted-foreground">Unique tags</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">API</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.versions?.obsidian ?? 'Live'}</div>
            <p className="text-xs text-muted-foreground">Obsidian version</p>
          </CardContent>
        </Card>
      </div>

      {/* Tag Cloud */}
      {sortedTags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Tag Cloud</CardTitle>
            <CardDescription>Most frequently used tags in vault</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {sortedTags.map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => setActiveSearch(`#${tag}`)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-sm"
                >
                  <span className="font-medium text-primary">#{tag}</span>
                  <Badge variant="secondary" className="h-fit text-xs">{count}</Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Search Notes</CardTitle>
          <CardDescription>Full-text search across your vault</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search notes… (press Enter)"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchQuery.length > 2) setActiveSearch(searchQuery) }}
              className="flex-1"
            />
            <Button
              onClick={() => searchQuery.length > 2 && setActiveSearch(searchQuery)}
              disabled={searching || searchQuery.length < 3}
              size="sm"
            >
              <SearchIcon className="h-4 w-4 mr-1" />
              Search
            </Button>
          </div>
          {searching && <div className="text-sm text-muted-foreground animate-pulse">Searching…</div>}
          {searchResults && searchResults.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {searchResults.map((r, i) => (
                <div
                  key={i}
                  className="border rounded-lg p-3 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedNote(r.filename)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium truncate flex-1">{r.filename}</span>
                    <Badge variant="outline" className="text-xs ml-2">score {r.score?.toFixed(2)}</Badge>
                  </div>
                  {r.context && r.context.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.context[0]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {searchResults && searchResults.length === 0 && activeSearch && (
            <div className="text-sm text-muted-foreground">No results for "{activeSearch}"</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Explorer */}
        <Card>
          <CardHeader>
            <CardTitle>Vault Explorer</CardTitle>
            <CardDescription>Root-level structure</CardDescription>
          </CardHeader>
          <CardContent>
            {vaultLoading ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              <div className="space-y-0.5 max-h-72 overflow-y-auto text-sm">
                {folders.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                    <span>📁</span><span className="text-muted-foreground">{f.path}</span>
                  </div>
                ))}
                {mdFiles.slice(0, 25).map((f, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${selectedNote === f.path ? 'bg-muted' : 'hover:bg-muted/50'}`}
                    onClick={() => setSelectedNote(f.path)}
                  >
                    <span>📄</span><span className="truncate">{f.path}</span>
                  </div>
                ))}
                {mdFiles.length > 25 && (
                  <div className="text-xs text-muted-foreground px-2 py-1">…and {mdFiles.length - 25} more</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Note Viewer */}
        <Card>
          <CardHeader>
            <CardTitle>Note Viewer</CardTitle>
            <CardDescription className="truncate">{selectedNote ?? 'Select a note to view'}</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedNote && noteContent ? (
              <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-72 whitespace-pre-wrap font-mono leading-relaxed">
                {noteContent.content.slice(0, 3000)}{noteContent.content.length > 3000 ? '\n\n…(truncated at 3000 chars)' : ''}
              </pre>
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                Click a note in the explorer or search results
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/obsidian')({
  component: ObsidianPage,
})
