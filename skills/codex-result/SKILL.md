---
name: codex-result
description: Fallback skill for explicit Codex job result retrieval. Prefer the /codex:result slash command when commands are available.
---

# Codex Result

Show the final stored job result through the companion script.

Resolve `<companion-script>` as `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Command:

```bash
node <companion-script> result $ARGUMENTS
```

Return the output verbatim.
