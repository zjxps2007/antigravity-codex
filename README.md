# Antigravity Codex

한국어 문서: [README.ko.md](README.ko.md)

Antigravity plugin that delegates code review and background engineering tasks to the local OpenAI Codex CLI.

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
npm test
agy plugin validate .
agy plugin install .
```

## Companion Commands

```bash
node scripts/agy-codex.mjs setup
node scripts/agy-codex.mjs review --wait
node scripts/agy-codex.mjs adversarial-review --base main "focus on auth boundaries"
node scripts/agy-codex.mjs task --write "fix the failing test"
node scripts/agy-codex.mjs status
node scripts/agy-codex.mjs result
node scripts/agy-codex.mjs cancel
```

Use `--background` on `review`, `adversarial-review`, or `task` to queue work and return immediately.
