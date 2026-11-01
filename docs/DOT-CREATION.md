# Dot에서 내 선수 만들기

Dot은 외형을 실제로 보여준 뒤 선택된 원화로 애니메이션을 만든다. 로컬 제작에는 이 저장소의 **sprite-gen**을 사용한다.
이 문서에서 "sprite-gen"은 `vendor/sprite-gen`에 고정된 sprite-gen 엔진·CLI를 말하며, Alex Kim의 [sprite-gen](https://github.com/aldegad/sprite-gen)을 포크한 [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent)에서 가져온다. 명령·경로·Python 패키지 이름은 그대로 `sprite-gen`이다.
사용자는 만들고 싶은 캐릭터를 설명한다. Dot은 제작 도구 실행, AI Fighter 패키징, 검사와 요청받은 등록을 맡는다.
본인의 생성 계정과 선택한 실행 환경을 사용한다. 지원되는 직접 표시 외형 시안에는 PC가 필수가 아니다. 제작자의 로그인·토큰·서비스 키를 배포하지 않는다.

## 0. 대화하며 한 단계씩 만들기

먼저 [게임이 내려주는 구조 데이터와 진행 상태](GAME-CREATION-CONTEXT.md)를 읽는다.
기술 수치·현재 조작·모션 묶음은 게임의 최신 응답이 소유한다. 제작 안내의 요약 표를 별도 규칙 원본으로 쓰지 않는다.

먼저 [제작 UX 규격](CREATION-UX.md)으로 실제 제작 요청과 과정 설계·평가 요청을 구분한다.
후자에는 생성 도구를 실행하지 않는다. 텍스트·참조 이미지·둘의 조합을 받고, 이미지의 역할과
결과에 영향을 주는 충돌만 확인한다. 테스트 예시를 실제 사용자 선택으로 기록하지 않는다.

**기본은 외형 → 대기·이동 → 공격 → 방어·피격 → 최종 확인의 다섯 묶음이다.**
게임 문맥에 선택 묶음 `style`(싸우는 성격·고유 기술)이 있으면 방어·피격 뒤에 한 번 제안하고, 사용자가 원하지 않으면 건너뛴다.
현재 호스트가 지원하는 범위에서 같은 제작 원칙을 따른다. 로컬 생성·패키징에는 로컬 도구가 필요하다.
묶음은 사용자가 하나의 감각을 함께 판단할 수 있는 범위로 나눈다. 묶음 안의 생성·검수는 이어서 처리하고,
끝에서 결과를 함께 보여주며 피드백을 받는다. 동작마다 별도의 진행 허락을 요구하지 않는다.

| 묶음 | 함께 만드는 결과 | 사용자가 판단할 것 | 보여줄 미리보기 |
| --- | --- | --- | --- |
| 1. 외형 | 전신 원화, `idle` 기준 자세, 같은 그림에서 얻은 얼굴 미리보기 | 체형·표정·복장·색·화풍이 원하는 캐릭터인가 | 전신 한 장과 얼굴 확대 |
| 2. 대기·이동 | `fightIdle`, `walk` 12~32프레임, `run` 10~16프레임 | 가벼운지 묵직한지, 자세·보폭·상하 움직임이 어울리는가 | 대기·걷기·달리기를 같은 크기로 함께 재생 |
| 3. 공격 | `combo`, `slam`, `dash`와 준비·회수 자세 | 연타·강타·돌진의 박자와 힘주는 표현이 어울리는가 | 공격 세 가지를 준비부터 회수까지 모아보기 |
| 4. 방어·피격 | `block`, `hit`, `groggy`, `fall`과 기상 자세 | 막기·맞기·비틀거림·쓰러짐이 자연스럽고 캐릭터다운가 | 방어와 반응을 상태별로 고르거나 연속해서 재생 |
| (선택) 싸우는 성격 | `skill`·`entrance`·`victory` 가운데 사용자가 원하는 것, `combat.style` 선택 | 기술·등장·승리 자세와 싸우는 방식이 캐릭터다운가 | 고른 선택 동작과 성격 요약 |
| 5. 최종 확인 | 선택한 11개 동작(과 고른 선택 동작)의 패키지, 이름·소개·초상·경기 대사, 검사 결과 | 전체 외형·크기·움직임이 일관되고 이름·소개가 맞는가 | 최종 파일에서 재생한 전체 동작과 프로필 |

1~4의 입력 동작 합계는 필수 11개다. 초상은 별도 캐릭터를 다시 생성하지 않고 같은 원화에서 얻는다.
선택 묶음은 다음 묶음과 최종 확인을 막지 않는다. 다만 패키지에 넣는 선택 동작은 각각 현재 버전을 고르고 검수해야 패키지를 기록할 수 있다
(`package-optional-clip-unreviewed`). 넣지 않기로 한 선택 동작은 패키지 계획에서 뺀다.
기상은 `fall`의 보조 자세로 규격에 맞춰 연결한다. 묶음은 제작·피드백 단위이며, 제출 규격이나 게임의 공격 수치가 아니다.

### 묶음 진행 규칙

1. **외형부터 시작한다.** 사용자 설명을 짧게 정리하고 다음 시안에 중요한 정보가 빠졌을 때만 한두 가지를 묻는다.
   충분히 설명했고 생성·표시 경로가 확인됐다면 원화 한 장을 만든다. 이름·소개를 정하느라 첫 시안을 늦추지 않는다.
   사용자에게 외형을 보여주고 수정한 뒤, 선택한 원화를 다음 묶음의 기준으로 삼는다.
2. **한 묶음을 맡으면 그 안의 작업은 이어서 한다.** 예를 들어 대기·이동은 세 동작을 준비해 함께 비교하게 한다.
   걷기가 끝났다는 이유만으로 달리기를 시작할 허락을 다시 묻지 않는다. 설치·추출·접지 검사도 해당 묶음 안에서 처리한다.
3. **묶음 끝에서 한 번 대화한다.** 실제 결과를 함께 보여주고 판단할 점을 짚는다. "좋아", "이걸로 가자"는
   그 묶음의 선택으로 받아들여 다음 묶음을 진행한다. 같은 내용의 확인 질문을 덧붙이지 않는다.
   단, 문장 전체와 지칭 범위, 동작별 버전의 이전 선택을 읽는다. "좋은데 귀는 줄여줘"는 수정 요청이다.
   "달리기는 좋아"는 달리기의 선택이며, 대기·걷기가 이미 선택됐고 검수를 충족하면 마지막 선택으로 묶음을 완료한다.
   남은 항목이 있으면 그 항목만 확인한다. 수정하지 않은 결과의 선택을 초기화하지 않는다.
   수정 요청이면 영향을 받은 결과만 고쳐 묶음의 맥락에서 다시 보여준다. 답이 오기 전에는 다음 묶음을 생성하지 않는다.
4. **묶음 크기는 피드백에 맞춘다.** 사용자가 특정 동작부터 보고 싶으면 그 부분을 먼저 보여준다.
   현재 묶음이 오래 걸리면 만들어진 실제 시안을 먼저 공유하며, 이것을 매 동작별 필수 확인 절차로 만들지 않는다.
   같은 문제가 두 번 연속 반복되면 현재 시안과 남은 문제를 먼저 보여주고 방향을 나눈다. 사용자 모르게 끝없이 재생성하지 않는다.
   "공격과 피격은 맡길게"처럼 위임한 범위는 이어서 처리한다. 침묵이나 한 묶음의 만족은 이후 모든 묶음의 위임이 아니다.
   뒤 묶음의 위임이 앞 묶음의 미확인 결과까지 선택한 뜻은 아니다. 명시적으로 맡긴 실제 범위를 기록한다.
5. **최종 확인은 완성된 파일로 한다.** 패키징·검사를 먼저 수행하고 최종 미리보기를 보여준다.
   패키징 중 배율·크롭·재생이 달라졌다면 표시한다. 최종 결과에 대한 피드백을 반영한 뒤 이미 요청받은 등록을 진행한다.
   최종 선택과 등록 요청이 모두 있으면 별도의 등록 허락을 반복해서 묻지 않는다. 등록 요청이 없으면 로컬 결과를 전달한다.
   선택 후 이름만 바꾸고 등록하라는 직접 지시는 변경값과 등록 의도를 이미 포함한다. 시각 결과가 그대로이면
   변경된 파일을 검수하고 새 패키지 키로 등록하며, 전체 동작과 같은 등록 요청의 재승인을 요구하지 않는다.

사용자에게 필요한 결정은 외형과 움직임이다. 설치·파일 추출·측정·검사 등 합의한 단계 안의 작업은 Dot이 처리한다.
생성 제공자·계정·비용 선택은 아래의 사용자별 규칙을 그대로 따른다. 원화와 로컬 미리보기를 만드는 데
AI Fighter 회원가입이나 홈페이지 방문을 선행 조건으로 두지 않는다. 서버에 등록할 때 본인 로그인이 필요하다.

### 피드백과 작업 기억

- 각 묶음의 미리보기에서 무엇을 바꿨는지 한두 문장으로 설명하고 실제 이미지나 재생 가능한 애니메이션을 보여준다.
  검수 전이면 시안이라고 표시한다. `queued`·텍스트·로컬 경로만 반환됐으면 표시 미완료로 기록한다.
  [전달 확인 절차](DELIVERY.md)에 따라 같은 원본을 회수하고 지원되는 경로로 보여준다. 재생성으로 전달 장애를 숨기지 않는다.
- 묶음 끝에서 답을 기다릴 때는 생성 작업을 멈추고 대화로 돌아온다. 사용자의 수정 요청은 현재 묶음에 반영한다.
  작업 중 방향이 바뀌면 그 방향에 의존하는 후속 생성을 멈춘다.
- 수정은 대상 이미지·동작에 한정한다. 한 동작의 속도를 바꾼다고 원화와 다른 동작을 다시 만들지 않는다.
  원화의 체형·복장처럼 여러 동작에 영향을 주는 변경은 영향 범위를 설명하고 원화부터 다시 확인한다.
- 선택된 버전을 보존하고 수정본은 별도 버전으로 둔다. 거절한 시안으로 되돌아가거나 전체 생성부터 다시 시작하지 않는다.
- `output/<localId>-work/creation-notes.md`에 선택한 원화·동작의 실제 파일 경로와 버전, 사용자의 피드백,
  현재 묶음과 완료한 묶음, 확인한 범위, 위임받은 묶음, 아직 기다리는 답을 짧게 기록한다. 사용자가 하지 않은 선택을 쓰지 않는다.
  이 메모는 재개용 작업 기록이며 `fighter.json`이나 등록 패키지에 넣지 않는다. 재개할 때 현재 대화를 우선한다.

예시 대화:

> 사용자: 빨간 글러브를 낀 고양이 복서를 만들고 싶어.
>
> Dot: 원화 한 장을 만들어 보여준다. 외형 피드백을 기다린다.
>
> 사용자: 몸은 좋은데 귀를 조금 줄여줘.
>
> Dot: 귀를 줄인 원화를 보여준다. 후속 동작은 아직 생성하지 않는다.
>
> 사용자: 좋아. 이 외형으로 가자.
>
> Dot: 같은 원화로 전투 대기·걷기·달리기를 만들어 함께 재생한다. 이동감에 대한 피드백을 기다린다.
>
> 사용자: 달리기는 좋은데 걷기가 너무 통통 튀어. 걷는 상체는 덜 움직이게 해줘.
>
> Dot: 걷기만 수정하고 대기·달리기와 함께 비교할 수 있게 보여준다.
>
> 사용자: 이제 좋아.
>
> Dot: 공격 묶음으로 넘어가 연타·강타·돌진을 만든 뒤 함께 보여준다.

## 생성 전 표시·전달 확인

[DELIVERY.md](DELIVERY.md)에 따라 생성 경로와 현재 대화의 전신·얼굴 확대 표시 경로를 각각 확인한다.
PC가 필요 없는 외형은 현재 호스트가 지원하는 직접 생성·표시를 우선 확인하되 사용자 계정·모델·환경 제약을 유지한다.
로컬 경로는 실제 전달 helper까지 확인하고 `npm run creation:delivery -- preflight <기록.json> <현재-대화-ID>`를 실행한다.
이 점검은 기록 검사이며 실제 도구 탐색을 대신하지 않는다. 준비되지 않은 전달 경로로 생성만 진행하지 않는다.
생성 후 `review` 점검으로 표시·검수·선택을 구분한다. 직접 표시 시안도 전체 선택 전에는 pending이다.

## 1. 제작 도구 받기

터미널과 로컬 파일을 사용할 수 있는 Dot/Codex 호스트에서 실행한다. 로컬 실행 기능이 없는 웹 호스트에는
이 설치 명령을 실행했다고 말하지 않는다. 호스트 지원 여부를 먼저 확인한다.
봇 서비스의 작업 VM으로 운영할 때의 계정·격리·보존 규칙은 [실행 환경 운영 지침](EXECUTION-HOST.md)에 있다.

```sh
git clone --branch main --single-branch https://github.com/jeonghwanko/oddbout-starter.git
cd oddbout-starter
npm ci --ignore-scripts
npm run sprite:setup
npm run sprite:status
```

홈페이지와 연결할 때는 `main` 브랜치를 사용한다. 공개 로그인 연결 설정은
이 브랜치의 `deploy/creator-site.json`에서 읽는다. 기본 `main`으로 대체하지 않는다.
기존 설치를 재사용할 때도 브랜치와 파일을 확인하고, 사용자의 변경을 덮어쓰지 않는다.

Git·Node 22.12+·Python 3.11+가 필요하다. `sprite:setup`이 sprite-gen 고정 커밋만 얕게(약 100 MB) 받는다.
GitHub ZIP에는 서브모듈 내용이 없으므로 Git clone을 사용한다.
`sprite:setup`은 `vendor/sprite-gen/.venv`에 도구를 설치한다. 전역 sprite-gen이나 운영자 PC 경로에 의존하지 않는다.
Python 탐지가 필요한 호스트는 `AI_FIGHTER_BOOTSTRAP_PYTHON`에 Python 실행 파일 경로를 지정한다.
해당 변수는 venv 생성에만 쓴다. 생성과 추출은 항상 포함된 도구의 venv에서 실행한다.

`sprite:setup`은 이어서 외부 도구를 갖춘다(sudo 없음, 상세는 [실행 환경 2절](EXECUTION-HOST.md#2-작업-공간-준비)):

| 도구 | 쓰임 | 설치 |
| --- | --- | --- |
| `img2webp`(`-exact`, libwebp 1.5+) | 걷기·달리기 WebP, 필수 | 없거나 오래되면 키트가 libwebp 1.6.0을 SHA-256 고정으로 venv에 받는다 |
| RIFE | 루프 이음새 보정, 선택 | 키트가 `sprite-gen rife install`을 부른다. 확인 프레임 실패는 경고 |
| `ffmpeg`·`ffprobe` | 영상 → 프레임, 필수 | 사용자·준비자가 설치: `sudo apt install ffmpeg` / `brew install ffmpeg` / `winget install --id Gyan.FFmpeg -e` |

`sprite:status`의 `tools`가 `ready`가 아니면 생성을 시작하지 않는다. `install.actor`가 `agent`면 `npm run sprite:setup`을 실행하고,
`user`면 그 명령을 사용자에게 전한다. sudo 명령을 에이전트가 대신 실행하지 않는다.

## 2. Dot이 읽을 규칙과 계정 선택

1. `get_fighter_spec`의 `overview`, `creation`, `guide`, `schema`를 읽는다. `creation`은 현재 호스트의
   제작 도구 위치와 이 안내를 반환한다. 오프라인 제작은 가능하며 서버 등록 가능 여부는 `overview`로 확인한다.
2. 로컬 생성은 [포함된 sprite-gen 스킬](../vendor/sprite-gen/SKILL.md)과 그 스킬이 지정한 시작 절차를 읽는다.
   [사용자별 설정·접근 확인](../vendor/sprite-gen/docs/user-workflow.md)을 따른다.
3. 로컬 경로의 `npm run sprite -- workflow --kind sprite`로 접근 상태와 빠진 선택을 확인한다.
   질문이 남으면 종료 코드 2로 끝난다. 실패가 아니라 `questions`를 처리하라는 뜻이다.
   사용자가 이미 밝힌 원화 제공자·동작 방식·구독 접근 가능 여부는 다시 묻지 않는다.
   다른 사용자의 확인이나 이 예제의 GPT 선택을 현재 사용자의 계정 확인으로 취급하지 않는다.
4. 원화·동작 방식을 따로 설문하지 않고 본인 계정에서 현재 사용할 수 있는 구독을 한 번에 확인한다.
   권장 순서는 GPT 원화 + Grok 동작, Grok만 가능하면 둘 다 Grok, GPT만 가능하면 둘 다 GPT다.
   사용자가 명시한 방식이 우선하며, 이 순서는 실행 중 자동 전환 규칙이 아니다.
   이미 전달받은 선택·접근 확인은 다시 묻지 않는다. 다음 명령은 해당 사용자가 실제로 확인한 경우에만 쓴다.

```sh
# GPT와 Grok 모두 사용 가능: 기본 제안
npm run sprite -- workflow --kind sprite --image-provider codex --motion-method grok-video --confirmed-access codex --confirmed-access grok

# Grok만 사용 가능
npm run sprite -- workflow --kind sprite --image-provider grok --motion-method grok-video --confirmed-access grok

# GPT만 사용 가능 또는 사용자가 원화·동작 모두 GPT를 지정
npm run sprite -- workflow --kind sprite --image-provider codex --motion-method gpt-rows --confirmed-access codex
```

이는 준비 상태를 읽는 명령이다. `needs-input`이면 반환된 질문을 처리한다. 처음 실행할 때는
GPT를 사용할 수 없을 경우의 선택도 남아 있을 수 있다. Dot이 답을 대신 정하거나 설정을 저장하지 않는다.
`status: ready`는 제출한 선택·준비 조건에 대한 응답이며 실제 생성 접근의 검증값이 아니다.
[DELIVERY.md](DELIVERY.md)에 따라 작업 모델과 이미지 도구·백엔드를 구분하고, 표시·전달 사전 조건도 확인한 뒤
사용자가 요청한 생성을 실행한다. 실제 호출 trace와 완료 출력이 있어야 생성 성공을 확인한 것으로 기록한다.
생성 계정은 각자 로그인한다. 소스가 포함됐다는 사실만으로 생성 구독·한도가 제공되는 것은 아니다.
API 과금 제공자로 임의 전환하지 않는다. 상위 도구의 종료 코드 75는 사용자 선택이 필요한 상태이므로 그대로 처리한다.
이미 답한 불가 시 중단 방침을 우선 적용하며 거절한 대체 제공자를 재질문하지 않는다.
이미지·영상 접근 확인은 별도로 기록하고 필요한 단계에서 미확인 기능만 확인한다.

외형에 필요한 제공자는 준비됐지만 이후 동작 제공자의 로그인만 남았다면 그 상태를 알리고,
현재 원화의 `workflow --kind image`를 별도로 확인할 수 있다. 원화 단계가 `ready`일 때만 외형을 만들고,
동작을 시작하기 전 선택된 `workflow --kind sprite`의 접근 상태를 확인한다. 사용자 피드백 경계는 유지한다.

## 3. 원화 → 애니메이션 → AI Fighter 패키지

사용자가 새 **관절 포즈 가이드 방식**을 선택한 GPT walk/run은
[GAIT-REVIEW.md의 단일 포즈 경로](GAIT-REVIEW.md#관절-좌표를-전달하는-새-단일-포즈-경로)를 따른다.
`gen-motion`(관리형 작업으로는 사전 검사 `--motion-method pose-plan`)이 실제 원화·관절 가이드·검수된 앞뒤 자세를 전달하며,
walk 16/run 12개 프레임과 최종 시퀀스 검수 후 `asset.json`을 만든다.
이 선택에서는 아래의 기존 gen-set 행별 생성으로 임의 대체하지 않는다.

아래는 [대화형 제작](#0-대화하며-한-단계씩-만들기)의 각 단계에서 적용할 기술 규칙이다.
사용자 피드백을 기다리는 단계를 건너뛰어 전체 제작을 연속 실행하는 지시로 읽지 않는다.

- 사용자 설명으로 **새 전신 원화**를 만든다. 원더루팡 화풍은 사용자가 그 화풍을 요청한 경우의 디자인 방향이다.
  이 공개 저장소는 원더루팡의 원본 그림을 포함하지 않는다. 사용자가 제공한 참조가 있으면 적법한 참조로 사용한다.
- AI Fighter의 시점은 오른쪽을 보는 정사영, 카메라 고도 16도, 몸높이 기준 400px이다.
  그림에서 실제 시점·정체성을 확인한 뒤 같은 원화를 모든 동작의 기준으로 삼는다.
- GPT 동작을 선택한 경우 [행별 제작 절차](../vendor/sprite-gen/docs/atlas-workflow.md)의
  `prepare → gen-set --provider codex → extract → compose-atlas → QA`를 사용한다.
  walk/run은 [보행 설계와 검수](GAIT-REVIEW.md)의 핵심 자세 단계부터 시작한다. 전체 시퀀스 생성에는
  실제 phase-guide와 해시로 묶인 검수 keyposes 참조가 필요하다. 단순 배치 가이드만으로 보행을 해결했다고 판단하지 않는다.
  kit의 검토된 패치가 prepare/gen-set/painted 추출을 연결하므로 `npm run sprite --`로 실행한다.
  `gen-set`의 OK는 생성 완료이며 보행 합격이 아니다. 일반 픽셀 변화량 검사와 최종 양발 접지 검수를 구분한다.
  상체 고정·다리 합성으로 동작 오류를 숨기지 않고, 같은 오류가 두 번 연속 남으면 반복 생성·합성을 멈추고 근거를 보여준다.
  다른 동작 방식을 선택한 사용자는 `workflow`가 반환한 경로와 문서를 따른다.
  명령은 `npm run sprite -- <명령> ...`로 실행한다. 상대 경로는 npm을 실행한 폴더 기준이다.
  sprite-gen 문서처럼 절대 경로를 써도 된다.
  sprite-gen의 `manifest.json.frame_layout`과 선택된 `curated/` 결과에서 실제 프레임을 읽는다.
  생성 그림을 임의 격자로 자르거나 도형을 그린 것을 sprite-gen 결과라고 보고하지 않는다.
- 필수 11개 동작과 허용 프레임 수·랜드마크는 AI Fighter spec/schema가 소유한다.
  `gait-frames-1`의 `walk`는 12~32칸, `run`은 10~16칸이며 16/12는 제작 기본값이다.
  영상 한 주기를 이 기본값에 맞추려고 프레임을 삭제·복제·보간하지 않는다. 원화 생성 성공과 실제 보행 품질 통과는 다르다.
  [sprite-gen 동작 검수](../vendor/sprite-gen/docs/qa-motion.md)로 발 교대·루프·몸통 고정·접지·공격 준비/접촉/회수를 확인한다.
  실패한 걷기를 정지 프레임 복제나 시간 조절로 통과시키지 않는다.
- [보행 설계·검수 흐름](GAIT-REVIEW.md)을 따른다. 공통 좌표와 배율을 고정하고 프레임별 지지발을 계획한 뒤,
  실제 미리보기를 보여준다. `fighter:gait review`의 접지·품질 진단은 나중에 요청할 때 수행하며 제작·등록을 막지 않는다.
- **호스팅 제작의 Decisions 검수는 [서버 검수 경로](SERVER-DECISIONS-REVIEW.md)를 쓴다.** 서버가 비교 모드를 켜면
  호스트가 기존 작업 인증으로 증거만 전달한다. OpenAI 키는 서버 Secrets에만 관리하고 사용자 PC나 생성 호스트에 설정하지 않는다.
- 독립 연구 환경의 선택형 [Decisions 보조 검수](../vendor/sprite-gen/docs/decisions-review.md)는
  `npm run sprite -- review-decisions --spec <검수입력.json> --out-dir <별도결과폴더>`로 준비한다.
  기본 실행은 로컬 요청 준비이며 실제 API 호출이나 이미지 생성이 아니다. `--pose-run`의
  input/pose/sequence 단계도 지원한다. 사용자가 별도 API 과금을 선택한 경우에만 허용된 검수 환경에서
  `--execute --confirm-api-billing`을 사용한다. 생성 작업 공간에 금지된 서비스 키를 추가하지 않는다.
  보조 판정은 실제 접지 측정·기존 검수 파일·사용자 선택을 대신하지 않는다. 독립적으로 작성한 정답과
  기존 판정의 비교는 `npm run sprite -- evaluate-decisions --dataset <평가자료.json> --output <새결과.json>`으로 한다.
- 검수한 동작은 아래 [패키지 만들기](#패키지-만들기-game-pack--fighterpack)로 AI Fighter 패키지로 바꾼다.
  시트·해시·크기·origin·접지를 손으로 만들지 않는다. sprite-gen manifest를 그대로 AI Fighter JSON이라고 제출하지 않는다.
- 결과 폴더는 `AI_FIGHTER_ROOT` 아래 `output/<새-선수>/`로 둔다. 그림의 생성 보고서와 동작 검수 근거는 별도로 보존한다.
- 사용자에게 실제 애니메이션을 보여준다. 사용자가 등록을 요청한 범위에서 같은 불변 패키지를 제출한다.
  수정한 패키지는 새 idempotencyKey를 사용하고, 동일 요청 재시도는 원래 키를 재사용한다.

### 패키지 만들기: game-pack → fighter:pack

1. 11개 동작의 sprite-gen 결과를 [game-pack](../vendor/sprite-gen/docs/game-pack.md) 요청 하나에 모은다.
   행 아틀라스는 `manifest.json`(모든 상태가 `<id>/<상태>`로 펼쳐진다), 영상 루프는 `<name>.strip.json`을 `source`로 쓴다.
   모든 항목에 `"display": { "body_height": 400 }`을 쓴다. 출처에 `body_h`가 없으면 공통 좌표로 제작된
   **중립 자세의 실제 키를 한 번 측정해** 같은 `source_body_height`로 쓴다. 웅크림·누움마다 외곽 높이를 재서 400px로 확대하지 않는다.
   `fighter:gait game-request`가 공통 기준 측정과 요청 생성을 지원한다. 다른 캔버스는 거절하며 체형 일치는 실제 그림에서도 확인한다.
   이 명령은 자세마다 달라진 몸 크기도 sprite-gen `scale-check`로 머리 기준 측정해 game-pack에서 되돌린다.
   측정하지 못한 프레임은 보드(`game.scale-check.png`)를 보고 보정값을 정해야 요청이 만들어진다([보행 검수](GAIT-REVIEW.md)).

```sh
npm run sprite -- game-pack --request game.json --out-dir pack
```

2. 계획 파일에 동작과 애니메이션의 대응, 접촉 단계, 랜드마크를 적는다. 그림으로 잴 수 없는 연출 판단이다.
   단계 번호는 game-pack 애니메이션의 재생 위치다(`frames` 배열의 0부터 센 번호). 다른 동작의 자세를 빌리는
   `dash.windup`·`recover`와 `fall.getUp`은 `{ "clip", "step" }`으로 적는다. 아래 숫자는 형식 예시다.

```json
{
  "gamePack": "pack/game-pack.json",
  "out": "../output/blue-cat",
  "localId": "blue-cat",
  "profile": { "name": "파란 고양이", "description": "파란 갑옷의 고양이 복서" },
  "motions": {
    "idle": { "animation": "cat/idle" },
    "walk": { "animation": "cat/walk", "gaitReview": "review-walk/review.json" },
    "run": { "animation": "cat/run", "gaitReview": "review-run/review.json" },
    "fightIdle": { "animation": "cat/guard" },
    "combo": { "animation": "cat/combo", "hitSequenceIndices": [2, 5, 8], "landmarks": { "spinStart": 4 } },
    "slam": { "animation": "cat/slam", "hitSequenceIndices": [3] },
    "dash": { "animation": "cat/dash", "hitSequenceIndices": [2],
      "landmarks": { "windup": { "clip": "fightIdle", "step": 0 }, "recover": { "clip": "fightIdle", "step": 1 } } },
    "block": { "animation": "cat/block", "hitSequenceIndices": [1] },
    "hit": { "animation": "cat/hit", "hitSequenceIndices": [1], "landmarks": { "recoil": 1, "stagger": [2, 3], "recover": [4, 5] } },
    "groggy": { "animation": "cat/groggy" },
    "fall": { "animation": "cat/fall", "hitSequenceIndices": [2],
      "landmarks": { "lieSequenceIndex": 3, "getUp": [{ "clip": "hit", "step": 4, "durationMs": 90 }, { "clip": "fightIdle", "step": 0, "durationMs": 90 }] } }
  }
}
```

중간 `game-pack`이 50MB를 넘으면 같은 요청에 `--image-format webp`를 써 무손실 WebP만 저장한다.
필요한 경우 `--max-bytes 200000000`으로 중간 팩만 200MB까지 허용할 수 있다. 프레임·픽셀·시간·해상도를
바꾸지 않으며 최종 제출 파일의 용량 제한은 그대로다. [Dots 복구 안내](DOTS-QUICKSTART.md#file-only-packaging-repair-068)를 따른다.

3. 선택된 최종 game-pack으로 필수 파일·계약 검사와 패키징을 진행한다. 보행·시각 품질 진단은 선택적 후속 작업이다.
   `npm run fighter:pack -- plan.json`을 실행한다. 경로는 계획 파일 기준이다. 출력 폴더가 이미 있으면 거절한다.

#### 별도 기상 애니메이션을 fall 시트에 보관하기

쓰러짐과 기상을 별도로 만들었다면 공식 game-pack에 두 애니메이션을 넣고 `fall.getUpAnimation`을 지정한다.
다음 숫자·이름은 구조 예시다. 쓰러짐 6단계의 마지막은 실제 누운 자세여야 한다.

```json
"fall": {
  "animation": "rook/fall",
  "getUpAnimation": "rook/get_up",
  "hitSequenceIndices": [3],
  "landmarks": { "lieSequenceIndex": 5 }
}
```

- `getUpAnimation`은 같은 game-pack의 애니메이션 이름이며 fall에만 허용된다. 별도 입력은 2~8개 재생 단계여야 한다.
- 두 입력은 동일한 캔버스·배율·기준점(anchor)을 공유해야 한다. 다른 캔버스·anchor는 `GET_UP_GEOMETRY`로 거절한다.
  원본에서 먼저 맞춘다. 패커는 fall의 좌우 반전과 중립 기준 공통 배율을 기상 프레임에도 동일하게 적용한다.
- 기상 그림은 fall의 같은 시트와 공통 크롭·origin에 포함하고 픽셀 중복을 제거한다. `fall.sequence`에는 추가하지 않는다.
  `landmarks.getUp`의 `{clip:"fall", frame, durationMs}`는 실제 기상 순서·시간과 중복 제거 결과에서 자동으로 만든다.
- `getUpAnimation`과 수동 `landmarks.getUp`을 함께 쓰면 거절한다. 기존 수동 빌리기 경로는 계속 지원한다.
  `{clip, step}`의 `step`은 해당 클립의 기본 재생 단계이며 기상 보조 프레임까지 확장되지 않는다.
- 기상의 단계별 1~2000ms, 합산 10초, 최종 시트 크기·바이트·전체 프레임 한도와 walk/run 검수 게이트는 유지된다.
  `pack-report.json`의 `motions.fall.getUp`에 원본 애니메이션·프레임 키·최종 프레임 매핑을 기록한다.

쓰러짐을 재생한 뒤 다시 일어서거나 다시 눕는 구간을 fall에 붙이지 않는다. 실제 fall 재생은 누움으로 끝나고,
기상은 getUp을 사용하는 상황에서만 재생되는지 최종 미리보기에서 별도로 확인한다.

#### 선택 동작·대사·싸우는 성격

계획의 `profile`에는 `language`·`concept`·`names`·`lines`·`moves`·`stats`·`style`도 넣을 수 있다.
`stats`·`style`은 fighter.json의 `combat.stats`·`combat.style`, 나머지는 같은 이름의 `profile` 필드가 된다.
`motions`에는 필수 11개 밖에 선택 동작 `skill`·`entrance`·`victory`를 더할 수 있다([선택 동작](AUTHORING.md#선택-동작)).
다음 숫자·이름은 구조 예시다.

```json
"profile": { "name": "파란 고양이", "description": "파란 갑옷의 고양이 복서",
  "lines": { "challenge": "한 판 붙자!", "win": "역시 내가 이겼군." },
  "style": { "mix": { "slam": 1, "combo": 3, "fast": 1 }, "distance": 2, "temper": { "patience": 4 } } },
"motions": {
  "skill": { "animation": "cat/claw", "hitSequenceIndices": [6], "skill": { "kind": "pincer" } },
  "entrance": { "animation": "cat/entrance" },
  "victory": { "animation": "cat/victory" }
}
```

- 선택 동작은 필수 전투 동작과 같이 포장한다. 시트·프레임·기준점·접지·해시는 그림에서 잰다.
- `skill.kind`와 표식(돌진의 `windupTo`·`recoverFrom`·`run`·`launch`·`struck`, 자세의 `windowFrom`·`windowTo`·`strikeFrom`·`strikeTo`)은
  접촉 단계처럼 game-pack 재생 단계 번호다. `skill`은 skill 동작에만 쓴다.
- 기술의 접촉·예고 시간·자세 창 길이, 공격 섞기, `skill` 클립·`summon`·`shockwave` 두 개 한도는 계약 검사가 확인한다. 실패하면 아무것도 쓰지 않는다.
- 제출 전 서버 `/spec`에 `profile-lines-1`·`combat-style-1`·`extra-clips-1`이 있어야 한다. 없으면 제출 도구가 업로드 전에 멈춘다.

`fighter:pack`이 그림에서 재는 값:

- **크기.** idle 몸높이를 재서 400px가 아니면(2% 초과) 모든 동작을 같은 비율로 다시 맞춘다. 게임은 `actor 높이 / bodyHeight`로
  그리므로 이 값이 틀리면 선수 크기가 틀린다. 도트 그림은 계획에 `"resample": "nearest"`를 쓴다.
- **프레임.** 같은 픽셀의 칸은 하나의 프레임이 된다(멈춘 단계). 걷기 12~32칸·달리기 10~16칸은 서로 다른 칸이어야 하며,
  반복 칸이 있으면 채워 넣지 않고 거절한다.
- **기준점·접지.** 동작마다 지면선은 그 동작에서 가장 낮은 발바닥이다. 기준점은 game-pack anchor의 x와 그 지면선이다.
  접지는 지면선 바로 위의 불투명 열 묶음(최대 2개)이다. 계획의 `origin`으로 덮어쓸 수 있다.
- **보행 근거.** 기본 `reviewPolicy: files-only`는 보행·시각 품질 보고서를 요구하지 않는다. 이전 `required`·`engine-loop` 계획도 파일 검사만 한다.
  지정된 보고서는 원래 상태 그대로 진단 기록에 보관하고, 실패·누락·만료로 패키징을 막지 않는다.
- **보폭.** 계획의 `stridePixels` 게임 이동량을 보존한다. 없으면 사용 가능한 최신 측정값이나 실루엣 추정을 사용한다.
  추정 불가 시 게임 이동량(1~1600)을 설정하면 되며 새 보행 검수·시각 승인·재생성은 요구하지 않는다.
- **초상·미리보기.** idle 몸 윗부분의 정사각형과 idle 전체 칸. `profile.portraitCrop`·`previewCrop`으로 바꿀 수 있다.

계약 검사를 통과하지 못하면 아무것도 쓰지 않고 오류를 JSON Pointer로 알린다. 통과하면 폴더를 한 번에 만들고
전체 파일 검사까지 실행한다. `pack-report.json`에 잰 값, 동작별 원본 프레임 키, game-pack 이벤트(접촉 후보)를 남긴다.
잰 값은 출발점이다. 사용자에게 실제 동작을 보여 주고 발 교대·접지·공격 박자를 확인한 뒤 등록한다.

`examples/sparring-bot`과 `npm run example`은 **연결·형식 테스트 전용**이다.
사용자 캐릭터 생성 요청에 이 도형 로봇을 복사하거나 이름만 바꿔 납품하지 않는다.
형식 검사 통과만으로 동작의 시각 품질이 보장되지는 않는다. 실제 애니메이션을 검수한다.

## 4. 자기 계정으로 등록

Google 로그인 후 누구나 제작·업로드할 수 있다. **초대나 사전 승인은 없다.** [현재 운영 정책](OPEN-REGISTRATION.md)을 따른다.
ODDBOUT 통합 플러그인은 PC와 Dots 모두 현재 대화의 연결된 계정을 사용한다. `get_profile`로 계정을 확인하고
클라우드 `check_creation_readiness`, `prepare_fighter_registration`, `upload_fighter_asset`,
`submit_fighter_registration`, `get_fighter_submission`의 실제 스키마와 응답을 따른다.
작업 공간에 등록용 CLI 로그인을 요구하지 않는다. [통합 경로](ODDBOUT-PLUGIN.md)를 참고한다.
예전 독립 stdio 클라이언트에만 `AI_FIGHTER_CLIENT_CONFIG`와 `submit_fighter_package` 경로가 남아 있다.
연결된 클라우드 등록 실패를 다른 로컬 계정으로 자동 대체하지 않는다.
`registered`와 `fighterId`를 실제로 확인한다. 등록한 선수는 제작 중이다. 주인이 선수 페이지의 "모든 동작"에서 필수 동작 11개를 확인하고
출전해야 다른 사람의 컵·랭크 대결·공개 명단에 나온다. 에이전트는 동작을 보여주고 사용자가 요청할 때만 `enter_fighter`를 부른다.
작업자가 꺼져 있으면 자동 검증 대기로 남는다.
기존 선수의 불변 파일을 덮어쓰지 않는다. 부적절한 선수는 사후 조치로 공개 목록에서 내려갈 수 있다.

사용자 요청 예시:

> 이 AI Fighter 저장소의 sprite-gen으로 내가 설명한 인간형 격투가를 만들어줘.
> 제작 규격과 creation 안내를 읽고 내 계정에서 가능한 생성 경로를 확인해.
> 우선 원화 한 장만 보여줘. 나와 대화하면서 수정하고 외형을 정하자.
> 외형이 정해지면 대기·이동, 공격, 방어·피격 묶음으로 보여주고 묶음마다 내 피드백을 반영해줘.
> 최종 동작이 정해지면 fighter.json과 WebP를 검사해 내 계정에 등록하고 결과를 이 대화에서 알려줘.

sprite-gen은 Alex Kim의 [sprite-gen](https://github.com/aldegad/sprite-gen)을 포크해 모션 엔진을 더한
[sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent)의 고정 커밋을 서브모듈로 포함한다.
원본 Apache-2.0 [LICENSE](../vendor/sprite-gen/LICENSE)와 [NOTICE](../vendor/sprite-gen/NOTICE)를 보존한다.
