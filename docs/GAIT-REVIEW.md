# 보행 설계와 등록 전 검수

sprite-gen은 이 저장소의 `vendor/sprite-gen`에 고정된 [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent) 커밋으로 설치된다.
모션 엔진은 그 커밋에 들어 있다. `npm run sprite:setup`은 고정 커밋을 받아 설치하며, 알 수 없는 로컬 수정은 덮어쓰지 않는다.
설치만으로 모든 검수가 자동 실행되는 것은 아니다.
추출·아틀라스 검사, `qa-motion.md`의 시각 검수 절차, `inspect-motion`의 조건부 접지 측정이 각각 있다.
이 저장소의 `fighter:gait`는 이 결과를 한 흐름으로 연결하고, `fighter:pack`은 기본적으로 현재 walk/run과 일치하는 검수 결과를 요구한다.
서버 파일 검사는 형식·파일 무결성 검사다. 캐릭터의 양발을 자동 인식하거나 시각 품질을 승인하는 기능으로 설명하지 않는다.

### 영상 주기의 프레임 수와 기본 검수

게임의 `gait-frames-1` 계약은 걷기 12~32장, 달리기 10~16장의 서로 다른 프레임을 받는다.
`spec.motions.*.frames`의 16/12는 제작 기본값이며, 영상에서 추출한 한 주기를 이 수로 맞추려고
프레임을 버리거나 복제·보간하지 않는다. 원본 주기의 프레임과 동일한 프레임당 재생 시간을 보존한다.
아래 GPT 포즈·행 생성의 16/12 계획은 그 경로의 기본값이다.

Dots의 기본 `required` 검수도 이 범위를 사용한다. 계획의 `phases`는 실제 N개 프레임에 하나씩 대응해야 하며
`index: i`, `phase: i / N`, 해당 프레임의 지지 상태를 적는다. 다른 길이의 계획을 그대로 재사용하거나
지지·공중 상태를 단순 반주기 공식으로 관찰한 사실처럼 채우지 않는다. 실제 양발 접지 측정과
외형·해부·발 교대·루프 시각 검수는 그대로 필요하며, 불확실한 근거는 미검증으로 남긴다.
최종 game-pack의 픽셀과 재생 시간이 바뀌면 다시 검수한다. `engine-loop`나 `format-only`로 우회하지 않는다.

## 1. 원화와 공통 좌표를 고정

### AI 생성 전 연속 보행 가이드

`npm run sprite -- gait-guide --profile vendor/sprite-gen/examples/gait-mocha.json --out-dir output/mocha-gait-01`
명령은 AI 호출 없이 위상·2관절 IK·월드 좌표 발 고정으로 걷기16/달리기12 가이드를 만든다.
상세 계약은 [gait-guide](../vendor/sprite-gen/docs/gait-guide.md)에 있다.
모카 예제의 체형·보이지 않는 관절 깊이는 명시적으로 설계한 근사값이며 원화 복원 결과가 아니다.
기준점별 독립 자세 대신 연속 시간 궤적을 샘플링하고, 접지 동안 발은 월드에 고정한다.
몸을 따라가는 카메라에서는 접지발이 화면에서 뒤로 움직여야 하며 바닥 눈금과 함께 확인한다.
실제 깊이로 가려진 부위와 X-ray 표시를 구별하고, 양발 반 주기 교대·이중 지지/공중 구간·
고정 다리 길이·미끄러짐·루프 및 래스터 가려짐 보고서를 확인한다.
이 결과는 가이드 전용이다. 승인 외형이나 AI 출력 검수값으로 대체하거나 자동으로 생성하지 않는다.

v7부터 `screen_audit`는 최종 카메라 배율에서 달리기 두 반주기 각각에 양발 이격>=4px인
샘플이 있는지 검사한다. canonical16/12프레임 통과를 다른 FPS 영상에 재사용하지 말고 실제
timestamp도 검사한다. 4px는 설계 허용치이며 생성 성공 보장이 아니다. 전후 발은 각자의
투영 지면을 사용한다. 낮은 전환 프레임을 삭제하거나 하단 정렬해서 통과시키지 않는다.
투영 통과 후에도 실제 raster의 발 윤곽·가려짐·재출현을 확인한다.

고객 기본 경로는 이미 보유한 한 생성 구독을 기준으로 설계한다. VACE/ComfyUI 원격 실험을
추가 구독·GPU 설치가 필요한 기본 해결책으로 바꾸지 않는다. 최신 문제/근거는
[모카 연구 인수인계](research/MOCHA-LOCOMOTION-HANDOFF.md)에 정리했다.
영상 디코더 비교는 저장한 동일 latent로 분리하고, 재diffusion으로 다른 영상을 만든 뒤
디코더 효과라고 해석하지 않는다. 가이드·생성·디코더·검수 실패를 구분해 기록한다.
발목 롤·발끝 밀기·동역학적 균형은 아직 모델링하지 않는다.

중립 전신 원화에서 외형·머리 크기·팔다리 길이·시점·팔레트를 확정한다. 같은 제작 묶음은 같은 셀 크기, 여백, 기준점과 물리적 배율을 사용한다.
중간 프레임마다 `safe_margin_y`를 바꾸거나 각각 다른 크기로 맞추지 않는다. 서로 다른 실행의 그림을 합치면 공통 좌표와 체형을 다시 확인한다.

GPT 보행의 painted-art 행은 `fit.ground_frames: false`, `pixel_unfake: false`를 사용한다.
패치된 추출기는 컴포넌트를 자르기 전 원본 Y 좌표를 유지하고 행 전체에 하나의 배율과 수직 이동을 적용한다.
이것은 원본 움직임 보존이며 접지 증명이 아니다. 원본 높이 오류도 그대로 드러나므로 검수에서 거절한다.
프레임마다 바닥을 맞춰 오류를 숨기거나 달리기·점프의 공중 자세를 접지시키지 않는다.

한 자세의 외곽 높이는 캐릭터의 서 있는 키와 다르다. 웅크림·넘어짐·팔 뻗기마다 높이를 400px로 다시 맞추지 않는다.
공통 좌표로 제작된 결과는 중립 자세에서 잰 키를 모든 동작에 사용한다. 다음 명령은 같은 캔버스인지 검사하고 기준 키를 한 번만 측정한다.
서로 다른 크기로 그려진 캐릭터를 캔버스 크기만 같게 만든 것은 공통 배율이 아니므로 시각 검수가 여전히 필요하다.

```json
{
  "reference": { "file": "sprites/manifest.json", "state": "idle", "frame": 0 },
  "assets": [
    { "id": "cat-idle", "source": { "file": "sprites/manifest.json", "state": "idle" } },
    { "id": "cat-walk", "source": { "file": "sprites/manifest.json", "state": "walk" } }
  ]
}
```

```sh
npm run fighter:gait -- game-request common-scale.json game.json
npm run sprite -- game-pack --request game.json --out-dir pack
```

GPT는 한 행의 자세를 각각 따로 그리기 때문에 같은 배율로 맞춘 행에서도 자세마다 몸이 2~20% 커지거나 작아지고,
따로 맞춘 행끼리는 더 벌어진다(걷기 0.83배, 달리기 1.2배). 등록 파이터는 게임이 크기를 보정해 주지 않으므로 그대로 보인다.
그래서 `game-request`는 먼저 sprite-gen [`scale-check`](../vendor/sprite-gen/docs/scale-check.md)로 모든 프레임의 몸 크기를
기준 프레임과 **머리 크기로** 비교한다(웅크림·팔 뻗기는 크기로 읽지 않는다). 소스 파일마다 그 파일에서 쓰는 상태만 재고,
결과는 `game.scale-check.json`과 검토 보드 `game.scale-check.png`다(소스 파일이 여럿이면 `game.scale-check-1.json`…).
요청의 각 항목에 `scale_check`가 붙어 game-pack이 프레임마다 발 기준점으로 크기를 되돌린다.
걷기·달리기(상태 이름에 walk·run·jog·sprint가 낱말로 들어간 것)는 한 주기를 한 배율로 유지하도록 상태의 중앙값을 쓰고,
나머지는 프레임마다 보정한다. 다르게 하려면 `scaleCheck.per`에 자산 id별로 `"state"`나 `"frame"`을 적는다.

머리를 확신 있게 찾지 못한 프레임이 있으면 요청을 만들지 않고 `SCALE_CHECK_EYE_CHECK`와 그 프레임 목록을 돌려준다.
추측하지 않는다. 보드에서 그 프레임을 기준과 비교해 보정값(0.5~2, 1은 그대로)을 정하고 설정의 `scaleCheck.fix`에
**자산 id로** 적은 뒤 다시 실행한다. 한 주기로 보정하는 자산은 id(`"walk"`), 그 밖의 자산은 한 프레임이면 `"combo/2"`,
모든 프레임이면 `"combo"`로 적는다. 요청에 없는 자산·없는 프레임·범위 밖 값은 거절한다.
보정값은 기준 프레임이 pack에 그려지는 크기에 맞춰 적용되므로, 기준(`reference`의 파일과 상태)도 자산 중 하나여야 한다. 측정 자체를 끄려면 `"scaleCheck": false`.
넘어짐·누움처럼 머리가 45°를 넘게 도는 상태(이름에 fall·ko·lie·down·flip이 낱말로 들어간 것)는 90°까지 찾는다.
`wideStates`에 적은 상태가 여기에 더해진다.

```json
{
  "reference": { "file": "sprites/manifest.json", "state": "idle", "frame": 0 },
  "assets": ["..."],
  "scaleCheck": { "fix": { "combo/2": 1.0, "walk": 1.04 }, "wideStates": ["groggy"] }
}
```

보정된 pack의 픽셀이 바뀌므로 보행 검수(`fighter:gait review`·`loop-review`)는 이 pack으로 다시 한다.

## 2. 생성 전에 보행 설계표 작성

### 관절 좌표를 전달하는 새 단일 포즈 경로

사용자가 포즈 가이드 방식을 선택하면 v5 측정 검수가 포함된 `gen-motion`을 사용한다.
자세한 스키마와 검수 절차는 [포즈 생성 지침](../vendor/sprite-gen/docs/pose-motion.md)에 있다.
16개 walk 또는 12개 run 자세의 공통 캔버스와 관절 좌표를 원화의 체형에 맞춰 설계하고,
물리적인 다리 A/B, heel/toe 접지와 공중 구간을 명시한다. 이 좌표는 목표이며 실제 관찰값이 아니다.

새 생성에는 version:2 계획이 필요하다. `body_reference`에 실제 원화 해시·원본 캔버스·눈으로
확인한 머리/몸통의 고정 표식 4..12개·검수자·관찰을 기록하고, 각 자세의 `body_landmarks`로
같은 표식의 목표 위치를 고정한다. 손발·전체 외곽 높이·가려진 관절을 몸 배율 기준으로 쓰지 않는다.
원화와 다른 몸 비율, 프레임별 줌 변화는 생성 전에 거절한다. v1 기록은 보존하며 조회·회수·기존
내보내기는 유지하지만 키트는 v1로 새 생성 호출을 반복하지 못하게 한다.

```sh
npm run sprite -- gen-motion --plan walk-pose-plan.json --run-dir output/walk-poses-v1 --prepare-only
npm run sprite -- gen-motion --plan walk-pose-plan.json --run-dir output/walk-poses-v1 --frame contact-a --model <supported-model>
```

새 run은 해당 프레임의 실제 관절 가이드 → 외형 전용 원화 → 검수된 기준 자세 최대 두 장 순서로 전달한다.
`--prepare-only` 뒤 `input-review.json`에서 원화 대비 체형·배치, 물리적 A/B 대응, 겹친 다리의 가독성,
접지 계획을 실제 입력 이미지로 검수한다. 좌표를 작성했다는 이유만으로 통과시키지 않는다.
이 검수는 제작 그룹 내부 작업이며 사용자에게 매 프레임 승인을 요청하는 단계가 아니다.
원화의 종횡비·배치가 다르면 같은 좌표계의 측정 자료로 간주하지 않는다.
관절 가이드는 강제 제어가 아닌 참조 이미지다. 참조 순서 변경만으로 성공했다고 주장하지 않는다.
양쪽 접촉·통과 핵심 자세부터 생성·검수하고, 중간 자세는 검수된 앞뒤 자세에 연결한다.
review.json의 양쪽 다리·골반 연결·목표 자세·접지·외형을 실제 이미지에서 확인한다.
모든 자세는 전신 생성이며 상체 고정과 다리 합성, 좌우 반전·복제로 채우지 않는다.
16/12칸 계획에서 일부만 생성한 상태는 진단 시안이다. 완성본이라고 표시하지 않는다.

생성 뒤 `geometry-observations.json`에 실제 몸 표식과 양발의 새 외곽/뒤꿈치/발끝 관찰을 적는다.
가이드 좌표를 관찰값으로 복사하지 않는다. 가려진 접점·불확실한 다리는 미확인으로 남긴다.
`--measure <frame>`은 alpha>=128 발 픽셀의 접지·침투·공중 높이와 목표 자세를 측정한다.
몸 표식만으로 계산한 균일 배율·이동으로 모든 제약을 만족할 때만 `registration_available`이다.
그때 `--register <frame>`으로 같은 결과를 복구할 수 있다. 두 명령 모두 생성 호출은 없다.
배율 0.85..1.15, 이동 8% 이내이며 몸/발 잔차·클리핑을 검사하고 보정 PNG 픽셀도 재측정한다.
발이 변환을 끌어내리지 않으므로 프레임별 바닥 정렬과 구분된다. 원본·실패 기록은 보존하고,
보정본은 `registered/`에서 새 시각 검수를 받는다. 개별 다리의 각도·형태 오류는 복구하지 않는다.
측정 실패는 재생성을 차단하며, 체크박스 pass만으로 기준 자세나 최종 결과를 승인할 수 없다.
(위 차단 규칙은 contract 3·4 run에 그대로 남는다.)

#### gait-motion 계획의 새 run: contract 5 (v8 패치)

`gait-motion`으로 준비한 계획을 새 run 폴더에서 `--prepare-only`하면 contract 5가 된다.
기존 contract 4 run의 프롬프트·검수·차단 규칙은 바뀌지 않는다.

- 프롬프트는 소수점 관절 좌표·세계 상태 JSON·지면 파라미터·여백 픽셀을 보내지 않는다.
  위치는 가이드 이미지가 맡고, 글은 지지 상태·각 다리의 접지/들림·자기 골반 기준 앞뒤·무릎 굽힘을 말한다.
  run02 실제 도구 호출에는 좌표 문장이 모두 도달했지만 크기·배치·발 목표가 지켜지지 않았다.
- 가이드 좌표 일치(`foot_pose`, 몸 배율·이동)는 진단값이다. 시각 검수(`review.json`)와
  시각 실패 뒤 `--retry`를 막지 않는다. 자세당 두 번 한도는 유지한다.
- 가려진 점은 추측하지 않고 선언한다. 해당 발의 `hidden`에 넣고 값은 `null`로 둔다.
  발 전체가 가려지면 `outline: []`, `hidden: ["heel","toe"]`. 상태는 `unverified_hidden`이며 pass가 아니다.
  보이는 픽셀의 침투·공중 높이 상실·접지 잔차는 여전히 막는다.
- `--export`는 `contact-coverage.json`을 쓴다. 물리 다리별 접지 구간(루프 경계는 하나로 합침)마다
  보이는 접점이 지면에 맞는 프레임이 2장 이상(짧은 구간은 전부) 있고 모순·미끄럼이 없어야 pass다.
  달리기 공중 구간마다 양발 전체가 보이며 떠 있는 프레임이 1장 필요하다.
  한 프레임의 숨은 heel 때문에 동작 전체가 막히지 않지만, 보이는 근거가 없는 구간은 unverified로 남는다.
  허용치 0.6%(1024 캔버스에서 약 6px)는 임시 설계값이다. 2026-10-23 반복성 실험에서 같은 정의의
  쌍 차이는 최대 3.2px로 이 안이었지만, 관례가 다르면 최대 80px까지 벌어졌다. 정면 발 발끝·콧구멍 끝
  같은 모호한 점은 주석 전에 정의를 고정한다(`output/mocha-work/experiments/annotation-repeatability-01`).
  몸 랜드마크가 2.4% 넘게 어긋난 프레임만 발 근거에서 뺀다. 1.2% 등록 한도는 실제 출력에서
  주석자에 따라 판정이 갈려(12.4/11.5/10.7px) 여기에 쓰지 않는다.
  `sequence-review.json` pass와 coverage pass가 모두 있어야 asset.json이 생긴다.
- 모호했던 랜드마크는 다음 정의로 고정한다. 관례 차이(최대 81px)가 클릭 오차(1~3px)보다 훨씬 컸다.
  - `nostril_lower_tip`: 가까운(화면 왼쪽, 큰) 콧구멍의 어두운 물방울 모양에서 뾰족한 오른쪽 아래 끝.
    원화 보정점과 같은 자리다. 먼 콧구멍, 주둥이 주름선, 주둥이 외곽선이 아니다.
  - 발 `toe`: 바라보는 방향으로 가장 앞선 발가락 패드가 아래 발바닥 경계와 만나는 점.
    정면을 향한 발도 같다. 패드 사이 오목한 곳이나 가장 낮은 점이 아니다.
  - 발 `heel`: 뒤쪽 윤곽이 아래 발바닥 경계로 꺾이는 점. 정면을 향한 발이라 아래 경계가
    발가락 패드뿐이면 heel은 가려진 것이다. `null`로 두고 `hidden`에 적는다.

```sh
npm run sprite -- gen-motion --plan walk-pose-plan.json --run-dir output/walk-poses-v1 --export
```

모든 개별 자세 통과 뒤 실제 순서의 sequence-preview.webp와 sequence-review.json을 검토한다.
교대·미끄러짐·몸 연속성·루프가 통과한 뒤 재실행하면 asset.json이 생성된다.
검수한 원본 또는 명시적 몸 보정본의 좌표를 유지하며 내보내기 단계에서 바닥 정렬을 하지 않는다. 이 출력은 sprite-gen-asset 형식이며
행 추출이나 bind-keyposes를 거치지 않는다. game-pack 및 아래 접지 검수는 여전히 필요하다.
한 자세의 반복 실패는 두 회까지이며, 불명확한 실행은 결과를 확인한 뒤 --reconcile로 회수한다.
하위 `gen`이 요청을 보내기 전에 실패하면(종료 3 또는 보고서 `provider_submitted: false`) 그 시도는 `not-started`이고
`gen-motion`도 종료 3으로 끝난다. 과금이 없으므로 같은 `--frame`을 다시 실행하면 같은 시도 폴더에서 다시 만들며 두 회에 세지 않는다.
크리에이터 플러그인의 관리형 작업(`prepare_creation_job`)으로 실행할 때 `--frame` 생성은 사전 검사
`workflow --kind sprite --image-provider codex --motion-method pose-plan`이 필요하다. `--prepare-only`·`--measure`·`--register`·
`--export`·`--reconcile`은 아무것도 보내지 않으므로 사전 검사 없이 실행된다. 결과를 알 수 없는 작업은 다시 실행하지 않고 `--reconcile`로 회수한다.
재시도 프롬프트에는 fail 관찰만 간결하게 전달하고 전체 검수 JSON/해시/pass/unverified는 제외한다.
해상도 등 구조 오류는 재생성을 차단한다. `gen-motion`은 하위 `gen`의 타임아웃 자동 재시도도 끈다.
실제 도구 호출 입력은 `gen-report.json.extra.image_tool_trace`, 원본 실행은 보존된 세션에서 확인한다.
`refs` 목록만으로 최종 이미지 도구까지 전달됐다고 단정하지 않는다. 누락 기록은 미확인으로 남긴다.
프레임당 생성 호출이 필요하므로 전체 시트 방식보다 호출 수가 늘어난다.
v3 패치의 `--normalize-canvas`는 제공자가 같은 종횡비에서 다른 해상도를 반환한 경우에만
캔버스 전체를 동일 배율로 변환한다. 원본 PNG와 배율·이동 0을 기록하며 크롭·바닥 정렬을 하지 않는다.
기존 해상도 불일치는 `--reconcile --normalize-canvas`로 새 생성 없이 회수한다.
종횡비가 다르거나 체형·발 위치가 틀린 그림을 이 기능으로 통과시키지 않는다.

### 기존 행별 핵심 자세 경로

```sh
npm run fighter:gait -- init output/my-walk
```

새 폴더에 `gait-plan.json`, 전체 16칸용 `sprite-request.json`과 `phase-guide.png`,
4개 핵심 자세용 `keyposes-request.json`과 `keyposes-guide.png`, 미검수 `keyposes-review.json`이 생성된다.
계획과 포즈 가이드는 제작 지시이며 결과 검증 자료가 아니다. 기본 가이드는 일반적인 걷기 위상 예시다.
캐릭터의 실제 골반·다리 길이·체형과 다른 가이드를 해부학 참조로 사용하지 않는다. 필요하면 가이드를 맞춘 뒤 참조 해시도 새로 측정한다.
`near`는 기준 원화에서 카메라에 가까운 같은 다리, `far`는 먼 같은 다리다. 화면에서 앞에 있는 발을 계속 near라고 바꾸어 부르면 안 된다.
기본 걷기는 16칸의 한 주기이고 0번과 8번에서 실제 다리 역할이 바뀐다. 양쪽 착지·지지·통과 자세를 먼저 확인한 뒤 중간 자세를 생성한다.
먼저 `keyposes-request.json`으로 `prepare → gen-set --provider codex`를 실행한다. 양쪽 접지와 통과 자세의
동일한 near/far 다리, 각 골반 연결, 가림 순서, 몸 형태와 무게 이동을 실제 그림으로 확인한다.
검수자가 `keyposes-review.json`의 identity/anatomy/alternation/contacts/bodyContinuity와 notes를 기록한다.
하나라도 fail/unverified면 전체 16칸을 생성하지 않는다. 이 내부 검사는 사용자에게 매 자세마다 승인을 받으라는 뜻이 아니다.

```sh
npm run fighter:gait -- bind-keyposes output/my-walk/sprite-request.json output/keyposes/raw/walk.png output/my-walk/keyposes-review.json
```

실제 준비된 요청의 raw 경로를 사용한다. `bind-keyposes`는 검수한 이미지 바이트의 해시와 판단을 요청에 묶는다.
그 후 전체 요청으로 새 run을 `prepare`한다. `states.<state>.motion`은 prepare를 거쳐 보존되며,
gen-set은 외형 참조 → phase-guide → 검수된 keyposes → 배치 가이드 순서로 이미지를 전달한다.
참조 파일 경로는 준비된 run 기준 또는 절대 경로다. init/bind 명령은 절대 경로를 기록한다.
실제 파일·해시가 없거나 검수가 없으면 생성 전에 차단한다. 이미지나 프롬프트가 바뀌면 이전 결과를 재사용하지 않는다.
실제 참조 스택과 검수 근거를 `qa-notes.md`에 기록한다. 프롬프트만 수정하면서 가이드를 첨부했다고 주장하지 않는다.
프레임 수를 맞추려고 복제·속도 변경·실패한 반주기 반복을 하지 않는다.

run은 계획의 `motion`을 `run`으로 하고 12개 phase와 실제 지지·공중 구간을 명시한다. 생성 요청도 12칸으로 맞춘다.
현재 자동 생성되는 포즈 가이드는 walk 전용이다.
run도 같은 `motion` 계약(kind: run, stage: keyposes/sequence, phases, references)을 사용하며 공중 phase가 필요하다.
키 포즈 단계에는 양쪽 단독 지지와 공중 자세를 포함한다. 최종 12칸 요청을 만드는 작업은 에이전트가 처리한다.

상체 픽셀을 고정한 뒤 다리만 붙여 실패한 동작을 보정하지 않는다. 캐릭터 전체의 자세로 수정한다.
같은 발 교대·골반 연결·접지 오류가 두 번 연속 남으면 해당 방식의 반복을 멈추고 실패 시안과 근거를 보여준다.
짧은 겹침 구간 생성은 별도 실험으로 표시한다. 성공을 확인하기 전 기본 제작 경로로 바꾸지 않는다.
새 시도는 새 run/버전으로 보존하며 기존 출력에 `--force`로 덮어쓰지 않는다.
응답 유실은 실패가 아니다. `reports/gen-set/*.attempt.json`이 running이면 재시도를 차단한다.
제공자 기록과 출력에서 실제 결과를 확인하고 기존 작업의 복구/해결 절차를 따른다. 자동으로 표식을 삭제하거나 재호출하지 않는다.

## 3. 같은 발의 접지를 측정

먼저 실제 manifest로 미검증 미리보기를 만든다. 종료 코드 2는 파일 생성 실패가 아니라 품질 미통과다.

```sh
npm run fighter:gait -- review output/my-walk/gait-plan.json output/my-walk/review
```

plan의 `source.file`은 plan 기준 상대 경로다. atlas는 `state`를, 최종 game-pack은 `animation`을 지정한다.
geometry는 해당 단계의 실제 좌표를 사용한다. game-pack 배율이 달라졌다면 지면선과 발 영역도 다시 측정한다.

```json
{ "file": "pack/game-pack.json", "animation": "cat-walk/walk" }
```

`review/annotations-template.json`의 현재 sequence 해시를 유지한다. 실제 그림을 보고 identity/anatomy/alternation/loop를
각각 `pass`, `fail`, `unverified`로 기록한다. 시트와 정상 속도 반복 재생을 모두 확인하며 한쪽만 보고 통과시키지 않는다.
발 구분이 불확실하면 `unverified`다. 생성 프롬프트에 쓰인 동작을 실제 관찰 결과로 복사하지 않는다.

stances에는 같은 발이 지면에 붙어 있는 연속 구간과 그 발만 들어가는 고정 ROI `[x,y,width,height]`를 적는다.
near와 far 각각 세 개 이상의 서로 다른 관찰 자세가 필요하다. 다른 발·몸통이 ROI에 들어가거나 발이 가려져 추적이 끊기면 측정할 수 없다.
다음은 구조 예시이고 실제 좌표나 구간으로 복사해서 쓰면 안 된다.

```text
stances: [
  { foot: "near", start: <첫 프레임>, end: <끝 프레임>, box: [<x>, <y>, <w>, <h>] },
  { foot: "far",  start: <첫 프레임>, end: <끝 프레임>, box: [<x>, <y>, <w>, <h>] }
]
```

```sh
npm run fighter:gait -- review output/my-walk/gait-plan.json output/my-walk/review output/my-walk/annotations.json
```

도구는 원본 manifest 또는 game-pack의 정확한 프레임과 재생 시간을 읽어 측정용 PNG 스냅샷을 저장한다.
그림의 크기·위치·순서·시간은 바꾸지 않는다. 이 스냅샷을 공식 `inspect-motion`에 넘겨 발 영역의 알파 중심 이동,
지면선 안정성, 서로 다른 자세, 방향과 속도 일관성을 검사한다. 자체 이미지 추출·수선 엔진으로 sprite-gen을 대체하지 않는다.

`inspect-motion`의 속도 단위는 px/s다. 보폭은 검증된 속도 × 한 주기 시간으로 계산한다.
양발의 측정 방향이 다르거나 속도가 25% 이상 벌어지면 통과시키지 않는다. 25%는 현 도구의 휴리스틱이며 실제 정확도 확률이 아니다.
지면 오차는 plan의 `groundTolerance`로 검사하며 기본 512px 셀의 3px도 초기 검수 기준이지 모든 그림에 보장되는 품질 기준이 아니다.
검수자는 기준을 바꾸어 오류를 숨기지 말고 변화의 근거를 기록한다.

## 4. 등록 전 미리보기와 패키징

`preview.html`은 등록·로그인·외부 서버 없이 열리는 단일 파일이다. 정상/저속 재생, 프레임 이동, 지면선과 발 영역을 제공한다.
검수에 실패해도 미리보기와 contact-sheet를 만든다. 이동 재생은 보폭이 검증된 경우에만 활성화된다.
계획상 지지발과 실제 관찰·측정을 구분해서 표시한다. 실패를 통과로 보이게 프레임이나 재생 시간을 바꾸지 않는다.

패키징 계획의 walk/run에 최종 game-pack에서 검사한 결과를 지정한다.

```json
{
  "walk": { "animation": "cat-walk/walk", "gaitReview": "review-walk/review.json" },
  "run": { "animation": "cat-run/run", "gaitReview": "review-run/review.json" }
}
```

`fighter:pack`의 기본 `reviewPolicy`는 `required`다. 미검증·실패·다른 프레임·바뀐 시간의 결과를 거절한다.
walk의 보폭은 이 근거에서 받아오므로 `stridePixels`를 수기로 덮어쓰지 않는다.
`reviewPolicy: "format-only"`는 형식 테스트 fixture용 명시적 예외이며 결과 보고서에 시각 품질 미검증을 남긴다.
이를 일반 캐릭터의 검수 통과 우회로로 쓰지 않는다. 서버 계약은 이 로컬 검수 결과를 보안 인증서로 신뢰하지 않는다.

부츠 굽·앞창, 동물 발의 패드·발굽·발톱처럼 갈라진 접촉면이나 발가락 보행의 들린 뒤꿈치 때문에 공식 검사만 미검증인 경우
[명시적 양발 윤곽 근거](FOOT-EVIDENCE.md)를 사용할 수 있다. v2 근거는 갈래를 발 단위로 묶고 이동을 앞쪽 접지 끝에서 잰다.
이것은 AI Fighter가 유지하는 선택적 검사 확장이며 공식 검사 결과도 함께 보존한다. 다른 실패나 시각 검수를 대신하지 않는다.

## 달리기 공중 프레임 보존 계약

패치된 `extract`의 painted-art component 경로와 명시적 slot 경로는 `fit.ground_frames=false`에서 원본의 상대 Y를 보존한다.
가로 정렬은 기존 fit 설정을 따르며, 수직 이동과 배율은 전체 행에서 한 번 결정한다. `true`/생략 시 기존 하단 정렬이 유지된다.
`fit.source_ground_y`를 지정하면 실제 원본 행 좌표의 지면선으로 사용한다. 생략하면 가장 아래 불투명 픽셀을 공통 배치 기준으로 쓴다.
이 추정 기준은 실제 지면 인식이 아니다. 그림에 그림자·먼지·떠 있는 장식 등이 있으면 먼저 원본을 바로잡고 지면을 직접 확인한다.
출력도 원본과 같이 공중 높이 차이가 남는지 시트·재생으로 검수한다. 원본에서 이미 사라진 높이는 복원하지 않는다.
`slice-sheet --scale sheet`도 공통 배율과 별개로 각 그림의 밑부분을 baseline에 놓으므로 공중 동작 보존 수단이 아니다.
아래 PNG 경로도 이미 공통 캔버스가 보존된 입력에 사용할 수 있다. 임의 행을 균등 grid라고 가정해 자르라는 지침은 아니다.

이미 같은 크기·배율·고정 카메라·기준 지면으로 제작된 투명 PNG들이 있으면 공식 `sprite-gen-asset` descriptor에
각 PNG와 실제 재생 시간을 명시하고 `game-pack`으로 직접 전달한다. `game-pack`은 셀 전체를 같은 배율로 바꾸며 프레임별 알파 하단을 정렬하지 않는다.
중립 원화의 `source_body_height`를 모든 동작에 공통 적용한다. 이미 바닥 정렬돼 사라진 공중 높이를 이 단계가 복원하지는 못한다.

```json
{"kind":"sprite-gen-asset","version":1,"anchor":[256,460],"frames":[
  {"file":"run-00.png","duration":0.0625},
  {"file":"run-01.png","duration":0.0625}
]}
```

위는 descriptor 구조 예시이며 실제 run에는 계약 범위 안의 10~16개 서로 다른 프레임이 필요하다. PNG들이 이미 공통 캔버스를 공유한다면
`unpack-atlas --pngs-dir`로 가져오는 공식 경로도 원본 크기의 셀을 유지한다. 자동 컴포넌트 bbox 탐지·중앙 재배치는 쓰지 않는다.
실제로 규칙적인 셀에 그려진 시트는 공식 row-major grid descriptor로 해당 셀을 읽을 수 있지만,
임의 AI 행 이미지에 균등 격자를 가정해 잘라 쓰지 않는다. 프레임이 경계를 넘거나 셀 기준점이 다르면 먼저 제작 결과를 수정한다.

현재 run gate는 10~16개 고유 프레임, 모든 프레임에 대응하는 계획, 공통 캔버스·지면 좌표,
양쪽 단독 지지 phase, 양발 각각 3개 이상의 실제 접지 관찰을 요구한다.
공중 phase는 `support: []`로 기록한다. 지지 phase에만 하단 지면 오차를 검사하므로 **공중 phase가 실제로 떠 있는지를 자동 증명하지 않는다**.
`flight: true` 텍스트만으로 합격되지도 않는다. 실제 공중 자세와 높이 보존은 시트·정상/저속 재생에서 시각 검수해야 한다.
최종 `game-pack`에서 다시 검수하고, 패키징은 공통 groundY와 동일한 크롭/원점을 써 상대적인 수직 오프셋을 유지한다.

수정 시 관련 테스트는 `node --test test/gpt-motion.test.mjs test/gait.test.mjs test/gait-engine.test.mjs test/pack.test.mjs`로 실행한다.
기존 실패 시퀀스의 지면 오차, 양발 근거 누락, 보폭 단위, 검수 해시 만료, 자세별 과대 확대와 미리보기 생성이 회귀 검사 대상이다.

## 호스팅 생성의 고리 검수 (`engine-loop`)

ODDBOUT 호스팅 생성(서버가 신청을 받아 생성하는 경로)은 걷기·달리기를 Grok 영상 고리로 만든다. 영상 속 발은 구르며 바닥에 닿고,
발가락이 굴곡으로 그려져 있어서 3절의 같은 발 측정이 한 발을 따로 떼어 내지 못하는 일이 잦다. 그래서 이 경로만 패키지 계획에
`"reviewPolicy": "engine-loop"`를 쓰고, 걷기·달리기에 `gaitReview` 대신 `loopReview`를 둔다.

```sh
npm run fighter:gait -- loop-review <config.json> <loop-review.json>
```

- config: `motion`(walk·run), `source`(최종 game-pack 애니메이션), `strip`(그 고리를 자른 `video-loop`·`video-cycle-align`의 strip.json),
  `verdict`(시각 판정 JSON: identity·anatomy·loop가 pass/fail, notes), `judge`(판정한 쪽), `stridePixels`(걷기만, 생성기가 발에서 잰 값).
- 발 교대는 판정이 아니라 엔진 기록이다. `video-cycle-align`이 두 착지에 서로 다른 발 이름(`cycle_align.foot.feet`)을 붙여야 한다.
  같은 색 다리를 옆에서 본 고리는 시각 판정 모델이 교대를 가리지 못했다(엔진이 교대로 읽은 걷기를 같은 다리로 판정).
- 예외 하나(2026-11-01): 옆모습에서 발 이름이 `low-margin`으로만 비었을 때다. 그늘 단서가 한 주기에 한 번 흔들리면(`rhythm` ≥ 0.25,
  엔진이 차이보다 먼저 보는 조건) 두 착지는 두 다리다. 다만 착지 프레임의 그늘이 0.025보다 덜 달라 어느 발인지 이름을 못 붙인 것이다.
  어느 발이 왼발인지는 킷·게임 어디서도 쓰지 않는다. 같은 다리를 두 번 딛는 고리는 그늘이 한 주기에 두 번 흔들려 `rhythm`에서 걸린다.
  기록은 `engine.feet: null`, `feetBy: "low-margin"`, `feetRhythm`을 남기고 `scope`에 그 사실을 적는다. 호스팅 잡 다섯 개(10-30, 10-31)의
  첫 테이크 깨끗한 컷 약 19개 중 14개가 이 이유 하나로 판정 전에 버려져 새 Grok 촬영이나 운영자 검토로 갔다. 생성기도 같은 규칙으로 컷을
  판정에 보낸다(`host/generation-stages.mjs` `lowMarginFeet`, 테스트가 둘을 같게 묶는다).
- 기록은 최종 프레임과 시간에 묶인다(`sequenceSha256`). 엔진이 남긴 다시 찍기 사유가 하나라도 있거나, 발 이름이 없거나(위 예외 밖) 같거나,
  판정 하나라도 fail이거나, 걷기 보폭이 없으면 `status: fail`이고 `fighter:pack`이 받지 않는다.
- 같은 발 측정을 했다고 주장하지 않는다. `pack-report.json`의 `review`와 `motions.walk.stride.source`(`loop-review`)가 그 사실을 남긴다.
- Dot 제작 경로는 그대로 `required`다(`creation:run`의 패키지 작업은 `required`가 아닌 정책을 거절한다).
