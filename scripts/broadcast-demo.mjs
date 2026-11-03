// @ts-check
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createCommerceService } from '../api/commerce/service.mjs';
import { commerceFromEnvironment } from '../api/commerce/config.mjs';
import { createCommerceStore } from '../api/commerce/store.mjs';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { verifiedUserId } from '../api/http.mjs';
import { createCommerceMcpHandler, createIssuedProducerGrants } from '../mcp/cloud/commerce-handler.mjs';
import { createBroadcastWorkerHandler } from '../broadcast/worker-api.mjs';
import { createProducerModel } from '../broadcast/producer.mjs';
import { createProducerSupervisor } from '../broadcast/supervisor.mjs';
import { createConcierge, createConciergeModel } from '../broadcast/concierge.mjs';
import { isPublishableKey } from './login.mjs';

const root = new URL('../', import.meta.url);
/** @param {NodeJS.ProcessEnv} [env] */
export function createBroadcastDemo(env = process.env) {
  const port = Number(env.ODDBOUT_BROADCAST_PORT ?? env.PORT ?? 5180);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid-demo-port');
  const bindHost = env.ODDBOUT_BROADCAST_BIND_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(bindHost)) throw new Error('invalid-demo-bind-host');
  const publicOrigin = env.ODDBOUT_COMMERCE_ORIGIN ?? `http://127.0.0.1:${port}`;
  const publicUrl = new URL(publicOrigin);
  if (publicUrl.origin !== publicOrigin) throw new Error('invalid-demo-origin');
  // Public mode is for a dedicated Sandbox service behind a TLS-terminating proxy.
  // Forwarded headers never choose the origin, callback URL, or permitted Host.
  if (bindHost === '0.0.0.0' && publicUrl.protocol !== 'https:') throw new Error('public-demo-https-required');
  const url = env.SUPABASE_URL, secret = env.SUPABASE_SERVICE_ROLE_KEY, publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (publishableKey && !isPublishableKey(publishableKey)) throw new Error('invalid-browser-publishable-key');
  if (env.ODDBOUT_COMMERCE_ENABLED === '1' && (!url || !secret || !publishableKey)) throw new Error('demo-commerce-database-required');
  const db = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const get = (/** @type {string} */ name) => name === 'ODDBOUT_COMMERCE_ORIGIN' ? publicOrigin : env[name];
  const commerce = db ? commerceFromEnvironment({ db, get }) : null;
  const previewService = createCommerceService({ store: createCommerceStore({ rpc: async () => ({ data: null, error: { message: 'unconfigured' } }) }),
    paypal: null, publicOrigin, hosts: [{ id: 'current-pc' }, { id: 'office-stable' }, { id: 'svl-mac-01' }] });
  const producers = env.ODDBOUT_BROADCAST_PRODUCERS_JSON ? JSON.parse(env.ODDBOUT_BROADCAST_PRODUCERS_JSON) : [];
  const issued = createIssuedProducerGrants();
  const mcp = db && commerce ? createCommerceMcpHandler({ db, commerce, producers, issued }) : null;
  const supervisor = mcp && commerce ? autoProducerFromEnvironment(env, { commerce, issued, mcp }) : null;
  const concierge = commerce ? conciergeFromEnvironment(env, commerce.service) : null;
  const service = commerce && (supervisor || concierge) ? { ...commerce.service,
    // A started session gets its producer right away; the start response never waits for it.
    ...(supervisor ? {
      /** @param {string} owner @param {unknown} input */
      async start(owner, input) { const broadcast = await commerce.service.start(owner, input); supervisor.ensure(owner, broadcast.id); return broadcast; },
      /** @param {string} owner @param {string} id */
      producer: (owner, id) => supervisor.status(owner, id) } : {}),
    ...(concierge ? {
      /** @param {string} owner @param {unknown} input */
      concierge: (owner, input) => concierge.turn(owner, input) } : {}) } : commerce?.service;
  const api = createCommerceHandler({ service: service ?? previewService, publicOrigin, authenticate: request => db ? verifiedUserId(db, request) : Promise.resolve(null) });
  const workers = env.ODDBOUT_BROADCAST_WORKERS_JSON ? JSON.parse(env.ODDBOUT_BROADCAST_WORKERS_JSON) : [];
  const worker = db && commerce ? createBroadcastWorkerHandler({ store: createCommerceStore(db), workers }) : null;
  const files = new Map([
    ['/broadcast/', ['web/broadcast/index.html', 'text/html; charset=utf-8']],
    ['/broadcast/style.css', ['web/broadcast/style.css', 'text/css; charset=utf-8']],
    ['/broadcast/app.mjs', ['web/broadcast/app.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/operations.mjs', ['web/broadcast/operations.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/supabase.js', ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'text/javascript; charset=utf-8']],
  ]);
  // Explicit asset allowlist: never turn this into an arbitrary filesystem route.
  for (const name of ['oddbout-logo', 'kuma', 'yume', 'bravow', 'beotim']) {
    files.set(`/broadcast/assets/${name}.webp`, [`web/broadcast/assets/${name}.webp`, 'image/webp']);
  }
  for (const name of ['paypal', 'google-signin']) {
    files.set(`/broadcast/assets/${name}.png`, [`web/broadcast/assets/${name}.png`, 'image/png']);
  }
  for (const name of ['dm-sans', 'space-grotesk']) {
    files.set(`/broadcast/assets/${name}.ttf`, [`web/broadcast/assets/${name}.ttf`, 'font/ttf']);
    files.set(`/broadcast/assets/${name}-OFL.txt`, [`web/broadcast/assets/${name}-OFL.txt`, 'text/plain; charset=utf-8']);
  }
  const server = createServer(async (req, res) => {
    try {
      // Proxy health checks may use an internal Host. This route exposes liveness only.
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end('{"ok":true,"service":"oddbout-broadcast-sandbox"}'); return;
      }
      if (req.headers.host !== publicUrl.host) { res.writeHead(403); res.end('invalid-host'); return; }
      const address = new URL(req.url ?? '/', publicOrigin);
      if (address.pathname === '/') { res.writeHead(302, { location: '/broadcast/' }); res.end(); return; }
      if (req.method === 'GET' && address.pathname === '/broadcast/config') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ supabaseUrl: url ?? null, publishableKey: publishableKey ?? null, authConfigured: Boolean(db && publishableKey),
          commerceEnabled: Boolean(commerce), autoProducer: Boolean(supervisor), concierge: Boolean(concierge), publicOrigin, mode: commerce ? 'sandbox' : 'preview-unconfigured' })); return;
      }
      const file = files.get(address.pathname);
      if (req.method === 'GET' && file) {
        const bytes = await readFile(new URL(file[0], root));
        res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(bytes); return;
      }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 262144) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const body = Buffer.concat(chunks);
      const request = new Request(address, { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method ?? '') ? {} : { body }) });
      let response;
      if (address.pathname.startsWith('/commerce/')) response = await api(request);
      else if ((address.pathname === '/mcp' || address.pathname === '/mcp/.well-known/oauth-protected-resource') && mcp) response = await mcp(request);
      else if (address.pathname.startsWith('/commerce-worker/') && worker) response = await worker(request);
      else response = new Response(JSON.stringify({ ok: false, code: 'not-configured-or-not-found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"ok":false,"code":"demo-unavailable"}'); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return { server, port, publicOrigin, bindHost, supervisor };
}

/** Opt-in: ODDBOUT_BROADCAST_CONCIERGE=1 serves the console's chat agent with the same explicit model and key as the producer.
 * @param {NodeJS.ProcessEnv} env @param {any} service */
export function conciergeFromEnvironment(env, service) {
  if (env.ODDBOUT_BROADCAST_CONCIERGE === undefined || env.ODDBOUT_BROADCAST_CONCIERGE === '0') return null;
  if (env.ODDBOUT_BROADCAST_CONCIERGE !== '1') throw new Error('invalid-concierge-setting');
  const model = env.ODDBOUT_BROADCAST_MODEL, apiKey = env.OPENAI_API_KEY;
  if (!model || !apiKey) throw new Error('concierge-model-required');
  const daily = env.ODDBOUT_BROADCAST_CONCIERGE_DAILY_CALLS === undefined ? 300 : Number(env.ODDBOUT_BROADCAST_CONCIERGE_DAILY_CALLS);
  if (!Number.isSafeInteger(daily) || daily < 1 || daily > 100_000) throw new Error('invalid-concierge-setting');
  return createConcierge({ service, modelCall: createConciergeModel({ model, apiKey }), dailyModelCalls: daily });
}

/** Opt-in: ODDBOUT_BROADCAST_AUTO_PRODUCER=1 runs the AI producer for every started session. It then
 * requires the same explicit model and key as the CLI producer, and refuses to start without them.
 * @param {NodeJS.ProcessEnv} env
 * @param {{commerce:{service:any,publicOrigin:string},issued:ReturnType<typeof createIssuedProducerGrants>,mcp:(request:Request)=>Promise<Response>}} parts */
export function autoProducerFromEnvironment(env, { commerce, issued, mcp }) {
  if (env.ODDBOUT_BROADCAST_AUTO_PRODUCER === undefined || env.ODDBOUT_BROADCAST_AUTO_PRODUCER === '0') return null;
  if (env.ODDBOUT_BROADCAST_AUTO_PRODUCER !== '1') throw new Error('invalid-auto-producer-setting');
  const model = env.ODDBOUT_BROADCAST_MODEL, apiKey = env.OPENAI_API_KEY;
  if (!model || !apiKey) throw new Error('auto-producer-model-required');
  /** @param {string} name @param {number} fallback */
  const integer = (name, fallback) => env[name] === undefined ? fallback : Number(env[name]);
  return createProducerSupervisor({ grants: issued, service: commerce.service, model,
    modelCall: createProducerModel({ model, apiKey, maxOutputTokens: integer('ODDBOUT_BROADCAST_MAX_OUTPUT_TOKENS', 600) }),
    // MCP over an in-process transport: the same handler, grant and scope checks as any producer, without a network hop.
    mcpUrl: `${commerce.publicOrigin}/mcp`, mcpFetch: (input, init) => mcp(new Request(input, init)),
    stateDir: env.ODDBOUT_BROADCAST_PRODUCER_STATE_DIR ?? '.oddbout-broadcast/producers',
    maxModelCalls: integer('ODDBOUT_BROADCAST_MAX_MODEL_CALLS', 24), maxActive: integer('ODDBOUT_BROADCAST_AUTO_PRODUCER_MAX_ACTIVE', 3),
    dailyModelCalls: integer('ODDBOUT_BROADCAST_AUTO_PRODUCER_DAILY_CALLS', 200) });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { server, port, publicOrigin, bindHost, supervisor } = createBroadcastDemo();
  server.listen(port, bindHost, () => console.log(`ODDBOUT Sandbox console: ${publicOrigin}/broadcast/`));
  if (supervisor) console.log(`AI producers resumed: ${await supervisor.resume()}`);
  const stop = () => { server.close(); server.closeIdleConnections(); void supervisor?.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
