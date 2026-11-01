// Authoring limits live here; gait frame counts come from the existing game owner.
// build-contract.mjs emits the portable JSON files Dots and future services read.
const frameStandard = { roles: { fighter: { walk: 16, run: 12 } } }; // Published v1 snapshot.

/** @param {Record<string, unknown>} properties */
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
/** @param {Record<string, unknown>} properties @param {string[]} required */
const optionalObject = (properties, required) => ({ type: 'object', additionalProperties: false, required, properties });
/** @param {number} minimum @param {number} maximum */
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
/** @param {number} minimum @param {number} maximum */
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
/** @param {unknown} items @param {number} minItems @param {number} maxItems */
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
/** @param {string} name */
const ref = name => ({ $ref: `#/definitions/${name}` });
const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' };
/** @param {number} maxLength */
const text = maxLength => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const step = integer(0, 127);
const pair = { ...array(step, 2, 2) };
const borrowed = object({ clip: { enum: ['fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'] }, frame: integer(0, 63) });

/**
 * A gait cycle keeps the frames it was filmed or drawn in (2026-10-29, `gait-frames-1`): `frames` is the village standard a writer aims at,
 * `minFrames`..`maxFrames` what a manifest may carry. A cycle resampled to the standard skips or makes frames — a video run cycles in 13 or
 * 14 frames, and squeezed to 12 its legs jolt where a frame was dropped. The game plays any count (`durationMs` per frame); its pace is the
 * cycle's time, which the count does not change.
 */
export const gaitFrames = Object.freeze({ walk: Object.freeze({ min: 12, max: 32 }), run: Object.freeze({ min: 10, max: 16 }) });

export const motions = {
  idle: { kind: 'gait', frames: 1, loop: false, purpose: '정지 전신. 모든 동작과 같은 정체성.' },
  walk: { kind: 'gait', frames: frameStandard.roles.fighter.walk, minFrames: gaitFrames.walk.min, maxFrames: gaitFrames.walk.max, loop: true,
    purpose: '걷기 한 주기. 양발 교대, 같은 접지 기준.' },
  run: { kind: 'gait', frames: frameStandard.roles.fighter.run, minFrames: gaitFrames.run.min, maxFrames: gaitFrames.run.max, loop: true,
    purpose: '달리기 한 주기. 양발 교대.' },
  fightIdle: { kind: 'action', loop: true, minHits: 0, maxHits: 0, purpose: '전투 준비 자세 반복.' },
  combo: { kind: 'action', loop: false, minHits: 3, maxHits: 8, purpose: '3개 구간으로 나누어 재생할 연타. 접촉 시점 최소 3개.' },
  slam: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '강타의 준비·접촉·회수.' },
  dash: { kind: 'action', loop: false, minHits: 0, maxHits: 1, purpose: '돌진. 준비와 회수는 같은 선수의 명시한 프레임 사용.' },
  block: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '가드와 막기. 접촉 직전 단계가 유지 자세.' },
  hit: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '피격·뒤로 젖힘·비틀거림·복귀.' },
  groggy: { kind: 'action', loop: true, minHits: 0, maxHits: 0, purpose: '기절/흔들림 반복.' },
  fall: { kind: 'action', loop: false, minHits: 1, maxHits: 1, purpose: '넘어짐·착지·누움. 일어서기 프레임도 명시.' },
};

/**
 * Optional clips (2026-10-27, 전투 스타일 v2 — docs/Plan/2026-10-27-oddbout-agent-world 2단계): a fighter may add them; none is required. The
 * skill clip IS his skill — its `skill.kind` picks one of the engine's closed skill rules and its marks time it (`combatStyle.skillKinds`).
 */
export const optionalClips = {
  skill: { kind: 'action', loop: false, minHits: 0, maxHits: 1, purpose: '고유 기술 한 동작: 예고·접촉(또는 돌진, 자세 창)·회수. 종류는 skill.kind.' },
  entrance: { kind: 'action', loop: false, minHits: 0, maxHits: 0, purpose: '경기 시작 전 제자리 등장 동작.' },
  victory: { kind: 'action', loop: true, minHits: 0, maxHits: 0, purpose: '이긴 뒤 승리 자세 반복.' },
};

/**
 * The fighting style a creator picks (2026-10-27): closed choices and small grades only — the server maps each to its own tuning
 * (`RegisteredDuelStyle.ts`). Skill kinds are the engine's rules a single skill clip can time: a strike with one contact (stretch, pincer), a
 * run with a tell and a recovery (flight, feint, slide), or a stance with a window and a strike segment (counter, brace — 2026-10-27).
 * `extrasBudget`: of the skill clip, a summon and the shockwave, at most this many.
 */
export const combatStyle = Object.freeze({
  skillKinds: Object.freeze(['stretch', 'pincer', 'flight', 'feint', 'slide', 'counter', 'brace']),
  strikeKinds: Object.freeze(['stretch', 'pincer']),
  stanceKinds: Object.freeze(['counter', 'brace']),
  actions: Object.freeze(['slam', 'combo', 'fast']),
  supers: Object.freeze(['slam', 'combo', 'fast', 'dash']),
  summons: Object.freeze(['crane', 'bolt', 'sportsCar', 'roadster']),
  mix: Object.freeze({ min: 0, max: 4 }),
  grade: Object.freeze({ min: 1, max: 5 }),
  temper: Object.freeze(['guard', 'retreat', 'measure', 'patience']),
  exchanges: Object.freeze({ keys: Object.freeze(['cross', 'pinball', 'rush']), min: 0, max: 3 }),
  extrasBudget: 2,
  // The tell a person must be able to read: a strike's first contact, a run's tell end, a stance's window start, at least this far in.
  tellFloorMs: Object.freeze({ strike: 360, run: 240, stance: 100 }),
  // A stance's window (windowFrom..windowTo): long enough to meet a swing, never a guard that outlasts the bout's rhythm.
  stanceWindowMs: Object.freeze({ min: 200, max: 1000 }),
});

/** Display lines (2026-10-27): what he says before a bout and after it. Text only — the arena shows them. */
export const profileLines = Object.freeze({ keys: Object.freeze(['challenge', 'win', 'lose']), maxLength: 40 });

/**
 * The standard-duel kit's four moves a creator may name (display only — the moves themselves are the kit's), and the duel grades a creator
 * allocates (2026-10-23). Grades are not HP or damage: the server maps each grade to its own tuning (`RegisteredDuelStats.ts`).
 */
export const namedMoves = Object.freeze(['combo', 'slam', 'dash', 'block']);
// A guard grade was tried and dropped (2026-10-23 sweep): raising the guard more often only lost bouts, so it could not be a fair choice.
export const combatStats = Object.freeze({ keys: Object.freeze(['power', 'toughness', 'speed']), min: 1, max: 5, budget: 9, default: 3 });

export const limits = Object.freeze({ jsonBytes: 262144, assetBytes: 4000000, packageAssetBytes: 10000000,
  assetCount: 16, imageDimension: 4096, imagePixels: 16777216, packagePixels: 33554432, clipDurationMs: 10000 });
// Storage density, not character size: the runtime divides by the same scale when drawing a clip.
export const textureResolution = Object.freeze({ minScale: 0.25, maxScale: 1, defaultScale: 1 });

/** @type {Record<string, Record<string, unknown>>} */
const landmarks = {
  combo: object({ spinStart: step }),
  hit: object({ recoil: step, stagger: pair, recover: pair }),
  dash: object({ windup: borrowed, recover: borrowed }),
  fall: object({ lieSequenceIndex: step, getUp: array(object({ ...borrowed.properties, durationMs: number(1, 2000) }), 2, 8) }),
};

/** @param {string} name @param {any} motion */
function clipSchema(name, motion) {
  /** @type {Record<string, unknown>} */
  const fields = {
    assetId: id, frameWidth: integer(1, 1024), frameHeight: integer(1, 1024),
    columns: integer(1, 8), rows: integer(1, 8),
    frames: { ...array(integer(0, 63), motion.minFrames ?? motion.frames ?? 1, motion.maxFrames ?? motion.frames ?? 64), uniqueItems: true },
    origins: array(ref('origin'), motion.minFrames ?? motion.frames ?? 1, motion.maxFrames ?? motion.frames ?? 64), loop: { const: motion.loop },
  };
  if (motion.kind === 'gait') {
    fields.durationMs = number(1, 2000);
    if (name === 'walk') fields.stridePixels = number(1, 1600);
  } else {
    fields.sequence = array(object({ frame: integer(0, 63), durationMs: number(1, 2000) }), 1, 128);
    fields.hitSequenceIndices = { ...array(step, motion.minHits, motion.maxHits), uniqueItems: true };
    if (landmarks[name]) fields.landmarks = landmarks[name];
    // The skill clip names its rule and carries its run's or its stance's marks (a strike's contact is `hitSequenceIndices`).
    if (name === 'skill') fields.skill = optionalObject({ kind: { enum: combatStyle.skillKinds }, windupTo: step, recoverFrom: step,
      run: pair, launch: step, struck: step, windowFrom: step, windowTo: step, strikeFrom: step, strikeTo: step }, ['kind']);
  }
  return { ...optionalObject({ ...fields, pixelScale: number(textureResolution.minScale, textureResolution.maxScale) }, Object.keys(fields)),
    description: motion.purpose };
}

/** @param {readonly string[]} keys */
const grades = keys => optionalObject(Object.fromEntries(keys.map(key => [key, integer(combatStyle.grade.min, combatStyle.grade.max)])), []);
const style = optionalObject({
  mix: object(Object.fromEntries(combatStyle.actions.map(action => [action, integer(combatStyle.mix.min, combatStyle.mix.max)]))),
  special: { enum: combatStyle.actions }, super: { enum: combatStyle.supers },
  distance: integer(combatStyle.grade.min, combatStyle.grade.max),
  shockwave: { const: true }, summon: { enum: combatStyle.summons },
  temper: grades(combatStyle.temper),
  exchanges: optionalObject(Object.fromEntries(combatStyle.exchanges.keys.map(key => [key, integer(combatStyle.exchanges.min, combatStyle.exchanges.max)])), []),
}, []);

export const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'urn:ai-fighter:side:v1:fighter',
  title: 'AI Fighter side-view authoring package v1',
  description: '제작 입력 전용. 통과는 등록/승인이 아니다. 실제 파일 검사는 별도로 수행한다.',
  ...object({
    schemaVersion: { const: 1 }, specVersion: { const: 'ai-fighter-side-v1' }, localId: id,
    profile: optionalObject({ name: text(40), description: text(600), language: { enum: ['ko', 'en'] }, concept: text(800),
      // The name per page language (2026-10-24): shown where that language is on; `name` stays the identity and the fallback.
      names: { type: 'object', additionalProperties: false, minProperties: 1, properties: { ko: text(40), en: text(40) } },
      // What he says before a bout and after it (2026-10-27): shown by the arena, text only.
      lines: { type: 'object', additionalProperties: false, minProperties: 1,
        properties: Object.fromEntries(profileLines.keys.map(key => [key, text(profileLines.maxLength)])) },
      moves: object(Object.fromEntries(namedMoves.map(move => [move, object({ name: text(24), description: text(160) })]))),
      portrait: ref('imageView'), preview: ref('imageView') }, ['name', 'description', 'portrait', 'preview']),
    combat: optionalObject({ kitId: { const: 'standard-duel' },
      stats: object(Object.fromEntries(combatStats.keys.map(key => [key, integer(combatStats.min, combatStats.max)]))), style }, ['kitId']),
    appearance: object({ projection: { const: 'orthographic' }, elevationDegrees: { const: 16 },
      sourceFacing: { const: 'right' }, leftFacing: { const: 'mirror' }, bodyHeight: { const: 400 }, bodyScale: { const: 1 } }),
    assets: array(ref('asset'), 1, limits.assetCount),
    clips: optionalObject(Object.fromEntries(Object.entries({ ...motions, ...optionalClips }).map(([name, motion]) => [name, clipSchema(name, motion)])),
      Object.keys(motions)),
  }),
  definitions: {
    asset: object({ id, path: { type: 'string', maxLength: 100, pattern: '^assets/[a-z][a-z0-9-]{0,47}\\.webp$' },
      mediaType: { const: 'image/webp' }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      bytes: integer(1, limits.assetBytes), width: integer(1, limits.imageDimension), height: integer(1, limits.imageDimension) }),
    imageView: object({ assetId: id, crop: object({ x: integer(0, limits.imageDimension), y: integer(0, limits.imageDimension),
      width: integer(1, 1024), height: integer(1, 1024) }) }),
    origin: object({ originX: number(0, 1024), originY: number(0, 1024),
      groundContacts: array(object({ x: number(0, 1024), y: number(0, 1024), rx: number(0.1, 512), ry: number(0.1, 512) }), 0, 2) }),
  },
};

export const spec = {
  schemaVersion: 1, specVersion: 'ai-fighter-side-v1', status: 'authoring-contract',
  files: { guide: 'README.md', schema: 'fighter.schema.json', example: 'example.fighter.json' },
  input: { manifest: 'fighter.json', assetsDirectory: 'assets', animationMetadata: 'inline:clips',
    imageEncoding: 'static-webp-with-alpha', frameIndex: 'zero-based-row-major', originUnit: 'frame-local-pixels',
    durationUnit: 'milliseconds', frames: 'contiguous-zero-based', landmarks: 'sequence-step-indices-except-borrowed-frame',
    mirror: 'right-source-left-runtime-flip', bodyHeight: 400, cameraElevationDegrees: 16 },
  limits, motions, optionalClips, textureResolution,
  // A reader that predates a feature rejects manifests using it (additionalProperties: false): writers emit it only when listed here.
  features: ['profile-extras-1', 'combat-stats-1', 'profile-names-1', 'combat-style-1', 'extra-clips-1', 'profile-lines-1', 'gait-frames-1', 'texture-resolution-1'],
  gaitFrames: { ...gaitFrames, note: '걷기·달리기는 찍거나 그린 한 주기의 칸 수 그대로 낸다(이 범위 안). frames 는 마을 표준(걷기 16·달리기 12)이다. 칸마다 같은 durationMs 로 재생하고, 한 주기 시간이 걸음 속도를 정한다.' },
  profileExtras: { languages: ['ko', 'en'], conceptMaxLength: 800, namedMoves, moveNameMaxLength: 24, moveDescriptionMaxLength: 160, nameMaxLength: 40,
    names: '선택. profile.names.ko·en 은 그 언어 화면에 띄울 이름(각 40자). 없는 언어는 profile.name 을 띄운다.',
    note: '컨셉과 기술 이름·설명은 표시용 소개 텍스트다. 기술 이름은 표준 키트의 고정 동작에 붙는다. 새 동작이나 AI 지시가 아니다.' },
  combatStats: { ...combatStats,
    note: '제작자는 등급 배분만 제출한다. 모든 등급의 합은 budget과 같아야 한다. 없으면 모두 default다. 서버가 등급을 자체 수치로 바꾼다.' },
  combatStyle: { ...combatStyle,
    note: '선택. 싸우는 성격을 닫힌 선택지와 작은 등급으로만 고른다(공격 섞기·특수·필살기·교전 거리·충격파·소환물·기질·교전 성향). 서버가 각 값을 자체 수치로 바꾼다. 공격 섞기는 하나 이상이 0보다 크고 fast 는 slam + combo 이하다. 기술은 skill 클립(skill.kind)이 정한다. 기술 클립·소환물·충격파 가운데 extrasBudget 개까지. 없으면 표준 키트 그대로다.' },
  profileLines: { ...profileLines, note: '선택. 경기 전 도전 대사와 경기 뒤 승리·패배 대사(각 40자). 화면 표시용이다.' },
  combatKits: [{ id: 'standard-duel', description: '서버가 관리하는 기본 대결 규칙. 제작자는 HP·피해·사거리·코드·AI 지시를 제출하지 않는다. 능력치 등급 배분(combat.stats)과 싸우는 성격(combat.style)만 고른다.',
    integration: 'pending-game-integration',
    currentConsumers: { player: 'FighterFightSkin / Lupin rules', opponent: 'NativeCityKumaArt / CityFighters rules' },
    warning: '현재 플레이어와 AI 상대 규칙은 다르다. 이 ID는 서버 연결 계약이며 통합 경쟁 규칙 구현을 뜻하지 않는다.' }],
  validationStages: ['schema', 'references-and-geometry', 'bytes-hashes-and-full-decode', 'runtime-preview', 'visual-review', 'server-registration'],
  notClientFields: ['ownerId', 'fighterId', 'approved', 'runtimeApproved', 'status', 'hp', 'damage', 'script'],
  registration: { available: false, reason: '오프라인 제작 계약. 연결된 서버의 /spec에서 베타 등록 가능 여부를 확인한다. 게임 동적 로딩은 별도다.' },
};
