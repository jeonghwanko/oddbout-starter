# ODDBOUT 공개 조회 캐시

`oddbout-public-api` Worker는 사이트와 같은 출처에서 다음 공개 GET을 받는다.

| 경로 | 허용 쿼리 |
| --- | --- |
| `/api/ai-fighter/rankings` | 없음 |
| `/api/ai-fighter/roster` | 없음 또는 `after` 한 개. API가 발급한 `시각\|UUID` 커서 |
| `/api/oddbout-arena/rankings` | 없음 또는 `scope=registered` |

다른 경로와 메서드, 중복·미등록 쿼리, 다른 `Origin`, `Authorization`·`Cookie`·`apikey`가 든 요청은 거절한다. 브라우저는 `credentials: 'omit'`으로 요청한다. 로그인, 개인 조회, 경기 쓰기는 해당 Supabase 함수에서 처리한다.

Worker는 운영 Supabase 함수에 `x-region: ap-southeast-1`을 보낸다. 성공한 200 JSON에서 `ok`가 `true`이면 Cloudflare 데이터센터별 캐시에 15초 보관한다. 원본 응답에 쿠키가 있을 때는 Supabase 앞의 Cloudflare 봇 관리 쿠키 `__cf_bm`만 확인된 경우 캐시한다. 캐시와 클라이언트 응답에는 원본 쿠키를 넣지 않는다. 최대 본문 크기는 128 KiB이며 원본 응답 제한 시간은 4초다. 캐시 키에는 요청 출처의 URL 호스트, 허용 경로, 정규화한 쿼리와 스키마 판이 들어간다. 응답은 클라이언트에 `Cache-Control: no-store`를 보낸다.

`x-oddbout-cache`로 `MISS`, `HIT`, `BYPASS`를 구분한다. 캐시를 사용하면 `x-oddbout-cache-age`에 경과 초를 보낸다. `x-sb-edge-region`은 원본이 보고한 리전이며 `HIT`에서는 캐시를 채울 때의 리전이다. 원본을 직접 확인하려면 Worker 요청에 `Cache-Control: no-cache`를 넣어 캐시 읽기와 쓰기를 건너뛴다.

## 배포와 확인

1. `node --test test/public-api.test.mjs test/public-api-worker.test.mjs`로 공개 경계, 캐시, 오류 처리와 실제 Worker 진입점을 확인한다.
2. `npx wrangler deploy -c cloudflare/public-api/wrangler.toml --env staging`으로 격리된 `workers.dev`에 배포한다. staging에는 `oddbout.com` 경로가 연결되지 않는다.
3. staging에서 세 GET과 잘못된 쿼리, 자격증명 거절, `x-sb-edge-region`을 확인한다. `workers.dev`는 Cache API의 실사용 적중을 검증할 수 없다. [Cloudflare Cache API 배포 요건](https://developers.cloudflare.com/r2/examples/cache-api/)
4. `npx wrangler deploy -c cloudflare/public-api/wrangler.toml`로 운영에 배포한다. `wrangler.toml`이 `oddbout.com/api/*` 경로를 관리한다. 사이트가 새 경로를 사용하기 전에 운영 경로를 직접 확인한다. 같은 데이터센터에서 15초 안에 연속 요청을 보내 `MISS` → `HIT`와 `x-sb-edge-region`을 확인하고 사이트의 직접 조회 예비 경로를 확인한다.

## 되돌리기

이전 Worker 판이 있으면 `npx wrangler rollback -c cloudflare/public-api/wrangler.toml`로 되돌린다. 첫 배포를 취소하려면 Cloudflare에서 `oddbout-public-api`의 `oddbout.com/api/*` 경로를 제거한다. 사이트는 공개 조회가 실패하면 싱가포르 Supabase 함수로 직접 요청한다. Worker의 다음 배포는 설정에 따라 경로를 다시 연결한다.
