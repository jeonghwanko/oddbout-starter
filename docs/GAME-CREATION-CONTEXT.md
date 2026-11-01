# 게임 제공 구조 데이터로 대화하기

게임이 모션·프레임·조작계·경직 및 묶음 정의를 소유한다. 제작 도구는 그 응답을 읽고 현재 사용자의
콘셉트·선택·수정을 따로 보관한다. 사용자가 JSON을 작성하거나 기술 수치를 고를 필요는 없다.

## 자료 읽기

- [규격이 포함된 제작 시작 문서](https://github.com/jeonghwanko/oddbout-starter/blob/codex/game-context/START-HERE.md)와
  [대화 시험 문서](https://github.com/jeonghwanko/oddbout-starter/blob/codex/game-context/DIALOGUE-ONLY.md)는 같은 JSON을 포함한다.
  게임이 생성·게시하며, 첫 링크를 읽을 때 구조 데이터가 빠지는 일을 줄인다. 첫 응답에 읽은 revision 앞 12자리를 표시한다.
- [현재 게임 제공 JSON](https://raw.githubusercontent.com/jeonghwanko/oddbout-starter/refs/heads/codex/game-context/creation-context.json)
- 작업 공간 MCP/로컬 `creation:tool`: `get_fighter_spec`의 `section: "context"`. `group`을 주면 해당 묶음의 모션 규격만 받는다.
  연결된 클라우드 MCP에도 이 section이 있다고 가정하지 말고 실제 도구 스키마를 확인한다.
- CLI: `npm run creation:context`. 로그인·생성 계정 접근 없이 읽는다.

이 공개 주소는 게임의 `tools/ai-fighter/publish-creation-context.mjs`가 갱신하는 배포 채널이다.
제작 저장소에서 수치를 수동으로 작성하거나 고정 사본을 규칙 원본으로 쓰지 않는다.
게임 빌드는 같은 생성기로 `ai-fighter/creation-context.json`도 제공한다. 개발 규격 채널은 배포된
플레이 페이지와 버전이 다를 수 있으므로 `provenance.sourceCommit`과 `revision`을 기록한다.
게임의 수동 사이트 배포는 기존 Pages 배포 키로 같은 공개 저장소의 규격 브랜치도 갱신한다.
일반 소스 push만으로 배포나 CI를 시작하지 않는다. 시작 문서의 포함 JSON은 해당 게시 시점의 자료이며,
이후 묶음에서는 현재 JSON 주소로 갱신한다.

| 구조 | 쓰임 |
| --- | --- |
| `contract` | 필수 모션, 프레임 수, 재생 단계·시간 단위, 접촉과 보조 자세 |
| `controls` | 현재 기본 키·패드, 누름/유지/해제, 재지정 여부, 직접 입력이 없는 필수 애셋 |
| `timing` | 게임 시간·그림 시간·화면 시간, 피격/가드 경직, 취소, 입력 버퍼, 히트스톱 |
| `workflow` | 묶음 구성, 사용자가 바꾸는 연출, 다음 묶음 조건 |
| `revision`, `provenance` | 적용한 자료의 내용 식별자와 게임 원본 근거 |

새 제작·재개·새 묶음·패키징 전에 다시 가져온다. 작업 중 revision이 바뀌면 이전 자료와 선택을
보존하고 달라진 요구만 설명·검토한다. 받을 수 없으면 외형 상담은 가능하지만 기술 수치를 추정하거나
규격에 의존하는 후속 묶음·실제 생성·패키징을 진행하지 않는다.

### Network errors and existing workspaces

Node CLI는 호스트에서 물려받은 HTTP(S) 프록시·`NO_PROXY`·CA 설정을 사용한다. 프록시 실패 시 직접 연결로 재시도하지 않는다.
샌드박스의 `EPERM` 같은 연결 차단은 키트가 해제할 수 없으므로, 호스트가 제공하는 정상 네트워크 실행 승인 절차로 확인한다.
코드는 승인 요청이나 권한을 높인 재실행을 자동으로 하지 않는다.

Creator-kit 0.6.5부터 `fetchCreationContext()`의 기본 전송은 `api/runtime-fetch.mjs`의 `runtimeFetch`다.
CLI뿐 아니라 제작 세션·작업에서 호출하는 공개 데이터 조회에도 같은 설정이 적용된다.
`EAI_AGAIN`은 해당 경로의 DNS 조회 실패이며, 계정 인증 실패나 서버 장애를 뜻하지 않는다.
프록시를 적용한 뒤 HTTP 응답 전에 `EPERM`이 발생하면 호스트의 실행 권한을 확인한다.
허용 목록에 도메인이 있는 것만으로 현재 실행의 연결 권한까지 확인된 것은 아니다.
프록시를 제거하거나 TLS 검증을 끄거나 직접 연결로 우회하지 않는다.

이 수정의 배포 대상은 제작 키트다. 서버 재배포나 ZIP 공개로 이미 설치된 Dots 런타임이 바뀌지는 않는다.
`node dots.mjs --install`은 `deploy/dots-release.json`이 고정한 커밋을 설치하므로, 새 Dots 작업 공간도
그 고정이 0.6.5 이상일 때만 이 수정을 받는다.
진행 중인 작업에서는 저장소를 pull하거나 런타임을 교체하지 않고 세션·작업 ID·선택 버전·원본 결과를 보존한다.
이미 승인된 프록시 사용 실행 경로가 있으면 같은 런타임에서 이어간다. 기존 결과와 미완료 실행을 먼저 확인하며,
연결 확인을 위해 생성 명령을 다시 실행하지 않는다. 새 키트 설치는 별도 검토한 새 환경 또는 제작 종료 후의 갱신으로 다룬다.

Grok의 기기 로그인 승인은 생성 계정 접근이고, 명령의 네트워크 실행 승인은 별개다. 기본 실행에서 난
`EPERM`만으로 이전에 승인된 Grok 생성도 불가능했다고 판단하지 않는다. 기존 실행의 종료 상태와
`sprite-gen-video-report`의 provider·auth_source·request_id, 저장된 원본을 먼저 확인한다.
호스트가 허용하는 명령별 승인 절차가 있으면 그 절차로 읽기 전용 연결을 확인하되, 거부되거나 지원하지
않으면 중단한다. 프록시·허용 목록·TLS 정책을 바꾸거나 권한을 자동으로 높이지 않는다.
HTTP 응답은 도달성 근거일 뿐 로그인·영상 생성 성공 증명이 아니다.
명령별 승인 도구가 샌드박스 밖 실행을 허용하는 경우에는 그 권한 범위를 정확히 설명한다.
이를 네트워크 전용 승인이나 기본 실행과 동일한 파일시스템 격리라고 보고하지 않는다.

### Explicit public-context file handoff

VM 네트워크가 막혀도 연결된 GitHub 도구가 같은 공개 JSON을 읽을 수 있고 호스트가 공식 파일 전달을
허용하면, 에이전트는 그 원본을 별도 파일로 전달해 사용할 수 있다. 공개 게임 규격에만 쓰는 명시적
입력 경로이며 Grok 인증·추론·영상 다운로드를 대행하는 프록시가 아니다. 기본 네트워크 조회는 그대로다.

1. 연결된 GitHub 도구로 `jeonghwanko/oddbout-starter`의 `codex/game-context` 브랜치에서
   `creation-context.json` **전체 원본 바이트**와 반환된 Git blob SHA를 가져온다. 요약·줄별 발췌·재작성한
   JSON은 쓰지 않는다. 도구가 실패하거나 일부만 반환하면 중단한다.
2. 실제 조회 시각(UTC), 설정된 원본 URL, 반환된 Git blob SHA-1, 원본 바이트의 SHA-256을 receipt에 기록한다.
   SHA-256과 Git blob 해시는 원본 바이트로 계산·대조한다. 계정 정보나 토큰은 포함하지 않는다.
3. 호스트의 공식 파일 첨부/전달 기능으로 JSON과 receipt를 새 임시 폴더에 옮긴다. 받은 파일을 아래 명령에
   명시한다. 작업 공간의 런타임·환경 변수·세션 파일을 교체해 이 경로를 강제하지 않는다.

Receipt 형식(값은 실제 조회 결과로 채우며 예시 문자열을 그대로 사용하지 않는다):

```json
{
  "schemaVersion": 1,
  "sourceUrl": "https://raw.githubusercontent.com/jeonghwanko/oddbout-starter/refs/heads/codex/game-context/creation-context.json",
  "gitBlobSha1": "<GitHub가 반환한 40자리 blob SHA>",
  "sha256": "<원본 바이트의 64자리 SHA-256>",
  "retrievedAt": "<실제 조회 UTC 시각, ISO 8601>"
}
```

```sh
node scripts/creation-context.mjs --context-file /scratch/context.json --context-receipt /scratch/receipt.json
node scripts/creation-context.mjs /scratch/review-state.json --context-file /scratch/context.json --context-receipt /scratch/receipt.json
node scripts/creation-tool.mjs call /scratch/workspace inspect_creation_session /scratch/arguments.json --context-file /scratch/context.json --context-receipt /scratch/receipt.json
```

두 플래그는 한 호출에 함께 제공한다. 컨텍스트는 최대 128 KiB, receipt는 최대 4 KiB의 일반 파일이어야 한다.
키트는 설정된 원본 URL, 두 해시, UTF-8과 구조, 실제 조회 후 15분 이내인지 매 요청마다 검사한다.
미래 시각·기한 만료·변조·불완전한 입력은 거부하며 네트워크로 자동 재시도하지 않는다.
Receipt는 **서명이나 독립적인 최신성 증명은 아니다**. 에이전트가 확인한 신뢰할 수 있는 조회 기록을
옮기는 메타데이터다. 파일 옆에 해시를 만들었다고 출처가 검증되는 것은 아니며, 만료된 파일의 시각만
새로 쓰지 않는다. 새 제작·재개·새 묶음·패키징 경계마다 실제 최신 원본을 다시 가져온다.

이 입력은 기존 revision 비교와 선택·동작 품질·접지 검수를 모두 유지한다. 파일 읽기 성공을
`review: passed`나 생성/등록 승인으로 바꾸지 않는다. 실행 작업의 Grok 통신은 기존 승인된 경로를
사용하며, 이 플래그가 작업 실행기에 네트워크 권한을 주거나 생성 명령을 재실행하지 않는다.

## 규칙과 연출

`workflow.groups`의 모션 ID와 필수 항목을 유지한다. 필살기 조작이 있어도 별도 필수 클립이라는 뜻은
아니다. `controls.actions[].motion`과 `unboundRequired`를 확인한다. 그림의 접촉 번호는 게임의 피해
횟수나 경직 수치가 아니다. 사용자가 바꾸는 것은 자세·무게감·표정·준비·접촉·회수의 표현이다.
접촉 박자는 게임 어댑터에 맞춘다. 실제 조작 잠금·취소·히트스톱은 게임이 정하며 패키지가 덮어쓰지 않는다.

`optional: true`인 묶음(현재 `style`: `skill`·`entrance`·`victory`와 싸우는 성격)은 통째로 건너뛸 수 있다.
그 동작은 `contract.optionalMotions`에 있고, `review_creation_progress`의 차단 사유가 되지 않는다.
사용자가 고른 선택 동작은 다른 동작처럼 버전·검수·선택을 기록하며, 미완료 상태는 `optionalPending`에 보인다.
패키지에 넣는 선택 동작은 고르고 검수한 현재 버전이어야 한다(`package-optional-clip-unreviewed`).

## 현재 대화의 상태

`creation-session.json`은 제출할 `fighter.json`과 별개다. 여기에는 현재 대화에서 실제로 받은 답만 기록한다.
`contextRevision`, `groupId`, `mode`, 동작/기상별 `version`, `selectedVersion`, `review`,
`pendingEdits`, `delegatedGroups`, `profile`을 보관한다. provider 확인은 현재 사용자·기능별 범위를 유지한다.

- 외형 세부 선택은 `idle` 현재 버전의 전체 선택이 아니다.
- 수정은 영향을 받은 항목만 새 버전으로 만든다. 새 버전은 미선택·미검수 상태로 시작한다.
- 선택된 항목을 다시 묻지 않는다. 마지막 미확정 항목이 선택되면 다음 묶음으로 넘어간다.
- 뒤 묶음을 맡겨도 앞 묶음의 미확정 항목은 남는다. 위임도 실제 파일 검사를 생략하지 않는다.
- 대화 시험은 `mode: "dialogue-only"`, `review: "hypothetical"`. 실제 제작에서는 검수 `passed`가 필요하다.

묶음 전환 전에 `review_creation_progress`에 `stateJson`을 보내거나
`npm run creation:context -- <creation-session.json>`을 실행한다. 현재 게임 revision, 모션 집합,
이전·현재 묶음의 선택 버전·검수·보류 수정을 검사한다. `canAdvance: false`이면 `blockers`에 남은
항목만 처리한다. 도구가 없으면 같은 조건을 직접 대조하고 도구 검증을 주장하지 않는다.

사용자 표현의 의미를 이 검사기가 자동 판단하는 것은 아니다. 에이전트가 실제 피드백의 범위를
올바르게 기록해야 한다. 등록 요청·생성 권한·검수 사실을 검사기가 만들어 주지 않는다.
