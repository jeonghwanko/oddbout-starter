# Dots 클라우드 생성·등록 점검 — 2026-10-24

## 확인된 장애와 증거 범위

사용자가 말한 VM은 Codex의 Dots(미미)가 사용하는 GPT 클라우드 환경이다.
클라우드 채팅 `VM 제작 지침 점검`의 기존 실행 기록에서 공개 GET 3개가 모두 실패했다:

| 대상 | 실제 기록 |
| --- | --- |
| oddbout.com/creator.html | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |
| ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter/spec | 같은 CONNECT 403 |
| chatgpt.com | 같은 CONNECT 403 |

이는 해당 실행 당시 서비스에 도달하기 전 클라우드 프록시 차단이다. Google 계정 오류·가입 제한·게임 검수 실패로
분류하면 잘못된 재로그인·재생성을 유도한다. 커밋 `76109d0`은 이를 구분하는 키트 안내를 추가했지만 네트워크 설정을 바꾸지 않았다.
이 점검에서 로컬 Windows의 공개 API와 홈페이지 GET은 각각 HTTP 200이고 API는 deviceLogin v1을 광고했다.
로컬 성공은 클라우드 복구 증거가 아니다. 새 Google 로그인·이미지 생성·등록은 실행하지 않았다.

## 코드에서 제거한 불필요한 단계

- 로그인 전에 MCP를 시작하면 등록 도구가 숨겨지고 로그인 뒤 재시작해야 했음 → 도구 목록을 고정하고 요청 시 세션을 읽는다.
- 연결·완성된 패키지 등록에서도 생성 계정 질문과 엔진 준비가 실행됨 → readiness의 connection/registration 목적은 이를 생략한다.
- 연결 행동이 셸 명령 안내뿐이었음 → connect_oddbout이 기존 기기 로그인 함수를 직접 호출하고 공개 링크와 코드만 반환한다.
- 대기 중 재호출 → 같은 승인 링크를 반환하고 wait는 한 번 조회한다. 세션 파일만으로 연결 성공을 주장하지 않고 GET /me로 확인한다.
- 재로그인·로그아웃 뒤 이전 메모리 세션이 남음 → 매 요청에서 저장 상태를 확인한다. 사용자 교체는 진행 중 업로드를 중단한다.
- 이미 연결된 사용자에게 홈페이지 장애 복구를 등록 선행 조건처럼 안내함 → 인증된 등록 API 접근을 기준으로 판단한다.

파일·동작 검수, 사용자 선택, 등록 요청, 해시·업로드 검증과 중복 제출 방지는 유지한다.
공개 API 도달은 POST/PUT 허용이나 실제 등록 성공을 증명하지 않는다.

## 클라우드 적용 및 검증

1. [연결 안내](../CONNECTION-READINESS.md)의 환경 구분을 먼저 적용한다. 기본 Work 클라우드와 사용자 지정 Codex 환경에
   똑같은 Republish 안내를 하지 않는다. 키트에는 호스트 설정을 변경하는 API가 없다.
2. 작업 중인 캐릭터의 폴더·선택·시도 기록을 보존한다. 제작 중 체크아웃을 pull하거나 생성 엔진을 교체하지 않는다.
   개선 브랜치의 push만으로 실행 중인 클라우드 VM이나 설치된 플러그인에 자동 적용되지 않는다.
   아래 VM 재검증은 작업이 없는 체크아웃에 명시적으로 적용한 결과다.
3. 준비된 새 런타임에서 `connect_oddbout`과 readiness의 `purpose` 입력이 보이는지 확인한다.
   코드 교체 뒤 MCP 도구 목록 갱신은 한 번 필요하지만 이후 사용자 로그인마다 재시작하지 않는다.
4. 같은 클라우드에서 `npm run creation:check -- connection`으로 도달 여부를 재검사한다. 등록 전에는 `registration`을 쓴다.
   계정은 사용자 본인의 것만 연결하며, 실제 사용자가 승인한 요청에서 Google 승인 → GET /me를 확인한다.
5. 생성·미리보기 전달은 별도 조건이다. 기존 결과를 현재 대화에 실제로 표시하고, 새 생성은 사용자의 생성 요청 범위에서만 실행한다.
6. 최종 선택된 패키지의 검증 → 동일 패키지에 고정된 idempotency key로 제출 → 최종 서버 결과 조회를 확인한다.

단위·MCP 통합 테스트는 가짜 인증/API와 임시 파일을 사용한다. 이 테스트를 클라우드 라이브 연결·표시·등록 성공으로 보고하지 않는다.

## 최초 로컬 Windows 검증

- 관련 Node 테스트 66/66 통과: client, connection-readiness, creation-readiness, login, connect-oddbout,
  mcp, creator-plugin, portable-plugin. 같은 실행 중 MCP에서 연결 승인 후 등록 준비 확인까지 테스트했다.
- 대화 규칙 오프라인 기록 검사 35/35 통과. 실제 사용자 대화 품질 시험은 아니다.
- git diff --check 통과. 실제 이미지 생성, 사용자 로그인, 등록, CI, 클라우드 배포는 실행하지 않았다.
- 분리된 작업 브랜치: codex/dots-creator-flow. 원래 작업 폴더의 다른 변경과 vendor/sprite-gen은 보존했다.

## 같은 클라우드 VM 적용 및 재검증 — 2026-10-24

### 적용한 코드와 보존 범위

- 작업 경로는 `/workspace/oddbout-starter`, 브랜치는 `codex/creator-hosting`이다. 사용자 PC에는 접근하지 않았다.
- 시작 HEAD는 `76109d0ce1c80a7f4a048913ab94f18ed5896fce`였다. fetch한 creator-hosting은
  `7cb01dae6049eb603513b1d98229db3a2800603a`이고, 그 직계 후손인 dots-creator-flow의
  `25933682320f9763dad1b89f94b0619326731451` 및 `6294eeef662e6c37f33ae56ae581627b12e6d79c`를 읽었다.
- 생성 프로세스, 캐릭터 기록과 작업 결과가 없는 체크아웃임을 확인했다. `output/`의 파일은 0개였고,
  기본 ODDBOUT 세션·기기 승인 대기 파일도 없었다. 기존 작업을 생성하거나 인증 파일을 만들지 않았다.
- 서브모듈 재귀 갱신 없이 `git -c submodule.recurse=false merge --ff-only 6294eeef662e6c37f33ae56ae581627b12e6d79c`로 적용했다.
  테스트한 런타임 SHA는 **`6294eeef662e6c37f33ae56ae581627b12e6d79c`**다.
  push 직전 원격이 여전히 `7cb01da`임을 확인하고 두 기존 `[skip ci]` 커밋을 creator-hosting에 일반 push했다.
- `vendor/sprite-gen`의 기존 v8 패치 23개 파일은 모두 manifest의 적용 후 SHA-256과 일치했다.
  gitlink와 vendor HEAD `38bddef764183fe2044bc85c764b0572409a6b15`는 그대로다. 이 변경은 커밋에 포함하지 않았다.

### 모의 검사와 실제 도구 목록

- Node v24.19.0에서 관련 테스트 **67/67** 통과: client 9, connection-readiness 4, creation-readiness 12,
  login 10, connect-oddbout 4, mcp 11, creator-plugin 15, portable-plugin 2.
  최종 검사는 각 파일을 별도 `node test/<name>.test.mjs` 프로세스로 실행했다.
  최초 제한된 샌드박스에서는 로그인 모의 서버의 `listen EPERM 127.0.0.1`을 확인했다.
  공식 실행 도구의 `with_additional_permissions`와 `network.enabled: true`를 사용해 검사했으며,
  테스트 코드·기대값·프록시 설정은 바꾸지 않았다. 가짜 인증/API와 임시 파일만 사용했다.
- `6294eee`의 다른 프로젝트 승인 파일 교환 차단 회귀 검사를 포함한다.
  같은 MCP 실행 중 로그인 상태 채택·로그아웃·사용자 교체 차단, 연결/등록 목적의 엔진 준비 생략도 통과했다.
- `node scripts/evaluate-creation-dialogue.mjs --responses test/fixtures/creation-dialogue/responses-reference.json`은
  **35/35**, 실제 실행 도구 기록 0건이었다. 라이브 생성이나 대화 표시 성공의 증거가 아니다.
- 새 VM stdio 프로세스에서 `initialize`와 `tools/list`만 실행해 **19개 도구**를 확인했다.
  `connect_oddbout.action`은 status/start/wait, `check_creation_readiness.purpose`는 generation/connection/registration이다.
  로그인 전에도 submit_fighter_package 및 update_fighter_profile이 목록에 있었다. 이 도구들을 실제 호출하지 않았다.
- 현재 Dots 대화에 제공된 도구 목록에는 AI Fighter 도구가 없었다. VM 소스와 새 stdio 목록의 갱신을
  Dots 호스트의 플러그인 연결·버튼 노출 완료로 취급하지 않는다. 호스트의 공식 MCP 연결/목록 갱신은 남아 있다.
- 개선 커밋의 문서 상대 링크 63개와 `git diff --check`가 통과했다.
  번들 선언에 check-connection, creation:check, 연결/전달 문서와 mcp 디렉터리 포함을 확인했다.
  Windows용 배포 ZIP 빌드·설치·공개 배포는 하지 않았다.

### 현재 VM 네트워크 결과와 정책 근거

기존 프록시·CA를 유지하고 공식 실행 네트워크 권한을 사용한 공개 GET 결과다. 로그인 헤더나 토큰은 보내지 않았다.

| 대상 | 같은 VM 재검사 결과 |
| --- | --- |
| `https://oddbout.com/creator.html` | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |
| `https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter/spec` | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |
| `https://chatgpt.com/` — 기존 VM Library helper 경로의 호스트 | curl exit 56, HTTP 000, CONNECT tunnel failed, response 403 |

- `/etc/codex/network-policy.json`은 존재하며 version 1이었다. 시작 시 정책의
  `http_network_policy.type`은 `restricted`이고 `http_network_policy.egress_rules`에는 위 세 호스트가 없었다.
  GitHub는 포함되어 있었다. Git fetch/push 성공은 ODDBOUT·Library 연결 복구 증거가 아니다.
- 이 대화에는 `cloud_environment.environment_status` 도구가 제공되지 않아 `observations_current`와
  현재 HTTP policy enforced 필드는 조회하지 못했다. 시작 시 정책 파일과 실제 CONNECT 403 관찰을 구분한다.
  정책 파일은 읽기만 했고, 파일 수정으로 권한이 바뀐다고 가정하지 않았다.
- `npm run creation:check -- connection`은 완료됐지만 홈페이지·API를 blocked/network-dns-failed로 반환했다.
  이는 해당 Node 진단 경로의 결과이고 curl의 CONNECT 403 관찰과 동일한 오류 문자열로 바꾸지 않았다.
  kit/account는 not-required, elicitation은 not-needed, readyForRegistration은 false였다.
  generation/delivery는 unverified, Library는 helper-not-probed였다. 설치·업데이트·로그인을 실행하지 않았다.

### Node fetch의 상속 프록시 호환성 추가 진단

- 이 VM의 Node는 v24.19.0이며 로컬 `node --help`와 `process.allowedNodeEnvironmentFlags`에서
  `--use-env-proxy` 지원을 확인했다. HTTP_PROXY/HTTPS_PROXY/NO_PROXY와 소문자 대응 변수는 설정되어 있었으나
  NODE_USE_ENV_PROXY 및 NODE_OPTIONS는 설정되어 있지 않았다. 프록시 값·인증 정보는 출력하지 않았다.
- 같은 공식 실행 네트워크 권한에서, 위 세 공개 URL에 대한 기본 `fetch()`와
  **해당 진단 자식 프로세스에만** `NODE_USE_ENV_PROXY=1`을 추가한 `fetch()`를 비교했다.
  상속된 프록시·NO_PROXY·CA 값은 모두 유지했다. 새 프록시나 직접 연결 설정은 만들지 않았다.

| 실행 경로 | 세 호스트에서 공통으로 확인한 결과 |
| --- | --- |
| 기본 Node fetch | fetch failed → getaddrinfo EAI_AGAIN, 대상 호스트의 DNS 조회 실패 |
| NODE_USE_ENV_PROXY=1의 Node fetch | fetch failed → Request was cancelled → UND_ERR_ABORTED, Proxy response (403) !== 200 when HTTP Tunneling |
| 기존 프록시를 사용하는 curl | CONNECT tunnel failed, response 403 |

- 같은 권한에서도 재현되므로 최초 권한 제한만으로 설명되는 차이가 아니다. 현재 기본 Node 실행은
  상속된 프록시를 활성화하지 않아 대상 호스트 DNS를 조회했고, 공식 옵션을 적용하면 프록시 차단까지 도달했다.
  이는 이 VM에서 기본 키트 실행의 프록시 사용 설정이 빠진 문제와 실제 egress 차단이 함께 있음을 보여준다.
- `NODE_USE_ENV_PROXY=1`을 진단 프로세스에 적용한 `node scripts/check-connection.mjs connection`은
  홈페이지·API 모두 blocked/**network-connect-forbidden**을 반환했다. 기존 오류 분류는 이 중첩 원인을 처리했다.
  kit/account not-required, 생성·전달 unverified 상태는 유지됐다. Library helper는 호출하지 않았다.
- `mcp/connection-readiness.mjs`와 `api/client.mjs`는 기본 fetch를 사용하고 이 실행 경로에 프록시 활성화 코드가 없다.
  키트의 Node 지원 범위는 >=22.12다. [공식 Node 프록시 문서](https://nodejs.org/learn/http/enterprise-network-configuration)에 따르면
  환경 프록시를 사용하는 fetch는 v22.21.0 또는 v24.0.0 이상, CLI 플래그는 v22.21.0 또는 v24.5.0 이상에서 지원한다.
  따라서 Node 24의 옵션만으로 전체 지원 버전의 호환성이 해결됐다고 주장할 수 없다.
- 이 진단 단계에서는 전송·로그인·런처 코드를 수정하지 않았다. 아래 후속 보완은 이 결과를 근거로 추가했다.

### 프록시 호환성 후속 보완

- 공개 준비 진단, 등록 API 요청, Supabase 로그인·승인 교환·토큰 갱신·로그아웃에 같은 `runtimeFetch`를 적용했다.
  [Undici EnvHttpProxyAgent](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md)로
  호스트의 HTTP_PROXY/HTTPS_PROXY/NO_PROXY와 기본 CA 신뢰를 사용한다. TLS 검증을 끄거나 프록시 실패 후
  직접 연결로 전환하지 않는다. 프록시가 없는 일반 PC는 기존 fetch 경로를 유지한다.
- Node >=22.12 지원을 유지하는 Undici 7.30.1을 정확한 버전으로 고정하고 배포 번들에 전송 모듈을 포함했다.
  사용자가 NODE_USE_ENV_PROXY를 따로 설정할 필요가 없다. 프록시 주소·자격증명이 포함될 수 있는 원본 오류는
  SDK에 전달하기 전에 안전한 오류 코드로 바꾸고, 인증 SDK가 원인을 감싸도 CONNECT 차단 분류를 유지한다.
- 로컬 Windows의 관련 검사 **71/71** 통과. 추가 4건은 실제 로컬 모의 프록시를 사용해 대상 DNS 없이
  공개 진단과 API 본문 전송, HTTPS CONNECT 403과 실제 인증 SDK의 갱신 실패 분류, 호스트 NO_PROXY 준수,
  잘못된 프록시의 직접 연결 차단을 검증했다. 실사용 자격증명·서비스 인증·생성·등록은 사용하지 않았다.
- 이 보완 이후 VM 재검사 결과는 별도로 기록한다. 전송 수정은 환경의 허용 정책을 바꾸지 않으므로
  앞서 확인한 호스트 차단이 자동 해제됐다고 판단하지 않는다.

### 프록시 보완의 같은 VM 후속 검증 — 2026-10-24

- `/workspace/oddbout-starter`의 작업 없는 체크아웃에서 기존 HEAD `240537bd25a7c000e9cd7abb44f2e189ed7defb4`와
  작업 상태를 다시 확인했다. 캐릭터 결과 파일·ODDBOUT 세션·기기 승인 대기 파일은 없었고,
  기존 v8 패치 23개 파일은 manifest의 적용 후 해시와 모두 일치했다.
- 두 원격 브랜치를 명시적으로 fetch한 뒤 `codex/dots-creator-flow`의
  **`11651786e94d5e0d0a85c7e6efae6535d6d9aab2`**를 서브모듈 재귀 갱신 없이 fast-forward했다.
  이 후속 검증에서 제품 전송·인증 코드를 추가 변경하지 않았다.
- `npm ci --ignore-scripts --no-audit --no-fund`의 첫 실행은 기본 `/home/agent/.npm/_cacache` 생성 ENOENT로 실패했다.
  쓰기 가능한 `/tmp`의 새 캐시를 `--cache`로 지정해 같은 잠금 파일로 다시 설치했고 123개 패키지 설치가 완료됐다.
  무결성 검사·TLS 검증을 끄지 않았고, 설치된 Undici는 7.30.1이다.

#### 테스트 이식성 결함과 검증 결과

- 최초 VM 실행에서 기존 8개 파일의 **67/67**은 통과했지만 새 runtime-fetch 테스트는 **1/4**였다.
  모의 프록시로 가야 할 요청의 timeout/DNS 실패, 잘못된 프록시 검사의 빈 결과를 확인했다.
- 테스트가 소문자 프록시 변수를 빈 문자열로 남기고 대문자 변수에 모의 프록시를 넣었다.
  Linux에서는 Undici가 존재하는 소문자 값을 우선하여 대문자 모의 설정을 무시했다.
  설치된 EnvHttpProxyAgent 소스·문서로 우선순위를 확인하고, 임시 복사본에서 원인을 재현·분리했다.
- `test/runtime-fetch.test.mjs`의 자식 프로세스 환경 구성만 수정했다. 기존 HTTP(S)_PROXY/NO_PROXY 키를
  대소문자 구분 없이 제거한 뒤 해당 테스트의 모의 값만 넣는다. 이는 loopback 모의 테스트에만 적용되며
  실제 VM·진단·제품 실행 환경의 프록시 설정은 변경하지 않는다. assertion 12개 행과 기대값은 그대로다.
  이 최소 수정의 커밋은 **`80ed95f799b275cee82c2ec68e30a4cd6022d819`**이다.
- 수정한 저장소 원본 `node test/runtime-fetch.test.mjs`는 **4/4** 통과했다(약 26초).
  최종 관련 검사 합계는 **71/71**: runtime-fetch 4, client 9, connection-readiness 4, creation-readiness 12,
  login 10, connect-oddbout 4, mcp 11, creator-plugin 15, portable-plugin 2.
  각각 독립 Node 프로세스와 공식 실행 네트워크 권한을 사용했고 인증/API는 모의 값·임시 파일만 사용했다.
- 이 VM 실행 검증은 Node v24.19.0에서 수행했다. Node 22.12 실제 실행 검증이나 실서비스 인증 성공으로 확대하지 않는다.
  문서 상대 링크, diff-check와 번들 명세의 `api/runtime-fetch.mjs` 포함도 확인했다. 배포 ZIP은 만들지 않았다.

#### 옵션 추가 없이 실행한 실제 공개 진단

`NODE_USE_ENV_PROXY`가 없는 상태에서 아래 두 명령을 그대로 실행했다. HTTP(S)_PROXY/NO_PROXY/CA를 추가·변경하지 않았다.
기본 계정 세션·기기 승인 대기 파일이 없음을 먼저 확인했으므로, 이 진단에서 인증 교환·갱신·GET /me를 실행하지 않았다.

```sh
npm run creation:check -- connection
npm run creation:check -- registration
```

| 목적 | 홈페이지 oddbout.com | 등록 API ztfxxhtmtrvxvuxlqmgz.supabase.co |
| --- | --- | --- |
| connection | blocked / network-connect-forbidden | blocked / network-connect-forbidden |
| registration | blocked / network-connect-forbidden | blocked / network-connect-forbidden |

두 명령 모두 exit 0으로 진단 결과를 반환했다. 이는 진단 명령의 완료이며 연결 성공이 아니다.
kit/account는 not-required, elicitation은 not-needed, login은 blocked, readyForRegistration은 false,
deviceLogin은 unknown, 생성·전달은 unverified였다. Library는 helper-not-probed이며 이번 후속 검사에서 호출하지 않았다.
앞선 기본 Node 실행의 network-dns-failed는 해결되어 상속 프록시의 실제 차단을 분류하지만, 호스트 허용 차단은 남아 있다.

새 MCP 프로세스에서는 initialize/tools/list만 실행했다. 도구 19개, connect_oddbout의 status/start/wait,
readiness의 generation/connection/registration, 로그인 전 등록 도구 노출을 확인했다.
현재 Dots 대화에는 여전히 AI Fighter 도구가 제공되지 않는다. 공식 호스트 연결·도구 목록 갱신 완료는 미검증이다.
시작 시 네트워크 정책 v1은 restricted이며 필요한 세 호스트의 명시적 규칙은 여전히 없었다.
environment_status·정책 변경 도구도 제공되지 않아 현재 observations_current나 허용 변경은 수행하지 못했다.

v8 패치·기존 작업을 보존했고 실제 로그인·새 자격증명·이미지 생성·업로드·등록·서비스 배포·CI는 실행하지 않았다.

### 남은 장애와 미검증

VM 네트워크 정책 변경용 공식 관리 도구는 이 세션에 제공되지 않았다. 후속 UI 점검에서는 Work network access가 이미 ON이고,
사용자 승인 후 Dot 재부팅으로도 차단이 해제되지 않았다(아래 기록). 사용자 지정 Codex 환경에만 해당 환경 설정·재게시를 적용하며,
기본 Dots VM에 적용되는 허용목록 편집 화면은 확인되지 않았다. 상속 프록시·CA를 변경/해제하거나 별도 직접 연결·우회 설정을 추가하지 않았다.

실사용 Google 로그인·기기 승인·인증된 GET /me·동일 계정 여부, 실제 이미지 생성 백엔드·구독 접근,
Library 업로드·부모 대화 표시, 패키지 제출·선수 등록은 여전히 미검증이다. 네트워크 복구와 호스트 도구 연결 후
사용자가 요청한 단계에서 확인해야 한다. 새 생성·업로드·등록·자격증명 발급·서비스 배포·CI는 실행하지 않았다.

### 실제 사용자 설정·Dot 재부팅 확인 — 2026-10-24

- 사용자 요청에 따라 같은 계정의 실제 웹 UI를 확인했다.
  [설정 → 데이터 관리](https://chatgpt.com/settings/data-controls)의 **Work 네트워크 액세스 허용**은 처음부터 ON이었다.
  이 값을 끄고 켜거나 다른 개인정보·사이트 승인 설정을 변경하지 않았다. 이 표시가 개별 Dot VM의 유효 정책을 보증하지는 않는다.
- [미미](https://chatgpt.com/dots/home)의 상단 **⋯ → 재부팅 → 다시 시작**을 확인했다.
  확인창은 진행 중 작업 중단 가능과 대화·메모리·예약 작업 유지를 안내했다.
  자동 승인 검토가 구체적인 중단 위험에 대한 승인을 요구하여 최초 클릭을 거절했고,
  사용자가 **재부팅하고 연결 재검사**를 명시적으로 선택한 뒤 05:21–05:22 UTC에 다시 시작을 실행했다.
  확인창이 닫히고 대화 화면으로 돌아왔다. Work 재설정·Dot 삭제는 실행하지 않았다.
- 재부팅 후 같은 클라우드 채팅에서 새 실행으로 검사했다. 최초 환경 표시는 unavailable이었지만 실제 셸 접근은 복구됐다.
  HEAD `e87aca02483ce3af36174772251e21a65284ca27`, 주요 파일, v8 패치 23개 해시가 보존됐다.
  작업 트리에는 기존 vendor 변경만 있었으며 캐릭터 output 파일은 없었다.
- 시작 정책 파일은 v1, `restricted`, 규칙 144개이며 세 호스트의 명시적 규칙은 없었다.
  현재 정책을 별도로 조회·갱신하는 공식 도구는 제공되지 않았다. 실제 공개 GET은 다음과 같았다.

| 재부팅 후 공개 대상 | 결과 |
| --- | --- |
| `https://oddbout.com/` | CONNECT 403 / HTTP 000 / curl exit 56 |
| `https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter/spec` | CONNECT 403 / HTTP 000 / curl exit 56 |
| `https://chatgpt.com/` | CONNECT 403 / HTTP 000 / curl exit 56 |

- 기본 세션과 기기 승인 대기 파일이 없는 것을 확인하고 `npm run creation:check -- connection`을 실행했다.
  진단 exit 0, API/홈페이지 `network-connect-forbidden`, login blocked, readyForRegistration false였다.
  Library helper 자체는 호출하지 않았으며 생성·전달은 계속 unverified다.
- 실제 대화에 AI Fighter 도구는 여전히 없다. 웹의 설치된 플러그인에도 해당 연결이 없다.
  저장소의 `mcp/stdio.mjs`와 생성되는 plugin manifest는 stdio 방식이며, HTTPS MCP endpoint는 구현되어 있지 않다.
  따라서 **MCP 연결·목록 갱신만 남았다**는 앞선 설명은 불완전했다. 로컬 stdio 실행 성공은 Dots 연결 성공이 아니다.
- 실제 연결 UI는 [플러그인](https://chatgpt.com/plugins) → **추가(+) → 사용자 지정 MCP 서버 추가**이며
  이름, 서버 URL 또는 터널 ID, 인증을 요구한다. 준비된 클라우드 endpoint/터널이 없어 생성·권한 승인은 진행하지 않았다.
  [연결 조건](../CONNECTION-READINESS.md#dots-클라우드의-mcp-연결-조건)에 공식 문서와 구현 경계를 기록했다.

Work 표시가 ON인데 이 Dot VM의 요청이 차단되는 원인은 현재 도구로 확정할 수 없다.
추가 호스트 입력·Republish를 사용자가 빠뜨렸다고 결론 내리지 않는다. 플랫폼 확인이 필요한 근거는
검사 시각, Work ON, 승인된 재부팅 이후에도 반복되는 세 대상의 CONNECT 403이다.
[OpenAI 지원](https://help.openai.com/en/articles/6614161-how-can-i-contact-support)은 Help Center 오른쪽 아래 채팅에서 문의할 수 있다.
사용자 동의 없이 문의나 로그 전송은 하지 않았다. 로그인·생성·업로드·등록·서비스 배포·CI는 계속 미실행이다.
