# Antigravity Codex

한국어 문서: [README.ko.md](README.ko.md)

Antigravity plugin that delegates code review and background engineering tasks to the local OpenAI Codex CLI.

Handwritten source lives in TypeScript under `src/` and `tests/`. The committed `dist/` files are generated runtime output for Antigravity plugin installs.

## Requirements

- Antigravity CLI with plugin support
- Node.js 18.18 or newer
- OpenAI Codex CLI installed and authenticated

```bash
npm install -g @openai/codex
codex login
```

## Local Development

```bash
npm install
npm test
agy plugin validate .
agy plugin install .
```

## Install From GitHub

For Antigravity CLI users, install directly from the GitHub repository:

```bash
agy plugin install https://github.com/zjxps2007/antigravity-codex.git
```

The repository includes both root `plugin.json` for local Antigravity validation and `.claude-plugin/plugin.json` for GitHub URL installation.

When updating an existing install, prefer a clean reinstall so Antigravity records all plugin components, including hooks:

```bash
agy plugin uninstall codex
agy plugin install https://github.com/zjxps2007/antigravity-codex.git
```

Verify that the import manifest contains `hooks`:

```bash
cat ~/.gemini/antigravity-cli/import_manifest.json
```

Then run:

```text
/codex:setup
```

## Antigravity Slash Commands

Install the plugin, then use the slash commands as the primary interface:

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
/codex:monitor
/codex:monitor --status
/codex:monitor --stop
/codex:monitor --clear
/codex:monitor --foreground
```

The command files live under `commands/` and use `disable-model-invocation: true`, so they are intended for explicit command invocation rather than natural-language auto-routing.

`/codex:review` is read-only and reviews the current uncommitted changes by default, or a branch diff when `--base <ref>` is provided. It does not accept custom focus text; use `/codex:adversarial-review` when you want focused or skeptical review instructions.

`/codex:setup --enable-review-gate` enables a Stop hook that runs a read-only Codex review when Antigravity is about to stop after editing code. If Codex returns actionable findings, the hook asks Antigravity to continue and address them. Disable it with `/codex:setup --disable-review-gate`.

The hook manifest is static and stays committed with its packaged command. `setup --enable-review-gate` only updates per-workspace config under the Antigravity Codex data directory, so it does not write local absolute paths into `hooks/hooks.json`.

`/codex:monitor` starts a local web UI for review gate runs at `http://127.0.0.1:8765`. The Stop hook records started/skipped/result/decision events under the local Antigravity Codex data directory, and the monitor shows Codex verdicts, findings, and raw events. Stop the server with `/codex:monitor --stop`; clear old events with `/codex:monitor --clear`; use `--foreground` when you want the server tied to the current terminal process.

## Automatic Review Troubleshooting

Do not use web search to diagnose this plugin. The authoritative state is local:

```bash
agy plugin list
cat ~/.gemini/antigravity-cli/import_manifest.json
cat ~/.gemini/antigravity-cli/plugins/codex/hooks.json
node dist/agy-codex.mjs setup --json
node dist/agy-codex.mjs monitor --status --json
```

For automatic review to run, all of the following must be true:

- `import_manifest.json` lists `hooks` for the `codex` plugin.
- `/codex:setup --enable-review-gate` has enabled the current workspace.
- The workspace is a git repository and has uncommitted changes.
- Antigravity reaches a Stop hook point after editing.
- The Codex CLI is authenticated and has quota available.

If `hooks` is missing from `import_manifest.json`, reinstall with `agy plugin uninstall codex` followed by `agy plugin install https://github.com/zjxps2007/antigravity-codex.git`.

If the monitor shows no `Review Gate Runs`, manually check the event file path reported by `/codex:monitor --status --json`. A missing `events.jsonl` means the Stop hook has not recorded any event yet. `Codex Jobs` are separate from `Review Gate Runs`: explicit commands such as `/codex:review` appear as jobs, while automatic Stop-hook reviews appear as review gate runs.

## Companion CLI

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
node dist/agy-codex.mjs monitor
node dist/agy-codex.mjs monitor --status
node dist/agy-codex.mjs monitor --stop
node dist/agy-codex.mjs monitor --clear
node dist/agy-codex.mjs monitor --foreground
```

Use `--background` on `review`, `adversarial-review`, `rescue`, or `task` to queue work and return immediately.

`review` intentionally rejects positional prompt text. Use `adversarial-review` for custom review guidance.

Skills are still included as a fallback integration surface for Antigravity environments that browse skills, but slash commands are the preferred workflow.
