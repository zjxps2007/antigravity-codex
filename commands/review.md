---
description: Run a read-only Codex code review against local git state
argument-hint: '[--wait|--background] [--base <ref>|--commit <sha>] [--model <model>] [prompt]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Run a Codex review through the Antigravity companion.

Raw slash-command arguments: `$ARGUMENTS`

Core constraints:

- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Preserve the user's raw command arguments exactly.
- Return Codex output verbatim. Do not summarize or add commentary.

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
node "$SCRIPT" review "$ARGUMENTS"
```
