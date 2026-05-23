---
name: codex-cancel
description: Fallback skill for explicit Codex job cancellation. Prefer the /codex:cancel slash command when commands are available.
---

# Codex Cancel

Cancel a background Codex job through the companion script.

Resolve `<companion-script>` as `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Command:

```bash
node <companion-script> cancel $ARGUMENTS
```

Return the output verbatim.
