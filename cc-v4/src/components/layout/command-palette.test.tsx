import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './command-palette'

vi.mock('@/lib/api-client', () => ({
  apiPost: vi.fn(),
}))

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('opens Open WebUI in a new tab from the command palette', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<CommandPalette mode="cockpit" onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: /cmd/i }))
    await user.click(screen.getByRole('button', { name: /open open webui/i }))

    expect(openSpy).toHaveBeenCalledWith(
      'https://open-webui-production-25cb.up.railway.app',
      '_blank',
      'noopener,noreferrer',
    )
    expect(onResult).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Opened Open WebUI in a new tab.',
    })
  })
})
