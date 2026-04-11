# MCP Compatibility Matrix

## LIN-750: Dual-Format Args Compatibility

**Status:** ✅ PASSED  
**Validated:** 2026-04-11  
**Test:** `test/dual-format-args.test.mjs`  
**CI Gate:** CHECK 6 in `scripts/ci-adoption-check.mjs`

### Normalization Rule

All tools in the WidgeTDC executor normalize arguments identically regardless of calling format:

```
if payload exists → use payload as MCP args
else → strip tool_name, use remaining keys as args
```

This ensures external agents (OpenAI function calling) and internal orchestrator callers get identical behavior.

### Compatibility Matrix

| Tool | Direct Flat Args | Payload Args | Nested Payload | Empty Payload |
|------|:---:|:---:|:---:|:---:|
| `chat_read` | ✅ pass | ✅ pass | — | — |
| `chat_send` | ✅ pass | ✅ pass | — | — |
| `graph.read_cypher` | ✅ pass | ✅ pass | — | — |
| `get_platform_health` | ✅ pass | ✅ pass | — | ✅ pass |
| `engagement_plan` | ✅ pass | ✅ pass | ✅ pass | — |

**Legend:**
- ✅ pass = formats normalize to identical internal args
- `—` = not applicable for this tool

### Test Coverage

```bash
node test/dual-format-args.test.mjs
# → 5/5 cases pass, all formats normalize to identical args
```

### CI Protection

Before any code can be merged, the CI adoption gate validates:
1. Registry ↔ executor parity (119/119 tools)
2. Dual-format args compatibility (5 test cases)
3. Build verification
4. LLM matrix drift check

**Run:** `node scripts/ci-adoption-check.mjs`

### Known Aliases

| Alias | Canonical Tool | Status |
|-------|---------------|--------|
| `system_health` | `get_platform_health` | ⚠️ deprecated (2026-04-11) |
| `system_service_status` | `get_platform_health` | ⚠️ deprecated (2026-04-11) |
| `system_metrics_summary` | `get_platform_health` | ⚠️ deprecated (2026-04-11) |

### Fix History

| Commit | Description | Impact |
|--------|-------------|--------|
| `f1482a1` | Dual-format normalization in `call_mcp_tool` | Fixed `UnrecognizedKwargsError: payload` for external agents |
| `5c5039d` | Regression test + CI gate integration | Prevents future regressions |

### Architecture Note

The dual-format support exists because:
- **Internal callers** (orchestrator chains, cron jobs) use `{tool_name, payload: {...}}`
- **External agents** (ChatGPT, Claude, etc. via OpenAI function calling) use `{tool_name, ...flatArgs}`

Both must produce identical MCP calls to the backend. The normalization happens in `src/tools/tool-executor.ts` case `call_mcp_tool`.
