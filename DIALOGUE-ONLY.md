# AI Fighter 대화 흐름 시험

이 링크 하나가 시작 요청입니다. 시작 여부를 다시 묻지 마세요.
이 문서에는 게임이 직접 생성한 현재 규격이 아래 JSON으로 포함되어 있습니다.
다른 안내만 읽고 규격을 읽었다고 간주하지 마세요. 첫 응답 전에 아래 JSON의
revision, workflow, contract, controls, timing을 읽고 이번 대화의 기준으로 저장하세요.
첫 응답에는 “게임 규격 e36f33fa839d 기준”이라고 출처를 짧게 밝히고,
캐릭터 설명이나 참고 이미지를 요청하세요. 사용자에게 기술 수치를 고르라고 하지 마세요.

## 이번 대화의 범위

실제 제작 없이 묶음별 대화만 시험합니다. mode는 dialogue-only, 모든 검수는 hypothetical입니다.
현재 링크 메시지 이후의 사용자 입력과 이 공개 규격만 사용하세요. 이전 Dot·ChatGPT·Codex 대화,
기존 캐릭터·개인 메모·과거 시험 결과를 조회하거나 사용하지 마세요. 알고 있던 이름·선택·구독 확인도 이어받지 마세요.
이미지·영상·스프라이트·패키지 생성과 편집, 설치, 생성 계정 접근, 로그인, 업로드·등록·배포는 실행하지 마세요.
별도 채팅·작업·하위 에이전트에 맡기지 말고 이 Dot 대화에서만 응답하세요.
사용자가 시안이나 검수를 봤다고 말해도 모의 상황입니다. 실제 파일·미리보기·검사 성공을 주장하지 마세요.
한 번에 다음 응답만 하고 사용자 답을 기다리세요. 사용자 답을 대신 만들거나 전체 시험을 혼자 끝내지 마세요.
시험 종료 요청을 받으면 멈추세요. 실제 생성으로 바꾸려면 이후 명시적인 새 요청이 필요합니다.

## 대화 진행

workflow.groups 순서대로 진행합니다. 지금 묶음에 필요한 규격만 쉬운 말로 설명하세요.
외형 세부사항을 정한 답은 외형 전체의 선택이 아닙니다. 외형 전체가 선택될 때까지 이동 구상을 먼저 묻지 마세요.
사용자가 이름 붙여 칭찬한 항목만 현재 버전 선택으로 기록하고, 바꾼 항목만 새 미선택 버전으로 만드세요.
이전 선택과 영향 없는 모션은 보존하세요. 마지막 보류 항목이 선택되면 전체를 다시 확인하지 말고 다음 묶음으로 가세요.
묶음의 필수 motion ID를 유지하세요. 조작에 필살기가 있다고 필수 공격을 대체하지 마세요.
getUp은 fall의 보조 자세이며 방어·피격 묶음에서 별도로 피드백을 받을 수 있습니다.
사용자가 바꾸는 것은 자세·표정·무게감·포즈의 박자입니다. 게임의 경직·충전·입력 잠금은 바꾸지 마세요.
review_creation_progress가 연결되어 있으면 선택 상태를 검사하고, 없으면 workflow.gates를 직접 대조하세요.
도구를 실행하지 않았다면 도구 검사에 통과했다고 하지 마세요. 최종 확인도 등록 실행 허가를 뜻하지 않습니다.

## 자료 갱신

이 문서는 게임 소스에서 자동 생성한 시작 시점의 스냅샷입니다. 현재 revision: e36f33fa839d232487f3ed6d92e6eecf9494a79d871cd6bdc14af6be61b12ddd
새 묶음·재개·패키징 전에 [현재 게임 JSON](https://raw.githubusercontent.com/jeonghwanko/oddbout-starter/refs/heads/codex/game-context/creation-context.json)을 다시 읽고 revision을 비교하세요.
바뀌면 이전 자료·선택을 보관하고 영향을 받은 항목만 설명·재검토하세요. 가져오지 못하면 그 사실을 말하고,
외형 상담만 계속할 수 있습니다. 규격에 의존하는 묶음으로 진행하거나 수치를 추정하지 마세요.
개발 규격의 배포본이며, 현재 플레이 사이트의 배포 완료를 보증하지 않습니다.
Dot의 제품 기억을 초기화하는 기능은 아닙니다. 이전 기록의 조회·사용을 금지하는 대화 범위입니다.

## 게임 제공 구조 데이터

```json
{
  "contextVersion": 1,
  "specVersion": "ai-fighter-side-v1",
  "owner": "game",
  "scope": {
    "runtime": "arena-player-v1",
    "meaning": "Player-controlled arena authoring; opponent AI and server duels use separate rules.",
    "localizedMeaning": "현재 게임의 플레이어 조작과 제작 계약. 상대 AI·서버 자동 대전의 규칙과 구분한다.",
    "packageMayOverrideCombat": false
  },
  "contract": {
    "input": {
      "manifest": "fighter.json",
      "assetsDirectory": "assets",
      "animationMetadata": "inline:clips",
      "imageEncoding": "static-webp-with-alpha",
      "frameIndex": "zero-based-row-major",
      "originUnit": "frame-local-pixels",
      "durationUnit": "milliseconds",
      "frames": "contiguous-zero-based",
      "landmarks": "sequence-step-indices-except-borrowed-frame",
      "mirror": "right-source-left-runtime-flip",
      "bodyHeight": 400,
      "cameraElevationDegrees": 16
    },
    "limits": {
      "jsonBytes": 262144,
      "assetBytes": 4000000,
      "packageAssetBytes": 10000000,
      "assetCount": 16,
      "imageDimension": 4096,
      "imagePixels": 16777216,
      "packagePixels": 33554432,
      "clipDurationMs": 10000
    },
    "motions": {
      "idle": {
        "kind": "gait",
        "frames": 1,
        "loop": false,
        "purpose": "정지 전신. 모든 동작과 같은 정체성."
      },
      "walk": {
        "kind": "gait",
        "frames": 16,
        "minFrames": 12,
        "maxFrames": 32,
        "loop": true,
        "purpose": "걷기 한 주기. 양발 교대, 같은 접지 기준."
      },
      "run": {
        "kind": "gait",
        "frames": 12,
        "minFrames": 10,
        "maxFrames": 16,
        "loop": true,
        "purpose": "달리기 한 주기. 양발 교대."
      },
      "fightIdle": {
        "kind": "action",
        "loop": true,
        "minHits": 0,
        "maxHits": 0,
        "purpose": "전투 준비 자세 반복."
      },
      "combo": {
        "kind": "action",
        "loop": false,
        "minHits": 3,
        "maxHits": 8,
        "purpose": "3개 구간으로 나누어 재생할 연타. 접촉 시점 최소 3개."
      },
      "slam": {
        "kind": "action",
        "loop": false,
        "minHits": 1,
        "maxHits": 1,
        "purpose": "강타의 준비·접촉·회수."
      },
      "dash": {
        "kind": "action",
        "loop": false,
        "minHits": 0,
        "maxHits": 1,
        "purpose": "돌진. 준비와 회수는 같은 선수의 명시한 프레임 사용."
      },
      "block": {
        "kind": "action",
        "loop": false,
        "minHits": 1,
        "maxHits": 1,
        "purpose": "가드와 막기. 접촉 직전 단계가 유지 자세."
      },
      "hit": {
        "kind": "action",
        "loop": false,
        "minHits": 1,
        "maxHits": 1,
        "purpose": "피격·뒤로 젖힘·비틀거림·복귀."
      },
      "groggy": {
        "kind": "action",
        "loop": true,
        "minHits": 0,
        "maxHits": 0,
        "purpose": "기절/흔들림 반복."
      },
      "fall": {
        "kind": "action",
        "loop": false,
        "minHits": 1,
        "maxHits": 1,
        "purpose": "넘어짐·착지·누움. 일어서기 프레임도 명시."
      }
    },
    "optionalMotions": {
      "skill": {
        "kind": "action",
        "loop": false,
        "minHits": 0,
        "maxHits": 1,
        "purpose": "고유 기술 한 동작: 예고·접촉(또는 돌진, 자세 창)·회수. 종류는 skill.kind."
      },
      "entrance": {
        "kind": "action",
        "loop": false,
        "minHits": 0,
        "maxHits": 0,
        "purpose": "경기 시작 전 제자리 등장 동작."
      },
      "victory": {
        "kind": "action",
        "loop": true,
        "minHits": 0,
        "maxHits": 0,
        "purpose": "이긴 뒤 승리 자세 반복."
      }
    },
    "frameRules": {
      "imageFrames": "0-based row-major; image frame index and sequence step index are different",
      "gaitDurationMs": "per image frame; cycle = durationMs * frame count",
      "actionDurationMs": "per sequence step; same image may be held or reused",
      "runtimeTime": "game clock in ms; art duration does not set hit stun, damage, or input lock",
      "uniqueGaitFrames": true,
      "timingEvidence": "measure generated pixels and playback; never invent contact indices",
      "auxiliary": {
        "getUp": "fall.landmarks.getUp, not a twelfth required clip"
      }
    },
    "landmarks": {
      "combo": [
        "hitSequenceIndices (3..8)",
        "spinStart"
      ],
      "slam": [
        "hitSequenceIndices (1)"
      ],
      "dash": [
        "hitSequenceIndices (0..1)",
        "windup",
        "recover"
      ],
      "block": [
        "hitSequenceIndices (1); preceding step is held guard"
      ],
      "hit": [
        "recoil = contact step",
        "stagger",
        "recover"
      ],
      "fall": [
        "contact = landing",
        "lieSequenceIndex",
        "getUp"
      ],
      "skill": [
        "skill.kind",
        "strike (stretch, pincer): hitSequenceIndices (1), contact start >= 360 ms",
        "run (flight, feint, slide): windupTo < recoverFrom, optional run [a, b], launch, struck; windupTo start >= 240 ms",
        "stance (counter, brace): hitSequenceIndices (1), windowFrom < windowTo <= strikeFrom <= contact < strikeTo; windowFrom start >= 100 ms; window 200..1000 ms"
      ],
      "entrance": [
        "no contact; played in place before the bout"
      ],
      "victory": [
        "loop, no contact; played under the winner light"
      ]
    }
  },
  "workflow": {
    "entry": "A starter URL alone begins intake immediately. Ask for a character description or reference; do not ask whether to start.",
    "groups": [
      {
        "id": "appearance",
        "label": "외형",
        "motions": [
          "idle"
        ],
        "auxiliaries": [],
        "editable": [
          "체형",
          "표정",
          "복장",
          "색",
          "화풍"
        ]
      },
      {
        "id": "locomotion",
        "label": "대기·이동",
        "motions": [
          "fightIdle",
          "walk",
          "run"
        ],
        "auxiliaries": [],
        "editable": [
          "자세",
          "보폭",
          "무게감"
        ]
      },
      {
        "id": "attacks",
        "label": "공격",
        "motions": [
          "combo",
          "slam",
          "dash"
        ],
        "auxiliaries": [],
        "editable": [
          "준비 자세",
          "접촉 표현",
          "회수 동작",
          "박자",
          "기술 이름·설명"
        ]
      },
      {
        "id": "defense",
        "label": "방어·피격",
        "motions": [
          "block",
          "hit",
          "groggy",
          "fall"
        ],
        "auxiliaries": [
          "getUp"
        ],
        "editable": [
          "막기",
          "반동",
          "비틀거림",
          "쓰러짐",
          "기상",
          "막기 기술 이름·설명"
        ]
      },
      {
        "id": "style",
        "label": "싸우는 성격·고유 기술(선택)",
        "motions": [
          "skill",
          "entrance",
          "victory"
        ],
        "auxiliaries": [],
        "editable": [
          "기술 종류·표식",
          "등장 동작",
          "승리 자세",
          "공격 섞기",
          "특수·필살기",
          "교전 거리",
          "충격파·소환물",
          "기질",
          "교전 성향"
        ],
        "optional": true
      },
      {
        "id": "final",
        "label": "최종 확인",
        "motions": [],
        "auxiliaries": [],
        "editable": [
          "이름",
          "소개",
          "컨셉",
          "능력치 배분",
          "경기 대사",
          "전체 일관성"
        ]
      }
    ],
    "gates": {
      "advance": "Every current item/version in this group is selected and checked, or this group was explicitly delegated. Earlier pending groups still block advancement.",
      "appearance": "Choosing an accessory, provider, or color is a detail edit, not acceptance of the whole appearance. Do not propose movement until appearance is accepted.",
      "partial": "Accept only named current items. Preserve previous selections. When the last pending item is accepted, advance without reconfirmation.",
      "revision": "A change creates a pending version only for affected items. Praise plus a change is not whole-group acceptance.",
      "membership": "Use group motion IDs exactly. Extra controls or character personality cannot replace/add required clips.",
      "evidence": "Dialogue-only choices are hypothetical, never real previews, validation, provider access, or registration authorization.",
      "optional": "An optional group may be skipped as a whole (the standard kit). Offer it once after defense; add its clips and style only when the user agrees, and never hold the required groups or final on it."
    },
    "profileExtras": {
      "features": [
        "profile-extras-1",
        "combat-stats-1",
        "profile-names-1",
        "combat-style-1",
        "extra-clips-1",
        "profile-lines-1",
        "gait-frames-1"
      ],
      "concept": 800,
      "conceptStep": "Draft the concept (origin, why the fighter fights, manner) from the intake description during appearance; confirm it in final.",
      "moves": [
        "combo",
        "slam",
        "dash",
        "block"
      ],
      "moveStep": "Right after the user accepts a combo, slam, dash or block animation, offer a move name and one-line description for it. Names are display text on the standard move, never a new move or AI instruction.",
      "stats": {
        "keys": [
          "power",
          "toughness",
          "speed"
        ],
        "min": 1,
        "max": 5,
        "budget": 9,
        "default": 3
      },
      "statsStep": "In final, ask for the grade allocation: power = damage dealt, toughness = damage taken cut, speed = shorter rest between attacks. Every grade min..max, the sum exactly budget; skipped = every grade default. Only AI duels between registered fighters use them.",
      "language": "Record the language the user wrote the concept and move names in (profile.language).",
      "style": {
        "skillKinds": [
          "stretch",
          "pincer",
          "flight",
          "feint",
          "slide",
          "counter",
          "brace"
        ],
        "strikeKinds": [
          "stretch",
          "pincer"
        ],
        "stanceKinds": [
          "counter",
          "brace"
        ],
        "actions": [
          "slam",
          "combo",
          "fast"
        ],
        "supers": [
          "slam",
          "combo",
          "fast",
          "dash"
        ],
        "summons": [
          "crane",
          "bolt",
          "sportsCar",
          "roadster"
        ],
        "mix": {
          "min": 0,
          "max": 4
        },
        "grade": {
          "min": 1,
          "max": 5
        },
        "temper": [
          "guard",
          "retreat",
          "measure",
          "patience"
        ],
        "exchanges": {
          "keys": [
            "cross",
            "pinball",
            "rush"
          ],
          "min": 0,
          "max": 3
        },
        "extrasBudget": 2,
        "tellFloorMs": {
          "strike": 360,
          "run": 240,
          "stance": 100
        },
        "stanceWindowMs": {
          "min": 200,
          "max": 1000
        },
        "note": "선택. 싸우는 성격을 닫힌 선택지와 작은 등급으로만 고른다(공격 섞기·특수·필살기·교전 거리·충격파·소환물·기질·교전 성향). 서버가 각 값을 자체 수치로 바꾼다. 공격 섞기는 하나 이상이 0보다 크고 fast 는 slam + combo 이하다. 기술은 skill 클립(skill.kind)이 정한다. 기술 클립·소환물·충격파 가운데 extrasBudget 개까지. 없으면 표준 키트 그대로다."
      },
      "styleStep": "In the optional style group, translate the concept into combat.style picks (mix, special, super, distance, shockwave or summon, temper and exchange grades) and one skill kind for a skill clip. The skill clip, a summon and the shockwave together count against extrasBudget. Never promise damage or speed; the server sets the numbers.",
      "lines": {
        "keys": [
          "challenge",
          "win",
          "lose"
        ],
        "maxLength": 40,
        "note": "선택. 경기 전 도전 대사와 경기 뒤 승리·패배 대사(각 40자). 화면 표시용이다."
      },
      "linesStep": "In final, offer a challenge, a win and a loss line in the character's voice, each at most the max length. They are shown in the arena only.",
      "update": "An account can register up to three fighters. Omit fighterId for a new fighter. To change an existing fighter's concept, move names, stats, fighting style or art, repack and submit with its fighterId: it keeps its ID and duel record without using another slot."
    },
    "state": {
      "fields": [
        "mode",
        "contextRevision",
        "groupId",
        "items[id].version",
        "items[id].selectedVersion",
        "items[id].review",
        "pendingEdits",
        "delegatedGroups",
        "profile"
      ],
      "reviewValues": [
        "pending",
        "passed",
        "failed",
        "hypothetical"
      ],
      "modeValues": [
        "creation",
        "dialogue-only"
      ],
      "final": "All groups, final package validation and profile; registration remains a separate user request."
    }
  },
  "controls": {
    "defaultsOnly": true,
    "rebindable": true,
    "source": "InputBindings + NativeCityFightInputController",
    "actions": [
      {
        "action": "move",
        "keys": [
          "LEFT",
          "RIGHT"
        ],
        "motion": "walk",
        "behavior": "상대를 보며 전진·후진. 방향키 두 번 돌진·백스텝 입력은 제거됐다."
      },
      {
        "action": "combo",
        "keys": [
          "C"
        ],
        "motion": "combo",
        "behavior": "누름마다 연타 구간 진행. 공중 연계는 게임 상태가 결정.",
        "defaultPad": "A"
      },
      {
        "action": "heavy",
        "keys": [
          "V"
        ],
        "motion": "slam",
        "behavior": "누르고 모은 뒤 놓으면 강타. 준비 자세를 유지할 수 있어야 한다.",
        "defaultPad": "Y"
      },
      {
        "action": "guard",
        "keys": [
          "Z"
        ],
        "motion": "block",
        "behavior": "누르는 동안 가드. 현재 조작에서 패리 제거.",
        "defaultPad": "LB"
      },
      {
        "action": "evade",
        "keys": [
          "X"
        ],
        "motion": null,
        "behavior": "상대와 거리에 따라 넘기·회피. v1 추가 필수 모션 아님; 현재 스킨 어댑터의 대체 표현 사용.",
        "defaultPad": "B"
      },
      {
        "action": "super",
        "keys": [
          "S"
        ],
        "motion": "slam",
        "behavior": "게이지를 쓰는 강화 강타. 별도 필살기 클립을 추가하거나 dash를 대체하지 않음. 오토전에서는 기술 방출.",
        "defaultPad": "RB"
      }
    ],
    "unboundRequired": [
      {
        "motion": "dash",
        "reason": "v1 필수 애셋이며 상대/어댑터가 사용한다. 현재 플레이어 직접 입력 키는 없다."
      }
    ]
  },
  "timing": {
    "units": "milliseconds",
    "editableByCreator": false,
    "clocks": {
      "art": "authored sequence durations",
      "fight": "simulation time, paused by hit stop",
      "screen": "wall/display time; not equivalent to art frames or fight time"
    },
    "playerHit": {
      "drawnLockMs": 250,
      "fallbackLockMs": 280,
      "rule": "공격별 stunMs가 있으면 우선한다. 피격 그림의 전체 길이와 조작 불가 시간은 별개."
    },
    "guard": {
      "blockStunMs": {
        "light": 160,
        "slam": 380,
        "dash": 420
      },
      "breakStunMs": 700
    },
    "charge": {
      "entryMs": 100,
      "fullMs": 650,
      "maxHoldMs": 1500,
      "releaseStartupMs": 110
    },
    "cancel": {
      "afterLastContactMs": {
        "chain": {
          "afterHitMs": 60,
          "afterWhiffMs": 140
        },
        "heavy": {
          "afterHitMs": 140,
          "afterWhiffMs": 260
        },
        "dash": {
          "afterHitMs": 220,
          "afterWhiffMs": 600
        }
      },
      "enderRecoveryMs": 290,
      "semantics": "명중/헛침에 따라 마지막 접촉 뒤 창이 다르다. 지상 방어 취소는 즉시 가능하나 피격 등 상위 잠금은 별도. 공중은 착지/공중 연계 조건을 따른다. 연타 끝·강타를 다음 공격으로 취소할 수 없다."
    },
    "inputBufferMs": {
      "swing": 240,
      "defense": 560
    },
    "hitStop": {
      "sharedBetweenFighters": true,
      "whiffFreezes": false,
      "ordinaryTierMs": {
        "light": 67,
        "heavy": 133,
        "slam": 152.95,
        "dash": 140,
        "counter": 196,
        "break": 150,
        "ko": 187.5
      },
      "armoredTierMs": {
        "light": 33.5,
        "heavy": 66.5,
        "slam": 76.475,
        "dash": 70,
        "counter": 98,
        "break": 75,
        "ko": 93.75
      },
      "globalScale": 1,
      "overridesBeforeGlobalScale": {
        "chainLightMs": [
          110,
          125
        ],
        "comboBurstMs": [
          80,
          50,
          120
        ],
        "comboEnderMs": 160,
        "heavyEnderMs": 170,
        "fullChargeMs": 200,
        "airLightMs": 75,
        "koMs": 110
      },
      "rule": "기본 티어값은 모든 타격의 최종값이 아니다. NativeCityFightContacts/Defend가 연타·충전·공중·가드·반격·붕괴·KO 문맥에 따라 선택한다."
    },
    "poseHold": {
      "minimumAfterFreezeMs": 16,
      "rule": "접촉 때 공격·피격 자세를 같이 멈추고, 정지 후 남은 그림 유지 시간을 조절한다. 포즈 유지로 실제 경직을 늘리지 않는다."
    },
    "mapping": "FighterFightSkin maps art contact steps to rules contacts; combo is split into three spans. Preserve startup/contact/recovery and fall/get-up landmarks."
  },
  "freshness": {
    "refresh": "Fetch at entry, resume, each new group and before packaging. Compare revision.",
    "onChange": "Keep previous context and selections, report only affected requirements, recheck affected items. Never silently mix revisions.",
    "unavailable": "Appearance consultation may continue. Do not invent controls/timing, advance a rules-dependent group, generate or package against an unverified current contract."
  },
  "revision": "e36f33fa839d232487f3ed6d92e6eecf9494a79d871cd6bdc14af6be61b12ddd",
  "provenance": {
    "sourceCommit": "828489bfbce97253f9592f869959be0d39f8ddbf",
    "sourceDirty": false,
    "sourceFiles": {
      "tools/ai-fighter/creation-context.mjs": "985c90423c990dcc7236e03783a9a867cb606a3836c1f21a4d2a87a14d19bc49",
      "tools/ai-fighter/export-creation-context.mjs": "fcad318b37dae57a352b4c8ee509a1b03dd143a83f0518d726b06ff53df6d30d",
      "contracts/ai-fighter/v1/contract-source.mjs": "c642874f07875e27c2b5dd62d13d8e720bebdce0a0f066a5d40196c9cbbbe816",
      "src/world/native-city-combat.json": "0eb2dea149253f08ddc7067b0f3388f9f10dfe3cae9c8485d2e13a9aefa632be",
      "src/app/InputBindings.ts": "024ee9d2e11706deeb350b28a91d545763f789bdc7229289fbef0d19c9892127",
      "src/render/scenes/village/NativeCityFightInputController.ts": "0aa2e10401626e0017b3613bd00a91e4ada5ae6b33e060f2d8783324ade02a14",
      "src/render/art/FighterFightSkin.ts": "22614bda6b0e8b58ef27972fe83077c1c89243c1a816c5cb12782932ac6486af",
      "src/render/effects/NativeCityFightFeel.ts": "7cbb1bf98527169b7d8c77ddb7af332f5f45745aa3626fdf30c62a4afc069209",
      "src/render/effects/CombatPresentation.ts": "5bfe4d824c650a0b45ba700616b75002945f2888bd8f2c9b552723d9a478d6d4",
      "src/sim/cityFight/NativeCityLupinSwing.ts": "31398a04dc5c2997d8aeaecd1a036905a3e760bb4813ba9504b2c419ad8a9fa3",
      "src/sim/cityFight/NativeCityFight.ts": "ba8e5254c4c17fb55c8cc02f24ab4ad5ce569028559aeb5a3357f10c7b695fce",
      "src/sim/cityFight/NativeCityFightContacts.ts": "f2319515f8f001a6440672c663029b9f15d8cce9fa1e49139bc3cd9b4c5ff0b9",
      "src/sim/cityFight/NativeCityFightDefend.ts": "828fea79419fe95d3e487cd7fb0b22daaed0b971c97c2e327872c75849e961c1"
    },
    "generated": true
  }
}
```
