import { useState } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { sidebarData } from './sidebar-data'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Menu, X } from 'lucide-react'

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)

  const isActive = (path: string) => location.pathname === path

  return (
    <>
      {/* Mobile toggle */}
      <div className="md:hidden flex items-center justify-between border-b p-4 bg-card">
        <h1 className="font-bold text-lg">WidgeTDC</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen w-64 bg-card border-r border-border flex flex-col md:relative md:translate-x-0 transition-transform z-40',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-6 border-b">
          <h1 className="font-bold text-lg hidden md:block">WidgeTDC</h1>
        </div>

        <nav className="flex-1 overflow-auto p-4 space-y-6">
          {sidebarData.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.path}
                      onClick={() => {
                        navigate({ to: item.path })
                        setIsOpen(false)
                      }}
                      className={cn(
                        'w-full flex items-start gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                        isActive(item.path)
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent text-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div className="text-left">
                        <div className="font-medium">{item.title}</div>
                        {item.description && (
                          <div className="text-xs opacity-70">
                            {item.description}
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t">
          <Button variant="outline" className="w-full" size="sm">
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
