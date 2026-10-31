# ODDBOUT 통합 플러그인 (0.6.1)

사용자는 ODDBOUT 하나에서 제작·묶음 검토·등록을 진행한다. PC와 Dots의 사용자별 작업 공간은
같은 제작 도구와 파일 규격을 사용하며, 등록은 현재 대화에 연결된 ODDBOUT Google 계정으로 한다.
AI Fighter Creator라는 두 번째 플러그인 설치나 작업 공간의 별도 등록 로그인을 요구하지 않는다.

## 구성

- `plugins/ai-fighter/plugin.json`: 호환을 위해 소스 폴더는 유지하지만 플러그인 이름은 `oddbout`이다.
- `mcp.json`: 운영 MCP(`https://mcp.oddbout.com/mcp`, Google 로그인)를 플러그인 안에 둔다(0.6.0). 예전에는 `.app.json`으로 따로 추가한
  ODDBOUT 연결(사용자 지정 MCP 커넥터)을 참조해서, 플러그인 목록에 ODDBOUT이 둘 보였다. 이제 하나다. 계정·토큰은 넣지 않는다.
  로컬 명령 서버는 넣지 않는다(`streamable-http`만). 공개 디렉터리 심사는 같은 MCP를 쓰는 `plugins/oddbout-cloud`로 따로 진행 중이다.
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
npm run plugin:build -- output/oddbout-development-0.6.1
npm run plugin:bundle -- output/oddbout-0.6.1
```

첫 명령은 이 사용자의 체크아웃/작업 공간을 가리키는 개발용 빌드다. 다른 기기 배포에는 두 번째 명령의
`oddbout-0.6.1.zip`을 사용한다. ZIP은 한국어·영어 README, 제작 시작 안내·문서 지도·MCP 전환 안내,
원본 소스와 고정된 sprite-gen-agent(`vendor/sprite-gen`), 그 LICENSE/NOTICE를 포함하며
OS별 node_modules·venv·로그인·사용자 결과물은 제외한다. 의존성은 추출한 런타임에서 잠금 파일로 설치한다.

**0.6.1로 옮기기(ChatGPT 개인 플러그인)**: 새 ZIP을 올려 설치하고 Google로 한 번 로그인한다. 그다음 예전 ODDBOUT 플러그인과
따로 추가했던 ODDBOUT 연결(사용자 지정 MCP 커넥터)을 지운다. 작업 폴더·원본·작업 기록은 그대로다.

기존 `ai-fighter-local` 마켓플레이스의 소스를 새 디렉터리로 전환하고 `oddbout@ai-fighter-local`을 설치한다.
새 설치와 계정 연결을 확인한 뒤 이전 `ai-fighter-creator@ai-fighter-local` 설치를 제거한다.
기존 ODDBOUT 클라우드 계정 연결은 유지한다. 플러그인 캐시 외부의 작업 폴더·원본·선택·작업 기록은 옮기거나
삭제하지 않는다. 새 대화에서 갱신된 스킬을 확인한다. 클라우드 개인/워크스페이스 플러그인 적용은 별도
지원 UI의 가져오기/갱신 단계이며, 로컬 설치만으로 Dots에 배포됐다고 주장하지 않는다.

**Codex MCP 전환**: 플러그인이 이미 운영 ODDBOUT MCP를 제공하면 별도 ODDBOUT MCP 항목을 추가하지 않는다.
기존 인증 URL과 연결 계정을 유지한다. 이전 `ai-fighter`와 `ai-fighter-creator` 항목은 다음을 모두 확인한 뒤에만
제거한다: 클라우드 `get_profile`이 기존 등록 계정으로 응답하고, 로컬 `creation:tool list`가 도구 목록을 반환하며,
`npm run validate -- examples/sparring-bot/fighter.json`이 fixture를 검증한다. 로컬 CLI는 사용자의 선택한 생성 계정을
사용하며 등록 계정을 제공하지 않는다. 마지막 명령은 형식 fixture만 검사해 실제 생성이나 등록 권한을 증명하지 않는다.
실패하거나 결과가 불명확하면 이전 항목을 유지하고 원인을 확인한다. 제거해도 플러그인 캐시 밖의 작업 폴더·원본·선택·작업 기록은 옮기거나 삭제하지 않는다.

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

아래는 0.4.0의 설치 기록이다. 0.6.1 ZIP의 ChatGPT 업로드·설치는 아직 확인하지 않았다.
0.5.0은 `tools/ai-fighter/projected-ground.mjs`가 빠져 `fighter:pack`·`fighter:gait`가 시작되지 않으므로 설치하지 않는다.

2026-10-26 개인용 ChatGPT에 0.4.0 ZIP을 업로드하고 설치했다.
[통합 ODDBOUT](https://chatgpt.com/plugins/Plugin_4f7c4614845481918f2b208db68cd2b2)에서
앱 1개·스킬 1개·버전 0.4.0·기존 Google 계정 연결을 확인했다. `get_profile`과
연결 목적의 `check_creation_readiness`는 정상 응답했고 등록 접근은 `ready`였다.
이 결과는 생성이나 캐릭터 등록을 실행했다는 뜻이 아니다.

개인용 목록에는 통합 플러그인과 그 플러그인이 참조하는 기존 ODDBOUT 앱이 각각 표시된다.
기존 앱 설정에도 통합 플러그인이 해당 앱을 사용한다고 표시된다. 등록 연결을 유지하기 위해
기존 앱은 제거하지 않았다. 따라서 기능 묶음은 통합됐지만 목록을 한 항목으로 줄인 상태는 아니다.
로컬 개발 설치도 유지된다. 업로드 ZIP과 검증 기록은 `output/oddbout-unified-0.4.0/`에 있다.

관련 테스트는 작업 기록 재개, 스키마·경로 제한, 클라우드 모드의 로컬 로그인 분리, 패키지 파일 검증과
소스 번들 추출을 확인한다. 생성·유료 호출·캐릭터 등록·CI는 수행하지 않는다.
Dots의 실제 생성·표시·파일 전달과 최종 등록은 해당 호스트에서 실제 사용자가 제작할 때 확인해야 한다.
