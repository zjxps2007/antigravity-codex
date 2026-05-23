---
name: codex-setup
description: Fallback skill for explicit Codex setup checks. Prefer the /codex:setup slash command when commands are available.
---

# Codex Setup

Run the Antigravity Codex companion setup check and return its output verbatim.

Use local state only. Do not use WebSearch to investigate `antigravity-cli`, `hooks.json`, `/codex:setup`, or related plugin behavior.

For automatic review troubleshooting, verify:

1. `agy plugin list`
2. `$HOME/.gemini/antigravity-cli/import_manifest.json` includes `"hooks"` in the `codex` plugin components
3. `$HOME/.gemini/antigravity-cli/plugins/codex/hooks.json` contains `codex-stop-review-gate`
4. `<companion-script> setup --json` reports `reviewGate.enabled: true`
5. The current workspace is a git repository with uncommitted changes

If `hooks` is missing from the import manifest, reinstall with `agy plugin uninstall codex` and then `agy plugin install https://github.com/zjxps2007/antigravity-codex.git`.

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
