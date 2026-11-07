import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMING, createApi, createBeats, nextIdleWait } from './generation-worker.mjs';

// 2026-11-07: idle claims and the minute's heartbeats were 83 % of the project's Edge requests. An idle worker now waits up to a minute
// between claims and its heartbeat rides on the claim once the server has taken one there.

test('an idle worker waits 15 s, then twice as long each empty claim, to a minute', () => {
  const waits = [TIMING.idleMs];
  for (let i = 0; i < 4; i++) waits.push(nextIdleWait(waits.at(-1) ?? 0));
  assert.deepEqual(waits, [15_000, 30_000, 60_000, 60_000, 60_000]);
  assert.ok(TIMING.idleMaxMs < 3 * 60_000, 'a host stays "on" three minutes after its last heartbeat');
});

test('the heartbeat rides on the claim once the server takes it, at most once a minute', () => {
  let clock = 1_000_000;
  const beats = createBeats(() => clock);
  // First turn: not known yet — the claim carries it; keepAlive sends none.
  assert.equal(beats.apart(true), false);
  assert.equal(beats.carry(true), true);
  assert.equal(beats.claimed({ ok: true, stage: 'idle', beat: true }), 'taken');
  // Within the minute: nothing; after it: the claim again.
  clock += 30_000;
  assert.deepEqual([beats.apart(true), beats.carry(true)], [false, false]);
  clock += 30_000;
  assert.deepEqual([beats.apart(true), beats.carry(true)], [false, true]);
  // A failed claim teaches nothing: that beat goes apart, the next one rides again.
  assert.equal(beats.claimed({ ok: false, code: 'edge-unreachable' }), 'apart');
  beats.beaten();
  clock += 60_000;
  assert.equal(beats.carry(true), true);
  // Not healthy: no claim, so the heartbeat goes on its own route.
  assert.deepEqual([beats.apart(false), beats.carry(false)], [true, false]);
  // A provider down: the next turn beats at once.
  beats.claimed({ ok: true, beat: true });
  beats.reset();
  assert.equal(beats.carry(true), true);
});

test('an older server ignores the carried heartbeat: that one goes apart at once, and every one after', () => {
  let clock = 0;
  const beats = createBeats(() => clock);
  clock = 120_000;
  assert.equal(beats.carry(true), true);
  assert.equal(beats.claimed({ ok: true, stage: 'idle' }), 'apart');
  beats.beaten();
  clock += 60_000;
  assert.deepEqual([beats.apart(true), beats.carry(true)], [true, false]);
});

test('the claim sends the heartbeat body the heartbeat route takes, or an empty body', async () => {
  /** @type {{ url: string, body: unknown }[]} */
  const sent = [];
  /** @type {typeof fetch} */
  const fetcher = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return new Response('{"ok":true,"stage":"idle"}'); };
  const api = createApi({ base: 'https://api.test/ai-fighter', key: `afw_${'a'.repeat(64)}`, fetcher });
  await api.claim();
  await api.claim({ health: { ok: true, codex: true }, usage: { at: 'x' } });
  assert.deepEqual(sent, [
    { url: 'https://api.test/ai-fighter/generation-worker/claim', body: {} },
    { url: 'https://api.test/ai-fighter/generation-worker/claim', body: { health: { ok: true, codex: true }, usage: { at: 'x' } } },
  ]);
});
