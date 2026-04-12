# 🧪 WidgeTDC Command Center v4 — Comprehensive Frontend Test Plan

**Frontend:** `widgetdc-orchestrator/cc-v4/`  
**Stack:** React 19 · TanStack Router · TanStack Query · Zustand · Radix UI · Recharts · Tailwind · Vite 5  
**Pages:** 23 routes · 17 UI components · 3 utility files · **0 test files**  
**Date:** 2026-04-12

---

## 1. CURRENT STATE — Zero Test Coverage

| Category | Status | Count |
|----------|--------|-------|
| **Test files** | ❌ NONE | 0 |
| **E2E tests** | ❌ NONE | 0 |
| **Visual regression** | ❌ NONE | 0 |
| **Accessibility tests** | ❌ NONE | 0 |
| **CI pipeline** | ⚠️ Build only | `tsc && vite build` |
| **Linting** | ❌ NONE | No ESLint config |
| **Type-check in CI** | ⚠️ Yes | `tsc` part of build |
| **Bundle analysis** | ❌ NONE | No size budgets |
| **Performance budget** | ❌ NONE | No Lighthouse CI |

---

## 2. TEST STRATEGY — The Testing Trophy

```
         ┌─────────┐
         │  E2E    │  ← Critical user journeys (Playwright)
         ├─────────┤
         │  Visual │  ← Screenshot diffs (Playwright)
         ├─────────┤
    ┌────┤Integration├────┐
    │    ├─────────┤    │
    │    │ Component │  ← Unit tests for components (Vitest + Testing Library)
    │    ├─────────┤    │
    │    │   Hooks   │  ← Custom hook tests
    │    ├─────────┤    │
    │    │  Utils   │  ← Pure function tests
    │    └─────────┘    │
         ┌─────────┐
         │  Static │  ← TypeScript, ESLint, unused exports
         └─────────┘
```

### 2A. Static Analysis (First line of defense)
- **TypeScript strict mode** — already enabled ✅
- **ESLint** — `@tanstack/eslint-plugin-router`, `react-hooks`, `jsx-a11y`
- **Unused exports** — `ts-prune` or `knip`
- **Bundle size guard** — Vite bundle size budget

### 2B. Unit Tests — `*.test.ts` / `*.test.tsx` (Vitest)
- **Utils:** `api-client.ts`, `utils.ts`, `auth-store.ts`
- **Components:** All 17 UI components in `components/ui/`
- **Hooks:** Any custom hooks (currently none extracted)
- **Priority:** Test pure logic, error handling, edge cases

### 2C. Integration Tests — `*.integration.test.tsx` (Vitest + Testing Library)
- **Route rendering** — each of 23 pages renders with mocked data
- **API integration** — mock server, test data flow
- **State management** — Zustand store interactions
- **Data fetching** — TanStack Query error/loading/success states

### 2D. E2E Tests — `*.spec.ts` (Playwright)
- **Auth flow** — sign-in, token refresh, 401 redirect
- **Dashboard** — data loads, charts render, KPI cards update
- **Agents page** — search, filter, sort, expand/collapse
- **Settings** — form submissions, validation, persistence
- **Error boundaries** — API failure, offline, 500 states

### 2E. Visual Regression Tests — Playwright screenshot
- **All 23 pages** — baseline screenshots, diff on PR
- **Dark/light mode** — both themes tested
- **Responsive breakpoints** — mobile (375px), tablet (768px), desktop (1280px)

---

## 3. TEST PLAN — By Category

### Phase 1: Foundation (Week 1) — Infrastructure Setup

| # | Task | Est. Effort |
|---|------|-------------|
| 1.1 | Install Vitest + @testing-library/react + @testing-library/jest-dom | 30m |
| 1.2 | Configure `vite.config.ts` with vitest plugin | 30m |
| 1.3 | Install Playwright + configure for React | 1h |
| 1.4 | Set up test mocking (MSW — Mock Service Worker) | 2h |
| 1.5 | Create test setup files: `src/test/setup.ts`, mocks, fixtures | 2h |
| 1.6 | Add `npm test` and `npm test:e2e` scripts | 30m |
| 1.7 | Configure ESLint with `@tanstack/eslint-plugin-router`, `react-hooks`, `jsx-a11y` | 1h |
| 1.8 | Add pre-commit hook: type-check + lint + unit tests | 1h |

**Deliverable:** Full test infrastructure, CI pipeline runs all test tiers.

### Phase 2: Unit Tests (Week 2) — Core Logic

| # | File | Tests Needed | Key Scenarios |
|---|------|-------------|---------------|
| 2.1 | `lib/api-client.ts` | 8-10 | Init, auth interceptor, 401→redirect, retry logic, error normalization, offline detection |
| 2.2 | `stores/auth-store.ts` | 6-8 | Login, logout, token persist/reset, state transitions |
| 2.3 | `lib/utils.ts` | 4-6 | All pure functions, edge cases, invalid inputs |
| 2.4 | `components/ui/button.tsx` | 5-7 | Variants, sizes, disabled, loading state |
| 2.5 | `components/ui/card.tsx` | 3-4 | Composition, children rendering |
| 2.6 | `components/ui/input.tsx` | 5-6 | Controlled/uncontrolled, validation, disabled |
| 2.7 | `components/ui/badge.tsx` | 3-4 | All variants, icon support |
| 2.8 | `components/ui/dialog.tsx` | 5-6 | Open/close, ESC dismiss, focus trap, portal |
| 2.9 | `components/ui/dropdown-menu.tsx` | 5-6 | Keyboard nav, open/close, nested items |
| 2.10 | `components/ui/select.tsx` | 5-6 | Default value, change, disabled options |
| 2.11 | `components/ui/tabs.tsx` | 4-5 | Tab switching, lazy rendering, disabled tabs |
| 2.12 | `components/ui/tooltip.tsx` | 4-5 | Delay, positioning, accessibility labels |
| 2.13 | `components/ui/textarea.tsx` | 4-5 | Auto-resize, validation, char limit |
| 2.14 | `components/ui/skeleton.tsx` | 2-3 | Shape rendering, accessibility |
| 2.15 | `components/ui/alert.tsx` | 4-5 | Variants, icon, dismiss |
| 2.16 | `components/ui/avatar.tsx` | 3-4 | Image fallback, initials, size |
| 2.17 | `components/layout/sidebar.tsx` | 8-10 | Navigation, active state, collapse, keyboard nav |

**Target:** 90+ unit tests, >70% coverage on utils/stores, >50% on UI components.

### Phase 3: Integration Tests (Week 3) — Route-Level

| # | Route | Tests | Key Scenarios |
|---|-------|-------|---------------|
| 3.1 | `/` (Dashboard) | 6-8 | Data loading, chart rendering, KPI cards, refetch interval, empty state, error state |
| 3.2 | `/agents` | 8-10 | Table render, search filter, status filter, sort toggle, expand/collapse, empty state |
| 3.3 | `/chains` | 5-7 | Chain list, status badges, creation flow, error handling |
| 3.4 | `/chat` | 6-8 | Message send/receive, streaming, conversation history, error recovery |
| 3.5 | `/cognitive` | 4-6 | RLM query, response display, loading states |
| 3.6 | `/cron` | 4-6 | Job list, enable/disable toggle, next run display |
| 3.7 | `/knowledge` | 4-6 | Search, results display, pagination |
| 3.8 | `/observability` | 5-7 | Metrics charts, alert display, time range filter |
| 3.9 | `/settings/account` | 4-6 | Profile form, validation, save success/error |
| 3.10 | `/settings/api-keys` | 5-7 | Key list, create, revoke, confirm dialog |
| 3.11 | `/settings/integrations` | 4-6 | Toggle connections, status indicators |
| 3.12 | `/obsidian` | 4-6 | Note sync, vault status, import flow |
| 3.13 | `/sign-in` | 5-7 | Form validation, login success, 401 error, remember me |
| 3.14 | `/_authenticated` (guard) | 4-6 | Auth redirect, token check, route protection |

**Target:** 80+ integration tests, all routes covered with loading/error/empty/success states.

### Phase 4: E2E Tests (Week 4) — User Journeys

| # | Journey | Steps | Assertions |
|---|---------|-------|------------|
| 4.1 | **Full auth flow** | Visit → Redirect to sign-in → Enter creds → Dashboard loads | Redirect works, token stored, API calls succeed |
| 4.2 | **Dashboard monitoring** | Load dashboard → Verify KPIs → Wait for auto-refresh → Check chart updates | All 4 KPIs correct, charts render, refetch works |
| 4.3 | **Agent management** | Navigate to agents → Search → Filter by status → Sort → Expand details | All interactions work, data updates, URL state |
| 4.4 | **Settings management** | Go to settings → Change theme → Create API key → Revoke key | Form works, changes persist, confirm dialogs work |
| 4.5 | **Error recovery** | Simulate API 500 → Show error → Retry → Success → Normal UI | Error boundary works, retry succeeds |
| 4.6 | **Offline handling** | Simulate offline → Show offline banner → Restore connection → Auto-retry | Offline detection, recovery, data sync |
| 4.7 | **Navigation flow** | Navigate through all 23 routes → Verify each loads → Back button works | No 404s, no console errors, scroll restoration |
| 4.8 | **Chat interaction** | Open chat → Send message → See response → Scroll works → Error handling | Message appears, streaming works, errors handled |

**Target:** 8 E2E journeys, covering 90% of critical user flows.

### Phase 5: Visual Regression (Week 5) — Pixel-Perfect QA

| # | Page | Breakpoints | Themes | Screenshots |
|---|------|-------------|--------|-------------|
| 5.1 | Dashboard | 375/768/1280 | Light/Dark | 6 |
| 5.2 | Agents | 375/768/1280 | Light/Dark | 6 |
| 5.3 | Settings (all 5 sub-pages) | 768/1280 | Light/Dark | 20 |
| 5.4 | Chat | 768/1280 | Light/Dark | 4 |
| 5.5 | All remaining 18 pages | 1280 | Light | 18 |

**Total: ~54 baseline screenshots.** Every PR checks for visual diffs.

### Phase 6: Accessibility (Week 6) — WCAG 2.1 AA

| # | Check | Tool | Scope |
|---|-------|------|-------|
| 6.1 | Automated a11y audit | `axe-core` via Playwright | All 23 pages |
| 6.2 | Keyboard navigation | Manual + Playwright | All interactive elements |
| 6.3 | Screen reader testing | NVDA/VoiceOver | Critical flows (auth, forms, tables) |
| 6.4 | Color contrast | `axe-core` + manual | All text, badges, charts |
| 6.5 | Focus management | Playwright | Route transitions, dialogs, menus |
| 6.6 | ARIA attributes | axe-core + manual | All custom components |

**Target:** 0 critical a11y violations, 0 keyboard traps.

---

## 4. TARGET METRICS

| Metric | Current | Target (6 weeks) | World-Class |
|--------|---------|------------------|-------------|
| **Unit tests** | 0 | 90+ | 200+ |
| **Integration tests** | 0 | 80+ | 150+ |
| **E2E tests** | 0 | 8 journeys | 20+ journeys |
| **Visual baselines** | 0 | 54 | 100+ |
| **A11y violations** | Unknown | 0 critical | 0 total |
| **Lighthouse Performance** | Unknown | ≥90 | ≥95 |
| **Lighthouse Accessibility** | Unknown | ≥95 | 100 |
| **Lighthouse Best Practices** | Unknown | ≥90 | 100 |
| **Bundle size (gzip)** | 1.5 MB | ≤800 KB | ≤500 KB |
| **First Contentful Paint** | Unknown | ≤1.5s | ≤0.8s |
| **Largest Contentful Paint** | Unknown | ≤2.5s | ≤1.2s |
| **Time to Interactive** | Unknown | ≤3.5s | ≤2.0s |
| **CI duration** | ~2 min | ≤5 min (all tests) | ≤3 min |

---

## 5. IMPLEMENTATION ORDER (Priority)

1. **Week 1:** Infrastructure — without this, nothing else works
2. **Week 2:** Unit tests — fast feedback, catch regressions early
3. **Week 3:** Integration tests — route-level confidence
4. **Week 4:** E2E tests — end-to-end user journey protection
5. **Week 5:** Visual regression — catch UI breakages before they ship
6. **Week 6:** Accessibility + performance — world-class quality

---

## 6. RISKS & MITIGATIONS

| Risk | Impact | Mitigation |
|------|--------|------------|
| MSW mocking doesn't match real API | Tests pass, prod fails | Contract testing between frontend + backend |
| Recharts testing is flaky | Unstable tests | Mock chart rendering, test data transforms only |
| Playwright auth flow complex | Slow test setup | Shared auth fixture, session reuse |
| TanStack Router file-based routing | Test path resolution | Test compiled route tree, not file paths |
| Zustand singleton state leaks | Tests interfere | Reset store between tests |

---

## 7. TOOLING STACK

| Tool | Purpose | Version |
|------|---------|---------|
| **Vitest** | Unit + Integration test runner | Latest |
| **@testing-library/react** | Component testing | ^16.x |
| **@testing-library/jest-dom** | DOM matchers | Latest |
| **MSW** | API mocking | ^2.x |
| **Playwright** | E2E + Visual regression | ^1.48 |
| **axe-core** | Accessibility testing | ^5.x |
| **eslint-plugin-jsx-a11y** | Static a11y checks | Latest |
| **knip** | Dead code detection | Latest |
| **happy-dom** | Fast DOM for Vitest | Latest |
| **@vitejs/plugin-react** | Vite React plugin | ^4.7 |
| **c8** | Coverage reporting | Latest |
