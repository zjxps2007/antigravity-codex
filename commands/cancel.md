---
description: Cancel an active background Codex job
argument-hint: '[job-id] [--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(npx:*)
---

Cancel a Codex job through the Antigravity companion.

Raw slash-command arguments: `$ARGUMENTS`

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
  node "$SCRIPT" cancel "$ARGUMENTS"
else
  AGY_CODEX_PLUGIN_ROOT="$HOME/.gemini/antigravity-cli/plugins/codex" npx -y --package github:zjxps2007/antigravity-codex agy-codex cancel "$ARGUMENTS"
fi
```

Return the command output verbatim.
