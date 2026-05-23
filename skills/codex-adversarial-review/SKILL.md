---
name: codex-adversarial-review
description: Fallback skill for explicit adversarial Codex reviews. Prefer the /codex:adversarial-review slash command when commands are available.
---

# Codex Adversarial Review

Run an adversarial read-only review through the companion script. This review must not edit files.

Resolve `<companion-script>` as `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Supported arguments:

- `--base <ref>` focuses on a branch comparison.
- `--model <model>` selects a Codex model.
- Any remaining text is treated as focus guidance.

Command:

```bash
node <companion-script> adversarial-review $ARGUMENTS
```

Use `--background` for broad or uncertain review scope.
