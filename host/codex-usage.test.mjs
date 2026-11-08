import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codexTokensSince, codexUsage, recentRollouts, rolloutsSince } from './codex-usage.mjs';

// The `token_count` event as codex writes it into a rollout (2026-10-31, the shape of a real line — values made up).
const NOW = Date.parse('2026-10-31T03:00:00Z');
const tokenCount = ({ primary = null, secondary = null, total = 1000 } = {}) =>
  JSON.stringify({
    timestamp: '2026-10-31T02:59:00.000Z',
    ordinal: 7,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: total - 100,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 100,
          reasoning_output_tokens: 0,
          total_tokens: total,
        },
        last_token_usage: {
          input_tokens: 10,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
          total_tokens: 11,
        },
        model_context_window: 272000,
      },
      rate_limits: {
        limit_id: 'codex',
        limit_name: null,
        primary,
        secondary,
        credits: { has_credits: true, unlimited: false, balance: '0' },
        individual_limit: null,
        spend_control_reached: null,
        plan_type: 'pro',
        rate_limit_reached_type: null,
      },
    },
  });
const week = (used, resetsInDays = 3) => ({ used_percent: used, window_minutes: 10080, resets_at: Math.floor(NOW / 1000) + resetsInDays * 86400 });

async function sessionsWith(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-usage-')),
    sessions = path.join(root, 'sessions');
  for (const [rel, lines] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(sessions, rel)), { recursive: true });
    await writeFile(path.join(sessions, rel), lines.join('\n') + '\n');
  }
  return sessions;
}

test("the newest session that reported states the subscription's usage: the fuller window, its reset as an ISO time", async () => {
  const sessions = await sessionsWith({
    '2026/10/30/rollout-2026-10-30T10-00-00-a.jsonl': [tokenCount({ primary: week(5) })],
    '2026/10/31/rollout-2026-10-31T11-00-00-b.jsonl': [
      tokenCount({ primary: week(42.25), secondary: { used_percent: 12, window_minutes: 300, resets_at: Math.floor(NOW / 1000) + 3600 } }),
    ],
    // The newest session has not answered yet: the one before it is the latest report.
    '2026/10/31/rollout-2026-10-31T11-30-00-c.jsonl': [
      JSON.stringify({ type: 'session_meta', payload: { cwd: '/x' } }),
      '{"type":"event_msg","payload":{"type":"token_co',
    ],
  });
  assert.deepEqual(
    (await recentRollouts(sessions)).map(f => path.basename(f).slice(-7)),
    ['c.jsonl', 'b.jsonl', 'a.jsonl'],
  );
  assert.deepEqual(await codexUsage(sessions, NOW), { usedPercent: 42.3, windowMinutes: 10080, resetsAt: new Date(NOW + 3 * 86400_000).toISOString() });
  // A five-hour window fuller than the week's is the one that holds.
  const short = await sessionsWith({
    '2026/10/31/rollout-1.jsonl': [
      tokenCount({ primary: week(20), secondary: { used_percent: 90, window_minutes: 300, resets_at: Math.floor(NOW / 1000) + 600 } }),
    ],
  });
  assert.equal((await codexUsage(short, NOW)).usedPercent, 90);
});

test('a reading whose windows reset since, or no sessions at all, says nothing (the server falls back to its daily count)', async () => {
  const old = await sessionsWith({ '2026/10/20/rollout-1.jsonl': [tokenCount({ primary: week(99, -1) })] });
  assert.equal(await codexUsage(old, NOW), null);
  assert.equal(await codexUsage(path.join(os.tmpdir(), 'no-such-codex-sessions'), NOW), null);
  const noLimits = await sessionsWith({
    '2026/10/31/rollout-1.jsonl': [JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: null } })],
  });
  assert.equal(await codexUsage(noLimits, NOW), null);
});

// The dated folder codex writes a session into (its local day), for a time: the stage tests run on any day.
const dayOf = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};

test("a stage's tokens are the final totals of the sessions written since it began", async () => {
  const today = dayOf(Date.now());
  const sessions = await sessionsWith({
    [`${today}/rollout-1.jsonl`]: [tokenCount({ total: 500 })],
    [`${today}/rollout-2.jsonl`]: [tokenCount({ total: 100 }), tokenCount({ total: 2500 })],
    [`${today}/rollout-3.jsonl`]: [tokenCount({ total: 4000 })],
  });
  const before = new Date(Date.now() - 3600_000);
  await utimes(path.join(sessions, `${today}/rollout-1.jsonl`), before, before);
  // rollout-2's last count (2500) and rollout-3's (4000); input is total − 100 output in the fixture.
  assert.deepEqual(await codexTokensSince(sessions, Date.now() - 60_000), { total: 6500, input: 6300, cachedInput: 0, output: 200, reasoning: 0 });
  assert.deepEqual(await codexTokensSince(path.join(os.tmpdir(), 'no-such-codex-sessions'), 0), {
    total: 0,
    input: 0,
    cachedInput: 0,
    output: 0,
    reasoning: 0,
  });
});

// 리뷰 (2026-10-31): the 64 newest files could leave a long stage's sessions out. Every file in the folders from the day before the stage
// on is read; a folder a week old is not, however fresh its files.
test("a stage's tokens count every session it wrote, past 64 of them; folders before the day before are not read", async () => {
  const now = Date.now(),
    files = {};
  for (let i = 0; i < 70; i++) files[`${dayOf(now)}/rollout-${String(i).padStart(3, '0')}.jsonl`] = [tokenCount({ total: 100 })];
  files[`${dayOf(now - 7 * 86_400_000)}/rollout-old.jsonl`] = [tokenCount({ total: 99_000 })];
  const sessions = await sessionsWith(files);
  assert.equal((await rolloutsSince(sessions, now - 60_000)).length, 70);
  // Each fixture count is 100 tokens, all output (input is total − 100).
  assert.deepEqual(await codexTokensSince(sessions, now - 60_000), { total: 7000, input: 0, cachedInput: 0, output: 7000, reasoning: 0 });
});
