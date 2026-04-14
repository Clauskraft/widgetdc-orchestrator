import { Outlet, createRootRoute } from '@tanstack/react-router'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export const Route = createRootRoute({
  component: () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-background">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Application Error</h1>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">{error.message}</p>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Reload App
          </button>
        </div>
      )}
    >
      <>
        <Outlet />
      </>
    </ErrorBoundary>
  ),
})
