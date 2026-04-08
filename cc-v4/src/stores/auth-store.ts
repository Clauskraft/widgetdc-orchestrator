import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import Cookies from 'js-cookie'

interface User {
  email?: string
  role?: string[]
}

interface AuthStore {
  user: User | null
  accessToken: string | null
  setUser: (user: User | null) => void
  setAccessToken: (token: string | null) => void
  reset: () => void
}

const COOKIE_NAME = 'cc_api_key'

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setUser: (user) => set({ user }),
      setAccessToken: (token) => {
        set({ accessToken: token })
        if (token) {
          Cookies.set(COOKIE_NAME, token, { secure: true, sameSite: 'strict' })
        } else {
          Cookies.remove(COOKIE_NAME)
        }
      },
      reset: () => {
        set({ user: null, accessToken: null })
        Cookies.remove(COOKIE_NAME)
      },
    }),
    {
      name: 'auth-store',
      storage: {
        getItem: (name) => {
          const item = sessionStorage.getItem(name)
          return item ? JSON.parse(item) : null
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value))
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name)
        },
      },
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) {
          Cookies.set(COOKIE_NAME, state.accessToken, {
            secure: true,
            sameSite: 'strict',
          })
        }
      },
    }
  )
)
