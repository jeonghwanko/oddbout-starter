# 더미로 제작 흐름 시험

저장소를 체크아웃한 소유자가, 실제 이미지 생성과 실제 ODDBOUT 서버 기록 없이 제작 흐름이 이어지는지 본다. creator-kit ZIP에는 이 안내가 들어갈 수 있지만 `npm run flow:test`와 `npm run flow:mcp`는 ZIP 명령이 아니다. ZIP만 받은 작업 공간에서는 돌지 않는다.

이 흐름은 선수를 만들지 않는다. 자리 표시 스프라이트와 메모리 안의 더미 서버만 쓴다.

## 실행

Node.js 22.12 이상. `npm ci`로 의존성을 설치한다. sprite-gen, ffmpeg, 로그인, API 키는 필요 없다.

```sh
npm run flow:test
npm run flow:test -- --scenario quota
npm run flow:mcp
```

`flow:test`는 시나리오를 차례로 돌리고 보고서를 출력한다. 하나라도 실패하면 종료 코드는 1이다. `--scenario`는 `hosted-new`, `workspace-new`, `cli-register`, `revise`, `style-only`, `quota`, `missing-asset`, `rejected`, `legacy-motion`, `guard` 중 하나다. `guard`는 항상 함께 돈다.

`flow:mcp`는 표준 입출력 MCP다. 프로세스가 살아있는 동안만 메모리에 상태가 있다. stderr에 `ODDBOUT-DUMMY`가 찍힌다. 도구에 넘기는 파일 경로는 그 프로세스의 현재 디렉터리 안이어야 한다. 이 서버는 네트워크로 아무것도 보내지 않는다. 호스팅용 자리 표시 패키지는 시작할 때 준비하고 임시 파일은 지운다. 파일 전달은 채팅 호스트의 첨부 대신 로컬 `manifestPath`·`filePath`를 쓰는 어댑터다. 나머지 인자는 실제 도구의 `choose`, `clip`, `profileSetId` 등을 따른다.

`test`와 `test:fast`가 `test/flow-*.test.mjs`의 시나리오·안전장치·MCP 계약 검사를 포함한다.

## 더미와 프로덕션이 섞이지 않게

모든 응답에 `mode: "dummy"`, `service: "oddbout-dummy"`, `production: false`, 그리고 다음 문장이 있다.

`ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.`

자리 표시 패키지는 이름 앞에 `DUMMY `, `localId` 앞에 `dummy-`, 설명에 `ODDBOUT-DUMMY`를 둔다. 별도 파일 `.oddbout-dummy.json`의 존재도 독립된 더미 표시다. 이 표시 중 하나라도 있으면 `npm run fighter:register -- --submit`는 세션 파일을 열기 전에 `dummy-package-refused`로 끝난다. 라이브 클라이언트는 호출되지 않는다. 더미 CLI 등록 이력도 라이브 등록 이력과 별도 파일에 보관한다.

`--dummy`는 `http://127.0.0.1:<port>` 또는 `http://[::1]:<port>`만 받는다. 경로, 계정, 질의 문자열은 거절한다. `oddbout.com`, `supabase`, `render.com`, `workers.dev`가 들어 있으면 요청 전에 `dummy-url-refused`다. 서버는 `127.0.0.1`에만 붙고, 소켓의 상대 주소가 루프백이 아니면 403이다. 응답에 더미 표시가 없으면 클라이언트는 그 응답을 등록 결과로 보지 않는다.

더미 페이지는 `http://127.0.0.1:<port>/dummy/page/...`뿐이다. 공개 사이트 주소는 만들지 않는다.

설명, 이름, `localId`의 표시를 모두 지우고 `.oddbout-dummy.json` 파일도 없애면 이 키트는 그 패키지를 더미로 알아보지 못한다. 라이브 서버의 검증기는 이 변경으로 바뀌지 않았다. 스키마를 통과하는 패키지를 다른 클라이언트로 올리는 것까지 막지는 않는다.

## 시나리오

`flow:test`는 프롬프트를 에이전트에 보내지 않는다. 시나리오마다 코드에 적힌 도구 호출을 실행하고, `agent` 단계의 순서와 결과를 확인한다. 별도의 프롬프트 고정 예문은 정규식 규칙으로 시나리오 이름에 대응하는지만 확인한다. `probe`는 에이전트 단계가 아니라 서버의 거절 경로를 따로 확인한다.

| 시나리오 | 시나리오가 나타내는 요청 | 확인하는 결과 |
| --- | --- | --- |
| `hosted-new` | ODDBOUT에 맡기는 새 선수 | 외형 둘, 동작 11개를 한 읽기마다 하나, 등록. 토큰 차감 0. 잔액 0이면 `generation-quota` |
| `workspace-new` | 작업 공간 커넥터로 등록 | 자리 표시를 검증하고 올리고, 프로필 세트(정면·표정)까지. `enter_fighter`는 `publicPlay: false` |
| `cli-register` | 사용자가 로컬 CLI 등록을 명시적으로 선택한 경우의 `fighter:register` | `--dummy --submit`가 등록하고, 같은 키 재시도는 같은 제출 |
| `revise` | 같은 fighter id로 개정 | `--fighter`로 새 제출. 이전 제출은 그대로. 같은 바이트는 `fighter-unchanged` |
| `style-only` | 그림 없는 스타일 수정 | `update_fighter` kind `style`. 틀린 mix는 `invalid-style` |
| `quota` | 한도에 걸린 새 선수 | 목록에서 멈추고, 준비와 `--dummy` 제출은 `fighter-quota` |
| `missing-asset` | `assets-incomplete` 다음 | 빈 제출은 409. `pending`의 단계 이름은 애셋 id가 아니다. `missingAssets`를 올린 뒤 등록 |
| `rejected` | 심사 거절 | 커넥터는 `review-rejected`. CLI는 그 단계를 `validation-rejected`로 적는다 |
| `legacy-motion` | `motion_ready`인 옛 작업 | 그 전에 `revise_motion`은 `generation-state`. 노트만 기록되고 그림은 바뀌지 않은 채 등록 |
| `guard` | (프롬프트 없음) | 봉인 패키지와 프로덕션처럼 보이는 주소가 라이브로 나가지 않음 |

호스팅 경로의 외형 후보는 글자 라벨이다. 모델 그림이 아니다. `appearanceAutoSelectAt`은 읽어 볼 수 있게만 두고, 10분 타이머는 돌리지 않는다.

자리 표시 스프라이트는 `npm run example`과 같은 기하 도형이다. `npm run validate`와 같은 검사(`bytes-hashes-and-full-decode`)를 통과한다. `BORROWED_LANDMARK` 경고는 실패가 아니다. 프로필 세트는 `npm run fighter:profile-set`와 같은 빌더를 통과하고, 운영자 승인은 주지 않는다(`operatorApproved: false`).

## 프롬프트 인식의 한계

프롬프트 인식은 고정 예문에 붙인 정규식뿐이다. 프롬프트를 실제 에이전트에 보내거나 도구 호출을 유도하지 않는다. 문서 검사는 `AGENTS.md`와 생성 스킬에 필요한 도구 이름과 몇몇 문구가 포함됐는지만 확인한다. 이 검사들은 문서의 의미가 절차와 맞는지, 실제 모델이 어떤 도구를 고를지 검증하지 않는다.

보고서의 `docs (tool-name presence)`는 도구 이름과 필수 문구가 문서에 있는지만 뜻한다. `prompt fixtures (regex matching; no model calls)`는 고정 예문과 정규식 규칙의 짝만 확인한다.

라이브 모델이 같은 문장을 같은 도구로 바꾸는지는 `flow:test`에서 확인하지 않는다. `flow:mcp`는 수동 대화를 위한 더미 도구만 제공한다. 그 도구를 연결한 모델의 선택은 사람이 대화에서 관찰할 수 있지만, `flow:test`의 보고서에는 그 관찰 결과가 포함되지 않는다.

## 보고서 예

아래는 이 트리에서 `npm run flow:test`가 출력한 것이다. 식별자는 이 실행 순서에서 고정이다.

```text
ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.
productionContact: none
tokensSpent: 0
generation: deterministic placeholder sprites (no model call)

docs (tool-name presence): PASS
fixtures: PASS

prompt fixtures (regex matching; no model calls):
  [PASS] hosted-ko → hosted-new
  [PASS] workspace-en → workspace-new
  [PASS] cli-en → cli-register
  [PASS] revise-en → revise
  [PASS] style-en → style-only
  [PASS] quota-en → quota
  [PASS] missing-en → missing-asset
  [PASS] rejected-en → rejected
  [PASS] legacy-en → legacy-motion
  [PASS] chatter → no tools

[PASS] hosted-new — New fighter from a prompt (hosted)
  ok  get_profile  get_profile — id 00000000-0000-4000-8000-00000000d0a1, dummy-owner@oddbout.invalid, nickname ODDBOUT
  ok  get_my_fighters:readiness  get_my_fighters view readiness — registration ready, generation dummy-placeholder
  ok  get_fighter_spec:overview  get_fighter_spec overview — motions 11
  ok  probe  zero token balance — code generation-quota, tokensCharged false
  ok  request_hosted_fighter:request  request_hosted_fighter step request — status appearance_ready, candidates DUMMY look A, DUMMY look B, tokensCharged false
  ok  request_hosted_fighter:choose_look  request_hosted_fighter step choose_look — choice a, status motions
  ok  get_hosted_fighter:until-registered  get_hosted_fighter until registered — drafts idle, walk, run, fightIdle, combo, slam, dash, block, hit, groggy, fall; state registered; fighter 00000000-0000-4000-8000-000000000017; tokensCharged false; waitedMs 0

[PASS] workspace-new — New fighter from a prompt (workspace connector)
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1 dummy-owner@oddbout.invalid
  ok  get_my_fighters:readiness  get_my_fighters view readiness — ready
  ok  get_fighter_spec:overview  get_fighter_spec overview — spec ai-fighter-side-v1
  ok  local:placeholder-sprites  placeholder sprites — dummy-drill-bot, name DUMMY Drill Bot
  ok  local:validate  validate placeholder package — stage bytes-hashes-and-full-decode, assets 11, pending [runtime-preview, visual-review, server-registration], warnings BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK
  ok  prepare_fighter_registration:package  prepare_fighter_registration kind package — stage uploading, pending [server-validation, registration], missing 11
  ok  upload_fighter_asset:package  upload_fighter_asset for each missingAssets id — 11 files
  ok  submit_fighter_registration:package  submit_fighter_registration kind package — stage validating
  ok  get_my_fighters:submission  get_my_fighters view submission — stage registered, fighter 00000000-0000-4000-8000-000000000002, event submission-registered
  ok  prepare_fighter_registration:profile_set  prepare_fighter_registration kind profile_set — missing front, expressions
  ok  upload_fighter_asset:profile_set:front  upload profile front — bytes 3102
  ok  upload_fighter_asset:profile_set:expressions  upload expression sheet — bytes 8114
  ok  submit_fighter_registration:profile_set  submit_fighter_registration kind profile_set — front.ok true, operatorApproved false
  ok  get_my_fighters:fighter  get_my_fighters view fighter — status dummy-held, publicPlay false, front.ok true
  ok  probe  enter_fighter stays off the public roster — publicPlay false, productionRoster false

[PASS] cli-register — New fighter via fighter:register --dummy
  ok  get_profile  get_profile — dummy-owner@oddbout.invalid
  ok  get_my_fighters:readiness  get_my_fighters view readiness — ready
  ok  local:placeholder-sprites  placeholder sprites — DUMMY Drill Bot
  ok  local:validate  validate placeholder package — stage bytes-hashes-and-full-decode, assets 11, pending [runtime-preview, visual-review, server-registration], warnings BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK
  ok  fighter:register:submit  fighter:register --dummy --submit — ok true, stage registered, polls 1, fighter 00000000-0000-4000-8000-000000000002, production connects 0
  ok  get_my_fighters:submission  connector sees the CLI submission — stage registered, event submission-registered
  ok  fighter:register:retry  retry the same bytes and key — same submission true, reused true
  ok  probe  dummy page — status 200, labelled true

[PASS] revise — Revision of a registered fighter with --fighter
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  get_my_fighters view list — count 1, limit 3
  ok  local:placeholder-sprites  new placeholder package — DUMMY Drill Bot v2
  ok  local:validate  validate revised package — stage bytes-hashes-and-full-decode, assets 11, pending [runtime-preview, visual-review, server-registration], warnings BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK
  ok  fighter:register:revise  fighter:register --fighter --dummy --submit — fighter 00000000-0000-4000-8000-000000000002 stays, new submission 00000000-0000-4000-8000-000000000004, previous submission still registered
  ok  get_my_fighters:submission  get_my_fighters view submission — stage registered, fighter 00000000-0000-4000-8000-000000000002
  ok  probe  same bytes are fighter-unchanged — code fighter-unchanged

[PASS] style-only — Style-only edit
  ok  get_profile  get_profile — ODDBOUT
  ok  get_my_fighters:list  get_my_fighters view list — count 1, limit 3
  ok  browse_oddbout:style_guide  browse_oddbout view style_guide — extrasBudget 2
  ok  probe  illegal mix is refused — code invalid-style
  ok  update_fighter:style  update_fighter kind style — super dash, artChanged false

[PASS] quota — Quota exceeded
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  get_my_fighters view list — count 1 / limit 1, exceeded true
  ok  probe  prepare is fighter-quota — code fighter-quota
  ok  probe  fighter:register --dummy is fighter-quota — code fighter-quota, production connects 0

[PASS] missing-asset — Asset missing 409, then the missingAssets upload
  ok  prepare_fighter_registration:package  prepare_fighter_registration — missing 11, pending [server-validation, registration]
  ok  probe  submit before upload — code assets-incomplete
  ok  probe  pending name is not an asset id — code asset-not-found
  ok  upload_fighter_asset:package  upload each missingAssets id — 11 after the 409
  ok  submit_fighter_registration:package  submit after the missing files — stage validating
  ok  get_my_fighters:submission  get_my_fighters view submission — stage registered

[PASS] rejected — Rejected by dummy review
  ok  prepare_fighter_registration:package  prepare_fighter_registration — stage uploading
  ok  upload_fighter_asset:package  upload assets — 11
  ok  submit_fighter_registration:package  submit_fighter_registration — stage validating
  ok  get_my_fighters:submission  review rejection returned to the agent — stage rejected, code review-rejected, reason Dummy operator rejected this labelled package. No live review happened.
  ok  probe  CLI maps a rejected stage to validation-rejected — code validation-rejected, rejection review, production connects 0

[PASS] legacy-motion — Legacy hosted job at motion_ready
  ok  probe  revise_motion before motion_ready — code generation-state, applied false
  ok  get_hosted_fighter:job  get_hosted_fighter — status motion_ready
  ok  request_hosted_fighter:revise_motion  request_hosted_fighter step revise_motion — applied true, artChanged false, motion walk
  ok  submit_fighter_registration:hosted  submit_fighter_registration kind hosted — stage registered, fighter 00000000-0000-4000-8000-000000000006
  ok  get_hosted_fighter:job  get_hosted_fighter after registration — state registered, completed true

[PASS] guard — Sealed packages cannot reach a live client
  ok  probe  sealed package without --dummy — code dummy-package-refused, production connects 0
  ok  probe  production-shaped URL — code dummy-url-refused, fetches 0
  ok  probe  loopback server that is not labelled dummy — code dummy-response-unlabelled
  ok  probe  dry run against a loopback URL does not connect — dryRun true, mode dummy, connects 0

result: PASS
```

## 시험하지 못하는 것

- 실제 이미지·영상 모델의 화질, 해부, 보행
- 실제 운영자의 심사와 정면 승인. 거절은 더미가 정한 결과다
- 라이브 토큰 차감. 잔액 0은 거절하고, 잔액이 있어도 차감하지 않는다
- 프로덕션 등록, 출전, 공개 로스터, 사이트 알림
- 채팅 앱이 사용자에게 그림을 보여주는 경로
- 라이브 모델의 프롬프트 해석
