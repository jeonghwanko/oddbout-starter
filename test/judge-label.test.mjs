import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJudgeArchive } from '../host/generation-stages.mjs';
import { readArchive, readLabels } from '../scripts/judge-eval.mjs';
import { createLabelServer, main, pictureFile } from '../scripts/judge-label.mjs';

const pass5 = { whole: 'pass', side: 'pass', match: 'pass', style: 'pass', clean: 'pass' };
const side = (pixels, codex) => ({ jobId: 'j', jobFolder: 'job-1', item: 'side-0-a/take-0', kind: 'side', mode: codex ? 'codex' : 'hybrid',
  decidedBy: codex ? 'codex' : 'pixels', final: codex ?? pixels, pixels: { model: 'pixels-v1', observed: 'pixels-v1', checks: { ...pass5, side: 'unknown', ...pixels }, ms: 50 },
  codex: codex ? { checks: { ...pass5, ...codex }, model: 'gpt', wallMs: 9000 } : null });
const loop = { jobId: 'j', jobFolder: 'job-1', item: 'walk/take-0/cut-0', kind: 'loop', mode: 'codex', decidedBy: 'codex', final: null,
  pixels: { model: 'pixels-v1', checks: { identity: 'pass', anatomy: 'fail', loop: 'pass' }, ms: 70 },
  codex: { checks: { identity: 'pass', anatomy: 'pass', loop: 'pass' }, model: 'gpt', wallMs: 9000 } };

/** An archive the host's writer made: a side line and a loop line with their pictures, and a side line without. */
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'judge-label-')), dir = path.join(root, 'judge-archive'), pics = path.join(root, 'pics');
  await mkdir(pics);
  for (const name of ['front.png', 'take-0.png', 'look.png', 'side-walk.strip.png']) await writeFile(path.join(pics, name), `png:${name}`);
  await writeFile(path.join(pics, 'side-walk.strip.json'), JSON.stringify({ w: 32, h: 48, frames: 6, delay_ms: 90 }));
  let minute = 0;
  const archive = createJudgeArchive({ dir, saltFile: path.join(root, 'salt'), imageDays: 30, now: () => new Date(Date.UTC(2026, 10, 7, 10, minute++)) });
  const sideId = await archive.note(side({ match: 'fail' }, { match: 'pass' }), [path.join(pics, 'front.png'), path.join(pics, 'take-0.png')]);
  const loopId = await archive.note(loop, [path.join(pics, 'look.png'), path.join(pics, 'side-walk.strip.json')]);
  const bareId = await archive.note(side({ whole: 'fail' }, null));
  return { root, dir, sideId, loopId, bareId };
}

/** The server listening on a free port, with a request helper that names the host as a browser on this machine would. */
async function serve(options) {
  const server = createLabelServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  // node:http, not fetch: the Host header goes exactly as given.
  const call = (method, url, headers, body) => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: url, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: { get: name => res.headers[name] ?? null }, text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
  const get = (url, headers = {}) => call('GET', url, headers);
  const post = (url, body, headers = {}) => call('POST', url, { 'content-type': 'application/json', origin: base, ...headers }, JSON.stringify(body));
  return { server, base, get, post };
}

test('pictureFile: only the pictures a line names, inside the images folder, links out of it refused', async () => {
  const { root, dir, sideId, loopId } = await fixture();
  const { records } = readArchive(dir);
  const images = path.join(dir, 'images'), byId = Object.fromEntries(records.map(r => [r.id, r]));
  assert.ok(pictureFile(images, byId[sideId], '0-front.png')?.endsWith('0-front.png'));
  assert.ok(pictureFile(images, byId[loopId], '1-side-walk.strip.png'), 'a strip is shown as the png the archive copied beside it');
  for (const name of ['1-side-walk.strip.json', '.job', '../../judgments-2026-11.jsonl', '0-front.png/../../../../salt', 'x.png'])
    assert.equal(pictureFile(images, byId[loopId], name), null, name);
  // An edited line naming another line's folder or a path out: its pictures are dropped before they reach a path.
  assert.equal(pictureFile(images, { ...byId[sideId], id: '../..', images: ['0-front.png'] }, '0-front.png'), null);
  assert.equal(pictureFile(images, { ...byId[sideId], at: '../../../x', images: ['0-front.png'] }, '0-front.png'), null);
  // The line's folder replaced by a link (a junction on Windows) to a folder outside the archive with the same names.
  const outside = path.join(root, 'outside'), folder = path.join(images, '2026-11-07', sideId);
  await mkdir(outside); await writeFile(path.join(outside, '0-front.png'), 'secret');
  await rename(folder, `${folder}.moved`);
  await symlink(outside, folder, 'junction');
  assert.equal(pictureFile(images, byId[sideId], '0-front.png'), null, 'a link out of the images folder');
  const { server, get } = await serve({ dir, labelsFile: path.join(root, 'labels.jsonl') });
  try {
    assert.equal((await get(`/image/${sideId}/0-front.png`)).status, 404);
  } finally { server.close(); }
});

test('the server: its page and the listed pictures only, to this machine by name; labels appended, skips for this run', async () => {
  const { root, dir, sideId, loopId, bareId } = await fixture();
  const labelsFile = path.join(root, 'labels.jsonl');
  // A label given before: that check is not asked again.
  await writeFile(labelsFile, `${JSON.stringify({ id: loopId, checks: { identity: 'pass' } })}\n`);
  const { server, base, get, post } = await serve({ dir, labelsFile, sample: 10, now: () => new Date('2026-11-07T12:00:00.000Z') });
  try {
    const page = await get('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'.*connect-src 'self'/);
    assert.match(await page.text(), /<title>Judge labels<\/title>/);

    const first = await (await get('/api/next')).json();
    assert.equal(first.status.noPictures, 4, 'the line without pictures is left out (its four decided checks)');
    assert.deepEqual([first.item.id, first.item.check, first.item.why, first.item.pixels, first.item.codex], [loopId, 'anatomy', 'disagree', 'fail', 'pass']);
    assert.deepEqual(first.item.pictures.map(p => [p.role, p.url]), [['look', `/image/${loopId}/0-look.png`], ['strip', `/image/${loopId}/1-side-walk.strip.png`]]);
    assert.deepEqual(first.item.pictures[1].strip, { w: 32, h: 48, frames: 6, delayMs: 90 });
    assert.ok(!JSON.stringify(first).includes(bareId));
    const queued = first.status.queued;

    const picture = await get(`/image/${sideId}/1-take-0.png`);
    assert.deepEqual([picture.status, picture.headers.get('content-type'), await picture.text()], [200, 'image/png', 'png:take-0.png']);
    for (const url of [`/image/${sideId}/..%2F..%2F..%2Fjudgments-2026-11.jsonl`, `/image/${sideId}/%2e%2e%2f%2e%2e%2fsalt`, `/image/${sideId}/.job`,
      `/image/${loopId}/1-side-walk.strip.json`, `/image/${'f'.repeat(16)}/0-front.png`, `/image/${sideId}/%E0%A4%A`, '/judgments-2026-11.jsonl',
      '/images/2026-11-07/' + sideId + '/0-front.png', '/../salt'])
      assert.equal((await get(url)).status, 404, url);
    // Another name for this machine (DNS rebinding) or a write from another page: refused.
    assert.equal((await get('/api/next', { host: 'evil.example' })).status, 403);
    assert.equal((await post('/api/label', { id: loopId, check: 'anatomy', value: 'fail' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/label', { id: loopId, check: 'anatomy', value: 'fail' }, { 'content-type': 'text/plain' })).status, 403);
    // Not an item of the queue, not a label: nothing written.
    for (const body of [{ id: loopId, check: 'anatomy', value: 'maybe' }, { id: loopId, check: 'identity', value: 'fail' }, { id: bareId, check: 'whole', value: 'fail' },
      { id: '../x', check: 'side', value: 'fail' }, { id: loopId, check: '__proto__', value: 'pass' }])
      assert.equal((await post('/api/label', body)).status, 400, JSON.stringify(body));
    assert.equal((await readFile(labelsFile, 'utf8')).trim().split('\n').length, 1);

    const labelled = await (await post('/api/label', { id: loopId, check: 'anatomy', value: 'fail' })).json();
    assert.equal(labelled.status.labelled, 1);
    assert.notDeepEqual([labelled.item.id, labelled.item.check], [loopId, 'anatomy']);
    const skippedOne = [labelled.item.id, labelled.item.check];
    const skipped = await (await post('/api/skip', { id: labelled.item.id, check: labelled.item.check })).json();
    assert.equal(skipped.status.skipped, 1);
    assert.notDeepEqual([skipped.item?.id, skipped.item?.check], skippedOne);
    // Back: the labelled item again, with its label; labelling it again appends a line that wins.
    const back = await (await get(`/api/item?id=${loopId}&check=anatomy`)).json();
    assert.equal(back.item.label, 'fail');
    await post('/api/label', { id: loopId, check: 'anatomy', value: 'pass' });

    const lines = (await readFile(labelsFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.slice(1), [{ id: loopId, checks: { anatomy: 'fail' }, at: '2026-11-07T12:00:00.000Z' },
      { id: loopId, checks: { anatomy: 'pass' }, at: '2026-11-07T12:00:00.000Z' }]);
    assert.deepEqual({ ...readLabels(await readFile(labelsFile, 'utf8'))[loopId] }, { identity: 'pass', anatomy: 'pass' },'judge-eval reads them, the later line winning');

    // Every item labelled or skipped: nothing left.
    let state = await (await get('/api/next')).json();
    while (state.item) state = await (await post('/api/label', { id: state.item.id, check: state.item.check, value: 'pass' })).json();
    assert.equal(state.status.labelled + state.status.skipped, queued);
    assert.ok(base.startsWith('http://127.0.0.1:'));
  } finally { server.close(); }
});

test('main: listens on 127.0.0.1 only and refuses bad arguments', async () => {
  const { root, dir } = await fixture();
  const said = [];
  const run = async args => { said.length = 0; return [(await main(args, { out: line => said.push(line) })), said.join(' ')]; };
  const [started, text] = await run([dir, '--labels', path.join(root, 'labels.jsonl'), '--port', '0']);
  try {
    assert.equal(started.code, 0);
    assert.equal(started.server.address().address, '127.0.0.1');
    assert.match(text, /http:\/\/127\.0\.0\.1:\d+\//);
  } finally { started.server.close(); }
  assert.equal(existsSync(path.join(root, 'labels.jsonl')), false, 'nothing written until a label is given');
  assert.equal((await run([dir]))[0].code, 2, '--labels is required');
  assert.match((await run([dir, '--labels', path.join(root, 'none', 'labels.jsonl')]))[1], /no folder/);
  assert.match((await run([dir, '--labels', path.join(root, 'l.jsonl'), '--port', '70000']))[1], /port/);
  assert.match((await run([dir, '--labels', path.join(root, 'l.jsonl'), '--sample', '-1']))[1], /whole number/);
  assert.equal((await run([path.join(root, 'missing'), '--labels', path.join(root, 'l.jsonl')]))[0].code, 2);
});
