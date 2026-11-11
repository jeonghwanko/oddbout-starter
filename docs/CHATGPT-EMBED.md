# ChatGPT 임베드: 서버와 게시 계약

이 문서는 MCP 런처, `/embed/*` API, 비공개 경기 저장과 사이트 게시 설정을 소유한다.
게임 화면·재생·종료와 프레임 메시지 규격은 게임 저장소의
[ChatGPT 임베드 연습 경기](https://github.com/jeonghwanko/crashbang-heroes/blob/main/docs/kaito-web/chatgpt-embed.md)가 소유한다.
현재 구현은 기본 비활성이다. 운영 배포와 실제 ChatGPT 호스트의 실행·로그인·재생은 확인하지 않았다.

## 소유 코드

| 대상 | 소유 파일 |
| --- | --- |
| MCP 등록과 모델·컴포넌트 결과 분리 | [`mcp/cloud.mjs`](../mcp/cloud.mjs) |
| 런처 UI·메타데이터·도구 | [`game-launcher-ui.mjs`](../mcp/cloud/game-launcher-ui.mjs) |
| grant 발급과 전용 API | [`api/embed.mjs`](../api/embed.mjs), [`api/handler.mjs`](../api/handler.mjs) |
| 기존 엔진용 패키지 검증과 경기 표현 | [`api/duels.mjs`](../api/duels.mjs)의 공유 함수 |
| 저장·철회·예산 | [`마이그레이션`](../supabase/migrations/20261111041038_chatgpt_embed_sessions_and_matches.sql) |
| 공개 빌드 설정과 응답 헤더 산출 | [`chatgpt-embed-site.mjs`](../scripts/chatgpt-embed-site.mjs), [`build-creator-site.mjs`](../scripts/build-creator-site.mjs) |

## 활성화 설정

세 설정면을 같은 게임 주소로 맞춘다. 빈 값이나 부적합한 주소는 기능을 활성화하지 않는다.

| 설정면 | 값 | 조건 |
| --- | --- | --- |
| `ai-fighter` Edge | `ODDBOUT_CHATGPT_GAME_LAUNCHER=1` | 정확히 `1`일 때만 전용 API를 연다 |
| `ai-fighter` Edge | `ODDBOUT_CHATGPT_GAME_ORIGIN` | 경로·후행 `/` 없는 정확한 HTTPS origin |
| `ai-fighter-mcp` Edge | `ODDBOUT_CHATGPT_GAME_LAUNCHER=1` | 런처 도구·리소스를 등록한다. directory 판에서는 등록하지 않는다 |
| `ai-fighter-mcp` Edge | `ODDBOUT_CHATGPT_GAME_URL` | 정확한 HTTPS `/embed/chatgpt/` 주소. 쿼리·fragment·사용자 정보는 거절한다 |
| 사이트 빌드 | `deploy/creator-site.json`의 선택 항목 `chatgptEmbed` | 아래 공개 빌드 설정을 사용한다 |

`chatgptEmbed`의 `enabled`가 `true`일 때 `apiBase`, `parentOrigins`, `ancestorOrigins`를 모두 요구한다.
`apiBase`는 `/embed` 앞까지의 `ai-fighter` HTTPS API 주소다. 인증 비밀을 넣지 않는다.
`parentOrigins`는 게임이 직접 메시지를 받는 부모 origin 목록이다.
`ancestorOrigins`는 CSP가 허용하는 전체 조상 origin 목록이다. 각 목록은 정확한 HTTPS origin 1~8개이며 wildcard를 받지 않는다.
모든 `parentOrigins` 항목은 `ancestorOrigins`에도 있어야 한다.

현재 추적된 `deploy/creator-site.json`에는 `chatgptEmbed`가 없다. 따라서 빌드는 비활성 값을 주입한다.
활성 빌드는 게임 소스에 `embed/chatgpt/index.html`이 없으면 실패한다.
MCP의 게임 URL origin과 API의 게임 origin은 같아야 한다.
실제 ChatGPT의 부모·조상 origin은 아직 확인하지 않았다. 추측한 호스트 목록으로 운영을 활성화하지 않는다.

## 런처와 인증

`open_game_launcher`는 `ui://oddbout/game-launcher-v2.html` 컴포넌트를 연다.
사용자가 시작을 누른 뒤 iframe을 만들고 게임과 인사를 교환한다. 컴포넌트 표시만으로 게임 실행·로그인이 확인되지는 않는다.
게임이 실행 시도별 PKCE S256 challenge를 보내면 컴포넌트가 `issue_game_launch_grant`를 호출한다.
이 도구는 `ui.visibility: ["app"]`와 호환용 `openai/visibility: "private"`를 알린다.
visibility는 호스트의 노출 계약이다. 서버는 별도로 검증된 OAuth identity와 현재 연결 상태를 확인한다.

`mcp/cloud.mjs`는 결과의 내부 `_uiMeta`를 모델용 본문·`structuredContent`·호출 로그에서 제거하고 응답 `_meta`로 옮긴다.
grant는 `_meta.gameLaunchGrant`, 만료 시각은 `_meta.gameLaunchGrantExpiresAt`에만 둔다.
컴포넌트는 현재 nonce·attemptId가 맞는 응답만 exact-origin `postMessage`로 게임에 전달한다.
grant나 원래 OAuth 토큰을 URL·일반 채팅·모델용 결과에 넣지 않는다.

발급기는 클라이언트의 user ID를 받지 않는다. Cloud MCP가 검증한 owner·OAuth session·client를 사용한다.
grant는 60초 동안 한 번 쓸 수 있고 attemptId·게임 origin·PKCE challenge에 묶인다.
같은 계정·attemptId로 다시 발급하면 이전 grant와 전용 세션을 폐기한다. 발급·교환은 경기를 만들지 않는다.
교환 후 게임은 15분짜리 opaque credential을 메모리에만 보관한다. 일반 웹 세션으로 승격하거나 갱신하지 않는다.

## 전용 API

아래 경로는 설정된 `ai-fighter` API base 뒤에 붙인다. 비활성 상태에서는 모두 404다.
모든 요청은 정확한 게임 `Origin`을 요구한다. 허용한 origin에만 CORS 응답을 보낸다.
교환을 제외한 실제 요청은 `Authorization: Bearer afe_…`를 요구한다. 쿠키나 일반 웹·OAuth 토큰을 대신 쓰지 않는다.

| 메서드·경로 | 입력 | 성공 응답 |
| --- | --- | --- |
| `POST /embed/exchange` | `{grant,verifier,attemptId}` | `{ok,token,expiresAt,account:{id,name}}` |
| `GET /embed/fighters` | 없음 | `{ok,fighters:[{id,name,manifestSha256,owned}],engine,engines}` |
| `POST /embed/matches` | `{a,b,hashes:[hashA,hashB],engine,idempotencyKey}` | `{ok,match}` |
| `GET /embed/matches` | 없음 | `{ok,matches,pending}`: 두 목록 합계 최신 20건 |
| `GET /embed/matches/<id>` | 없음 | 완료는 200 `{ok,match}`, 미완료는 202 `{ok,pending}` |
| `DELETE /embed/session` | 없음 | `{ok:true}` |

선수 목록은 승인·출전·패키지 해시 조건을 통과한 등록선수 최대 200명이다. 내 선수를 먼저 정렬한다.
`owned`는 연결 계정과 실제 소유자가 같은지 나타낸다. 내 선수가 없어도 공개 등록선수로 연습할 수 있다.
양쪽 선수의 현재 패키지를 기존 `loadDuelManifest`로 검증하고 주입된 기존 엔진으로 계산한다. 엔진을 복제하지 않는다.
지원하지 않는 엔진과 변경된 해시는 409로 거절한다. 내장 공식 선수는 현재 지원하지 않는다.

완료 `match`는 기존 경기 필드와 비공개 `idempotencyKey`를 담는다.
`pending`은 `{id,a,b,hashes,engine,idempotencyKey,createdAt}`를 담는다.
계정·키·선수·해시·엔진을 함께 묶는다. 같은 키의 입력이 달라지면 409 `idempotency-conflict`다.
완료된 동일 요청은 저장 결과를 반환한다. 미완료 동일 요청은 30초 이내 409 `match-busy`다.
30초 뒤 같은 입력으로 재시도할 수 있다. 게임은 기록을 조회하고 사용자의 명시적 재시도로 복구한다.
과거 기록은 저장 결과 조회를 보장한다. 과거 엔진·패키지를 내려받아 재생하는 API는 제공하지 않는다.

## 저장·권한·예산

`af_embed_grants`와 `af_embed_sessions`에는 bearer 원문 대신 SHA-256 hash만 저장한다.
교환은 grant 행 잠금으로 한 번만 소비한다. 소비와 세션 생성은 한 트랜잭션에서 끝난다.
`af_embed_matches`는 연결 계정별 비공개 기록이다. `af_duels`·순위·금화·Discord outbox에 쓰지 않는다.
세 테이블은 RLS를 켜고 PUBLIC·anon·authenticated·service_role의 직접 접근을 막는다.
명시한 전용 RPC만 service_role에 실행 권한을 준다. 내부 연결·세션 helper에는 그 권한도 주지 않는다.

각 전용 RPC는 원래 OAuth session과 동의의 생존, 계정 비활성·정지·삭제를 확인한다.
로그아웃·동의 철회·전용 세션 폐기는 다음 요청부터 막는다. bearer를 일반 API에 보내도 일반 계정 권한을 얻지 못한다.
예약과 예산 판정은 짧은 DB 잠금 안에서 처리한다. 계산은 잠금 밖에서 한다.

| 제한 | 현재 값 |
| --- | --- |
| grant 발급 | 계정별 1분에 10회 |
| 새 비공개 경기 예약 | 계정별 UTC 하루 20건, 전체 UTC 하루 100건, 전체 누적 10,000건 |
| 최근 미완료 예약 | 계정별 최근 5분 안에 3건 |
| 동일 입력 재실행 | 최소 30초 간격, 최초 계산을 포함해 최대 5회 |

실패한 새 예약도 일일 예산에 포함한다. 완료 요청의 재조회는 새 경기 예산을 쓰지 않는다.

## 게시와 확인 범위

사이트 빌더는 전용 경로에 `_headers`의 CSP `frame-ancestors`, cache 금지·referrer 금지·검색 제외 설정을 쓴다.
비활성 경로는 framing을 거절한다. 활성 경로는 지정 조상만 허용하고 전용 경로의 X-Frame-Options를 제거하도록 산출한다.
이 `_headers` 문법은 Cloudflare Pages용이다. GitHub Pages나 다른 호스트에서 같은 헤더가 적용된다고 가정하지 않는다.
[`check-chatgpt-iframe.mjs`](../scripts/check-chatgpt-iframe.mjs)는 명시 설정 후 HTTP 응답을 읽는 진단 도구다.
헤더 확인은 실제 ChatGPT iframe·OAuth·게임 렌더·재생 검증을 대신하지 않는다.
배포는 이 문서의 설정 변경만으로 시작하지 않는다. 기존 [호스팅 절차](CREATOR-HOSTING.md)와 게임 저장소의 배포 규칙을 따른다.
