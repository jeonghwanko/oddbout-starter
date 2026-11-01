# AI Fighter 제작 안내

목표는 사용자가 설명한 **새 선수의 애셋과 `fighter.json`**을 만드는 것이다.
규격 ID는 `ai-fighter-side-v1`이다. 정확한 허용 필드와 한도는
[스키마](../contracts/ai-fighter/v1/fighter.schema.json)와
[spec](../contracts/ai-fighter/v1/spec.json)이 소유한다.
규격 조회 뒤 작업 중에는 같은 버전을 사용한다.

Dot은 먼저 `get_fighter_spec`의 `creation`과 [사용자별 제작 흐름](DOT-CREATION.md)을 읽는다.
현재 대화의 외형 시안은 [표시·전달 확인](DELIVERY.md)을 먼저 따른다. 지원되는 직접 생성·표시에는 PC가 필수가 아니다.
로컬 생성·동작 제작은 이 저장소의 `vendor/sprite-gen`과 사용자의 구독 계정을 사용한다.
도형 테스트 샘플은 생성 결과로 납품하지 않는다.

연결된 서버의 `get_fighter_spec` 응답에서 `registration.available`을 확인한다.
오프라인 계약은 `false`, 서버 연결 시에는 `true`다. Google 로그인 후 초대 없이 제출한다. 서버 파일 검사를 통과한 선수는 제작 중으로 시작하고, 주인이 필수 동작 11개를 확인해 출전한 뒤 다른 사람과 겨룬다. [현재 정책](OPEN-REGISTRATION.md)을 따른다.

## 제작 흐름

기본은 [대화하며 한 단계씩 만들기](DOT-CREATION.md#0-대화하며-한-단계씩-만들기)다.
외형, 대기·이동, 공격, 방어·피격, 최종 확인의 다섯 묶음으로 진행한다. 게임 문맥에 있으면 방어·피격 뒤에 선택 묶음(싸우는 성격·고유 기술)을 한 번 제안한다.
묶음 안에서는 생성·검수를 이어서 처리하고 결과를 함께 보여준 뒤 피드백을 기다린다. 동작마다 진행 허락을 묻지 않는다.
피드백 단계를 건너뛰는 것은 사용자가 위임한 범위에 한한다.

보행의 실행 절차와 새 명령은 [GAIT-REVIEW.md](GAIT-REVIEW.md)를 따른다. sprite-gen 설치가 모든 동작의 자동 검수 통과를 뜻하지 않는다.
공통 좌표·중립 기준 배율, 프레임별 지지발 계획과 양발의 접지 측정은 선택적인 품질 진단이다.
fighter:pack은 필수 파일·규격 검사만 요구한다. walk/run 수치와 시각 검수의 실패·미확인은 기록으로 보존하며 포장을 막지 않는다.
GPT walk/run은 실제 보행 가이드와 검수한 핵심 자세를 참조로 전달한다. `fighter:gait init`의 핵심 자세 요청부터 시작하고,
양발·골반 연결·몸 전체 움직임을 확인한 뒤 `bind-keyposes`로 전체 요청에 연결한다. 행 추출은 `ground_frames: false`로
공중 높이를 보존한다. 생성 완료와 보행 합격은 별개이며, 같은 오류가 두 번 반복되면 임의 합성으로 이어가지 않는다.

1. 사용자가 원하는 실루엣, 복장, 색, 장비를 파악한다. 다음 시안에 필요한 누락 정보만 묻고, 이름·소개는 나중에 정해도 된다.
2. 생성과 현재 대화의 표시·전달 경로를 각각 확인한 뒤 오른쪽을 향한 정사영 측면 전신 원화 한 장을 만든다.
   로컬 경로는 포함된 sprite-gen을 사용한다. 기존 결과가 있다면 회수·전달부터 한다.
   카메라 고도는 16도다. 원화를 보여주고 사용자 피드백을 반영해 외형을 정한다.
   선택한 원화로 전투 대기·걷기·달리기를 함께 만들어 이동감을 확인하고, 공격과 방어·피격 묶음을 차례로 진행한다.
   같은 원화의 정체성을 유지하며 묶음별 생성·검수·미리보기·피드백을 반복한다. 수정은 영향을 받은 결과에 한정한다.
3. 각 동작을 투명 배경의 **정적 WebP** 시트로 내보낸다. 움직이는 WebP, GIF, 영상, SVG는 제출 형식이 아니다.
4. 프레임·기준점·접지·시간·접촉 단계와 보조 자세를 측정한다.
5. 같은 선수의 초상과 전신 미리보기 crop을 연결한다.
6. 최종 파일에서 실제 바이트 크기, 이미지 크기, SHA-256을 계산한다. 수치를 추측하지 않는다.
7. `validate_fighter_manifest`에 원문 JSON을 넣고 오류를 수정한다.
8. `validate_fighter_package`에 작업 폴더 아래 상대 경로를 넣어 실제 파일까지 검사한다.
9. 사용자가 등록을 요청했고 본인 계정이 연결되어 있으면 `submit_fighter_package`로 같은 패키지를 제출한다.
   UUID 형식의 `idempotencyKey`를 저장하고 재시도에도 같은 값을 사용한다. 파일을 바꿨으면 새 초안이다.
10. `get_fighter_submission`으로 결과를 조회한다. `registered`와 `fighterId`를 받은 뒤 등록 완료로 안내한다.
    `runtimeApproved: true`이면 이용 가능하다. 등록 후 false라면 사후 이용 제한 여부를 확인한다. 작업자가 꺼져 있으면 자동 검증 대기로 남는다.
    `pending`이 빈 배열이면 최종 상태다. 더 조회하지 않는다.
    `rejected`이면 `validation`의 오류를 고친다. 고친 패키지는 새 초안이므로 새 키로 제출한다.
    `code: "upload-expired"`는 24시간 안에 업로드를 끝내지 못한 제출이다. 새 키로 다시 제출한다.

로컬 이미지 생성·애니메이션 제작은 포함된 sprite-gen을 사용자가 지정한 작업 환경에서 실행한다. 지원되는 직접 대화 외형은
[DELIVERY.md](DELIVERY.md)를 따른다. 대화 모델·CLI 작업 모델·이미지 백엔드는 구분하며 로그인·모델명만으로 생성 성공을 기록하지 않는다.
이 MCP는 이미지를 생성하지 않는다.
호스트에 필요한 도구가 없으면 그 제한을 알린다. 기존 샘플의 이름만 바꿔 새 선수라고 제시하지 않는다.

## 패키지

```text
output/my-fighter/
  fighter.json
  assets/
    idle.webp
    walk.webp
    ...
```

`assets/<소문자-이름>.webp`만 허용한다. 외부 URL, 절대 경로, 상위 경로, 심볼릭 링크를 사용하지 않는다.
JSON에 있는 모든 애셋은 적어도 하나의 클립이나 프로필에서 참조해야 한다.
MCP 파일 경로는 `AI_FIGHTER_ROOT`를 기준으로 `output/my-fighter/fighter.json`처럼 지정한다.
파일 검사 중에는 패키지를 변경하지 않는다.

| 필드 | 의미 |
| --- | --- |
| `schemaVersion`, `specVersion` | JSON 구조와 제작 계약 버전 |
| `localId` | 로컬 작업 식별자. 서버 선수 ID가 아니다 |
| `profile` | 이름, 소개, 초상·미리보기의 애셋 ID와 crop |
| `profile.language`, `profile.concept`, `profile.moves` | 선택. 작성 언어(`ko`·`en`), 컨셉(세계관, 800자), 표준 동작 `combo`·`slam`·`dash`·`block` 네 개의 기술 이름(24자)·설명(160자). 넣을 때는 네 개 모두 넣는다 |
| `combat.kitId` | `standard-duel`. 서버가 관리할 규칙의 예약 ID |
| `profile.lines` | 선택. 경기 전 도전 대사 `challenge`, 경기 뒤 승리 대사 `win`·패배 대사 `lose`(각 40자, 하나 이상). 무투장 말풍선에만 쓴다 |
| `combat.stats` | 선택. 능력치 등급 `power`·`toughness`·`speed`, 각 1–5, 합은 정확히 9. 없으면 모두 3이다 |
| `combat.style` | 선택. 싸우는 성격. 닫힌 선택지와 작은 등급만 고른다([계약 안내의 Fighting style](../contracts/ai-fighter/v1/README.md#fighting-style)). 없으면 표준 키트 그대로다 |
| `appearance` | 정사영, 16도, 오른쪽 원본, 왼쪽 반전, 몸높이 400, 배율 1 |
| `assets` | 실제 파일의 ID, 경로, MIME, SHA-256, 바이트, 너비·높이 |
| `clips` | 필수 동작과 [선택 동작](#선택-동작)의 시트, 프레임, 기준점, 시간, 접촉 표식 |

허용하지 않은 필드는 거절한다. 소유자 ID, 선수 ID, 승인 상태, HP, 피해, 사거리, 실행 코드는 서버가 소유한다.
`combat.stats`는 등급 배분일 뿐이다. 서버가 등급을 자체 수치로 바꾸고, 등록 선수끼리의 AI 대결에만 쓴다.
`combat.style`도 수치가 아니다. 공격 섞기(`mix`)·특수(`special`)·필살기(`super`)·교전 거리(`distance`)·충격파(`shockwave`)·소환물(`summon`)·
기질(`temper`)·교전 성향(`exchanges`)을 고르면 서버가 자체 수치로 바꾼다. `skill` 클립·`summon`·`shockwave`는 합쳐서 두 개까지다.
성격·소개·컨셉·기술 이름은 표시용 데이터다. 새 동작을 만들거나 AI나 게임에 실행을 지시하는 문장이 아니다.
새 필드는 서버의 `/spec` `features`에 해당 기능이 있을 때만 제출한다. 없으면 제출 도구가 업로드 전에 멈춘다.
`language`·`concept`·`moves`는 `profile-extras-1`, `profile.names`는 `profile-names-1`, `profile.lines`는 `profile-lines-1`,
`combat.stats`는 `combat-stats-1`, `combat.style`은 `combat-style-1`, 선택 동작 `skill`·`entrance`·`victory`는 `extra-clips-1`이다.
계정당 선수는 최대 3명이다. 새 선수 등록 시 `fighterId`를 생략하고, 기존 선수를 수정할 때만 해당 ID를 지정한다. 나중에 컨셉·기술 이름·능력치·원화를 바꾸려면 다시 패키징해 같은 선수의 `fighterId`로 제출한다(`submit_fighter_package`의 `fighterId`). 선수 ID와 전적은 유지되고, 지난 경기는 당시 패키지 기준 기록으로 남는다.
`standard-duel`을 선택해도 경쟁 규칙의 통합이나 서버 연결이 완료되지는 않는다.

## 좌표와 프레임

- 몸높이 기준은 400픽셀이다. 동작마다 키를 다시 정의하지 않는다. 셀 높이는 몸높이와 다를 수 있다.
- 서버가 `texture-resolution-1`을 제공하면 `fitSheets`로 큰 시트를 맞출 수 있다. 프레임·시간을 유지하며 해당 동작의
  픽셀·기준점·접지·이동 거리를 같은 비율로 줄이고 `pixelScale`에 기록한다. 게임은 몸높이 기준도 그 비율로 보정해
  표시 크기를 유지한다. 원본은 보존하며 새 패키지만 만든다. 파일 바이트·픽셀 한도는 그대로 검사한다.
- 같은 시트의 모든 셀 크기는 같다. `width = frameWidth × columns`, `height = frameHeight × rows`다.
- `frames`는 `[0,1,...]`이며 위쪽 줄부터 왼쪽→오른쪽 순서다. 줄 끝 미사용 셀은 비어 있어도 된다.
- `origins[i]`는 셀 왼쪽 위 기준 `originX`, `originY`다. 셀이 달라져도 발의 세계 좌표가 튀지 않도록 측정한다.
- `groundContacts`는 지면에 닿는 타원의 중심 `x,y`와 반경 `rx,ry`다. 공중은 빈 배열이다.
  빈 배열을 쓰거나 범위 검사에 통과했다는 사실만으로 접지가 올바르다고 판단하지 않는다.
- `profile.portrait`, `preview`는 `{ assetId, crop: { x, y, width, height } }`다.
  crop 좌표는 셀이 아니라 전체 이미지 기준이다. 범위 밖이나 완전히 투명한 crop은 거절한다.
- 같은 체형·복장·색을 모든 동작에서 유지한다. 왼쪽은 반전하므로 문자·문양도 이를 고려한다.

## 필수 동작

| 동작 | 내용 | 시간·표식 |
| --- | --- | --- |
| `idle` | 정지 전신 1칸 | `durationMs` |
| `walk` | 양발이 교대하는 16칸 | `durationMs`, `stridePixels` |
| `run` | 달리기 12칸 | `durationMs` |
| `fightIdle` | 전투 준비 반복 | `sequence`, 접촉 없음 |
| `combo` | 준비·연타·회수 | 접촉 최소 3개, `landmarks.spinStart` |
| `slam` | 강타 | 접촉 1개 |
| `dash` | 돌진 | 접촉 0~1개, `windup`, `recover` 보조 자세 |
| `block` | 가드·막기 | 접촉 1개. 직전 단계가 유지 가드 |
| `hit` | 피격·비틀거림·복귀 | 접촉 1개, `recoil`, `stagger`, `recover` |
| `groggy` | 흔들림 반복 | 접촉 없음 |
| `fall` | 넘어짐·누움 | 접촉 1개, `lieSequenceIndex`, `getUp` |

`idle`·`walk`·`run`의 `durationMs`는 **한 칸**의 시간이다. 한 주기는 `durationMs × 칸 수`이고 10초 이하다.
예: `walk` 16칸이면 칸당 625 ms 이하다.

`sequence`는 `{ frame, durationMs }` 배열이다. 같은 프레임을 반복할 수 있다.
`hitSequenceIndices`는 **이미지 프레임 번호가 아니라 재생 단계 번호**다. 0보다 크고 오름차순이어야 한다.

- `combo.spinStart`: 마지막 세 접촉의 첫째 뒤, 둘째 이하인 단계.
  둘째·셋째 접촉 인덱스 평균의 내림값이 `spinStart`보다 커야 세 구간을 분리할 수 있다.
- `hit.recoil`: 접촉 단계와 같다. `stagger`와 `recover`는 양끝을 포함하는 단계 쌍이다.
  `recoil ≤ stagger[0] ≤ stagger[1] < recover[0] ≤ recover[1]` 순서다.
- `dash.windup`, `recover`: `{ clip, frame }`으로 같은 선수의 다른 전투 자세를 참조한다.
  여기의 `frame`은 **참조 클립의 이미지 프레임 번호**다.
- `fall.lieSequenceIndex`: 착지 이후 누운 단계. 마지막 단계도 그 누운 프레임으로 끝난다.
  `getUp`은 `{ clip, frame, durationMs }` 배열이다. 일어서기의 합산 시간도 10초 이하다.

접촉 표식은 그림의 박자다. 실제 공격 횟수·피해·판정 시간은 신뢰된 게임 규칙이 정한다.

## 선택 동작

필수 동작 밖에 세 동작을 더 넣을 수 있다(`spec.json` `optionalClips`). 형식과 시간 규칙은 필수 전투 동작과 같다.

| 동작 | 내용 | 시간·표식 |
| --- | --- | --- |
| `skill` | 고유 기술 한 동작: 예고·접촉(또는 돌진, 자세 창)·회수 | 접촉 0~1개, `skill.kind`와 표식 |
| `entrance` | 경기 시작 전 제자리 등장 | 접촉 없음 |
| `victory` | 이긴 뒤 승리 자세 반복 | 접촉 없음, 반복 |

- `skill.kind`는 `stretch`·`pincer`·`flight`·`feint`·`slide`·`counter`·`brace` 가운데 하나다. 기술의 규칙 수치는 서버가 정한다.
- `stretch`·`pincer`는 접촉 1개이고 첫 접촉이 360 ms 이후에 시작한다.
- `flight`·`feint`·`slide`는 `skill.windupTo`(예고가 끝나는 단계) < `skill.recoverFrom`(회수가 시작하는 단계)이고 `windupTo`가 240 ms 이후에 시작한다.
  선택 표식 `run`(돌진 동안 번갈아 그릴 두 단계), `launch`, `struck`도 재생 단계 번호다.
- `counter`(반격)·`brace`(버티기)는 접촉 1개이고 `skill.windowFrom` < `windowTo` ≤ `strikeFrom` ≤ 접촉 < `strikeTo`다.
  `windowFrom`..`windowTo`가 자세 창(200~1000 ms), `strikeFrom`..`strikeTo`가 쳐내는 구간이며 `windowFrom`은 100 ms 이후에 시작한다.
- 자세한 뜻과 오류 코드는 [계약 안내의 Optional clips](../contracts/ai-fighter/v1/README.md#optional-clips)를 따른다.
샘플 로봇은 파일 형식 시험용이다. 넘어짐·연타 등의 연기 품질을 보여주는 작품이 아니다.

## 검사 결과 읽기

`ok`, `stage`, `errors`, `pending`을 읽는다. 오류의 `path`는 JSON Pointer다.
전체 스키마·예제는 크다. 동작 하나를 고칠 때는 `get_fighter_spec`에 `motion`(예: `walk`)을 넘겨 그 부분만 읽는다.
파일 검사는 한 번에 하나만 실행하고 최대 2개가 기다린다. 그보다 많으면 `VALIDATOR_BUSY`이므로 잠시 뒤 다시 요청한다.
MCP는 오류를 최대 50개까지 돌려주며 더 많으면 `errorCount`를 포함한다.
명령행 검사는 성공 시 0, 검증 실패 시 1, 사용법 오류 시 2를 반환한다.

`metadata-only` 통과는 파일의 존재·해시·디코딩 통과가 아니다.
전체 파일 검사도 발 교대, 캐릭터 정체성, 접지, 실제 전투 재생, 공정성, 등록을 보증하지 않는다.
베타 서버는 업로드된 불변 파일을 별도 작업자에서 다시 검사한다. Dot의 로컬 통과 보고를 승인 근거로 사용하지 않는다.
