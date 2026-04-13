/**
 * Lazy-load wrapper for route components that use heavy libraries (recharts).
 * Defers loading until the route is actually visited, reducing initial bundle.
 */
import { lazyRouteComponent } from '@tanstack/react-router'

/**
 * Create a lazily-loaded route from a page component file.
 * Usage: lazyRoute('./cost.page', 'CostPage')
 */
export function lazyRoute(modulePath: string, exportName: string) {
  return lazyRouteComponent(() => import(/* @vite-ignore */ modulePath), exportName)
}
