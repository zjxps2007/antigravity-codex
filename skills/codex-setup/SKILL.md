---
name: codex-setup
description: Checks whether the local Codex CLI is installed and ready for the Antigravity Codex plugin. Use when the user runs codex setup, asks if Codex is configured, or needs installation diagnostics.
---

# Codex Setup

Run the Antigravity Codex companion setup check and return its output verbatim.

Resolve the companion script in this order:

1. If `AGY_CODEX_PLUGIN_ROOT` is set, use `$AGY_CODEX_PLUGIN_ROOT/dist/agy-codex.mjs`.
2. If the current workspace contains `dist/agy-codex.mjs`, use that.
3. Otherwise use the installed plugin path:
   - Windows: `%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-codex\dist\agy-codex.mjs`
   - macOS/Linux: `$HOME/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`

Command:

```bash
node <companion-script> setup
```
