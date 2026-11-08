import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generate, inspectWav, localBaseUrl, reuse, SOURCE_REVISION, status } from '../tools/voice-studio/client.mjs';

function wav() {
  const dataBytes = 8820;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(88200, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let offset = 44; offset < buffer.length; offset += 2) buffer.writeInt16LE(Math.round(2000 * Math.sin(offset / 7)), offset);
  return buffer;
}

async function temporary(t) {
  const root = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(root, 'voicestudio-test-'));
  assert.equal(path.dirname(directory), root);
  assert.ok(path.basename(directory).startsWith('voicestudio-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function mockFetch({ available = true, revision = SOURCE_REVISION, speech } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/health')) return Response.json({ source_revision: revision, version: '0.5.7' });
    if (url.endsWith('/openapi.json')) return Response.json({ paths: { '/v1/audio/speech': { post: {} } } });
    if (url.endsWith('/v1/audio/voices')) return Response.json({ engines: [{ id: 'supertonic3', available }] });
    if (url.endsWith('/v1/audio/speech') && speech) return speech(options);
    throw new Error(`Unexpected request ${url}`);
  };
  return { calls, fetchImpl };
}

test('loopback policy blocks remote origins, credentials, paths and query strings', () => {
  assert.equal(localBaseUrl('http://localhost:3900'), 'http://127.0.0.1:3900');
  assert.equal(localBaseUrl('http://[::1]:3900'), 'http://[::1]:3900');
  for (const value of [
    'https://example.com',
    'http://127.0.0.1.evil.test',
    'ftp://127.0.0.1',
    'http://name:secret@127.0.0.1',
    'http://127.0.0.1/private',
    'http://127.0.0.1?token=x',
  ]) {
    assert.throws(() => localBaseUrl(value), /loopback origin/);
  }
});

test('status checks pinned source and engine without POST or synthesis', async () => {
  const mock = mockFetch();
  assert.equal((await status(mock)).ready, true);
  assert.equal(mock.calls.length, 3);
  assert.ok(mock.calls.every(call => !call.options.method));
  assert.equal((await status(mockFetch({ revision: 'other' }))).ready, false);
  assert.equal((await status(mockFetch({ available: false }))).ready, false);
});

test('WAV inspection measures actual duration and rejects JSON, truncation, silence and clipping', () => {
  assert.equal(inspectWav(wav()).duration_seconds, 0.1);
  assert.throws(() => inspectWav(Buffer.from('{"error":"not audio"}')), /RIFF WAV/);
  assert.throws(() => inspectWav(wav().subarray(0, 100)), /RIFF WAV/);
  const silence = wav();
  silence.fill(0, 44);
  assert.throws(() => inspectWav(silence), /silent/);
  const clipped = wav();
  clipped.writeInt16LE(32767, 44);
  assert.throws(() => inspectWav(clipped), /clipped/);
});

test('reuse preserves WAV bytes and links a matching prior report without synthesis', async t => {
  const dir = await temporary(t);
  const input = path.join(dir, 'original.wav');
  const output = path.join(dir, 'copied.wav');
  const sourceReport = path.join(dir, 'original.json');
  const bytes = wav();
  await writeFile(input, bytes);
  await writeFile(sourceReport, JSON.stringify({ sha256: inspectWav(bytes).sha256, request: { voice: 'M1' }, response_status: 200 }));
  const mock = mockFetch();
  const result = await reuse({ input, output, sourceReport, ...mock });
  assert.equal(result.generation_performed, false);
  assert.deepEqual(await readFile(output), bytes);
  assert.equal(result.original_request.voice, 'M1');
  assert.equal(result.ai_generated, null);
  assert.equal(result.source_revision, null);
  assert.equal(result.connected_service_revision, SOURCE_REVISION);
  assert.equal(mock.calls.length, 3);
  assert.equal(JSON.parse(await readFile(`${output}.provenance.json`, 'utf8')).wav.runtime_fighter_contract, false);
});

test('reuse refuses mismatched provenance and occupied outputs', async t => {
  const dir = await temporary(t);
  const input = path.join(dir, 'original.wav');
  const output = path.join(dir, 'copy.wav');
  const sourceReport = path.join(dir, 'wrong.json');
  await writeFile(input, wav());
  await writeFile(sourceReport, '{"sha256":"wrong"}');
  await assert.rejects(reuse({ input, output, sourceReport, ...mockFetch() }), /does not match/);
  await assert.rejects(access(output));
  await writeFile(output, 'keep this');
  await assert.rejects(reuse({ input, output, ...mockFetch() }), /overwrite/);
  assert.equal(await readFile(output, 'utf8'), 'keep this');
});

test('generate calls the official route once and saves only validated WAV', async t => {
  const dir = await temporary(t);
  const output = path.join(dir, 'new.wav');
  const mock = mockFetch({
    speech: options => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'supertonic3');
      assert.equal(body.voice, 'M1');
      assert.equal(body.language, 'ko');
      assert.equal(body.speed, 0.85);
      return new Response(wav(), { headers: { 'content-type': 'audio/wav' } });
    },
  });
  const result = await generate({ output, ...mock });
  assert.equal(result.generation_performed, true);
  assert.equal(mock.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.deepEqual(await readFile(output), wav());
});

test('HTTP errors and disguised 200 JSON never become WAVs and do not trigger retries', async t => {
  const dir = await temporary(t);
  for (const [name, speech, message] of [
    ['busy', () => Response.json({ error: 'busy' }, { status: 503 }), /HTTP 503/],
    ['json', () => Response.json({ error: 'not audio' }), /not audio/],
    ['invalid', () => new Response('not a WAV', { headers: { 'content-type': 'audio/wav' } }), /RIFF WAV/],
  ]) {
    const output = path.join(dir, `${name}.wav`);
    const mock = mockFetch({ speech });
    await assert.rejects(generate({ output, ...mock }), message);
    await assert.rejects(access(output));
    assert.equal(mock.calls.filter(call => call.options.method === 'POST').length, 1);
  }
});

test('existing output or provenance blocks synthesis before any network call', async t => {
  const dir = await temporary(t);
  const output = path.join(dir, 'take.wav');
  await writeFile(`${output}.provenance.json`, 'keep provenance');
  const mock = mockFetch();
  await assert.rejects(generate({ output, ...mock }), /overwrite/);
  assert.equal(mock.calls.length, 0);
  assert.equal(await readFile(`${output}.provenance.json`, 'utf8'), 'keep provenance');
});
