import Ajv from 'ajv';
import schema from './v1/fighter.schema.json' with { type: 'json' };
import spec from './v1/spec.json' with { type: 'json' };

/** @typedef {{ code: string, path: string, expected: unknown, actual: unknown }} Issue */

const checkSchema = new Ajv({ allErrors: true, jsonPointers: true, ownProperties: true,
  coerceTypes: false, useDefaults: false, removeAdditional: false }).compile(schema);
/** @param {unknown} text */
const pointer = text => String(text).replace(/~/g, '~0').replace(/\//g, '~1');
/** @param {string} code @param {string} path @param {unknown} expected @param {unknown} actual */
const issue = (code, path, expected, actual) => ({ code, path, expected, actual });

/**
 * Parse before accepting a JSON object: JSON.parse alone silently loses duplicate members.
 * @param {string} text
 */
export function parseFighterJson(text) {
  if (new TextEncoder().encode(text).byteLength > spec.limits.jsonBytes)
    return { ok: false, errors: [issue('JSON_TOO_LARGE', '', spec.limits.jsonBytes, 'exceeded')] };
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, errors: [issue('INVALID_JSON', '', 'valid JSON', 'syntax error')] }; }
  const stack = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)) {
    const value = token[0], top = stack.at(-1);
    if (value === '{' || value === '[') {
      stack.push(value === '{' ? { keys: new Set(), key: true } : { keys: null });
      if (stack.length > 32) return { ok: false, errors: [issue('JSON_TOO_DEEP', '', 32, stack.length)] };
    } else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && top?.keys) top.key = true;
    else if (value.startsWith('"') && top?.keys && top.key) {
      const key = JSON.parse(value);
      if (top.keys.has(key)) return { ok: false, errors: [issue('DUPLICATE_MEMBER', '', 'unique JSON member names', key)] };
      top.keys.add(key); top.key = false;
    }
  }
  return { ok: true, data };
}

/**
 * Schema + cross references. Does not inspect files and never grants registration.
 * @param {any} data
 */
export function validateFighter(data) {
  if (!checkSchema(data)) return { ok: false, stage: 'schema', errors: /** @type {import('ajv').ErrorObject[]} */ (checkSchema.errors).map(error => {
    const key = error.keyword === 'required' ? /** @type {any} */ (error.params).missingProperty : error.keyword === 'additionalProperties' ? /** @type {any} */ (error.params).additionalProperty : null;
    return issue(`SCHEMA_${error.keyword.toUpperCase()}`, error.dataPath + (key ? `/${pointer(key)}` : ''), error.params, error.message);
  }) };
  const /** @type {Issue[]} */ errors = [], assets = new Map(), paths = new Set(), used = new Set();
  const add = (/** @type {string} */ code, /** @type {string} */ path, /** @type {unknown} */ expected, /** @type {unknown} */ actual) => errors.push(issue(code, path, expected, actual));
  let bytes = 0, pixels = 0;
  data.assets.forEach((/** @type {any} */ asset, /** @type {number} */ index) => {
    const at = `/assets/${index}`;
    if (assets.has(asset.id)) add('DUPLICATE_ASSET_ID', `${at}/id`, 'unique ID', asset.id);
    if (paths.has(asset.path)) add('DUPLICATE_ASSET_PATH', `${at}/path`, 'unique path', asset.path);
    assets.set(asset.id, asset); paths.add(asset.path);
    bytes += asset.bytes; pixels += asset.width * asset.height;
    if (asset.width * asset.height > spec.limits.imagePixels) add('IMAGE_PIXEL_LIMIT', at, spec.limits.imagePixels, asset.width * asset.height);
  });
  if (bytes > spec.limits.packageAssetBytes) add('PACKAGE_BYTE_LIMIT', '/assets', spec.limits.packageAssetBytes, bytes);
  if (pixels > spec.limits.packagePixels) add('PACKAGE_PIXEL_LIMIT', '/assets', spec.limits.packagePixels, pixels);
  const resolve = (/** @type {string} */ id, /** @type {string} */ path) => {
    used.add(id);
    if (!assets.has(id)) add('ASSET_NOT_FOUND', path, 'declared asset ID', id);
    return assets.get(id);
  };
  for (const name of ['portrait', 'preview']) {
    const view = data.profile[name], asset = resolve(view.assetId, `/profile/${name}/assetId`), c = view.crop;
    if (asset && (c.x + c.width > asset.width || c.y + c.height > asset.height))
      add('CROP_OUT_OF_BOUNDS', `/profile/${name}/crop`, [asset.width, asset.height], c);
  }
  for (const [name, clip] of Object.entries(data.clips)) {
    const at = `/clips/${name}`, asset = resolve(clip.assetId, `${at}/assetId`), count = clip.frames.length;
    if (asset && (asset.width !== clip.columns * clip.frameWidth || asset.height !== clip.rows * clip.frameHeight))
      add('SHEET_GEOMETRY', at, [clip.columns * clip.frameWidth, clip.rows * clip.frameHeight], [asset.width, asset.height]);
    if (count > clip.columns * clip.rows || clip.frames.some((/** @type {any} */ frame, /** @type {number} */ index) => frame !== index))
      add('FRAME_GRID', `${at}/frames`, 'contiguous 0..n-1 inside the sheet', clip.frames);
    if (clip.origins.length !== count) add('ORIGIN_COUNT', `${at}/origins`, count, clip.origins.length);
    clip.origins.forEach((/** @type {any} */ origin, /** @type {number} */ index) => {
      if (origin.originX > clip.frameWidth || origin.originY > clip.frameHeight)
        add('ORIGIN_OUT_OF_BOUNDS', `${at}/origins/${index}`, [clip.frameWidth, clip.frameHeight], origin);
      origin.groundContacts.forEach((/** @type {any} */ c, /** @type {number} */ ci) => {
        if (c.x - c.rx < 0 || c.x + c.rx > clip.frameWidth || c.y - c.ry < 0 || c.y + c.ry > clip.frameHeight)
          add('CONTACT_OUT_OF_BOUNDS', `${at}/origins/${index}/groundContacts/${ci}`, 'ellipse inside frame', c);
      });
    });
    const steps = clip.sequence ?? clip.frames.map((/** @type {any} */ frame) => ({ frame, durationMs: clip.durationMs }));
    const totalMs = steps.reduce((/** @type {number} */ sum, /** @type {any} */ step) => sum + step.durationMs, 0);
    if (totalMs > spec.limits.clipDurationMs) add('CLIP_DURATION_LIMIT', at, spec.limits.clipDurationMs, totalMs);
    steps.forEach((/** @type {any} */ step, /** @type {number} */ index) => {
      if (step.frame >= count) add('SEQUENCE_FRAME', `${at}/sequence/${index}/frame`, `0..${count - 1}`, step.frame);
    });
    const indexInRange = (/** @type {number} */ value, /** @type {string} */ path) => {
      if (value >= steps.length) add('SEQUENCE_INDEX', path, `0..${steps.length - 1}`, value);
    };
    const hits = clip.hitSequenceIndices ?? [];
    hits.forEach((/** @type {number} */ hit, /** @type {number} */ index) => {
      indexInRange(hit, `${at}/hitSequenceIndices/${index}`);
      if (hit === 0 || (index > 0 && hit <= hits[index - 1])) add('CONTACT_ORDER', `${at}/hitSequenceIndices/${index}`, 'strictly increasing, after step 0', hit);
    });
    const k = clip.landmarks;
    if (name === 'combo') {
      indexInRange(k.spinStart, `${at}/landmarks/spinStart`);
      // The current skin splits C into three spans around the last three contacts.
      if (!(k.spinStart > hits.at(-3) && k.spinStart <= hits.at(-2) && Math.floor((hits.at(-2) + hits.at(-1)) / 2) > k.spinStart))
        add('COMBO_SEGMENTS', `${at}/landmarks/spinStart`, 'three nonempty ordered contact spans', k.spinStart);
    }
    if (name === 'hit') {
      for (const [key, values] of Object.entries(k)) for (const value of Array.isArray(values) ? values : [values])
        indexInRange(value, `${at}/landmarks/${key}`);
      if (!(k.recoil <= k.stagger[0] && k.stagger[0] <= k.stagger[1] && k.stagger[1] < k.recover[0] && k.recover[0] <= k.recover[1]))
        add('HIT_PHASE_ORDER', `${at}/landmarks`, 'recoil, stagger, recover in order', k);
      if (hits[0] !== k.recoil) add('HIT_RECOIL_CONTACT', `${at}/landmarks/recoil`, hits[0], k.recoil);
    }
    const checkBorrow = (/** @type {any} */ cell, /** @type {string} */ path) => {
      if (cell.frame >= data.clips[cell.clip].frames.length) add('BORROWED_FRAME', path, `frame in ${cell.clip}`, cell.frame);
    };
    if (name === 'dash') for (const phase of ['windup', 'recover']) checkBorrow(k[phase], `${at}/landmarks/${phase}`);
    if (name === 'fall') {
      indexInRange(k.lieSequenceIndex, `${at}/landmarks/lieSequenceIndex`);
      if (k.lieSequenceIndex < hits[0]) add('FALL_PHASE_ORDER', `${at}/landmarks/lieSequenceIndex`, `>= ${hits[0]}`, k.lieSequenceIndex);
      if (steps.at(-1).frame !== steps[k.lieSequenceIndex]?.frame) add('FALL_END_POSE', `${at}/sequence`, 'end in lying pose', steps.at(-1).frame);
      k.getUp.forEach((/** @type {any} */ cell, /** @type {number} */ index) => checkBorrow(cell, `${at}/landmarks/getUp/${index}`));
      const getUpMs = k.getUp.reduce((/** @type {number} */ sum, /** @type {any} */ cell) => sum + cell.durationMs, 0);
      if (getUpMs > spec.limits.clipDurationMs)
        add('GET_UP_DURATION_LIMIT', `${at}/landmarks/getUp`, spec.limits.clipDurationMs, getUpMs);
    }
    if (name === 'skill') {
      // A strike lands once; a run has a tell and a recovery; a stance has a window and a strike segment around its one contact. Each is
      // readable: its tell lasts at least the floor (combatStyle.tellFloorMs).
      const marks = clip.skill, startMs = (/** @type {number} */ index) => steps.slice(0, index).reduce((/** @type {number} */ sum, /** @type {any} */ step) => sum + step.durationMs, 0);
      for (const key of ['windupTo', 'recoverFrom', 'launch', 'struck', 'windowFrom', 'windowTo', 'strikeFrom', 'strikeTo'])
        if (marks[key] !== undefined) indexInRange(marks[key], `${at}/skill/${key}`);
      for (const [index, value] of (marks.run ?? []).entries()) indexInRange(value, `${at}/skill/run/${index}`);
      if (spec.combatStyle.strikeKinds.includes(marks.kind)) {
        if (hits.length !== 1) add('SKILL_CONTACT', `${at}/hitSequenceIndices`, 'one contact', hits.length);
        else if (startMs(hits[0]) < spec.combatStyle.tellFloorMs.strike) add('SKILL_TELL', `${at}/hitSequenceIndices/0`, `>= ${spec.combatStyle.tellFloorMs.strike} ms`, startMs(hits[0]));
      } else if (spec.combatStyle.stanceKinds.includes(marks.kind)) {
        const { windowFrom: from, windowTo: to, strikeFrom, strikeTo } = marks, window = spec.combatStyle.stanceWindowMs;
        if (hits.length !== 1) add('SKILL_CONTACT', `${at}/hitSequenceIndices`, 'one contact', hits.length);
        else if ([from, to, strikeFrom, strikeTo].some(value => value === undefined) || !(from < to && to <= strikeFrom && strikeFrom <= hits[0] && hits[0] < strikeTo))
          add('SKILL_STANCE_MARKS', `${at}/skill`, 'windowFrom < windowTo <= strikeFrom <= contact < strikeTo', marks);
        else if (startMs(from) < spec.combatStyle.tellFloorMs.stance) add('SKILL_TELL', `${at}/skill/windowFrom`, `>= ${spec.combatStyle.tellFloorMs.stance} ms`, startMs(from));
        else if (startMs(to) - startMs(from) < window.min || startMs(to) - startMs(from) > window.max)
          add('SKILL_WINDOW', `${at}/skill`, `${window.min}..${window.max} ms`, startMs(to) - startMs(from));
      } else if (marks.windupTo === undefined || marks.recoverFrom === undefined || !(marks.windupTo < marks.recoverFrom))
        add('SKILL_RUN_MARKS', `${at}/skill`, 'windupTo < recoverFrom', marks);
      else if (startMs(marks.windupTo) < spec.combatStyle.tellFloorMs.run) add('SKILL_TELL', `${at}/skill/windupTo`, `>= ${spec.combatStyle.tellFloorMs.run} ms`, startMs(marks.windupTo));
    }
  }
  for (const [index, asset] of data.assets.entries()) if (!used.has(asset.id)) add('UNUSED_ASSET', `/assets/${index}/id`, 'referenced asset', asset.id);
  // The schema bounds each grade; only a sum check keeps every allocation on one budget.
  if (data.combat.stats) {
    const total = spec.combatStats.keys.reduce((/** @type {number} */ sum, /** @type {string} */ key) => sum + data.combat.stats[key], 0);
    if (total !== spec.combatStats.budget) add('STATS_BUDGET', '/combat/stats', spec.combatStats.budget, total);
  }
  // A style rotates at least one swing, its quick cut never more than his slams and combos together (all cuts lost 96 % of its bouts, 2026-10-27),
  // and picks at most `extrasBudget` of the skill clip, a summon and the shockwave.
  const style = data.combat.style;
  if (style?.mix && (spec.combatStyle.actions.every(action => style.mix[action] === 0) || style.mix.fast > style.mix.slam + style.mix.combo))
    add('STYLE_MIX', '/combat/style/mix', 'a swing above 0, fast <= slam + combo', style.mix);
  const extras = (data.clips.skill ? 1 : 0) + (style?.summon ? 1 : 0) + (style?.shockwave ? 1 : 0);
  if (extras > spec.combatStyle.extrasBudget) add('STYLE_EXTRAS', '/combat/style', spec.combatStyle.extrasBudget, extras);
  return { ok: errors.length === 0, stage: 'references-and-geometry', errors, assetBytes: bytes, decodedPixels: pixels,
    pending: ['bytes-hashes-and-full-decode', 'runtime-preview', 'visual-review', 'server-registration'] };
}

/**
 * The duel grades a valid manifest fights with: its `combat.stats`, or every grade at the default (the engine before stats).
 * @param {any} data
 */
export function toDuelStats(data) {
  const stats = data?.combat?.stats;
  return Object.fromEntries(spec.combatStats.keys.map(key => [key, stats ? stats[key] : spec.combatStats.default]));
}

/**
 * The fighting style a valid manifest fights with (2026-10-27): its `combat.style` with its skill clip's kind, or null — the standard kit as it
 * was (a manifest without either fights exactly as before).
 * @param {any} data
 */
export function toDuelStyle(data) {
  const style = data?.combat?.style, kind = data?.clips?.skill?.skill?.kind;
  if (!style && !kind) return null;
  return { ...(style ?? {}), ...(kind ? { skill: kind } : {}) };
}

/**
 * A side-only preview adapter for the existing left/right consumers; not a registered world pack.
 * @param {any} data
 */
export function toSidePreviewPack(data) {
  const result = validateFighter(data);
  if (!result.ok) throw new Error('Invalid AI Fighter authoring data');
  const assets = new Map(data.assets.map((/** @type {any} */ asset) => [asset.id, asset]));
  const side = Object.fromEntries(Object.entries(data.clips).map(([name, clip]) => {
    const { assetId, loop, landmarks, skill, pixelScale = 1, ...fields } = clip;
    const asset = assets.get(assetId);
    // The skill clip's own marks become the runtime keys the engine times it by (`keys.skill` names the rule).
    const keys = name === 'dash' ? { standIns: landmarks }
      : name === 'fall' ? { getUp: landmarks.getUp } : name === 'skill' ? (({ kind, ...marks }) => ({ ...marks, skill: kind }))(skill) : landmarks;
    return [name, { ...fields, key: `ai-fighter-preview-${data.localId}-${name}-${asset.sha256}-${clip.frameWidth}x${clip.frameHeight}`, path: asset.path,
      bodyHeight: data.appearance.bodyHeight * pixelScale, oneShot: !loop, durationMs: clip.durationMs ?? null,
      ...(keys ? { keys } : {}), ...(name === 'fall' ? { lieSequenceIndex: landmarks.lieSequenceIndex } : {}),
      ...(name === 'slam' ? { impactSequenceIndex: clip.hitSequenceIndices[0] } : {}) }];
  }));
  return { schemaVersion: 1, adopted: { look: data.localId, runtimeApproved: false },
    camera: { projection: data.appearance.projection, elevationDegrees: data.appearance.elevationDegrees }, directions: { side } };
}
