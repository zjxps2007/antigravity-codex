---
name: codex-rescue
description: Delegates an investigation or implementation task to Codex from Antigravity. Use when the user asks to hand work to Codex, rescue a failing task, investigate a bug, or try a fix with Codex.
---

# Codex Rescue

Delegate the user's task to Codex through the companion script.

Resolve `<companion-script>` as `scripts/agy-codex.mjs` in this checkout, or as the installed plugin path under `~/.gemini/antigravity-cli/plugins/antigravity-codex/scripts/agy-codex.mjs`.

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
