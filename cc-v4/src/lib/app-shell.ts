export type AppMode = 'workspace' | 'cockpit'

const workspacePrefixes = [
  '/engagement-workspace',
  '/compliance',
  '/deliverable',
  '/project-board',
  '/project-overview',
  '/obsidian',
  '/knowledge',
]

export function getAppModeForPath(pathname: string): AppMode {
  return workspacePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? 'workspace'
    : 'cockpit'
}

export function getModeLabel(mode: AppMode): string {
  return mode === 'workspace' ? 'Workspace' : 'Cockpit'
}
