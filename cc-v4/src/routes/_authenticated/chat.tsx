import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useState } from 'react'
import { Send } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

function ChatPage() {
  const [input, setInput] = useState('')
  const { data: messages = [], isLoading, error } = useQuery({
    queryKey: ['chat-messages'],
    queryFn: () => apiGet<Message[]>('/api/chat/messages'),
    refetchInterval: 5000,
  })

  const handleSend = () => {
    if (!input.trim()) return
    // TODO: Send message via API
    setInput('')
  }

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load chat.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8 h-full">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Chat</h1>
        <p className="text-muted-foreground mt-1">Real-time chat interface</p>
      </div>

      <Card className="flex-1 flex flex-col">
        <CardContent className="flex-1 overflow-auto p-4 space-y-4">
          {isLoading
            ? [1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ))
            : messages.length > 0
            ? messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === 'user'
                      ? 'justify-end'
                      : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-xs px-4 py-2 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))
            : (
                <p className="text-center text-muted-foreground">
                  No messages yet. Start a conversation.
                </p>
              )}
        </CardContent>

        <div className="border-t p-4 flex gap-2">
          <Input
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') handleSend()
            }}
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            size="icon"
            disabled={isLoading || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/chat')({
  component: ChatPage,
})
