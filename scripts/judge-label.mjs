#!/usr/bin/env node
// @ts-check
// Labelling the judgment archive (2026-11-07): a page on 127.0.0.1 that walks judge-eval's label queue (scripts/judge-eval.mjs labelQueue:
// disagreements, a stable random sample of agreements, then what the pixels decided alone) one check at a time. It shows the two pictures
// the judges read (the front and the take, or the look and the walk/run strip, played and laid out), the check, the pixel judge's answer
// and codex's, and Pass/Fail append a label line to the labels file judge-eval reads; Skip moves on for this run.
//
// It serves nothing but its page and the pictures an archive line names (judge-eval checkedLine: an id, a time and `<index>-<name>`
// pictures), each resolved under the archive's `images` folder and refused when it lands anywhere else (a link out of it included). It
// answers only requests addressed to 127.0.0.1 or localhost, so another site cannot read it through DNS rebinding, and its page may talk to
// nothing but this server. It sends nothing anywhere: no network call leaves the machine.
//
//   node scripts/judge-label.mjs <archive-dir> --labels labels.jsonl [--port N] [--sample N]
//
// A label line: {"id":"<archive line id>","checks":{"side":"fail"},"at":"<when>"}. A later line for the same check wins (judge-eval
// readLabels), so a label given by mistake is corrected by labelling that item again (Back).
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { labelQueue, readArchive, readLabels } from './judge-eval.mjs';

/**
 * @typedef {import('./judge-eval.mjs').Line} Line
 * @typedef {import('./judge-eval.mjs').Queued} Queued
 * @typedef {{ url: string, role: string, strip?: { w: number, h: number, frames: number, delayMs: number } }} Picture
 */

/** What each check asks, as the judges' prompts put it (host/generation-stages.mjs sideJudgePrompt, host/motions.py's loop prompt). */
export const ASKED = Object.freeze(/** @type {Record<string, string>} */ ({
  whole: 'The whole character is in the take, from the top of the head to the soles; nothing is cut off.',
  side: 'The take shows the character from the side, facing right (not a 3/4 view).',
  match: 'The take is the same character as the front: face, hair, body shape, costume, colours and held item.',
  style: 'The take is coloured as plainly as the front, in the game\'s flat cel colouring; fail only for clearly heavier rendering.',
  clean: 'One character only; no text, frame, ground or scenery; no extra, missing or fused limbs.',
  identity: 'Every frame is clearly the same character as the look (face, colours, outfit, proportions, props).',
  anatomy: 'Every frame has a believable body: no extra, missing, melted or doubled limbs, no torn or ghosted parts.',
  loop: 'The last frame leads smoothly back into the first (no jump in pose, size or position).',
}));
const ROLES = Object.freeze(/** @type {Record<string, string[]>} */ ({ side: ['front', 'take'], loop: ['look', 'strip'] }));
const SHOWN = /\.(png|webp)$/;
const TYPES = Object.freeze(/** @type {Record<string, string>} */ ({ '.png': 'image/png', '.webp': 'image/webp' }));
const BODY_MAX = 4096;

/** The picture names a line may be served under: its pictures, a strip's `.json` as the `.png` the archive copied beside it. @param {Line} line */
export const shownNames = line => (line.images ?? []).map(name => name.replace(/\.json$/, '.png')).filter(name => SHOWN.test(name));

/**
 * A picture of `line` as a file under `imagesRoot` (`<day>/<id>/<name>`), or null: a name the line does not list, a path that leaves the
 * folder, a file that is not there, or one whose real path (links followed) is outside the folder's real path.
 * @param {string} imagesRoot @param {Line} line @param {string} name
 */
export function pictureFile(imagesRoot, line, name) {
  return shownNames(line).includes(name) ? lineFile(imagesRoot, line, name) : null;
}
/** `<day>/<id>/<name>` of `line` under `imagesRoot` as a real file inside it, or null. @param {string} imagesRoot @param {Line} line @param {string} name */
function lineFile(imagesRoot, line, name) {
  const root = path.resolve(imagesRoot), file = path.resolve(root, line.at.slice(0, 10), line.id, name);
  /** @param {string} from @param {string} to */
  const inside = (from, to) => { const rel = path.relative(from, to); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
  if (!inside(root, file)) return null;
  try {
    const real = realpathSync(file);
    return inside(realpathSync(root), real) && statSync(real).isFile() ? real : null;
  } catch { return null; }
}

/** A strip's frame layout from its `.json` (the frames side by side, `w`×`h` each), or null. @param {string} imagesRoot @param {Line} line @param {string} name */
function stripOf(imagesRoot, line, name) {
  const file = name.endsWith('.json') && (line.images ?? []).includes(name) ? lineFile(imagesRoot, line, name) : null;
  if (!file) return null;
  try {
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    const [w, h, frames, delayMs] = [meta?.w, meta?.h, meta?.frames, meta?.delay_ms].map(Number);
    return [w, h, frames].every(n => Number.isInteger(n) && n > 0) && frames <= 512
      ? { w, h, frames, delayMs: Number.isFinite(delayMs) && delayMs >= 10 && delayMs <= 2000 ? delayMs : 80 } : null;
  } catch { return null; }
}

/** One label line: `{ id, checks: { [check]: value }, at }`. @param {string} labelsFile @param {string} id @param {string} check @param {'pass' | 'fail'} value @param {Date} at */
export function appendLabel(labelsFile, id, check, value, at) {
  appendFileSync(labelsFile, `${JSON.stringify({ id, checks: { [check]: value }, at: at.toISOString() })}\n`);
}

/**
 * The labelling server (not yet listening): the queue judge-eval would print for `dir` and the labels already in `labelsFile`, the items
 * with no pictures left out (nothing to look at). `GET /` the page, `GET /api/next` the next item not labelled or skipped this run,
 * `GET /api/item?id=&check=` one queued item again (Back), `POST /api/label {id, check, value}` and `POST /api/skip {id, check}`,
 * `GET /image/<id>/<name>` a picture (pictureFile).
 * @param {{ dir: string, labelsFile: string, sample?: number, now?: () => Date }} options
 */
export function createLabelServer({ dir, labelsFile, sample = 5, now = () => new Date() }) {
  const imagesRoot = path.join(dir, 'images');
  const { records, skipped: unreadable } = readArchive(dir);
  const byId = new Map(records.map(r => [r.id, r]));
  const labels = existsSync(labelsFile) ? readLabels(readFileSync(labelsFile, 'utf8')) : Object.create(null);
  /** @param {Line} line @returns {Picture[] | null} */
  const picturesOf = line => {
    const roles = ROLES[line.kind] ?? [], names = line.images ?? [];
    if (names.length !== roles.length) return null;
    /** @type {Picture[]} */ const pictures = [];
    for (const [i, name] of names.entries()) {
      const shown = name.replace(/\.json$/, '.png');
      if (!pictureFile(imagesRoot, line, shown)) return null;
      const strip = stripOf(imagesRoot, line, name);
      pictures.push({ url: `/image/${line.id}/${encodeURIComponent(shown)}`, role: roles[i], ...(strip ? { strip } : {}) });
    }
    return pictures;
  };
  const all = labelQueue(records, labels, { sample });
  const queue = all.filter(q => { const line = byId.get(q.id); return line && picturesOf(line); });
  /** @param {string} id @param {string} check */
  const key = (id, check) => `${id}:${check}`;
  const done = new Set(), passed = new Set();
  const nonce = randomBytes(16).toString('base64');

  /** @param {number} index */
  const itemAt = index => {
    const q = queue[index], line = /** @type {Line} */ (byId.get(q.id));
    return { index, of: queue.length, id: q.id, check: q.check, asked: ASKED[q.check] ?? '', why: q.why, mode: q.mode, kind: q.kind, item: q.item,
      at: q.at, pixels: q.pixels, codex: q.codex, pixelChecks: line.pixels?.checks ?? null, codexChecks: line.codex?.checks ?? null,
      label: labels[q.id]?.[q.check] ?? null, pictures: picturesOf(line) };
  };
  const status = () => ({ queued: queue.length, noPictures: all.length - queue.length, labelled: done.size, skipped: passed.size,
    lines: records.length, unreadable, labelsFile: path.basename(labelsFile) });
  const next = () => {
    const index = queue.findIndex(q => !done.has(key(q.id, q.check)) && !passed.has(key(q.id, q.check)));
    return { status: status(), item: index >= 0 ? itemAt(index) : null };
  };

  return createServer((req, res) => {
    /** @param {number} code @param {string} type @param {string | Buffer} body @param {Record<string, string>} [headers] */
    const send = (code, type, body, headers = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'cross-origin-resource-policy': 'same-origin', ...headers });
      res.end(body);
    };
    /** @param {number} code @param {unknown} value */
    const json = (code, value) => send(code, 'application/json; charset=utf-8', JSON.stringify(value));
    // Only requests addressed to this machine by name (DNS rebinding), and a write only from this page (no other origin).
    const host = String(req.headers.host ?? ''), port = /** @type {any} */ (req.socket.address()).port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return send(403, 'text/plain', 'not this host\n');
    const origin = req.headers.origin;
    if (req.method === 'POST' && (origin !== `http://${host}` || !String(req.headers['content-type'] ?? '').startsWith('application/json')))
      return send(403, 'text/plain', 'not from this page\n');
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      return send(200, 'text/html; charset=utf-8', page(nonce), {
        'content-security-policy': `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
    }
    if (req.method === 'GET' && url.pathname === '/api/next') return json(200, next());
    if (req.method === 'GET' && url.pathname === '/api/item') {
      const index = queue.findIndex(q => q.id === url.searchParams.get('id') && q.check === url.searchParams.get('check'));
      return index >= 0 ? json(200, { status: status(), item: itemAt(index) }) : json(404, { error: 'not in the queue' });
    }
    const image = /^\/image\/([0-9a-f]{16})\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && image) {
      const line = byId.get(image[1]);
      let name = '';
      try { name = decodeURIComponent(image[2]); } catch { name = ''; }
      const file = line ? pictureFile(imagesRoot, line, name) : null;
      return file ? send(200, TYPES[path.extname(file)] ?? 'application/octet-stream', readFileSync(file)) : send(404, 'text/plain', 'no such picture\n');
    }
    if (req.method === 'POST' && (url.pathname === '/api/label' || url.pathname === '/api/skip')) {
      /** @type {Buffer[]} */ const chunks = []; let size = 0;
      req.on('data', chunk => { size += chunk.length; if (size <= BODY_MAX) chunks.push(chunk); });
      req.on('end', () => {
        /** @type {any} */ let body = null;
        try { body = size <= BODY_MAX ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch { body = null; }
        const q = queue.find(item => item.id === body?.id && item.check === body?.check);
        if (!q) return json(400, { error: 'not an item of this queue' });
        if (url.pathname === '/api/skip') { passed.add(key(q.id, q.check)); return json(200, next()); }
        if (body.value !== 'pass' && body.value !== 'fail') return json(400, { error: 'a label is pass or fail' });
        try { appendLabel(labelsFile, q.id, q.check, body.value, now()); } catch (/** @type {any} */ error) {
          return json(500, { error: `could not write ${path.basename(labelsFile)}: ${error?.code ?? 'error'}` });
        }
        (labels[q.id] ??= Object.create(null))[q.check] = body.value;
        done.add(key(q.id, q.check)); passed.delete(key(q.id, q.check));
        return json(200, next());
      });
      return;
    }
    return send(404, 'text/plain', 'not found\n');
  });
}

/** The page: one item at a time, its two pictures side by side (a strip also played), the answers, Pass / Fail / Skip / Back. @param {string} nonce */
function page(nonce) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Judge labels</title><style nonce="${nonce}">
:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1d1d1b;--muted:#6b6a66;--card:#fff;--line:#d9d7d1;--pass:#1f7a3f;--fail:#b3261e;--chk:#e9e7e2}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe7;--muted:#a3a19b;--card:#21211f;--line:#3a3936;--pass:#5cc285;--fail:#f08a80;--chk:#2c2b29}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:16px}header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;color:var(--muted)}
h1{font-size:22px;margin:4px 0;color:var(--fg)}.asked{margin:4px 0 12px}.pics{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px}figcaption{color:var(--muted);font-size:13px;margin-bottom:6px}
figure img,figure canvas{display:block;width:100%;height:min(55vh,480px);object-fit:contain;image-rendering:pixelated;
background:repeating-conic-gradient(var(--chk) 0 25%,transparent 0 50%) 0 0/16px 16px}.strip{grid-column:1/-1}.strip img{height:auto;max-height:40vh}
.answers{display:flex;flex-wrap:wrap;gap:8px 24px;margin:12px 0}.pass{color:var(--pass)}.fail{color:var(--fail)}b{font-weight:600}
.buttons{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.p{border-color:var(--pass);color:var(--pass)}button.f{border-color:var(--fail);color:var(--fail)}details{margin-top:12px;color:var(--muted);font-size:13px}
.err{color:var(--fail)}</style></head><body><main><div id="app">Loading…</div></main><script nonce="${nonce}">
const app = document.getElementById('app'), trail = [];
let current = null, timer = null, busy = false;
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
const answer = v => el('b', { class: v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : '' }, v ?? '—');
async function call(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await r.json().catch(() => ({ error: 'no answer' }));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}
function play(canvas, img, strip) {
  const ctx = canvas.getContext('2d'); let i = 0;
  canvas.width = strip.w; canvas.height = strip.h;
  const draw = () => { ctx.clearRect(0, 0, strip.w, strip.h); ctx.drawImage(img, i * strip.w, 0, strip.w, strip.h, 0, 0, strip.w, strip.h); i = (i + 1) % strip.frames; };
  if (img.complete) draw(); else img.addEventListener('load', draw);
  timer = setInterval(draw, strip.delayMs);
}
function show({ status, item }) {
  clearInterval(timer); current = item; app.replaceChildren();
  const counts = el('header', {}, status.queued + ' queued · ' + status.labelled + ' labelled · ' + status.skipped + ' skipped this run'
    + (status.noPictures ? ' · ' + status.noPictures + ' without pictures left out' : '') + ' · writing ' + status.labelsFile);
  if (!item) { app.append(counts, el('h1', {}, 'Nothing left to label in this run.')); return; }
  const pics = el('div', { class: 'pics' });
  for (const p of item.pictures) {
    const img = el('img', { src: p.url, alt: p.role });
    if (p.strip) {
      const canvas = el('canvas', { 'aria-label': 'the strip played' });
      pics.append(el('figure', {}, el('figcaption', {}, p.role + ', played (' + p.strip.frames + ' frames)'), canvas));
      pics.append(el('figure', { class: 'strip' }, el('figcaption', {}, p.role + ', every frame'), img));
      play(canvas, img, p.strip);
    } else pics.append(el('figure', {}, el('figcaption', {}, p.role), img));
  }
  const others = (checks) => checks ? Object.entries(checks).map(([k, v]) => k + ' ' + v).join(', ') : 'none';
  app.append(counts,
    el('h1', {}, (item.index + 1) + ' / ' + item.of + ' — ' + item.kind + ' · ' + item.check),
    el('p', { class: 'asked' }, item.asked),
    pics,
    el('div', { class: 'answers' }, el('span', {}, 'pixel judge: ', answer(item.pixels)), el('span', {}, 'codex: ', answer(item.codex)),
      el('span', {}, 'why queued: ' + item.why + ' · ' + item.mode + ' mode'), item.label ? el('span', {}, 'labelled: ', answer(item.label)) : ''),
    el('div', { class: 'buttons' },
      el('button', { class: 'p', 'data-do': 'pass' }, 'Pass (P)'), el('button', { class: 'f', 'data-do': 'fail' }, 'Fail (F)'),
      el('button', { 'data-do': 'skip' }, 'Skip (S)'), el('button', { 'data-do': 'back' }, 'Back (B)')),
    el('p', { class: 'err', id: 'err' }),
    el('details', {}, el('summary', {}, 'line'), el('p', {}, 'id ' + item.id + ' · ' + item.at + ' · ' + (item.item ?? '')),
      el('p', {}, 'pixels: ' + others(item.pixelChecks)), el('p', {}, 'codex: ' + others(item.codexChecks))));
}
async function act(what) {
  // One action at a time: a key pressed while the last answer is on its way would act on the item it replaces.
  if (busy || (!current && what !== 'back')) return;
  busy = true;
  try {
    if (what === 'back') {
      const last = trail.pop(); if (!last) return;
      return show(await call('/api/item?id=' + last.id + '&check=' + encodeURIComponent(last.check)));
    }
    const was = { id: current.id, check: current.check };
    const result = what === 'skip' ? await call('/api/skip', was) : await call('/api/label', { ...was, value: what });
    trail.push(was); show(result);
  } catch (error) { const e = document.getElementById('err'); if (e) e.textContent = String(error.message || error); }
  finally { busy = false; }
}
app.addEventListener('click', e => { const b = e.target.closest('button[data-do]'); if (b) act(b.dataset.do); });
document.addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return;
  const what = { p: 'pass', f: 'fail', s: 'skip', b: 'back' }[e.key.toLowerCase()]; if (what) { e.preventDefault(); act(what); } });
call('/api/next').then(show, error => { app.textContent = String(error.message || error); });
</script></body></html>`;
}

const USAGE = 'usage: node scripts/judge-label.mjs <archive-dir> --labels labels.jsonl [--port N] [--sample N]';
const VALUED = new Set(['--labels', '--port', '--sample']);

/** @param {string[]} argv @param {{ out?: (line: string) => void }} [io] @returns {Promise<{ code: number, server?: import('node:http').Server }>} */
export async function main(argv, { out = line => { process.stdout.write(`${line}\n`); } } = {}) {
  /** @param {string} name */
  const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = argv.find((arg, i) => !arg.startsWith('--') && !VALUED.has(argv[i - 1] ?? ''));
  const labelsFile = flag('--labels'), port = Number(flag('--port') ?? 8791), sample = Number(flag('--sample') ?? 5);
  let isDir = false;
  try { isDir = Boolean(dir) && statSync(/** @type {string} */ (dir)).isDirectory(); } catch { isDir = false; }
  if (!dir || !isDir || !labelsFile) { out(USAGE); return { code: 2 }; }
  if (!existsSync(path.dirname(path.resolve(labelsFile)))) { out(`no folder for ${labelsFile}`); return { code: 2 }; }
  if (!Number.isInteger(port) || port < 0 || port > 65535) { out('--port takes a port number (0: any free one)'); return { code: 2 }; }
  if (!Number.isInteger(sample) || sample < 0) { out('--sample takes a whole number'); return { code: 2 }; }
  const server = createLabelServer({ dir, labelsFile: path.resolve(labelsFile), sample });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(undefined)); });
  const bound = /** @type {import('node:net').AddressInfo} */ (server.address());
  out(`Labelling ${path.resolve(dir)} into ${path.resolve(labelsFile)}: http://127.0.0.1:${bound.port}/ (Ctrl+C stops)`);
  return { code: 0, server };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(({ code }) => { if (code) process.exitCode = code; },
    (/** @type {any} */ error) => { process.stderr.write(`${error?.message ?? error}\n`); process.exitCode = 1; });
}
