# 가입 후 바로 이용하기

Google 로그인 → Dot에서 제작 → 업로드 → 자동 파일 검사 → 등록(제작 중) → 주인의 동작 확인 → 출전 순서다.
제작 중인 선수는 주인이 미리보기·아레나 연습으로 확인한다. 출전한 선수만 공개 명단·랭크 대결·컵·스파링과 그 순위에 나온다(주소를 아는 사람은 프로필을 볼 수 있다).
베타 초대, 신청 심사, 별도 게임 사용 승인은 필요하지 않다. 과거 초대 거절·만료도 가입과 업로드를 막지 않는다.

ODDBOUT 통합 플러그인은 연결된 Google 계정을 PC와 Dots 등록에 공통으로 사용한다.
`get_profile`과 클라우드 `check_creation_readiness`로 확인하며 작업 공간의 별도 로그인을 요구하지 않는다.
예전 독립 CLI만 `deploy/creator-site.json`의 `apiBase` origin과 `publishableKey`로 로그인한다.
생성은 사용자 자신의 생성 계정으로 PC 또는 사용자별 Dots 작업 공간에서 진행한다.
추가 비용이나 제공자 변경은 먼저 확인한다. [통합 플러그인 안내](ODDBOUT-PLUGIN.md)를 참고한다.

파일 형식·해시·용량·전체 WebP 디코딩 검사는 계속 수행한다. 실패한 파일은 오류를 고쳐 다시 제출한다.
`registered`, `fighterId`, `runtimeApproved: true`를 확인하고 홈페이지에서 실제 애니메이션을 확인한다.
등록한 선수는 **제작 중**이다. 선수 페이지의 "모든 동작"에서 필수 동작 11개를 하나씩 재생해 확인 표시를 하면 **출전**할 수 있다.
서버는 확인한 패키지 해시와 동작을 기록한다. 새 패키지로 바꾸면 다시 제작 중이 된다. 이름·소개·전투 스타일 수정은 출전을 유지한다.

- API: `POST /fighters/:id/entry` `{ "expectedManifestSha256": "현재 해시", "reviewedClips": [필수 동작 11개] }`, `DELETE`는 출전 취소.
  같은 요청을 반복해도 같은 답이라 멱등 키가 필요 없다. `/spec`의 `registration.fighterEntry: "v1"`이 지원 여부다.
- MCP: `enter_fighter`·`withdraw_fighter`(에이전트 도구). 사용자에게 동작을 보여주고 요청을 받은 뒤에만 부른다.
- 기존 선수(2026-10-30 마이그레이션): 전적(완료된 랭크 대결 또는 컵 경기)이 있는 선수는 출전, 없는 선수는 제작 중으로 옮겼다.
- 원천: [출전 마이그레이션](../supabase/migrations/20261030130000_ai_fighter_entry.sql), [출전 API](../api/fighter-entry.mjs).
작업자가 잠든 경우 자동 검사에 시간이 걸릴 수 있다. 수동 승인 대기라고 안내하지 않는다.

## 사후 조치

관리자는 `admin.html`의 선수 관리에서 부적절한 선수를 내리거나 복원한다. 사유 입력은 필수다.
조치 사유는 제작자에게 표시하고, 실행 관리자·대상·시각·버전을 별도 감사 기록에 남긴다.
내려진 선수는 공개 목록, 신규 파일 전달, 새 대결에서 제외한다. 기존 등록 기록과 전적은 보존한다.
이미 다운로드한 파일이나 발급된 서명 URL은 회수할 수 없다. 서명 URL은 최대 10분 뒤 만료된다.
복원은 서버 검사를 통과한 동일 불변 패키지에만 허용한다. 일반 사용자는 상태를 직접 바꿀 수 없다.

## 기술 호환과 무료 운영 한도

- `GET /me`: `accessMode: "open"`, `canSubmit: true`. 기존 `invited` 필드는 같은 이용 가능 상태의 호환 별칭이다.
- `POST /access-requests`: 과거 클라이언트 호환용 계정 상태 응답. 새 초대 요청을 만들지 않는다.
- 과거 초대 심사 API는 410 `registration-open`으로 종료한다. 과거 심사 기록은 보존한다.
- 내부 `runtime_approved`, `duel_approved`, `review_state`는 기술적 이용 가능 상태와 사후 조치를 표현한다.
  이 이름은 사람의 심사를 뜻하지 않는다. 이용 가능 근거는 `open-registration` 정책과 서버 검사 결과이며, 다른 사람에게 나오는 것은 주인의 출전(`entered_at`)이다.
- 로그인 확인, 소유권, RLS, 불변 파일, 요청 속도·파일 용량·저장소 한도는 유지한다.
  신규 등록 시도는 계정당 최근 24시간에 5회다. 반려·삭제된 시도도 그 하루 안에서는 센다. 기존 선수의 수정은 이 횟수에 포함하지 않는다.
  파일 합계 10 MB와 전체 예약 저장소 100 MB 한도, 계정당 선수 한도(기본 3명, 계정별 `af_creators.fighter_limit`)는 유지한다.
  이미지와 소개만 먼저 공개하는 `profile` 상태도 같은 선수 한도에 포함된다. 서비스 전용
  `af_register_character_profile`로 등록하며, 전투 승인·패키지 해시·검증 제출을 만들지 않는다.
  공개 목록은 RLS와 열 권한이 적용된 `af_public_character_profiles` 뷰로 읽는다.
  전투 동작을 완성하면 같은 선수 ID를 지정해 기존 패키지 검증 절차를 통과한다.
  이때 `registered`로 전환되며 세계관 연결과 계정 슬롯은 유지된다.
  이는 사전 심사 제도가 아니며 비용을 제한하는 기술적 상한이다.

운영 변경은 [공개 이용 마이그레이션](../supabase/migrations/20261021092001_ai_fighter_open_registration.sql),
[계정 API](../api/account.mjs), [관리자 API](../api/admin.mjs)가 소유한다.

## 등록한 선수 수정

제작자 페이지의 선수 상세 화면에서 이름과 소개를 저장할 수 있다. 그림을 다시 올리지 않는다.
연결된 ODDBOUT 도구에서는 `get_registered_fighter`로 현재 버전을 읽고 `update_fighter_profile`을 호출한다.
이 경로는 로컬 패키지나 이미지 파일이 없어도 동작한다. 이름·언어별 이름·소개·언어·컨셉·기술 설명·경기 대사만 바꿀 수 있다.
언어별 이름(`names`)과 경기 대사(`lines`)는 `null`을 보내면 지운다. 서버 `/spec`에 각각 `profile-names-1`·`profile-lines-1`이 있어야 한다.
그림·애니메이션·능력치·전투 스타일 수정은 `prepare_fighter_registration(fighterId)`로 시작하는 패키지 검증 경로를 사용한다.

- API: `PATCH /fighters/:id/profile`, 인증 헤더와 UUID `Idempotency-Key`가 필요하다.
- 본문: `{ "expectedManifestSha256": "현재 해시", "profile": { "name": "새 이름" } }`. 생략한 필드는 유지한다.
- 같은 요청의 재시도에는 본문과 키를 유지한다. `fighter-changed`이면 최신 프로필을 읽고 변경을 다시 확인한다.
- 새 불변 매니페스트와 승인 해시를 한 트랜잭션으로 저장한다. 선수 ID·생성일·전적·이전 매니페스트는 보존한다.
- `asset_source_submission`은 실제 파일이 저장된 원래 제출을 참조한다. 원본 파일·행은 참조가 남아 있는 동안 보존한다.
- 소유권·요청 속도·계정 제한·서비스 일시 중지·사후 조치·진행 중 업로드 검사는 계속 적용한다.

변경의 소유자는 [프로필 수정 마이그레이션](../supabase/migrations/20261024022222_ai_fighter_profile_edits.sql)
(수정 가능한 키는 [경기 대사 마이그레이션](../supabase/migrations/20261027130000_ai_fighter_profile_lines.sql)이 마지막으로 정한다)과
[프로필 API](../api/fighter-profile.mjs)다. API의 `registration.profileUpdate: "v1"`은 지원 여부를 표시한다.
마이그레이션을 먼저 적용하고 API를 갱신한 뒤 제작자 페이지·MCP 도구를 공개한다. 로컬 검증은 배포가 아니다.

## 프로필 세트(정면 원화·얼굴 칸, 2026-10-31)

등록한 선수의 정면 전신 원화 한 장과 얼굴 칸이다. 사이트의 홈·명단·프로필과 경기 화면의 얼굴이 쓴다. 홈은 프로필 세트가 승인된 선수만 보인다.
경기 패키지 밖에 둔다. 그래서 세트를 바꿔도 패키지 해시·엔진·대결 기록·출전 상태는 그대로다.

- 규격: 서버 `/spec`의 `profileSet`(`api/profile-sets.mjs`의 `PROFILE_SET_SPEC`)이 소유한다. 세트 파일 `profile-set.json`은
  `{ version: "oddbout-profile-set-v1", front: { path, bytes, sha256, width, height }, face: { x, y, side } }`다. 정면 원화는 알파가 있는 WebP,
  4,000,000바이트 이하, 세로가 가로보다 긴 그림(긴 변 1024~2048, 짧은 변 512 이상)이다. 캐릭터는 키보다 넓지 않다(카드 폭 600 이하).
  `registration.profileSet: "v1"`이 지원 여부를 표시한다.
- 표정 시트(선택, 2026-11-03): 세트 파일의 `expressions: { path, bytes, sha256, width: 1536, height: 1024 }`. 알파가 있는 WebP, 4,000,000바이트
  이하, 3 × 2칸에 무투장 얼굴 여섯(기본·맞음·으스댐·위기·옆눈질·KO 순서, 모두 화면 오른쪽을 보는 3/4 측면)이다. 체력바 얼굴이 경기 따라 바뀌고,
  KO 컷인은 진 선수의 KO 얼굴과 이긴 선수의 옆눈질을 보인다. 없으면 무투장은 모든 상황에 얼굴 칸 한 장을 쓴다. 생성 문구는 규격의
  `expressions.prompt`, 키트의 `npm run fighter:profile-set`이 세트 파일과 그림을 만든다.
- 운영자의 표정 시트(2026-11-03): 시트 없이 승인된 선수에게 운영자가 시트를 붙인다. `npm run admin -- profile-expressions <sheets.json> --reason <text>`
  (`POST admin/profile-sets/<지금 승인된 세트>/expressions`, `image/webp`, `Idempotency-Key`, `X-Admin-Reason`)가 그 세트의 정면·얼굴 칸에 시트를 붙인
  새 세트를 주인 이름으로 만들어 검사에 보낸다. 운영자의 id와 사유는 `af_profile_set_events`(`admin-expressions`)에만 남는다. 승인 전에는 지금 세트가 그대로다.
  세트·바탕(`based_on`)·사건은 한 트랜잭션(`af_admin_profile_set_expressions`)이고, 요청은 대상 선수(`X-Admin-Fighter`)를 함께 보내 다른 선수의 세트를
  거절한다. 바탕 세트가 더 이상 그 선수의 지금 세트가 아니면(주인이 그 사이 새 정면을 승인받으면) 승인이 거절된다. 만든 뒤 저장이 실패한 세트는 바로
  닫혀 주인의 업로드를 막지 않는다(같은 키는 `upload-expired` — CLI `--attempt 2`).
- 운영자의 정면(2026-11-03): 승인된 세트가 없는 선수에게 운영자가 세트 전체(정면·얼굴 칸·시트)를 올린다. 표정 시트 경로는 승인된 정면이 있어야 해서
  그런 선수에게 쓸 수 없다. `npm run admin -- profile-front <선수> <세트 폴더> --reason <text>`가 키트의 `npm run fighter:profile-set` 폴더를 읽고, 보내기 전에
  세트 파일·크기·해시와 검증기의 픽셀 검사를 돌린다. 요청은 `POST admin/fighters/<선수>/profile-sets` 하나다(`multipart/form-data`: `profile-set`·`front`·
  `expressions`, `Idempotency-Key`, `X-Admin-Reason`). 서버(`api/admin-profile-front.mjs`)가 파일을 세트 파일과 맞춰 본 뒤 주인 이름으로 세트를 만든다.
  만들기는 주인의 `af_profile_set_create`와 같은 검사(계정·선수·열린 세트·하루 10개)다. 사건(`admin-front`)과 한 트랜잭션(`af_admin_profile_set_front`)이다.
  그다음 파일을 주인 저장 경로에 넣고 검사에 보낸다. 운영자의 id와 사유는 사건 표에만 남는다. 승인된 세트가 있는 선수는 `approved-profile-set-exists`로
  거절한다. 승인은 그 선수에게 아직 지금 세트가 없을 때만 된다(주인이 그 사이 자기 세트를 승인받으면 `review-conflict`). 저장 실패와 같은 키는 표정 시트 경로와 같다.
- 화풍: 우리 게임의 담백한 셀 채색이다. 규격의 `style.colouring` 문구를 모든 생성에 붙이고, `style.anchor.url`의 기준 그림을 마지막 참조로 붙인다.
- API(주인): `POST /fighters/:id/profile-sets`(UUID `Idempotency-Key`, 본문 = 세트 파일) → `PUT /profile-sets/:id/assets/front`(`image/webp`)
  (시트가 있으면 `PUT /profile-sets/:id/assets/expressions`도) → `POST /profile-sets/:id/submit`. 상태는 `GET /profile-sets/:id`(자기 파일의 10분 서명 주소 포함), 선수별 최근 10개는 `GET /fighters/:id/profile-sets`.
  선수마다 열린 세트는 하나, 계정마다 하루 10개다. 운영자가 만든 세트(표정 시트·정면)는 주인의 한도에 세지 않는다(2026-11-03).
- 검증: 검증 작업자가 전체 디코드·실제 크기·세로 그림·투명한 가장자리·캐릭터 영역(그림 높이의 60 % 이상, 카드 폭 600 이하)·얼굴 칸(캐릭터 안,
  키의 10~30 %, 중심이 위쪽 40 % 안)을 본다. 통과하면 카드(캐릭터 영역, 높이 600)와 얼굴(192×192)을 만들고 `review`가 된다.
  디코드 뒤의 실패(자르기·인코딩·파생본 1 MB 초과)와 검사 프로세스의 죽음·30초 초과도 그 그림의 판정(`rejected`, 이유는 첫 오류 코드)이다.
  다운로드·API 같은 기반 장애만 다시 시도한다. 시트가 있으면 검증기 0.2.0이 크기·알파·투명한 부분(5 % 이상)·여섯 칸 모두의 그림(칸의 10 % 이상)을
  보고 무투장 사본 `sheet`(1152 × 768, 칸 384)를 만든다. 시트가 있는 세트는 0.2.0 판정만 통과한다.
- 승인: 운영자가 `admin/profile-sets`에서 승인하거나 이유를 달아 돌려보낸다. 승인하면 카드·얼굴을 공개 버킷 `af-profile-sets/<선수>/<sha256>.webp`
  (캐시 하루)로 복사하고, 같은 선수의 이전 승인본은 `superseded`가 된다. 명단(`GET /roster`, `/roster/:id`)은 승인본만
  `profileSet: { id, card: { url, width, height, face: { x, y, side } }, face: { url, size } }`로 보인다. 시트가 있으면
  `expressions: { url, width: 1152, height: 768, cell: 384 }`가 더 붙는다.
- 내리기: 이전 승인본·거절된 승인본, 선수 삭제·운영자 내리기로 `withdrawn`이 된 세트의 공개 사본은 그 변경이 확정된 뒤 API가 지운다
  (`af_profile_set_stale_public` → Storage 삭제 → `af_profile_set_unpublished`). Storage 오류는 한 번 다시 시도하고, 그래도 실패하면
  `af_profile_set_events`에 `public-cleanup-failed`로 남긴다. 그 선수의 다음 정리가 다시 시도한다. 운영자가 선수를 복원해도 세트는 돌아오지 않는다.
  주인이 다시 올린다.
- 정면 판정(2026-11-03): 검증을 통과한 세트(`review`)는 공식 생성 PC의 codex(도구 전부 끔)가 그림을 한 번 본다. 한 캐릭터만, 머리부터 발끝까지,
  보는 사람을 똑바로 보는 정면인지(`whole`·`front`·`single`)다. 문항은 맡긴 선수의 외형 판정과 같은 말이다(`host/generation-stages.mjs`
  `frontJudgePrompt`). 셋 다 통과하면 `front_check = 'pass'`, 하나라도 실패하면 세트가 `rejected`가 되고 이유는 `FRONT_VIEW`·`FRONT_WHOLE`·
  `FRONT_SINGLE`, 판정의 한두 문장이 `front_verdict.notes`에 남는다. 생성 PC는 단계와 단계 사이에만 판정하므로(그 토큰이 제작자의 단계에
  섞이지 않게) 긴 동작 단계가 돌면 판정이 기다린다. 판정 임대는 15분이다. PC가 돌리지 못한 시도(codex가 지금 못 돎, og가 시작하지 않음, API가 그림
  주소에 서명하지 못함)는 돌려주어(`profile-fronts/release`) 세지 않는다. 답 없이 다섯 번 가져가면 `stalled`로 운영자 몫이 된다. 판정이 틀려도 운영자가
  뒤집지 않는다(사용자는 PC 판정만 골랐다). 주인이 새 그림을 올린다. 승인된 세트에서 운영자가 만든 시트 세트(`based_on`)는 그 정면을 그대로 쓰므로
  판정하지 않는다. 주인은 `GET /profile-sets/:id`의 `frontCheck`(`pending`·`stalled`·`pass`·`fail`과 판정)로 본다.
- 출전 조건: `af_settings.profile_set_required_after`가 비어 있으면 꺼져 있다. 값이 있으면 모든 선수가(만든 시각과 상관없이, 2026-11-03부터)
  출전하려면 승인된 세트나, 정면 판정을 통과한 `review` 세트가 있어야 한다(`profile-set-required`). 이미 출전한 선수는 그대로다.
  판정 결과와 거절 이유는 `af_fighter_front`가 한 곳에서 답한다. 주인의 `GET /fighters/:id`가 `fighter.front`로, 출전 거절이 `front`로 싣는다.
  출전한 선수가 그를 출전시킨 정면을 잃고(판정 실패, 운영자 거절, 운영자 내리기) 남은 정면도 없으면 제작 중으로 돌아가고 `af_profile_set_events`에
  `front-lost`가 남는다. 출전시킨 정면은 승인된 세트, 판정을 통과한 세트, 그리고 예전 규칙으로 출전하기 전부터 `review`였던 세트다
  (`af_profile_set_counted`). 정면 없이 출전한 선수(관문 전)는 처음 올린 그림이 떨어져도 출전한 채로 있다.

변경의 소유자는 [프로필 세트 마이그레이션](../supabase/migrations/20261031100000_oddbout_profile_sets.sql)과 [프로필 세트 API](../api/profile-sets.mjs),
검증은 `worker/profile-sets.mjs`·`worker/profile-set-check.mjs`, 정면 판정은 [정면 판정 마이그레이션](../supabase/migrations/20261103130000_oddbout_profile_front_check.sql)과
`host/generation-worker.mjs` `createFrontCheck`다. 마이그레이션 두 개(`…100000`, 검증 작업자 깨우기 `…100100`)를 먼저 적용하고
API·MCP·검증 작업자를 갱신한다.
