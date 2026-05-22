---
name: codex-adversarial-review
description: Runs a skeptical read-only Codex review that challenges design choices, tradeoffs, assumptions, and failure modes. Use when the user asks for adversarial review, pressure testing, risk review, or design critique.
---

# Codex Adversarial Review

Run an adversarial read-only review through the companion script. This review must not edit files.

Resolve `<companion-script>` as `scripts/agy-codex.mjs` in this checkout, or as the installed plugin path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/scripts/agy-codex.mjs`.

Supported arguments:

- `--base <ref>` focuses on a branch comparison.
- `--model <model>` selects a Codex model.
- Any remaining text is treated as focus guidance.

Command:

```bash
node <companion-script> adversarial-review $ARGUMENTS
```

Use `--background` for broad or uncertain review scope.
