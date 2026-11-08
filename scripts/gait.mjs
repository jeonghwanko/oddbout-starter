// @ts-check
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {
  walkPlan,
  loadSequence,
  combineReview,
  commonGameRequest,
  validatePlan,
  digest,
  loopReview,
  scaleCheckConfigErrors,
  scaleCheckRuns,
  scaleCheckEntries,
} from '../tools/ai-fighter/gait.mjs';
import { spritePython } from './sprite-gen.mjs';
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };

/** @typedef {Awaited<ReturnType<typeof loadSequence>> & { sha256: string, measurementFile?: string }} Sequence  loadSequence sets sha256; review, measurementFile. */

const root = fileURLToPath(new URL('../', import.meta.url));
/** @type {(file: string) => Promise<any>} */
const json = file => readFile(file, 'utf8').then(JSON.parse);
/** @type {(file: string, value: unknown) => Promise<void>} */
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
/** @type {(value: unknown) => string} */
const escape = value =>
  String(value).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[/** @type {'&' | '<' | '>' | '"' | "'"} */ (c)],
  );

// A labelled pose guide only, never character artwork or a submitted asset.
/** @param {{ phases: { index: number, pose: string }[] }} plan */
export function phaseGuide(plan) {
  const w = 240,
    h = 290,
    scale = 0.5;
  /** @param {number} index @param {number} offset */
  const leg = (index, offset) => {
    const t = (index + offset) % 16,
      swing = Math.max(0, t - 8) / 8;
    return {
      x: t <= 8 ? 320 - 16 * t : 192 + 128 * (swing - Math.sin(2 * Math.PI * swing) / (2 * Math.PI)),
      y: t <= 8 ? 450 : 450 - 65 * Math.sin(Math.PI * swing),
    };
  };
  /** @param {number} index */
  const pose = index => {
    const hip = { x: 256, y: 315 + 6 * Math.sin((index * Math.PI) / 4) },
      top = hip.y - 124;
    /** @param {{ x: number, y: number }} foot @param {string} color */
    const limb = (foot, color) => {
      const dx = foot.x - hip.x,
        dy = foot.y - hip.y,
        d = Math.hypot(dx, dy),
        bend = Math.sqrt(Math.max(0, 80 * 80 - (d * d) / 4));
      const knee = { x: (hip.x + foot.x) / 2 + (dy / d) * bend, y: (hip.y + foot.y) / 2 - (dx / d) * bend };
      return `<path d="M${hip.x},${hip.y} L${knee.x},${knee.y} L${foot.x},${foot.y} l18,8" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
    };
    return `<g transform="translate(-8 8) scale(${scale})"><path d="M90,460H420" stroke="#6c798a" stroke-width="2"/>${limb(leg(index, 8), '#9a6cdd')}${limb(leg(index, 0), '#db641b')}<path d="M256,${hip.y}V${top}" stroke="#344154" stroke-width="12"/><ellipse cx="264" cy="${top - 57}" rx="36" ry="48" fill="none" stroke="#344154" stroke-width="8"/><path d="M295,${top - 55}l15,5l-15,7" fill="#344154"/></g>`;
  };
  const columns = Math.min(8, plan.phases.length),
    rows = Math.ceil(plan.phases.length / columns);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * columns}" height="${h * rows}" viewBox="0 0 ${w * columns} ${h * rows}"><rect width="100%" height="100%" fill="#f5f7fb"/>${plan.phases.map((p, i) => `<g transform="translate(${(i % columns) * w},${Math.floor(i / columns) * h})"><text x="12" y="20" font-family="sans-serif" font-size="16">${i}: ${escape(p.pose)}</text>${pose(p.index)}<text x="12" y="272" font-family="sans-serif" font-size="12">Orange: NEAR / Purple: FAR</text></g>`).join('')}</svg>`;
}

/** @param {string} out */
export async function init(out) {
  await mkdir(out, { recursive: false });
  const plan = walkPlan();
  const geometry = plan.geometry;
  await save(path.join(out, 'gait-plan.json'), plan);
  const action =
    'ONE complete two-step walk cycle, not repeated mini-cycles. The same near and far legs remain identifiable throughout. ' +
    plan.phases.map(p => `Frame ${p.index}: ${p.pose}; support ${p.support.join('+')}; ${p.leadingFoot} step half.`).join(' ') +
    ' During stance the planted foot travels backward relative to the torso; the other knee bends and its foot swings forward above ground. ' +
    'The half-cycle at frame 8 exchanges the actual legs. Counter-swing the arms. Fixed camera and body proportions, no camera movement or zoom. ' +
    'Keep deliberate small pelvis bob; never enlarge a bent pose to fill its slot. Final frame flows into frame zero.';
  const guideFile = path.resolve(out, 'phase-guide.png'),
    keysFile = path.resolve(out, 'keyposes-guide.png');
  const keyPhases = [0, 4, 8, 12].map(i => plan.phases[i]);
  await sharp(Buffer.from(phaseGuide(plan)))
    .png()
    .toFile(guideFile);
  await sharp(Buffer.from(phaseGuide({ ...plan, phases: keyPhases })))
    .png()
    .toFile(keysFile);
  /** @param {string} stage @param {{ pose: string, support: string[] }[]} phases @param {string} file */
  const motion = async (stage, phases, file) => ({
    kind: 'walk',
    stage,
    phases: phases.map(({ pose, support }) => ({ pose, support })),
    references: [{ role: 'phase-guide', file, sha256: digest(await readFile(file)) }],
  });
  const request = {
    version: 1,
    cell: { width: geometry.width, height: geometry.height, safe_margin_x: geometry.safeMarginX, safe_margin_y: geometry.safeMarginY },
    style: `Copy the accepted character identity, palette, line style, clothing, head size and limb lengths. Right-facing orthographic side view, camera elevation ${spec.input.cameraElevationDegrees} degrees. No text, guides, shadows, effects or background scene.`,
    fit: { resample: 'lanczos', align_x: 'centroid', align_y: 'bottom', ground_frames: false, pixel_unfake: false },
    states: { walk: { frames: plan.phases.length, fps: 12, loop: true, action, motion: await motion('sequence', plan.phases, guideFile) } },
  };
  await save(path.join(out, 'sprite-request.json'), request);
  await save(path.join(out, 'keyposes-request.json'), {
    ...request,
    states: {
      walk: {
        frames: 4,
        fps: 4,
        loop: false,
        action:
          'Four full-body diagnostic key poses: near contact, near support/far passing, far contact, far support/near passing. Maintain the accepted anatomy; no torso/leg collage.',
        motion: await motion('keyposes', keyPhases, keysFile),
      },
    },
  });
  await save(path.join(out, 'keyposes-review.json'), {
    identity: 'unverified',
    anatomy: 'unverified',
    alternation: 'unverified',
    contacts: 'unverified',
    bodyContinuity: 'unverified',
    notes: '',
  });
  return {
    ok: true,
    out,
    note: 'Generate and inspect keyposes-request first. Bind the actually reviewed image before sequence generation. The generic walk guide is a phase instruction; adapt proportions to the accepted character.',
  };
}

/** @param {string} requestFile @param {string} imageFile @param {string} reviewFile */
export async function bindKeyposes(requestFile, imageFile, reviewFile) {
  const request = await json(requestFile),
    review = await json(reviewFile);
  if (!['identity', 'anatomy', 'alternation', 'contacts', 'bodyContinuity'].every(key => review[key] === 'pass') || !review.notes?.trim())
    throw Error('Inspect both physical legs, hips and whole-body contacts before binding key poses. Unverified/failing reviews cannot advance.');
  const file = path.resolve(imageFile),
    bytes = await readFile(file);
  await sharp(bytes).metadata();
  const states = Object.values(request.states ?? {}).filter(state => state.motion?.stage === 'sequence');
  if (states.length !== 1) throw Error('Bind one motion request at a time');
  states[0].motion.references = [
    .../** @type {any[]} */ (states[0].motion.references).filter(ref => ref.role !== 'keyposes'),
    { role: 'keyposes', file, sha256: digest(bytes), review },
  ];
  await save(requestFile, request);
  return { ok: true, requestFile, note: 'Reference bound to these image bytes. Full sequence motion quality remains unverified.' };
}

/**
 * @param {Sequence} sequence @param {{ facing: string }} plan @param {any} stance  An annotation: parsed JSON, checked here.
 * @param {string} out @param {string} annotationsBase
 */
async function measure(sequence, plan, stance, out, annotationsBase) {
  if (
    !Array.isArray(stance.box) ||
    stance.box.length !== 4 ||
    !stance.box.every(Number.isInteger) ||
    !Number.isInteger(stance.start) ||
    !Number.isInteger(stance.end)
  )
    throw Error('Each stance needs integer start/end and box [x,y,width,height].');
  const args =
    stance.footEvidence === undefined ? ['-m', 'sprite_gen.cli', 'inspect-motion'] : [path.join(root, 'tools/ai-fighter/contact_evidence.py'), 'inspect'];
  if (stance.footEvidence !== undefined) {
    if (typeof stance.footEvidence !== 'string' || !stance.footEvidence.trim()) throw Error('footEvidence must name a reviewed evidence JSON file.');
    args.push('--foot', stance.foot, '--foot-evidence', path.resolve(annotationsBase, stance.footEvidence));
  }
  args.push(
    '--source',
    /** @type {string} */ (sequence.measurementFile), // review sets it first
    '--contacts',
    `${stance.start}:${stance.end}`,
    '--foot-box',
    stance.box.join(','),
    '--facing',
    plan.facing,
    '--out',
    out,
  );
  await /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      // A measurement of one stance interval takes seconds; a bound keeps a stuck engine from holding the review forever.
      const child = spawn(spritePython, args, { cwd: root, env: { ...process.env, PYTHONUTF8: '1' }, windowsHide: true, timeout: 5 * 60_000 });
      let error = '';
      child.stdout.resume();
      child.stderr.on('data', chunk => {
        error += chunk;
      });
      child.on('error', reject);
      child.on('close', (code, signal) =>
        code === 0 ? resolve() : reject(Error(signal ? `inspect-motion stopped after 5 minutes (${signal})` : 'inspect-motion failed: ' + error.slice(-3000))),
      );
    })
  );
  return json(out);
}

/**
 * @param {{ frames: { width: number, height: number, data: Buffer }[], durations: number[] }} sequence
 * @param {{ label?: string, phases: { pose: string }[], geometry: { groundY: number } }} plan @param {unknown} report @param {string} out
 */
export async function preview(sequence, plan, report, out) {
  const images = await Promise.all(
    sequence.frames.map(f =>
      sharp(f.data, { raw: { width: f.width, height: f.height, channels: 4 } })
        .png()
        .toBuffer(),
    ),
  );
  const data = { images: images.map(b => 'data:image/png;base64,' + b.toString('base64')), durations: sequence.durations, plan, report };
  const serialized = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Fighter · 걷기 검수</title>
<style>body{background:#141a25;color:#e6edf7;font:16px system-ui;margin:0;padding:24px}main{max-width:1080px;margin:auto}h1{font-size:25px}button,select,input{font:inherit}button,select{padding:9px 14px;margin:5px;background:#263449;border:1px solid #536782;border-radius:7px;color:inherit}canvas{display:block;max-width:100%;max-height:52vh;margin:0 auto;background:#e7ecf2;border-radius:12px}#status{padding:12px;background:#263449;border-radius:8px}#frame{width:min(600px,80vw)}details{margin:20px 0}pre{white-space:pre-wrap}small{color:#b5c6da}</style>
<main><h1>${escape(plan.label ?? '보행 검수 · 등록 전 미리보기')}</h1><p id="status"></p><canvas id="view" width="1000" height="560"></canvas>
<p><button id="play">일시정지</button><button id="prev">이전</button><button id="next">다음</button><select id="speed"><option value="1">정상 속도</option><option value="0.5">0.5배</option><option value="0.25">0.25배</option></select><label><input id="overlay" type="checkbox" checked>지면·접지 영역</label><label><input id="travel" type="checkbox">이동 재생</label></p><input id="frame" type="range" min="0" step="1"><p id="caption"></p><small>그림과 재생 시간은 원본 그대로입니다. 접지 영역은 검수자가 지정한 가정이며, 자동으로 발을 인식했다는 뜻이 아닙니다.</small><details><summary>검수 근거 보기</summary><pre id="report"></pre></details></main>
<script>const D=${serialized}; const $=id=>document.getElementById(id); const canvas=$('view'),ctx=canvas.getContext('2d');let index=0,elapsed=0,previous=0,playing=true,world=0;const images=D.images.map(src=>{const i=new Image();i.src=src;return i});$('frame').max=images.length-1;$('travel').disabled=D.report.status!=='pass';$('status').textContent=({pass:'검수 통과',fail:'검수 실패',unverified:'검수 미완료'})[D.report.status]+' · '+images.length+' 프레임 · 서버 등록 전';$('report').textContent=JSON.stringify(D.report,null,2);$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'일시정지':'재생'};function step(n){playing=false;elapsed=0;index=(index+n+images.length)%images.length;$('play').textContent='재생'}$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('frame').oninput=e=>{step(0);index=+e.target.value};function draw(t){const dt=previous?Math.min(100,t-previous):0;previous=t;if(playing){elapsed+=dt*+$('speed').value;while(elapsed>=D.durations[index]){elapsed-=D.durations[index];index=(index+1)%images.length}if($('travel').checked)world+=dt/1000*+$('speed').value*D.report.speedPixelsPerSecond}ctx.clearRect(0,0,1000,560);const x=$('travel').checked?((world+300)%850)-100:244,y=20;ctx.drawImage(images[index],x,y);if($('overlay').checked){ctx.strokeStyle='#60758d';ctx.beginPath();ctx.moveTo(0,y+D.plan.geometry.groundY);ctx.lineTo(1000,y+D.plan.geometry.groundY);ctx.stroke();ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(x+D.plan.geometry.width/2,0);ctx.lineTo(x+D.plan.geometry.width/2,560);ctx.stroke();ctx.setLineDash([]);for(const s of D.report.stances||[]){if(index>=s.start&&index<=s.end){ctx.strokeStyle=s.foot==='near'?'#d55c12':'#8752c9';ctx.lineWidth=2;ctx.strokeRect(x+s.box[0],y+s.box[1],s.box[2],s.box[3]);ctx.fillStyle=ctx.strokeStyle;ctx.fillText(s.foot,x+s.box[0],y+s.box[1]-8)}}}if($('overlay').checked){for(const [foot,color] of [['near','#d55c12'],['far','#8752c9']]){const pg=D.report.projectedGround,ground=pg?.baselines?.[foot],point=pg?.observations?.[index]?.[foot]?.point;if(Number.isFinite(ground)){ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y+ground);ctx.lineTo(x+D.plan.geometry.width,y+ground);ctx.stroke();ctx.fillStyle=color;ctx.fillText(foot+' ground '+ground,x+8,y+ground-5)}if(point){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x+point[0],y+point[1],3,0,Math.PI*2);ctx.fill()}}for(const r of D.report.stanceReports||[]){const fs=r.foot_evidence?.declaration?.frames;const f=Array.isArray(fs)?fs.find(f=>f?.frame===index):null;if(!f)continue;for(const [name,color] of [['near','#d55c12'],['far','#8752c9']]){const points=f[name+'Outline'];if(!Array.isArray(points)||points.length<3||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))continue;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(x+p[0],y+p[1]):ctx.moveTo(x+p[0],y+p[1]));ctx.closePath();ctx.stroke();ctx.fillStyle=color;ctx.fillText('declared '+name,x+points[0][0],y+points[0][1]-6)}for(const name of ['heel','forefoot']){const p=f[name];if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))continue;ctx.fillStyle='#cb2965';ctx.beginPath();ctx.arc(x+p[0],y+p[1],3,0,Math.PI*2);ctx.fill()}}}const p=D.plan.phases[index];$('frame').value=index;$('caption').textContent='프레임 '+index+' / '+(images.length-1)+' · 계획: '+(p?.pose||'?')+' · 지지발: '+(p?.support.join(' + ')||'공중');requestAnimationFrame(draw)}Promise.all(images.map(i=>i.decode())).then(()=>requestAnimationFrame(draw));</script></html>`;
  await writeFile(path.join(out, 'preview.html'), html);
  const cellW = sequence.frames[0].width,
    cellH = sequence.frames[0].height + 32,
    columns = 4;
  const tiles = [];
  for (const [i, image] of images.entries()) {
    tiles.push({ input: image, left: (i % columns) * cellW, top: Math.floor(i / columns) * cellH + 32 });
    const label = `<svg width="${cellW}" height="${cellH}"><text x="12" y="22" font-family="sans-serif" font-size="16">${i} · ${escape(plan.phases[i]?.pose ?? 'extra')}</text><path d="M0,${32 + plan.geometry.groundY}H${cellW}" stroke="#60758d"/></svg>`;
    tiles.push({ input: Buffer.from(label), left: (i % columns) * cellW, top: Math.floor(i / columns) * cellH });
  }
  await sharp({ create: { width: cellW * columns, height: cellH * Math.ceil(images.length / columns), channels: 4, background: '#e7ecf2' } })
    .composite(tiles)
    .png()
    .toFile(path.join(out, 'contact-sheet.png'));
}

/** @param {string} planFile @param {string} out @param {string} [annotationsFile] */
async function review(planFile, out, annotationsFile) {
  const plan = await json(planFile),
    sequence = /** @type {Sequence} */ (await loadSequence(plan.source, path.dirname(path.resolve(planFile))));
  validatePlan(plan, sequence);
  await mkdir(out, { recursive: true });
  const annotations = annotationsFile ? await json(annotationsFile) : null,
    reports = [];
  if (annotations && annotations.sequenceSha256 !== sequence.sha256) throw Error('Annotations are stale; review the current sequence.');
  // Snapshot the exact decoded cells, without resize, alignment, interpolation or timing edits.
  // The official inspector supports this external-asset descriptor. It is measurement input,
  // not a replacement sprite-gen atlas or a new generated asset.
  const snapshotDir = path.resolve(out, 'measurement');
  await mkdir(snapshotDir, { recursive: true });
  for (const [i, frame] of sequence.frames.entries())
    await sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
      .png()
      .toFile(path.join(snapshotDir, `${i}.png`));
  sequence.measurementFile = path.join(snapshotDir, 'sequence.json');
  await save(sequence.measurementFile, {
    kind: 'sprite-gen-asset',
    version: 1,
    frames: sequence.frames.map((_, i) => ({ file: `${i}.png`, duration: sequence.durations[i] / 1000 })),
  });
  for (const [i, stance] of (annotations?.stances ?? []).entries())
    reports.push(
      await measure(sequence, plan, stance, path.resolve(out, `stance-${i}.json`), path.dirname(path.resolve(/** @type {string} */ (annotationsFile)))),
    ); // stances come from it
  const report = combineReview(sequence, plan, annotations, reports);
  await save(path.join(out, 'review.json'), report);
  await save(path.join(out, 'annotations-template.json'), {
    version: 1,
    sequenceSha256: sequence.sha256,
    visual: { identity: 'unverified', anatomy: 'unverified', alternation: 'unverified', loop: 'unverified', notes: '' },
    stances: [],
  });
  await preview(sequence, plan, report, out);
  return { ok: report.status === 'pass', status: report.status, sequenceSha256: sequence.sha256, errors: report.errors, missing: report.missing, out };
}

/**
 * The hosted generation's walk/run record (reviewPolicy engine-loop). Config, paths relative to it: { motion, source: { file, animation }
 * (the final game pack), strip (the cut's strip.json from video-loop / video-cycle-align), verdict (the judge's JSON: identity, anatomy,
 * loop, notes), judge (who judged), stridePixels (walk) }.
 */
/** @param {string} configFile @param {string} out */
async function writeLoopReview(configFile, out) {
  const config = await json(configFile),
    base = path.dirname(path.resolve(configFile));
  const sequence = await loadSequence(config.source, base);
  const review = loopReview({
    motion: config.motion,
    sequence,
    strip: await json(path.resolve(base, config.strip)),
    visual: await json(path.resolve(base, config.verdict)),
    judge: config.judge,
    stridePixels: config.stridePixels,
  });
  await save(out, review);
  return { ok: review.status === 'pass', status: review.status, sequenceSha256: review.sequenceSha256, errors: review.errors, out };
}

/** One `sprite-gen scale-check` run. Exit 1 with a report is a finished measurement with frames left for an eye check; exit 1
 * without one is a refusal (the report is removed first, so an earlier run's report can never stand in for this one). */
/** @param {{ report: string, args: string[] }} run */
async function runScaleCheck(run) {
  await rm(run.report, { force: true });
  await /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      const child = spawn(spritePython, ['-m', 'sprite_gen.cli', ...run.args], {
        cwd: root,
        env: { ...process.env, PYTHONUTF8: '1' },
        windowsHide: true,
        timeout: 30 * 60_000,
      });
      let error = '';
      child.stdout.resume();
      child.stderr.on('data', chunk => {
        error += chunk;
      });
      child.on('error', reject);
      child.on('close', (code, signal) =>
        code === 0 || (code === 1 && existsSync(run.report))
          ? resolve()
          : reject(Error(signal ? `scale-check stopped after 30 minutes (${signal})` : 'scale-check failed: ' + error.slice(-3000))),
      );
    })
  );
  return json(run.report);
}

/**
 * The common game-pack request. Unless the config says `"scaleCheck": false`, sprite-gen's scale-check first measures every
 * frame's figure against the neutral reference by its head (one report and review board per source file, beside `out`) and the
 * request brings each frame to that size: a walk or run at one scale for the cycle, any other clip frame by frame. A frame it
 * could not measure stops the request until someone looks at the board and gives `scaleCheck.fix`, keyed by asset id
 * (`"walk"` for a cycle, `"combo/2"` for one frame, `"combo"` for every frame of a clip).
 */
/** @param {string} configFile @param {string} out */
export async function gameRequest(configFile, out) {
  const config = await json(configFile),
    base = path.dirname(path.resolve(configFile)),
    outDir = path.dirname(path.resolve(out));
  // a request this command made before must not outlive a run that stops: game-pack would pack it
  await rm(out, { force: true });
  await rm(out + '.scale.json', { force: true });
  const result = await commonGameRequest(config, base); // the request's own checks come before minutes of measuring
  /** @type {false | string[]} */
  let scaleCheck = false;
  if (config.scaleCheck !== false) {
    const errors = scaleCheckConfigErrors(config);
    if (errors.length) return { ok: false, code: 'SCALE_CHECK_CONFIG', errors };
    if (!existsSync(spritePython)) throw Error('Run npm run sprite:setup first: game-request measures frames with the bundled sprite-gen.');
    const runs = scaleCheckRuns(config, base, out),
      reports = [];
    for (const run of runs) reports.push(await runScaleCheck(run));
    const {
      entries,
      unsettled,
      errors: fixErrors,
    } = /** @type {{ entries: Record<string, object>, unsettled: string[], errors: string[] }} */ (scaleCheckEntries(config, base, runs, reports, outDir));
    if (fixErrors.length) return { ok: false, code: 'SCALE_CHECK_CONFIG', errors: fixErrors };
    if (unsettled.length)
      return {
        ok: false,
        code: 'SCALE_CHECK_EYE_CHECK',
        unsettled,
        boards: runs.map(run => run.board),
        reports: runs.map(run => run.report),
        next: 'Look at the boards; give scaleCheck.fix in the config by asset id ("walk" for a cycle, "combo/2" for one frame), then run game-request again.',
      };
    result.request.assets.forEach(asset => {
      /** @type {Record<string, unknown>} */ (asset).scale_check = entries[asset.id];
    });
    result.note =
      'One measured neutral reference scale, and every frame brought to the reference figure size by scale-check (head-measured). Shared canvas is checked; anatomy still needs visual review.';
    scaleCheck = runs.map(run => path.relative(outDir, run.report));
  }
  // Resolve source files relative to the output request, not its input config.
  result.request.assets.forEach(asset => {
    asset.source = path.relative(outDir, path.resolve(base, asset.source));
  });
  await save(out, result.request);
  await save(out + '.scale.json', { ...result, request: undefined });
  return { ok: true, out, referenceBodyHeight: result.referenceBodyHeight, scaleCheck };
}

/** @param {string[]} args */
async function main(args) {
  const [command, first, second, third] = args;
  if (command === 'init' && first) return init(first);
  if (command === 'bind-keyposes' && first && second && third) return bindKeyposes(first, second, third);
  if (command === 'review' && first && second) return review(first, second, third);
  if (command === 'loop-review' && first && second) return writeLoopReview(first, second);
  if (command === 'game-request' && first && second) return gameRequest(first, second);
  throw Error(
    'Usage: npm run fighter:gait -- init <new-directory> | bind-keyposes <request.json> <image.png> <review.json> | review <plan.json> <out-directory> [annotations.json] | game-request <config.json> <game.json> | loop-review <config.json> <review.json>',
  );
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2))
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      if (result.ok === false) process.exitCode = 2;
    })
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
