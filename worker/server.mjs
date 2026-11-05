// @ts-check
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validProjectUrl } from '../api/client.mjs';
import { makePackageValidator } from '../mcp/package-access.mjs';
import { createBackoff } from './leased-jobs.mjs';
import { runWithConfig } from './run.mjs';
import { runProfileSetWithConfig } from './profile-sets.mjs';
import { cloudGateway } from './cloud-gateway.mjs';

/**
 * HTTP-triggered worker. Supabase owns the durable queue and five-minute leases.
 * @param {{ wakeToken: string | undefined, run: () => Promise<{ stage: string, submissionId?: string, profileSetId?: string }>, log?: (line: string) => void,
 *   commit?: string | null, backoff?: ReturnType<typeof createBackoff> }} options `backoff`: the waits after a hand-back or an API failure
 */
export function createWorkerServer({ wakeToken, run, log = console.log, commit = null, backoff = createBackoff() }) {
  if (!/^[a-f0-9]{64}$/.test(wakeToken ?? '')) throw new Error('invalid-wake-token');
  /** @type {Promise<void> | null} */
  let active = null;
  let stopping = false, requested = false;
  // Ends a wait at once when the service stops: Render's shutdown grace is shorter than the longest wait.
  const resting = new AbortController();
  // The last queue outcome, for /health. A rejected worker credential cannot recover by retrying, so it is
  // reported distinctly instead of as an ordinary retry (the token expires; see docs/CREATOR-HOSTING.md).
  /** @type {{ status: string, since: string | null }} */
  let queue = { status: 'unknown', since: null };
  /** @param {string} status */
  const observe = status => { if (queue.status !== status) queue = { status, since: new Date().toISOString() }; };
  async function drain() {
    do {
      requested = false;
      let waitMs = 0;
      try {
        while (!stopping) {
          const result = await run();
          observe('ok');
          // Never log credentials, signed URLs or package contents.
          log(JSON.stringify({ stage: result.stage, submissionId: result.submissionId, profileSetId: result.profileSetId }));
          // A job handed back (an infrastructure failure) is queued again, and af_release's trigger wakes this server at once: claimed
          // again without a wait, a short outage spent the package's ten infrastructure failures in seconds. A wake during the wait does
          // not cut it short; a finished job or an empty queue starts the backoff over.
          if (result.stage === 'retry-later') { waitMs = backoff.next(); break; }
          backoff.reset();
          if (result.stage === 'idle') break;
        }
      } catch (/** @type {any} */ error) {
        const rejected = error?.status === 401 || error?.status === 403;
        observe(rejected ? 'credential-rejected' : 'api-unavailable');
        log(JSON.stringify({ stage: rejected ? 'worker-credential-rejected' : 'retry-later' }));
        waitMs = backoff.next();
      }
      if (waitMs && !stopping) {
        log(JSON.stringify({ stage: 'retry-wait', waitMs }));
        await delay(waitMs, undefined, { signal: resting.signal }).catch(() => {});
      }
    } while (requested && !stopping);
  }
  const server = createServer(async (req, res) => {
    if (await cloudGateway(req, res)) return;
    /** @type {(status: number, body: object) => void} */
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') {
      // Stays 200 while the queue is degraded: this instance also serves the MCP gateway, and a failing
      // health check would restart it without fixing a credential. Monitor `queue.status` instead.
      return reply(stopping ? 503 : 200, { ok: !stopping, commit: /^[a-f0-9]{40}$/.test(commit ?? '') ? commit : null, queue });
    }
    if (req.method !== 'POST' || req.url !== '/wake') return reply(404, { ok: false });
    const timestamp = req.headers['x-ai-fighter-time'];
    const seconds = typeof timestamp === 'string' && /^\d{10}$/.test(timestamp) ? Number(timestamp) : 0;
    const age = Math.floor(Date.now() / 1000) - seconds;
    if (seconds === 0 || age < -30 || age > 180) return reply(401, { ok: false });
    // The managed pg_net queue can be readable by database roles. It receives only
    // a short-lived HMAC, never the durable wake key stored in Vault and Render.
    // Both strings by now: the wake token was checked above, and a timestamp that is not ten digits was refused.
    const expected = Buffer.from(`Bearer ${createHmac('sha256', /** @type {string} */ (wakeToken)).update(/** @type {string} */ (timestamp)).digest('hex')}`);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply(401, { ok: false });
    }
    if (stopping) return reply(503, { ok: false });
    req.resume(); // No user-supplied job payload; claim only from the authenticated queue.
    requested = true;
    if (!active) active = drain().finally(() => { active = null; });
    reply(202, { ok: true });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return {
    server,
    async stop() {
      stopping = true;
      resting.abort();
      server.close();
      server.closeIdleConnections();
      await active;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = { url: process.env.AI_FIGHTER_PROJECT_URL, workerToken: process.env.AI_FIGHTER_WORKER_TOKEN };
  if (!validProjectUrl(config.url) || !/^afw_[a-f0-9]{64}$/.test(config.workerToken ?? '')) {
    throw new Error('invalid-worker-config');
  }
  // Exercise the actual native WebP decoder and child-process validator on this host.
  // This existing geometric fixture is a readiness check, never a new registered fighter.
  const started = Date.now();
  const preflight = await makePackageValidator(fileURLToPath(new URL('../', import.meta.url)))('examples/sparring-bot/fighter.json');
  if (!preflight.ok) throw new Error(`validator-preflight-failed:${preflight.stage}`);
  console.log(JSON.stringify({ stage: 'validator-ready', elapsedMs: Date.now() - started }));
  const app = createWorkerServer({
    wakeToken: process.env.AI_FIGHTER_WAKE_TOKEN,
    commit: process.env.RENDER_GIT_COMMIT,
    // Packages first; when their queue is idle, the profile sets (선수 프로필 세트, 2026-10-31).
    run: async () => {
      const result = await runWithConfig(config);
      return result.stage === 'idle' ? runProfileSetWithConfig(config) : result;
    },
  });
  app.server.listen(Number(process.env.PORT ?? 10000), '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.stop(); });
}
