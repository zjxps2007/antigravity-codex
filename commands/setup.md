---
description: Check whether the local Codex CLI is ready for Antigravity
argument-hint: '[--json] [--enable-review-gate|--disable-review-gate]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(npx:*)
---

Run the Antigravity Codex companion setup check.

Raw slash-command arguments: `$ARGUMENTS`

Use only local checks for setup or review-gate troubleshooting. Do not use WebSearch for `antigravity-cli`, `hooks.json`, `/codex:setup`, or `codex-plugin-cc`; the local companion output and local Antigravity files are authoritative.

For automatic review troubleshooting, check these local facts:

1. `agy plugin list`
2. `$HOME/.gemini/antigravity-cli/import_manifest.json` includes `"hooks"` in the `codex` plugin components
3. `$HOME/.gemini/antigravity-cli/plugins/codex/hooks.json` contains `codex-stop-review-gate`
4. `$HOME/.gemini/config/hooks.json` contains the active `codex-stop-review-gate` Stop hook
5. `setup --json` reports `reviewGate.enabled: true` and `reviewGate.activeHookInstalled: true`
6. The current workspace is a git repository with uncommitted changes

Resolve the companion script in this order:

1. `$AGY_CODEX_PLUGIN_ROOT/hooks/bin/agy-codex.mjs`
2. `$AGY_CODEX_PLUGIN_ROOT/dist/agy-codex.mjs`
3. `hooks/bin/agy-codex.mjs` in the current workspace
4. `dist/agy-codex.mjs` in the current workspace
5. `$HOME/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs`
6. `$HOME/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs`

Run:

```bash
PLUGIN_ROOT="${AGY_CODEX_PLUGIN_ROOT:-${ANTIGRAVITY_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}}"
SCRIPT=""
if [ -n "$PLUGIN_ROOT" ]; then
  for CANDIDATE in "$PLUGIN_ROOT/hooks/bin/agy-codex.mjs" "$PLUGIN_ROOT/dist/agy-codex.mjs"; do
    if [ -f "$CANDIDATE" ]; then SCRIPT="$CANDIDATE"; break; fi
  done
fi
if [ -z "$SCRIPT" ]; then
  for CANDIDATE in "$(pwd)/hooks/bin/agy-codex.mjs" "$(pwd)/dist/agy-codex.mjs" "$HOME/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs" "$HOME/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs" "$HOME/.gemini/antigravity-cli/plugins/antigravity-codex/hooks/bin/agy-codex.mjs" "$HOME/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs"; do
    if [ -f "$CANDIDATE" ]; then SCRIPT="$CANDIDATE"; break; fi
  done
fi
if [ -n "$SCRIPT" ]; then
  node "$SCRIPT" setup "$ARGUMENTS"
else
  AGY_CODEX_PLUGIN_ROOT="$HOME/.gemini/antigravity-cli/plugins/codex" npx -y --package github:zjxps2007/antigravity-codex agy-codex setup "$ARGUMENTS"
fi
```

Return the command output verbatim.
