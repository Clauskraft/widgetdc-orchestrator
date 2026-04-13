import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface SessionState {
  engagementId: string | null
  activeClient: string | null
  locale: 'da' | 'en'
  setEngagementId: (engagementId: string | null) => void
  setActiveClient: (activeClient: string | null) => void
  setLocale: (locale: 'da' | 'en') => void
  reset: () => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      engagementId: null,
      activeClient: null,
      locale: 'en',
      setEngagementId: (engagementId) => set({ engagementId }),
      setActiveClient: (activeClient) => set({ activeClient }),
      setLocale: (locale) => set({ locale }),
      reset: () => set({ engagementId: null, activeClient: null, locale: 'en' }),
    }),
    {
      name: 'cc-v4-session',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
