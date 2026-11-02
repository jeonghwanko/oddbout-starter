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
| `fighter <id>` | 선수 한 명: 주인, 패키지 해시, 출전, 전투 스타일, 최근 운영자 수정 5개 | (화면 없음) |
| `replace-package <id> <패키지 폴더 또는 fighter.json> --reason <글>` | 그 선수의 원화·애니메이션 패키지 교체. 출전 중이면 출전 유지 | (화면 없음) |
| `edit-profile <id> --reason <글> [--profile <JSON 또는 @파일>] [--style <JSON, null 또는 @파일>]` | 프로필 문구·전투 스타일 고치기. 출전 유지 | (화면 없음) |

`--version`은 `fighters` 답의 그 선수 `version`이다. 그사이 상태가 바뀌었으면 `review-conflict`가 온다.

## 남의 선수 고치기 (2026-11-02)

운영자가 선수 주인의 로그인 없이 그 선수의 패키지·프로필·전투 스타일을 고친다. 서버는 주인이 직접 고칠 때와 같은 함수와 검사를 주인 계정으로
돌린다(계정 상태, 내려진 선수, 열린 제출, 같은 패키지, 저장 한도). 그래서 주인 계정이 꺼졌거나 그 계정의 요청 한도에 걸리면 운영자 수정도 같은
코드(`account-disabled`·`rate-limit`)로 실패한다. 주인 수정과 다른 점은 셋이다.

- 운영자 계정과 사유는 비공개 감사 표(`af_admin_fighter_edits`)에만 남는다. 주인은 자기 제출·선수 행을 읽으므로 그 행에는 운영자 정보를 두지 않는다.
  `fighter <id>`가 최근 5개를 결과 상태와 함께 보인다(검사에서 거절되거나 만료된 시도도 보인다).
- 운영자가 올린 새 패키지는 출전을 유지한다(`af_submissions.keep_entry`). 주인이 올린 새 패키지는 전처럼 출전을 풀고, 주인이 새 동작을 본 뒤
  다시 출전시킨다. 프로필·스타일 수정은 누가 하든 출전을 유지한다.
- 파일은 주인의 저장 경로(`<주인>/<제출>/…`)에 들어간다. 운영자의 제출은 `admin/submissions/<id>`로만 다루고, 주인의 제출은 다루지 않는다.
  주인이 이미 쓴 열쇠(`idempotency-key`)는 주인의 것이다. 운영자가 같은 열쇠를 보내면 `idempotency-conflict`다.

시험 실행도 선수를 읽어 이름·주인·출전 여부를 보인다. 패키지의 이름이 지금 이름과 다르면 `warning: name-differs`를 붙인다. 다른 선수 id를
붙여 넣지 않았는지 그 문장으로 확인한다.

`replace-package`는 패키지를 계약으로 검사하고 파일마다 크기·해시를 맞춘 뒤 보낸다. 만들기 → 파일 올리기 → 검사 대기열 → 결과(최대 10분)를
차례로 한다. 패키지가 그 선수의 지금 패키지가 됐을 때만 `done`이다. 아니면 `ok: false`와 `validation-rejected`·`validation-timeout`·
`package-superseded`·`upload-expired` 중 하나다. 열쇠는 선수·지금 패키지·새 패키지로 정한다. 연결이 끊긴 뒤 다시 부르면 이어서 하고,
그사이 다른 패키지가 올라갔으면 새 제출이 된다. 검사에서 거절된 같은 패키지를 다시 보내려면 `--key <새 UUID>`를 준다.
`edit-profile`은 지금 패키지 해시를 읽고 그 위에 고친다. 사유는 요청 주소가 아니라 `X-Admin-Reason` 헤더(퍼센트 인코딩)로 간다.
API는 `api/admin-fighter-edits.mjs`(`GET admin/fighters/<id>`, `POST admin/fighters/<id>/submissions`, `PUT admin/submissions/<id>/assets/<asset>`,
`POST admin/submissions/<id>/submit`, `GET admin/submissions/<id>`, `PATCH admin/fighters/<id>/profile`), 데이터베이스는
`supabase/migrations/20261102100000_oddbout_admin_fighter_edits.sql`, 시험은 `test/admin-fighter-edits.test.mjs`다.

## 바꾸는 명령은 두 번 부른다

`retry`, `cancel`, `host-*`, `profile-approve`, `profile-reject`, `fighter-*`, `replace-package`, `edit-profile`은 처음에 보내지 않는다. 할 일을 문장으로 돌려준다
(`dryRun: true`, `change`). 에이전트는 그 문장을 사용자에게 보이고 승인을 받은 뒤 같은 명령에 `--yes`를 붙여 다시 부른다.
제작자에게 보이는 이유·사유는 사용자가 정한 말만 쓴다.

## 지키는 것

- 세션 파일의 토큰을 출력하거나 대화·로그에 옮기지 않는다. 명령은 토큰을 출력하지 않는다.
- 이 명령은 플러그인 묶음과 creator-kit ZIP에 들어가지 않는다(`scripts/build-plugin-bundle.mjs`의 목록 밖). 운영자 저장소에서만 쓴다.
- API는 `api/admin.mjs`(선수 고치기는 `api/admin-fighter-edits.mjs`), 명령은 `scripts/admin.mjs`, 시험은 `test/admin-cli.test.mjs`·
  `test/admin-fighter-edits.test.mjs`·`test/generation-hosts.test.mjs`다.
