---
name: qa-guardian
description: QA Guardian med adoption-aware test coverage verification.
---
> Cross-repo proxy: Loads the full qa-guardian skill from WidgeTDC.

Load the full skill definition:
`Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\qa-guardian.md`

Then follow its instructions exactly. Pass through all arguments from the user.

## Mandatory Adoption Gate (QA)

During any QA pass:

1. **Tool coverage**: Every tool in `tool-registry.ts` must have ≥1 test in `test-e2e.mjs`
2. **Test quality**: Assertions must be exact (not `includes('Error')` — use exact error messages)
3. **ABI regression**: `npm run test:abi` must show 0 breaking changes
4. **Docs coverage**: Every tool must have an entry in `docs/TOOLS.md`
5. **Production parity**: Run e2e against production, not just local
6. **Count check**: `grep -c "await test(" test-e2e.mjs` must be ≥ tool count in registry
