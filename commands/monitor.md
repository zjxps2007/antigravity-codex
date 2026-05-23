---
description: Start, stop, or inspect the Codex review gate monitor
argument-hint: '[--status|--stop|--clear|--foreground] [--port <port>] [--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(npx:*)
---

Manage the local Codex review gate monitor.

Raw slash-command arguments: `$ARGUMENTS`

Use only local monitor state for troubleshooting. Do not use WebSearch for Antigravity hook behavior. The monitor reads local review-gate events and local Codex job state.

Interpret the UI as follows:

- `Review Gate Runs` are automatic Stop-hook reviews.
- `Codex Jobs` are explicit commands such as `/codex:review`, `/codex:task`, or `/codex:rescue`.
- If `Review Gate Runs` is empty and `events.jsonl` is missing, the Stop hook has not recorded an event yet.
- If `Codex Jobs` is populated but `Review Gate Runs` is empty, explicit commands ran but automatic Stop-hook review did not.

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
  node "$SCRIPT" monitor "$ARGUMENTS"
else
  AGY_CODEX_PLUGIN_ROOT="$HOME/.gemini/antigravity-cli/plugins/codex" npx -y --package github:zjxps2007/antigravity-codex agy-codex monitor "$ARGUMENTS"
fi
```

Return the command output verbatim.
