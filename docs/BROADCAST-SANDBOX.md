# Broadcast Sandbox 로컬 실행 안내

이 안내는 현재 `oddbout-starter` 코드에서 확인되는 경로만 설명한다. 아직 PayPal 실결제·실제 Twitch 송출·24시간 운전 완료를 뜻하지 않는다.

## 1. 설치와 UI 미리보기

필요 조건은 Node.js 22.12 이상과 npm이다.

```powershell
npm ci --ignore-scripts
npm run broadcast:dev
```

기본 로컬 주소는 `http://127.0.0.1:5180/broadcast/`이다. 이 서버는 loopback에만 바인딩한다. 브라우저에서 열면 UI를 볼 수 있다.

DB와 Sandbox 설정 없이 실행하면 `preview-unconfigured` 모드다. 이 화면은 연결·잔액·결제·방송 성공을 시뮬레이션하지 않는다. 계정 인증과 실제 작업은 사용할 수 없다. `Ctrl+C`로 서버를 종료한다. 기본 포트를 바꾸려면 실행 전에 `ODDBOUT_BROADCAST_PORT`를 설정한다. `ODDBOUT_COMMERCE_ORIGIN`을 지정할 때는 브라우저 주소와 정확히 같은 origin이어야 한다.

## 2. Sandbox 백엔드 준비

충전·계정 기능을 켜려면 테스트 전용 Supabase 프로젝트와 PayPal Sandbox 앱이 별도로 필요하다. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`는 데모 서버가 읽는다. 서비스 역할 키는 서버 프로세스에만 설정하고 브라우저에 전달하지 않는다. 공개 browser key는 repository의 `isPublishableKey` 검사를 통과해야 하며, service-role JWT와 `sb_secret_` 같은 secret key를 넣으면 서버 시작을 거부한다.

먼저 테스트 전용 Supabase 프로젝트임을 프로젝트 참조 ID와 대시보드에서 확인한다. 아래 migration은 `commerce` 지갑·원장·예산·작업 schema와 RPC를 만든다. 이 SQL을 **격리된 개발/데모 프로젝트에만** 적용한다.

- `supabase/sandbox/20261102115107_commerce_broadcast_ledger.sql`
- 운영 또는 기존 프로덕션 프로젝트에 적용하지 않는다. 그래서 이 파일은 `supabase/migrations/` 밖에 있다: 운영 DB 절차·`supabase db push`·배포 drift watch는 이 SQL을 보지 않는다. 대상 프로젝트를 확인하고 SQL 편집기 등으로 이 파일 하나만 실행한다.
- 운영 `ai-fighter`·`ai-fighter-mcp` Edge 함수와 Render는 commerce를 싣지 않는다(2026-11-03). Sandbox API·producer MCP·worker API는 `scripts/broadcast-demo.mjs` 서버에서만 돈다.

서버 환경 변수는 코드의 실제 이름과 조건을 따른다.

| 변수 | 용도와 동작 |
| --- | --- |
| `ODDBOUT_COMMERCE_ENABLED=1` | commerce API/MCP를 생성한다. 없으면 UI는 preview-unconfigured 경로를 쓴다. |
| `ODDBOUT_COMMERCE_ORIGIN` | 브라우저 origin과 PayPal 복귀 주소. HTTPS 또는 로컬 loopback이어야 한다. |
| `ODDBOUT_BROADCAST_HOST_IDS` | 예: `current-pc,office-stable,svl-mac-01`; 구성 가능한 호스트 ID 목록이다. ID가 있다고 호스트가 준비된 것은 아니다. |
| `SUPABASE_URL` | 격리 프로젝트의 URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | 격리 프로젝트용 서버 비밀키. 브라우저에 공개하지 않는다. |
| `SUPABASE_PUBLISHABLE_KEY` | 브라우저 로그인 클라이언트용 publishable/anon 공개 키. Secret/service-role 키는 서버 시작 시 거부한다. |
| `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, `PAYPAL_SANDBOX_MERCHANT_ID` | PayPal Sandbox API 설정. 세 값은 모두 설정하거나 모두 생략한다. |
| `PAYPAL_SANDBOX_WEBHOOK_ID` | PayPal webhook 검증용 ID. webhook을 쓸 때 Sandbox webhook endpoint의 ID를 설정한다. |
| `ODDBOUT_BROADCAST_PORT` | 로컬 서버 포트; 기본 `5180`. |
| `ODDBOUT_BROADCAST_WORKERS_JSON` | worker API가 허용할 호스트별 worker token 설정 JSON. 비밀 토큰을 공개 문서·브라우저·저장소에 넣지 않는다. |
| `ODDBOUT_BROADCAST_PRODUCERS_JSON` | 이미 승인된 세션 하나에 묶는 local producer grant 목록. 비어 있으면 `/mcp` producer 인증은 fail-closed다. 형식은 아래 설명을 참고한다. |

`.env.example`은 비밀값이 없는 템플릿이다. `.env`가 아직 없을 때만 복사하고 기존 파일은 보존한다. 실제 값을 문서나 소스에 붙이지 말고 개발용 `.env` 또는 프로세스 환경에만 설정한다. `.env`는 Git에서 제외된다. npm 별칭은 `.env`를 자동 로드하지 않으므로 파일을 쓸 때는 Node `--env-file`로 명시한다.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
node --env-file=.env scripts/broadcast-demo.mjs
```

서버는 기본적으로 `127.0.0.1`에 바인딩한다. PayPal 복귀는 HTTPS 주소 또는 `localhost`/loopback 주소만 허용한다. 공개 호스팅은 이 개발 서버를 외부에 그대로 노출하는 절차가 아니며, TLS와 운영 설정을 따로 준비해야 한다.

## 3. 방송 호스트 점검

샘플 호스트 목록은 `deploy/broadcast-hosts.example.json`이다. 복사본을 만들고 실제 선택 호스트만 구성한다.

```powershell
Copy-Item deploy/broadcast-hosts.example.json deploy/broadcast-hosts.json
node --env-file=.env scripts/broadcast-host.mjs --doctor --host current-pc --config deploy/broadcast-hosts.json
```

`current-pc` 항목의 OBS WebSocket URL, `obsPasswordEnv` 변수명을 채우고 해당 비밀번호를 **그 호스트 프로세스 환경**에 설정해야 한다. 샘플은 접속 URL이 비어 있으므로 그대로면 준비되지 않은 결과가 정상이다. OBS에서 WebSocket 서버를 켠 뒤 URL은 `ws://localhost:포트` 또는 `wss://...` 형태를 사용한다.

`office-stable`와 `svl-mac-01`은 SSH 호스트 별칭, 절대 POSIX `repoRoot`, Node 실행 경로, OBS URL을 갖춰야 한다. doctor는 strict host-key checking과 batch SSH를 사용하며, Windows 호스트의 SSH 실행은 지원하지 않는다. 원격 doctor 명령도 선택 호스트에서 읽기 전용 Node 스크립트만 실행한다.

`status: ready`는 Node 버전과 OBS WebSocket 연결 및 상태 조회가 성공했다는 뜻이다. 결과에는 `broadcastVerified: false`가 유지된다. 실제 Twitch ingest, stream key, 장면, 송출 또는 연속 가동은 검증하지 않는다. 원격 접근 자격 증명은 로컬 SSH 설정에서 관리한다. 진단 JSON이나 보고서에 자격 증명을 기록하지 않는다.

로그인 계정은 ODDBOUT 계정일 뿐 Twitch 방송자 신원이나 채널 소유권을 증명하지 않는다. 채널 필드는 개인 rehearsal label이며, 승인·보고는 해당 로그인 계정과 선택한 host에 묶인다. Twitch identity와 live output은 검증되지 않았고, 브라우저에 stream key를 입력하지 않는다. 동일 계정의 동시 변경 요청은 Web Locks와 요청 키로 조정한다. Web Locks를 지원하지 않는 브라우저에서는 결제·승인·시작·컵 요청을 fail-closed 처리한다. 서로 다른 host의 작업은 별도 host lease로 구분되며, 같은 host의 기존 running/unknown 작업은 해결될 때까지 해당 host slot을 점유한다.

## 4. 현재 실행 모드와 한계

host runner는 선택 호스트의 그래픽 세션에서 실행한다. 로컬 설정·서버와 승인된 작업·worker token·OBS WebSocket·`ODDBOUT_BROADCAST_API_ORIGIN`, `ODDBOUT_BROADCAST_WORKER_TOKEN`, `ODDBOUT_BROADCAST_ARENA_URL`가 필요하다. Linux는 `DISPLAY` 또는 `WAYLAND_DISPLAY`가 필요하다. arena URL은 쿼리가 없는 `/broadcast.html` 경로여야 하며 페이지가 `window.oddboutBroadcast.runCup`을 제공해야 한다. 이 starter 개발 서버는 경기 페이지를 제공하지 않으므로 호환되는 게임 페이지가 별도로 필요하다. Playwright의 visible Chromium도 runner 호스트에 설치되어 있어야 한다. 기본 상태 파일은 `.oddbout-broadcast/<hostId>.json`이고 실행 중복을 막는 lock을 둔다.

```powershell
node --env-file=.env scripts/broadcast-runner.mjs --host current-pc --config deploy/broadcast-hosts.json --once
```

SSH 호스트는 선택한 호스트 inventory를 로컬에서 읽고, foreground SSH로 그 호스트에서 runner를 실행한다. `--config`는 이 PC의 inventory이며, `--remote-config`는 원격 checkout 안의 POSIX 상대 경로다. 원격 runner에는 checkout에 둔 `remoteEnvFile`(예제 기본값 `.env.broadcast.local`)을 Node `--env-file`로 읽게 할 수 있다. 그 파일은 원격 호스트에 따로 만들고 비밀값이 공개되지 않게 보호한다. 로컬 자격증명은 SSH 명령으로 전달하지 않는다.

```powershell
npm run broadcast:runner -- --host office-stable --config deploy/broadcast-hosts.json --remote-config deploy/broadcast-hosts.json --once
```

원격 checkout의 경로·코드 버전과 inventory, `remoteEnvFile` 경로는 그 호스트에 맞게 준비해야 한다. SSH는 strict host-key checking과 batch 모드로 한 번만 연결한다. 이는 실행 호스트 선택을 전달하는 개발 명령이며, remote doctor의 `ready`만으로 경기·송출 성공을 뜻하지 않는다. 개발 demo 서버는 loopback-only이므로 원격 host runner에 도달할 수 없다. 원격 실행에는 해당 host에서 접근 가능한 별도 HTTPS commerce/worker API와 공개 arena 페이지를 준비하고, 그 주소를 원격 env file에 설정해야 한다. 이 경로는 production 배포 안내가 아니다.

현재 `--live` 옵션은 `runner_live_channel_unverified`로 종료된다. runner가 저장하는 관측은 render-only이며 Twitch 방송 증거가 아니다. 따라서 현재 코드로 실제 24시간 방송을 입증할 수 없다. 작업을 claim하고 렌더한 사실을 Twitch 송출이나 시청으로 표현하지 않는다.

화면의 host 목록은 설정된 ID를 보여줄 뿐이며 서버 측 실제 준비도 확인을 보장하지 않는다. producer context도 호스트 준비와 live time을 `unverified`로 취급한다. OBS doctor 성공만으로 방송을 시작할 준비가 끝났다고 판단하지 않는다.

방송 session deadline 처리는 백그라운드 cron/daemon이 아니라 성공한 DB RPC에서 관찰될 때 수행하는 bounded maintenance다. 만료된 session이 관찰되면 실행 전 queued 컵은 취소되고 queued 및 미사용 reservation이 해제된다. lease가 만료된 running 작업은 audience outcome이 불명확하므로 `unknown`으로 남고 해당 credit은 계속 보류된다. 따라서 만료된 미실행 예산을 반환하려고 별도 `Stop` 호출이 필요하지는 않지만, 알 수 없는 실행 결과의 credit을 자동 해제하지 않는다.

설정이 없으면 commerce 동작이 비활성화되고, PayPal Sandbox가 빠진 경우 top-up과 결제 확인만 비활성화된다. wallet이 지출 동결 상태면 UI에서 top-up·승인·시작·컵 작업을 막고 stop/report를 남긴다. 서명 검증된 환불·reversal webhook이 아직 local ledger에 연결되지 않은 capture를 가리키면 owner 없는 append-only inbox에 이벤트가 기록되고 webhook 응답은 `recorded: true`, `applied: false`로 반환된다. 이후 정식 capture가 연결될 때 inbox 이벤트를 같은 database transaction에서 ledger에 연결하고 wallet spending freeze를 적용하므로 조정 이벤트와 spendable credit 사이에 관측 가능한 미동결 구간을 두지 않는다. 이미 credited capture와 연결된 webhook은 계정 지출을 동결하고 현재 실행 중인 작업을 `unknown`으로 보류한다. 이 처리는 현금 환불을 실행하거나 잔액을 자동 차감·조정·해제하지 않는다. 추가 지출은 신뢰된 수동 reconciliation 전까지 동결 상태로 남으며, 해당 운영자 경로는 아직 제공되지 않는다. 이는 PayPal Sandbox 경로에 대한 코드·PGlite 검사일 뿐 실제 provider webhook이나 결제를 검증한 것이 아니다.

## 5. 선택형 AI producer

producer는 승인된 broadcast ID에 대해서만 실행한다. 서버가 부여한 승인·호스트·선수·가격 범위 안에서 `host_cup`, 대기, 중지 중 하나를 선택하며 결제·예산 승인·host 변경·임의 도구 호출을 하지 않는다. 같은 상태에서 모델을 반복 호출하지 않도록 checkpoint와 호출 상한을 둔다.

필수 환경 변수는 `ODDBOUT_BROADCAST_MODEL`, `OPENAI_API_KEY`, `ODDBOUT_BROADCAST_MCP_URL`, `ODDBOUT_BROADCAST_MCP_TOKEN`이다. 모델과 계정은 사용자가 선택해 설정한다. MCP token은 `ODDBOUT_BROADCAST_PRODUCERS_JSON`에 등록한 해당 broadcast의 `obp_` producer grant와 일치해야 한다. 격리 서버 설정과 producer credential은 로컬 `.env` 또는 비밀 저장소에서만 설정하며 일반 대화에 붙여 넣지 않는다. 별도 지시가 없으면 `ODDBOUT_BROADCAST_MAX_MODEL_CALLS` 기본값은 24, `ODDBOUT_BROADCAST_MAX_OUTPUT_TOKENS` 기본값은 600이며 상한 설정을 바꿔도 실제 provider 가격은 달라질 수 있다. 모델 요청은 승인된 session deadline을 넘지 않도록 bounded되며, deadline을 넘긴 응답은 cup enqueue하지 않는다.

```powershell
node --env-file=.env scripts/broadcast-producer.mjs --broadcast <approved-broadcast-uuid> --once
```

`--once`를 빼면 상태가 바뀔 때까지 polling한다. 중지하려면 `Ctrl+C`를 누른다. OpenAI API 호출 비용은 PayPal Sandbox 크레딧·방송 원장에 포함되지 않으며 별도로 청구될 수 있다. 알 수 없는 모델 응답을 성공이나 작업 완료로 간주하지 않는다.

Producer는 checkpoint 파일과 별도 `.lock` 파일로 동일 상태 경로의 중복 실행을 막는다. 비정상 종료 시 `.lock`이 남아 다음 실행이 `producer_state_locked`로 fail-closed 될 수 있다. 같은 호스트에서 기록된 PID와 실제 프로세스를 확인하고, producer와 runner가 실행 중이지 않음을 확인한 뒤에만 orphan `.lock`을 제거한다. 원본 JSON 상태 파일과 request key는 보존한다. 상태 파일을 삭제하거나 새 request key로 재시도하지 않는다. `prepared`/`unknown` 작업이나 host의 unknown 결과는 신뢰된 operator reconciliation endpoint가 아직 구현되지 않아 자동 복구할 수 없다. 불명확한 지출 결과는 원장을 확인하기 전까지 보류한다.

브라우저 console은 사람 계정에 Supabase 로그인하며 access token은 메모리에만 둔다. 결제·승인·시작·컵 같은 변경 요청은 브라우저 owner journal에 request key와 입력을 먼저 기록하고, 실제 첫 fetch 직전에 dispatched 표시를 영속화한다. 첫 시도의 명시적 precondition 거절은 해당 request key를 지워 새 입력으로 다시 시작할 수 있지만, 이미 dispatch된 요청 뒤 인증 또는 precondition 거절이 와도 이전 시도가 서버에서 처리됐을 수 있어 원래 request key를 보존한다. 브라우저를 닫거나 네트워크가 끊겨도 같은 계정에서 그 key로 복구한다. 이전 journal에서 dispatched 표시가 없는 항목도 이미 시도된 것으로 취급한다. 만료된 approval draft는 quote가 `invalid-end-time`을 반환하고 브라우저 시각도 만료를 나타낼 때 approval 키만 정리한다. 만료된 approval은 새 session을 시작할 수 없으며 이 정리는 잔액을 소비하지 않는다. local `/mcp`는 일반 Supabase JWT와 production `af_mcp` grant를 거부하고, 서버 설정 `ODDBOUT_BROADCAST_PRODUCERS_JSON`에 등록된 별도 `obp_` grant만 받는다. 각 항목은 `owner` UUID, 이미 승인된 `broadcastId` UUID, `obp_`와 32개 이상의 URL-safe 난수 문자를 붙인 `token`, ISO `expiresAt`으로 구성된다. 해당 비밀은 격리 서버 설정과 producer의 비밀 환경에만 provision한다. 값이나 callback을 일반 대화에 붙여넣지 않는다. 이 local 설정은 기존 production cloud MCP connector의 `af_mcp` 권한을 바꾸지 않는다.

Grant는 등록된 사용자·broadcast에 한정되고, 매 요청 때 broadcast 소유권과 상태를 확인한다. 사용 가능한 기간은 grant 만료와 세션 `endsAt` 중 먼저 도달하는 때까지이며 자동 갱신되지 않는다. Producer MCP는 6개 고정 도구(잔액·가격·세션·작업 조회, `host_cup`)만 제공한다. Checkout·승인·세션 시작·중지·다른 broadcast 접근은 허용하지 않는다. 이는 이미 승인된 Sandbox 세션의 producer 권한일 뿐 Twitch 계정 인증이나 live 송출 권한이 아니다. PayPal은 새 탭에서 승인한 뒤 원래 console 탭으로 돌아와 **Verify payment**를 선택한다. 비밀 없는 owner-scoped 작업 journal은 localStorage에서 불확실한 checkout·approval·작업을 같은 계정으로 복구하는 데 쓴다. journal에는 인증 token이 들어가지 않는다.

## 6. 아직 제공하지 않는 기능

- `--live`는 현재 `runner_live_channel_unverified`로 막혀 있다. OBS 연결 점검은 실제 Twitch 채널/ingest 검증이 아니다.
- Twitch 송출 분 단위 계측과 검증, 연속 송출 상태 증거, 24시간 운전 증거가 없다.
- 실제 현금 환불 및 충전 reversals/분쟁 조정 경로는 완성되지 않았다.
- Commerce catalog는 현재 내장된 fighter ID만 허용한다. 임의 custom fighter ID 지원은 아직 없다.

이 항목들은 계획이나 UI 문구만으로 완료 처리하지 않는다.

## 7. 검증 기록 (2026-11-02)

아래는 개발 환경에서 관찰된 결과이며 외부 결제·실제 Twitch 방송 결과는 아니다.

아래 초기 구현 기록 이후 두 차례 적대적 리뷰와 수정 검증을 진행했다. 최신 결과는 [BROADCAST-ADVERSARIAL-REVIEW](BROADCAST-ADVERSARIAL-REVIEW.md)에 있으며 starter 관련 검사 151개, 별도 Cup 검사 137개와 실제 Chrome 회귀 검사를 포함한다.

- 별도 `oddbout-twitch-cup` renderer worktree: `npm run check` 통과 — 132 Node 테스트, 타입 검사, 빌드. Chrome에서 seed 123/124/125로 세 경기 실행, 총 119.121초, 결승 우승자 Yume 및 중복 결과 처리 확인.
- starter: 기존 Cloud MCP/Edge/migration 관련 36개 테스트 통과; strict typecheck 및 두 Deno Edge entrypoint 검사 통과.
- starter 신규 기능: `node --test test/commerce-*.test.mjs test/broadcast-*.test.mjs` — 77개 통과. 실제 PostgreSQL 실행 환경(PGlite)에서 원장·동시 요청·예산 만료·실행 결과 불명확 시 보류를 검증했고, PayPal·모델 API 응답은 테스트 fixture를 사용했다.
- UI: 390px 및 1280px preview에서 가로 overflow 없음. Fake HTTP 기반 복구 흐름 확인. 이는 실제 PayPal Sandbox 결제·capture를 검증한 것이 아니다.
- UI 동작 검증은 `npm run broadcast:check-ui`로 선택 실행한다. 이는 mocked auth/HTTP와 실제 브라우저 Web Locks를 사용하는 Chrome 검사이며 실제 PayPal 결제, Twitch 인증 또는 외부 송출을 검증하지 않는다.
- 별도 Twitch Cup renderer `npm run check`는 starter 검사와 분리해 기록했다.

## 관련 구현

- 개발 서버: `scripts/broadcast-demo.mjs`
- commerce 환경 설정: `api/commerce/config.mjs`
- 호스트 샘플: `deploy/broadcast-hosts.example.json`
- OBS/호스트 doctor: `scripts/broadcast-host.mjs`, `broadcast/hosts.mjs`
- render-only worker: `scripts/broadcast-runner.mjs`, `broadcast/runner.mjs`
- 선택형 AI producer: `scripts/broadcast-producer.mjs`, `broadcast/producer.mjs`
- 별도 Sandbox 원장 SQL(운영 migration 아님): `supabase/sandbox/20261102115107_commerce_broadcast_ledger.sql`
