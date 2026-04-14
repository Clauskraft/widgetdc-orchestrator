import { describe, expect, it } from 'vitest'
import { getAppModeForPath, getModeLabel } from '@/lib/app-shell'

describe('app shell mode mapping', () => {
  it('maps consulting routes to workspace mode', () => {
    expect(getAppModeForPath('/engagement-workspace')).toBe('workspace')
    expect(getAppModeForPath('/deliverable/draft')).toBe('workspace')
    expect(getAppModeForPath('/obsidian')).toBe('workspace')
  })

  it('maps operator routes to cockpit mode', () => {
    expect(getAppModeForPath('/')).toBe('cockpit')
    expect(getAppModeForPath('/observability')).toBe('cockpit')
    expect(getAppModeForPath('/omega')).toBe('cockpit')
  })

  it('returns human labels for modes', () => {
    expect(getModeLabel('workspace')).toBe('Workspace')
    expect(getModeLabel('cockpit')).toBe('Cockpit')
  })
})
