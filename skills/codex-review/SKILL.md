---
name: codex-review
description: Runs a read-only Codex code review against the current git workspace. Use when the user asks for a Codex review, code review, PR review, or second-opinion review.
---

# Codex Review

Run a read-only Codex review through the companion script.

Resolve `<companion-script>` as `dist/agy-codex.mjs` in this checkout, or as the installed plugin path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Use `--background` for anything larger than a tiny change. Use `--wait` only when the user explicitly asks to wait or the diff is clearly small.

Supported arguments:

- `--base <ref>` reviews the current branch against a base ref.
- `--commit <sha>` reviews one commit.
- `--model <model>` selects a Codex model.
- Any remaining text is passed as custom review guidance.

Command:

```bash
node <companion-script> review $ARGUMENTS
```

After a background launch, tell the user to check:

```bash
node <companion-script> status
```
