/**
 * WebSocket hook for real-time platform updates.
 * Falls back to TanStack Query polling if WebSocket is unavailable.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface UsePlatformSocketOptions {
  /** Query keys to invalidate on socket message */
  queryKeys?: string[][]
  /** Enable socket connection (default: true) */
  enabled?: boolean
}

interface UsePlatformSocketReturn {
  /** Whether socket is connected */
  connected: boolean
  /** Last message received (if any) */
  lastMessage: string | null
  /** Connection error (if any) */
  error: string | null
}

/**
 * Connect to orchestrator WebSocket for real-time updates.
 * On disconnect or error, falls back silently — TanStack Query
 * polling continues to work as the reliable backup.
 */
export function usePlatformSocket(
  options: UsePlatformSocketOptions = {},
): UsePlatformSocketReturn {
  const { queryKeys = [], enabled = true } = options
  const queryClient = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [connected, setConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(() => {
    if (!enabled) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const origin = window.location.origin
      const wsUrl = origin.replace(/^http/, 'ws') + '/ws/platform'
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          setLastMessage(event.data)

          // Invalidate relevant query keys on socket message
          if (data.type === 'flywheel_update' || data.type === 'metrics_update') {
            queryClient.invalidateQueries({ queryKey: ['flywheel-metrics'] })
            queryClient.invalidateQueries({ queryKey: ['flywheel-consolidation'] })
          }
          if (data.type === 'agent_update') {
            queryClient.invalidateQueries({ queryKey: ['dashboard-data'] })
            queryClient.invalidateQueries({ queryKey: ['dashboard-agents'] })
          }
          if (data.type === 'chain_update') {
            queryClient.invalidateQueries({ queryKey: ['dashboard-data'] })
            queryClient.invalidateQueries({ queryKey: ['chains'] })
          }
          // Generic: invalidate all provided keys
          for (const key of queryKeys) {
            queryClient.invalidateQueries({ queryKey: key })
          }
        } catch {
          // Non-JSON message — ignore
        }
      }

      ws.onclose = () => {
        setConnected(false)
        // Reconnect after 5s
        reconnectTimer.current = setTimeout(connect, 5000)
      }

      ws.onerror = () => {
        setError('WebSocket connection failed')
        setConnected(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WebSocket not supported')
      setConnected(false)
    }
  }, [enabled, queryClient, queryKeys])

  useEffect(() => {
    if (!enabled) return
    connect()
    return () => {
      wsRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [connect, enabled])

  return { connected, lastMessage, error }
}
