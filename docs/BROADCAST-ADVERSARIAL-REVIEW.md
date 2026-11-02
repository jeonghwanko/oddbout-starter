# Broadcast Sandbox 적대적 리뷰 및 수정

2026-11-02, Asia/Seoul. 대상은 이번 세션의 `codex/paypal-agent-broadcast`와 별도 Cup `codex/paypal-broadcast-renderer` 작업 트리다. 기존 검사 통과만으로 안전하다고 판단하지 않고, 잘못된 주문·다른 작업 결과·동시 탭·만료·환불·iframe 교체를 입력해 실패 조건을 확인했다. 운영 배포와 실제 결제·송출은 실행하지 않았다.

## 1차: 재현하고 수정한 문제

| 우선순위 | 재현 조건과 영향 | 수정 및 회귀 확인 |
| --- | --- | --- |
| P1 | 승인된 PayPal 주문의 금액·수취인·내부 참조가 다를 때도 캡처부터 호출하고 나중에 재화 지급을 거절 | `api/commerce/service.mjs`, `paypal.mjs`에서 캡처 전 전체 주문 연결을 확인. 불일치 주문은 캡처 호출 0회 확인 |
| P1 | 대진과 승자만 있는 객체, 다른 작업·lease·seed의 결과가 성공 정산에 사용될 수 있음 | 실행기, worker HTTP, PostgreSQL 정산 각각에서 protocol/job/fence/seed 및 3경기의 승자·시간·HP·접촉·digest 검사. 실제 PGlite에서 불완전·오래된 증거는 거절하고 올바른 결과만 한 번 정산 |
| P1 | 로컬 프로듀서가 일반 사용자 JWT를 가지면 MCP 도구 제한 밖의 웹 승인 API에도 접근 가능 | 로컬 `/mcp`를 별도 `obp_` 자격 증명으로 변경. 한 사용자·이미 승인된 세션·만료 시간에만 연결하고 6개 도구만 제공. 일반 JWT를 MCP에서 거절하고, `obp_`로 Origin/confirmed를 위조한 웹 승인 요청도 401 확인. 운영 cloud MCP는 기존 계약 유지 |
| P1 | 검증된 환불·결제 취소 통지를 처리하지 않아 이미 지급한 재화를 계속 소비 가능 | 서명 검증 후 원래 capture/order 연결과 event ID를 기록하고 지출 동결. 신규 충전·승인·작업 및 진행 중 실행의 갱신·정산 차단. 자동 현금 환불·차감·동결 해제는 하지 않음 |
| P1 | 서로 다른 세션/worker/state 파일로 동일 호스트에 동시에 작업 배정 가능 | host 전체에 running/unknown 작업 1개만 허용. claim 조건과 DB 부분 unique index 모두 적용. 불명확한 기존 작업이 있으면 새 작업 차단 |
| P1 | 두 탭이 같은 localStorage 상태를 읽고 다른 request key로 유료 작업을 전송하거나 늦은 응답이 새 작업 기록을 삭제 | 계정 단위 Web Locks로 실행을 직렬화하고 이미 처리 중이면 두 번째 탭 거절. 기록 변경·삭제는 원래 key가 일치할 때만 허용. 실제 Chrome 두 탭에서 요청 1개 확인 |
| P1 | iframe 새 문서가 기존 경기 ID 처리 이력을 잃고 host-ready를 다시 보내면 같은 경기 재실행 가능 | 문서 identity가 바뀌면 불명확한 실패로 종료하고 iframe/listener 정리. 실제 Chrome 공격에서 시작 1회, 완료 경기 0회, 재실행 0회 확인 |
| P1 | arena URL이 다른 문서로 redirect/navigation된 뒤 맞는 모양의 결과를 반환할 수 있음 | 실행 전후 정확한 arena URL 확인. 실행 전 이동은 확정 실패, 실행 후 이동은 unknown으로 처리 |
| P2 | 복구한 checkout 링크는 신규 주문보다 약하게 검사되어 다른 주문 token 또는 다른 PayPal 경로 허용 | 신규/복구에 동일한 정확한 Sandbox origin·path·order token 검증 적용 |
| P2 | Twitch 계정 검증 없이 임의 channel 문자열을 먼저 등록하여 다른 사용자 세션을 막을 수 있음 | 현재 렌더링 모드의 channel은 사용자별 세션 라벨로 제한. UI·quote·report에 Twitch 소유권 미검증 표시. 실제 송출 권한으로 사용하지 않음 |
| P2 | heartbeat나 응답 본문이 멈추면 종료 대기, SSH 스트림 오류 뒤 자식 프로세스 생존 가능 | 요청·본문 크기/시간 제한, 종료 중 대기 상한, 소유한 SSH 프로세스 종료 처리. 원격 종료를 관측할 수 없으면 unknown 유지 |
| P2 | 확정 입력 거절 뒤에도 잘못된 요청이 영구 고정되거나, 비활성/동결 상태에 실행 버튼이 활성화됨 | 확정 전제조건 거절만 새 입력을 허용하고 네트워크/결제 불명확 오류는 원래 key 유지. 설정·PayPal·지갑 동결 상태에 맞춰 버튼과 설명 표시. 로그아웃 시 이전 계정 결과도 화면에서 제거 |

각 회귀는 외부 네트워크 경계만 통제하고 원장·상태 규칙을 실행했다. 정상처럼 생긴 worker 결과를 독립적으로 재시뮬레이션하거나 서명하는 구조는 아니다. worker 호스트와 자격 증명은 여전히 신뢰 경계다.

## 1차 검증

- starter 관련 통합 검사 **138개 통과**: `node --test test/commerce-*.test.mjs test/broadcast-*.test.mjs test/edge-bundle.test.mjs test/cloud-mcp.test.mjs test/migration-rules.test.mjs`.
- `npm run typecheck`, `git diff --check`, 두 Edge entrypoint의 `deno check --frozen` 통과.
- `npm run broadcast:check-ui`: 실제 Chrome/Web Locks, 테스트 인증·HTTP 응답으로 미설정 버튼, 두 탭 중복 차단, 확정 거절/불명확 실패 복구, 동결 표시, 로그아웃 확인. 실제 PayPal 거래 검사는 아니다.
- 별도 Cup `npm run check`: **135개 테스트**, 타입 검사, 빌드 통과.
- 실제 Chrome에서 세 경기 **123.687초**, seed 123/124/125의 digest `4c99b17b`, `51cbeb4f`, `3d090aff` 유지. 같은 작업 재요청에서 경기 수 3개 유지. iframe reload 공격도 별도 실행해 재실행 차단 확인.

## 2차: 재현하고 수정한 문제

같은 날 검토 담당을 바꾸어 결제 원장, 실행기, 브라우저의 재시도·종료·권한 만료 경계를 다시 검사했다. Sol 6.1은 구현과 회귀 검사를, Luna 6은 계약·문서 대조를 맡고 통합 담당자가 수정 소스와 최종 검사 결과를 확인했다.

| 우선순위 | 재현 조건과 영향 | 수정 및 회귀 확인 |
| --- | --- | --- |
| P1 | 첫 유료 요청 응답이 유실된 뒤 같은 키의 재시도가 401이면 기록을 삭제했다. 새로고침 후 새 키로 보내므로 이전 작업과 중복 실행·정산될 수 있음 | `web/broadcast/operations.mjs`, `app.mjs`에서 fetch 전에 dispatched 표시를 영속화. 이미 보낸 시도가 있으면 이후 거절도 원래 키를 유지. 실제 Chrome에서 응답 유실 → 401 → 새로고침 → 같은 키 복구 확인. 표시가 없는 이전 기록도 불명확한 시도로 취급 |
| P1 | 서명 검증된 환불·취소가 로컬 capture 연결보다 먼저 오면 기록 없이 거절했다. 뒤늦은 COMPLETED 응답이 재화를 지급하면 환불된 결제로 지출할 수 있음 | `api/commerce/service.mjs`, 원장 migration에 소유자를 추측하지 않는 append-only adjustment inbox 추가. canonical capture를 연결하는 동일 트랜잭션에서 일치하는 이벤트만 대조·지출 동결. 주문 생성 전·연결 전·capture 응답 유실·중복·불일치를 PGlite로 확인 |
| P1 | 세 경기 결과를 받은 뒤 소유한 Chromium 종료가 실패해도 성공 정산하고 호스트 자리를 해제 | `broadcast/runner.mjs`에서 종료 확인 실패를 unknown으로 유지하고 관찰한 결과 증거를 보존. 실제 worker HTTP + PGlite에서 차감 0, 새 claim 차단, Stop 이후에도 25 credits 보류 확인. 취소 뒤 늦게 생성된 브라우저를 두 번 닫던 경로도 종료 promise 공유로 1회만 실행 |
| P2 | 같은 계정으로 로그아웃·재로그인하면 이전 wallet 응답이 새 잔액을 덮어씀. 세션 선택 변경 뒤 늦은 report가 다른 선택 아래 표시될 수 있음 | 계정 ID 외에 로그인 세대의 journal identity와 refresh revision·선택 ID를 함께 검사. 실제 Chrome에서 늦은 wallet/report 응답을 해제해 새 화면을 덮어쓰지 않음을 확인 |
| P2 | 이미 취소된 모델 요청이 전송되고, transport가 취소 신호를 무시하면 fetch/body 또는 모델 대기가 승인 마감 이후에도 지속 | `broadcast/producer.mjs`에 전송 전 취소 검사, 독립적인 요청·본문 대기 상한, 승인 deadline에 연결한 모델 대기 제한 추가. 결과 불명확 시 model-pending 기록을 유지하고 cup을 enqueue하지 않음 |
| P2 | producer grant 확인 후 요청 본문을 지연시키면 만료 뒤에도 tools/list를 처리 | `mcp/cloud/commerce-handler.mjs`에서 본문 읽기를 10초 또는 더 짧은 권한 유효기간으로 제한하고 SDK 호출 전에 권한 재검사. 중단된 body 취소와 확인할 수 없는 시계의 거절도 검증 |
| P2 | 공개 브라우저 키 설정에 service-role JWT 또는 secret 키를 잘못 넣으면 인증 없는 config 응답으로 노출 | `scripts/broadcast-demo.mjs`가 기존 공개 키 검사기를 사용해 서버 시작 전에 잘못된 키를 거절. 유효한 publishable/anon 키만 반환하고 오류에 키를 포함하지 않는 회귀 검사 추가 |

Cup iframe이 실패·취소된 뒤 다음 작업을 오염시킨다는 가설은 재현되지 않았다. 기존 코드가 새 프레임에서 문서 identity를 초기화하고 있었으며, 이전 프레임의 늦은 메시지를 무시하고 새 컵의 세 경기가 완료되는 회귀 검사 2개만 추가했다.

## 2차 최종 검증

- starter 관련 통합 검사 **151개 통과**: `node --test test/commerce-*.test.mjs test/broadcast-*.test.mjs test/edge-bundle.test.mjs test/cloud-mcp.test.mjs test/migration-rules.test.mjs`. 위 runtime/producer·원장 회귀 검사를 포함한 수치다.
- `npm run broadcast:check-ui` **1개 시나리오 통과**: 실제 Chrome에서 두 탭, 최초 거절과 불명확한 재시도, 같은 계정 재로그인, 세션 선택 후 늦은 응답까지 확인. 인증과 서버 응답은 fixture이며 실제 외부 거래가 아니다.
- `npm run typecheck`, 두 Edge entrypoint의 `deno check --frozen`, 양쪽 작업 트리 `git diff --check` 통과.
- 별도 Cup `npm run check`: **137개 테스트**, 타입 검사, 프로덕션 빌드 통과. 2차에는 Cup 애플리케이션 코드 변경이 없어 1차의 실제 세 경기 렌더링 측정을 반복하지 않았다.
- 실제 PayPal·모델 API·원격 SSH 실행·OBS/Twitch 송출이나 배포는 수행하지 않았다. 로컬 검사는 원격 CI 결과를 대신하지 않는다.

## 3차: 재현하고 수정한 문제 (2026-11-03)

#264 병합 뒤 다른 담당(Claude)이 원장·PayPal·배포 경계를 직접 읽고, runner/producer와 Cup renderer는 별도 검토자 둘이 PGlite·실제 runner 코드로 재현했다. 1·2차 목록을 다시 확인하는 대신 그 밖의 실패를 찾았다. 세 검토가 독립적으로 같은 결론에 닿았다: `unknown` 작업 하나가 그 호스트를 영구히 막고(호스트당 running/unknown 1개 unique index), 해제할 경로가 없었다.

| 우선순위 | 재현 조건과 영향 | 수정 및 회귀 확인 |
| --- | --- | --- |
| P1 | 운영 배포 경계: Sandbox 원장 SQL이 `supabase/migrations/`에 있어 운영 DB 절차와 배포 drift watch가 "적용 안 된 운영 migration"으로 셌다. 운영 `ai-fighter`/`ai-fighter-mcp` 진입점에 commerce가 연결됐지만 그 Edge에는 worker API가 없어 켜도 컵이 실행되지 않는다 | SQL을 `supabase/sandbox/`로 옮기고(safeupdate 규칙은 계속 검사), 운영 진입점 4개 파일을 #264 이전 바이트로 되돌림. 세 운영 import graph(ai-fighter 36, ai-fighter-mcp 43, Render 18개 파일)가 `f17fcc0^1`과 파일 단위로 같음을 확인 |
| P1 | 사용자가 컵 도중 Stop을 누르면 `renew_job`이 `broadcast-stopped`로 거절해 runner가 컵을 중단하고 `unknown` 보고 → 호스트 영구 차단 | Stop 중(`stopping`)에도 renew 허용. 실행 중 컵은 끝까지 진행해 성공 시 정산, 나머지는 해제(PGlite) |
| P1 | 마감 직전에 집은 컵(약 124초)은 lease가 `ends_at`에서 끊겨 반드시 `unknown` | claim이 남은 시간 240초 미만이면 거절, catalog `startWindowSeconds`로 같은 값을 공개. 남은 queued 컵은 마감 때 실패·해제(PGlite). producer는 그 구간에서 모델을 부르지 않음 |
| P1 | claim 응답 유실(ECONNREFUSED·401 포함)이 `claim-pending`을 남기고 재시작마다 `runner_reconciliation_required` | worker API `status`로 기록의 worker ID가 가진 작업을 조회: 없으면 해제, 잡혀 있으면 렌더하지 않았으므로 `failed`. 4xx 거절·연결 거부는 확정으로 기록을 지움. 실제 worker API + PGlite에서 유실 → 재시작 → `failed`·과금 0·호스트 해제 확인 |
| P1 | renew 응답 하나만 잃어도 컵 중단, 완료 응답 유실은 재시도 없음 | lease가 남는 동안 불확실한 renew 실패 허용(거절은 즉시 중단). 같은 완료 보고를 세 번까지 재전송. 재시작 시 저장된 완료 보고 재전송 |
| P1 | `unknown` 해제 경로 없음 | 원장 `release_job`(service role 전용, HTTP 경로 없음)과 `scripts/broadcast-release.mjs`: 과금 없이 `failed`로 닫고 호스트·할당 반환, 메모 필수 |
| P1 | 아직 아무것도 화면에 보내지 않은 컵이 중단되거나(마감·Stop), 경기 페이지가 직접 `broadcast_execution_failed`(팩 로드 실패, 부팅 watchdog, 최소화된 창)라고 답해도 `unknown` | 미발송·페이지 확정 실패는 `failed`(과금 없음). 브라우저가 닫히거나 응답을 잃은 경우는 계속 `unknown` |
| P2 | PayPal 환불 webhook 샘플은 capture를 `links[rel=up]`으로만 가리키는데 코드는 `supplementary_data.related_ids.capture_id`만 읽음 → 실제 환불이 계속 422로 기록되지 않을 수 있음(미확인: 제3자 샘플·PayPal 환불 문서 기준, 실제 Sandbox 환불 미실행) | up 링크(PayPal Sandbox API origin만)도 받고, 둘 다 있으면 일치해야 함 |
| P2 | producer가 `wait` 뒤 컨텍스트가 변하지 않아 세션 끝까지 다시 묻지 않음 | 남은 시간(5분 단위)과 컵 시작 구간을 컨텍스트에 넣어 5분마다 다시 판단 |
| P2 | 원격 doctor가 runner와 달리 `remoteEnvFile`을 읽지 않아 OBS 미설정으로 오판, 로컬 환경을 ssh에 넘길 수 있음 | doctor에도 `--env-file`과 `SendEnv=-*` |

확인했지만 문제가 없던 것: SSH 명령 주입, 상태 파일 경로, 비밀값 노출, producer prompt injection, postMessage origin/source·재생, 결과와 렌더 불일치, XSS, 이중 실행·이중 과금. Cup 쪽 P2(경기 사이 승자 화면이 바로 잘림)는 별도 Cup 저장소 PR로 다룬다.

### 3차 검증

- starter `npm run test:fast`: 827개 중 820 통과, 6 건너뜀, 1 실패. 실패한 `host/og-user-mode.test.mjs`의 process-group 신호 검사는 이 VM에서 #264 이전 커밋(`f17fcc0^1`)에서도 같게 실패한다.
- `npm run typecheck` 통과. 실제 PayPal·모델 API·SSH·OBS 송출과 운영 배포는 실행하지 않았다.

## 남은 운영 한계

- 실제 PayPal Sandbox 거래와 실제 Twitch/OBS 송출, 24시간 연속 운전은 아직 검증하지 않았다. `--live`는 차단되어 있다.
- `unknown` 작업은 `scripts/broadcast-release.mjs`로 과금 없이 해제한다(3차). 환불 동결을 푸는 운영자 경로와 UI는 아직 없다. 자동 현금 환불·원장 차감도 구현하지 않았다.
- 강제 종료로 남은 `.lock`은 같은 호스트에서 프로세스 종료를 확인한 운영자가 처리해야 한다. 원래 JSON 상태와 request key를 삭제하거나 새 키로 재시도하지 않는다.
- 로컬 producer grant는 서버에서 별도로 설정해야 하며 자동 발급·갱신하지 않는다. 브라우저 승인과 계정 토큰을 프로듀서에 넘기는 방식으로 대체하지 않는다.
- 원장 RPC는 전역 mutex를 사용하는 초기 구현이다. 다수 방송자의 운영 처리량은 별도 부하 검증과 개선이 필요하다.

실행·복구 방법은 [BROADCAST-SANDBOX](BROADCAST-SANDBOX.md)를 따른다. 변경은 작업 트리에 있으며 commit/push/deploy는 하지 않았다.
