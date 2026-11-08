// @ts-check
import { createHash, timingSafeEqual } from 'node:crypto';
import { Problem, UUID, readBody } from '../api/http.mjs';
import { WORKER_LEASE_SECONDS, validateCupResult } from './runner.mjs';

/** Worker credentials stay on the selected host, never in a browser or MCP arguments.
 * @param {{store:ReturnType<typeof import('../api/commerce/store.mjs').createCommerceStore>,workers:{hostId:string,token:string}[]}} options */
export function createBroadcastWorkerHandler({ store, workers }) {
  if (
    workers.some(w => !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(w.hostId) || typeof w.token !== 'string' || !/^[^\s]{32,512}$/.test(w.token)) ||
    new Set(workers.map(w => w.token)).size !== workers.length
  )
    throw new Error('invalid-worker-config');
  const credentials = workers.map(w => ({ hostId: w.hostId, digest: createHash('sha256').update(w.token).digest() }));
  /** @param {Request} request */
  return async request => {
    const reply = (/** @type {unknown} */ value, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    try {
      if (request.headers.has('origin')) throw new Problem(403, 'worker-browser-forbidden');
      if (request.method !== 'POST') throw new Problem(405, 'post-required');
      const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]{32,512})$/)?.[1];
      if (!token) throw new Problem(401, 'worker-authentication-required');
      const digest = createHash('sha256').update(token).digest();
      const worker = credentials.find(entry => timingSafeEqual(entry.digest, digest));
      if (!worker) throw new Problem(401, 'worker-authentication-required');
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 65536)));
      if (!body || typeof body.workerId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.workerId) || worker.hostId.length + body.workerId.length + 1 > 128)
        throw new Problem(422, 'invalid-worker-id');
      const workerId = `${worker.hostId}:${body.workerId}`;
      const command = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
      let data;
      if (command === 'claim') data = await store.claimJob(workerId, { hostId: worker.hostId, leaseSeconds: WORKER_LEASE_SECONDS });
      else if (command === 'renew')
        data = await store.renewJob(workerId, { jobId: body.jobId, leaseToken: body.leaseToken, leaseSeconds: WORKER_LEASE_SECONDS });
      // What the ledger holds for this worker: the one job named, or its running and unknown jobs (runner reconciliation).
      else if (command === 'status') {
        if (body.jobId !== undefined && (typeof body.jobId !== 'string' || !UUID.test(body.jobId))) throw new Problem(422, 'invalid-job-id');
        data = await store.workerJobs(workerId, body.jobId === undefined ? {} : { jobId: body.jobId });
      } else if (command === 'complete') {
        if (body.outcome === 'succeeded') {
          try {
            const value = body.result;
            if (
              !Number.isSafeInteger(value?.seed) ||
              value.seed < 0 ||
              value.seed > 0xffffffff ||
              !Number.isSafeInteger(body.leaseToken) ||
              body.leaseToken < 1
            )
              throw new Error();
            const fighterIds = [value.bouts?.[0]?.leftId, value.bouts?.[0]?.rightId, value.bouts?.[1]?.leftId, value.bouts?.[1]?.rightId];
            if (new Set(fighterIds).size !== 4 || fighterIds.some(id => typeof id !== 'string' || !id)) throw new Error();
            // The durable store additionally binds these fields to its actual job.
            validateCupResult(value, { id: body.jobId, leaseToken: body.leaseToken, seed: value.seed, fighterIds });
          } catch {
            throw new Problem(422, 'invalid-result');
          }
        }
        data = await store.completeJob(workerId, { jobId: body.jobId, leaseToken: body.leaseToken, outcome: body.outcome, result: body.result });
      } else throw new Problem(404, 'not-found');
      return reply({ ok: true, data });
    } catch (error) {
      if (error instanceof Problem) return reply({ ok: false, code: error.message }, error.status);
      return reply({ ok: false, code: 'worker-request-failed' }, error instanceof SyntaxError ? 422 : 503);
    }
  };
}
