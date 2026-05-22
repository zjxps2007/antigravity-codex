---
name: codex-review
description: Fallback skill for explicit Codex code reviews. Prefer the /codex:review slash command when commands are available.
---

# Codex Review

Run a read-only Codex review through the companion script.

Resolve `<companion-script>` as `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

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
