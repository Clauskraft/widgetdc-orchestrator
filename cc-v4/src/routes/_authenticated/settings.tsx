import { createFileRoute } from '@tanstack/react-router'
import { Outlet } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { settingsSubPages } from '@/components/layout/sidebar-data'

function SettingsLayout() {
  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configuration and preferences
        </p>
      </div>

      <Tabs defaultValue="account" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          {settingsSubPages.map((page) => (
            <TabsTrigger key={page.path} value={page.path.split('/').pop() || ''}>
              {page.title}
            </TabsTrigger>
          ))}
        </TabsList>

        {settingsSubPages.map((page) => (
          <TabsContent key={page.path} value={page.path.split('/').pop() || ''}>
            <Outlet />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})
