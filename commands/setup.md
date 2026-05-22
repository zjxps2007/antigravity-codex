---
description: Check whether the local Codex CLI is ready for Antigravity
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run the Antigravity Codex companion setup check.

Raw slash-command arguments: `$ARGUMENTS`

Resolve the companion script in this order:

1. `$AGY_CODEX_PLUGIN_ROOT/dist/agy-codex.mjs`
2. `$ANTIGRAVITY_PLUGIN_ROOT/dist/agy-codex.mjs`
3. `$CLAUDE_PLUGIN_ROOT/dist/agy-codex.mjs`
4. `dist/agy-codex.mjs` in the current workspace
5. `$HOME/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs`
6. `$HOME/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`

Run:

```bash
PLUGIN_ROOT="${AGY_CODEX_PLUGIN_ROOT:-${ANTIGRAVITY_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}}"
SCRIPT=""
if [ -n "$PLUGIN_ROOT" ] && [ -f "$PLUGIN_ROOT/dist/agy-codex.mjs" ]; then
  SCRIPT="$PLUGIN_ROOT/dist/agy-codex.mjs"
elif [ -f "dist/agy-codex.mjs" ]; then
  SCRIPT="$(pwd)/dist/agy-codex.mjs"
elif [ -f "$HOME/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs" ]; then
  SCRIPT="$HOME/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs"
elif [ -f "$HOME/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs" ]; then
  SCRIPT="$HOME/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs"
else
  echo "Could not find dist/agy-codex.mjs. Run agy plugin install . from the plugin checkout."
  exit 1
fi
node "$SCRIPT" setup "$ARGUMENTS"
```

Return the command output verbatim.
