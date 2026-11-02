# PayPal G0~G8 실행 준비 점검 — 2026-11-03 KST

외부 데모 준비와 로컬 재현 기록이다. 어느 G도 이 기록만으로 전체 통과 처리하지 않는다.

## 기준과 실행 결과

- Starter 공개 main 기준: `f2c4b17ddb396f2a54078abf22a6b20cb292bb60` + 이 변경.
- Cup 공개 main: `c83632d95ea64efd5fd9cb07b1f674cdf0fd754d`.
- 공유 checkout을 바꾸지 않고 별도 새 worktree에 `npm ci`로 각각 설치. Node `22.22.2`.
- Starter 관련 검사 `node --test --test-reporter=spec test/commerce-*.test.mjs test/broadcast-*.test.mjs`: 125개 통과. 브라우저 선택 추가 후 runner 26개 재검사 통과(신규 1개 포함). `npm run typecheck` 통과.
- `npm run broadcast:check-ui`: 실제 Chrome, mocked auth/HTTP 검사 1개 통과.
- Cup `npm run check`: 139개 테스트, 타입 검사, 빌드 통과. 기존 500kB 청크 경고는 남음.
- 별도 source archive에 `npm ci --omit=dev --ignore-scripts`: 119개 패키지 설치. 이 설치만으로 공개 bind·HTTPS/Host·인증 거부·공개 클라이언트 JS·비밀키 비노출 검사 4개 통과.
- `deploy/broadcast.render.yaml`: Render가 제공하는 `https://render.com/schema/render.yaml.json`으로 JSON Schema 검증 통과. 실제 Render 배포는 하지 않았다.

## 실제 경기 재현

Cup 빌드를 `127.0.0.1:5198`에서 제공하고 다음 명령을 실행했다.

```powershell
$env:ODDBOUT_BROADCAST_BROWSER_CHANNEL='chrome'
npm run broadcast:check-renderer -- http://127.0.0.1:5198/broadcast.html
```

- 2026-11-03 06:33:43.767~06:35:57.500 KST, 총 133.733초(브라우저 준비·정리 포함).
- kuma/yume/bravow/beotim, seed 123, 124, 125; 실제 3경기 완료, 최종 우승 yume.
- 관측 digest: `4c99b17b`, `51cbeb4f`, `3d090aff`. 실행 결과를 정상 runner의 validator로 검증했다.
- 로컬 증거: `output/render-check-9b384c47-2bc0-455f-9ae3-4f2ba0209250.json`.
- 앞선 bundled Chromium 실행은 `spawn UNKNOWN`으로 경기 dispatch 전 실패했다. 설치된 Chrome을 명시한 뒤 완료했다. 실패 기록도 보존했다. 자동 fallback은 구현하지 않았다.
- 이 실행은 DB/PayPal/모델/OBS/Twitch를 호출하지 않았고 `broadcastVerified: false`, `liveSeconds: null`이다.

## 외부 실행에 남은 조건

| 구간 | 현재 확인 | 다음 통과 조건 |
| --- | --- | --- |
| G0 | 공개 소스 설치·렌더 재현, 외부 서버/배포 설정 준비 | 실제 HTTPS 서비스, 전용 DB, PayPal 앱/테스트 계정 연결 |
| G1 | 원장·결제 fixture 검사 통과 | PayPal Sandbox 승인/capture, 중복·취소·webhook 실측 |
| G2 | 예산·MCP 권한 검사 통과 | 승인된 세션과 실제 모델/MCP 행동·비용 기록 |
| G3 | 실제 3경기 + worker/원장 자동검사 | 외부 API claim부터 경기 완료·한 번 차감까지 통합 실행 |
| G4 | OBS 설치 확인; WebSocket 비활성, OBS 실행 안 됨 | 채널/ingest 검증 구현, 실제 30분 송출·복구 |
| G5 | producer 구현/자동검사 | 선택 모델·계정·지출 상한, 실제 2시간 운전·리포트 |
| G6 | 실행 전 | 고정 버전 실제 24시간, live 시간/단절/원장 일치 증거 |
| G7 | 새 worktree 설치·로컬 실행, 영문 호스팅 안내 | 외부 통합 재현·최종 제출 문서 |
| G8 | 실행 전 | 영상·공개 데모·라이선스·고정 SHA·제출 |

이번 환경에는 해커톤용 `.env`/host inventory와 관련 프로세스 환경 값이 없었다.
연결된 Supabase 목록에서 전용 테스트 프로젝트를 식별하지 못했으므로 기존 DB에는 SQL을 적용하지 않았다.
모델·방송 채널·상시 호스트·지출 한도도 정해지지 않았다. 이들은 코드 검사 성공으로 대체할 수 없다.

외부 구성과 실행 절차: [BROADCAST-HOSTING](../BROADCAST-HOSTING.md).
