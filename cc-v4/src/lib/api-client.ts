import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth-store'

let apiClient: AxiosInstance | null = null

export function initializeApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: window.location.origin,
    timeout: 30000,
  })

  // Request interceptor to add auth token
  client.interceptors.request.use(
    (config) => {
      const token = useAuthStore.getState().accessToken
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    },
    (error) => {
      return Promise.reject(error)
    }
  )

  // Response interceptor to handle 401 and track offline state
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      if (error.response?.status === 401) {
        useAuthStore.getState().reset()
        window.location.href = '/sign-in'
      }
      return Promise.reject(error)
    }
  )

  apiClient = client
  return client
}

export function getApiClient(): AxiosInstance {
  if (!apiClient) {
    return initializeApiClient()
  }
  return apiClient
}

// ─── Retry configuration ────────────────────────────────────────────────────

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

function isRetryable(error: AxiosError): boolean {
  if (!error.response) return true // network error / offline
  const status = error.response.status
  return status === 429 || status >= 500 // rate limit or server error
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === retries || !isRetryable(error as AxiosError)) throw error
      await delay(RETRY_DELAY_MS * Math.pow(2, attempt)) // exponential backoff
    }
  }
  throw new Error('unreachable')
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ApiError {
  message: string
  status?: number
  isOffline: boolean
  isRetryable: boolean
}

function normalizeError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const ae = error as AxiosError<{ message?: string }>
    return {
      message: ae.response?.data?.message ?? ae.message ?? 'Unknown error',
      status: ae.response?.status,
      isOffline: !ae.response,
      isRetryable: isRetryable(ae),
    }
  }
  return {
    message: error instanceof Error ? error.message : 'Unknown error',
    isOffline: false,
    isRetryable: false,
  }
}

export async function apiGet<T>(url: string, config?: any): Promise<T> {
  const client = getApiClient()
  return withRetry(async () => {
    const response = await client.get<T>(url, config)
    return response.data
  })
}

export async function apiPost<T>(url: string, data?: any, config?: any): Promise<T> {
  const client = getApiClient()
  return withRetry(async () => {
    const response = await client.post<T>(url, data, config)
    return response.data
  })
}

export async function apiPut<T>(url: string, data?: any, config?: any): Promise<T> {
  const client = getApiClient()
  return withRetry(async () => {
    const response = await client.put<T>(url, data, config)
    return response.data
  })
}

export async function apiDelete<T>(url: string, config?: any): Promise<T> {
  const client = getApiClient()
  return withRetry(async () => {
    const response = await client.delete<T>(url, config)
    return response.data
  })
}

export { normalizeError }
