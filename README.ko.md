# Antigravity Codex

Antigravity에서 로컬 OpenAI Codex CLI를 호출해 코드 리뷰와 백그라운드 엔지니어링 작업을 위임하는 플러그인입니다.

직접 작성하는 소스는 `src/`와 `tests/` 아래 TypeScript로 관리합니다. 커밋된 `dist/` 파일은 Antigravity 플러그인 설치 후 바로 실행하기 위한 빌드 산출물입니다.

English documentation: [README.md](README.md)

## 요구 사항

- 플러그인 기능을 지원하는 Antigravity CLI
- Node.js 18.18 이상
- 설치 및 인증이 완료된 OpenAI Codex CLI

```bash
npm install -g @openai/codex
codex login
```

## 로컬 개발

```bash
npm install
npm test
agy plugin validate .
agy plugin install .
```

## GitHub에서 설치

Antigravity CLI 사용자는 GitHub 저장소에서 바로 설치할 수 있습니다.

```bash
agy plugin install https://github.com/zjxps2007/antigravity-codex.git
```

이 저장소는 로컬 Antigravity 검증용 루트 `plugin.json`과 GitHub URL 설치용 `.claude-plugin/plugin.json`을 함께 포함합니다.

설치 후 먼저 확인합니다.

```text
/codex:setup
```

## Antigravity Slash Commands

플러그인을 설치한 뒤 아래 slash command를 기본 사용 경로로 씁니다.

```text
/codex:setup
/codex:setup --enable-review-gate
/codex:review
/codex:review --background
/codex:review --base main
/codex:adversarial-review --base main "인증 경계를 중점적으로 검토"
/codex:rescue --write "실패하는 테스트 수정"
/codex:status
/codex:result
/codex:cancel
```

명령 파일은 `commands/` 아래에 있고 `disable-model-invocation: true`를 사용합니다. 따라서 자연어 자동 라우팅보다 명시적인 command 호출을 우선합니다.

`/codex:review`는 읽기 전용이며 기본적으로 현재 uncommitted changes를 리뷰하고, `--base <ref>`를 주면 해당 기준 ref와의 diff를 리뷰합니다. 커스텀 focus text는 받지 않습니다. 특정 관점이나 더 비판적인 리뷰가 필요하면 `/codex:adversarial-review`를 사용합니다.

`/codex:setup --enable-review-gate`는 Antigravity가 코드 수정 후 멈추려 할 때 read-only Codex 리뷰를 실행하는 Stop hook을 켭니다. Codex가 조치할 만한 문제를 반환하면 hook이 Antigravity에게 계속 수정하라고 요청합니다. 끄려면 `/codex:setup --disable-review-gate`를 사용합니다.

## Companion CLI

```bash
node dist/agy-codex.mjs setup
node dist/agy-codex.mjs setup --enable-review-gate
node dist/agy-codex.mjs review --wait
node dist/agy-codex.mjs review --base main
node dist/agy-codex.mjs adversarial-review --base main "인증 경계를 중점적으로 검토"
node dist/agy-codex.mjs rescue --write "실패하는 테스트 수정"
node dist/agy-codex.mjs task --write "실패하는 테스트 수정"
node dist/agy-codex.mjs status
node dist/agy-codex.mjs result
node dist/agy-codex.mjs cancel
```

`review`, `adversarial-review`, `rescue`, `task`에 `--background`를 붙이면 작업을 큐에 넣고 즉시 job id를 반환합니다.

`review`는 positional prompt text를 의도적으로 거부합니다. 커스텀 리뷰 지시가 필요하면 `adversarial-review`를 사용합니다.

Antigravity 환경에서 스킬 브라우징이 필요한 경우를 위해 `skills/`도 유지하지만, 권장 워크플로우는 slash command입니다.

## 제공 스킬

- `codex-setup`: Codex CLI 설치 및 인증 준비 상태 확인
- `codex-review`: 현재 git 워크스페이스에 대한 읽기 전용 Codex 리뷰 실행
- `codex-adversarial-review`: 설계, 가정, 실패 모드, 테스트를 더 비판적으로 검토
- `codex-rescue`: 조사 또는 구현 작업을 Codex에 위임
- `codex-status`: 현재 워크스페이스의 최근 Codex 작업 상태 조회
- `codex-result`: 완료된 Codex 작업 결과 출력
- `codex-cancel`: 실행 중인 Codex 작업 취소

기본 task 실행은 읽기 전용입니다. 파일 수정을 허용하려면 명시적으로 `--write`를 사용합니다.
