---
name: codex-doctor
description: Fallback skill for diagnosing Codex plugin setup, Stop hooks, review gate events, and monitor visibility. Prefer the /codex:doctor slash command when commands are available.
---

# Codex Doctor

Run the Antigravity Codex local diagnostics and return the output verbatim.

Use local state only. Do not use WebSearch to investigate `antigravity-cli`, `hooks.json`, `/codex:setup`, `/codex:monitor`, or review-gate behavior. Check both the packaged plugin hook and the active runtime hook in `$HOME/.gemini/config/hooks.json`.

Resolve `<companion-script>` as `hooks/bin/agy-codex.mjs` or `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Command:

```bash
node <companion-script> doctor $ARGUMENTS
```

Use `--run-hook-test` when the user needs to distinguish between:

- Antigravity not invoking the Stop hook
- the hook command failing
- the monitor not reading recorded events

The hook smoke test uses bypass mode and does not invoke Codex.
