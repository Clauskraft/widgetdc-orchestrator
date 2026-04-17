# OWUI Live Audit — 2026-04-17

Verified against `https://open-webui-production-25cb.up.railway.app` via authenticated admin session on 2026-04-17.

## Live Summary

- Branding: `WidgeTDC Intelligence (Open WebUI)`
- Open WebUI version: `0.8.12`
- Default model: `widgetdc-neural`
- Deployed tools: `15`
- Tool drift: `false`
- Experimental deployed tools: `exp_wdc_intelligence`
- Registered admin pipelines: `0`

## Verified Admin Settings

- `ENABLE_SIGNUP=false`
- `DEFAULT_USER_ROLE=user`
- `ENABLE_API_KEYS=false`
- `ENABLE_COMMUNITY_SHARING=false`
- `ENABLE_CHANNELS=false`
- `ENABLE_MEMORIES=true`
- `ENABLE_NOTES=true`
- `ENABLE_ADMIN_EXPORT=true`
- `ENABLE_WEB_SEARCH=false`
- `ENABLE_IMAGE_GENERATION=false`
- `ENABLE_CODE_EXECUTION=true`

## Verified Prompt Suggestions

The live `default_prompt_suggestions` are:

1. `Strategisk Analyse` / `Dyb analyse med frameworks`
2. `Compliance Check` / `NIS2/GDPR gap-analyse`
3. `Graph intelligence` / `Domæner og KPIs`
4. `Sprint Status` / `Linear blockers`
5. `Platform Health` / `Service status`
6. `Deep Investigation` / `Multi-agent analyse`

## Verified Active Functions / Filters

- `wdc_verbatim_enforcer` — active, global
- `wdc_citation_enforcer` — active, global
- `wdc_graph_context` — active
- `wdc_sitrep_action` — active
- `wdc_auto_execute` — active

## Verified Live Note

Current production behavior is driven by tools plus functions/filters.
The admin pipeline registry currently returns an empty list, so production should
be treated as tool-and-function based unless a dedicated pipeline deployment step
is introduced later.
