---
name: deploy-guardian
description: Deploy Guardian med adoption verification post-deploy.
---
> Cross-repo proxy: Loads the full deploy-guardian skill from WidgeTDC.

Load the full skill definition:
`Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\deploy-guardian.md`

Then follow its instructions exactly. Pass through all arguments from the user.

## Mandatory Adoption Gate (Post-Deploy)

After every `railway up` or auto-deploy:

1. **Health check**: `curl $ORCH_URL/health` — status healthy, correct version
2. **Tool count check**: `curl $ORCH_URL/api/tools | grep total` — must match local ABI count
3. **If mismatch**: Deploy is stale. Run `railway up --service orchestrator` manually.
4. **Smoke test**: `node test-e2e.mjs` against production — all tests green
5. **Version drift**: If `health.version` != `package.json.version` → hardcoded version bug
