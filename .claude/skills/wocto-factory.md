---
name: wocto:factory
description: Dark Factory — spec-in, software-out. Cross-repo proxy med mandatory adoption verification.
---
> Cross-repo proxy: Loads the full wocto:factory skill from WidgeTDC.

Load the full skill definition:
`Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\wocto-factory.md`

Then follow its instructions exactly. Pass through all arguments from the user.

## Mandatory Adoption Gate (Orchestrator-specific)

After ALL code generation, before declaring complete:

1. **Tool wiring**: If you created a new capability, verify it's in `tool-registry.ts` + `tool-executor.ts`
2. **Build gate**: `npm run build && node --check dist/index.js && npm run test:abi`
3. **Test gate**: Add at least one e2e test in `test-e2e.mjs` per new endpoint/tool
4. **Doc gate**: Add entry in `docs/TOOLS.md` if new tool created
5. **Score check**: Run `/wocto:adopt score` to verify no adoption regression
