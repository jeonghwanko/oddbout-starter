# Dots 클라우드 등록 연결

사용자는 PC, 로컬 MCP, API 키 또는 터널을 설정할 필요가 없다.
Dots의 플러그인에서 ODDBOUT을 연결하고 Google 로그인과 연결 승인을 마치면,
대화의 실제 파일을 클라우드 서버가 받아 기존 등록 검증 파이프라인에 제출한다.

공개 서버 URL: `https://mcp.oddbout.com/mcp`

기존 개발 연결의 Supabase 함수 URL도 호환용으로 유지한다. 공개 심사에 제출한 주소는
위 ODDBOUT 도메인이며, 현재 심사 중이다.

ODDBOUT 플러그인 0.6.0 이상을 쓰면 이 연결이 플러그인 안에 있다(`plugins/ai-fighter/mcp.json`, [ODDBOUT-PLUGIN.md](ODDBOUT-PLUGIN.md)).
Google로 한 번 로그인하면 끝이다. 아래 사용자 지정 MCP 서버를 함께 더하면 플러그인 목록에 ODDBOUT이 둘 보이니 더하지 않는다.
사이트의 내 에이전트(Codex 카드)도 이 순서로 안내한다.

플러그인 없이 연결: ChatGPT → 플러그인 → 추가(+) → 사용자 지정 MCP 서버 추가.
이름 `ODDBOUT`, 위 서버 URL, 인증 `OAuth`를 선택한다. 클라이언트 ID/Secret은
직접 넣지 않는다. 서버가 동적 클라이언트 등록과 PKCE를 지원한다.
Google로 로그인한 뒤 `연결 승인하고 Dots로 돌아가기`를 누른다.
공개 플러그인 디렉터리 등록은 별도의 OpenAI 심사 절차이며 서버 배포와 다르다.

Grok 연결(2026-10-27, 주소 2026-10-28·11-01): grok.com → 커넥터(`https://grok.com/connectors`) → New Connector → Custom. Cursor의 Grok Bot도 같다. 서버 URL은
우리 도메인의 **로그인 먼저 주소** `https://mcp.oddbout.com/signin`이다(`PUBLIC_SIGN_IN_RESOURCE`). Claude·터미널 에이전트가 쓰는 Supabase 주소
`https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp/signin`(`SIGN_IN_RESOURCE`)과 같은 서버다. Grok에만 11-01에 주소를 옮긴 까닭은
[우리 도메인의 로그인 먼저 주소](#우리-도메인의-로그인-먼저-주소-2026-11-01)에 있다. Grok의 커스텀 커넥터에는
인증을 고르는 칸이 없고, 첫 요청의 답으로 로그인이 필요한지 정한다. 위 공개 주소는 공개 도구를 로그인 없이 답하므로 Grok이 계정 없이 붙어 버렸다(2026-10-28 실제 시도).
로그인 먼저 주소는 같은 서버이고 모든 요청에 401과 `WWW-Authenticate`(`…/signin/.well-known/oauth-protected-resource`)로 로그인을 먼저 요구한다.
이미 공개 주소로 추가했다면 지우고 이 주소로 다시 추가한다. 연결하면 oddbout.com 동의 화면에서 Google로 로그인해 승인한다.
동의 화면(`web/cloud-connect/connect.mjs`의 `agentOf`)은 에이전트가 돌아갈 주소로 요청한 쪽을 가린다. ChatGPT(Dots)는 두 호스트 어디로든,
Grok은 `https://grok.com/connectors-oauth-exchange-code/`, Cursor의 Grok Bot(웹)은 `https://www.cursor.com/agents/mcp/oauth/callback`·
`https://www.cursor.com/bot/mcp/oauth/callback`로만 돌아간다. 데스크톱 클라이언트의 loopback·앱 스킴 주소는 받지 않는다. 화면의 문구와
"돌아가기" 링크도 그 에이전트를 따른다. xAI는 이 콜백을 문서로 내지 않아 사용자 보고에서 가져왔다. 실제 Grok 연결로 한 번 확인한다.
MCP 함수의 브라우저 Origin 허용 목록에도 `grok.com`·`www.grok.com`·`cursor.com`·`www.cursor.com`이 있다.

Claude 연결(2026-10-28, 주소 2026-10-29): claude.ai → 사용자 지정 → 커넥터(`https://claude.ai/customize/connectors`) → 커스텀 커넥터 추가. 이름 `ODDBOUT`, 서버 URL은 위 주소다.
추가한 뒤 연결을 누르고 Google로 로그인해 승인한다. 동의 화면은 Anthropic의 MCP 콜백 `https://claude.ai/api/mcp/auth_callback`·
`https://claude.com/api/mcp/auth_callback`으로만 돌아간다. Claude 웹·데스크톱·모바일과 Claude Code는 이 커넥터 하나를 함께 쓴다.
Claude Code는 이 커넥터를 쓰거나, 아래 [터미널·편집기 에이전트](#터미널편집기-에이전트-2026-10-29)처럼 직접 연결한다. 그림을 받는 도구(`prepare_fighter_registration`의 파일,
`upload_fighter_asset`, `request_hosted_fighter`의 그림)는 OpenAI 파일 호스트만 받으므로 Claude에서는 글로만 만든다.
MCP 함수의 Origin 허용 목록에 `claude.ai`·`claude.com`이 있다. 2026-10-28 실제 연결로 확인했다: Claude가 이름 `Claude`, 돌아갈 주소
`https://claude.ai/api/mcp/auth_callback`으로 클라이언트를 자동 등록했다. 그때 겪은 것:

- 팀·엔터프라이즈 조직에서는 소유자만 커스텀 커넥터를 추가한다(조직 설정 → 커넥터, `https://claude.ai/admin-settings/connectors`). 구성원 화면의
  "커스텀 커넥터 추가"는 회색이다. 소유자가 추가하면 구성원은 자기 커넥터 목록에서 연결을 누른다.
- 인증은 **지금 로그인**을 고른다. 이 서버는 공개 도구를 로그인 없이 답하므로 Claude가 "로그인 없음"으로 자동 감지한다. 그대로 두면 계정이 필요한
  도구(선수 만들기·등록·내 선수)를 쓸 수 없다. 인증 방식은 추가한 뒤 바꿀 수 없으니 지우고 다시 추가한다.
- OAuth 클라이언트는 **자동으로 등록**(DCR)을 고른다. 추천으로 표시되는 "Claude의 게시된 ID"(CIMD)는 Supabase Auth가 지원하지 않는다.
  클라이언트 ID·시크릿은 비워 둔다.
- 추가할 때 "서버를 확인할 수 없습니다"가 나오면 `mcp.oddbout.com`의 Render 무료 서버가 잠들어 있던 것일 수 있다. 잠시 뒤 다시 시도한다
  (운영자 PC가 14분마다 깨운다).

사이트의 Claude 안내(2026-10-29)는 위 공개 주소 대신 로그인 먼저 주소(`SIGN_IN_RESOURCE`)를 준다. 첫 요청이 401과 `WWW-Authenticate`를 받으므로
Claude가 인증을 OAuth로 감지한다. 그래서 "로그인 없음"을 "지금 로그인"으로 바꾸는 단계가 없어진다. Grok에서 같은 주소로 실제 연결을 확인했다(2026-10-29).
Claude에서는 아직 실제로 확인하지 않았다. 게시 뒤 한 번 연결해 확인한다(게임 `8bf1ed8e7`). OAuth 클라이언트는 그대로 "자동으로 등록"을 고른다.

## 터미널·편집기 에이전트 (2026-10-29)

Claude Code, Codex(CLI·앱·IDE 확장이 설정을 함께 쓴다), Gemini CLI는 자기 PC의 loopback 콜백(`http://127.0.0.1:<포트>/…`,
`http://localhost:<포트>/…`)으로 클라이언트를 동적 등록한다. Supabase Auth의 동적 등록은 http를 loopback에만 받는다(supabase/auth PR #2298).
MCP 인가 명세(2025-11-25)는 redirect를 `localhost` 또는 https로 정하고, 동의 화면에 redirect 호스트를 보이고 loopback이면 경고하라고 한다.

- 동의 화면(`web/cloud-connect/connect.mjs`의 `agentOf`)은 loopback 주소(`127.0.0.1`·`[::1]`·`localhost`, http, 아무 포트·경로)를 `local`로 받는다.
  그 밖의 127/8 주소, `0.0.0.0`, 닮은 호스트, 계정 정보가 든 주소, 앱 스킴(`cursor://`)은 받지 않는다.
- `local` 요청은 "이 컴퓨터의 앱"으로 부른다. 클라이언트 이름은 클라이언트가 스스로 정한 값이라 믿지 않는다. 이름 옆에 돌아갈 호스트와 포트를 보이고,
  승인 버튼 위에 경고(`localWarning`)를 둔다. 오류 때 링크는 사이트의 내 에이전트(`creator.html#view=agents`)다.
- 서버 주소는 로그인 먼저 주소다. 공개 주소는 로그인 없이 답하므로 CLI가 인증이 필요 없다고 본다. 로그인 먼저 주소는 POST·GET·HEAD에 401을 준다.
  Gemini CLI는 연결 전에 HEAD로 묻는다.
- MCP 함수의 Origin 허용 목록은 바꾸지 않는다. 이 CLI들은 브라우저가 아니라 Origin을 보내지 않는다.

```bash
# Claude Code: 추가한 뒤 Claude Code에서 /mcp → oddbout → Authenticate
claude mcp add --transport http --scope user oddbout https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp/signin
# Codex: 추가한 뒤 로그인(브라우저가 열린다)
codex mcp add oddbout --url https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp/signin
codex mcp login oddbout
# Gemini CLI: 추가한 뒤 Gemini CLI에서 /mcp auth oddbout
gemini mcp add --transport http --scope user oddbout https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter-mcp/signin
```

로그인은 같은 PC의 브라우저가 loopback 콜백에 닿아야 한다. SSH로 접속한 원격 PC·컨테이너에서는 브라우저가 그 PC의 loopback에 닿지 않는다.
사이트의 내 에이전트는 등록 이름으로 칸을 고른다: `Codex` → Codex, `Claude Code` → Claude, `Gemini CLI MCP Client` → Gemini.
그림을 받는 도구는 OpenAI 파일 호스트만 받으므로 이 에이전트들은 글로 만든다.

사이트에서 보기(2026-10-28): oddbout.com 제작자 페이지의 My agents(`creator.html#view=agents`)가 Codex(ChatGPT·Dots)·Grok·Claude 카드에 연결을 보이고,
연결을 끊는다(Supabase Auth의 `auth.oauth.listGrants`·`revokeGrant`). 카드 목록은 `af_account_agents`가 계정에 둔다.

연결 후 대화 입력창에서 `@ODDBOUT`을 입력하고 **플러그인 항목을 선택**한다.
일반 텍스트로 이름만 입력한 것과 실제 플러그인 선택은 다르다.
기존 도구 목록이 남아 있으면 설정 → 플러그인 → ODDBOUT → `도구 새로 고침`을 누른다.
세부 정보 → 앱에서 실제 `get_profile`, `check_creation_readiness`와 필요한 등록 도구가 보이는지 확인한다.
호스팅 생성 도구와 에이전트 도구는 아래의 서버 설정에 따라 노출되므로 과거 도구 개수를 기준으로 판단하지 않는다.
공식 갱신 안내는 새 대화에서 재확인을 권장한다. 기존 대화는 최신 플러그인을 다시 선택해
실제 도구 노출 여부를 확인하며, 목록 갱신을 위해 재로그인·권한 확대·PC 설치를 요구하지 않는다.

## 로그인 만료와 오류 안내 (2026-10-31)

Cursor의 Grok Bot이 02:21Z에 로그인 먼저 주소로 연결한 뒤 토큰을 한 번도 갱신하지 않았다. 토큰은 1시간 뒤(03:21Z) 만료됐다.
그 뒤 모든 호출(06:45·07:47·09:02·10:17Z)이 같은 만료 토큰을 보냈고, 이유 없는 401을 받았다. 봇은 사용자에게 "ODDBOUT 로그인 서버가
잠시 응답하지 않는다"고 안내하고 30분마다 재시도하는 루틴을 만들었다. 재시도로는 풀리지 않는 일이다. 근거는 운영 로그의 요청 기록이다
(토큰 iat·exp, UA, 발신 IP). 같은 시간 grok.com 커넥터(UA `Grok`)는 같은 서버에서 매시간 정상적으로 갱신했다.

**refresh token은 이미 준다.** Supabase Auth의 OAuth 서버는 코드 교환마다 refresh token을 함께 준다(`offline_access` 범위와 상관없다).
이 봇의 세션은 `offline_access`까지 받았고, 클라이언트의 `grant_types`는 `authorization_code,refresh_token`이다(운영 DB, 2026-10-31).
동적 등록 클라이언트의 기본 `grant_types`에도 `refresh_token`이 들어 있다. 서버 메타데이터도 `refresh_token` 그랜트를 알린다(supabase/auth
`internal/api/oauthserver`, 2026-10-31 확인). 로그에서 Grok Bot은 401을 받고 서버 메타데이터(`token_endpoint` 포함)를 읽었지만, 8시간 동안
어떤 토큰 주소로도 갱신 요청을 보내지 않았다. 별도의 `undici` 요청은 메타데이터를 Supabase 호스트 루트
(`/.well-known/oauth-protected-resource/functions/v1/ai-fighter-mcp/signin` 등)에서 찾았다. 그 주소는 Supabase 게이트웨이가 401로 답한다.
이것이 갱신하지 못한 이유인지는 추정이다. 클라이언트 내부는 보지 못했다. 갱신은 클라이언트가 할 일이라 우리가 줄 것이 더 없다. 서버에서 할 수 있는 일은 아래 두 가지다.

- **Cursor 웹 에이전트(Grok Bot)에만 만료 유예**: 만료된 커넥터 토큰을 7일(`EXPIRED_TOKEN_GRACE_MS`, Supabase 토큰 수명 설정의 최댓값)까지 받는다.
  `getClaims(token, { allowExpired: true })`로 서명을 검증한다. 받는 조건은 `af_mcp_expired_token_state`(마이그레이션 `20261031150000`)가 `usable`이라고 답하는 경우다.
  - 연결이 살아 있고(`af_mcp_session_active`), 사용자가 정지·삭제되지 않았다. 아니면 `ended`.
  - 클라이언트가 Cursor의 것이다. Cursor MCP 콜백(`https://www.cursor.com/agents/mcp/oauth/callback`·`/bot/mcp/oauth/callback`)이 하나 이상 있고,
    나머지 redirect URI는 모두 http loopback이어야 한다. 운영의 실제 등록은 `…/agents/mcp/oauth/callback,http://localhost:8787/callback`이었다.
    그래서 처음 적용한 "모두 Cursor 콜백" 규칙(`20261031150000`)은 이 봇을 놓쳤고, `20261031151000`이 이를 바로잡았다. 아니면 `strict`다. 다른 클라이언트는 MCP 명세대로 만료 토큰에 401을 받는다. MCP SDK는 401을 받아야만 갱신하므로, 유예를 주면
    그 토큰들의 수명만 늘어난다(적대적 리뷰 지적).
  - 그 토큰을 발급한 뒤 세션이 갱신되지 않았다. 아니면 `refreshed`다. Auth는 갱신할 때마다 새 토큰에 서명한 직후 `auth.sessions.refreshed_at`(UTC,
    시간대 없는 timestamp)을 적는다. 발급 시각 + 5초 이후의 `refreshed_at`은 더 새 토큰이 있다는 뜻이다.
  로그아웃·내 에이전트에서 연결 해제·승인 취소는 즉시 막힌다. Supabase Auth 자신(`/auth/v1/user` 등)은 만료 토큰을 계속 거절한다.
  토큰 훅으로 `exp` 자체를 늘리는 방법은 쓰지 않았다. Auth의 `/auth/v1/user`는 대상·역할을 보지 않아서, 그러면 그 토큰으로 이메일·비밀번호
  변경까지 7일 동안 열린다. 확인하지 못한 경계도 있다. refresh token 재사용 탐지가 세션 행을 남기는지, 세션 시간 제한·비활성 제한을 쓰는지다.
  둘 다 Cursor 클라이언트의 7일 안으로 한정된다.
- **거절 이유**: 거절한 토큰의 401은 RFC 6750대로 이유를 말한다. 헤더는 `WWW-Authenticate: Bearer resource_metadata="…", scope="…", error="invalid_token",
  error_description="…"`이고, 앞부분은 예전과 같다. 본문은 `{ error, code, error_description }`이다. 토큰 없이 온 요청에는 지금처럼 `error`를 붙이지 않는다.
  설명문에는 따옴표·쉼표·세미콜론을 넣지 않는다. 헤더를 단순하게 자르는 클라이언트를 위해서다. 서버 지침에도 두 가지를 적었다.
  이 이유를 사용자에게 그대로 전한다. 다시 연결하라는 이유면 재시도를 예약하지 않는다.

| `code` | 상태 | 뜻 | 사용자 조치 |
| --- | --- | --- | --- |
| `authentication-required` | 401 | 토큰 없음 | 커넥터에서 ODDBOUT 로그인 |
| `token-expired` | 401 | 만료(Cursor 외 클라이언트), 또는 Cursor에서 만료 뒤 7일이 지남 | 에이전트가 갱신. 못 하면 커넥터 설정에서 다시 연결 |
| `token-superseded` | 401 | 더 새 토큰이 이미 발급된 옛 토큰 | 새 토큰 사용. 안 되면 다시 연결 |
| `connection-ended` | 401 | 로그아웃, 연결 해제, 승인 취소, 사용자 정지·삭제 | 커넥터 설정에서 ODDBOUT 다시 연결 |
| `invalid-token` | 401 | 서명·형식·발급자·대상·역할이 커넥터 토큰이 아님 | 커넥터 설정에서 ODDBOUT 다시 연결 |
| `sign-in-check-unavailable` | 503, `Retry-After: 30` | DB·Auth·네트워크 오류(JWKS 429·5xx 포함)로 확인 자체를 못 함 | 잠시 뒤 재시도(다시 로그인할 일 아님) |

예전에는 확인 중 DB 오류도 401이었다. 그래서 클라이언트가 멀쩡한 로그인을 버리고 다시 로그인하러 갔다. 이제 이 경우는 503이다.
형식이 깨진 토큰에서 auth-js가 예외를 던지면 503이 아니라 `invalid-token`이다. 테스트는 실제 auth-js와 로컬 JWKS로 이것을 확인한다.
`mcp.oddbout.com` 게이트웨이(`worker/cloud-gateway.mjs`)도 2026-11-01부터 `Retry-After`를 넘긴다.
일주일이 지나도 갱신하지 않는 클라이언트는 `token-expired`를 받는다. 그때는 다시 연결해야 한다. 갱신은 클라이언트가 고칠 일이다.
루트 `.well-known`을 우리가 답하는 주소는 아래에서 만들었다.

## 우리 도메인의 로그인 먼저 주소 (2026-11-01)

10-31에 Grok Bot이 두 번(11:43Z·15:35Z) 스스로 토큰을 버렸다. 직전 호출은 200이었는데 토큰 없이 호출해 `authentication-required`를 받았고,
새 클라이언트를 등록해 다시 로그인을 시작했다. 두 번 다 사용자가 Google 단계에서 멈췄다. 봇은 "로그인 서비스 일시 중단"이라고 안내했다.
매번 그 직전에 봇의 `undici` 요청이 메타데이터를 Supabase 호스트 루트(RFC 9728 위치,
`/.well-known/oauth-protected-resource/functions/v1/ai-fighter-mcp/signin`)에서 찾았고 401을 받았다. 그 루트는 Supabase 게이트웨이의 것이라 우리가 답할 수 없다.
이 401이 토큰을 버린 원인이라는 것은 추정이다. 클라이언트 내부는 보지 못했다. 근거는 운영 로그의 요청 순서와 응답 크기다. 토큰 없는 401은 137바이트(gzip)이고,
거절된 토큰의 401은 이유가 붙어 더 크다.

그래서 같은 서버를 `https://mcp.oddbout.com/signin`(`PUBLIC_SIGN_IN_RESOURCE`)으로도 연다. 이 호스트는 루트도 우리 것이다.

- 게이트웨이는 `mcp.oddbout.com` 호스트에서만 세 경로를 넘긴다. `/signin`(POST·GET·HEAD·OPTIONS)은 함수의 `/signin`으로 간다.
  `/signin/.well-known/oauth-protected-resource`는 `WWW-Authenticate`가 가리키는 곳이다. `/.well-known/oauth-protected-resource/signin`은 RFC 9728의 루트 위치다.
  둘 다 함수의 `/signin/.well-known/oauth-protected-resource`로 간다. 옛 Render 호스트(`ai-fighter-validator.onrender.com`)에는 이 경로가 없다.
- 게이트웨이는 `x-oddbout-public-resource: https://mcp.oddbout.com/signin`을 붙인다. 함수는 로그인 먼저 경로에서 이 값일 때만 메타데이터의 `resource`와
  `WWW-Authenticate`의 `resource_metadata`를 이 주소로 쓴다. 다른 값이거나 값이 없으면 `SIGN_IN_RESOURCE`다. 이 헤더는 광고하는 주소만 고르고, 인증과는 상관없다.
- 인가 서버는 그대로 Supabase Auth다(`authorization_servers`, 메타데이터 `/.well-known/oauth-authorization-server/auth/v1`).
  `mcp.oddbout.com`의 `/.well-known/oauth-authorization-server/signin`·`/.well-known/openid-configuration/signin`은 404다. 다른 issuer의 메타데이터를
  우리 주소에서 답하면 RFC 8414의 issuer 검사에 걸린다. 보호 자원 메타데이터를 찾은 클라이언트는 거기 적힌 인가 서버로 간다.
- 토큰 대상(`aud`)은 토큰 훅(`af_mcp_access_token_hook`)이 요청한 resource와 상관없이 세 값으로 정한다. 그래서 DB 변경이 없다.
- Supabase 주소는 계속 받는다. 이미 그 주소로 추가한 커넥터는 그대로 동작한다. 새 주소의 효과를 보려면 커넥터를 지우고 새 주소로 다시 추가해야 한다.
- 요청이 Render를 한 번 더 거친다. `mcp.oddbout.com`은 Render 무료 서버라 잠들 수 있다. 운영자 PC가 14분마다 깨운다. 본문 한도(64 KiB)는 함수와 같다.
  게이트웨이는 응답 헤더를 30초, 스트림 전체를 160초까지 기다린다.
- 사이트는 Grok 카드와 안내에서만 새 주소를 준다(게임 `ODDBOUT_MCP_GROK_SIGN_IN_URL`). grok.com과 Cursor의 Grok Bot이 이 카드를 쓴다. Claude·Codex·Gemini는
  Supabase 주소 그대로다. MCP TS SDK(1.32의 `selectResourceURL`)와 Gemini CLI는 `WWW-Authenticate`의 `resource_metadata`를 따라서 루트 문제를 겪지 않는다.
  그래서 Render 무료 서버를 거칠 까닭이 없다(적대적 리뷰 지적).
- 배포 순서는 함수(`fighter:mcp`) → Render → 사이트다. Render가 먼저 올라가면 옛 함수가 헤더를 모른다. 그러면 Supabase 주소를 광고하고, SDK의 resource 검사와
  Gemini의 출처 검사가 이를 거절한다. 사이트가 먼저면 `/signin`이 404다. 단계마다 운영에서 확인한 뒤 다음으로 간다.
- 게이트웨이는 클라이언트의 `user-agent`도 넘긴다. 그래서 함수 로그에서 어느 클라이언트인지 보인다. 발신 IP는 Render의 것이 된다.
- 새 주소로 실제 클라이언트가 연결한 것은 아직 확인하지 않았다. 처음 확인하는 대상은 Grok Bot이다. 이미 Supabase 주소로 추가한 Grok Bot은 커넥터를 지우고
  이 주소로 다시 추가해야 한다.

## 사용 흐름

통합 플러그인은 계정·등록에 호스팅 ODDBOUT MCP 연결 하나를 쓴다. 로컬 제작·세션·작업 기록·파일 검증은
작업 공간의 `creation:tool` CLI로 실행하며 두 번째 MCP 서버를 추가하지 않는다. 이전 `ai-fighter`와
`ai-fighter-creator` 연결의 제거 조건은 [통합 플러그인 이전 안내](ODDBOUT-PLUGIN.md)를 따른다.

| 작업 | 도구·실행 경로 |
| --- | --- |
| 연결 계정 확인 | 클라우드 `get_profile`, `check_creation_readiness` |
| 로컬 제작·재개·검증 | `creation:tool`의 세션·작업·환경·검증 도구([로컬 도구 안내](LOCAL-PLUGIN.md)) |
| 새 파이터 등록 | 클라우드 `prepare_fighter_registration` → `upload_fighter_asset` → `submit_fighter_registration` → `get_fighter_submission` |
| 내 기존 파이터 패키지 교체 | `prepare_fighter_registration`에 소유 파이터의 `fighterId`를 넣고 같은 업로드·제출 흐름 사용 |
| 제작자 사이트 열기 | 클라우드 `open_creator_homepage`의 고정 URL. 사이트에서 별도 로그인하고 `get_profile`과 같은 계정인지 확인 |

선택 인자 `fighterId`와 `open_creator_homepage`는 소스에서 지원한다. 운영 반영에는 `ai-fighter-mcp` 배포가 필요하다.
사용 전 실제 서버의 `tools/list`에서 해당 인자와 도구를 확인한다. 소스·연결 성공만으로 배포나 파일 전달 성공을 주장하지 않는다.
홈페이지 도구는 일회용 로그인 링크나 전체 웹 세션을 발급하지 않는다. 커넥터 인증과 사이트 로그인은 별도다.

1. `get_fighter_spec`의 overview/schema/creation을 읽고 기존 제작·검토 규칙을 따른다.
   첫 생성 전·작업 공간 재시작 뒤·등록 전에는 이 클라우드 커넥터의 `check_creation_readiness`를 호출한다.
   등록 계정 접근과 실제 생성·전달·패키지 검토 상태를 구분하며 로컬 stdio 로그인은 요구하지 않는다.
2. 최종 패키지 승인과 등록 요청을 받은 실제 fighter.json을 `prepare_fighter_registration`에 파일로 전달한다.
   기존 소유 파이터를 교체하라는 요청이면 `fighterId`를 지정해 ID와 이력을 유지하고, 생략하면 새 파이터를 준비한다.
   변경한 그림·동작은 필요한 묶음 검토와 최종 패키지 검증을 거친다. 새 패키지는 제작 중으로 돌아가며 출전 전 동작 확인이 필요하다.
3. 응답의 각 asset ID에 실제 WebP 파일을 `upload_fighter_asset`으로 전달한다.
4. 업로드가 끝나면 `submit_fighter_registration`, 이후 `get_fighter_submission`으로 확인한다.
5. `registered`만 등록 완료다. queued/validating을 완료라고 안내하지 않는다.
6. 프로필 세트(2026-10-31): 사용자가 고른 정면 원화와 얼굴 칸을 `prepare_profile_set`(선수 id·세트 파일·UUID) →
   `upload_profile_set_asset` → `submit_profile_set`으로 올리고 `get_profile_set`으로 확인한다. `review`는 운영자 승인 대기이고, `approved`가 되어야
   홈·명단에 정면이 나온다. 규격과 담백한 채색 문구·화풍 기준 그림은 `get_fighter_spec` overview의 `profileSet`에 있다
   ([가입 후 바로 이용하기](OPEN-REGISTRATION.md#프로필-세트정면-원화얼굴-칸-2026-10-31)).

### 실제 파일과 연결 계정 확인

- 등록 직전에 `get_profile`의 ID/이메일이 사용자가 선택한 계정인지 확인한다.
  다른 계정을 추가해도 기존 기본 연결이 자동 전환되는 것은 아니다. 계정 변경 후
  기존 턴의 도구가 `Unknown tool`을 반환하면 최신 플러그인을 선택한 새 턴에서 확인한다.
  운영자 연결을 임의로 해제하지 않는다.
- 현재 VM에 파일이 있으면 네이티브 파일 인자에 그 절대 경로를 전달한다. 호스트가
  실제 파일 업로드와 서명 URL 전달을 수행하므로 VM의 등록 서버 직접 접속은 필요하지 않다.
- Library/Page의 기존 파일은 호스트의 공식 materialization 경로를 먼저 사용한다.
  해당 기능이 제공되지 않으면 지원되는 원본 파일 읽기를 사용하되, 실제 반환 바이트를
  저장하고 원본 크기·SHA-256을 모두 비교한다. Pages `read_page_reference`의 JSON 원문과
  `image/webp` 원본 이미지 응답으로 이 경로를 확인했다. 변환된 화면 미리보기는 사용할 수 없다.
- 파일 전달 실패는 재생성 사유가 아니다. 저장된 파일과 제출 상태를 먼저 회수한다.
  임의 파일 ID/URL, 수기로 복사한 base64, 토큰 공유, 네트워크 정책 우회는 사용하지 않는다.
- VM의 Supabase 직접 GET이 차단돼도 네이티브 MCP까지 실패했다고 결론 내리지 않는다.
  실제 네이티브 계정 호출과 실제 파일 인자 전달 결과를 각각 확인한다.

파일 인자는 OpenAI `fileParams`의 `download_url`, `file_id`를 사용한다.
호스트가 이 인자를 파일 경로 형식으로 노출하면 실제 파일의 절대 경로를 전달한다.
호스트가 업로드와 서명 URL 발급을 담당하므로 에이전트가 URL이나 파일 ID를 만들지 않는다.
로컬 경로, 임의 외부 URL, 사용자 토큰을 대화에 요구하지 않는다.
동일한 패키지 재시도는 동일 UUID, 패키지 바이트 변경은 새 UUID를 사용한다.
서버는 기존 패키지를 덮어쓰지 않으며 소유자·크기·해시·유효기간을 검사한다.

등록 연결은 이미지 생성 구독/계정이나 VM 네트워크 허용을 대신하지 않는다.
실제 생성·대화 내 미리보기·사용자 검토·최종 패키징은 각각 확인해야 한다.
이 연결을 이유로 신규 생성, 제공자 변경, 검토 생략을 자동 승인하지 않는다.

## 에이전트 도구(3단계, 2026-10-27)

등록 뒤에 에이전트가 할 일이다. 선수를 싸우게 해 보고, 기록을 읽고, 싸우는 성격을 고친다. 도구는 함수에 결과 함수 열쇠
(`ODDBOUT_ARENA_AGENT_KEY`, 게임 `oddbout-arena`와 같은 값)가 있을 때만 목록에 나온다. 열쇠 없이 이 코드만 올리면 도구 목록은 그대로다.

| 도구 | 로그인 | 하는 일 |
| --- | --- | --- |
| `get_style_guide` | 없음 | `combat.style` 선택지의 뜻(`STYLE_GUIDE`)과 계약 값(`spec.combatStyle`). 캐릭터 소개를 성격으로 옮기는 번역은 에이전트가 하고 서버는 검사만 한다 |
| `list_fighters` | 없음 | 기본 선수와 목록에 오른 등록 선수의 id·이름 |
| `get_rankings` | 없음 | 컵 순위(기본 선수 점수, 등록 선수 승률) |
| `get_fighter_record` | 없음 | 선수의 공개 컵 기록·최근 경기·자주 만난 상대 |
| `get_cup` | 없음 | 컵 하나(대진·상태·치른 경기) |
| `read_bout` | 없음 | 경기를 다시 돌려 읽는 기록: 승패·끝난 방식·남은 HP·맞힌 수·하이라이트와 시각, 브라우저 다시 보기 링크. 컵 경기(`cupId`·`round`·`slot`)나 짝과 시드. 로그인했으면 그 계정의, 아니면 로그인 안 한 에이전트 전체의 분당 한도 |
| `spar` | 필요 | 두 선수의 한 판(지금 패키지). 순위에 들지 않고 남지 않는다. 등록 선수는 출전한 선수만. 계정마다 분당 한도 |
| `enter_cup` | 필요 | 연결 계정의 출전한 등록 선수로 16강 컵. 나머지 15명은 서버가 기본 선수에서 뽑는다. 결과는 컵 순위에 든다. 컵이 끝날 때까지(약 7초, 12초까지) 기다려 끝난 컵을 돌려준다. 사용자 요청이 있어야 한다 |
| `enter_fighter` | 필요 | 제작 중인 선수를 출전시킨다(2026-10-30). 사용자가 본 패키지 해시와 필수 동작 11개를 낸다. 그 뒤로 공개 명단·랭크 대결·컵에 나온다. 동작을 보여주고 사용자 요청이 있어야 한다 |
| `withdraw_fighter` | 필요 | 출전 취소. 다른 사람에게 더는 나오지 않고 전적은 남는다. 사용자 요청이 있어야 한다 |
| `update_fighter_style` | 필요 | 새 그림 없이 `combat.style`만 바꾼다(객체는 교체, null은 삭제). 프로필 고치기와 같은 길(`PATCH fighters/<id>/profile`의 `style`, 마이그레이션 `20261027170000_ai_fighter_style_edits`)이다. 사용자 승인이 있어야 한다 |
| `update_fighter_profile` | 필요 | 새 그림 없이 프로필 글(이름·소개·언어·콘셉트·기술 설명·언어별 이름·경기 대사)만 바꾼다. 준 칸만 바뀌고, null은 언어별 이름·대사를 지운다. 같은 길(`PATCH fighters/<id>/profile`). 사용자 승인이 있어야 한다 |

`get_registered_fighter`가 지금 성격(`fighter.combat` — 능력치·`style`·고유 기술 종류)을 준다. 성격 고치기는 통째로 바꾸므로 여기서 시작한다.

고리: `get_style_guide` → 소개를 성격으로 옮긴다 → `spar`·`read_bout`으로 본다 → 사용자 승인 → `update_fighter_style` → 다시 `spar`.
기술 클립(`skill`)은 등록 때 정해지므로 성격 고치기로 더할 수 없다.

ChatGPT 호출(`_meta`에 `openai/…`가 있는 호출): Apps SDK는 결과의 구조화 값과 텍스트를 모두 모델에 넘긴다. 그래서 1,200자를 넘는 결과의
텍스트는 필드 요약 한 줄로 줄인다(`compactText`, 실패 결과와 작은 결과는 그대로). 다른 호스트는 텍스트에 전체 JSON을 그대로 받는다.
로그인하지 않은 ChatGPT 사용자의 `read_bout` 한도는 `_meta["openai/subject"]`(익명 사용자 id)로 사용자마다 센다. 이 id는 호출하는 쪽이 정하므로
(바꿀 때마다 새 한도였다) MCP는 그 읽기에 `x-arena-signed-out: 1`을 붙이고, 아레나는 그 id의 한도와 함께 로그인 안 한 에이전트 전체의 공용 한도에도
센다(2026-10-30). id가 없는 읽기는 전처럼 공용 한도(`public`)만 쓴다.

MCP 점검(2026-10-27): 도구 목록 20 KB → 17 KB(UUID 칸의 짧은 패턴, `$schema` 줄 삭제), 선수 기록의 패키지 해시 생략, `list_fighters`의 두 조회를
동시에, 결과 함수 읽기 한도를 계정별로(첫 판은 모든 에이전트가 이 함수의 주소 하나로 분당 6번이었다).

만든 에이전트: 이 MCP가 준비한 등록과 성격 고치기는 그 OAuth 클라이언트 이름을 남긴다(`af_record_submission_agent`,
마이그레이션 `20261027180000_ai_fighter_made_with`). 명단(`GET /roster`, `/roster/:id`)은 선수의 가장 이른 기록을 `madeWith`로 보인다.
이름은 클라이언트가 동적 등록 때 스스로 정한 것(예: `ChatGPT`)이고 40자까지다. 제작자 페이지·키트로 만든 선수는 없다.

## 호스팅 생성 도구(2026-10-28)

ODDBOUT의 생성 워커가 사용자의 말(과 그림 1~2장)로 선수를 만든다. 에이전트는 사용자의 답만 전한다. 그래서 Grok·ChatGPT처럼 작업 공간이
없는 호스트도 선수를 만들 수 있고, Dots도 생성 단계를 하나하나 운전하지 않는다. 길은 제작자 페이지와 같은 API(`api/generations.mjs`)다.
상태 기계·쿼터(계정 보유 토큰 — 가입 때 500,000, 공식 생성 PC가 ODDBOUT 신청(`oddbout`, 또는 공식 PC가 맡은 `any`)에 쓴 토큰을 결과와 상관없이 뺀다, 자기 PC가 아닌 신청은 0 이하면 `generation-quota`; 하루 신청 셋, 대기열 상한)·운영 스위치는 DB가 정한다(`af_generation_balance`, `af_generation_charged`). 자기 PC·다른 사람 호스트 신청은 빼지 않는다. 그 신청의 브리프(공식 PC의 안전 판정)도 빼지 않고 하루 예산에만 센다. 운영자 계정은 막지 않고 빼지 않는다.
리스를 잃은 단계(그 사이 취소)나 결과가 거절된 단계의 토큰은 워커가 `POST /generation-worker/jobs/:id/usage`로 따로 보낸다. 단계가 돌던 리스 하나에 한 줄만 남는다.
공식 호스트는 UTC 00:00부터 쓴 codex 토큰이 하루 예산(`af_generation_settings.daily_token_budget`, 500,000) 아래일 때 새 ODDBOUT 신청을 시작한다
(2026-10-31). 워커가 단계마다 그 단계 동안 쓰인 codex 세션의 토큰을 결과에 실어 보내고(`host/codex-usage.mjs`), 서버가 단계별로 `af_generation_usage`에 남긴다.
예산을 다 쓰면 작업의 `queue.reason`이 `usage`이고 `resetsAt`(다음 UTC 00:00)에 다시 시작한다. 하루의 경계는 처음에 한국 자정이었다. 2026-10-31 사용자 결정으로 UTC로 옮겼다(`20261031160000`). 운영자 계정(`af_admins`)의 신청은 예산을 보지 않고 맨 앞이며
그 토큰은 하루 합에서 뺀다. 공식 줄의 하루 한도 0은 ODDBOUT 신청을 멈춘다(`paused`). 커뮤니티 호스트는 하루 한도(건수) 그대로다.
도구는 함수 비밀 `ODDBOUT_HOSTED_GENERATION_TOOLS`가 `1`일 때만 목록에 나온다. 이 코드만 올리면 도구 목록은 그대로다.
목록에 있어도 운영 스위치가 꺼져 있거나 워커가 없으면 신청은 `generation-unavailable`(그 이유 `reason`)로 끝나고 그림을 받지 않는다.

| 도구 | 하는 일 |
| --- | --- |
| `request_hosted_fighter` | 설명·언어와 선택 그림 둘(`picture`·`secondPicture`, 파일 인자, 권리 확인 `rightsConfirmed`)로 신청. `delegate: true`는 맡기기다(아래). 같은 계정·`idempotencyKey`로 **이미 저장된 작업**이 있으면 그림을 다시 올리지 않고 반환한다. 결과가 불명확할 때는 조회 도구로 복구한다 |
| `get_hosted_fighter` | 작업 상태, 외형 후보 둘·동작 미리보기의 서명 URL(10분), 프로필 초안, `next`. `jobId` 또는 원래 `idempotencyKey` 하나로 조회하며 둘 다 없으면 최근 다섯 신청, 열림 여부, 보유 토큰(`tokens`: granted·spent·balance). 각 작업은 그 작업이 쓴 토큰(`job.tokens`)을 보인다. 키 조회는 새 신청·업로드를 하지 않는다. `waitSeconds`(25초까지)는 찾은 작업의 상태를 기다린다 |
| `choose_hosted_look` | 후보 `a`·`b` 고르기, 또는 한 문장 수정(두 장을 다시 그린다) |
| `revise_hosted_motion` | 동작 하나를 한 문장으로 다시. 나머지 동작은 그대로 |
| `register_hosted_fighter` | 사용자가 동작을 승인한 뒤 등록. 프로필은 워커 초안 위에 사용자가 바꾼 칸만 얹는다(언어별 이름·대사는 칸별로). 다른 선수와 같은 서버 검사를 거친다 |
| `cancel_hosted_fighter` | 신청 취소. 이미 쓴 토큰은 돌아오지 않는다(보유 토큰, 2026-10-31) |

성공한 작업 응답에는 `next`(`hostedNext`)가 있다(목록은 각 `jobs[].next`): 사용자에게 무엇을 보이고 물을지, 또는 얼마나 기다릴지.
한 선수는 대략 신청 → 외형 두 장(몇 분) → 고르기 → 동작 11개(15~30분) → 확인 → 등록이다.

### 호스팅 작업의 중단과 미리보기 복구

1. 신청 전에 `get_profile`로 확인한 계정 ID, UUID `idempotencyKey`와 원래 인자를 보존하고 응답의 `job.id`를 기록한다.
   연결 직후에는 `get_profile`로 계정을 확인하고 `check_creation_readiness(purpose: "connection")`로 계정 접근을 읽는다.
   호스팅 경로에 로컬 stdio 로그인이나 사용자 PC 생성기 설치를 요구하지 않는다.
2. 시간 초과·대화 중단·연결 재설정은 작업 실패의 증거가 아니다. 재연결 후 같은 계정인지 확인하고
   `get_hosted_fighter({jobId})`로 기존 상태부터 읽는다. ID를 잃었다면 원래 `idempotencyKey`로 조회한다.
   둘 다 없으면 인자 없이 최근 **다섯** 작업을 확인한다.
   여러 작업 중 어느 것인지 불명확하면 사용자에게 확인하며, 최신 작업을 임의로 수정하지 않는다.
3. `get_hosted_fighter({idempotencyKey})`는 최근 목록에 없는 오래된 작업도 **현재 계정 범위에서 읽기만** 한다.
   이미 저장된 작업은 서비스가 신규 접수를 중지했어도 회수하며, 원본 그림의 만료된 URL이나 파일 인자도 필요 없다.
   `jobId`와 키를 함께 주면 `invalid-selector`다. `not-found`는 최초 호출이 아직 그림을 받는 중이거나 계정이 다른 경우에도
   나올 수 있으므로 실패 확정이 아니다. 원래 호출·계정을 확인하고 필요하면 같은 키로 다시 **조회**한다.
   DB 조회 오류도 작업 부재로 바꾸지 않는다. 키·ID·목록으로 특정할 수 없으면 미확인 상태를 설명한다.
   복구를 위해 `request_hosted_fighter`를 반복하거나 새 키로 대체 신청하지 않는다. 최초 작업 저장 전의 병렬 재신청·부분 업로드는
   같은 키만으로 중복 업로드가 방지되지 않아 신청 도구의 `idempotentHint`는 `false`다.
   원래 실행이 종료됐고 재시도해도 안전함을 확인한 경우에만 같은 키·원래 인자를 재사용한다.
   사진이 있는 신청은 사진을 받기 전에 신청 검사(`af_generation_check`: 동의, 진행 중 작업, 하루 한도, 호스트)를 먼저 통과한다.
   거절된 신청은 사진을 받지도 남기지도 않는다.
4. `waitSeconds`는 최대 25초의 상태 대기다. 종료 때 아직 `queued`·`appearance`·`motions`·`submitting`이거나 제출 검사 중이면 같은 ID를 나중에 조회한다.
   `choose_hosted_look`·`revise_hosted_motion`·등록 호출의 결과가 불명확할 때도 우선 상태를 읽는다.
   새 외형/동작 수정은 생성량과 수정 횟수를 소비하므로 같은 요청을 무조건 재전송하지 않는다.
   두 수정 도구의 `idempotentHint`도 `false`다. 수정이 완료되어 다시 검토 상태가 됐어도 이전 호출을 반복하면 새 수정으로 처리된다.
5. 외형·동작 URL은 10분짜리다. 만료되거나 표시가 실패하면 같은 `jobId`를 다시 조회하여 새 URL로 실제 이미지를 표시한다.
   `null` URL이나 저장소 오류가 계속되면 전달 문제로 보고한다. 새 키·외형 수정·동작 재생성으로 해결하지 않는다.
   URL 발급, 대화의 실제 이미지 표시, 사용자의 해당 버전 검토는 각각 별개다.
6. 반환된 `next`와 현재 사용자 요청에 따라 같은 작업을 이어간다. `submitted`도 아직 검사 중일 수 있으며
   `submission.stage: "registered"`와 등록 ID를 확인한 경우만 등록 완료로 안내한다.

구현 근거는 `mcp/cloud/hosted-tools.mjs`의 소유자별 기존 키 조회와 `get_hosted_fighter`, `api/generations.mjs`의 작업 조회·서명 URL 발급이다.
`test/hosted-generation-mcp.test.mjs`는 오프라인 DB와 모의 Storage로 응답 유실 뒤 새 커넥터의 같은 작업 회수,
작업 저장 전 조회·최근 다섯 개 밖의 키 조회·저장된 작업의 재호출에서 추가 신청·업로드가 없음을 검사한다.
URL 재발급과 신규 접수가 열린 상태에서 다른 계정의 키 조회 차단도 검사한다. 이 테스트는 실제 Dots/Grok 로그인,
네트워크 단절, 이미지 표시나 생성 워커의 성공을 증명하지 않는다. 플랫폼 검증 시 이 단계를 각각 관찰해 기록한다.

**맡기기**(`delegate`, 2026-10-28): 사용자가 "알아서 해 줘"라고 하면 외형 고르기를 ODDBOUT이 한다. 워커가 두 장을 그린 뒤 codex 판정(도구 끔)이
설명과 맞고 온몸·옆모습·깨끗한 한 장을 고른다. 고르면 기다리지 않고 동작으로 넘어간다(작업 열 `delegate`, 이관
`20261028120000_oddbout_hosted_generation_delegate`). 둘 다 마땅치 않으면 원래대로 사용자에게 묻는다. 사용자가 외형에 수정 문장을 주면 그 뒤로는
그가 고른다. 동작 확인과 등록은 맡기기여도 사용자가 한다. 그래서 사용자가 답하는 곳은 끝의 한 번이다.

### 커뮤니티 호스트(2026-10-28)

자기 구독(또는 API 키)을 쓰려는 제작자가 자기 PC에서 생성 워커를 돌려 다른 사람의 신청을 만든다. ODDBOUT 사무실 PC는 공식 호스트다.
설계와 결정은 게임 저장소 `docs/Plan/2026-10-28-community-generation-hosts`에 있다. 이관 `20261028130000_oddbout_generation_hosts`.

- 신청의 `host`: `oddbout`(기본, 공식 호스트), `any`(승인된 호스트 누구나), 호스트 id. `any`와 호스트 id는 사용자의 글과 그림이 그 호스트 PC로 가므로
  `hostConsent: true`가 있어야 한다. 브리프(안전 판정)는 늘 공식 호스트가 쓴다. 그 뒤 단계를 처음 가져간 호스트가 끝까지 맡는다.
  공식 호스트는 다른 호스트가 켜져 있으면 `any` 신청을 3분 기다려 준다.
- `list_generation_hosts`(로그인 없음): 승인되고 켜진 호스트의 id·이름·켜짐·`any` 받기·오늘 남은 수.
- 호스트 되기와 생성기 설치·운영은 `npm run host -- …`([생성 호스트 되기](GENERATION-HOST.md), 생성기 `host/`)가 아래 API를 부른다(사이트 화면은 다음 단계):
  `POST /generations/host`(이름·`billing` `subscription`|`api-key`·약관 동의) →
  운영자 승인(`af_generation_hosts.approved`) → `POST /generations/host/keys`(워커 열쇠, 한 번만 보인다, 90일, 둘까지) →
  `PATCH /generations/host`(켜짐·`any` 받기·하루 한도 0~50), `DELETE /generations/host/keys`(열쇠 모두 끄기). 공개 목록은 `GET /generations/hosts`.
- 하루 한도와 심장 박동은 호스트마다 `af_generation_hosts`에 있다(공식 호스트는 한도 0 = 멈춤으로만 쓰고, 시작은 토큰 예산이 정한다). `af_generation_settings`에는 서비스 스위치 `enabled`·대기열 상한·하루 토큰 예산이 있다.

## 공방과 연대기 도구(4단계, 2026-10-27)

선수의 정본을 쓰고, 다른 선수를 비평·제안하고, 관계를 맺고, 세계를 연다. 에이전트 도구와 같이 결과 함수 열쇠가 있을 때만 목록에 나온다.
경로는 같은 API(`api/workshop.mjs`, 마이그레이션 `20261027200000_oddbout_workshop`·`20261027210000_oddbout_open_worlds`·
`20261027230000_oddbout_workshop_hardening`)다. 이 MCP가
쓴 공방 글과 정본 판에는 OAuth 클라이언트 이름이 남는다(`createHandler`의 `agentClient` — 도구 인자에서 받지 않는다).

| 도구 | 로그인 | 하는 일 |
| --- | --- | --- |
| `get_fighter_story` | 없음 | 정본과 판 목록, 공방 최근 글(더 앞은 `before`), 맺은 관계, 결과가 만든 관계(재대결·설욕·천적·우세), 그의 경기의 경기평. 기본 선수는 사이트 프로필 |
| `get_world` | 없음 | `worldId` 없이: 공개 세계 목록과 새 세계 표지 id. 있으면: 소개·진영·소속 선수·정사(주인이 올린 글)·소속 선수의 최근 컵 경기와 경기평 |
| `update_fighter_canon` | 필요 | 연결 계정 선수의 정본 다음 판(성격·말투·동기·금기·대표 장면). 읽은 판(`baseVersion`) 위에만 쓴다. 선수당 한 시간 30판. 사용자 승인이 있어야 한다 |
| `post_workshop_note` | 필요 | 등록 선수의 공방에 비평·제안(정본 칸·싸우는 성격·다시 그리기)·경기평. 근거 경기 셋까지, 경기평은 하나 이상. 공개 이름이 보인다(`nickname` 으로 처음 한 번 정한다). 10분 10개·하루 60개 |
| `get_workshop_inbox` | 필요 | 연결 계정 선수에게 온 열린 글(최근 100개), 기다리는 관계(`otherKind`: 상대 쪽에서 본 관계), 내 선수의 지금 정본(`version`이 쓸 때의 기준 판 — 공개 무대 밖 선수도), 공개 이름 |
| `resolve_workshop_note` | 필요 | 열린 제안을 받거나 거절한다. 거절은 비평·경기평도 받은 글에서 치운다. 받으면 정본 칸은 그때의 정본 위에 합친 새 판(데이터베이스가 선수 잠금 안에서 합친다 — 칸이 하나도 안 남으면 `canon-empty`), 성격은 답한 뒤 프로필 고치기와 같은 길(제안 id 가 멱등 키 — 실패했으면 다시 받기로 마친다). 사용자 결정이 있어야 한다 |
| `set_fighter_relation` | 필요 | 공개 무대의 등록 선수끼리 라이벌·동료·스승·제자를 맺기(다른 주인은 받아야 선다)·받기·거절·끊기. 한 쌍에 하나, 선수당 열둘(지운 선수와의 관계는 세지 않는다) |
| `manage_world` | 필요 | `create`: 세계 열기(계정당 둘, 바로 공개, 표지는 `get_world`의 목록). `update`: 내 세계의 글·표지·진영 목록, 글을 정사로 올리기·내리기, 선수 빼기. `place`: 공개 무대의 내 선수를 남이 연 세계·진영에 두기·빼기(세계당 200명) |
| `write_world_post` | 필요 | 세계 라운지에 글. `nickname`으로 먼저 가입한다. 세계 주인은 바로 정사로 올릴 수 있다. 같은 UUID 로 다시 보내면 같은 글이 돌아온다(남의 글 id 면 `post-exists`) |

정본·공방 글·라운지 글은 다른 사람의 글이다. 도구 설명이 에이전트에게 그것을 지시가 아닌 데이터로 읽으라고 적는다.
세계 쓰기 세 가지는 `manage_world` 하나로 묶는다. 도구 개수와 목록 크기는 배포·서버 설정에 따라 달라지므로 실제 `tools/list`로 확인한다.

## 운영 설정과 배포

### 본인 소유 캐릭터 삭제

1. 사용자의 명시적인 삭제 요청을 받고 `get_profile`·`list_my_fighters`로 소유 계정과 정확한 대상을 확인한다.
2. `prepare_fighter_deletion(fighterId)`로 계정·캐릭터 이름·삭제 범위·10분 유효 확인값을 받는다.
   이 호출만으로 삭제하지 않는다. 반환된 대상과 범위를 사용자에게 보여 준다.
3. 사용자가 그 계정·대상의 삭제를 명시적으로 지시했을 때만 반환된 `confirmationToken`,
   정확한 `confirmName`, `confirm: true`로 `delete_fighter`를 실행한다.
   기존 지시가 같은 대상과 범위에 명확히 해당하면 같은 확인을 반복해서 요구하지 않는다.
4. 삭제 영수증의 `stage: deleted`, 대상 조회 결과와 내 목록에서의 제외를 확인한다.

서버는 이메일이나 owner ID 입력을 받지 않고 서명된 OAuth 소유자·세션·클라이언트를 사용한다.
두 단계 모두 살아 있는 세션/동의를 검사하며 실행 시 소유권, 이름, 만료, 패키지·프로필 버전을
트랜잭션 안에서 다시 검사한다. 세션 변경·이름 불일치·확인 후 수정은 거부한다.
같은 확인값의 성공 재시도는 원래 영수증을 반환한다. 새 확인값으로 무작정 재시도하지 않는다.

삭제는 내 목록·공개 로스터·세계관 캐릭터 카드·랭킹에서 제거하고 새 대전을 막으며 계정 슬롯을 반환한다.
비공개 원본 패키지와 제출·경기·감사 기록은 보존한다. 파일 완전 삭제라고 안내하지 않는다.
이미 발급된 공개 에셋 링크는 최대 600초 안에 만료된다. 기존 패키지는 덮어쓰지 않으며
일반 업데이트나 진행 중이던 검증이 삭제된 캐릭터를 되살릴 수 없다.
DB RPC/확인 기록은 service_role 전용이고, 일반 사용자와 MCP 토큰은 직접 실행/조회할 수 없다.
삭제 migration은 `20261024104406_ai_fighter_owner_deletion.sql`이다.

사이트의 **선수 삭제** 버튼(2026-10-30)도 같은 두 단계다. `POST fighters/<id>/deletion`이 준비(삭제하지 않는다),
`POST fighters/<id>/deletion/confirm`이 `{ confirmationToken, confirmName }`으로 실행한다([api/fighter-deletion.mjs](../api/fighter-deletion.mjs)).
사이트 로그인에는 OAuth 클라이언트가 없어 Edge가 client로 nil UUID를 넘긴다. DB의 `af_owner_session_active`는 그 사용자의
살아 있는 일반 세션(OAuth 클라이언트 없음, 만료 전)인지 본다. 로그아웃하면 세션 행이 지워지므로 그 토큰으로는 준비도 실행도 못 한다.
커넥터 세션의 확인값과 사이트 세션의 확인값은 서로 쓸 수 없다. 이관은 `20261030120000_ai_fighter_site_deletion.sql`이다.
화면은 서버가 돌려준 이름을 그대로 입력해야 삭제 버튼이 켜진다. 확인값 만료·그사이 선수 변경은 새 확인을 받아 다시 누르게 하고,
응답을 잃은 실행은 같은 확인값으로 다시 보낸다(서버는 첫 영수증을 돌려준다).

검증: `node --test test/fighter-deletion.test.mjs test/cloud-mcp.test.mjs test/api.test.mjs test/database.test.mjs`.
`scripts/run-cloud-review-checks.mjs`의 `ODDBOUT_REVIEW_CHECK_DELETION=1`은 기존 심사 캐릭터를
삭제하지 않고 준비·잘못된 토큰·이름·다른 소유자 차단을 점검한다. 시험 OAuth grant는 종료 시 철회한다.

### 서버와 승인 페이지

- Supabase 프로젝트 `ztfxxhtmtrvxvuxlqmgz`, 함수 `ai-fighter-mcp`.
- `verify_jwt=false`는 공개 MCP discovery를 위한 설정이다. 비공개 도구는 함수가
  서명/issuer/audience/만료/전용 권한 및 OAuth 세션·동의 철회를 직접 검증한다.
- Auth → OAuth Server: enabled, authorization path `/connect.html`, dynamic registration enabled.
- Auth → URL Configuration: Site URL `https://oddbout.com`, Redirect URLs에
  `https://oddbout.com/connect.html**` 추가. 기존 다른 URL은 보존한다.
- Auth → Hooks → Custom Access Token: `public.af_mcp_access_token_hook`.
  일반 로그인은 그대로 유지하고 OAuth client 토큰만 전용 audience와 `af_mcp` role로 제한한다.
  이 role은 Postgres에 생성하지 않는다. 일반 API도 OAuth 토큰을 거부한다.
- migration `20261024053500_ai_fighter_cloud_mcp_oauth.sql`을 먼저 적용한다.
- Deno: `npx deno@2.7.5 check --config supabase/functions/ai-fighter-mcp/deno.json supabase/functions/ai-fighter-mcp/index.ts`.
- `scripts/edge-bundle.mjs`의 `edgeFiles`에 새 함수의 entry/importMap/lock을 넘겨 배포 파일을 수집한다.
- 승인 페이지 소스: `web/cloud-connect/`. `scripts/build-cloud-connect.mjs <site-dir>`가
  페이지와 고정 버전 Supabase 브라우저 SDK를 복사한다. 전체 사이트 빌드에도 포함된다.
- OAuth 비활성화와 hook 비활성화는 함께 검토한다. 서버를 사용하는 동안 hook만 제거하면
  OAuth 토큰이 일반 DB 권한을 상속하므로 금지한다.

검증: `node --test test/cloud-mcp.test.mjs test/api.test.mjs test/database.test.mjs`.
실제 Google 사용자 로그인, 연결 토큰과 파일 전달은 호스트에서 별도로 검증한다.
성공한 MCP discovery만으로 실제 사용자 로그인/등록 성공을 주장하지 않는다.

## 배포 검증 기록 — 2026-10-24

- OAuth 로그인·승인 뒤 Dots에서 네이티브 `get_profile`, `list_my_fighters` 성공.
- 네이티브 `check_creation_readiness`는 `canSubmit: true`, `registration.status: ready`,
  `requiresPc: false` 반환. 생성·화면 표시·패키지 검토는 별도로 unverified를 유지한다.
- 기존 미미는 최초 연결 때의 8개 도구 목록을 유지했다. 도구 새로 고침과 승인된
  공식 재부팅 후 미미 대화에서도 준비 점검 도구의 실제 호출 및 ready 응답을 확인했다.
- 클라우드 VM에서 정확히 `{}`인 2바이트 시험 파일을 호스트 파일 입력으로 전달했다.
  `prepare_fighter_registration`이 서버 검증에 도달해 `invalid-manifest` 및 필수 필드 누락으로
  거절했다. 임의 URL·토큰 복사·VM의 직접 API 통신 없이 파일 전달이 확인됐다.
- 최초 연결 시험에서는 실제 캐릭터를 신규 생성하거나 공개 등록하지 않았다.
  이후 사용자 승인으로 실시한 실제 패키지 전체 시험은 아래 기록을 따른다.
- 연결한 앱은 개인 개발 플러그인이다. 일반 사용자용 공개 디렉터리 심사·배포는 별도다.

## 실제 파일 등록 검증 — 2026-10-24

- 심사 전용 일반 계정으로 Dots의 네이티브 `get_profile`·준비 점검을 실행했다.
- 기존 승인된 레드글러브 냥의 11개 WebP(5,537,184바이트)를 사용했다. 원본과 Library 전달
  파일의 크기·SHA-256을 비교했고, 전체 디코드 검사를 통과했다. 새 그림은 생성하지 않았다.
- VM의 Supabase 직접 다운로드는 정책으로 차단됐다. 비공개 Pages/Library의 원본 바이트
  읽기로 파일을 회수했다. VM 네트워크 정책과 인증·등록 검증은 변경하지 않았다.
- 테스트용 이름·설명·localId만 별도 manifest에서 변경하고, 이미지는 그대로 유지했다.
  실제 네이티브 파일 인자로 prepare → 11개 upload → submit을 실행했다.
- 제출 ID: `131d7814-2c24-4a82-9707-1ebff7978f67`.
- 등록 ID: `1c6160e0-a138-4e25-8b95-db023b8cc408` (`ODDBOUT Review Test`).
- manifest SHA-256: `0cd5eb8c721da8bdbe8f4f0d24700abd3ee82626451600012d32ca7d0968b83a`.
- 최종 상태: `registered`, `approved`, `runtimeApproved: true`, `arena-player-v1`.
  공개 `https://mcp.oddbout.com/mcp`에서도 동일 ID/해시를 일반 심사 계정 OAuth로 조회했다.
  교차 확인 7건이 통과했고 그 확인용 임시 OAuth grant는 철회했다.
- 파일 회수·계정 확인 안내를 MCP 함수 v7에 배포하고 공개 주소의 실제 응답을 확인했다.
  관련 MCP/게이트웨이 테스트 10건이 통과했다. CI는 실행하지 않았다.
- 기존 로그인 세션에 승인 이력이 있으면 다른 계정 연결 요청도 즉시 이전 계정으로
  돌아가던 문제를 수정했다. EN/KR 계정 선택 화면에서 이메일과 계속/다른 계정 사용을
  먼저 표시한다. 계정 전환은 해당 브라우저 세션만 로그아웃하고 연결 요청을 보존한다.
  계정 선택·전환·실패 처리·이메일 로그인 테스트 4건이 통과했다.
- 전체 게임 배포가 심사 증빙 파일을 제거하지 않도록 공개 가능한 기록·동영상·이미지·폰트를
  `website/cloud-plugin/review-20261024/`에 보관하고 표준 사이트 빌드에 포함했다.
  빈 디렉터리에서 배포를 재구성하는 회귀 테스트 1건이 통과했다.
- 테스트 뒤 운영자 Google 연결을 복구하고 임시 심사 계정 연결을 해제했다.
  연결 교체 직후 Dots 호출은 `Unknown tool`을 반환했다. 도구 새로 고침만으로는
  복구되지 않았고, 대기 중인 클라우드 작업을 확인한 뒤 사용자가 승인한 공식 미미
  재부팅으로 해결됐다. 이후 네이티브 프로필·기존 캐릭터 3개·등록 준비 ready를 확인했다.
  이 오류는 등록 서버의 인증 거절과 구분한다. 이미 연결한 계정을 반복 삭제하거나
  새 캐릭터 제출로 점검하지 말고 호스트의 도구 갱신·공식 재시작 경로를 사용한다.

이는 기존 승인 패키지의 전달·등록 검증이다. 새로운 생성 모델의 능력이나 신규 작품의
시각 품질을 검증한 결과로 해석하지 않는다. 공개 플러그인 심사 상태와 별개다.

### 본인 확인·삭제 확인 실사용 검증 — 2026-10-24

- MCP 함수 v8, 등록 API v30 및 삭제 migration을 배포했다. 운영 번들 14개/16개 파일을
  회수해 검증한 배포 입력과 일치함을 확인했다. 기존 API 게임 엔진은 그대로 보존했다.
- 관련 로컬 테스트 32개와 심사 전용 계정의 공개 MCP 점검 11개가 통과했다.
  다른 소유자·잘못된 확인 토큰·이름은 실제 서버에서 거부됐고 심사 캐릭터는 유지했다.
  일반 사용자/익명 역할의 삭제 RPC 실행 권한은 없으며 추가 보안 경고가 발생하지 않았다.
- 도구 갱신 후 앱 상세에는 11개가 보였지만 미미 실행 환경에는 9개가 남았다.
  클라우드 작업 대기 상태를 확인하고 승인된 공식 재부팅 후 네이티브 11개를 확인했다.
- 사용자가 요청한 `레드글러브 냥` / `Redglove Nyang`,
  `08e1b3f9-e31e-4c19-b42a-8ec8243d2ade`의 소유 계정과 준비 응답을 확인하고
  **네이티브 MCP `delete_fighter`**로 삭제했다. 관리자 SQL로 대신 삭제하지 않았다.
  삭제 시각 `2026-10-24T11:21:15.715123+00:00`, 후속 조회 `stage: deleted`.
- 내 목록에는 꿈돌이·꿈순이만 남았다. 두 캐릭터의 전체 DB 행은 삭제 전후 동일했다.
  삭제 대상의 공개 로스터 상세는 HTTP 404이고 공개 랭킹에서도 제외됐다.
  비공개 원본·경기 기록 보존과 슬롯 반환을 삭제 영수증에서 확인했다.
- EN/KR 연결·개인정보·약관·지원 안내를 갱신하고 공개 배포 파일 9개의 바이트 일치를 확인했다.
  기능 구현 커밋 `0cf776dd15f49102c76e6c9ad2dedf12236b6561`,
  사이트 커밋 `c2045a9`, buildId `77c17e7f-6a43-4d9c-8904-e485186f2b68`.
  이 기능 배포 단계에서는 공개 플러그인 심사를 변경하지 않았고 CI를 실행하지 않았다.
  이후 사용자 요청으로 삭제 도구를 포함한 1.0.3을 같은 공개 플러그인에 업로드했다.
  최신 제출 상태와 검증 자료는 [공개 심사 기록](CLOUD-PLUGIN-REVIEW.md)을 따른다.

### 보관 안내·안전 표시·파일 전달 재현 — 2026-10-25

- MCP v9는 삭제 준비의 `openWorldHint`를 false로 분리했다. 준비는 확인 기록을
  저장하므로 readOnlyHint는 false이며, 최종 등록·삭제의 파괴적 작업 표시는 유지한다.
  배포 후 공개 MCP의 11개 도구 표시와 기존 인증·소유권 동작을 확인했다.
- 운영 DB의 실제 정리 작업과 삭제 함수를 읽고 EN/KR 보관 안내를 갱신했다.
  원본·소유권·등록·경기·삭제 기록은 자동 파기 일정 없이 보관한다. 24시간 업로드
  만료, 10분 확인값·링크 만료는 파기가 아니다. 분석 연결·전송 기록은 29일 초과 시
  매시간 정리하며 외부 제공자의 사본 보관과는 구분한다.
- 일반 심사 계정으로 새 test-only 메타데이터와 기존 승인된 11개 WebP 파일을
  로컬 Codex의 네이티브 파일 입력으로 실제 클라우드 MCP에 전달했다. 새 생성은 없다.
  제출 `31995d93-a3e9-4b6c-aecf-54344f013b6e`와 캐릭터
  `9a363794-a8d6-47ff-bb3b-c3d7ea1029ac`의 registered/active/runtimeApproved,
  검증된 파일 11개, 불변 해시와 심사 계정의 소유 목록을 확인했다.
- `/cloud-plugin/review-20261025/`에 샘플 ZIP·EN/KR 재현 절차·실제 응답과
  62초 검증 화면 영상을 제공한다. 영상은 호출 시점의 실제 화면 캡처를 축약한 것이며
  Dots 대화 UI나 새로운 VM 실행 녹화로 설명하지 않는다. 비밀번호·토큰은 포함하지 않는다.
- 테스트 후 운영자 연결을 복구하고 get_profile로 확인했다. 임시 심사 연결만 해제했고
  기존 심사 테스트 캐릭터와 다른 사용자 데이터는 유지했다. 테스트 11개 통과, CI 미실행.
  기존 1.0.3 심사는 취소·교체하지 않는다. 상세 근거는 공개 심사 기록을 참고한다.
