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

## Companion Commands

```bash
node dist/agy-codex.mjs setup
node dist/agy-codex.mjs review --wait
node dist/agy-codex.mjs adversarial-review --base main "focus on auth boundaries"
node dist/agy-codex.mjs task --write "fix the failing test"
node dist/agy-codex.mjs status
node dist/agy-codex.mjs result
node dist/agy-codex.mjs cancel
```

Use `--background` on `review`, `adversarial-review`, or `task` to queue work and return immediately.
