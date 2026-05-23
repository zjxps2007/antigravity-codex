---
description: Check whether the local Codex CLI is ready for Antigravity
argument-hint: '[--json] [--enable-review-gate|--disable-review-gate]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(npx:*)
---

Run the Antigravity Codex companion setup check.

Raw slash-command arguments: `$ARGUMENTS`

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
