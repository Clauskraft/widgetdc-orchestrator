import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'

function APIKeysSettingsPage() {
  const [newKeyName, setNewKeyName] = useState('')

  const keys = [
    {
      id: '1',
      name: 'Production',
      key: 'cc_prod_1234...5678',
      created: '2024-01-15',
    },
    {
      id: '2',
      name: 'Development',
      key: 'cc_dev_9876...5432',
      created: '2024-02-01',
    },
  ]

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>Manage your API keys for authentication</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="New key name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
            <Button>Generate</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {keys.map((key) => (
          <Card key={key.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">{key.name}</h3>
                  <p className="text-sm text-muted-foreground font-mono">
                    {key.key}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created: {key.created}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/settings/api-keys')({
  component: APIKeysSettingsPage,
})
