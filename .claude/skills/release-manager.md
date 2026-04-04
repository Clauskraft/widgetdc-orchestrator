---
name: release-manager
description: World-class multi-repo release manager med mandatory adoption verification pre-release.
---
> Cross-repo proxy: Loads the full release-manager skill from WidgeTDC.

Load the full skill definition:
`Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\release-manager.md`

Then follow its instructions exactly. Pass through all arguments from the user.

## Mandatory Adoption Gate (Pre-Release)

Before ANY version tag:

1. **Build**: `npm run build && node --check dist/index.js`
2. **ABI**: `npm run test:abi` — 0 breaking (or documented in changelog)
3. **E2E**: `node test-e2e.mjs` — 102/102 green
4. **Production tool count**: `curl $ORCH_URL/api/tools | grep total` must match ABI count
5. **Version sync**: `package.json` version == `index.ts` health endpoint version
6. **Docs current**: `docs/TOOLS.md` lists all tools in registry
7. **Adoption matrix**: `docs/ADOPTION_MATRIX_v3.0_FINAL.md` reflects current state (or delete if stale)

If ANY gate fails → fix before tagging. Never release with known adoption gaps.
