# WidgeTDC Command Center v4 - File Manifest

## Complete Source Tree

### Configuration Files (6)
- `package.json` - Dependencies (React 19, TanStack, shadcn/ui, Recharts)
- `vite.config.ts` - Vite build config with Router + React plugins
- `tsconfig.json` - TypeScript strict mode config
- `tailwind.config.ts` - Tailwind CSS 4 config
- `postcss.config.cjs` - PostCSS with tailwindcss + autoprefixer
- `index.html` - React root + meta tags

### Project Root (1)
- `.gitignore` - node_modules, dist, .vite, env

### Core App (4)
- `src/main.tsx` - React 19 createRoot, QueryClient, Router setup
- `src/index.css` - Tailwind directives + global styles
- `src/routeTree.gen.ts` - Auto-generated route tree (all 27 routes)
- `src/App.tsx` - (not needed - Router handles it)

### Libraries (2)
- `src/lib/api-client.ts` - Axios instance, Bearer auth, 401 interceptor
- `src/lib/utils.ts` - cn() helper for class merging

### Stores (1)
- `src/stores/auth-store.ts` - Zustand with localStorage + cookie persistence

### Layout Components (2)
- `src/components/layout/sidebar.tsx` - Responsive nav with mobile menu
- `src/components/layout/sidebar-data.ts` - 6 groups × 17 nav items

### UI Components (13)
- `src/components/ui/alert.tsx` - Destructive + default variants
- `src/components/ui/avatar.tsx` - Image + fallback
- `src/components/ui/badge.tsx` - Multiple variants
- `src/components/ui/button.tsx` - 6 variants × 4 sizes
- `src/components/ui/card.tsx` - Card + Header/Title/Description/Content/Footer
- `src/components/ui/dialog.tsx` - Modal with overlay
- `src/components/ui/dropdown-menu.tsx` - Radix menu with sub-menus
- `src/components/ui/input.tsx` - Text input
- `src/components/ui/label.tsx` - Form label
- `src/components/ui/radio-group.tsx` - Radio with Item indicator
- `src/components/ui/separator.tsx` - Horizontal/vertical divider
- `src/components/ui/skeleton.tsx` - Loading placeholder
- `src/components/ui/tabs.tsx` - Tabbed content
- `src/components/ui/tooltip.tsx` - Hover tooltips

### Routes (27 files)

**Root (1)**
- `src/routes/__root.tsx` - Root layout + dev tools

**Auth (1)**
- `src/routes/(auth)/sign-in.tsx` - Login with API key validation

**Protected Layout (1)**
- `src/routes/_authenticated.tsx` - Sidebar layout + auth guard

**Dashboard & Operations (5)**
- `src/routes/_authenticated/index.tsx` - Dashboard with KPI cards
- `src/routes/_authenticated/agents.tsx` - Agent card grid
- `src/routes/_authenticated/chains.tsx` - Chain execution list
- `src/routes/_authenticated/cron.tsx` - Cron job schedules
- `src/routes/_authenticated/chat.tsx` - Chat interface

**Intelligence (4)**
- `src/routes/_authenticated/omega.tsx` - Governance SITREP
- `src/routes/_authenticated/knowledge.tsx` - Graph search
- `src/routes/_authenticated/cognitive.tsx` - RLM status
- `src/routes/_authenticated/chat.tsx` - Chat (above)

**Platform (4)**
- `src/routes/_authenticated/pheromone.tsx` - Signal deposits
- `src/routes/_authenticated/fleet-learning.tsx` - Agent rankings
- `src/routes/_authenticated/inventor.tsx` - Evolution trials
- `src/routes/_authenticated/anomaly.tsx` - Anomaly detection

**Analytics (3)**
- `src/routes/_authenticated/audit.tsx` - Audit log
- `src/routes/_authenticated/cost.tsx` - Cost breakdown + chart
- `src/routes/_authenticated/adoption.tsx` - Tool adoption matrix

**Integrations (2)**
- `src/routes/_authenticated/openclaw.tsx` - Gateway status
- `src/routes/_authenticated/obsidian.tsx` - Vault connect (placeholder)

**Settings (6)**
- `src/routes/_authenticated/settings.tsx` - Settings tabs layout
- `src/routes/_authenticated/settings/account.tsx` - User account
- `src/routes/_authenticated/settings/appearance.tsx` - Theme selector
- `src/routes/_authenticated/settings/activity.tsx` - Activity log
- `src/routes/_authenticated/settings/integrations.tsx` - Service integrations
- `src/routes/_authenticated/settings/api-keys.tsx` - API key management

## Statistics

- **Total Files**: 56
- **TypeScript/TSX**: 51
- **JSON**: 1 (package.json)
- **HTML**: 1 (index.html)
- **CSS**: 1 (index.css)
- **Config**: 6 (vite, tsconfig, tailwind, postcss, gitignore, manifest)
- **Routes**: 27 (all with loading/error states)
- **UI Components**: 13 (all shadcn/ui wrapped)
- **Stores**: 1 (Zustand)
- **Libraries**: 2 (api-client, utils)

## Build Output

Builds to: `../frontend-v4/`

- Command: `npm run build`
- Output: Optimized JS bundles, CSS, index.html
- Pre-committed to Git
- Railway runs: `node dist/index.js`

## Ready to Build

All files created. To build:

```bash
cd cc-v4
npm install
npm run build
git add . && git commit -m "feat: complete cc-v4 source tree"
git push origin main  # Auto-deploys to Railway
```

## Feature Completeness

- [x] Auth flow (API key → localStorage + cookie)
- [x] Protected routes with beforeLoad guard
- [x] All 17 sidebar panels
- [x] Dashboard with 4 KPI cards
- [x] Chat interface
- [x] Settings with 5 sub-pages
- [x] Dark mode ready (Tailwind)
- [x] Mobile responsive (sidebar toggle)
- [x] API client with auth interceptors
- [x] React Query integration (10-30s refetch)
- [x] Error handling + loading states
- [x] Charts (Recharts on cost panel)
- [x] All UI components from shadcn/ui
- [x] Lucide icons throughout
- [x] ESM-only, no CommonJS

Ready for development!
