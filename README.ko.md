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

## Companion 명령

```bash
node dist/agy-codex.mjs setup
node dist/agy-codex.mjs review --wait
node dist/agy-codex.mjs adversarial-review --base main "인증 경계를 중점적으로 검토"
node dist/agy-codex.mjs task --write "실패하는 테스트 수정"
node dist/agy-codex.mjs status
node dist/agy-codex.mjs result
node dist/agy-codex.mjs cancel
```

`review`, `adversarial-review`, `task`에 `--background`를 붙이면 작업을 큐에 넣고 즉시 job id를 반환합니다.

## 제공 스킬

- `codex-setup`: Codex CLI 설치 및 인증 준비 상태 확인
- `codex-review`: 현재 git 워크스페이스에 대한 읽기 전용 Codex 리뷰 실행
- `codex-adversarial-review`: 설계, 가정, 실패 모드, 테스트를 더 비판적으로 검토
- `codex-rescue`: 조사 또는 구현 작업을 Codex에 위임
- `codex-status`: 현재 워크스페이스의 최근 Codex 작업 상태 조회
- `codex-result`: 완료된 Codex 작업 결과 출력
- `codex-cancel`: 실행 중인 Codex 작업 취소

기본 task 실행은 읽기 전용입니다. 파일 수정을 허용하려면 명시적으로 `--write`를 사용합니다.
