---
name: codex-monitor
description: Fallback skill for starting, stopping, or checking the Codex review gate monitor. Prefer the /codex:monitor slash command when commands are available.
---

# Codex Monitor

Manage the review gate monitor through the companion script.

Resolve `<companion-script>` as `hooks/bin/agy-codex.mjs` or `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Command:

```bash
node <companion-script> monitor $ARGUMENTS
```

Return the output verbatim.
