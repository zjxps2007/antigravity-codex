---
name: codex-rescue
description: Fallback skill for explicit Codex task delegation. Prefer the /codex:rescue slash command when commands are available.
---

# Codex Rescue

Delegate the user's task to Codex through the companion script.

Resolve `<companion-script>` as `dist/agy-codex.mjs` in this checkout, as the installed plugin path under `~/.gemini/antigravity-cli/plugins/codex/dist/agy-codex.mjs`, or as the older fallback path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/dist/agy-codex.mjs`.

Default behavior is read-only. Add `--write` only if the user asks Codex to modify files or fix code.

Supported arguments:

- `--background` queues the task and returns a job id.
- `--wait` runs inline.
- `--write` allows workspace writes.
- `--resume` resumes the latest Codex session.
- `--model <model>` selects a Codex model.
- `--effort minimal|low|medium|high|xhigh` sets reasoning effort.

Command:

```bash
node <companion-script> task $ARGUMENTS
```

Return Codex output verbatim when running inline.
