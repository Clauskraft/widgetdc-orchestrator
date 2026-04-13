# Obsidian Max Integration Blueprint

**Date:** 2026-04-13  
**Target:** `src/routes/obsidian.ts`, `cc-v4/src/routes/_authenticated/obsidian.tsx`, future Obsidian plugin repo  
**Goal:** Upgrade the Obsidian integration from read/search proxy to a first-class deep-work surface for WidgeTDC.

---

## 1. Current State

The current integration is already better than zero:

- backend exposes `GET /api/obsidian/status|vault/stats|vault/list|search|note|tags`
- it supports **two modes**
  - live mode via Obsidian Local REST API
  - GitHub vault fallback for read access
- `cc-v4` has an Obsidian panel for status, search, tags, explorer, and note preview

This is useful, but still underpowered.

It is mostly a **vault browser**.
It is not yet a **knowledge workbench**.

---

## 2. Internal Findings

### What already exists

- [src/routes/obsidian.ts](/C:/Users/claus/Projetcs/widgetdc-orchestrator/src/routes/obsidian.ts:1) already provides dual-mode access:
  - live via `OBSIDIAN_API_URL` + `OBSIDIAN_API_TOKEN`
  - GitHub fallback via `GITHUB_TOKEN` / `OBSIDIAN_GITHUB_REPO`
- [cc-v4/src/routes/_authenticated/obsidian.tsx](/C:/Users/claus/Projetcs/widgetdc-orchestrator/cc-v4/src/routes/_authenticated/obsidian.tsx:1) already renders status, vault stats, search, tags, explorer, and note viewer
- [docs/OWUI_FACADE_SPEC.md](/C:/Users/claus/Projetcs/widgetdc-orchestrator/docs/OWUI_FACADE_SPEC.md:122) already envisions `widgetdc_obsidian_bridge` as a knowledge gateway with `search|read|write|briefing`
- [docs/ADOPTION-BLUEPRINT-ARCHITECTURE.md](/C:/Users/claus/Projetcs/widgetdc-orchestrator/docs/ADOPTION-BLUEPRINT-ARCHITECTURE.md:459) already assumes Obsidian plugin + Railway HTTPS + git-synced vault
- [src/chain/investigate-chain.ts](/C:/Users/claus/Projetcs/widgetdc-orchestrator/src/chain/investigate-chain.ts:202) already emits `obsidian://` links

### What is missing

- no write flows in the current backend route
- no command surface back into Obsidian
- no artifact materialization to vault
- no use of note properties as structured control plane
- no `.canvas` or `.base` generation
- no operator-quality “send to Obsidian” from V1/V4/V7 outputs

---

## 3. External Patterns

### Pattern A — URI bridge for cross-app workflows

Obsidian’s official URI protocol supports `open`, `new`, `daily`, `unique`, and `search`, with support for encoded file paths, headings, block targets, append/prepend, and `x-success` callbacks. That makes it strong for **deep-linking**, **note creation**, and **cross-app handoff**, but weak as a high-bandwidth automation surface on its own.  
Source: [Obsidian URI](https://obsidian.md/help/uri)

### Pattern B — Local REST API for precise automation

The Local REST API plugin supports full CRUD, targeted writes to headings/blocks/frontmatter, full-text search, command listing/execution, and API extension routes. This is the strongest pattern for **surgical note updates**, **structured sync**, and **plugin-side extension without reinventing transport**.  
Source: [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)

### Pattern C — Plugin-native vault operations

Official Obsidian plugin docs emphasize using the `Vault` API for read/write and especially `Vault.process()` to avoid race conditions and stale writes. This is the right pattern when you build your own plugin rather than depending entirely on external REST automation.  
Source: [Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin), [Vault API](https://docs.obsidian.md/Plugins/Vault)

### Pattern D — Properties as structured metadata plane

Obsidian Properties are typed frontmatter fields and can be searched, templated, and reused consistently across notes. This is the cleanest way to turn notes into structured WidgeTDC artifacts instead of raw markdown blobs.  
Source: [Properties](https://help.obsidian.md/properties)

### Pattern E — Bases as database-like operational views

Bases lets notes act like rows with views over properties. This is ideal for engagement registries, deliverables, investigations, and knowledge queues.  
Source: [Bases](https://obsidian.md/help/bases)

### Pattern F — Canvas / JSON Canvas as visual workbench

Obsidian Canvas stores data as `.canvas` files using the open JSON Canvas format, and JSON Canvas is designed for longevity, interoperability, and extensibility. This makes it a strong target for investigation graphs, research boards, and deliverable maps.  
Sources: [Canvas](https://obsidian.md/help/plugins/canvas), [JSON Canvas](https://github.com/obsidianmd/jsoncanvas)

### Pattern G — Web capture as durable markdown ingestion

The official Obsidian Web Clipper uses templates, variables, filters, and highlighting, and stores output as durable local markdown. This is the right model for “capture first, enrich later” ingestion into WidgeTDC knowledge loops.  
Sources: [Web Clipper intro](https://obsidian.md/help/web-clipper), [obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper)

### Pattern H — Git as vault durability, not active collaboration plane

Obsidian Git is strong for automatic commit-and-sync, history, diffs, and file recovery, but its own maintainers explicitly warn that mobile use is unstable and resource-constrained. This makes Git a strong **durability/backup plane**, but a weaker **live integration plane**, especially on mobile.  
Source: [obsidian-git](https://github.com/Vinzent03/obsidian-git)

---

## 4. Strategic Conclusion

The strongest WidgeTDC Obsidian integration is **not** one thing.

It is a **4-layer model**:

1. **URI layer**
   - for deep links, open note, create note, open canvas, jump to heading/block

2. **REST layer**
   - for search, read, targeted write, command execution, status, tagging

3. **Plugin layer**
   - for local UX, command palette actions, status bar, ribbon, context actions, rich embedding

4. **Git layer**
   - for durability, backup, history, and async sync

Your current implementation only meaningfully covers layer 2, and partially layer 4.

That is why it feels limited.

---

## 5. Best Target Architecture

### 5.1 Recommendation

Move from **Obsidian as data source** to **Obsidian as deep-work delivery surface**.

### 5.2 Canonical model

- Railway/orchestrator stays canonical control plane
- Obsidian becomes the operator’s **local thinking surface**
- GitHub vault fallback remains read-safe backup path
- Local REST API becomes the preferred write/search automation path
- a small WidgeTDC Obsidian plugin becomes the UX/control layer

### 5.3 Separation of concerns

- **Command Center / cc-v4**
  - best for monitoring, routing, approvals, proof flows
- **Obsidian**
  - best for investigation, synthesis, artifact drafting, note-linked deep work

This is complementary, not competitive.

---

## 6. Highest-Leverage Improvements

### P0 — Add write capability now

Extend [src/routes/obsidian.ts](/C:/Users/claus/Projetcs/widgetdc-orchestrator/src/routes/obsidian.ts:1) with:

- `POST /api/obsidian/note`
- `PATCH /api/obsidian/note`
- `POST /api/obsidian/daily`
- `POST /api/obsidian/open`

Why:

- Local REST API already supports targeted updates to heading/block/frontmatter.
- This unlocks artifact materialization, not just browsing.

### P0 — Materialize WidgeTDC outputs as notes

Add one canonical endpoint:

- `POST /api/obsidian/materialize`

Input:

- `kind`: `deliverable|audit|investigation|briefing|search_result`
- `title`
- `folder`
- `properties`
- `content_markdown`
- optional `open_after_write`

Why:

- V1 and V4 outputs should become durable notes with structured metadata.
- This gives immediate operator value without waiting for a full plugin.

### P0 — Standardize frontmatter schema

Every materialized WidgeTDC note should use Properties/frontmatter:

```yaml
---
widgetdc_kind: deliverable
widgetdc_id: deliv_123
client: NordicFin
engagement_id: eng_456
source_tool: deliverable_draft
status: draft
confidence: medium
citations_count: 4
generated_at: 2026-04-13T20:15:00Z
---
```

Why:

- Enables Bases views
- Enables search and dashboards
- Avoids unstructured note sprawl

### P1 — Generate `.base` files

Generate ready-made Bases for:

- Deliverables
- Compliance audits
- Investigations
- Daily briefings

Why:

- Turns the vault into an operational workspace instead of a pile of notes
- Uses Obsidian’s own database-like view model instead of custom UI for everything

### P1 — Generate `.canvas` files

Generate JSON Canvas boards for:

- investigation chains
- client landscapes
- architecture/impact maps
- source clusters around a deliverable

Why:

- Obsidian Canvas is already a native visual deep-work surface
- JSON Canvas is open and easy to generate

### P1 — Build a minimal Obsidian plugin

Best first plugin features:

- ribbon action: `Open WidgeTDC panel`
- command palette:
  - `WidgeTDC: Investigate topic`
  - `WidgeTDC: Send current note to orchestrator`
  - `WidgeTDC: Materialize latest deliverable`
  - `WidgeTDC: Refresh daily briefing`
- status bar:
  - connection state
  - last sync time
- context menu on selected text:
  - `Analyze with WidgeTDC`
  - `Create compliance note`
  - `Create research artifact`

Why:

- This is where Obsidian becomes a first-class surface, not just a vault backend.

### P1 — Add command execution bridge

The Local REST API can list and execute commands.

Use that to:

- open side panes
- trigger WidgeTDC plugin commands
- refresh generated views
- open current artifact after materialization

Why:

- Better UX than only returning URLs

### P2 — Web Clipper integration

Offer export-ready clipper templates for:

- competitor capture
- regulation/article capture
- client source capture
- market signal capture

Why:

- Turns Obsidian into a structured intake surface for Phantom/knowledge ingestion

### P2 — Git as async durability plane

Keep Git/GitHub mode, but reposition it:

- backup
- offline read
- history
- disaster recovery

Do **not** treat Git mode as the primary live interaction mode.

Why:

- It is too weak for high-quality writes and too unstable for mobile-first live workflows.

---

## 7. Best Product Shape

The strongest product shape is:

### “Obsidian Deep Work, WidgeTDC Control Plane”

In practice:

- start work in `cc-v4`
- launch investigation / audit / draft
- materialize into Obsidian note, base, or canvas
- continue synthesis inside Obsidian
- push structured output back to orchestrator when needed

That is much stronger than trying to copy Obsidian inside `cc-v4`.

---

## 8. Concrete Recommendation for This Repo

### Build now

1. Write support in `src/routes/obsidian.ts`
2. `materialize` endpoint for markdown artifacts
3. frontmatter/property schema for WidgeTDC notes
4. `cc-v4` Obsidian page upgrade:
   - add “send V1 audit to vault”
   - add “send V4 draft to vault”
   - add note creation target folder + mode

### Build next

5. `.base` generation for deliverables and audits
6. `.canvas` generation for investigations
7. small Obsidian plugin with command palette and context actions

### Defer

8. full bidirectional live notebook execution
9. aggressive mobile-first Git workflows
10. broad plugin ecosystem ambitions before the core bridge is excellent

---

## 9. Biggest Upsides

- Obsidian becomes a genuine delivery/workbench surface
- V1/V4 outputs gain durable local landing zones
- structured metadata makes notes queryable and operational
- Canvas gives you native visual investigation boards
- Bases gives you local “database views” without extra frontend work
- plugin commands create much better UX than raw links alone
- Git fallback still gives resilience and portability

---

## 10. Biggest Risks

- tunnel/live mode creates auth and operational complexity
- write support without frontmatter discipline creates vault entropy
- GitHub mode can give a false sense of “integration complete” while staying read-only
- mobile Git workflows are fragile
- plugin work can sprawl if started before materialization/base/canvas are stable

---

## 11. Final Recommendation

Maximal improvement does **not** mean “more endpoints”.

It means:

- keep GitHub fallback
- deepen Local REST usage
- add structured note materialization
- generate Bases and Canvas artifacts
- then add a thin WidgeTDC plugin on top

That is the strongest possible Obsidian integration for this platform.
