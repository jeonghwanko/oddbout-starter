// @ts-check
// Loopback HTTP stand-in for the registration routes fighter:register calls, plus dummy job and page reads.
import { createServer } from 'node:http';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { stamp } from './seal.mjs';

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {Record<string, unknown>} body
 */
function send(response, status, body) {
  const payload = JSON.stringify(stamp(body));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-oddbout-mode': 'dummy',
  });
  response.end(payload);
}

/** @param {import('node:http').IncomingMessage} request @param {number} limit */
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('dummy-body-too-large'), { code: 'dummy-body-too-large' }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks, size)));
  });
}

/** @param {string | undefined} value */
const loopbackSocket = value => value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';

/**
 * @param {any} store
 */
export function startDummyServer(store) {
  const server = createServer(async (request, response) => {
    try {
      if (!loopbackSocket(request.socket.remoteAddress)) {
        send(response, 403, { ok: false, code: 'dummy-remote-refused' });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = request.method ?? 'GET';
      if (method === 'GET' && url.pathname === '/dummy/health') {
        const health = store.health();
        send(response, health.status, health.body);
        return;
      }
      if (method === 'GET' && parts[0] === 'dummy' && parts[1] === 'page' && parts[2] && parts[3]) {
        const found = store.page(parts[2], parts[3]);
        if (!found) {
          send(response, 404, { ok: false, code: 'not-found' });
          return;
        }
        const html = `<!doctype html><meta charset="utf-8"><title>ODDBOUT-DUMMY</title><h1>ODDBOUT-DUMMY</h1><p>Not production. This page exists only on the loopback dummy server.</p><pre>${JSON.stringify(found, null, 2).replace(/[<>&]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[character] ?? character)}</pre>`;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-oddbout-mode': 'dummy' });
        response.end(html);
        return;
      }
      const fighter = url.searchParams.get('fighter');
      if (method === 'POST' && parts.length === 1 && parts[0] === 'submissions') {
        const body = await readBody(request, spec.limits.jsonBytes);
        const result = store.createSubmission({
          text: body.toString('utf8'),
          fighterId: fighter,
          idempotencyKey: request.headers['idempotency-key']?.toString() ?? '',
        });
        send(response, result.status, result.body);
        return;
      }
      if (parts[0] === 'submissions' && parts[1] && parts[2] === 'assets' && parts[3] && method === 'PUT') {
        if (request.headers['content-type'] !== 'image/webp') {
          send(response, 415, { ok: false, code: 'webp-required' });
          return;
        }
        const body = await readBody(request, spec.limits.assetBytes);
        const result = store.putAsset(parts[1], parts[3], body);
        send(response, result.status, result.body);
        return;
      }
      if (parts[0] === 'submissions' && parts[1] && parts.length === 3 && parts[2] === 'submit' && method === 'POST') {
        const result = store.submit(parts[1]);
        send(response, result.status, result.body);
        return;
      }
      if (parts[0] === 'submissions' && parts[1] && parts.length === 2 && method === 'GET') {
        const result = store.getSubmission(parts[1]);
        send(response, result.status, result.body);
        return;
      }
      send(response, 404, { ok: false, code: 'not-found' });
    } catch (/** @type {any} */ error) {
      const code = error instanceof Error && /^dummy-[a-z0-9-]{1,60}$/.test(error.message) ? error.message : 'dummy-internal';
      if (!response.headersSent) send(response, 500, { ok: false, code });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
        server.close();
        reject(new Error('dummy-bind-failed'));
        return;
      }
      const url = `http://127.0.0.1:${address.port}`;
      store.setPageBase(url);
      resolve({
        url,
        close: () =>
          new Promise(done => {
            server.close(() => done(undefined));
            // A disconnected CLI may leave a partial upload. Session teardown
            // must not wait indefinitely for its request body before cleanup.
            server.closeAllConnections();
          }),
      });
    });
  });
}
