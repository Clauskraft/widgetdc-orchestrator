import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

function CostPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['cost-intel'],
    queryFn: () => apiGet('/api/monitor/cost'),
    refetchInterval: 30000,
  })

  if (error) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load cost data.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const chartData = [
    { name: 'DeepSeek', dkk: 1200 },
    { name: 'OpenAI', dkk: 1850 },
    { name: 'Groq', dkk: 320 },
    { name: 'Gemini', dkk: 940 },
    { name: 'Claude', dkk: 2100 },
  ]

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Cost Intel</h1>
        <p className="text-muted-foreground mt-1">Token and DKK costs</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Spend (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">6,410 DKK</div>
            <p className="text-xs text-muted-foreground">
              Across all providers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tokens Used (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">42.3M</div>
            <p className="text-xs text-muted-foreground">
              Total input + output
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Cost / 1M Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">151.5 DKK</div>
            <p className="text-xs text-muted-foreground">
              Blended rate
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spend by Provider</CardTitle>
          <CardDescription>30-day breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="dkk" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { provider: 'Claude', dkk: 2100, percent: 32.8 },
              { provider: 'OpenAI', dkk: 1850, percent: 28.9 },
              { provider: 'DeepSeek', dkk: 1200, percent: 18.7 },
              { provider: 'Gemini', dkk: 940, percent: 14.7 },
              { provider: 'Groq', dkk: 320, percent: 5.0 },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{item.provider}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.percent}%
                  </div>
                </div>
                <Badge variant="outline">{item.dkk} DKK</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/cost')({
  component: CostPage,
})
