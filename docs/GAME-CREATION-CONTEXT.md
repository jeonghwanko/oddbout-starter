# 게임 제공 구조 데이터로 대화하기

게임이 모션·프레임·조작계·경직 및 묶음 정의를 소유한다. 제작 도구는 그 응답을 읽고 현재 사용자의
콘셉트·선택·수정을 따로 보관한다. 사용자가 JSON을 작성하거나 기술 수치를 고를 필요는 없다.

## 자료 읽기

- [규격이 포함된 제작 시작 문서](https://github.com/jeonghwanko/oddbout-starter/blob/codex/game-context/START-HERE.md)와
  [대화 시험 문서](https://github.com/jeonghwanko/oddbout-starter/blob/codex/game-context/DIALOGUE-ONLY.md)는 같은 JSON을 포함한다.
  게임이 생성·게시하며, 첫 링크를 읽을 때 구조 데이터가 빠지는 일을 줄인다. 첫 응답에 읽은 revision 앞 12자리를 표시한다.
- [현재 게임 제공 JSON](https://raw.githubusercontent.com/jeonghwanko/oddbout-starter/refs/heads/codex/game-context/creation-context.json)
- MCP: `get_fighter_spec`의 `section: "context"`. `group`을 주면 해당 묶음의 모션 규격만 받는다.
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
