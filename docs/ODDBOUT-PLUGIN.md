# ODDBOUT 통합 플러그인 (0.6.3)

이 저장소의 0.6.3 키트 소스는 제작·검토용 로컬 CLI와 호스팅 MCP 클라이언트 설정을 제공한다. ChatGPT/Dots에서는 가져온 플러그인의
`mcp.json` 실행과 클라우드 앱 연결이 별개다. 클라우드 앱을 먼저 연결한 뒤 Plugin Creator로 제작 스킬을 같은 앱에 추가한다.
기존 앱 ID, OAuth 설정과 앱 정보를 유지하며, 별도 플러그인을 만들어 앱 연결이라고 여기지 않는다.

ZIP 생성·공개 배포, 앱/커넥터 연결 배포, 개인 계정으로의 가져오기·갱신, 앱 설치·대화 선택, native 도구 노출,
OAuth 계정 검증은 서로 다른 단계다. 한 단계의 성공으로 나머지를 완료했다고 말하지 않는다.

## 구성

- `plugins/ai-fighter/plugin.json`: 호환을 위해 소스 폴더는 유지하지만 플러그인 이름은 `oddbout`이다.
- `mcp.json`: 키트 소스에서 호스팅 MCP(`https://mcp.oddbout.com/mcp`, Google OAuth)를 가져온 플러그인 안에서 실행한다.
  ChatGPT 공식 안내에 따르면 원격 HTTPS MCP가 있는 플러그인도 데스크톱 전용일 수 있고 `.app.json` 참조만으로 이 제한이 사라지지 않는다
  ([플러그인 관리 안내](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins)). Dots에서는 클라우드 앱을 연결한 뒤 제작 스킬을 같은 앱에 추가한다.
  공개 디렉터리 상태는 별도로 확인한다.
- `skills/create-fighter`: PC/Dots 실행 환경, 사용자 피드백, 패키지 검증, 공통 클라우드 등록을 안내한다.
- 새 launcher의 `--status`: 소스·기존 runtime 해시를 검증하고 경로만 보고한다. 파일을 만들지 않는다.
- `launcher.mjs --install --manifest-sha256 <검토된-runtime-manifest-SHA256>`: 명시적으로 사용자 runtime에 복사한다.
  기존 릴리스의 명령 의미와 구분하며 [Dots 준비 안내](DOTS-QUICKSTART.md)를 따른다.
- `scripts/creation-tool.mjs`: 기존 MCP 도구를 같은 스키마 검증과 잠금으로 한 번씩 호출한다.
  등록용 로컬 세션을 읽지 않고 클라우드 계정 확인을 안내한다. 준비와 실행은 기존처럼 분리된다.
- 로컬 stdio MCP는 예전 클라이언트 호환용으로 남는다. 통합 플러그인은 이를 자동 실행하지 않는다.

플러그인에 `requires_local_executor`나 로컬 stdio MCP를 넣지 않는다. 등록·조회는 클라우드 연결만으로
가능하지만, 전체 동작 제작·패키징에는 실제 실행·파일 저장·대화 전달 기능이 있는 PC 또는 Dots 작업 공간이
필요하다. 플러그인 설치만으로 그런 작업 공간이나 생성 구독이 생기는 것은 아니다.

## 빌드와 전환

```sh
npm run plugin:build -- output/oddbout-development-0.6.3
npm run plugin:bundle -- output/oddbout-0.6.3
```

첫 명령은 이 사용자의 체크아웃/작업 공간을 가리키는 개발용 빌드다. 다른 기기 배포에는 두 번째 명령의
`oddbout-0.6.3.zip`을 사용한다. ZIP은 한국어·영어 README, 제작 시작 안내·문서 지도·MCP 전환 안내,
원본 소스와 고정된 sprite-gen-agent(`vendor/sprite-gen`), 그 LICENSE/NOTICE를 포함하며
OS별 node_modules·venv·로그인·사용자 결과물은 제외한다. 의존성은 추출한 런타임에서 잠금 파일로 설치한다.

**Dots 연결 및 스킬 추가**: [클라우드 연결 안내](CLOUD-MCP.md)의 사용자 지정 MCP OAuth 절차를 마치고 앱 설정에서 연결을 확인한다.
Plugin Creator로 `create-fighter` 스킬을 같은 앱에 추가한다. 기존 앱 ID, OAuth 설정과 앱 정보를 유지한다. 같은 앱에 스킬을 추가하는 기능이
없으면 새 플러그인이나 앱 ID를 만들지 말고 한계를 보고한다.

대상 Dots 대화에서 플러그인을 선택하고 계정 도구가 표시되는지 확인한다. `get_profile`이 의도한 등록 계정을 반환해야 연결이 검증된 것이다.
서버 배포, ZIP 공개, 플러그인 갱신, 대화에서 선택, 도구 표시, 계정 확인은 각각 별도 단계다. 기존 연결은 대체 연결의 `get_profile`이
같은 계정을 확인할 때까지 유지한다. 빈 목록, 404, `not-found`만으로는 삭제·교체·서버 장애를 단정하지 않는다. 사이트 로그인은 별도이며,
로컬 CLI 로그인은 클라우드 계정 연결을 대신하지 않는다.

기존 플러그인이나 사용자 지정 MCP 연결을 제거하려면 사용자가 그 항목을 제거해 달라고 명시적으로 요청해야 한다. 그 전에 같은 Dots 대화에서 대체 연결의 `get_profile`이 성공하고 의도한 기존 계정과 일치하는지 확인한다. 기본 동작은 제거하지 않는 것이다. 빈 목록, 404 또는 `not-found`는 플러그인 삭제·교체나 서버 장애를 증명하지 않는다.

로컬 개발 설치는 기존 `ai-fighter-local` 마켓플레이스의 소스를 새 디렉터리로 전환하고
`oddbout@ai-fighter-local`을 설치하는 별도 절차다. 이 명령의 성공은 ChatGPT 개인 플러그인 가져오기나
Dots 대화에서의 MCP 연결을 뜻하지 않는다. 새 대화에서 현재 스킬을 확인한다. 캐시 밖의 작업 폴더·원본·선택·작업
기록은 보존한다. 별도 클라우드 개인/워크스페이스 플러그인 가져오기·갱신은 해당 지원 UI에서 확인한다.

**Codex MCP 전환**: 플러그인이 이미 운영 ODDBOUT MCP를 제공하면 별도 ODDBOUT MCP 항목을 추가하지 않는다.
기존 인증 URL과 연결 계정을 유지한다. 이전 `ai-fighter`와 `ai-fighter-creator` 항목 제거는 사용자의 명시적인
삭제 요청이 있어야 한다. 제거 전 실제 대상 대화(Codex 또는 Dots)에서 대체 MCP의 도구 목록과 native `get_profile`을 확인하고,
`get_profile`이 의도한 기존 등록 계정으로 응답해야 한다. 로컬 `creation:tool list`와
`npm run validate -- examples/sparring-bot/fighter.json`은 로컬 도구·fixture 형식만 확인하며 계정이나 등록 권한을
증명하지 않는다. 로컬 CLI는 사용자가 선택한 생성 계정을 쓰며 등록 계정을 제공하지 않는다. 도구가 없거나 결과가
불명확하면 현재 OAuth 연결·세션·작업을 보존하고 제거하지 않는다. 작업 폴더·원본·선택·작업 기록도 옮기거나 삭제하지 않는다.

소스의 클라우드 도구에는 `prepare_fighter_registration`의 선택 인자 `fighterId`가 있어 기존 소유 선수의 패키지 갱신을
지정할 수 있고, 생략하면 새 선수를 준비한다. `open_creator_homepage`는 고정된 공개 사이트 URL을 돌려준다.
사이트 로그인은 별도이며 사용자가 MCP와 같은 계정인지 확인해야 한다. legacy stdio의 자동 일회용 로그인과 전체
세션 전달은 권한 경계를 넘어가므로 통합 경로에 포함하지 않는다. 이 소스 변경은 `ai-fighter-mcp` 배포 후에만
운영 서버에서 사용할 수 있다. 기능을 안내하기 전 실제 서버 `tools/list`에서 `open_creator_homepage`와 선택 인자
`fighterId`가 노출되는지 확인한다. 소스에 있다는 사실만으로 배포나 서버 지원을 주장하지 않는다.

## 제작 도구 호출

반환된 런타임을 cwd로 두고, 작업 공간은 기존 프로젝트를 담은 절대 경로로 지정한다.

```sh
npm run creation:tool -- list "<absolute-workspace>"
npm run creation:tool -- call "<absolute-workspace>" list_creation_sessions
npm run creation:tool -- call "<absolute-workspace>" get_fighter_spec "<arguments.json>"
```

인자는 JSON 파일로 전달한다. `list`로 현재 스키마를 읽고 `call`로 기존 도구 이름을 호출한다.
프로젝트와 작업 ID, 낙관적 revision 검사, 검수 근거, 중복 실행 방지와 파일 접근 제한은 그대로 적용된다.
CLI 오류는 0이 아닌 종료 코드로 전달한다. 계정 연결과 실제 이미지 표시·검수는 별도로 확인한다.

## 등록

현재 연결의 `get_profile`과 `check_creation_readiness`를 확인하고 실제 스키마에 따라
`prepare_fighter_registration` → 필요한 파일의 `upload_fighter_asset` → `submit_fighter_registration`
→ `get_fighter_submission`을 호출한다. PC와 Dots에서 같은 경로를 사용한다. 원본 패키지 파일과
해시를 보존하며, 동일 바이트 재시도는 같은 키와 제출 ID를 유지한다. 알 수 없는 응답은 조회 후 처리한다.
다른 계정의 로컬 세션으로 대체하거나 미리보기 이미지를 원본 파일로 제출하지 않는다.

## 검증 범위

아래는 2026-10-26에 기록된 0.4.0 개인용 ChatGPT 관찰의 역사적 기록이다. 0.6.2 ZIP이 개인 플러그인을
생성·가져오기·설치했다는 증거는 없으며, 현재 해당 플러그인 ID/URL은 확인되지 않는다. 이 기록을 현재 연결로
사용하거나 재사용하지 않는다.
0.5.0은 `tools/ai-fighter/projected-ground.mjs`가 빠져 `fighter:pack`·`fighter:gait`가 시작되지 않으므로 설치하지 않는다.

2026-10-26의 기록은 개인용 ChatGPT에서 0.4.0 ZIP 업로드 후 당시 보인 플러그인 메타데이터와 기존 Google 계정 연결,
`get_profile`, 연결 목적의 `check_creation_readiness`를 보고했다. 2026-11-01 점검에서 이전 private ID는 not-found였고
owned personal plugins 목록도 비어 있었다. 따라서 당시 기록은 그 날짜의 관찰만 뒷받침하며 현재 플러그인 존재나
연결 가능성을 뒷받침하지 않는다. 당시 등록 접근은 `ready`로 기록됐지만 생성이나 캐릭터 등록을 실행했다는 뜻은 아니다.

당시 기록에는 개인용 목록에서 통합 플러그인과 참조된 기존 ODDBOUT 앱이 각각 보였고, 앱 설정에도 해당 참조가
표시됐다고 적혀 있다. 기존 앱은 등록 연결을 유지하기 위해 제거하지 않았다고 기록됐다. 이는 당시 기능 묶음에 대한
기록이며 현재 플러그인 목록이나 연결 상태를 증명하지 않는다. 로컬 개발 설치와 그때의 ZIP 검증 기록도 개인 플러그인
생성·현재 계정 import 상태와는 별개다.

자동화 테스트는 작업 기록 재개, 스키마·경로 제한, 클라우드 모드의 로컬 로그인 분리, 패키지 파일 검증과
소스 번들 추출을 확인한다. 그 결과는 실제 생성·유료 호출·캐릭터 등록이나 호스트 설치 성공을 증명하지 않는다.
Dots의 실제 생성·표시·파일 전달과 최종 등록은 해당 호스트에서 실제 사용자가 제작할 때 확인해야 한다.
