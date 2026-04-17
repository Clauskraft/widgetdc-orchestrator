# Deploy Verification

Post-deploy verification in this repo follows three rules:

1. Wait for service readiness with a polling loop.
2. Verify the exact surface that changed.
3. Run broader full-stack probes only after the targeted probe passes.

## Environment

The verifier reads credentials from environment variables only:

```bash
export BACKEND_API_KEY=...
export BACKEND_URL=https://backend-production-d3da.up.railway.app
export ORCHESTRATOR_URL=https://orchestrator-production-c27e.up.railway.app
```

Do not put credentials directly in the command line.

For local runs, `scripts/verify_deploy_stack.py` also loads missing values from the repo-root `.env` file.
Existing shell env vars still take precedence.

## Targeted Verification

For orchestrator deploys, run:

```bash
python scripts/verify_deploy_stack.py --service orchestrator --mode targeted
```

This waits for `/health` to report `ok` or `healthy`, then runs the exact OpenAI-compatible route probe:

- `POST /v1/chat/completions`
- model: `widgetdc-neural`
- deterministic platform health query
- response must contain the deterministic health structure, not just HTTP `200`

## Full-Stack Verification

For a broader stack check, run:

```bash
python scripts/verify_deploy_stack.py --service backend --mode full-stack --json
```

Default read-only probes:

- `srag.query`
- `intent_detect`
- `reason_deeply`
- `context_fold`
- `recommend_skill_loop`
- `llm.generate`

The verifier rejects probes that only return HTTP `200` with empty or fallback-like payloads.
It fails on error envelopes, timeout/failure markers, and missing deterministic markers for the targeted health probe.

Optional write probe:

```bash
python scripts/verify_deploy_stack.py --service backend --mode full-stack --include-write-probes
```

This adds:

- `knowledge_normalize`

Use the write probe only when you explicitly want to verify the normalization bus.

## CI Integration

The GitHub workflows now use the verifier instead of fixed sleeps:

- `.github/workflows/deploy-to-railway.yml`
- `.github/workflows/agent-delivery-follow-up.yml`

They use a readiness loop plus the Python verifier with secrets-backed env vars.
