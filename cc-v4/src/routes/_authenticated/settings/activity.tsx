import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function ActivitySettingsPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Activity Settings</CardTitle>
          <CardDescription>Manage your activity preferences</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Activity logging and tracking options coming soon.
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/settings/activity')({
  component: ActivitySettingsPage,
})
