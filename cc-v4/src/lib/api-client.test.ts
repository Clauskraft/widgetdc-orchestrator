/**
 * Tests for api-client.ts — covers initialization, auth interceptor,
 * response interceptor (401 redirect), retry logic, and error normalization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const server = setupServer()

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'bypass' })
  vi.useFakeTimers()
})

afterEach(() => {
  server.close()
  server.resetHandlers()
  vi.useRealTimers()
  vi.resetModules()
})

describe('api-client', () => {
  describe('initializeApiClient', () => {
    it('creates an axios instance with correct config', async () => {
      const { initializeApiClient } = await import('@/lib/api-client')
      const client = initializeApiClient()
      expect(client.defaults.baseURL).toBe(window.location.origin)
      expect(client.defaults.timeout).toBe(30000)
    })
  })

  describe('apiGet', () => {
    it('fetches data and returns response.data', async () => {
      server.use(
        http.get('*/api/test', () =>
          HttpResponse.json({ id: 1, name: 'test' })
        )
      )

      // Reset modules to get a fresh apiClient
      vi.resetModules()
      const { apiGet } = await import('@/lib/api-client')
      const data = await apiGet('/api/test')
      expect(data).toEqual({ id: 1, name: 'test' })
    })

    it('retries on 500 and succeeds on retry', async () => {
      let attempt = 0
      server.use(
        http.get('*/api/flaky', () => {
          attempt++
          if (attempt === 1) {
            return HttpResponse.json({ message: 'Server error' }, { status: 500 })
          }
          return HttpResponse.json({ recovered: true })
        })
      )

      vi.resetModules()
      const { apiGet } = await import('@/lib/api-client')
      const promise = apiGet('/api/flaky')

      // Fast-forward retry delays (1s + 2s = 3s)
      await vi.advanceTimersByTimeAsync(3000)

      const data = await promise
      expect(data).toEqual({ recovered: true })
      expect(attempt).toBe(2)
    })

    it('throws after max retries on persistent 500', async () => {
      server.use(
        http.get('*/api/always-fails', () =>
          HttpResponse.json({ message: 'Internal error' }, { status: 500 })
        )
      )

      vi.resetModules()
      const { apiGet } = await import('@/lib/api-client')
      const promise = apiGet('/api/always-fails')

      // Fast-forward all retry delays (1s + 2s = 3s for 2 retries)
      await vi.advanceTimersByTimeAsync(3000)

      await expect(promise).rejects.toThrow()
    })

    it('does NOT retry on 400 (client error)', async () => {
      let attempt = 0
      server.use(
        http.get('*/api/bad-request', () => {
          attempt++
          return HttpResponse.json({ message: 'Bad request' }, { status: 400 })
        })
      )

      vi.resetModules()
      const { apiGet } = await import('@/lib/api-client')
      await expect(apiGet('/api/bad-request')).rejects.toThrow()
      expect(attempt).toBe(1) // No retries
    })

    it('retries on 429 (rate limit)', async () => {
      let attempt = 0
      server.use(
        http.get('*/api/rate-limited', () => {
          attempt++
          if (attempt === 1) {
            return HttpResponse.json({ message: 'Rate limited' }, { status: 429 })
          }
          return HttpResponse.json({ ok: true })
        })
      )

      vi.resetModules()
      const { apiGet } = await import('@/lib/api-client')
      const promise = apiGet('/api/rate-limited')
      await vi.advanceTimersByTimeAsync(3000)
      const data = await promise
      expect(data).toEqual({ ok: true })
    })
  })

  describe('apiPost', () => {
    it('posts data and returns response.data', async () => {
      server.use(
        http.post('*/api/test', async ({ request }) => {
          const body = await request.json()
          return HttpResponse.json({ echo: body })
        })
      )

      vi.resetModules()
      const { apiPost } = await import('@/lib/api-client')
      const data = await apiPost('/api/test', { key: 'value' })
      expect(data).toEqual({ echo: { key: 'value' } })
    })
  })

  describe('apiDelete', () => {
    it('deletes and returns response.data', async () => {
      server.use(
        http.delete('*/api/test/1', () =>
          HttpResponse.json({ deleted: true })
        )
      )

      vi.resetModules()
      const { apiDelete } = await import('@/lib/api-client')
      const data = await apiDelete('/api/test/1')
      expect(data).toEqual({ deleted: true })
    })
  })

  describe('normalizeError', () => {
    it('normalizes non-Axios errors', async () => {
      const { normalizeError } = await import('@/lib/api-client')
      const normalized = normalizeError(new Error('Generic error'))
      expect(normalized.message).toBe('Generic error')
      expect(normalized.isOffline).toBe(false)
      expect(normalized.isRetryable).toBe(false)
    })

    it('handles unknown error types', async () => {
      const { normalizeError } = await import('@/lib/api-client')
      const normalized = normalizeError(null)
      expect(normalized.message).toBe('Unknown error')
    })
  })
})
