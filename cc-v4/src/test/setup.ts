import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Auto-cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = []

  observe = () => {}
  unobserve = () => {}
  disconnect = () => {}
  takeRecords = () => []
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver implements ResizeObserver {
  observe = () => {}
  unobserve = () => {}
  disconnect = () => {}
}

// Mock TanStack Router — must use createElement for JSX
vi.mock('@tanstack/react-router', async (importOriginal: () => Promise<typeof import('@tanstack/react-router')>) => {
  const React = await import('react')
  const actual = await importOriginal()
  return {
    ...actual,
    Link: (props: { to?: string; children?: React.ReactNode }) => React.createElement('a', { href: props.to }, props.children),
    useRouter: () => ({
      navigate: () => {},
      history: { push: () => {} },
    }),
    createFileRoute: () => () => ({ component: () => null }),
    useNavigate: () => () => {},
    useParams: () => ({}),
    useSearch: () => ({}),
  }
})

// Mock auth store to avoid cookies/redirects in tests
vi.mock('@/stores/auth-store', () => {
  const mockState = {
    accessToken: 'test-token',
    reset: () => {},
  }
  const store = Object.assign(vi.fn(() => mockState), {
    getState: () => mockState,
  })
  return { useAuthStore: store }
})
