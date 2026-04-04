---
name: wocto:debug
description: Systematisk debugging med intelligence stack + adoption verification.
---
> Cross-repo proxy: Loads the full wocto:debug skill from WidgeTDC.

Load the full skill definition:
`Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\wocto-debug.md`

Then follow its instructions exactly. Pass through all arguments from the user.

## Mandatory Adoption Gate (Orchestrator-specific)

After fix is applied:

1. **Build gate**: `npm run build && node --check dist/index.js`
2. **Regression check**: `npm run test:abi` — no tools removed or broken
3. **E2E check**: Run `node test-e2e.mjs` — all 102 tests must pass
4. **If fix changed tool behavior**: Update test assertion to match new behavior (exact messages)
5. **If fix changed API contract**: Update `docs/TOOLS.md`
