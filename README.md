# Antigravity Codex

한국어 문서: [README.ko.md](README.ko.md)

Antigravity Codex is an Antigravity plugin that connects Antigravity with the local OpenAI Codex CLI. It provides explicit `/codex:*` commands for review and task delegation, plus an optional review gate where Antigravity implements changes and Codex reviews them before Antigravity stops.

## What It Does

- Runs read-only Codex reviews from Antigravity.
- Delegates engineering tasks to Codex through explicit commands.
- Adds an optional Stop-hook review gate:
  - Antigravity writes code.
  - Antigravity reaches a stop point.
  - Codex reviews the current git changes in read-only mode.
  - `approve` lets Antigravity stop.
  - `needs-attention` returns `continue`, so Antigravity keeps fixing the findings.
- Provides a local monitor UI for review-gate runs at `http://127.0.0.1:8765`.

## Requirements

- Antigravity CLI with plugin support
- Node.js 18.18 or newer
- OpenAI Codex CLI installed and authenticated

```bash
npm install -g @openai/codex
codex login
```

## Install

Install directly from GitHub:

```bash
agy plugin install https://github.com/zjxps2007/antigravity-codex.git
```

For a clean update, reinstall the plugin:

```bash
agy plugin uninstall codex
agy plugin install https://github.com/zjxps2007/antigravity-codex.git
```

Check setup:

```text
/codex:setup
```

Enable the automatic review gate for the current workspace:

```text
/codex:setup --enable-review-gate
```

Disable it later:

```text
/codex:setup --disable-review-gate
```

## Daily Use

Use slash commands as the primary interface.

```text
/codex:setup
/codex:setup --enable-review-gate
/codex:review
/codex:review --background
/codex:review --base main
/codex:adversarial-review --base main "focus on auth boundaries"
/codex:rescue --write "fix the failing test"
/codex:status
/codex:result
/codex:cancel
/codex:doctor
/codex:doctor --run-hook-test
/codex:monitor
/codex:monitor --status
/codex:monitor --stop
/codex:monitor --clear
```

Notes:

- Commands are explicit command routes. The command files use `disable-model-invocation: true`, so normal natural-language prompts are not routed into Codex automatically.
- `/codex:review` is read-only. It reviews current uncommitted changes by default.
- `/codex:review --base <ref>` reviews the diff against a base ref.
- `/codex:review` does not accept custom focus text. Use `/codex:adversarial-review` for focused or skeptical review instructions.
- `review`, `adversarial-review`, `rescue`, and `task` support `--background`.

## Review Gate

The review gate is the main Antigravity-to-Codex workflow:

```text
Antigravity implements
-> Antigravity tries to stop
-> Stop hook runs Codex read-only review
-> approve + allow: stop is allowed
-> needs-attention + continue: Antigravity keeps fixing
```

`/codex:setup --enable-review-gate` updates the workspace config and installs the active Stop hook into:

```text
~/.gemini/config/hooks.json
```

The committed plugin hook manifest stays static in `hooks/hooks.json` and does not contain local absolute paths. Local machine paths are written only to the user's active Antigravity hooks config.

Explicit `/codex:*` command sessions are skipped by the automatic Stop-hook review. For example, `/codex:monitor`, `/codex:setup`, and `/codex:review` do not trigger a second review just because the workspace has uncommitted changes.

## Monitor

Start the local review-gate monitor:

```text
/codex:monitor
```

Open:

```text
http://127.0.0.1:8765
```

Useful monitor commands:

```text
/codex:monitor --status
/codex:monitor --stop
/codex:monitor --clear
/codex:monitor --foreground
```

By default, the monitor binds to `127.0.0.1` and is visible only on the same machine. To view it from another trusted PC on the same network, start it with:

```text
/codex:monitor --host 0.0.0.0 --port 8765
```

Then open `http://<monitor-machine-ip>:8765` from the other PC. The monitor has no authentication, so do not expose it to untrusted networks.

Monitor sections:

- `Review Gate Runs`: automatic Stop-hook reviews.
- `Codex Jobs`: explicit command jobs such as `/codex:review`, `/codex:rescue`, or `/codex:task`.
- `approve / allow`: Codex approved and Antigravity may stop.
- `needs-attention / continue`: Codex found actionable findings and Antigravity should continue.
- `running / pending`: a review-gate run is still in progress.

## Doctor

Run diagnostics:

```text
/codex:doctor
/codex:doctor --run-hook-test
```

`doctor` checks:

- Node and Codex CLI availability
- git workspace state
- workspace review-gate config
- installed plugin hook manifest
- active Stop hook in `~/.gemini/config/hooks.json`
- review-gate event path

`--run-hook-test` verifies hook execution and event writing in bypass mode. It does not call Codex.

## Troubleshooting

Automatic review runs only when all of these are true:

- The plugin is installed with hook support.
- `/codex:setup --enable-review-gate` is enabled for the current workspace.
- `~/.gemini/config/hooks.json` contains `codex-stop-review-gate`.
- The workspace is a git repository.
- There are staged, unstaged, or untracked changes.
- Antigravity reaches a normal Stop-hook point after editing.
- Codex CLI is authenticated and has quota available.

Useful local checks:

```bash
agy plugin list
cat ~/.gemini/antigravity-cli/import_manifest.json
cat ~/.gemini/antigravity-cli/plugins/codex/hooks.json
cat ~/.gemini/config/hooks.json
node dist/agy-codex.mjs setup --json
node dist/agy-codex.mjs doctor
node dist/agy-codex.mjs doctor --run-hook-test
node dist/agy-codex.mjs monitor --status --json
```

If the monitor has no `Review Gate Runs`, the Stop hook has not recorded an event yet. If `/codex:doctor --run-hook-test` passes but no automatic events appear, Antigravity has not invoked the Stop hook for that session.

## Companion CLI

The slash commands call the companion CLI under the hood. You can also run it directly:

```bash
node dist/agy-codex.mjs setup
node dist/agy-codex.mjs setup --enable-review-gate
node dist/agy-codex.mjs review --wait
node dist/agy-codex.mjs review --base main
node dist/agy-codex.mjs adversarial-review --base main "focus on auth boundaries"
node dist/agy-codex.mjs rescue --write "fix the failing test"
node dist/agy-codex.mjs task --write "fix the failing test"
node dist/agy-codex.mjs status
node dist/agy-codex.mjs result
node dist/agy-codex.mjs cancel
node dist/agy-codex.mjs doctor
node dist/agy-codex.mjs doctor --run-hook-test
node dist/agy-codex.mjs monitor
node dist/agy-codex.mjs monitor --status
node dist/agy-codex.mjs monitor --stop
node dist/agy-codex.mjs monitor --clear
node dist/agy-codex.mjs monitor --foreground
```

## Development

Handwritten source lives in TypeScript under `src/` and `tests/`. Generated runtime files under `dist/` and `hooks/bin/` are committed so Antigravity can run the plugin immediately after install.

```bash
npm install
npm test
npm run validate
agy plugin install .
```
