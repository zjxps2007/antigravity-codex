---
name: codex-setup
description: Fallback skill for explicit Codex setup checks. Prefer the /codex:setup slash command when commands are available.
---

# Codex Setup

Run the Antigravity Codex companion setup check and return its output verbatim.

Resolve the companion script in this order:

1. If `AGY_CODEX_PLUGIN_ROOT` is set, use `$AGY_CODEX_PLUGIN_ROOT/hooks/bin/agy-codex.mjs`, then `$AGY_CODEX_PLUGIN_ROOT/dist/agy-codex.mjs`.
2. If the current workspace contains `hooks/bin/agy-codex.mjs`, use that, then `dist/agy-codex.mjs`.
3. Otherwise use the installed plugin path:
   - Windows: `%USERPROFILE%\.gemini\antigravity-cli\plugins\codex\hooks\bin\agy-codex.mjs`
   - macOS/Linux: `$HOME/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs`
4. For older local installs, fall back to:
   - Windows: `%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-codex\dist\agy-codex.mjs`
   - macOS/Linux: `$HOME/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`

Command:

```bash
node <companion-script> setup
```
