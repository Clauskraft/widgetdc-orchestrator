import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

function IntegrationsSettingsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Connect external services</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h3 className="font-medium">Slack</h3>
              <p className="text-sm text-muted-foreground">
                Send notifications to Slack
              </p>
            </div>
            <Button variant="outline">Connect</Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h3 className="font-medium">GitHub</h3>
              <p className="text-sm text-muted-foreground">
                Link your GitHub account
              </p>
            </div>
            <Button variant="outline">Connect</Button>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <h3 className="font-medium">Linear</h3>
              <p className="text-sm text-muted-foreground">
                Sync with Linear issues
              </p>
            </div>
            <Button variant="outline">Connected</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/settings/integrations')({
  component: IntegrationsSettingsPage,
})
