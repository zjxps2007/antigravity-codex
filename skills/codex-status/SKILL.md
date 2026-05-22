---
name: codex-status
description: Fallback skill for explicit Codex job status checks. Prefer the /codex:status slash command when commands are available.
---

# Codex Status

Show job status through the companion script.

Resolve `<companion-script>` as `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Command:

```bash
node <companion-script> status $ARGUMENTS
```

Return the output verbatim.
