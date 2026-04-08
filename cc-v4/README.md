# WidgeTDC Command Center v4 (cc-v4)

Complete React 19 source code for the WidgeTDC Command Center SPA.

## Stack

- **React 19** — Latest React with hooks and suspense
- **TypeScript** — Strict mode
- **Vite** — Lightning-fast build tool
- **TanStack Router** — File-based routing (auto-generated)
- **TanStack Query** — Data fetching and caching
- **Zustand** — Lightweight state management
- **Tailwind CSS 4** — Utility-first styling
- **shadcn/ui** — Pre-built UI components
- **Recharts** — React charting library
- **Lucide React** — Beautiful icons
- **Axios** — HTTP client

## Project Structure

```
cc-v4/
├── src/
│   ├── main.tsx                    # React entry point
│   ├── index.css                   # Tailwind + global styles
│   ├── routeTree.gen.ts            # Auto-generated route tree
│   ├── lib/
│   │   ├── api-client.ts           # Axios + auth interceptors
│   │   └── utils.ts                # cn() helper
│   ├── stores/
│   │   └── auth-store.ts           # Zustand auth state
│   ├── components/
│   │   ├── ui/                     # shadcn/ui components
│   │   └── layout/
│   │       ├── sidebar.tsx         # Main sidebar navigation
│   │       └── sidebar-data.ts     # Nav structure & links
│   └── routes/
│       ├── __root.tsx              # Root layout
│       ├── _authenticated.tsx      # Protected layout
│       ├── _authenticated/
│       │   ├── index.tsx           # Dashboard
│       │   ├── agents.tsx
│       │   ├── chains.tsx
│       │   ├── cron.tsx
│       │   ├── chat.tsx
│       │   ├── omega.tsx           # Governance
│       │   ├── knowledge.tsx       # Graph search
│       │   ├── cognitive.tsx       # RLM status
│       │   ├── pheromone.tsx       # Signal layer
│       │   ├── fleet-learning.tsx  # Agent fleet
│       │   ├── inventor.tsx        # Evolution
│       │   ├── anomaly.tsx         # Anomaly detection
│       │   ├── audit.tsx           # Audit log
│       │   ├── cost.tsx            # Cost Intel
│       │   ├── adoption.tsx        # Tool adoption
│       │   ├── openclaw.tsx        # Gateway
│       │   ├── obsidian.tsx        # Vault integration
│       │   └── settings/
│       │       ├── account.tsx
│       │       ├── appearance.tsx
│       │       ├── activity.tsx
│       │       ├── integrations.tsx
│       │       └── api-keys.tsx
│       └── (auth)/
│           └── sign-in.tsx         # Login page
├── public/
│   └── images/                     # Favicons and assets
├── index.html                      # HTML root
├── vite.config.ts                  # Vite configuration
├── tsconfig.json                   # TypeScript config
├── tailwind.config.ts              # Tailwind config
├── postcss.config.cjs              # PostCSS config
├── package.json                    # Dependencies
└── .gitignore

```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
cd cc-v4
npm install
```

### Development

```bash
npm run dev
```

Starts Vite dev server at `http://localhost:5173`

### Build

```bash
npm run build
```

Outputs to `../frontend-v4/` (committed and served by Railway)

### Type Checking

```bash
npm run type-check
```

## Architecture

### API Client

The `api-client.ts` provides a centralized Axios instance with:

- **Base URL**: `window.location.origin` (respects any deployment environment)
- **Auth**: Bearer token from `auth-store` on every request
- **401 Interceptor**: Resets auth and redirects to `/sign-in`

```typescript
const data = await apiGet('/api/agents')
const result = await apiPost('/api/endpoint', { payload })
```

### Auth Flow

1. User enters API key on `/sign-in`
2. Validates against `/api/dashboard`
3. On success: stored in Zustand + localStorage + cookie
4. Auth store is persisted and rehydrated on page load
5. Missing token redirects to `/sign-in` (protected routes only)

### Data Fetching

Using TanStack Query for caching and auto-refetch:

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['agents'],
  queryFn: () => apiGet('/api/agents'),
  refetchInterval: 10000, // 10 seconds
})
```

### Routing

TanStack Router with file-based convention:
- Routes auto-discovered from `src/routes/`
- Prefix `_authenticated` = protected layout
- Auth guard in `_authenticated.tsx` beforeLoad
- Auto-generated `routeTree.gen.ts`

### Sidebar Navigation

6 groups × 17 panels:
1. **Operations** — Dashboard, Agents, Chains, Cron
2. **Intelligence** — Chat, Omega, Knowledge, Cognitive
3. **Platform** — Pheromone, Fleet Learning, Inventor, Anomaly
4. **Analytics** — Audit, Cost, Adoption
5. **Integrations** — OpenClaw, Obsidian
6. **System** — Settings, Help

Icons from Lucide React. Mobile-responsive with hamburger menu.

### UI Components

All shadcn/ui components included:

- **Basic**: Button, Input, Label, Badge, Card, Separator
- **Layout**: Tabs, Dropdown Menu
- **Feedback**: Alert, Skeleton, Tooltip
- **Modals**: Dialog
- **Form**: Radio Group

Tailwind CSS 4 with custom color system (light + dark modes).

## Panels

Each panel follows the same pattern:

1. Fetch data via React Query (with refetch interval)
2. Show loading skeleton
3. Render error alert on failure
4. Display data in cards/list/chart

### Endpoints

```
/api/dashboard       → KPIs
/api/agents          → Agent list
/api/chains          → Chain history
/api/cron            → Cron jobs
/api/chat/messages   → Chat log
/api/monitor/sitrep  → Omega SITREP
/api/knowledge/search → Graph search
/api/cognitive/status → RLM status
/api/monitor/pheromone → Signal layer
/api/monitor/peer-eval → Fleet learning
/api/inventor/status → Inventor trials
/api/monitor/anomaly → Anomalies
/api/audit           → Audit log
/api/monitor/cost    → Cost breakdown
/api/adoption/matrix → Tool adoption
/api/openclaw/status → Gateway status
```

## Deployment

### Build & Deploy to Railway

```bash
npm run build
git add . && git commit -m "build: update frontend"
git push origin main
```

Railway auto-builds from Git. Output: `../frontend-v4/` (pre-committed, Railway runs directly).

## Notes

- **ESM only** — No `require()`, use `import/export`
- **TypeScript strict** — Full type safety
- **No secrets in code** — API key via form + secure cookie
- **Responsive design** — Mobile-first with sidebar toggle
- **Dark mode ready** — Tailwind dark: variant support
- **Production ready** — Optimized build, code splitting, caching

## License

Proprietary WidgeTDC
