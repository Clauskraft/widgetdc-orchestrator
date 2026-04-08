import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState, useCallback } from 'react'
import { apiGet, apiPost, getApiClient } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Send, Wifi, WifiOff, Pin, BookOpen, MessageSquare } from 'lucide-react'

interface Message {
  id: string
  from?: string
  to?: string
  type?: string
  role?: 'user' | 'assistant' | 'system'
  content: string
  text?: string
  timestamp: string
  pinned?: boolean
  source?: string
  tags?: string[]
}

const AGENT_ID = 'cc-user'
const WS_RECONNECT_DELAY_MS = 3000

function formatTs(ts: string) {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function msgContent(m: Message) {
  return m.content ?? m.text ?? ''
}

function msgRole(m: Message): 'user' | 'assistant' | 'system' {
  if (m.role) return m.role
  if (m.from === AGENT_ID || m.from === 'command-center-chat') return 'user'
  return 'assistant'
}

function ChatPage() {
  const token = useAuthStore(s => s.accessToken)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting')
  const [sending, setSending] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<'chat' | 'pinned' | 'rag'>('chat')
  const [ragInput, setRagInput] = useState('')
  const [ragLoading, setRagLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load history on mount
  useEffect(() => {
    apiGet<{ messages?: Message[]; history?: Message[] }>('/chat/history?limit=50')
      .then(data => {
        const hist = (data as any).messages ?? (data as any).history ?? []
        setMessages(hist)
        setHistoryLoaded(true)
      })
      .catch(() => setHistoryLoaded(true))
  }, [])

  // WebSocket connection
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/ws?agent_id=${AGENT_ID}&api_key=${encodeURIComponent(token ?? '')}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('open')
    ws.onclose = () => {
      setWsStatus('closed')
      reconnectTimer.current = setTimeout(connectWs, WS_RECONNECT_DELAY_MS)
    }
    ws.onerror = () => {
      setWsStatus('closed')
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as Message
        if (!msg.id || (!msg.content && !msg.text)) return
        setMessages(prev => {
          if (prev.some(p => p.id === msg.id)) return prev
          return [...prev, msg].slice(-200)
        })
      } catch { /* ignore malformed */ }
    }
  }, [token])

  useEffect(() => {
    connectWs()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connectWs])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setInput('')
    const tempMsg: Message = {
      id: `local-${Date.now()}`,
      from: AGENT_ID,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      source: 'command-center-chat',
    }
    setMessages(prev => [...prev, tempMsg])
    try {
      await apiPost('/chat/message', {
        from: AGENT_ID,
        content: text,
        type: 'user-message',
        tags: ['cc-chat'],
      })
    } catch {
      // message was optimistically added, WS echo will dedupe
    } finally {
      setSending(false)
    }
  }

  async function handleRagQuery() {
    if (!ragInput.trim() || ragLoading) return
    setRagLoading(true)
    const userMsg: Message = {
      id: `rag-user-${Date.now()}`,
      role: 'user',
      content: ragInput,
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])
    setRagInput('')
    try {
      const resp = await apiPost<{ reply?: string; content?: string; text?: string }>('/api/chat/rag', { query: ragInput })
      const assistantMsg: Message = {
        id: `rag-resp-${Date.now()}`,
        role: 'assistant',
        content: resp.reply ?? resp.content ?? resp.text ?? '[no response]',
        timestamp: new Date().toISOString(),
        source: 'rag',
        tags: ['rag-response'],
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `rag-err-${Date.now()}`,
        role: 'system',
        content: `RAG query failed: ${err}`,
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setRagLoading(false)
    }
  }

  const tabMessages = activeTab === 'pinned'
    ? messages.filter(m => m.pinned)
    : messages

  return (
    <div className="flex flex-col h-full p-8 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chat</h1>
          <p className="text-muted-foreground mt-1">Real-time agent messaging</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={wsStatus === 'open' ? 'default' : wsStatus === 'connecting' ? 'secondary' : 'destructive'}
            className="flex items-center gap-1.5 px-2.5 py-1">
            {wsStatus === 'open' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {wsStatus}
          </Badge>
          <span className="text-xs text-muted-foreground">{messages.length} messages</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-shrink-0">
        {([
          { key: 'chat', label: 'Broadcast', icon: MessageSquare },
          { key: 'rag', label: 'RAG Query', icon: BookOpen },
          { key: 'pinned', label: `Pinned (${messages.filter(m=>m.pinned).length})`, icon: Pin },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors
              ${activeTab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Message area */}
      <Card className="flex-1 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {!historyLoaded ? (
            <div className="text-center text-sm text-muted-foreground py-8">Loading history…</div>
          ) : tabMessages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              {activeTab === 'pinned' ? 'No pinned messages.' : 'No messages yet. Start a conversation.'}
            </div>
          ) : (
            tabMessages.map((msg) => {
              const role = msgRole(msg)
              const content = msgContent(msg)
              if (!content) return null
              return (
                <div key={msg.id} className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] group relative`}>
                    {role !== 'user' && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          {msg.from ?? msg.source ?? 'agent'}
                        </span>
                        {msg.tags?.map(t => (
                          <span key={t} className="text-[10px] bg-muted px-1 rounded">{t}</span>
                        ))}
                      </div>
                    )}
                    <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed
                      ${role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : role === 'system'
                        ? 'bg-amber-50 border border-amber-200 text-amber-900 rounded-bl-sm'
                        : 'bg-muted rounded-bl-sm'}`}>
                      <pre className="whitespace-pre-wrap font-sans">{content}</pre>
                    </div>
                    <div className={`text-[10px] text-muted-foreground mt-0.5 ${role === 'user' ? 'text-right' : 'text-left'}`}>
                      {formatTs(msg.timestamp)}
                      {msg.pinned && <span className="ml-1">📌</span>}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Input area */}
        <div className="border-t p-3 flex-shrink-0">
          {activeTab === 'rag' ? (
            <div className="flex gap-2">
              <Input
                placeholder="Ask a question — answered with knowledge graph context…"
                value={ragInput}
                onChange={e => setRagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleRagQuery()}
                disabled={ragLoading}
                className="flex-1"
              />
              <Button onClick={handleRagQuery} size="icon" disabled={ragLoading || !ragInput.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                placeholder={wsStatus === 'open' ? 'Broadcast to all agents…' : 'Connecting…'}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                disabled={sending}
                className="flex-1"
              />
              <Button onClick={handleSend} size="icon" disabled={sending || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/chat')({
  component: ChatPage,
})
