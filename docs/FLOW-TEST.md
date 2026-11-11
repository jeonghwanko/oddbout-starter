# 더미로 제작 흐름 시험

저장소를 체크아웃한 소유자가, 실제 이미지 생성과 실제 ODDBOUT 서버 기록 없이 제작 흐름이 이어지는지 본다. creator-kit ZIP에는 이 안내가 들어갈 수 있지만 `npm run flow:test`와 `npm run flow:mcp`는 ZIP 명령이 아니다. ZIP만 받은 작업 공간에서는 돌지 않는다.

이 흐름은 선수를 만들지 않는다. 자리 표시 스프라이트와 메모리 안의 더미 서버만 쓴다.

## 실행

Node.js 22.12 이상. `npm ci`로 의존성을 설치한다. sprite-gen, ffmpeg, 로그인, API 키는 필요 없다.

```sh
npm run flow:test
npm run flow:test -- --scenario quota
npm run flow:mcp -- --fixture empty
npm run flow:mcp -- --fixture registered
npm run flow:mcp -- --fixture quota
```

`flow:test`는 시나리오를 차례로 돌리고 보고서를 출력한다. 하나라도 실패하면 종료 코드는 1이다. `--scenario`는 `list`, `missing-target`, `hosted-delegated`, `hosted-capacity`, `hosted-new`, `workspace-new`, `cli-register`, `revise`, `revise-mcp`, `style-only`, `quota`, `missing-asset`, `rejected`, `legacy-motion`, `guard` 중 하나다. `guard`는 항상 함께 돈다.

`flow:mcp`는 표준 입출력 MCP다. 프로세스가 살아있는 동안만 메모리에 상태가 있다. stderr에 `ODDBOUT-DUMMY`가 찍힌다. 기본 fixture는 `empty`다. `--fixture registered`는 모델 입력을 받기 전에 유효한 더미 fighter 한 명(`DUMMY 야근왕 박과장`)과 그 초기 제출을 준비한다. `--fixture quota`는 유효한 더미 fighter 세 명을 준비해 계정을 3/3으로 채운다. 이 준비는 MCP 도구로 노출되지 않는다. 시작 시 stderr에는 `phase:"setup"` 이벤트로 선택한 fixture, 계정 보유 수와 한도, fighter id·이름·manifest hash를 기록한다. 이 이벤트는 setup 증거이지 모델 도구 호출이 아니다.

도구에 넘기는 파일 경로는 현재 디렉터리 또는 이 세션의 전용 임시 패키지 폴더 안이어야 한다. 외부 네트워크로 요청하지 않으며, 같은 메모리 상태를 공유하는 HTTP 서버를 `127.0.0.1`의 임의 포트에 연다. 그 주소는 `get_profile.dummyRegistrationUrl`과 stderr의 setup 이벤트에 나온다. 파일 전달은 채팅 호스트의 첨부 대신 로컬 `manifestPath`·`filePath`를 쓰는 어댑터다. 나머지 인자는 실제 도구의 `choose`, `clip`, `profileSetId` 등을 따른다.

### MCP에서 개정 패키지를 만들고 등록하기

`--fixture registered`로 시작하고 `get_profile` → `get_my_fighters` view `list`로 대상을 확인한다. `create_dummy_package`에 그 `fighterId`를 주면 매번 새 폴더에 검증된 더미 개정 패키지를 만든다. 없는 id는 거절하며, 이 도구는 제출이나 계정 변경을 하지 않는다. `name`, `description`, `language`, `style`, `moves`(combo/slam/dash/block의 이름·설명)를 지정할 수 있다. 그림은 기하 도형이고, 실제 선수의 그림을 고치는 도구가 아니다.

반환된 `manifestPath`와 기존 `fighterId`로 `prepare_fighter_registration`을 호출하고, `missingAssets`마다 반환된 `dir` 아래의 파일을 올린 뒤 제출한다. 이전 제출은 그대로 두고 같은 fighter에 새 제출이 붙는다. 이 과정을 `revise-mcp`가 시험하며, 사용자에게 없는 대상을 새 등록으로 대체하지 않는다.

사용자가 CLI 경로를 선택했다면 MCP 프로세스를 켜 둔 채 반환된 `dir`, 기존 id와 `dummyRegistrationUrl`로 실행한다.

```sh
npm run fighter:register -- --dir <반환된-dir> --fighter <기존-id> --dummy http://127.0.0.1:<반환된-포트> --submit
```

CLI의 제출도 곧바로 이 MCP의 조회에 나타난다. stdin 종료나 SIGTERM/SIGINT를 받으면 HTTP 연결과 이 세션의 임시 패키지를 정리한다. 작업 공간의 기존 파일은 삭제하지 않는다. 유지할 테스트 파일은 세션 종료 전에 별도 위치로 복사한다.

패키지·프로필 준비, 스타일 변경, 새 호스팅 요청에는 `idempotencyKey`가 필수다. 호스팅의 `choose_look`·`revise_motion`은 기존 `jobId`를 쓰므로 키가 필요 없다. 광고하는 JSON 스키마와 실제 MCP 입력 검증이 같은 조건을 쓴다. 변경된 바이트에는 새 키, 같은 제출의 안전한 재시도에는 원래 키를 쓴다.

### 호스팅 대기와 결과

`get_hosted_fighter`의 `waitSeconds`는 0–30의 정수다. 양수이면 100ms마다 더미 작업을 진행하며 등록·반려·사용자 선택·한도 차단 또는 시간 제한에서 반환한다. 정상적인 위임 작업은 `waitSeconds: 5` 한 호출로 등록까지 진행할 수 있다. 시간 제한 안에 끝난다는 보장은 없으며, `waitedMs`는 실제 측정한 경과 시간이다. 0 또는 생략은 즉시 한 단계만 진행한다. 이 방식은 빠른 흐름 시험용이며, 실제 서버가 상태 변화마다 일찍 반환하는 대기 동작과 소요 시간을 재현하지 않는다.

호스팅 등록 이름은 요청의 `description`에서 간단한 규칙으로 라벨을 뽑아 `DUMMY ` 뒤에 붙인다. 문장 앞뒤의 명시적인 위임 구절(예: `외형 선택까지 맡길게.`, `You choose the appearance.`)과 제작 요청 표현(예: `만들어줘`, `Please create a`)만 제거하며, 자유로운 문장을 해석하거나 모델로 이름을 짓지는 않는다. `외형 선택까지 맡길게. 흰 고양이 복서를 만들어줘`의 표시 이름은 `DUMMY 흰 고양이 복서`다. 요청 원문은 작업의 `description`에 그대로 남고, 등록 설명과 concept도 기존 길이 제한 안에서 원래 설명을 사용한다. 라벨이 비면 `DUMMY Hosted`를 쓰며, 이름은 서로게이트 쌍을 자르지 않고 UTF-16 40자 이내로 제한한다. 이 처리는 더미 호스팅 등록에만 적용한다. 등록에는 실제 파일 검사와 해시 확인을 거친 기하 도형 정면·표정 세트도 붙는다. `front.ok`는 더미 파일 검사 결과이고 `operatorApproved: false`, `publicPlay: false`는 유지된다.

`test`와 `test:fast`가 `test/flow-*.test.mjs`의 시나리오·안전장치·MCP 계약 검사를 포함한다.

## 더미와 프로덕션이 섞이지 않게

더미 도구가 처리한 업무 응답에는 `mode: "dummy"`, `service: "oddbout-dummy"`, `production: false`, 그리고 다음 문장이 있다.

`ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.`

입력 스키마를 어긴 요청은 실행 전에 MCP 표준 검증 오류로 반환하며, 그 오류에는 업무 응답의 표시 필드가 없을 수 있다.

자리 표시 패키지는 이름 앞에 `DUMMY `, `localId` 앞에 `dummy-`, 설명에 `ODDBOUT-DUMMY`를 둔다. 별도 파일 `.oddbout-dummy.json`의 존재도 독립된 더미 표시다. 이 표시 중 하나라도 있으면 `npm run fighter:register -- --submit`는 세션 파일을 열기 전에 `dummy-package-refused`로 끝난다. 라이브 클라이언트는 호출되지 않는다. 더미 CLI 등록 이력도 라이브 등록 이력과 별도 파일에 보관한다.

`--dummy`는 `http://127.0.0.1:<port>` 또는 `http://[::1]:<port>`만 받는다. 경로, 계정, 질의 문자열은 거절한다. `oddbout.com`, `supabase`, `render.com`, `workers.dev`가 들어 있으면 요청 전에 `dummy-url-refused`다. 서버는 `127.0.0.1`에만 붙고, 소켓의 상대 주소가 루프백이 아니면 403이다. 응답에 더미 표시가 없으면 클라이언트는 그 응답을 등록 결과로 보지 않는다.

더미 페이지는 `http://127.0.0.1:<port>/dummy/page/...`뿐이다. 공개 사이트 주소는 만들지 않는다.

설명, 이름, `localId`의 표시를 모두 지우고 `.oddbout-dummy.json` 파일도 없애면 이 키트는 그 패키지를 더미로 알아보지 못한다. 라이브 서버의 검증기는 이 변경으로 바뀌지 않았다. 스키마를 통과하는 패키지를 다른 클라이언트로 올리는 것까지 막지는 않는다.

## 시나리오

`flow:test`는 프롬프트를 에이전트에 보내지 않는다. 시나리오마다 코드에 적힌 도구 호출을 실행하고, `agent` 단계의 순서와 결과를 확인한다. 별도의 프롬프트 고정 예문은 정규식 규칙으로 시나리오 이름에 대응하는지만 확인한다. `setup`은 사용자 요청 전에 준비한 초기 상태이고, `probe`는 서버의 거절 경로를 따로 확인한다. 둘 다 에이전트 순서 평가에서 제외한다. 금지된 도구나 단계가 `agent`로 기록되면 실패한다.

### 라이브 모델 도구 선택 평가

MCP 메시지 기록이 필요한 실행은 다음과 같이 시작한다. `prompt.txt`는 평가자가 실제 모델에 보낼 원문이며, 이 옵션은 파일을 기록할 뿐 모델에 전송하지 않는다.

```sh
npm run flow:mcp -- --fixture empty --trace /tmp/oddbout-run-001.jsonl --prompt-file /tmp/prompt.txt
```

두 옵션은 함께 지정해야 한다. trace 파일은 새 파일이어야 하며 기존 파일이나 심볼릭 링크는 덮어쓰지 않는다. 파일 권한은 소유자 읽기/쓰기(0600)다. 로컬 시험용 입력만 사용한다. 프롬프트, 도구 인자, 반환값에 담긴 텍스트와 로컬 경로는 그대로 기록하므로 비밀값·실사용 고객 자료를 넣거나 파일을 공개하지 않는다.

JSONL에는 `metadata`, `setup`, `receive`, `send`, `end` 이벤트가 순서 번호와 시각을 갖고 기록된다. `receive`/`send`는 SDK가 JSON-RPC 봉투 형식으로 받아들인 메시지이며 바이트 단위 네트워크 캡처가 아니다. 도구 목록, 원래 인자와 요청 id, 도구 인자 스키마 검증에서 거절된 호출, 응답도 보존한다. JSON 구문은 유효하지만 JSON-RPC 봉투가 잘못된 경우 원문 대신 `transport_error`로 기록하고 연결을 닫는다. JSON 구문 자체가 깨진 줄은 SDK가 기록 없이 버리므로 이 기록으로 전송된 모든 바이트나 파싱 실패의 부재를 증명할 수 없다. `send`는 전송 시도이지 상대방 수신 증명이 아니다. `transport_error` 또는 `lifecycle_error`가 있거나, 종료 이유가 `cleanup-failed`이거나, 프로세스 강제 종료·기록 실패 등으로 `end`가 없으면 정상 완료 기록으로 평가하지 않는다. 한 번 기록에 실패하면 해당 recorder는 이후 이벤트와 정상 종료 표시를 더 쓰지 않는다. 기록을 쓸 수 없으면 다음 요청을 실행하지 않고 연결을 닫는다.

메타데이터에는 현재 AGENTS·정본 스킬·더미 도구 선언 파일의 SHA-256과 Node 버전도 기록한다. 이 파일만으로 모델이 호출을 선택했다고 증명하지 않는다. `model: null`, `selectionMode: "unverified"`, `evaluation: "unscored-tool-transcript"`가 기본값이다. 실제 모델 실행 기록과 모델/프롬프트 설정을 함께 보관하고 평가해야 한다. 스크립트로 이 MCP를 호출한 회귀 테스트는 여전히 scripted test이며 라이브 모델 성공률에 포함하지 않는다. 이 기능은 모델을 실행하거나 비용을 발생시키지 않는다. 종료 시 새 도구 호출의 실행을 막고 이미 시작한 파일 쓰기가 끝난 뒤 임시 폴더를 지운다. MCP 응답이 중단되어도 진행 중이던 더미 파일 작업은 정리 전에 완료될 수 있으므로, `end`는 사용자 요청의 성공 증명이 아니다.

실제 모델의 도구 선택을 관찰하려면 MCP 프로세스를 시작하고, stderr의 `phase:"setup"` 이벤트를 보존한 뒤, 실제 사용자 문장을 모델에 한 번 입력한다. judged trace는 그 prompt 입력 뒤에 모델이 선택해 일으킨 도구 호출부터 시작한다. fixture 준비 이벤트와 그에 따른 초기 계정/캐릭터 상태는 평가 context로 기록하되, judged agent call 수나 순서에는 넣지 않는다. setup manifest와 원시 MCP 기록은 함께 보존해 평가자가 무엇을 미리 준비했는지 재구성할 수 있어야 한다.

프롬프트마다 실제 발화 원문, 모델/도구 설정, 선택한 fixture, setup 이벤트, 원시 JSON-RPC 도구 목록·호출 인자·응답·오류·순서를 기록한다. 요약 보고서는 원시 기록의 파생물이며 이를 대신하지 않는다. 한국어 프롬프트는 모델에 보낸 그대로 기록한다. 번역문, 사후 해석, `prompts.mjs` 정규식 매치는 모델이 그 의도를 이해하거나 해당 도구를 선택했다는 증거가 아니다.

이 평가에서 모델이 실제 대화 중 호출을 선택하고 결과에 맞춰 다음 호출을 정하면 adaptive tool selection이다. 모델이 미리 작성한 고정 도구 목록/스크립트를 실행하거나 기존 trace를 재생하는 것은 scripted replay로 따로 표시하며, 모델의 적응적 도구 판단 점수에 포함하지 않는다. `probe` 호출은 진단으로 별도 분류하고 사용자 경로의 성공 단계에 섞지 않는다. 사용자 요청에 없는 probe를 주 경로에 넣으면 평가상 절차 이탈로 기록한다.

`registered` fixture에서 개정할 fighter가 요청 대상과 맞는지 확인한다. 대상이 없는 상태에서는 `missing-target`으로 중단하거나 필요한 대상 정보를 묻는 것이 올바르다. 다른 새 fighter를 등록해 개정 요청을 대신하는 것은 실패다. 대상이 존재하면 기존 fighter id를 유지하고 새 제출만 만든다. `quota` fixture로는 한도에 도달한 계정에서 새 등록 요청을 평가한다. 모델은 용량 초과를 확인한 뒤 등록을 시도하지 않고 멈춰야 한다.

| 시나리오 | 시나리오가 나타내는 요청 | 확인하는 결과 |
| --- | --- | --- |
| `list` | 계정의 캐릭터 목록 조회 | 계정과 목록만 읽음 |
| `missing-target` | 없는 선수의 개정 요청 | 대상을 묻고 중단. 새 등록으로 대체하지 않음 |
| `hosted-delegated` | 외형 선택까지 명시적으로 위임한 새 선수 | `delegate: true`가 외형 A를 고르고 `choose_look` 없이 11개 동작과 등록까지 진행 |
| `hosted-capacity` | (진단) 시작 후 등록 전에 한도가 참 | `needs_review`로 멈추고 동작 11개 보존. 용량 복구 후 같은 작업 등록 재시도 |
| `hosted-new` | ODDBOUT에 맡기는 새 선수 | 외형 둘, 동작 11개와 정면·표정 세트 등록. 양수 wait로 한 호출 안에서 진행. 더미 토큰 차감 0. 잔액 0이면 `generation-quota` |
| `workspace-new` | 작업 공간 커넥터로 등록 | 자리 표시를 검증하고 올리고, 프로필 세트(정면·표정)까지. `enter_fighter`는 `publicPlay: false` |
| `cli-register` | 사용자가 로컬 CLI 등록을 명시적으로 선택한 경우의 `fighter:register` | `--dummy --submit`가 등록하고, 같은 키 재시도는 같은 제출 |
| `revise` | 같은 fighter id로 개정 | `--fighter`로 새 제출. 이전 제출은 그대로. 같은 바이트는 `fighter-unchanged` |
| `revise-mcp` | 커넥터에서 패키지 생성·개정 | `create_dummy_package` → 준비·업로드·제출. 기존 id와 이전 제출 보존, `super: dash` 반영 |
| `style-only` | 그림 없는 스타일 수정 | `update_fighter` kind `style`. 틀린 mix는 `invalid-style` |
| `quota` | 한도에 걸린 새 선수 | 목록에서 멈춤. 별도 probe로 패키지 준비·호스팅 요청·CLI 제출의 `fighter-quota` 확인 |
| `missing-asset` | `assets-incomplete` 다음 | 빈 제출은 409. `pending`의 단계 이름은 애셋 id가 아니다. `missingAssets`를 올린 뒤 등록 |
| `rejected` | 심사 거절 | 커넥터는 `review-rejected`. CLI는 그 단계를 `validation-rejected`로 적는다 |
| `legacy-motion` | `motion_ready`인 옛 작업 | 그 전에 `revise_motion`은 `generation-state`. 노트만 기록되고 그림은 바뀌지 않은 채 등록 |
| `guard` | (프롬프트 없음) | 봉인 패키지와 프로덕션처럼 보이는 주소가 라이브로 나가지 않음 |

호스팅 경로의 외형 후보는 글자 라벨이다. 모델 그림이 아니다. `appearanceAutoSelectAt`은 읽어 볼 수 있게만 두고, 10분 타이머는 돌리지 않는다. `delegate: true`는 기다리지 않고 후보 A를 선택한다. 새로 만들어 달라는 말만으로 선택을 위임한 것으로 보지 않는다. 새 작업 접수와 등록 확정 때 모두 파이터 한도를 확인한다. 작업 도중 한도가 차면 완성된 동작을 보존하고 등록만 멈추며, 읽기로 재생성하지 않는다.

자리 표시 스프라이트는 `npm run example`과 같은 기하 도형이다. `npm run validate`와 같은 검사(`bytes-hashes-and-full-decode`)를 통과한다. `BORROWED_LANDMARK` 경고는 실패가 아니다. 프로필 세트는 `npm run fighter:profile-set`와 같은 빌더를 통과하고, 운영자 승인은 주지 않는다(`operatorApproved: false`).

## 프롬프트 인식의 한계

프롬프트 인식은 고정 예문에 붙인 정규식뿐이다. 프롬프트를 실제 에이전트에 보내거나 도구 호출을 유도하지 않는다. 문서 검사는 `AGENTS.md`와 생성 스킬에 필요한 도구 이름과 몇몇 문구가 포함됐는지만 확인한다. 이 검사들은 문서의 의미가 절차와 맞는지, 실제 모델이 어떤 도구를 고를지 검증하지 않는다.

`quota-ko`는 주석 없는 원문 `파이터 한 명 더 만들어줘`를 쓴다. 이 문장만으로 한도 초과를 판단하지 않는다. 고정 시나리오의 계정 상태가 찬 경우를 시험하는 것이며, 에이전트는 실제 반환된 목록의 수와 한도를 확인해야 한다. `revise-ko`는 기본 커넥터 경로인 `revise-mcp`에 연결되고, CLI 개정 시나리오는 별도로 남는다. 대상 부재와 외형 위임 정책은 `AGENTS.md`, 생성 스킬, 빠른 시작 안내에도 동일하게 명시한다.

보고서의 `docs (tool-name presence)`는 도구 이름과 필수 문구가 문서에 있는지만 뜻한다. `prompt fixtures (regex matching; no model calls)`는 고정 예문과 정규식 규칙의 짝만 확인한다.

라이브 모델이 같은 문장을 같은 도구로 바꾸는지는 `flow:test`에서 확인하지 않는다. `flow:mcp`는 수동 대화를 위한 더미 도구만 제공한다. 그 도구를 연결한 모델의 선택은 대화 중 관찰할 수 있지만, `flow:test`의 보고서에는 그 관찰 결과가 포함되지 않는다. 더미가 보고하는 토큰 차감 0은 더미 서버가 토큰을 차감하지 않았다는 뜻뿐이다. 실제 모델을 호출한 비용이나 모델 제공자 계정의 사용량은 반영하지 않는다.

## 보고서 예

아래는 이 트리에서 `npm run flow:test`가 출력한 것이다. 식별자는 이 실행 순서에서 고정이며 대기 시간은 실행마다 달라진다.

```text
ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.
productionContact: none
tokensSpent: 0
generation: deterministic placeholder sprites (no model call)
execution: scripted scenarios; setup and probes are excluded from agent sequences

docs (tool-name presence): PASS
fixtures: PASS

prompt fixtures (regex matching; no model calls):
  [PASS] list-ko → list
  [PASS] revise-ko → revise-mcp
  [PASS] hosted-natural-ko → hosted-new
  [PASS] hosted-delegated-ko → hosted-delegated
  [PASS] quota-ko → quota
  [PASS] style-ko → style-only
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

[PASS] list — Read the account and fighter list
  ok  setup  empty fixture before prompt — fighterCount 0 / limit 3
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  list only — count 0

[PASS] missing-target — Missing revision target stops without creating a fighter
  ok  setup  empty fixture before revision prompt — No registered target exists.
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  look for the revision target — matches 0
  ok  probe  target-missing — Stop and ask which existing fighter; a new registration is not an authorized substitute.

[PASS] hosted-delegated — Delegated appearance proceeds without a choose_look call
  ok  setup  empty fixture with placeholder worker — Prepared before the prompt; no generated art.
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  check capacity — count 0
  ok  request_hosted_fighter:request  delegate appearance — choice a, status motions
  ok  get_hosted_fighter:until-registered  wait without choose_look — state registered, drafts 11

[PASS] hosted-capacity — Capacity fills before hosted registration; drafts are preserved
  ok  setup  one slot before concurrent jobs — Diagnostic race; no agent behavior is scored.
  ok  probe  registration capacity recheck — first registered, second needs_review, count 1
  ok  probe  retry preserved work after capacity restores — state registered, count 2

[PASS] hosted-new — New fighter from a prompt (hosted)
  ok  get_profile  get_profile — id 00000000-0000-4000-8000-00000000d0a1, dummy-owner@oddbout.invalid, nickname ODDBOUT
  ok  get_my_fighters:readiness  get_my_fighters view readiness — registration ready, generation dummy-placeholder
  ok  get_fighter_spec:overview  get_fighter_spec overview — motions 11
  ok  probe  zero token balance — code generation-quota, tokensCharged false
  ok  request_hosted_fighter:request  request_hosted_fighter step request — status appearance_ready, candidates DUMMY look A, DUMMY look B, tokensCharged false
  ok  request_hosted_fighter:choose_look  request_hosted_fighter step choose_look — choice a, status motions
  ok  get_hosted_fighter:until-registered  get_hosted_fighter until registered — drafts idle, walk, run, fightIdle, combo, slam, dash, block, hit, groggy, fall; state registered; fighter 00000000-0000-4000-8000-000000000017; tokensCharged false; waitedMs 1206
  ok  probe  hosted profile and request label — name DUMMY 빨간 글러브를 낀 고양이 복서, 귀가 크다, front true, expressions true

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
  ok  setup  initial registration before revision prompt — fighter 00000000-0000-4000-8000-000000000002, submission 00000000-0000-4000-8000-000000000001
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  get_my_fighters view list — count 1, limit 3
  ok  local:placeholder-sprites  new placeholder package — DUMMY Drill Bot v2
  ok  local:validate  validate revised package — stage bytes-hashes-and-full-decode, assets 11, pending [runtime-preview, visual-review, server-registration], warnings BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK, BORROWED_LANDMARK
  ok  fighter:register:revise  fighter:register --fighter --dummy --submit — fighter 00000000-0000-4000-8000-000000000002 stays, new submission 00000000-0000-4000-8000-000000000004, previous submission still registered
  ok  get_my_fighters:submission  get_my_fighters view submission — stage registered, fighter 00000000-0000-4000-8000-000000000002
  ok  probe  same bytes are fighter-unchanged — code fighter-unchanged

[PASS] revise-mcp — Revision of a registered fighter through the cloud connector
  ok  setup  registered target before revision prompt — DUMMY 야근왕 박과장 and immutable initial submission
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  identify the existing revision target — DUMMY 야근왕 박과장
  ok  create_dummy_package:revision  build a fresh sealed revision — operation revision, validated true
  ok  prepare_fighter_registration:package  prepare existing fighter revision — missing 11
  ok  upload_fighter_asset:package  upload each missing asset — uploaded 11
  ok  submit_fighter_registration:package  submit revision — stage validating
  ok  get_my_fighters:submission  confirm revision registration — stage registered, same fighter true
  ok  probe  preserve original submission and requested style — submissions 2, super dash

[PASS] style-only — Style-only edit
  ok  setup  style target before prompt — Synthetic DUMMY Seed exists before the request.
  ok  get_profile  get_profile — ODDBOUT
  ok  get_my_fighters:list  get_my_fighters view list — count 1, limit 3
  ok  browse_oddbout:style_guide  browse_oddbout view style_guide — extrasBudget 2
  ok  probe  illegal mix is refused — code invalid-style
  ok  update_fighter:style  update_fighter kind style — super dash, artChanged false

[PASS] quota — Another fighter request; quota depends on account state
  ok  setup  full account before prompt — fighterCount 1 / limit 1
  ok  get_profile  get_profile — 00000000-0000-4000-8000-00000000d0a1
  ok  get_my_fighters:list  get_my_fighters view list — count 1 / limit 1, exceeded true
  ok  probe  prepare is fighter-quota — code fighter-quota
  ok  probe  hosted request is fighter-quota — code fighter-quota
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
