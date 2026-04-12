import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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
global.IntersectionObserver = class IntersectionObserver {
  observe = () => {}
  unobserve = () => {}
  disconnect = () => {}
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe = () => {}
  unobserve = () => {}
  disconnect = () => {}
}

// Mock TanStack Router — must use createElement for JSX
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: (props: any) => React.createElement('a', { href: props.to }, props.children),
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
  const store = vi.fn(() => mockState)
  store.getState = () => mockState
  return { useAuthStore: store }
})
