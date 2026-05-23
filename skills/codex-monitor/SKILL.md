---
name: codex-monitor
description: Fallback skill for starting, stopping, or checking the Codex review gate monitor. Prefer the /codex:monitor slash command when commands are available.
---

# Codex Monitor

Manage the review gate monitor through the companion script.

Use local state only. Do not use WebSearch to investigate Antigravity hook behavior.

Interpret monitor results as follows:

- `Review Gate Runs` are automatic Stop-hook reviews.
- `Codex Jobs` are explicit commands such as `/codex:review`, `/codex:task`, or `/codex:rescue`.
- If `Review Gate Runs` is empty and `events.jsonl` is missing, the Stop hook has not recorded an event yet.
- If `Codex Jobs` is populated but `Review Gate Runs` is empty, explicit commands ran but automatic Stop-hook review did not.

Resolve `<companion-script>` as `hooks/bin/agy-codex.mjs` or `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/hooks/bin/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Command:

```bash
node <companion-script> monitor $ARGUMENTS
```

Return the output verbatim.
