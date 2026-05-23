---
description: Run a read-only Codex code review against local git state
argument-hint: '[--wait|--background] [--base <ref>|--commit <sha>] [--model <model>]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(git:*)
---

Run a Codex review through the Antigravity companion.

Raw slash-command arguments: `$ARGUMENTS`

Core constraints:

- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Do not pass custom focus text to this command. Use `/codex:adversarial-review` for focused review instructions.
- Preserve the user's raw command arguments exactly.
- Return Codex output verbatim. Do not summarize or add commentary.

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
if [ -z "$SCRIPT" ]; then
  echo "Could not find agy-codex.mjs. Run agy plugin install . from the plugin checkout."
  exit 1
fi
node "$SCRIPT" review "$ARGUMENTS"
```
