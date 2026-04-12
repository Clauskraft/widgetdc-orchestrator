/**
 * MSW — Mock Service Worker handlers for frontend API testing.
 * Mirrors the orchestrator's /api/* endpoints.
 */
import { http, HttpResponse } from 'msw'

export const handlers = [
  // ─── Dashboard data ───
  http.get('/api/dashboard/data', () => {
    return HttpResponse.json({
      agents: [
        {
          agent_id: 'test-agent-1',
          display_name: 'Test Agent Alpha',
          source: 'manual',
          version: '1.0.0',
          status: 'online',
          capabilities: ['graph.read', 'mcp.call'],
          allowed_tool_namespaces: ['graph', 'mcp'],
          active_calls: 2,
          registered_at: '2026-04-12T10:00:00Z',
          last_seen_at: '2026-04-12T20:00:00Z',
        },
        {
          agent_id: 'test-agent-2',
          display_name: 'Test Agent Beta',
          source: 'auto',
          version: '1.2.0',
          status: 'idle',
          capabilities: ['rag.query', 'cma.memory'],
          allowed_tool_namespaces: ['rag', 'cma'],
          active_calls: 0,
          registered_at: '2026-04-11T10:00:00Z',
          last_seen_at: '2026-04-12T19:00:00Z',
        },
        {
          agent_id: 'test-agent-3',
          display_name: 'Test Agent Gamma',
          source: 'auto',
          version: '0.9.0',
          status: 'offline',
          capabilities: ['linear.issues'],
          allowed_tool_namespaces: [],
          active_calls: 0,
          registered_at: '2026-04-10T10:00:00Z',
          last_seen_at: '2026-04-11T15:00:00Z',
        },
      ],
      chains: [
        {
          execution_id: 'chain-exec-001',
          mode: 'sequential',
          status: 'completed',
          started_at: '2026-04-12T18:00:00Z',
          completed_at: '2026-04-12T18:05:00Z',
        },
        {
          execution_id: 'chain-exec-002',
          mode: 'parallel',
          status: 'running',
          started_at: '2026-04-12T19:00:00Z',
        },
      ],
      cronJobs: [],
      rlmAvailable: true,
      adoptionTrends: [],
      timestamp: '2026-04-12T20:00:00Z',
    })
  }),

  // ─── Sign in (success) ───
  http.post('/api/auth/login', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    if (body.username === 'test' && body.password === 'password') {
      return HttpResponse.json({
        access_token: 'test-jwt-token',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 })
  }),

  // ─── API 500 error simulation ───
  http.get('/api/dashboard/data', ({ request }) => {
    if (request.headers.get('x-simulate-error') === 'true') {
      return HttpResponse.json({ message: 'Internal server error' }, { status: 500 })
    }
    return undefined // Fall through to normal handler
  }),
]
