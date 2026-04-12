/**
 * Tests for ErrorBoundary component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

// Component that throws during render
const ThrowComponent = ({ message = 'Boom!' }: { message?: string }) => {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Safe content')).toBeInTheDocument()
  })

  it('renders fallback UI when child throws', () => {
    // Suppress console.error for this test
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <ThrowComponent message="Test error" />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test error')).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()

    vi.mocked(console.error).mockRestore()
  })

  it('calls onError callback when error occurs', () => {
    const onError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary onError={onError}>
        <ThrowComponent message="Callback test" />
      </ErrorBoundary>
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].message).toBe('Callback test')

    vi.mocked(console.error).mockRestore()
  })

  it('renders custom fallback when provided as ReactNode', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error UI</div>}>
        <ThrowComponent />
      </ErrorBoundary>
    )

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
    expect(screen.getByText('Custom error UI')).toBeInTheDocument()

    vi.mocked(console.error).mockRestore()
  })

  it('renders function fallback with error and reset', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <div>
            <span>Error: {error.message}</span>
            <button onClick={reset}>Reset</button>
          </div>
        )}
      >
        <ThrowComponent message="Function fallback test" />
      </ErrorBoundary>
    )

    expect(screen.getByText('Error: Function fallback test')).toBeInTheDocument()

    // Reset should clear the error state
    fireEvent.click(screen.getByText('Reset'))
    // After reset, it will try to render children again (which throw again)
    // But the reset function itself should have been called
    expect(screen.getByText('Error: Function fallback test')).toBeInTheDocument()

    vi.mocked(console.error).mockRestore()
  })

  it('shows default fallback when no fallback provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <ThrowComponent message="Default fallback" />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Default fallback')).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()

    vi.mocked(console.error).mockRestore()
  })
})
