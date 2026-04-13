import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TokenUsage } from '@widgetdc/contracts/agent'

interface TelemetryTotals {
  input: number
  output: number
  costDkk: number
  requests: number
}

interface TelemetryState {
  totals: TelemetryTotals
  lastUpdatedAt: string | null
  updateFromResponse: (usage: TokenUsage | null | undefined, costDkk: number) => void
  hydrateRuntimeSummary: (summary: unknown) => void
  reset: () => void
}

const INITIAL_TOTALS: TelemetryTotals = {
  input: 0,
  output: 0,
  costDkk: 0,
  requests: 0,
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export const useTelemetryStore = create<TelemetryState>()(
  persist(
    (set) => ({
      totals: INITIAL_TOTALS,
      lastUpdatedAt: null,
      updateFromResponse: (usage, costDkk) =>
        set((state) => ({
          totals: {
            input: state.totals.input + readNumber(usage?.input),
            output: state.totals.output + readNumber(usage?.output),
            costDkk: Math.round((state.totals.costDkk + readNumber(costDkk)) * 100) / 100,
            requests: state.totals.requests + 1,
          },
          lastUpdatedAt: new Date().toISOString(),
        })),
      hydrateRuntimeSummary: (summary) => {
        const record = typeof summary === 'object' && summary !== null ? summary as Record<string, unknown> : null
        const totals = (record?.totals ?? record?.summary ?? record?.metrics ?? record) as Record<string, unknown> | undefined
        if (!totals) return

        set({
          totals: {
            input: readNumber(totals.input_tokens ?? totals.input),
            output: readNumber(totals.output_tokens ?? totals.output),
            costDkk: Math.round(readNumber(totals.cost_dkk ?? totals.costDkk) * 100) / 100,
            requests: readNumber(totals.requests ?? totals.total_requests ?? totals.calls),
          },
          lastUpdatedAt: new Date().toISOString(),
        })
      },
      reset: () => set({ totals: INITIAL_TOTALS, lastUpdatedAt: null }),
    }),
    {
      name: 'cc-v4-telemetry',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
