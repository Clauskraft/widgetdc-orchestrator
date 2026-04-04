---
name: wocto:tdd
description: Test-Driven Development med WidgeTDC test conventions + adoption verification.
---
> Cross-repo proxy: Loads the full wocto:tdd skill from WidgeTDC.

Load the full skill definition:
`Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\wocto-tdd.md`

Then follow its instructions exactly. Pass through all arguments from the user.

## Mandatory Adoption Gate (Orchestrator-specific)

After TDD cycle completes (RED→GREEN→REFACTOR):

1. **ABI check**: `npm run test:abi` — verify 0 breaking changes
2. **E2E integration**: New tests must be in `test-e2e.mjs` (not a separate file)
3. **Test pattern**: Use exact error message assertions, NOT `includes('Error')`
4. **Deploy check**: If tests pass locally, verify they also pass against production
5. **Doc sync**: If new tools were created during TDD, add to `docs/TOOLS.md`
