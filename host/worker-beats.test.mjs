import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_SELECT_PAD_MS, TIMING, createApi, createBeats, healthKey, idleSleepMs, nextIdleWait } from './generation-worker.mjs';

// 2026-11-07: idle claims and the minute's heartbeats were 83 % of the project's Edge requests. An idle worker now waits up to a minute
// between claims and its heartbeat rides on the claim once the server has taken one there.

test('an idle worker waits 15 s, then twice as long each empty claim, to a minute', () => {
  const waits = [TIMING.idleMs];
  for (let i = 0; i < 4; i++) waits.push(nextIdleWait(waits.at(-1) ?? 0));
  assert.deepEqual(waits, [15_000, 30_000, 60_000, 60_000, 60_000]);
  assert.ok(TIMING.idleMaxMs < 3 * 60_000, 'a host stays "on" three minutes after its last heartbeat');
  assert.equal(idleSleepMs(60_000, 15_000), 15_000 + LOOK_SELECT_PAD_MS);
  assert.equal(idleSleepMs(15_000, 60_000), 15_000);
  assert.equal(idleSleepMs(60_000, null), 60_000);
  assert.equal(idleSleepMs(60_000, 0), 60_000);
});

test('the heartbeat rides on the claim once the server says it takes one there, at most once a minute', () => {
  let clock = 1_000_000;
  const beats = createBeats(() => clock);
  // First turn: not known yet — on its own route, before the claim.
  assert.deepEqual([beats.apart(true), beats.carry(true)], [true, false]);
  beats.beaten({ ok: true, claimBeats: true });
  // Within the minute: nothing; after it: on the claim, which the server confirms.
  clock += 30_000;
  assert.deepEqual([beats.apart(true), beats.carry(true)], [false, false]);
  clock += 30_000;
  assert.deepEqual([beats.apart(true), beats.carry(true)], [false, true]);
  assert.equal(beats.claimed({ ok: true, stage: 'idle', beat: true }), 'taken');
  assert.deepEqual([beats.apart(true), beats.carry(true)], [false, false]);
  // A failed claim teaches nothing: that beat goes apart, the next one rides again.
  clock += 60_000;
  assert.equal(beats.claimed({ ok: false, code: 'edge-unreachable' }), 'apart');
  beats.beaten({ ok: true, claimBeats: true });
  clock += 60_000;
  assert.equal(beats.carry(true), true);
  // Not healthy: no claim, so the heartbeat goes on its own route.
  assert.deepEqual([beats.apart(false), beats.carry(false)], [true, false]);
});

test('after a provider went down the next heartbeat goes apart before any claim, whenever the last one went', () => {
  let clock = 1_000_000;
  const beats = createBeats(() => clock);
  beats.beaten({ ok: true, claimBeats: true });
  clock += 1_000;
  beats.reset();
  assert.deepEqual([beats.apart(true), beats.carry(true)], [true, false]);
  beats.beaten({ ok: false }); // a failed one keeps nothing back: still urgent
  clock += 1_000;
  beats.reset();
  assert.equal(beats.apart(true), true);
  beats.beaten({ ok: true, claimBeats: true });
  assert.deepEqual([beats.apart(true), beats.carry(true)], [false, false]);
  clock += 60_000;
  assert.equal(beats.carry(true), true);
});

test('an older server never gets a heartbeat on a claim; a rolled-back one stops the carrying at once', () => {
  let clock = 1_000_000;
  const older = createBeats(() => clock);
  for (let turn = 0; turn < 3; turn++, clock += 60_000) {
    assert.deepEqual([older.apart(true), older.carry(true)], [true, false]);
    older.beaten({ ok: true, capabilities: {} });
  }
  const rolled = createBeats(() => clock);
  rolled.beaten({ ok: true, claimBeats: true });
  clock += 60_000;
  assert.equal(rolled.carry(true), true);
  assert.equal(rolled.claimed({ ok: true, stage: 'idle' }), 'apart');
  rolled.beaten({ ok: true });
  clock += 60_000;
  assert.deepEqual([rolled.apart(true), rolled.carry(true)], [true, false]);
});

test('counting the wait after the turn, the backoff never stretches the gap between heartbeats past the minute', () => {
  let clock = 1_000_000;
  const beats = createBeats(() => clock);
  beats.beaten({ ok: true, claimBeats: true });
  // After a job the waits are 15, 30, 60 s: claims at +15 (next at +45), +45 (next at +105 — so it carries), then every minute.
  clock += 15_000;
  assert.equal(beats.carry(true, 30_000), false);
  clock += 30_000;
  assert.equal(beats.carry(true, 60_000), true);
  assert.equal(beats.claimed({ ok: true, stage: 'idle', beat: true }), 'taken');
  clock += 60_000;
  assert.equal(beats.carry(true, 60_000), true);
  // Not claiming: on its own route on the same reckoning.
  beats.claimed({ ok: true, beat: true });
  clock += 15_000;
  assert.deepEqual([beats.apart(false, 30_000), beats.apart(false, 60_000)], [false, true]);
});

test('a long step beats first when the minute is up, never in its first seconds, at once (after the floor) when the health changed', () => {
  let clock = 1_000_000;
  const beats = createBeats(() => clock);
  beats.beaten({ ok: true, claimBeats: true });
  clock += 20_000;
  assert.equal(beats.nextInMs(), 40_000);
  clock += 45_000;
  assert.equal(beats.nextInMs(), TIMING.beatFloorMs);
  beats.beaten({ ok: true });
  beats.reset();
  assert.equal(beats.nextInMs(), TIMING.beatFloorMs);
  assert.ok(TIMING.heartbeatMs + TIMING.beatFloorMs < 3 * 60_000);
});

test('the health the server claims on: a login gone or back changes it, the check time does not', () => {
  const health = { ok: true, codex: true, grok: true, images: ['gpt', 'grok'], at: '2026-11-07T00:00:00Z' };
  assert.equal(healthKey({ ...health, at: '2026-11-07T01:00:00Z' }), healthKey(health));
  assert.notEqual(healthKey({ ...health, codex: false, images: ['grok'] }), healthKey(health));
  assert.notEqual(healthKey({ ...health, ok: false }), healthKey(health));
});

test('the claim sends the heartbeat body the heartbeat route takes, or an empty body', async () => {
  /** @type {{ url: string, body: unknown }[]} */
  const sent = [];
  /** @type {typeof fetch} */
  const fetcher = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('{"ok":true,"stage":"idle"}');
  };
  const api = createApi({ base: 'https://api.test/ai-fighter', key: `afw_${'a'.repeat(64)}`, fetcher });
  await api.claim();
  await api.claim({ health: { ok: true, codex: true }, usage: { at: 'x' } });
  assert.deepEqual(sent, [
    { url: 'https://api.test/ai-fighter/generation-worker/claim', body: {} },
    { url: 'https://api.test/ai-fighter/generation-worker/claim', body: { health: { ok: true, codex: true }, usage: { at: 'x' } } },
  ]);
});
