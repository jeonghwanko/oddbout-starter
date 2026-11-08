import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBackoff } from '../worker/leased-jobs.mjs';
import { createWorkerServer } from '../worker/server.mjs';

/** @param {() => boolean} done */
async function until(done, ms = 2000) {
  for (const end = Date.now() + ms; !done(); await new Promise(resolve => setTimeout(resolve, 5))) if (Date.now() > end) throw new Error('timed out');
}

function headers(key, offset = 0) {
  const timestamp = String(Math.floor(Date.now() / 1000) + offset);
  return { 'x-ai-fighter-time': timestamp, authorization: `Bearer ${createHmac('sha256', key).update(timestamp).digest('hex')}` };
}

test('HTTP health does not claim; unauthorized requests cannot start work; authorized wake drains serially', async () => {
  let calls = 0,
    concurrent = 0,
    maxConcurrent = 0,
    release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const app = createWorkerServer({
    wakeToken: 'a'.repeat(64),
    log() {},
    commit: 'c'.repeat(40),
    async run() {
      calls++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      if (calls === 1) await gate;
      concurrent--;
      return { stage: calls === 1 ? 'registered' : 'idle' };
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await (await fetch(`${base}/health`)).json()).commit, 'c'.repeat(40));
    assert.equal((await fetch(`${base}/wake`, { method: 'POST' })).status, 401);
    assert.equal(calls, 0);
    assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: headers('a'.repeat(64), -181) })).status, 401);
    assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: headers('b'.repeat(64)) })).status, 401);
    const wake = () => fetch(`${base}/wake`, { method: 'POST', headers: headers('a'.repeat(64)) });
    assert.equal((await wake()).status, 202);
    assert.equal((await wake()).status, 202);
    assert.equal(calls, 1);
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(calls >= 2);
    assert.equal(maxConcurrent, 1);
  } finally {
    release();
    await app.stop();
  }
});

test('worker errors leave the service available for the next durable retry, after a wait', async () => {
  const times = [];
  const app = createWorkerServer({
    wakeToken: 'b'.repeat(64),
    log() {},
    backoff: createBackoff({ firstMs: 30, maxMs: 30 }),
    async run() {
      times.push(Date.now());
      throw new Error('transient');
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: headers('b'.repeat(64)) })).status, 202);
    }
    await until(() => times.length === 2);
    assert.ok(times[1] - times[0] >= 25, `claimed again after ${times[1] - times[0]} ms`);
  } finally {
    await app.stop();
  }
});

// 서빙 리뷰 (2026-11-05): af_release queues a handed-back job again and its trigger wakes this server at once. The drain took it again
// with no wait, and every hand-back counts toward the package's ten infrastructure failures (worker-infrastructure-limit).
test('a handed-back job is claimed again only after a growing wait; a finished job starts the wait over', async () => {
  const logs = [],
    times = [],
    stages = ['retry-later', 'retry-later', 'retry-later', 'registered', 'retry-later', 'idle'];
  /** @type {() => Promise<unknown>} */
  let wake = async () => {};
  const app = createWorkerServer({
    wakeToken: 'd'.repeat(64),
    log: line => logs.push(JSON.parse(line)),
    backoff: createBackoff({ firstMs: 40, maxMs: 100 }),
    async run() {
      times.push(Date.now());
      const stage = stages[times.length - 1] ?? 'idle';
      // The release's trigger wakes the server while this run still holds the drain.
      if (stage === 'retry-later') await wake();
      return { stage };
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  wake = () => fetch(`${base}/wake`, { method: 'POST', headers: headers('d'.repeat(64)) });
  try {
    assert.equal((await wake()).status, 202);
    await until(() => times.length >= 6);
    assert.deepEqual(
      logs.filter(entry => entry.stage === 'retry-wait').map(entry => entry.waitMs),
      [40, 80, 100, 40],
    );
    const gaps = times.slice(1).map((at, i) => at - times[i]);
    for (const [i, least] of [
      [0, 40],
      [1, 80],
      [2, 100],
      [4, 40],
    ])
      assert.ok(gaps[i] >= least - 5, `gap ${i}: ${gaps[i]} ms, at least ${least}`);
    assert.ok(gaps[3] < 40, `a finished job's next claim waited ${gaps[3]} ms`);
  } finally {
    await app.stop();
  }
});

test('stopping the service ends a wait at once', async () => {
  let calls = 0;
  const app = createWorkerServer({
    wakeToken: 'e'.repeat(64),
    log() {},
    backoff: createBackoff({ firstMs: 60_000 }),
    async run() {
      calls++;
      return { stage: 'retry-later' };
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: headers('e'.repeat(64)) })).status, 202);
  await until(() => calls === 1);
  const started = Date.now();
  await app.stop();
  assert.ok(Date.now() - started < 1000);
  assert.equal(calls, 1);
});

test('the backoff doubles from fifteen seconds to two minutes and starts over', () => {
  const backoff = createBackoff();
  assert.deepEqual(
    Array.from({ length: 6 }, () => backoff.next()),
    [15_000, 30_000, 60_000, 120_000, 120_000, 120_000],
  );
  backoff.reset();
  assert.equal(backoff.next(), 15_000);
});

test('health reports a rejected worker credential distinctly and stays up for the gateway', async () => {
  const logs = [];
  let failure = Object.assign(new Error('invalid-worker-token'), { status: 401 });
  const app = createWorkerServer({
    wakeToken: 'c'.repeat(64),
    log: line => logs.push(JSON.parse(line)),
    backoff: createBackoff({ firstMs: 1, maxMs: 1 }),
    async run() {
      if (failure) throw failure;
      return { stage: 'idle' };
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const health = async () => {
    const response = await fetch(`${base}/health`);
    return [response.status, (await response.json()).queue.status];
  };
  const wake = async () => {
    await fetch(`${base}/wake`, { method: 'POST', headers: headers('c'.repeat(64)) });
    await new Promise(resolve => setTimeout(resolve, 20));
  };
  try {
    assert.deepEqual(await health(), [200, 'unknown']);
    await wake();
    assert.deepEqual(await health(), [200, 'credential-rejected']);
    assert.ok(logs.some(entry => entry.stage === 'worker-credential-rejected'));
    failure = new Error('fetch failed');
    await wake();
    assert.deepEqual(await health(), [200, 'api-unavailable']);
    failure = null;
    await wake();
    assert.deepEqual(await health(), [200, 'ok']);
  } finally {
    await app.stop();
  }
});
