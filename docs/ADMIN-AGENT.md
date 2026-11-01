# 운영자 화면을 에이전트로 쓰기

> 운영자 화면(oddbout.com `admin.html`)이 하는 일을 코딩 에이전트(Claude Code·Codex)가 이 저장소의 `npm run admin`으로 한다.
> 서버 쪽 새 열쇠는 없다. 운영자 본인의 로그인 세션이 유일한 자격이다.

## 준비 (한 번)

1. 이 저장소에서 `npm install`을 한다.
2. 운영자 계정(관리자 권한이 있는 Google 계정)으로 로그인한다. 세션 파일은 `~/.ai-fighter/client.json`(권한 600)이다.
   - 브라우저가 있는 PC: `npm run login`
   - 브라우저가 닿지 않는 VM: `npm run login -- --device`로 받은 코드를 홈페이지에서 승인하고 `npm run login -- --device-wait`
3. 확인: `npm run admin -- whoami`가 `{"ok": true, "admin": true}`를 낸다. 운영자가 아닌 계정이면 `admin-required`다.

제작용 세션과 운영자 세션을 나누려면 `AI_FIGHTER_CLIENT_CONFIG=<파일> npm run login`으로 다른 파일에 로그인하고, `npm run admin`에
`--session <파일>`을 주거나 `ODDBOUT_ADMIN_SESSION=<파일>`을 둔다.

## 명령

모든 답은 stdout의 JSON 한 개다. 실패는 `{"ok": false, "code": …}`이고 종료 코드가 1이다.

| 명령 | 하는 일 | 화면의 같은 곳 |
| --- | --- | --- |
| `review` · `open` | 확인을 기다리는 신청 · 끝나지 않은 신청 (최신 50개) | 확인 기다리는 신청 |
| `show <job>` | 신청 상세: 설명 전체, 호스트, 회차, 그림(10분 서명 주소), 최근 이벤트 80개 | 신청 상세 |
| `retry <job>` · `cancel <job>` | 멈춘 단계를 다시 돌림 · 신청 취소 | 다시 돌리기 · 신청 취소 |
| `hosts` · `host-approve <host>` · `host-withdraw <host>` | 생성 호스트 목록 · 승인 · 승인 거두기 | 생성 호스트 |
| `profiles [--status review\|approved\|rejected]` | 프로필 세트 목록 | 프로필 세트 |
| `profile-approve <set>` · `profile-reject <set> --reason <글>` | 승인 · 돌려보내기(이유는 제작자에게 보임) | 프로필 세트 |
| `fighters [--status active\|removed\|all] [--search <글>] [--page <n>]` | 선수 목록(20명씩) | 선수 |
| `fighter-remove <id> --version <n> --reason <글>` · `fighter-restore …` | 선수 내리기 · 복원(사유는 제작자에게 보임) | 선수 |

`--version`은 `fighters` 답의 그 선수 `version`이다. 그사이 상태가 바뀌었으면 `review-conflict`가 온다.

## 바꾸는 명령은 두 번 부른다

`retry`, `cancel`, `host-*`, `profile-approve`, `profile-reject`, `fighter-*`는 처음에 보내지 않는다. 할 일을 문장으로 돌려준다
(`dryRun: true`, `change`). 에이전트는 그 문장을 사용자에게 보이고 승인을 받은 뒤 같은 명령에 `--yes`를 붙여 다시 부른다.
제작자에게 보이는 이유·사유는 사용자가 정한 말만 쓴다.

## 지키는 것

- 세션 파일의 토큰을 출력하거나 대화·로그에 옮기지 않는다. 명령은 토큰을 출력하지 않는다.
- 이 명령은 플러그인 묶음과 creator-kit ZIP에 들어가지 않는다(`scripts/build-plugin-bundle.mjs`의 목록 밖). 운영자 저장소에서만 쓴다.
- API는 `api/admin.mjs`, 명령은 `scripts/admin.mjs`, 시험은 `test/admin-cli.test.mjs`와 `test/generation-hosts.test.mjs`다.
