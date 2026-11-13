# 한 판을 그대로 보고, X에 올릴 영상으로 받기

두 선수의 시드 한 판을 브라우저에서 그 결과 그대로 재생하고, 그 판을 X에 올릴 MP4로 만든다.
도구는 X에 로그인하지 않고 올리지도 않는다. 올리기는 사용자의 X 연결이 한다.

`spar`와 `browse_oddbout(view=bout)`(`read_bout`)의 `page`가 재생 주소다.
아레나가 `page: null`을 주면(등록 선수 둘) 여기서 같은 질의로 채운다.
`share`는 제안 캡션, `x.com/intent/post` 주소, 첫 답글에 넣을 `reply`다. `postsToX`는 언제나 false다.

```
https://oddbout.com/fighter.html?lang=ko&play=1&fighter=<a>&opponent=<b>&bout=<seed>&rules=<판>&d=<지문 8자>
```

`play=1`이 있으면 fighter.html은 구단(`club=1`)으로 바꾸지 않는다. 컵의 피로가 있으면 `st=<a>-<b>`가 붙는다.
지문 `d`가 스파의 `record.digest`와 같아야 그 판이다.

## 영상

`render_bout_video`가 그 판의 MP4를 청한다. 짝과 시드(스파가 준 시드, 지금 패키지) 또는 컵 경기(`cupId`, `round`, `slot`)를 준다.

| 필드 | 뜻 |
| --- | --- |
| `status` | `queued`, `rendering`, `ready`, `failed` |
| `digest` | 스파 기록의 지문. 영상이 그 판이라는 표다 |
| `video.url` | `ready`일 때만. 10분짜리 다운로드 주소 |
| `video.seconds`, `video.bytes`, `video.sha256` | 파일 |
| `caption`, `intent`, `reply` | 제안 글. 링크는 본문이 아니라 첫 답글 |
| `postsToX` | false |

같은 인자는 같은 영상이다. 그리는 중이면 같은 인자로 다시 부른다. `waitSeconds`(최대 20)는 그 호출 안에서만 기다린다.
한 계정의 진행 중 영상은 둘까지다. 넘치면 `bout-video-busy`.

그림은 H.264 High, yuv420p, 짝수 크기다. 16:9는 1280×720, 1:1은 720×720. 둘 다 X의 1280×1024 안이다.
앞 1.5초는 두 이름, 끝 1.8초는 ODDBOUT 엔드카드, 경기 위에는 구석 표시가 있다. `fighter:social`과 같은 표시다.
`trim: highlights`는 기록에 시각이 있을 때만 그 구간을 남긴다. 없으면 통째로 두고 `trim`이 `full`이다.

이 함수는 브라우저를 돌리지 않는다. 한 판은 호출 한도(25초)보다 길고, Render의 무료 검증기는 패키지 검사를 비우지 않아야 한다.
그리는 곳은 화면이 있는 공식 PC의 별도 프로세스다. 생성 워커나 검증기와 줄을 같이 쓰지 않는다.

```sh
AI_FIGHTER_PROJECT_URL=... AI_FIGHTER_WORKER_TOKEN=afw_... npm run bout:video-worker
```

토큰은 검증기 범위의 워커 토큰이다. 리눅스에 화면(`DISPLAY` 또는 `WAYLAND_DISPLAY`)이 있어야 한다.
화면 없이 그리려면 `ODDBOUT_BOUT_VIDEO_HEADLESS=1`. 게임 캔버스가 그 모드에서 비면 영상을 올리지 않는다.

페이지가 `window.oddboutBout`(`protocolVersion: 1`, `played`가 지문으로 끝나는 Promise)을 주지 않거나 주소가 구단이면
작업은 `playback-unavailable`로 실패한다. 구단 로비를 찍어 올리지 않는다. 지문이 기록과 다르면 `digest-mismatch`다.
렌더러는 훅이 나타난 시각을 경기 시작으로 본다. 녹화는 페이지를 열 때 시작하므로, 그 앞의 로딩 화면은 잘라 내고
하이라이트의 시작도 그 시각만큼 민다. 그래서 게임은 경기 화면이 시작될 때(그림이 다 들어와 READY가 뜰 때) 훅을 둔다.
화면 시간은 경기 시계보다 길다(READY → FIGHT!, KO 정지, 슬로). 그래서 끝은 자르지 않는다. `played`가 끝난 뒤 승자 화면을 2.5초 더 찍는다.
훅은 60초 안에 나타나야 한다. `played`는 지문 문자열이나 `{ digest }`로 resolve한다.
워커는 요청이 실패해도 꺼지지 않는다. 기록을 남기고 5초부터 최대 1분까지 늘려 기다린 뒤 다시 가져간다.

저장소에서 한 주소만 찍을 때:

```sh
npm run bout:video -- --url '<page>' --digest <8 hex> --out output/bout.mp4
```

테스트는 프로덕션을 부르지 않는다. 가짜 페이지와 가짜 저장소만 쓴다.

## 이 저장소가 하지 못하는 것

재생과 촬영은 게임(`jeonghwanko/crashbang-heroes`의 `kaito_web`)이 한다. 이 저장소의 대결 엔진은 빈 어댑터라 픽셀을 만들지 않는다.
2026-11-13 운영에서 등록 선수 둘의 `page`가 null이고, `play=1` 주소도 구단으로 떨어진 이유가 여기 있다.

| 게임 파일 | 지금 | 필요한 변경 |
| --- | --- | --- |
| `src/app/ArenaBoutLink.ts` `arenaBoutLinkShape` | 등록 선수(UUID)는 한 명까지 | 출전한 등록 선수 둘을 허용 |
| `server/oddbout-arena-engine.ts` `arenaBoutPageUrl` | 그 모양이면 null | 모양이 풀리면 주소가 생긴다. 이 저장소는 null일 때 같은 질의를 채운다 |
| `src/app/ArenaQuickStart.ts` `arenaQuickStartMatch` | UUID가 둘이면 null. 선택 화면이 구단을 연다 | 둘 다 대전 승인된 등록 선수면 그 시드로 연다 |
| 등록 선수 로더 | `arenaQuickStartRegistered`가 id 하나만 고른다 | 두 패키지를 읽어 `cityTournamentBoutSetup`에 넘긴다. 서버 시뮬은 이미 둘을 싸운다 |
| `fighter.html` 부트 | 훅이 없다 | 공유 경기가 실제로 시작되면 `window.oddboutBout = { protocolVersion: 1, played }`를 두고, 엔진 지문으로 resolve한다. 거절한 짝에는 두지 않는다 |

기본 선수 짝과 등록 선수+기본 선수는 게임이 이미 `play=1&fighter&opponent&bout&rules&d`로 연다.
등록 선수 둘은 위 변경이 사이트에 나가기 전에는 주소만 맞고 구단으로 떨어진다. 그때 영상 작업은 `playback-unavailable`이다.

사이트 게시는 게임 저장소의 `npm run publish:fighter`다. 이 저장소의 머지는 사이트를 올리지 않는다.

## 배포

머지해도 서비스는 안 바뀐다.

| 순서 | 하는 일 |
| --- | --- |
| 1 | 이 마이그레이션을 적용한다. `supabase/migrations/20261113210000_bout_videos.sql`. 버킷 `af-bout-videos`와 `af_bout_video_claim`. 클라이언트 정책은 없다 |
| 2 | 게임 저장소에서 `ai-fighter` 엣지를 배포한다. `worker/bout-video/claim`, `finish`, `fail`이 여기 있다 |
| 3 | 게임 저장소에서 `ai-fighter-mcp`를 배포한다. `page`를 채우고 `render_bout_video`가 목록에 나온다. 도구 목록이 19에서 20이 된다 |
| 4 | 위 게임 변경을 사이트에 게시한다. 그 전에도 주소는 돌아오지만, 등록 선수 둘은 재생되지 않고 영상은 `playback-unavailable`이다 |
| 5 | 화면이 있는 PC에서 `npm run bout:video-worker`를 켠다. 검증기 프로세스 안에 넣지 않는다 |

키트 릴리스는 이 경로에 필요 없다. 도우미는 클라우드 도구만 부른다. 로컬 명령은 이 저장소 체크아웃에서 돈다.
