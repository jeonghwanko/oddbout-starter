# 호스팅 생성기 (`host/`)

## `npx oddbout-host`

내 PC(Windows·macOS·Linux)와 내 SuperGrok 구독으로 oddbout.com의 내 선수를 만든다. Node 22.12 이상만 있으면 된다.

```sh
npx -y oddbout-host@0.1.0
```

처음 한 번은 아래 순서로 간다. 단계마다 사이트의 내 PC 카드에 지금 어디인지 보인다(하트비트 `setup`).

1. **연결** — 브라우저에 `oddbout.com/creator.html#pc=ABCD-EFGH`가 열린다. 로그인한 계정으로 코드와 PC 이름을 확인하고 "연결"을 누른다.
   복사할 코드는 없다. 워커 열쇠는 설치 폴더의 `worker.env`에만 들어가고 화면에 나오지 않는다. 안 되면 `--join <ohj_…>`(사이트의 붙이기 코드).
2. **키트** — creator-kit ZIP(`vendor/sprite-gen` 포함: Git·서브모듈 없음)과 그 Node 패키지
3. **Python** — 이 PC에 3.11~3.13(venv·sqlite3)이 없을 때만 standalone Python 3.12
4. **sprite-gen** — 키트의 `sprite:setup`(venv, img2webp, RIFE)
5. **ffmpeg** — 정적 ffmpeg·ffprobe 9.0.2(Linux는 시스템에 있으면 그것)
6. **Grok 로그인** — Grok CLI 1.0.52, 기기 인증(주소를 열고 코드 입력)
7. **Codex 로그인(선택)** — 물어본다(`--codex`·`--no-codex`). ChatGPT 구독이 있으면 그림을 GPT로도 고를 수 있다. Codex CLI 0.165.0(약 500 MB)
8. **워커** — 이 창에서 돈다. 창을 닫거나 PC가 잠들면 멈추고, 다시 켜면 맡은 단계를 이어서 한다. Ctrl-C는 실행 중인 단계를 먼저 끝낸다.

다음부터는 같은 명령 한 줄로 다시 켠다. 설치된 것은 건너뛴다.

| 명령 | 하는 일 |
| --- | --- |
| `npx oddbout-host [--name <PC 이름>] [--codex\|--no-codex] [--slots 2\|3]` | 연결·설치(처음)·로그인 확인·워커 |
| `npx oddbout-host login grok\|codex [--replace]` | 구독 로그인(`--replace`: 다른 계정). codex는 CLI부터 설치한다 |
| `npx oddbout-host status` | 설치·연결·로그인·작업 |

- **설치 폴더**: Windows `%LOCALAPPDATA%\oddbout-host`, macOS `~/Library/Application Support/oddbout-host`, Linux `~/.local/share/oddbout-host`
  (`--root`·`ODDBOUT_HOST_ROOT`). 그 안에 `bin/`(이 패키지의 생성기 파일과 `og.mjs`), `kit/`, `python/`, `ffmpeg-9.0.2/`, `tools/`(Grok CLI),
  `codex/`(선택), `host.env`, `worker.env`, `runner.json`(설치된 핀), `setup.log`가 있다.
- **정확한 버전만**: 받는 것은 모두 [`pins.json`](pins.json)이 크기와 SHA-256으로 고정한다(CLI는 [`cli/`](cli)의 npm 락파일, `npm ci --ignore-scripts`).
  다르면 쓰지 않고 멈춘다. 새 버전은 **열린 작업이 없을 때만** 올린다. 열린 작업은 시작한 파일로 끝낸다.
- 한 설치 폴더에는 한 러너만 돈다(`runner.lock`). Linux에서 `npm run host`의 서비스 워커가 돌고 있으면 시작하지 않는다.
- 공개(npm publish)는 `prepublishOnly`가 `check-pins.mjs --publish`로 막는다: 키트의 엔진이 공식 호스트(`og.mjs` `KIT_REF`)와 같아야 하고,
  키트 `release.json`이 고정한 ZIP을 가리켜야 한다(`--download`면 모든 파일을 다시 받아 대조한다).
  고정한 키트는 0.6.18(sprite-gen `e44065a`, `KIT_REF`와 같은 엔진)이다. 엔진을 옮기면 키트를 새로 내고 `pins.json`의 `kit`도 옮긴다.

| 파일 | 하는 일 |
| --- | --- |
| `runner.mjs` | 패키지의 bin. 위 순서, 연결(`api/host-pairing.mjs`), 설치 중 하트비트, 앞에서 도는 워커 |
| `install.mjs` | 설치 폴더·`host.env`·생성기 파일 복사·열린 작업·`checkSystem`·로그인 — `scripts/host.mjs`(`npm run host`)와 함께 쓴다 |
| `pinned.mjs` | 고정 파일 받기(크기·SHA-256), ZIP 풀기(Node만, 폴더 밖 이름·심볼릭 링크 거부), `.tar.gz`는 OS의 tar |
| `pins.json`, `cli/` | 키트·Python·ffmpeg·CLI의 고정값. `runner.test.mjs`가 `og.mjs`의 버전·키트 사이트와 맞춘다 |
| `check-pins.mjs` | 고정값 검사(시험과 공개 전). 패키지에는 넣지 않는다 |

2026-11-07 이 PC(Windows 11 x64)에서 연결 없이 실제 핀으로 설치 단계를 돌렸다: 키트 0.6.18·Python 3.12.15·ffmpeg 9.0.2·Grok CLI·키트 npm·
sprite-gen venv·img2webp·RIFE 모두 됐다(합 약 2분 반). RIFE는 Windows ZIP의 CRLF `flownet.param`을 LF로 바꿔 검사하고(sprite-gen-agent#57)
확인 프레임을 통과했다. 0.6.17 키트에는 이 수정이 없어 Windows에서 RIFE가 깔리지 않았다.
아직 실기로 확인하지 않은 것: 깨끗한 Windows 11·Apple silicon Mac에서 연결 → Grok 로그인 → 선수 1명(계획 1.3·1.6의 실기 검증),
Vulkan이 없는 GPU의 RIFE, 경로 260자, Defender, macOS 서명. ffmpeg는 GPL 빌드를 배포처(gyan.dev, martin-riedl.de)에서 직접 받는다.

---

ODDBOUT 제작자 페이지·에이전트의 **호스팅 생성 신청**(글과 그림 → 선수)을 실제로 만드는 생성 PC의 도구다.
서버(`api/generations.mjs`)는 작업 표와 상태만 가진다. 그림·동작은 이 도구가 생성 PC의 GPT(codex)·Grok 구독으로 만든다.

같은 파일이 두 가지로 설치된다.

| 설치 | 누구 | 어떻게 |
| --- | --- | --- |
| 서비스 | ODDBOUT 자신의 PC(공식 호스트) | 서비스 전용 유닉스 사용자(`/srv/oddbout-gen`), 운영자는 sudo 규칙 하나로 `og`만 부른다(`install-service-user.sh`). 신청 글의 안전 판정(브리프)은 공식 호스트만 한다 |
| 사용자 | 커뮤니티 호스트(승인된 제작자의 Linux PC) | 호스트 자신의 계정으로 돈다. sudo가 없다. `npm run host:setup`이 설치 폴더(기본 `~/.local/share/oddbout-host`)를 만들고 `host.env`를 쓴다. 안내: [GENERATION-HOST.md](../docs/GENERATION-HOST.md) |

`og`는 자기 위쪽 폴더에 `host.env`가 있으면 사용자 설치로 돈다. 두 설치 모두 codex·grok은 **설치 폴더를 HOME으로** 돈다. 그래서 그 PC 사람의
`~/.codex`(MCP 서버·플러그인·셸 도구)와 개인 로그인이 생성에 쓰이지 않는다.

### Windows·macOS: `og.mjs` (2026-11-05)

`og.mjs`는 bash `og`의 사용자 설치를 Node로 옮긴 것이다. bash·flock·`timeout`·systemd 없이 Windows·macOS·Linux에서 돈다. 공식 호스트는 bash `og`를 그대로 쓴다.
`<root>/bin/og.mjs` 옆 폴더에 `host.env`가 있어야 돈다(`node <root>/bin/og.mjs <명령>`). 명령과 출력은 bash og와 같다. 공식 호스트의 수동 흐름(`new·deliver·close·self-update`)은 거절한다.

| bash `og` | `og.mjs` |
| --- | --- |
| codex 칸 = `flock` 슬롯 파일 | 한 프로세스 안의 세마포어(모두 아니면 없음, 순서대로). `og.mjs worker run`이 워커를 **같은 프로세스**에서 돌리고(`generation-worker.mjs` `main({ og, python })`), 모든 단계의 실행이 이 세마포어를 함께 쓴다. 다른 터미널에서 손으로 부른 `og.mjs run`은 워커의 칸과 따로 센다 |
| `timeout --kill-after=30` | 타이머 + 트리 종료: 프로세스 그룹에 SIGTERM, 30초 뒤 SIGKILL. Windows는 그룹도 SIGTERM도 없어 `taskkill /T /F`로 바로 끝낸다(`mcp/generation-connection.mjs` 방식) — 멈춘 sprite-gen은 리포트를 쓰지 못한다. 시간 초과는 124(강제 종료면 137), 워커가 멈추면 143 |
| systemd 슬라이스(메모리 상한) | Linux만(같은 `oddbout-host.slice`). 다른 OS는 상한이 없어 `host.env`에 `SLOTS`가 없으면 codex 칸 2개, 메모리 12GB 미만이면 경고한다 |
| `npm run <스크립트> -- …`, `codex`·`grok` 셸 래퍼 | 킷 `package.json`의 `node …` 명령을 바로 돌린다(`sprite` → `node scripts/sprite-gen.mjs`). codex·grok은 npm 패키지의 스크립트를 node로 돌린다(`codexCommand` 방식, `--prefix` 설치의 `node_modules/.bin`도 찾는다). Windows는 셸 없이 `.cmd`를 시작하지 않는다 |
| `env -i HOME=<root>` | 같은 깨끗한 환경. Windows는 `USERPROFILE`·`APPDATA`·`LOCALAPPDATA`·`TEMP`도 설치 폴더 안으로 두고, 프로그램이 꼭 쓰는 `SystemRoot` 같은 값만 넘긴다. `CODEX_HOME=<root>/.codex`를 명시한다 |
| `og worker install`(systemd 사용자 서비스) | Linux만. Windows·macOS는 터미널에서 `og.mjs worker run`을 앞에 띄워 둔다(Ctrl-C는 실행 중인 명령을 먼저 끝내고 장부를 닫는다) |

워커는 `og`·`python`을 주입받는다: 주지 않으면 지금처럼 `<root>/bin/og`(bash)와 킷 venv의 Python(`spritePython`, Windows는 `.venv\Scripts\python.exe`)이다.
워커는 `og.mjs`를 import하지 않는다(공식 PC 설치에는 그 파일이 없다). 시험: `og-node.test.mjs`(이 PC의 OS에서 사용자 설치 사례 전체, bash og와 도구 목록·`explain` 일치).
아직 사람이 확인하지 않은 것: 실제 codex·grok·sprite-gen으로 Windows·Apple silicon Mac에서 선수 한 명을 끝까지(계획 1.3·1.6의 실기 검증).

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `og` | 모든 제공자 호출의 관문: 계정 고정(`login`), codex 칸, 메모리 상한(systemd 슬라이스), 장부, codex 기능 끄기(`harden`), 워커 서비스(`worker key·install·uninstall·start·stop·log`), 정리(`prune`), 고리 정렬의 RIFE(`rife torch|ncnn` — NVIDIA GPU면 PyTorch로 약 2배). 서비스 설치만: 운영자 수동 흐름(`new·deliver·close`)과 `self-update` |
| `og.mjs` | `og`의 사용자 설치를 Node로 옮긴 것(Windows·macOS·Linux, 위 표). `createOg`가 워커에 주는 `run`·`health`·`prune`과 명령줄 |
| `generation-worker.mjs` | 워커: 1분마다 심장 박동(서버가 받으면 그 차례의 claim에 실어 보낸다, 2026-11-07), 일이 없으면 15초에서 두 배씩 최대 1분 쉬었다 claim(작업 뒤에는 다시 15초), 1시간마다 `og health`, 하루 한 번 `og prune`, 한 번에 한 작업의 한 단계를 임대해 돌리고 결과를 올린다. 공식 호스트는 단계와 단계 사이에 주인이 올린 프로필 정면 하나를 codex(도구 끔)로 판정한다(정면 판정, 2026-11-03: 전신·정면·한 명, `og run <날짜>-front-<세트>`, 5분 한도). 대기열이 비면 1분마다, 판정을 마치면 바로 다음을, 실패하면 15분부터 두 배씩(최대 한 시간) 쉬었다 묻는다. codex가 못 돌거나(종료 75) og가 시작하지 않은(종료 3) 시도는 돌려주어 세지 않는다. 판정 중에도 심장 박동을 보내고, 같은 날 같은 세트의 판정이 폴더에 남아 있으면 codex에 다시 묻지 않고 그것을 보낸다. 건강 확인 때마다 열린 채 남은 판정 폴더를 닫는다. 커뮤니티 호스트에는 서버가 `frontChecks: false`로 답해 다시 묻지 않는다. `og health`는 단계가 쓰는 모델(`gpt-6.1-sol`, og의 `OG_CODEX_MODEL`)로 codex를 물어, 그 모델을 거절하는 로그인은 작업을 받지 않는다(2026-11-03) |
| `generation-stages.mjs` | 단계: 브리프·외형·동작·제출의 명령과 프롬프트, 결과 검사 |
| `style-anchor-front.webp` | 화풍 기준 그림(우리 정면 원화, 사이트 `art/oddbout/style-anchor-front.webp`와 같은 파일). 정면 후보·옆모습·판정에 마지막 참조로 붙인다 |
| `sprite-outcome.mjs` | sprite-gen 보고서로 실패한 실행의 과금 여부와 다음 할 일을 판정. 크리에이터 작업(`mcp/creation-jobs.mjs`)도 같은 파일을 쓴다. 호스트는 `host/`의 파일을 bin 한 폴더에 평평하게 설치하므로 워커가 부르는 파일은 모두 여기 있어야 한다 |
| `motions.py` | 동작 단계의 픽셀 일(키트 sprite-gen venv의 NumPy·Pillow) |
| `ledger-report.mjs` | 장부 한 줄 쓰기와 요약. 신청 글·프롬프트·경로는 남기지 않는다. 종료 3은 `notStarted`(sprite-gen이 provider 요청 전에 실패: 만든 것도 과금도 없음), 2·75는 `needsInput`, 129·130·143은 `interrupted` |
| `install-service-user.sh` | 서비스 설치의 처음 한 번(root) |
| `*.test.mjs` | `node --test host/*.test.mjs` |

단계 모듈은 서버가 비교 모드를 켠 경우에만 증거를 ODDBOUT 검수 API로 전달한다.
OpenAI 키는 서버 Secrets에만 둔다([서버 검수 운영](../docs/SERVER-DECISIONS-REVIEW.md)).

## 단계

| 단계 | 누가 | 하는 일 |
| --- | --- | --- |
| 브리프 | 공식 호스트만 | codex를 파일·셸·브라우저 기능을 끄고 돌려 안전 판정·프로필 초안·외형 설명을 받는다 |
| 외형 | 맡은 호스트 | 정면 후보 두 장(`front-a-<회차>`·`front-b-<회차>`)을 동시에 그린다(2026-10-31, 선수 프로필 세트: 우리 채색 문구 + 화풍 기준 그림). 고른 정면이 선수의 프로필 그림이다. 맡기기 작업의 첫 회차는 codex 판정(도구 끔 — 전신·정면·채색·일치·깨끗함)이 하나를 고른다 |
| 동작 | 맡은 호스트 | 먼저 고른 정면에서 옆모습 정지 그림 한 장을 그리고(`looks/side-<회차>-<선택>/`), codex 판정(전신·옆모습·같은 인물·채색·깨끗함)이 정면과 대조한다. 실패하면 다시 그려 모두 세 장까지, 그래도 실패면 운영자 검토(`side-look`). 통과한 옆모습이 아티팩트 `side-<회차>-<선택>`으로 올라가고 이후 동작의 기준이 된다. 동작과 함께 고른 정면으로 표정 시트(무투장 얼굴 여섯, 마지막이 KO 얼굴, 1536 × 1024)를 한 번 그려 아티팩트 `expressions-<회차>-<선택>`으로 올린다(2026-11-03, `looks/expressions-<회차>-<선택>/`). 시작했지만 끝나지 않은 시트는 다시 그리지 않고, 시트 없이도 등록은 그대로다. 예전 옆모습 후보(`look-…`)로 고른 작업은 옆모습을 다시 그리지 않는다. 이어서 GPT 키포즈 줄, Grok 걷기, Grok 달리기를 동시에. 엔진 검사와 codex 판정을 통과한 것만, 모든 프레임을 외형 크기로 맞춰(아래 "몸 크기") 패키지로 묶는다 |
| 제출 | 맡은 호스트 | 먼저 고른 정면과 그 얼굴 칸(`motions.py face-box`, 서버에 올린 WebP에서 잰다 — 2026-11-03 레온의 세트가 원본 PNG에서 잰 칸 때문에 `FACE_OUTSIDE_FIGURE`로 거절됐다), 그린 표정 시트를 작업에 남기고(`profile-front`), 신청자가 확인한 프로필로 그의 계정에 제출한다. 검증기가 등록하는 순간 서버가 그 정면으로 프로필 세트를 만든다. 얼굴 칸을 못 재거나 서버가 거절해도 등록은 그대로다 |

키포즈 줄은 gen-set 한 번(두 줄씩)이 그리고, 워커는 그동안 2초마다 끝난 줄(줄별 gen-set 리포트가 완료 표지)을 찾아 임시 실행(`motion/rows-early`)에서 추출하고 `motions.py early-drafts`로 그 줄들만으로 되는 클립의 미리보기를 먼저 올린다(2026-10-30, 사용자 결정). 이미지 호출·동시성·비용은 그대로이고, 줄 하나라도 실패하면 조용히 멈춘다(`early-drafts.log`). gen-set 뒤 `drafts`는 같은 줄에서 같은 바이트로 이미 올린 클립을 건너뛴다.

한 호스트가 처음 가져간 작업은 끝까지 그 호스트가 맡는다(중간 파일이 그 PC에 있다). 서버가 열쇠로 호스트를 알아 그 호스트 몫만 내준다.

### 몸 크기 (scale-check)

GPT는 자세마다 몸을 따로 그려 외형보다 2~20% 커지거나 작아지고, 걷기·달리기 영상은 통째로 다른 크기로 나온다. 게임은 내장 선수만 크기를
보정하므로, 동작 단계가 game-pack 전에 sprite-gen [`scale-check`](../vendor/sprite-gen/docs/scale-check.md)로 모든 클립의 프레임을 외형(idle)과
**머리 크기로** 비교하고 game-pack이 발 기준점으로 되돌린다. 걷기·달리기는 한 주기를 한 배율(상태 중앙값)로, 나머지는 프레임마다.
넘어짐(`fall`, `fall-getup`)은 머리가 돌아가므로 90°까지 따로 찾는다.

- 보고서는 클립을 경로가 아니라 **프레임 픽셀**로 찾고, 기준 프레임(idle)도 같은 요청의 에셋이어야 한다. game-pack은 보정에 기준의 표시 배율 ÷ 그 클립의
  표시 배율을 곱해 싣는다 — 걷기·달리기는 영상의 `body_h`로 이미 일부 맞춰져 있어 두 번 보정하지 않는다.
- game-pack이 실을 배율이 1보다 커서 클립 캔버스를 벗어나면 `motions.py scale-fit`이 그 클립 캔버스만 키우고(fall과 get-up은 함께) 다시 측정한다. 세 번 안에 끝나지 않으면 운영자 검토(`scale-fit`).
- 머리를 확신하지 못한 프레임(`check`, 탐색 범위 끝에 걸린 크기 포함)은 사람이 보드를 볼 수 없으므로 다음 순서의 중앙값을 쓴다(`motions.py scale_priors`·`scale_policy`):
  **그 칸을 그린 GPT 줄**(`ROWS`·`SHOW_ROWS`)의 측정된 프레임(`head`·`agree`, 2개 이상), 없으면 그 클립의 측정된 프레임, 없으면 측정된 모든 동작 프레임, 그래도 없으면 1.
  GPT는 줄마다 자세들을 외형과 다른 한 크기로 그린다. 2026-10-31 빨간 파도는 동작 줄이 외형의 1.15~1.27배로 나와 측정된 칸은 0.80~0.85로 줄었는데,
  얼굴을 읽지 못한 휘청(빙글눈)·KO(거꾸로·감은 눈)·승리(감은 눈)는 클립 전체가 측정되지 않아 1을 받고 싸움 자세의 1.1~1.23배로 나갔다.
  걷기·달리기는 GPT 줄이 아니라 영상이므로 줄·동작 프레임의 값을 쓰지 않는다(전처럼 상태 중앙값, 없으면 1). 추측한 프레임은
  작업 이벤트 `scale-check`(`guessed`)와 작업 폴더 `motion/assembled/scale/`(보고서·보드·`fit.json`)에 남는다.
- 보행 검수(보폭·loop-review)는 보정된 pack의 픽셀에 묶이므로 game-pack 다음에 돈다.

## 지켜야 할 것

- `og run` 밖에서 `sprite-gen`·`codex`·`grok`을 부르지 않는다. 그러면 고정한 계정·칸·장부를 거치지 않는다.
- 생성 단계가 실패하면 워커는 그 실행이 쓴 sprite-gen 리포트(`--report`, gen-set·video-set의 `set.report.json`)를 읽는다. 리포트가 같은 명령으로 다시 될 수 있다고 할 때만(`retryable`), 또는 og가 명령을 시작하기 전에 거절했을 때(종료 3, 리포트 없음)만 다시 시도한다. 그 밖에 리포트 없이 끝난 실행(강제 종료, 메모리 부족, 충돌)은 유료 요청이 이미 나갔을 수 있으므로 다시 보내지 않고 `*-outcome-unknown` 운영자 검토로 간다. `outcome-unknown`, xAI가 받은 영상 요청(`*-unfinished`, `requestIds` — `video-resume`으로 받는다), 종료 3(`*-not-started`), 고쳐야 할 오류는 운영자 검토로 간다. og 장부는 종료 코드만 읽는다: 리포트 경로를 아는 쪽은 워커다.
- codex가 지금 돌 수 없다고 하면(종료 75, 로그아웃·사용량 소진) 운영자 검토가 아니라 다시 시도(`provider-asks`)다. 워커는 codex 건강을 내려 두고 15분 뒤 다시 확인하며, 그동안 아무 작업도 맡지 않는다. 같은 단계가 계속 걸리면 서버의 임대 세 번(`stage-attempts`)에서 끝난다.
- og가 계정 때문에 실행을 거절하면(로그아웃, 고정한 계정 없음, 다른 계정, grok 토큰 갱신 실패) 종료 75다(2026-11-03). 장부에 줄을 남기지 않는다. 워커는 그 명령의 제공자를 내려 둔다: 브리프와 판정은 codex(`provider-asks`), 영상은 grok(`grok-rate-limited`). 영상의 75는 이 실행의 리포트가 codex 질문을 하면(스틸 다시 그리기) codex다. 전에는 종료 3이라 일반 다시 시도가 되어, 다음 작업이 같은 거절을 만나 약 6분 만에 임대 세 번을 쓰고 실패했다. 칸 대기 시간 초과(`OG_SLOT_WAIT`, 기본 30분)와 작업 폴더 없음은 그대로 종료 3이다.
- Grok 영상 요청이 sprite-gen의 자체 대기 뒤에도 429면(`grok-rate-limited`) 같은 단계를 바로 다시 가져가지 않는다. 요청은 받아들여지지 않았으므로 다시 시도로 돌려보내고, 워커는 grok 건강을 내려 두었다가 15분 뒤 다시 확인한다. 건강 확인은 두 구독에 한 단어만 보내 이미지·영상 사용량은 보지 못하므로, 실제 단계가 한도에 걸린 제공자는 확인이 통과해도 대기 동안(15분, 또 걸리면 30분·60분, 최대 한 시간) 내려 둔다. 그 제공자로 단계를 마치면 다시 15분부터 센다. 워커를 다시 켜면 이 기록은 사라진다. xAI의 429는 호출 빈도인지 SuperGrok 사용량인지 말해 주지 않는다. xAI가 받은 요청(request id)이 있으면 그대로 운영자에게 간다(`video-resume`).
- 같은 회차의 외형 두 장 중 하나만 실패해 단계를 다시 돌면, 이미 만든 쪽(`gen` 리포트 `ok`)은 다시 만들지 않는다. 두 장이 다 실패하면 두 리포트를 다 읽는다: 한쪽이라도 운영자 검토면 검토다(다른 쪽이 codex 질문이나 재시도여도, 결과를 모르는 쪽을 다시 보내지 않는다). `gen`이 끝났다고 했는데 그림이 없으면(외형 `look-no-output`, 재촬영 스틸 `gait-still-no-output`) 다시 보내지 않고 운영자 검토다.
- 동작 칸 그림의 줄 하나가 칸을 빠뜨리면(빈 칸, 2026-10-30 첫 선수 무료 시험의 `stance-a` 3번 칸) `sprite extract`가 거절한다. gen-set은 끝난 줄을 그대로 다시 쓰므로 재시도로는 같은 그림을 만난다. 그래서 워커는 거절된 줄(`extract-failure.json`의 `<줄>: …` 오류)만 `gen-set --states <줄> --force`로 다시 그리고 다시 잘라낸다. 최대 `EXTRACT_REDRAWS`(2)번이고, 요청의 줄을 하나도 짚지 못하거나 그래도 실패하면 전처럼 운영자 검토(`rows-extract`)다.
- 걷기·달리기 판정기의 `loop`(반복 이음새)만 거절이면, 엔진이 잰 이음새 비율(`cycle_align.seam_ratio`)이 엔진 관문(`ENGINE_SEAM_MAX` 2, sprite-gen `SEAM_RATIO_MAX`) 안일 때 그 컷을 받는다(2026-10-30: 23칸 주기로 반복하는 걷기 세 테이크가 정지 칸 시트만 본 판정기에 이음새로 모두 거절됐다). 받은 컷은 `tried`·걸음 검수 기록에 `loopBy: engine-seam`으로 남는다. `identity`·`anatomy`는 엔진이 볼 수 없으므로 계속 거절한다. 신청자는 미리보기에서 걸음을 보고 다시 요청할 수 있다.
- 등장·승리 행(선택)이 요청이 나갔을 수 있는 채로 실패하면(`failedRun`이 운영자 검토로 보내고, 리포트가 요청 전 실패라고 하지 않는 경우) `show-left-out.json`을 남기고 그 파이터는 등장·승리 없이 간다. 다음 단계 실행이 그 행을 다시 그리지 않는다. 요청 전에 거절된 실행(preflight 등)은 남기지 않아 다음 단계 실행이 다시 그린다.
- Decisions 비교 검수는 판정에 쓰지 않으므로 단계의 생성 작업 옆에서 함께 돈다. 단계는 끝내기 직전에만 그 결과를 기다린다(검수 경로가 단계의 임대를 쓰기 때문).
- 단계마다 시간 한도가 있다(브리프 20분, 외형 45분, 모션 150분, 제출 30분). 넘으면 실행 중인 명령을 멈추고(SIGTERM, sprite-gen은 리포트를 쓴다) `<단계>-stage-timeout`으로 운영자 검토에 넘긴다. 멈춘 실행이 이미 유료 요청을 보냈을 수 있어 다시 줄 세우지 않는다. 멈춘 단계의 다음 명령(다음 테이크, 판정, Decisions 검수)은 시작하지 않고, 대기(재정렬 2분, 달리기 시차)도 바로 끝나 단계가 곧장 끝난다 — 작업이 취소돼 임대를 잃었을 때도 같다. 서버에 가는 결과는 그대로 `<단계>-stage-timeout`이고(임대를 잃었으면 보고 없음), 멈춘 단계가 이름을 남긴 xAI 요청(`requestIds`)은 그 결과에 실려 운영자가 `video-resume`으로 받는다.
- 실행을 멈추는 신호는 og가 명령에 넘긴다(2026-11-02). `timeout`은 자기와 명령을 따로 프로세스 그룹에 두므로, 워커가 og의 그룹에 보낸
  SIGTERM은 명령에 닿지 않았다: og만 끝나고 유료 명령은 `RUN_TIMEOUT`(90분)까지 계속 돌았다. 이제 og는 신호를 `timeout`에 넘기고(그룹 전체, 30초 뒤
  SIGKILL) 명령이 끝난 뒤에 장부를 닫고 끝난다. 그래도 og가 90초 안에 끝나지 않으면 워커가 og의 그룹에 SIGKILL을 보낸다. og가 끝났는데 그룹을 벗어난
  프로세스가 출력을 붙잡고 있으면 워커는 10초 뒤 그 실행을 끝난 것으로 본다(전에는 그 프로세스가 끝날 때까지 단계와 워커 전체가 멈췄다).
- 그림·영상을 만드는 실행(sprite-gen의 `gen`·`gen-set`·`video-set` 등)은 시작 전에 작업 폴더의 `dispatches/`에 기록되고, og가 돌아오면 그 종료
  코드가 적힌다(2026-11-02). 실행 중에 워커가 죽으면(강제 종료, 메모리 부족, 정전) 단계를 다시 맡았을 때 결과물만 보고 그림이 아직 없는 외형·줄을 또
  보냈다: 두 번 결제다. 이제 종료가 적히지 않은 기록이 있으면 단계를 돌리지 않고 `<단계>-dispatch-unknown` 운영자 검토로 간다(`runs`에 그 도구들).
  서버가 그 검토를 받으면 기록에 넘김 표시를 하므로, 운영자가 다시 돌리면 단계가 돈다. 텍스트 실행(`codex exec`: 브리프·판정)과 픽셀 도구는 기록하지
  않는다: 다시 돌려도 그림을 만들지 않는다.
- 커뮤니티 호스트의 PC가 작업을 맡은 채 하루 넘게 보고하지 않으면(하트비트도 진행 보고도 없음) 다음 claim에서 서버가 그 작업을 끝낸다
  (2026-11-05, `af_generation_host_lost`). 전에는 그 호스트만 작업을 다시 맡을 수 있어 작업이 영영 진행 중으로 남았다. 맡은 단계를 끝내지 못한
  채 사라졌으면 유료 실행이 나갔는지는 그 PC의 `dispatches/`만 알므로 다시 돌리지 않고 `<단계>-host-lost` 운영자 검토로 간다. 아직 맡지 않은
  단계(신청자의 답 뒤)면 `host-lost`로 실패하고 신청자의 무료 선수는 돌아온다. 어느 쪽도 다른 PC로 넘기지 않는다: 그림·클립·패키지가 그 PC에만
  있다. 하룻밤 꺼 둔 PC는 돌아와 이어 하고, 공식 호스트(사무실 PC)의 작업은 언제까지나 그 PC를 기다린다.
- 단계가 던진 오류의 코드가 숫자여도(자식 프로세스의 코드) 문자열로 바꿔 `retry`로 끝낸다. 예전에는 여기서 다시 던져 끝냄 보고가 안 가고 임대 한 번을 잃었다. sprite-gen 리포트에 문자열이 아닌 코드가 있으면(sprite-gen은 쓰지 않는다) 그 오류는 결과를 알 수 없는 것(`outcome-unknown`)으로 읽고, `retryable`을 믿지 않아 다시 보내지 않는다.
- 첫 달리기 테이크가 박자 튐(`broken-beat`)으로만 떨어지면, 재촬영 전에 통과한 걷기로 달리기를 만든다(`RUN_FROM_WALK_FIRST`). 박자 튐은 영상이 아니라
  정렬기의 것이다: Grok 달리기 한 주기(13~14프레임)를 계약의 12프레임으로 맞출 때 RIFE 중간 프레임이 빠른 다리에서 유령이 되어 원본 프레임으로 바뀐다.
  다시 찍어도 같은 길이로 나와 같은 이유로 떨어진다(2026-10-28 냥잽: 달리기 7테이크 모두). 신청자가 달리기를 고쳐 달라고 한 회차는 지금처럼 모두 찍고,
  모두 떨어지면 걷기로 만든 달리기로 돌아가지 않고 `run-not-clean` 운영자 검토다(그의 말이 빠진, 고치기 전과 같은 클립이 되므로).
  걷기로 만든 달리기는 걷기의 정렬 전 컷을 복사해 달리기로 따로 판정한다(제 길이 정렬 `-own`·`-own1` 폴더의 걷기 판정을 물려받지 않는다).
  걷기가 두 보폭 컷의 한 보폭(`-own1`)으로 통과했으면 달리기도 `--cycles <폴더>=2`로 한 보폭을 꺼내 12칸에 맞춘다.
- 서버 `/spec`의 `features`에 `gait-frames-1`이 있으면 걷기·달리기를 **찍힌 한 주기의 칸 수 그대로** 낸다(`gaitFrames` 범위: 걷기 12~32, 달리기 10~16).
  정렬은 `--length` 없이 컷을 발 딛는 칸에서 시작하게만 돌리므로 프레임을 빼거나 만들지 않고, 박자 튐이 생기지 않는다. 범위보다 긴 컷의 절반이
  범위 안이면(두 보폭) `--cycles <컷>=2`로 그 안의 한 보폭을 꺼내 다시 정렬해 판정한다(`ONE_STRIDE_OF` — 냥잽의 26·22·27칸 컷이 13·11·14칸
  한 보폭이 되었고, 박자 0·두 발 이름 모두 나왔다). 그 밖의 범위 밖 컷(반 보폭 등)은 `frames-<n>`으로 버린다. 기능이 없는 서버에는 지금처럼 표준(16·12)으로 맞춘다. 걸음으로 만든 달리기는 표준 12칸 그대로다.
  마지막 고리 검수(`fighter:gait loop-review`)도 계약의 범위(`minFrames`~`maxFrames`)로 칸 수를 본다. 정확히 16·12만 받던 때는 제 길이로 낸 걸음이 비용을 다 쓴 뒤 여기서 멈췄다.
- 걷기·달리기 갈래가 끝나면 `gait` 이벤트로 시도한 컷마다 사유·칸 수·jolt를 남긴다. 운영자와 측정([MEASUREMENT.md](../docs/MEASUREMENT.md))은 생성 PC 로그 대신 이것을 읽는다.
- 달리기 정렬은 박자 튐 기준을 0.3으로 받는다(`BEAT_LIMIT`, 엔진 기본 0.25, 걷기는 그대로). 엔진은 박자가 여전히 튀는 고리를 원본 프레임만으로,
  다리가 가장 덜 움직이는 곳에 건너뛰기를 두어 다시 짠다. 냥잽 14프레임 달리기가 0.75에서 0.28이 되었고, 운영자가 보고 받아들였다(2026-10-29).
- 한 테이크의 컷이 하나도 정렬되지 않으면(엔진이 멈춤 — GPU 메모리 부족 등) 2분 뒤 정렬만 한 번 더 한다(제공자 호출 없음). 그래도 안 되면 `walk-align`·`run-align` 운영자 검토다.
- 찍은 영상에서 컷이 하나도 안 나오면: 엔진이 영상 때문에 거절했으면(`video-loop` 리포트 `status: failed` — 주기 없음, 이음매·튐 등) 다른 말로 다음 테이크를 찍는다(`tried`에 `not-cut`). 이 PC 때문에 거절했으면(RIFE·img2webp 없음, GIF·WebP 검증 실패 — `CUT_TOOL_REFUSAL`) 다음 테이크도 똑같이 거절되므로 바로 `walk-cut`·`run-cut` 운영자 검토다(`cut-tool`). 엔진이 멈췄으면(리포트 없음) 같은 영상을 2분 뒤 한 번 더 자르고, 그래도 없으면 같은 검토다. 새 영상을 사지 않는다. 자르기 전에 이전 실행의 거절 리포트는 지운다.
- codex 칸은 `OG_SLOT_WAIT`(기본 1800초)까지만 기다린다. 넘으면 `og run`이 시작 전에 거절하고(종료 3) 워커가 단계를 나중에 다시 돈다.
- 워커는 단계마다 `versions` 이벤트(킷·엔진 커밋, 요청한 모델)를 보내고, 끝낼 때 og로 돈 명령별 실행 수를 `calls`로, 관측한 모델을 `models` 이벤트로 남긴다. 측정은 [MEASUREMENT.md](../docs/MEASUREMENT.md)를, 장부의 데이터 형태는 `og report --json`을 본다.
- 판정기(외형 고르기, 옆모습, 걷기·달리기, 정면 판정)는 모델과 추론 강도를 명령에 적는다(`JUDGE`: `gpt-6.1-sol`, `-c model_reasoning_effort="medium"`, 2026-11-05).
  전에는 강도를 적지 않아 호스트마다 codex 로그인 설정이 정했고, 그때 어떤 강도로 돌았는지는 기록이 없다. `medium`은 고른 값이지 예전 값을 잰 것이 아니다.
  브리프는 지금처럼 강도를 적지 않는다.
- 브리프와 판정기는 킷 밖의 빈 폴더 `<root>/codex-cwd`에서 돈다(`codex exec -C`, 2026-11-05). og는 모든 명령을 킷에서 돌리고, codex는 작업 폴더가 든 git 체크아웃의 루트부터
  그 폴더까지의 `AGENTS.md`를 모델 지시에 넣는다. 그래서 킷의 `AGENTS.md`(제작 에이전트용 지시)가 프롬프트와 함께 들어갔고, 그 파일을 고칠 때마다 판정 입력이 바뀌었다
  (2026-11-05 공식 호스트: codex 세션 기록 322개 중 37개에 킷 `AGENTS.md` 첫 줄 — 그 줄이 생긴 10-30 이후만 세므로 최소치). 작업 폴더(`kit/output/…`)는
  킷 체크아웃 안이라 대신 쓸 수 없다. 워커는 시작할 때 그 폴더가 읽게 될 `AGENTS.md`가 있으면 로그에 남긴다. 판정의 키에는 킷 밖에서 돌았는지(`isolated`)도 들어간다.
- `og harden`은 서비스 codex 설정(`<root>/.codex/config.toml`) 맨 위에 `project_doc_max_bytes = 0`을 넣는다(2026-11-05). codex는 이 값이 0이면 프로젝트의
  `AGENTS.md`를 읽지 않는다(codex 0.165.0 소스 `core/src/agents_md.rs`). 그래서 og가 작업 `.tmp`(킷 안)에서 돌리는 이미지 생성의 codex(sprite-gen `gen`·`gen-set`과
  그 방향 확인)도 킷의 지시를 읽지 않는다. 최상위 키라 `[features]` 표보다 앞에 둔다(TOML에서 표 머리 뒤의 키는 그 표의 것이다).
  `og self-update` 뒤 `og harden`을 다시 돌리지 않아도 워커가 시작할 때(`og worker run`) 이 줄만 없으면 스스로 넣으므로 멈추지 않는다.
  운영자가 다른 값을 적어 두었으면 og는 덮어쓰지 않고 멈추며 손으로 0으로 바꾸라고 한다.
- 판정 결과 파일(옆모습 `take-<n>.verdict.json`, 걷기·달리기 `judge/verdict.json`, 외형 고르기 `judge-<회차>/verdict.json`)에는 `judge` 기록이 붙는다:
  키(`key` — 요청한 모델·강도·프롬프트·스키마의 해시, 프롬프트와 스키마는 해시로만), 요청한 모델·강도, codex가 그 실행의 세션에 남긴 모델·강도·CLI(`observed`).
  세션은 codex exec 머리글의 첫 `session id:`로 찾고(프롬프트 메아리에 든 것은 읽지 않는다) 그 rollout을 읽는다. 못 찾으면 `unknown`이다.
  codex의 답은 따로(`take-<n>.judge.json`, `judge/answer.json`) 받고 결과 파일을 새로 쓴다.
- **이미 있는 판정은 작업이 끝까지 그대로 쓴다**(`JUDGE_CACHE_RULE`). 앞선 단계 실행이 그 판정으로 테이크를 고르거나 버리고 다음 테이크를 샀다.
  작업 중간에 다시 판정하면 통과가 실패로 바뀌어 아무도 요청하지 않은 유료 테이크를 살 수 있다(AGENTS.md 하드 룰 2). 그래서 키가 없거나(`unkeyed`, 이 변경 전에 만든 판정)
  다른 키인(`stale`, 그 뒤 모델·강도·프롬프트·스키마가 바뀜) 판정도 다시 묻지 않고 쓰되, `side`·`gait` 이벤트(`judgeKey`)와 걸음 검수 설정(`judgeKey`, `judge` 문구)에 표시한다.
  키 없는 판정의 `judge` 문구는 "모델과 강도 기록 없음"이다. 새로 하는 판정은 언제나 지금 키를 쓴다. 운영자가 지금 판정기로 다시 보게 하려면 그 판정 파일을 지운다(명시적 요청). 다음 단계 실행이 그 컷만 다시 판정한다.
  정면 판정 폴더의 판정은 서버가 받는 모양 그대로 두고(키 없음) 강도만 적는다. 같은 판정의 끝냄을 다시 보낼 때만 쓰기 때문이다.
- 옆모습·걷기·달리기 판정기는 `worker.env`의 `ODDBOUT_GENERATION_JUDGES`로 고른다(2026-11-06, `JUDGE_MODES`). 정하지 않으면 그 시점에 codex가 되는 PC는 `codex`,
  안 되는 PC(SuperGrok만)는 `pixels`다(`judgesFor`, 1.1 제공자 프로필). 다른 값은 `codex`다. 정해 둔 판정기는 바꾸지 않는다: `codex`·`hybrid`인데 codex가 안 되면
  워커는 새 작업을 가져가지 않는다(`canWork`). 판정기가 codex를 안 쓰면 codex가 안 되는 동안에도 Grok 그림 작업을 한다.
- 그림 제공자(2026-11-06, `IMAGE_PROFILES`): 작업의 `imageProvider`가 `grok`이면 정면·옆모습·표정·이완 스틸·키포즈 줄을 Grok(`grok-imagine-image-2.0`)으로 그린다.
  Grok은 알파를 주지 않으므로 키 색 바탕(초록, 팔레트에 초록 계열 이름이 있고 자홍 계열이 없으면 자홍)을 프롬프트에 적고 sprite-gen의 우세도 매트
  (`--chroma-method dominance`)로 딴다. "No background"를 쓰면 Grok이 검은 바탕을 그렸고, 엔진의 YCbCr 매트는 Grok의 탁한 초록에서 흰색·검은색까지 지웠다(0단계).
  레이아웃 가이드가 정사각이라 정면·옆모습·이완 스틸은 `--aspect-ratio 1:1`, 표정 시트는 3:2다. `imageProvider`가 없는 작업(이 변경 전 서버)은 `gpt`다.
  Grok 그림 실행이 75(계정·토큰)나 429로 끝나면 codex 질문이 아니라 grok이 안 되는 것(`grok-rate-limited`)으로 다룬다.
  `og worker judges codex|pixels|hybrid`(사용자 설치는 `npm run host -- worker judges …`)가 그 줄을 쓰고, 워커는 다시 시작할 때 읽는다.
  `og worker key`는 키 두 줄만 바꾸고 이 줄과 `ODDBOUT_GENERATION_KEEP_DAYS`를 남긴다(전에는 파일을 통째로 다시 써서 지웠다).
  `pixels`는 픽셀 판정기(`motions.py pixel-judge`, NumPy, 한 번에 1초 미만, 제공자 호출 없음)만 판정하고, 픽셀이 정하지 못한 검사(`unknown`)는 통과로 치며 notes에 그렇게 적는다.
  `hybrid`는 픽셀 판정기가 먼저 보고, 픽셀 실패는 그대로 실패(codex를 부르지 않음), `unknown`이 있을 때만 codex에 물어 둘 중 하나라도 실패한 검사를 실패로 한다.
  픽셀 판정기의 답은 `take-<n>.pixels.json`·`judge/pixels.json`(측정값 포함), hybrid가 부른 codex 판정은 `take-<n>.codex-verdict.json`·`judge/codex-verdict.json`에 남는다.
  결과 파일의 `judge.kind`(`pixels`·`hybrid`, codex 판정은 없음)와 키가 누가 판정했는지 말하므로, 모드를 바꾼 뒤 남아 있는 판정은 위 규칙대로 다시 묻지 않고 `stale`로 표시해 쓴다.
  `side`·`gait` 이벤트와 `tried`에는 `judgeBy`(`pixels`·`pixels+codex`)가 붙는다. 픽셀 판정기가 답하지 못하면(`side-pixel-judge-<종료>`, `pixel-judge-<종료>`) 단계를 나중에 다시 돌고, codex가 대신 판정하지 않는다.
  픽셀이 보는 것: 캔버스 가장자리 잘림, 따로 떨어진 덩어리·바닥 선·테두리, 기준 그림 색 영역의 사라짐·새 색, 반투명(겹친 프레임), 프레임 높이·면적 튐, 엔진의 이음새 비율.
  보지 못하는 것: 옆모습과 3/4 시점의 구분(옆모습 `side`는 늘 `unknown`), 얼굴, 부위 크기 변화(장갑이 작아짐), 팔다리 모양. 판정 실패는 다시 그리기·다시 찍기(유료)로 이어진다.
- 워커는 `og harden` 없이는 시작하지 않는다. 신청자의 글이 codex 입력이 되기 때문이다.
- `og setup`(사용자 설치는 `npm run host:setup`)은 열린 작업이 있으면 아무것도 바꾸지 않는다. 키트·CLI 판은 `og` 맨 위에 고정한다.
- 끝난 작업 폴더(신청 글·참조 그림·생성 그림)는 워커가 하루 한 번 지운다: 닫힌 지 7일(`ODDBOUT_GENERATION_KEEP_DAYS`, 1~90),
  닫히지 않은 채 14일 동안 바뀐 파일이 없는 작업(서버가 취소·만료한 작업)도 지운다.
