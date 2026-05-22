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

Then run:

```text
/codex:setup
```

## Antigravity Slash Commands

Install the plugin, then use the slash commands as the primary interface:

```text
/codex:setup
/codex:review --background
/codex:adversarial-review --base main "focus on auth boundaries"
/codex:rescue --write "fix the failing test"
/codex:status
/codex:result
/codex:cancel
```

The command files live under `commands/` and use `disable-model-invocation: true`, so they are intended for explicit command invocation rather than natural-language auto-routing.

## Companion CLI

```bash
node dist/agy-codex.mjs setup
node dist/agy-codex.mjs review --wait
node dist/agy-codex.mjs adversarial-review --base main "focus on auth boundaries"
node dist/agy-codex.mjs rescue --write "fix the failing test"
node dist/agy-codex.mjs task --write "fix the failing test"
node dist/agy-codex.mjs status
node dist/agy-codex.mjs result
node dist/agy-codex.mjs cancel
```

Use `--background` on `review`, `adversarial-review`, `rescue`, or `task` to queue work and return immediately.

Skills are still included as a fallback integration surface for Antigravity environments that browse skills, but slash commands are the preferred workflow.
