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

  // Response interceptor to handle 401
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

export async function apiGet<T>(url: string, config?: any): Promise<T> {
  const client = getApiClient()
  const response = await client.get<T>(url, config)
  return response.data
}

export async function apiPost<T>(url: string, data?: any, config?: any): Promise<T> {
  const client = getApiClient()
  const response = await client.post<T>(url, data, config)
  return response.data
}

export async function apiPut<T>(url: string, data?: any, config?: any): Promise<T> {
  const client = getApiClient()
  const response = await client.put<T>(url, data, config)
  return response.data
}

export async function apiDelete<T>(url: string, config?: any): Promise<T> {
  const client = getApiClient()
  const response = await client.delete<T>(url, config)
  return response.data
}
