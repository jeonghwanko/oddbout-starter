# 생성 호스트 되기

ODDBOUT 제작자는 글과 그림으로 선수를 **신청**할 수 있다(호스팅 생성). 신청을 실제로 그리는 것은 생성 PC다.
**생성 호스트**는 내 Linux PC와 내 구독으로 선수를 만든다. 먼저 **내 신청을 내 PC로** 만들고(승인 없이), 운영자가 승인하면
다른 제작자의 신청도 만든다. 신청자는 목록에서 나를 고르거나 "아무 호스트"를 고른다.

- 신청 글의 안전 판정과 프로필 초안(브리프)은 늘 ODDBOUT이 한다. 호스트는 그 뒤의 외형·동작·제출을 맡는다.
- 한 호스트가 처음 가져간 신청은 끝까지 그 호스트가 맡는다. 그 PC가 하루 넘게 소식이 없으면 신청은 끝난다(아래).
- 내 신청(신청할 때 호스트를 "내 PC", 에이전트는 `host: mine`)은 승인이 필요 없다. 생성은 내 PC에서 내 구독으로 수행한다.
  신청 관리·미리보기·등록은 ODDBOUT 서버를 이용하며, 선택형 서버 검수의 자료 전송은 아래 설명을 따른다.
- 다른 사람의 신청은 운영자가 승인한 호스트만 받는다(지금은 초대 단계). 보상(계정 금화, 선수의 "만든 호스트" 표시, 호스트 순위)은 다음 단계다.

생성기 자체의 설명은 [host/README.md](../host/README.md)에 있다.

선택형 [서버 Decisions 비교 검수](SERVER-DECISIONS-REVIEW.md)가 활성화된 작업은 검수용 그림과 프레임을 ODDBOUT 서버를 거쳐
OpenAI로 전송한다. 이 경로에서는 검수 자료가 생성 PC 밖으로 나가며, 비용과 OpenAI 키는 서비스 서버에서 관리한다.
호스트에 OpenAI 키를 설정하지 않는다. 기본값은 비활성이고, 기존 생성 구독과 검수 통과 조건은 그대로다.

## 필요한 것

| 항목 | 기준 |
| --- | --- |
| PC | 늘 켜 둘 Linux PC(systemd). 메모리 12 GB 이상을 권한다. 8 GB면 `--slots 2 --memory 6G`로 설치한다. 디스크 여유 5 GB 이상 |
| 프로그램 | Node 22, Git, Python 3.11 이상(venv·sqlite3), ffmpeg·ffprobe, img2webp(libwebp 도구), zip·unzip. `npm run host:setup`이 빠진 것을 알려 준다 |
| 구독 | codex CLI로 로그인하는 ChatGPT 구독(그림·판정), grok CLI로 로그인하는 SuperGrok 구독(걷기·달리기 영상). 이 꾸러미는 지금 구독 로그인만 쓴다 |
| 계정 | ODDBOUT 계정(Google 로그인) |

Windows·macOS는 `npx oddbout-host` 한 줄로 설치한다(2026-11-07 구현, npm 공개 전 — [host/README.md](../host/README.md#npx-oddbout-host)).
SuperGrok만 있으면 된다. 그 명령은 Node 22.12만 요구하고 Python·ffmpeg·키트·CLI는 고정한 버전을 직접 받는다.

## 호스트 약속

호스트 신청(`apply --accept-terms`)은 아래에 동의한다는 뜻이다.

1. 내 구독(또는 API 키)으로 다른 사람의 선수를 만든다. 그 제공자의 약관이 이 사용을 허락하는지는 내가 확인한다. 책임은 나에게 있다.
2. 신청 글과 그림은 그 선수를 만드는 데만 쓴다. 보관·공유·재사용하지 않는다. 생성기는 끝난 작업을 7일 뒤에 지운다.
3. 생성 결과를 신청자의 등록 밖에서 쓰거나 올리지 않는다.
4. 생성기의 안전 설정(codex 기능 끄기, 계정 고정, 메모리 상한, 정리)을 끄거나 돌아가지 않는다.
5. ODDBOUT은 언제든 승인을 거두고 워커 열쇠를 끌 수 있다.

## 시작하기

oddbout.com 제작자 페이지의 My agents(`creator.html#view=agents`) → **내 PC**에서 호스트 이름을 적고 호스트 약속에 동의한 뒤 "PC 연결 명령 받기"를
누른다. 나온 명령을 PC의 터미널에 붙여 넣는다.

```bash
git clone https://github.com/jeonghwanko/oddbout-starter.git
cd oddbout-starter && git checkout main && npm ci
npm run host -- join ohj_…                   # 붙이기 코드(30분 안에 한 번): 설치 → codex·grok 로그인(없으면) → 워커
```

- `join`은 코드를 먼저 쓰고(설치가 30분보다 오래 걸려도 된다) 설치·구독 로그인을 이어서 한다. 설치 옵션도 붙일 수 있다:
  `npm run host -- join ohj_… --slots 2 --memory 6G --rife torch`.
- PC에는 ODDBOUT 로그인이 남지 않는다. 그 호스트의 워커 열쇠만 남는다.
- 사이트에서 선수를 신청할 때 호스트로 **내 PC**를 고른다. 승인 전에도 된다. 다른 사람의 신청도 받고 싶으면 운영자 승인을 기다린다.
  승인되면 워커를 다시 켤 필요 없이 그 신청도 가져간다.
- 설치만 따로: `npm run host:setup`(NVIDIA GPU가 있으면 `-- --rife torch`), 로그인만 따로: `npm run host:login`.
  사이트 대신 터미널만으로도 된다: `npm run host -- signin`(브라우저가 없는 PC는 `--device`) → `npm run host -- apply --name "고양이 공방" --accept-terms`
  → `npm run host:start`. `npm run host -- status`가 상태를 보인다.
- `--rife torch`는 걷기·달리기 고리 정렬(RIFE)을 PyTorch·CUDA로 돌린다. 같은 고리를 144초 → 76초에 같은 프레임으로 맞췄다(RTX 4060, 2026-10-28).
  PyTorch 약 3 GB를 키트의 sprite-gen venv에 받는다. 되돌리기는 `--rife ncnn`.

- `host:setup`은 설치 폴더(기본 `~/.local/share/oddbout-host`, 바꾸려면 모든 명령에 `--root <폴더>`나 `ODDBOUT_HOST_ROOT`)를 만든다.
  그 안에 생성기 파일, 고정된 키트(sprite-gen 엔진 포함), codex·grok CLI를 둔다. sudo는 쓰지 않는다.
- `host:login`은 **설치 폴더 안에** 따로 로그인한다. 내 평소 `~/.codex`·`~/.grok` 로그인과 설정(MCP 서버, 플러그인)은 쓰지 않는다.
  호스트로 쓸 구독 계정으로 로그인한다. 로그인한 계정은 고정된다. 바꿀 때만 `npm run host:login -- --replace`를 쓴다.
- `join`·`host:start`의 워커 열쇠는 화면에 나오지 않는다. 바로 설치 폴더의 `worker.env`(나만 읽음)에 들어간다. 열쇠는 90일 간다.
  살아 있는 열쇠는 두 개까지다. 세 번째 PC를 붙이면 가장 오래된 열쇠가 꺼진다.
- 로그아웃해도 워커가 돌게 하려면 한 번 `sudo loginctl enable-linger $USER`를 한다. `host:start`가 필요하면 알려 준다.

### 코드 복사 없이 연결(2026-11-05)

`npx oddbout-host` 러너(만드는 중)는 붙이기 코드 대신 이 연결을 쓴다. 러너가 나올 때까지 위의 붙이기 코드 명령이 그대로 대안이다.
PC가 먼저 묻고 사이트에서 "연결"을 누르는, 기기 로그인(`device-logins`)과 같은 방식이다(`api/host-pairing.mjs`, 이관 `20261105230000_oddbout_generation_host_pairings`).

1. 러너가 `GET /spec`의 `registration.hostPairing`이 `v1`인지 본다. 없으면 붙이기 코드로 간다.
2. `POST /generations/host/pairings` `{ "name": "<PC 이름, 한 줄 1~40자>", "platform": "windows" | "macos" | "linux" }` (로그인 없음) →
   `pairingCode`(비밀, `ohp_…`, 서버는 해시만 둔다), `userCode`(`BCDF-GHJK`), `expiresAt`(10분), `interval`(5), `url`(`creator.html#pc=<userCode>`).
   러너는 `userCode`를 화면에 보이고 `url`을 브라우저로 연다.
3. 사이트(로그인): `GET /generations/host/pairings/<userCode>`가 PC 이름·OS를 보이고, "연결"이 `POST /generations/host/pairings/approve` `{ "userCode" }`를 부른다.
   호스트가 없으면 `My PC`(구독)로 만든다. 있으면 이름·결제를 두고, 지운 호스트는 되살린다. 버튼의 약관 링크를 보고 누르는 것이 호스트 약속 동의다.
   계정마다 한 시간에 5번까지다.
4. 러너는 `POST /generations/host/pairings/token` `{ "pairingCode" }`를 `interval`초마다 `pending`이 아닐 때까지 부른다. `approved`면 `key`(워커 열쇠,
   이때 한 번만 온다 — 바로 `worker.env`에 쓴다)·`host`·`name`·`approved`·`expiresAt`이 온다. 열쇠는 붙이기 코드의 것과 같다(90일, 셋째 PC는 가장 오래된 열쇠를 끈다).
   `429 slow-down`은 더 천천히, `410 pairing-expired`·`pairing-consumed`·`join-code-invalid`는 처음부터 다시다.

코드는 공개 값이다. 연결은 주인의 로그인으로만 되고, 사이트는 코드·PC 이름·OS를 보여서 내 PC 화면과 맞춰 보게 한다. 내가 시작하지 않은 코드의
"연결"을 누르면 그 PC가 내 호스트의 열쇠를 받는다(남의 신청은 승인된 호스트만 받는다).

### 하트비트 `health`

워커는 1분마다 심장 박동 `{ "health": { … } }`를 보낸다. `health`는 2 KB 안의 자유 객체이고 서버는 그대로 둔다.
첫 박동은 `POST /generation-worker/heartbeat`로 간다. 서버가 `claimBeats: true`로 답하면, 다음 박동부터 그 차례의 `POST /generation-worker/claim` 본문에 실려 간다.
서버는 실린 박동을 먼저 기록하고(claim이 호스트의 건강을 읽는다) `beat: true`로 답한다. `beat`가 없는 답(API를 되돌림)을 받으면 워커는 다시 따로 보낸다.
claim하지 않는 차례(건강 아님)와 건강이 바뀐 다음 차례(provider가 내려감, 시간마다의 확인)도 따로 보낸다. 그래서 어느 서버에서도 새 건강이 claim보다 먼저 기록된다.
박동은 다음 대기까지 셈해서 1분을 넘기기 전에 간다. 건강 확인·정면 판정처럼 몇 분 걸릴 수 있는 단계 중에는 마지막 박동에서 1분이 차면 따로 보낸다(단계 시작 10초 안에는 보내지 않는다).
일이 없으면 워커는 15초에서 두 배씩 최대 1분 쉬었다 claim한다(2026-11-07: 유휴 claim과 박동이 프로젝트 Edge 요청의 83 %였다).
연결이 설치보다 먼저라서, 러너는 연결 직후부터 이 객체로 설치 진행을 알린다. 서버는 객체를 그대로 저장하고, `GET generations/host`의
`health`가 아래 `setup`·`platform`·`runner`를 사이트의 내 PC 카드에 넘긴다(`api/generations.mjs` `runnerSays`, 표에 없는 값은 null).

| 키 | 값 |
| --- | --- |
| `ok` | 지금 일을 받을 수 있다. 이것과 3분 안의 심장 박동이 "켜짐"이다 |
| `codex`, `grok` | 그 구독의 마지막 로그인·작은 호출 확인(계획의 "codex ok·grok ok"). 사이트의 Codex·Grok 카드가 이 키를 읽으므로 `codex_ok`·`grok_ok` 같은 새 이름은 쓰지 않는다 |
| `at` | 그 확인 시각(ISO) |
| `setup` | 러너의 설치 단계: `kit` → `python` → `sprite` → `ffmpeg` → `grok-login` → `codex-login`(선택) → `ready`. 실패는 `<단계>-failed` |
| `platform` | `windows` · `macos` · `linux` |
| `runner` | `oddbout-host` 버전(예: `0.1.0`) |

## 운영

| 하고 싶은 것 | 명령 |
| --- | --- |
| 상태 보기(승인·켜짐·오늘 남은 수·온라인, 설치·워커) | `npm run host -- status` |
| 새 신청 잠시 막기·다시 받기 | `npm run host -- pause` / `resume` |
| "아무 호스트" 신청 받기 | `npm run host -- any on` / `off` |
| 하루 한도(0~50) | `npm run host -- limit 5` |
| 워커 로그 | `npm run host -- log 80` |
| 워커 멈추기·다시 켜기 | `npm run host -- stop` / `restart` |
| 키트·생성기 갱신(`git pull` 뒤) | `npm run host:setup`(진행 중인 작업이 있으면 바꾸지 않는다. `pause` 뒤 끝나기를 기다린다) |
| 열쇠를 모두 끄기 | `npm run host -- revoke` |
| 그만두기(워커·열쇠·설치 폴더 전부) | `npm run host -- remove --yes` |

사이트의 My agents → 내 PC에서도 한다(2026-10-28): 켜짐·오늘 남은 수·두 구독의 마지막 확인(Codex·Grok 카드에도 나온다), 잠시 멈추기·다시 켜기,
**PC 연결 끊기**(열쇠를 모두 끈다 — `revoke`와 같다, 호스트는 남는다), **호스트 지우기**(`DELETE generations/host` — 모든 목록·뽑기에서 빠지고 열쇠·붙이기 코드가
꺼진다. 나를 지정했거나 내가 맡은 신청이 끝나지 않았으면 거절한다. 신청 기록은 그 호스트를 그대로 가리킨다). 지운 뒤 다시 신청하면 같은 호스트가 승인 없이 되살아난다.
PC의 설치 폴더는 PC에서 `npm run host -- remove --yes`로 지운다.

- 워커는 1분마다 서버에 살아 있음을 알린다(claim에 실어서). 3분 동안 소식이 없으면 목록에서 오프라인이 된다. 일이 없는 워커는 새 신청을 받는 데 최대 1분이 걸린다.
- 하루 넘게 소식이 없으면 내가 맡은 신청은 서버가 끝낸다(2026-11-05). 하던 단계는 유료 실행이 나갔는지 내 PC만 알므로 운영자 검토
  (`<단계>-host-lost`)로 가고, 아직 맡지 않은 단계(신청자의 답 뒤)는 실패(`host-lost`)한다. 다른 호스트로 넘어가지 않는다. 하룻밤 꺼 두는 것은 괜찮다.
- 한 시간마다 구독마다 아주 작은 실제 호출을 한다. **grok(SuperGrok)이 안 되면 새 작업을 가져가지 않는다**(2026-11-06, 1.1 제공자 프로필).
  신청은 처음 가져간 호스트가 외형·동작·제출까지 끝까지 맡고(다른 호스트로 넘기지 않는다), 걷기·달리기는 언제나 Grok 영상이다.
  그림(정면 두 장·옆모습·표정·키포즈 줄)은 신청의 `imageProvider`가 그린다: `grok`(기본) 또는 `gpt`(ChatGPT, 신청할 때 고른다).
  **SuperGrok만 있는 PC도 호스트가 된다**: Grok 그림 신청만 받고, 옆모습·걷기·달리기 판정은 픽셀 판정기가 한다(아래 판정 항목).
  codex(ChatGPT)도 되면 GPT 그림 신청도 받는다. 워커는 하트비트로 그릴 수 있는 그림(`images`: `grok`, codex도 되면 `gpt`)을 알리고,
  서버는 그 PC가 그리는 그림의 신청만 준다. codex가 안 되는 PC에 GPT 그림을 신청하면 바로 거절한다(`image-provider-unavailable`).
  맡기기 신청의 외형 고르기(codex)는 codex가 없는 PC에서는 하지 않고 신청자에게 묻는다.
  `worker.env`에 판정기를 `codex`나 `hybrid`로 정해 두었다면 그 판정기에 codex가 필요하므로, codex가 안 되는 동안은 새 작업을 가져가지 않는다.
  구독 하나로 하는 다른 설계(ChatGPT만 있는 PC)는 [SINGLE-SUBSCRIPTION-HOSTS.md](SINGLE-SUBSCRIPTION-HOSTS.md)에 있다.
- 하루 한도는 기본값 5로 시작한다(2026-10-30, 측정 전의 운영 기준). 한 건이 SuperGrok을 그림·영상에 쓰고(GPT 그림이면 그림은 ChatGPT) 구독의 남은 사용량은
  CLI로 볼 수 없어서, 건수는 거친 대리 지표다. `npm run host -- log`에 `cannot run now` 줄이 며칠 동안 없으면 한 번에 몇 건씩 올리고,
  자주 나오면 낮춘다. 그 줄은 실제 단계가 한도에 걸렸다는 뜻이고, 그동안 이 PC는 새 작업을 받지 않는다. 등록 1건당 제공자 실행 수를 잰 뒤
  ([MEASUREMENT.md](MEASUREMENT.md)) 이 기준을 숫자로 바꾼다.
- 하루 한 번 끝난 작업 폴더를 지운다. 닫힌 지 7일 지난 작업과, 닫히지 않은 채 14일 동안 바뀐 파일이 없는 작업이다
  (`worker.env`의 `ODDBOUT_GENERATION_KEEP_DAYS`, 1~90).
- 옆모습·걷기·달리기 판정은 기본으로 codex가 하고, codex가 안 되는 PC에서는 픽셀 판정기가 한다(2026-11-06). `npm run host -- worker judges pixels`(픽셀 판정기만) 또는 `hybrid`(픽셀 판정기 먼저,
  정하지 못한 검사만 codex)로 `worker.env`의 `ODDBOUT_GENERATION_JUDGES`를 바꾸고 워커를 다시 시작하면 바뀐다. 공식 PC는 `og worker judges …`다.
  키를 다시 받아도(`worker key`) 이 설정은 남는다. 무엇을 보고 무엇을 못 보는지는 [host/README.md](../host/README.md)의 판정기 항목에 있다.

## 보안 모델

- 신청 글은 codex의 입력이 된다. 그래서 생성기는 설치 폴더의 codex에서 셸·파일·브라우저·컴퓨터·플러그인·하위 에이전트 기능을 끈다(`og harden`).
  킷 폴더의 `AGENTS.md`(제작 에이전트용 지시)를 codex가 모델 지시에 넣지 않도록 프로젝트 지시 읽기도 끈다(`project_doc_max_bytes = 0`, 2026-11-05).
  이 설정이 없으면 워커가 시작하지 않는다. 브리프와 판정은 그림 생성까지 끈 codex로 돈다.
- codex·grok은 설치 폴더를 HOME으로 돈다. 내 평소 설정과 로그인은 쓰이지 않는다.
- 사용자 설치는 내 유닉스 계정으로 돈다. 가능하면 이 꾸러미만 쓰는 별도 유닉스 계정을 만들어 그 계정에서 설치한다.
  그러면 기능 끄기가 실패해도 codex가 내 파일에 닿지 못한다.
- 열쇠·구독 로그인·신청 파일은 설치 폴더(700)에 있다. 그만둘 때는 `remove --yes`로 모두 지운다.

## 문제가 생기면

| 증상 | 할 것 |
| --- | --- |
| `signin --device` 링크가 만료됐다 | `npm run host -- signin --device`로 새 링크를 받는다. Google 로그인 뒤 승인 화면이 보이지 않으면 같은 링크를 다시 연다. 명령을 끊었다가 다시 실행하면 앞의 링크를 이어서 기다린다 |
| `host:setup`이 프로그램이 없다고 한다 | 알려 준 프로그램을 설치한다(예: Ubuntu `sudo apt install ffmpeg webp zip unzip python3-venv`) |
| `user systemd … unreachable` | 데스크톱 로그인 세션에서 하거나 `sudo loginctl enable-linger $USER` 뒤 다시 로그인한다 |
| `host:start`가 구독이 ok가 아니라고 한다 | `npm run host:login`으로 다시 로그인한다. 구독 한도가 찼으면 기다린다 |
| 목록에 오프라인으로 나온다 | `npm run host -- log`, `npm run host -- status`. 워커는 승인·켜짐·건강이 모두 맞아야 일한다 |
| 신청이 오지 않는다 | 지정 신청이 없고 `any off`이면 오지 않는다. 하루 한도가 0인지도 본다 |
