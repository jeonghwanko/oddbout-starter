# 문서 지도

이 폴더의 문서를 어떤 순서로 읽으면 되는지 안내한다. 각 문서가 무엇을 다루는지는 한 줄씩만 적는다.
규칙과 세부 내용은 각 문서에 있다.

creator-kit ZIP에는 제작·연결 안내와 이 문서 지도가 들어 있다. 지도에 있는 저장소 전용 운영·연구 문서는 ZIP에 없을 수 있으므로
[저장소의 문서 폴더](https://github.com/jeonghwanko/oddbout-starter/tree/main/docs)에서 확인한다.

## 처음이라면

- **ChatGPT/Dots에서 연결·계정·스킬만 확인하려는 사용자**: [CLOUD-MCP](CLOUD-MCP.md) → [ODDBOUT-PLUGIN](ODDBOUT-PLUGIN.md).
  기존 클라우드 플러그인을 선택한다. ZIP 가져오기나 VM 설치, 캐릭터 생성은 연결 확인에 필요하지 않다.
- **선수를 만들려는 사용자·제작 에이전트**: [START-HERE](START-HERE.md) → [DOT-CREATION](DOT-CREATION.md) →
  [AUTHORING](AUTHORING.md) 순서로 읽는다.
- **이 저장소의 코드를 고치는 사람**: 먼저 [../AGENTS.md](../AGENTS.md)(작업 규칙·저장소 지도·명령·배포 경로)를 읽고, 그다음
  [CREATION-UX](CREATION-UX.md)와 [GAIT-REVIEW](GAIT-REVIEW.md)를 읽는다. 고치는 영역의 문서는 아래 표에서 찾는다.
- **코딩 에이전트(Claude Code·Codex·Grok)**: Codex는 AGENTS.md를 자동으로 읽고, Grok은 신뢰한 폴더에서 읽는다(headless는
  `--trust`). Claude Code는 CLAUDE.md의 `@AGENTS.md` 가져오기로 읽는다. 공통 규칙은 AGENTS.md 한 곳에만 쓴다.
- **서비스나 생성 PC를 운영하는 사람**: [CREATOR-HOSTING](CREATOR-HOSTING.md), [CLOUD-MCP](CLOUD-MCP.md),
  [GENERATION-HOST](GENERATION-HOST.md)부터 읽는다. 운영 배포는 게임 저장소에서 한다(AGENTS.md).

## 제작

| 문서 | 다루는 것 |
| --- | --- |
| [START-HERE](START-HERE.md) | Dot과 대화하며 내 캐릭터 만들기: 클라우드 규격, 로컬 맥락·가이드, 검토 묶음과 등록 |
| [DOT-CREATION](DOT-CREATION.md) | 외형을 실제로 보여 준 뒤 그 원화로 애니메이션을 만드는 흐름(sprite-gen) |
| [AUTHORING](AUTHORING.md) | 새 선수의 애셋과 `fighter.json` 규격 |
| [CREATION-UX](CREATION-UX.md) | 사용자와 대화하는 제작 에이전트의 행동 규격 |
| [DELIVERY](DELIVERY.md) | 외형 생성 전, 현재 대화에 그림을 실제로 보여 줄 수 있는지 확인 |
| [GAME-CREATION-CONTEXT](GAME-CREATION-CONTEXT.md) | 게임이 제공하는 모션·프레임·조작 정의로 대화하기 |
| [CONNECTION-READINESS](CONNECTION-READINESS.md) | ODDBOUT 연결과 제작 준비 상태 확인 |
| [OPEN-REGISTRATION](OPEN-REGISTRATION.md) | 가입 후 제작·검토·업로드·검사·등록: 연결된 클라우드 계정 사용 |
| [DOT-DIALOGUE-ONLY](DOT-DIALOGUE-ONLY.md) | 생성 없이 실제 Dot에서 대화 흐름만 시험하기 |
| [LOCAL-VOICE](LOCAL-VOICE.md) | 사용자 PC의 VoiceStudio로 음성 만들기 |

## 플러그인과 작업 공간

| 문서 | 다루는 것 |
| --- | --- |
| [ODDBOUT-PLUGIN](ODDBOUT-PLUGIN.md) | 단일 호스팅 MCP와 로컬 생성 CLI로 전환하기; 등록은 연결된 계정 사용 |
| [LOCAL-PLUGIN](LOCAL-PLUGIN.md) | 로컬 파일·작업 공간은 `creation:tool` CLI, 클라우드 작업은 단일 MCP; stdio는 호환용 |
| [PLUGIN-DISTRIBUTION](PLUGIN-DISTRIBUTION.md) | 배포판(현재 판)과 설치 파일 풀기 |
| [EXECUTION-HOST](EXECUTION-HOST.md) | 에이전트가 쓰는 작업 공간의 준비·계정·격리·보존·보안 기준 |
| [ENVIRONMENT-ONBOARDING](ENVIRONMENT-ONBOARDING.md) | Dots 제작 환경의 계정 연결 |
| [DOTS-QUICKSTART](DOTS-QUICKSTART.md) | Dots: 한 번 준비하고 같은 선수를 이어서 만들기 |
| [DOTS-START](DOTS-START.md) | 저장된 Dots 환경의 시작 지시 |
| [DOTS-VM-ARCHITECTURE](DOTS-VM-ARCHITECTURE.md) | Dots VM 제작 경로의 구성 |
| [DOTS-PRIVATE-SOURCES](DOTS-PRIVATE-SOURCES.md) | 비공개 원본을 저장된 VM으로 옮기기 |

## 동작 품질 검수

| 문서 | 다루는 것 |
| --- | --- |
| [GAIT-REVIEW](GAIT-REVIEW.md) | 보행 설계와 등록 전 검수 |
| [FOOT-EVIDENCE](FOOT-EVIDENCE.md) | 분리된 접촉면·들린 뒤꿈치 검토 |
| [PROJECTED-GROUND](PROJECTED-GROUND.md) | 화면상 바닥 높이가 다른 양발 검토 |
| [SERVER-DECISIONS-REVIEW](SERVER-DECISIONS-REVIEW.md) | 호스팅 제작의 서버 보조 검수(Decisions → Responses) |
| [ANIMATION-REVIEW-EVALUATION](ANIMATION-REVIEW-EVALUATION.md) | 동작 검수 판단을 사람 판정과 비교하는 오프라인 평가 |

## 서비스와 운영

| 문서 | 다루는 것 |
| --- | --- |
| [CREATOR-HOSTING](CREATOR-HOSTING.md) | ODDBOUT 사이트·API·검증 작업자의 호스팅 구성 |
| [CLOUD-MCP](CLOUD-MCP.md) | 단일 호스팅 MCP(`mcp.oddbout.com`) 연결과 계정 확인을 통한 등록 |
| [GENERATION-HOST](GENERATION-HOST.md) | 호스팅 생성 신청을 실제로 그리는 생성 PC 되기 |
| [SINGLE-SUBSCRIPTION-HOSTS](SINGLE-SUBSCRIPTION-HOSTS.md) | 구독이 하나뿐인 호스트를 받을 수 있는지와 그 설계(구현 전) |
| [MEASUREMENT](MEASUREMENT.md) | 호스팅 생성이 나아졌는지 보는 측정과 export |
| [DOMAIN-SETUP.ko](DOMAIN-SETUP.ko.md) | 도메인 DNS와 GitHub Pages, 정책 페이지 공개 |

## 기록 — 지난 점검과 평가

아래 문서는 당시의 결과를 남긴 것이다. 지금의 절차가 아니다. 현재 규칙은 위 문서와 AGENTS.md를 따른다.

| 문서 | 기록 |
| --- | --- |
| [ADVERSARIAL-REVIEW](ADVERSARIAL-REVIEW.md) | 2026-10-19 적대적 리뷰: 실패 입력과 출시 차단 조건 |
| [CREATION-UX-EVALUATION](CREATION-UX-EVALUATION.md), [CREATION-UX-DIALOGUE-TEST](CREATION-UX-DIALOGUE-TEST.md), [CREATION-UX-REGRESSION-RESPONSES](CREATION-UX-REGRESSION-RESPONSES.md) | 2026-10-21 제작 대화 평가 |
| [DOTS-CLOUD-REGISTRATION-AUDIT](DOTS-CLOUD-REGISTRATION-AUDIT.md) | 2026-10-24 Dots 클라우드 생성·등록 점검 |
| [DOTS-VM-ACCEPTANCE](DOTS-VM-ACCEPTANCE.md) | Dots VM 인수 시험(0.5.5 후보) |
| [CLOUD-PLUGIN-REVIEW](CLOUD-PLUGIN-REVIEW.md), [PLUGIN-POLICY-AND-VIDEO](PLUGIN-POLICY-AND-VIDEO.md), [PLUGIN-REVIEW-CASES](PLUGIN-REVIEW-CASES.md) | 2026-10-22~24 플러그인 심사 준비와 상태 |
| [SUPABASE-BETA](SUPABASE-BETA.md) | 이전 초대 베타(v0.2)의 운영 기록 |
| [research/](research/) | 개별 조사·실험 기록 |
