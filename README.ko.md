# Antigravity Codex

English documentation: [README.md](README.md)

Antigravity Codex는 Antigravity에서 로컬 OpenAI Codex CLI를 호출하기 위한 플러그인입니다. 명시적인 `/codex:*` 명령으로 리뷰와 작업 위임을 수행하고, 선택적으로 Antigravity가 작업을 마치려는 시점에 Codex가 read-only 리뷰를 수행하는 review gate를 제공합니다.

## 주요 기능

- Antigravity에서 Codex read-only 리뷰 실행
- 명시적인 명령을 통한 Codex 작업 위임
- 선택형 Stop-hook review gate
  - Antigravity가 코드 수정
  - Antigravity가 멈추려는 시점에 Stop hook 실행
  - Codex가 현재 git 변경사항을 read-only로 리뷰
  - `approve`면 종료 허용
  - `needs-attention`이면 `continue`를 반환해 Antigravity가 계속 수정
- review-gate 실행 이력을 보는 로컬 monitor UI 제공

## 요구 사항

- 플러그인 기능을 지원하는 Antigravity CLI
- Node.js 18.18 이상
- 설치 및 인증이 완료된 OpenAI Codex CLI

```bash
npm install -g @openai/codex
codex login
```

## 설치

GitHub 저장소에서 바로 설치합니다.

```bash
agy plugin install https://github.com/zjxps2007/antigravity-codex.git
```

기존 설치를 깨끗하게 업데이트하려면 재설치합니다.

```bash
agy plugin uninstall codex
agy plugin install https://github.com/zjxps2007/antigravity-codex.git
```

설치 상태 확인:

```text
/codex:setup
```

현재 workspace에 자동 review gate 켜기:

```text
/codex:setup --enable-review-gate
```

끄기:

```text
/codex:setup --disable-review-gate
```

## 기본 사용

기본 인터페이스는 slash command입니다.

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
/codex:doctor
/codex:doctor --run-hook-test
/codex:monitor
/codex:monitor --status
/codex:monitor --stop
/codex:monitor --clear
```

참고:

- 명령 파일은 `disable-model-invocation: true`를 사용합니다. 자연어 자동 라우팅보다 명시적인 `/codex:*` 명령 호출을 우선합니다.
- `/codex:review`는 read-only이며 기본적으로 현재 uncommitted changes를 리뷰합니다.
- `/codex:review --base <ref>`는 기준 ref와의 diff를 리뷰합니다.
- `/codex:review`는 커스텀 focus text를 받지 않습니다. 특정 관점의 리뷰가 필요하면 `/codex:adversarial-review`를 사용합니다.
- `review`, `adversarial-review`, `rescue`, `task`는 `--background`를 지원합니다.

## Review Gate

review gate는 Antigravity와 Codex를 다음 흐름으로 연결합니다.

```text
Antigravity 구현
-> Antigravity가 멈추려 함
-> Stop hook이 Codex read-only 리뷰 실행
-> approve + allow: 종료 허용
-> needs-attention + continue: Antigravity가 계속 수정
```

`/codex:setup --enable-review-gate`는 workspace 설정을 켜고 Antigravity CLI가 런타임에 읽는 active Stop hook을 아래 파일에 병합합니다.

```text
~/.gemini/config/hooks.json
```

커밋되는 plugin hook manifest인 `hooks/hooks.json`은 정적 파일로 유지되며 로컬 절대 경로를 포함하지 않습니다. 로컬 머신 경로는 사용자 환경의 active Antigravity hooks config에만 기록됩니다.

명시적인 `/codex:*` command 세션은 자동 Stop-hook 리뷰를 건너뜁니다. 예를 들어 `/codex:monitor`, `/codex:setup`, `/codex:review`는 workspace에 변경사항이 남아 있어도 두 번째 자동 리뷰를 유발하지 않습니다.

## Monitor

로컬 review-gate monitor 실행:

```text
/codex:monitor
```

브라우저에서 엽니다.

```text
http://127.0.0.1:8765
```

유용한 monitor 명령:

```text
/codex:monitor --status
/codex:monitor --stop
/codex:monitor --clear
/codex:monitor --foreground
```

화면 해석:

- `Review Gate Runs`: 자동 Stop-hook 리뷰
- `Codex Jobs`: `/codex:review`, `/codex:rescue`, `/codex:task` 같은 명시적 명령 작업
- `approve / allow`: Codex 승인, Antigravity 종료 허용
- `needs-attention / continue`: Codex가 수정 필요 항목을 발견, Antigravity가 계속 수정
- `running / pending`: review-gate 실행 중

## Doctor

진단 실행:

```text
/codex:doctor
/codex:doctor --run-hook-test
```

`doctor`는 다음을 확인합니다.

- Node 및 Codex CLI 사용 가능 여부
- git workspace 상태
- workspace review-gate 설정
- 설치된 plugin hook manifest
- `~/.gemini/config/hooks.json`의 active Stop hook
- review-gate 이벤트 파일 경로

`--run-hook-test`는 bypass 모드로 hook 실행과 이벤트 기록 경로만 검증합니다. Codex를 호출하지 않습니다.

## 문제 확인

자동 리뷰가 실행되려면 아래 조건이 모두 맞아야 합니다.

- 플러그인이 hook 지원과 함께 설치되어 있어야 합니다.
- 현재 workspace에서 `/codex:setup --enable-review-gate`가 실행되어 있어야 합니다.
- `~/.gemini/config/hooks.json`에 `codex-stop-review-gate`가 있어야 합니다.
- workspace가 git 저장소여야 합니다.
- staged, unstaged, untracked 변경사항 중 하나가 있어야 합니다.
- Antigravity가 코드 수정 후 정상 Stop-hook 지점에 도달해야 합니다.
- Codex CLI 인증과 quota가 정상이어야 합니다.

로컬 상태 확인:

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

monitor에 `Review Gate Runs`가 없으면 Stop hook이 아직 이벤트를 기록하지 않은 상태입니다. `/codex:doctor --run-hook-test`는 통과하는데 자동 이벤트가 없다면 해당 세션에서 Antigravity가 Stop hook을 호출하지 않은 것입니다.

## Companion CLI

Slash command는 내부적으로 companion CLI를 호출합니다. 직접 실행할 수도 있습니다.

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
node dist/agy-codex.mjs doctor
node dist/agy-codex.mjs doctor --run-hook-test
node dist/agy-codex.mjs monitor
node dist/agy-codex.mjs monitor --status
node dist/agy-codex.mjs monitor --stop
node dist/agy-codex.mjs monitor --clear
node dist/agy-codex.mjs monitor --foreground
```

## 개발

직접 작성하는 소스는 `src/`와 `tests/` 아래 TypeScript로 관리합니다. `dist/`와 `hooks/bin/` 아래의 생성 파일은 Antigravity 설치 후 바로 실행될 수 있도록 커밋합니다.

```bash
npm install
npm test
npm run validate
agy plugin install .
```
