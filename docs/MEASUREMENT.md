# 호스팅 생성 측정

> 호스팅 제작이 실제로 나아졌는지 숫자로 본다. 1단계(2026-10-29): 계측 보강과 읽기 전용 export.
> 아직 표본이 적다. 실제 호스팅 작업 몇 건으로 낸 비율은 방향만 보여 주고, 어떤 개선의 효과로 말하지 않는다.

## 무엇을 기록하나

| 출처 | 내용 |
|---|---|
| `af_generation_events` | `appearance-answer`(a/b 선택 또는 수정 요청), `motion-answer`(수정 요청한 클립), `register`, `cancelled`, `claimed`·`finished`(단계 시작·끝) |
| `versions` 이벤트(이번에 추가) | 워커가 단계를 시작할 때 보낸다: 킷 커밋(`kit`), 엔진 커밋(`engine`), 단계가 **요청한** 모델(`requested`: 텍스트 `text`, 이미지 에이전트 `imageAgent`, 판정 `judge`·`judgeEffort`, 영상 `video` — 호스트가 정하지 않아 `engine-default`). 읽지 못한 커밋은 `null`. 2026-11-05 전에는 같은 상수를 `image`·`text`로 보냈다. 관측한 모델이 아니다 |
| `models` 이벤트(2026-11-05) | 단계가 끝날 때 보낸다: 실행 종류(`role`: `brief`·`judge`·`image`·`video`)마다 요청한 모델(`requested`, 판정은 `requestedEffort`)과 **관측한** 모델(`observed`)·추론 강도(`effort`)·codex CLI(`cli`), 횟수 `n`. 관측은 codex가 그 세션 기록(rollout의 `turn_context`)에 남긴 값이고, 이미지는 sprite-gen 보고서가 세션에서 읽은 에이전트 모델(`model_source` rollout·state-db일 때만)이다. codex 이미지 도구 뒤의 이미지 모델(`imageModel`)과 Grok 영상 모델은 기록되지 않아 언제나 `unknown`이다. 요청한 값을 관측 칸에 베끼지 않는다. 2000바이트를 넘으면 뒤의 종류부터 뺀다(`more`) |
| `gait` 이벤트(2026-10-29) | 걷기·달리기 갈래가 끝날 때마다: 결과(`ok`·`review`·`retry`)와 코드, 통과한 테이크, 시도한 컷마다 거절 사유(엔진) 또는 판정이 떨어뜨린 항목과 찍힌·낸 칸 수(`from`·`frames`), 박자 jolt, RIFE가 만든 칸 수. 2000바이트를 넘으면 오래된 컷부터 뺀다(`more`) |
| `finished.calls`(이번에 채움) | 그 단계에서 og로 돈 명령별 `[실행 수, 실패 수, 초]`(`sprite gen`, `sprite video-set`, `codex` …). 12개 명령까지 이름을 남기고 나머지는 `other`로 합친다(이벤트 2000바이트 제한) |
| `af_decision_reviews` | 범위(design·look-a·look-b·walk·run)별 Decisions 리포트 |
| 호스트 장부(`og report --json`) | 실행마다 제공자, 걸린 시간, 칸 대기, 종료 코드, codex 세션 수. 작업 폴더 이름(`YYYYMMDD-gen-<id>`)으로 DB 작업과 잇는다 |
| 작업 열(2026-10-30, 첫 선수 무료) | 만드는 곳(`hostChoice`), 맡기기, 외형 그림이 나온 시각(`chargedAt`, 무료권 소진), 돌려줌(`refunded`), 공식 호스트가 시작한 시각(`startedAt`, 대기열 끝), 계정 표지(`ownerKey`), 가입에서 신청까지 시간 |
| 선수(2026-10-30) | 등록된 선수의 출전 시각, 출전 뒤 7일 안의 대결 수(`af_duels`), 컵 전적 합(`af_arena_fighter_totals`가 같은 DB에 있을 때만, 시각 없음) |
| 원가표(`scripts/cost-table.json`, 선택) | og 명령마다 운영자가 적은 추정 단가(`perRun`·`perMinute`)와 구독 월액(`monthly`). 값이 `null`인 명령은 값을 매기지 않고 `unpriced`에 이름만 남긴다 |

`ownerKey`는 이 export 안에서만 같은 계정을 가리키는 번호다(뽑은 작업의 계정 순위). 계정 ID·메일·그 해시가 아니고, 다시 뽑으면 바뀐다.
`ownerKey`가 없는 옛 export는 첫 선수 무료 숫자(`freeFunnel`·`participationRate`·`signupToRequestHours`)에서 아무것도 세지 않는다.

신청자의 글(요청·수정 메모·브리프·프로필)과 그림은 export에 들어가지 않는다.

## 숫자

| 숫자 | 뜻 |
|---|---|
| `appearanceFirstChoice` | 첫 외형 답이 수정이 아니라 선택인 비율(분모: 외형에 답한 작업) |
| `motionFirstAccept` | 첫 모션 미리보기 뒤 수정 없이 등록한 비율(분모: 첫 모션 미리보기에 답한 작업) |
| `clipRevisions` | 클립별 수정 요청 수와, 모션 미리보기까지 간 작업당 비율 |
| `revisionsPerRegistered` | 등록한 작업의 외형+모션 수정 횟수 |
| `failureOrReviewRate`, `failureCodes` | `failed`·`needs_review`로 끝난 비율과 그 코드(최종 상태만 본다) |
| `stageReviews` | 단계가 운영자 검토로 멈춘 횟수(`finished`의 `outcome: review`). 작업이 결국 등록돼도 센다. 코드별·단계별, 멈춘 작업 비율 |
| `stageRetries` | 단계가 다시 시도로 끝난 횟수와 코드(`provider-asks` 등) |
| `operatorRetries`, `operatorWaitMinutes` | 운영자가 다시 돌린 횟수와, 검토로 멈춘 뒤 운영자가 다시 돌리기까지 걸린 시간 |
| `cancelledAfterReview` | 검토로 멈췄다가 취소된 작업 수 |
| `delegated` | 맡기기 작업 비율(`created`에 `delegate`가 없는 오래된 작업은 분모에서 뺀다)과 워커가 외형을 고른 횟수 |
| `abandonRate` | 미리보기까지 간 작업 중 취소·만료된 비율 |
| `stageMinutes`, `claimsPerStage` | 단계별 기계 시간(claimed→finished)과 단계당 시도 수(재시도·임대 만료 포함) |
| `userWaitMinutes`, `minutesToRegister` | 미리보기에서 답(또는 취소)까지, 신청에서 등록까지 |
| `calls`, `providerRunsPerRegistered` | 명령별 실행·실패·시간, 등록 1건당 제공자 실행 수(장부가 있을 때) |
| `gaits` | 걷기·달리기별: 갈래 수와 결과·코드, 통과한 테이크 분포, 걸음으로 만든 달리기 수, 컷 거절 사유(`frames-<n>`은 `frames-out-of-range`로 묶음), 판정이 떨어뜨린 항목, 찍힌·낸 칸 수 분포, jolt |
| `decisions` | 리뷰 수, 상태별·범위별 수, 입력 토큰 |
| `freeFunnel` | 계정마다 센다. ODDBOUT 작업(`hostChoice`가 `oddbout`)이 하나라도 있는 계정이 신청이다. 그 계정의 ODDBOUT 작업 가운데 하나라도 닿은 단계로 센다: 외형 그림(무료권 소진) → 동작 미리보기 → 등록 → 출전 → 출전 뒤 7일 안 경기. 첫 작업이 취소돼도 둘째가 등록되면 등록이다. 자기 PC·다른 호스트 작업은 세지 않는다 |
| `participationRate` | 선수를 출전시킨 계정 가운데, 출전한 선수가 7일 안에 대결하거나 컵 전적이 있는 계정의 비율 |
| `queueWaitHours` | ODDBOUT 작업이 공식 호스트가 시작할 때까지 기다린 시간(하루 토큰 예산을 다 쓰면 다음 UTC 00:00까지 길어진다). 시작한 작업만 센다: 아직 기다리는 작업과 시작 전에 취소된 작업은 빠져서 실제보다 짧게 나온다. 계정이 아니라 작업마다 센다. 짧은 대기도 들어간다 |
| `signupToRequestHours` | 계정마다 첫 ODDBOUT 신청이 가입 뒤 얼마 만에 왔나 |
| `cost` | 원가표가 있을 때만: ODDBOUT 구독으로 돈 작업의 추정 원가 합(`total`), 외형이 나온 작업당 분포(`perJob`), 등록 1건당·출전 1건당(`perRegistered`·`perEntered`, 버린 작업 포함), 외형 뒤 취소·만료로 버린 원가(`wasted`), 시작한 작업당 구독 월액 몫(`subscriptionPerStarted`), 값을 매기지 않은 명령(`unpriced`) |

`cost.complete`는 돈 명령이 모두 값을 가졌으면 `true`다. 값이 없는 명령(`null`)이 하나라도 돌았으면 `false`이고, 합이 실제보다 낮게 나와 최종값처럼 읽히므로 `total`·`perJob`·`perRegistered`·`perEntered`·`wasted`를 `null`로 둔다. 원가표를 채운 뒤에 읽는다.
`subscriptionPerStarted`는 구독 월액을 export 기간만큼 나눠 시작한 작업 수로 나눈다. 전체(`all`)에만 있고 킷별(`byKit`)에서는 `null`이다. 월액 전체를 킷 하나의 작업에 얹으면 부풀기 때문이다.

`participationRate`와 `played7d`의 대결은 완료된 대결 전부다. 주인이 직접 건 대결도 들어간다. 데이터에는 이를 가르는 값이 없다. 그래서 이 비율은 다른 사람이 선수를 만났다는 증거가 아니라 선수가 경기에 나왔다는 신호로 읽는다.

모든 숫자는 전체(`all`)와 킷 커밋별(`byKit`)로 나온다. `versions` 이벤트가 없던 작업은 `unknown`이다.

## 사용자 판정 라벨 (`clip-labels.jsonl`)

클립 단위의 약한 라벨이다. 모션 클립의 버전은 그 클립에 앞서 요청된 수정 횟수다.

- 수정 요청을 받은 버전은 `rejected`, 등록 시점의 버전은 `accepted`이다. 등록하지 않은 작업의 클립은 라벨이 없다.
- 외형 두 장을 모두 돌려보낸 회차는 둘 다 `rejected`, 고른 쪽은 `accepted`, 안 고른 쪽은 `not-chosen`(취향일 수 있어 결함으로 세지 않는다)이다.
- 그 버전을 본 Decisions 리뷰가 있으면 `review`(결함·clear·unverified 수)가 붙는다. 리뷰 시각 이전의 수정 횟수로 버전을 맞춘다.

`screening`은 "결함 있음"이 사용자의 반려와 얼마나 맞았는지(`detectionRate`)와 승인된 클립을 얼마나 막았을지(`falseBlockRate`)를 센다.
사용자는 결함 말고 취향으로도 돌려보내고, 작은 흠이 있어도 받아들인다. 그래서 이 값은 Decisions의 질문 단위 정확도가 아니고,
차단 규칙의 근거도 아니다. 질문 단위 평가는 독립 라벨과 `sprite-gen evaluate-decisions`로 한다(2단계).

## 뽑는 법

1. Supabase SQL 편집기(또는 psql)에서 [`scripts/measure-export.sql`](../scripts/measure-export.sql)을 실행하고, 결과 한 칸을 `db.json`으로 저장한다.
   기간은 SQL의 `w`에서 바꾼다(기본 30일). 편집기의 JSON 내려받기(`[{"export": …}]`)도 그대로 읽는다.
2. 호스트 장부(선택): `sudo -u oddbout-gen /srv/oddbout-gen/bin/og report --json > ledger.json`
3. `node scripts/measure-export.mjs --db db.json --ledger ledger.json --costs scripts/cost-table.json --out-dir output/measure-YYYYMMDD`
   (`--costs`는 선택. 원가표는 운영자가 대강 정한 값이다(2026-10-30, 근거는 표의 `basis`). 구독은 정액이라 이 값은 청구서가 아니라 추정이다.
   `perRun`은 구독을 하루 한도까지 다 쓸 때의 작업당 원가이고, `subscriptionPerStarted`는 실제로 시작한 작업 수에 나눈 구독 몫이다.
   단계별 실행 수(`calls`)는 2026-10-29 작업자부터 남으므로 그 전 작업의 `perRun` 원가는 0으로 나온다)

`kpis.json`과 `clip-labels.jsonl`이 나온다. 스크립트는 어디에도 접속하지 않는다.

## 다음 단계

- 2단계: 수정 메모를 결함 유형(해부·정체성·루프·접지·스타일·기타)으로 태깅하는 시트, 질문 단위 독립 라벨 시트,
  라벨을 `sprite-gen-decision-eval` 데이터셋으로 바꾸는 빌더.
- 3단계: 주간 리포트, 판정 규칙을 차단으로 올리는 기준(test 분할의 검출률·오차단율).
