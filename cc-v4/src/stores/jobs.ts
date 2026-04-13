import { create } from 'zustand'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface JobEntry {
  id: string
  title: string
  status: JobStatus
  progress?: number
  detail?: string
  startedAt: string
  updatedAt: string
}

interface JobState {
  jobs: JobEntry[]
  upsertJob: (job: Omit<JobEntry, 'updatedAt'> & { updatedAt?: string }) => void
  removeJob: (id: string) => void
  reset: () => void
}

export const useJobStore = create<JobState>()((set) => ({
  jobs: [],
  upsertJob: (job) =>
    set((state) => {
      const updatedAt = job.updatedAt ?? new Date().toISOString()
      const next: JobEntry = { ...job, updatedAt }
      const index = state.jobs.findIndex((entry) => entry.id === job.id)
      if (index === -1) {
        return { jobs: [next, ...state.jobs].slice(0, 20) }
      }
      const jobs = [...state.jobs]
      jobs[index] = next
      return { jobs }
    }),
  removeJob: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  reset: () => set({ jobs: [] }),
}))
