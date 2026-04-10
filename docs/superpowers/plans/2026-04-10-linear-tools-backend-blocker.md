# Linear Tools Backend Blocker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock Linear Integration v2 deploy by adding 2 missing backend MCP tools (`linear.labels`, `linear.save_issue`) and fixing a naming mismatch for `linear_get_issue`.

**Architecture:** Backend `linearTools.ts` gets 2 new handlers using existing `linearService` methods. Orchestrator `tool-registry.ts` gets a 1-line fix to align `linear_get_issue` with the existing backend tool name `linear.issue_get`. `linear-proxy.ts` gets a 1-line fix to align the arg key.

**Tech Stack:** TypeScript, Express, Linear GraphQL API (via existing LinearService), esbuild bundler

---

## File Map

| File | Change |
|------|--------|
| `C:/Users/claus/Projetcs/WidgeTDC/apps/backend/src/mcp/tools/linearTools.ts` | Add `linearLabelsHandler` + `linearSaveIssueHandler`, register both, bump count 9→11 |
| `src/tools/tool-registry.ts` | Fix `linear_get_issue`: `backendTool: 'linear.get_issue'` → `'linear.issue_get'`, field `id` → `identifier` |
| `src/routes/linear-proxy.ts` | Fix GET /issue/:id: `args: { id: req.params.id }` → `args: { identifier: req.params.id }` |

---

## Task 1 — Add `linear.labels` handler to backend

**Files:**
- Modify: `C:/Users/claus/Projetcs/WidgeTDC/apps/backend/src/mcp/tools/linearTools.ts`

- [ ] **Step 1: Add handler after `linearCommentCreateHandler` (before registration block ~line 500)**

Add this function:

```typescript
async function linearLabelsHandler(
  payload: { team_key?: string; limit?: number },
  _ctx: unknown,
): Promise<unknown> {
  try {
    if (!linearService.isConfigured()) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    // Resolve team_key → teamId if provided
    let teamId: string | undefined;
    if (payload?.team_key) {
      const teams = await linearService.getTeams();
      const team = teams.find(t => t.key === payload.team_key);
      if (!team) return { success: false, error: `Team ${payload.team_key} not found` };
      teamId = team.id;
    }
    const labels = await linearService.listLabels(teamId);
    const limit = payload?.limit ?? 100;
    return {
      success: true,
      count: labels.length,
      labels: labels.slice(0, limit).map(l => ({
        id: l.id,
        name: l.name,
        color: l.color,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`linear.labels failed: ${msg}`);
    return { success: false, error: msg };
  }
}
```

- [ ] **Step 2: Add `linearSaveIssueHandler` immediately after linearLabelsHandler**

```typescript
async function linearSaveIssueHandler(
  payload: {
    id?: string;
    title?: string;
    description?: string;
    team?: string;
    priority?: number;
    labels?: string[];
    state?: string;
  },
  _ctx: unknown,
): Promise<unknown> {
  try {
    if (!linearService.isConfigured()) {
      return { success: false, error: 'LINEAR_API_KEY not configured' };
    }
    const { id, title, description, team, priority, labels, state } = payload ?? {};

    // ── Resolve label names → labelIds ──────────────────────────────
    let labelIds: string[] | undefined;
    if (labels?.length) {
      const allLabels = await linearService.listLabels();
      labelIds = labels
        .map(name => allLabels.find(l => l.name.toLowerCase() === name.toLowerCase())?.id)
        .filter((x): x is string => x !== undefined);
    }

    // ── UPDATE existing issue ────────────────────────────────────────
    if (id) {
      const issue = await linearService.getIssue(id);
      if (!issue) return { success: false, error: `Issue ${id} not found` };

      const input: Record<string, unknown> = {};
      if (title) input.title = title;
      if (description !== undefined) input.description = description;
      if (priority !== undefined) input.priority = priority;
      if (labelIds) input.labelIds = labelIds;

      // Resolve state name → stateId
      if (state) {
        const teams = await linearService.getTeams();
        if (teams[0]) {
          const states = await linearService.getTeamStates(teams[0].id);
          const match = states.find(s => s.name.toLowerCase() === state.toLowerCase());
          if (match) input.stateId = match.id;
        }
      }

      if (Object.keys(input).length === 0) {
        return { success: false, error: 'No fields to update' };
      }

      const updated = await linearService.updateIssue(issue.id, input);
      logger.info(`linear.save_issue updated: ${updated.identifier}`);
      return {
        success: true,
        action: 'updated',
        identifier: updated.identifier,
        title: updated.title,
        status: updated.state?.name,
        url: updated.url,
      };
    }

    // ── CREATE new issue ─────────────────────────────────────────────
    if (!title || title.length < 3) {
      return { success: false, error: 'title required for new issues (min 3 chars)' };
    }
    const teams = await linearService.getTeams();
    const resolvedTeam = team
      ? teams.find(t => t.key === team || t.name.toLowerCase().includes(team.toLowerCase()))
      : teams[0];
    if (!resolvedTeam) {
      return { success: false, error: `Team '${team ?? 'default'}' not found` };
    }

    const createInput: Parameters<typeof linearService.createIssue>[0] = {
      teamId: resolvedTeam.id,
      title,
      description,
      priority: priority ?? 0,
      labelIds,
    };

    // Resolve state for create
    if (state) {
      const states = await linearService.getTeamStates(resolvedTeam.id);
      const match = states.find(s => s.name.toLowerCase() === state.toLowerCase());
      if (match) createInput.stateId = match.id;
    }

    const created = await linearService.createIssue(createInput);
    logger.info(`linear.save_issue created: ${created.identifier} — ${title}`);
    return {
      success: true,
      action: 'created',
      identifier: created.identifier,
      title: created.title,
      status: created.state?.name,
      url: created.url,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`linear.save_issue failed: ${msg}`);
    return { success: false, error: msg };
  }
}
```

- [ ] **Step 3: Register both tools in `registerLinearTools()` — add before `return 9`**

Replace `return 9;` at end of function with:

```typescript
  registry.registerTool('linear.labels', {
    description: 'List available Linear labels for issue categorization. Returns id, name, color.',
    inputSchema: {
      type: 'object',
      properties: {
        team_key: { type: 'string', description: 'Filter labels by team key (e.g. LIN)' },
        limit: { type: 'number', description: 'Max results (default 100)' },
      },
    },
    handler: linearLabelsHandler,
  });

  registry.registerTool('linear.save_issue', {
    description: 'Create or update a Linear issue (upsert). If id is provided, updates; otherwise creates.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Issue identifier for update (e.g. LIN-5). Omit to create.' },
        title: { type: 'string', description: 'Issue title (required when creating, min 3 chars)' },
        description: { type: 'string', description: 'Issue description (markdown)' },
        team: { type: 'string', description: 'Team key or name (required when creating, default: first team)' },
        priority: { type: 'number', description: '0=none, 1=urgent, 2=high, 3=medium, 4=low' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names to apply' },
        state: { type: 'string', description: 'State name (e.g. In Progress, Done, Cancelled)' },
      },
    },
    handler: linearSaveIssueHandler,
  });

  return 11;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd C:/Users/claus/Projetcs/WidgeTDC
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -30
```

Expected: no errors related to linearTools.ts

- [ ] **Step 5: Commit backend**

```bash
cd C:/Users/claus/Projetcs/WidgeTDC
git add apps/backend/src/mcp/tools/linearTools.ts
git commit -m "feat: add linear.labels + linear.save_issue MCP tools

Adds two tools needed by widgetdc-orchestrator Linear proxy:
- linear.labels: list workspace labels via linearService.listLabels()
- linear.save_issue: upsert (create or update) with label/state resolution

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2 — Fix naming mismatch in orchestrator tool-registry

**Files:**
- Modify: `src/tools/tool-registry.ts` (orchestrator)

- [ ] **Step 1: Fix `linear_get_issue` tool definition**

Current (wrong):
```typescript
  defineTool({
    name: 'linear_get_issue',
    namespace: 'linear',
    description: 'Get a single Linear issue by ID or identifier. Returns full issue details with attachments, comments, and git branch name.',
    input: z.object({
      id: z.string().describe('Issue ID or identifier (e.g., LIN-493)'),
    }),
    backendTool: 'linear.get_issue',
    timeoutMs: 10000,
  }),
```

Replace with:
```typescript
  defineTool({
    name: 'linear_get_issue',
    namespace: 'linear',
    description: 'Get a single Linear issue by identifier (e.g. LIN-493). Returns full issue details.',
    input: z.object({
      identifier: z.string().describe('Issue identifier (e.g., LIN-493)'),
    }),
    backendTool: 'linear.issue_get',
    timeoutMs: 10000,
  }),
```

Two changes: `id` → `identifier`, `'linear.get_issue'` → `'linear.issue_get'`

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

---

## Task 3 — Fix linear-proxy.ts arg key mismatch

**Files:**
- Modify: `src/routes/linear-proxy.ts`

- [ ] **Step 1: Fix GET /issue/:id handler args**

Find in `linear-proxy.ts`:
```typescript
    const result = await callMcpTool({
      toolName: 'linear_get_issue',
      args: { id: req.params.id },
```

Replace with:
```typescript
    const result = await callMcpTool({
      toolName: 'linear_get_issue',
      args: { identifier: req.params.id },
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

---

## Task 4 — Build + commit orchestrator

**Files:**
- Build: `dist/` (committed artifact)

- [ ] **Step 1: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: `Build complete` with no errors

- [ ] **Step 2: Verify dist/index.js has new tools**

```bash
grep -c "linear_get_issue\|linear_labels\|linear_save_issue" dist/index.js
```

Expected: 3+ matches

- [ ] **Step 3: Commit all 3 orchestrator files + dist**

```bash
git add src/tools/tool-registry.ts src/routes/linear-proxy.ts src/mcp-caller.ts dist/
git commit -m "feat: Linear Integration v2 — labels, save_issue, get_issue tools + proxy

Adds 3 new Linear MCP tools to orchestrator + proxy route:
- linear_labels → linear.labels (backend)
- linear_save_issue → linear.save_issue (backend)
- linear_get_issue → linear.issue_get (existing, fix naming + input field)

Also fixes id→identifier arg key mismatch in linear-proxy.ts GET /issue/:id.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5 — Deploy + verify

- [ ] **Step 1: Deploy backend (WidgeTDC git push)**

```bash
cd C:/Users/claus/Projetcs/WidgeTDC
git push origin main
```

Wait for Railway deploy (~2 min).

- [ ] **Step 2: Deploy orchestrator**

```bash
cd C:/Users/claus/Projetcs/widgetdc-orchestrator
railway up -s orchestrator
```

- [ ] **Step 3: Smoke test — linear.labels**

```bash
curl -s -H "Authorization: Bearer Heravej_22" -H "Content-Type: application/json" \
  -d '{"tool":"linear.labels","payload":{"limit":5}}' \
  https://backend-production-d3da.up.railway.app/api/mcp/route
```

Expected: `{"success":true,"count":N,"labels":[...]}`

- [ ] **Step 4: Smoke test — linear.save_issue (read-only path: update non-existent)**

```bash
curl -s -H "Authorization: Bearer Heravej_22" -H "Content-Type: application/json" \
  -d '{"tool":"linear.save_issue","payload":{"id":"LIN-XXXXXX"}}' \
  https://backend-production-d3da.up.railway.app/api/mcp/route
```

Expected: `{"success":false,"error":"Issue LIN-XXXXXX not found"}` (not "Tool Not Found")

- [ ] **Step 5: Smoke test — orchestrator proxy endpoints**

```bash
# Labels
curl -s -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  https://orchestrator-production-c27e.up.railway.app/api/linear/labels

# Single issue (existing issue)
curl -s -H "Authorization: Bearer WidgeTDC_Orch_2026" \
  https://orchestrator-production-c27e.up.railway.app/api/linear/issue/LIN-387
```

Expected: JSON arrays/objects, no 502 errors.

---

## Self-Review

**Spec coverage:**
- `linear.labels` ✅ Task 1
- `linear.save_issue` ✅ Task 1
- naming mismatch fix ✅ Task 2
- args key fix ✅ Task 3
- build + commit ✅ Task 4
- deploy + verify ✅ Task 5

**No placeholders** — all handlers are complete with actual code.

**Type consistency:**
- `linearLabelsHandler` uses `linearService.listLabels()` which returns `LinearLabel[]` — ✅
- `linearSaveIssueHandler` uses `linearService.getIssue()`, `updateIssue()`, `createIssue()` — all typed ✅
- `identifier` field in tool-registry matches `identifier` in backend schema ✅
