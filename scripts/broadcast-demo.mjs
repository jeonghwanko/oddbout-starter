// @ts-check
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createCommerceService } from '../api/commerce/service.mjs';
import { commerceFromEnvironment } from '../api/commerce/config.mjs';
import { createCommerceStore } from '../api/commerce/store.mjs';
import { createPaidOperations } from '../api/commerce/paid-operations.mjs';
import { createPaidOperationHandler } from '../api/commerce/paid-handler.mjs';
import { createRecoveryWorker } from '../api/commerce/payment-recovery.mjs';
import { createCommerceHandler } from '../api/commerce/handler.mjs';
import { createCampaignService, CAMPAIGN_PRODUCTS } from '../api/commerce/campaigns.mjs';
import { createCampaignExecution } from '../api/commerce/campaign-execution.mjs';
import { createCampaignHandler } from '../api/commerce/campaign-handler.mjs';
import { createCampaignMedia } from '../api/commerce/campaign-media.mjs';
import { Problem } from '../api/http.mjs';
import { verifiedUserId } from '../api/http.mjs';
import { createCommerceMcpHandler, createIssuedProducerGrants } from '../mcp/cloud/commerce-handler.mjs';
import { createBroadcastWorkerHandler } from '../broadcast/worker-api.mjs';
import { createProducerModel } from '../broadcast/producer.mjs';
import { createProducerSupervisor } from '../broadcast/supervisor.mjs';
import { createConcierge, createConciergeModel } from '../broadcast/concierge.mjs';
import { createReconciler } from '../broadcast/reconcile.mjs';
import { COMMERCE_CATALOG } from '../api/commerce/catalog.mjs';
import { createPayoutService, payoutReceivers } from '../api/commerce/payouts.mjs';
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
  const db = url && secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) }) } }) : null;
  const get = (/** @type {string} */ name) => name === 'ODDBOUT_COMMERCE_ORIGIN' ? publicOrigin : env[name];
  const commerce = db ? commerceFromEnvironment({ db, get }) : null;
  if (env.ODDBOUT_PAID_OPERATIONS && !['0', '1'].includes(env.ODDBOUT_PAID_OPERATIONS)) throw new Error('invalid-paid-operations-setting');
  if (env.ODDBOUT_PAID_OPERATIONS === '1' && !commerce) throw new Error('paid-operations-commerce-required');
  const paidOperations = commerce && env.ODDBOUT_PAID_OPERATIONS === '1'
    ? createPaidOperations({ store: commerce.store, commerce: commerce.service, publicOrigin,
      ...(env.ODDBOUT_BROADCAST_AUTO_PRODUCER === '1' ? {
        ensureProducer: (/** @type {string} */ owner, /** @type {string} */ id) => supervisor?.ensure(owner,id),
      } : {}) }) : null;
  const paidApi = paidOperations && commerce && db ? createPaidOperationHandler({ service: paidOperations, store: commerce.store,
    publicOrigin, authenticate: request => verifiedUserId(db, request) }) : null;
  const paymentWorker = paidOperations ? createRecoveryWorker({ recovery: paidOperations.recovery,
    continueBroadcasts: () => paidOperations.continueBroadcasts(),
    log: event => console.error(JSON.stringify(event)) }) : null;
  const previewService = createCommerceService({ store: createCommerceStore({ rpc: async () => ({ data: null, error: { message: 'unconfigured' } }) }),
    paypal: null, publicOrigin, hosts: [{ id: 'current-pc' }, { id: 'office-stable' }, { id: 'svl-mac-01' }] });
  const producers = env.ODDBOUT_BROADCAST_PRODUCERS_JSON ? JSON.parse(env.ODDBOUT_BROADCAST_PRODUCERS_JSON) : [];
  const issued = createIssuedProducerGrants();
  const mcp = db && commerce ? createCommerceMcpHandler({ db, commerce, producers, issued }) : null;
  const supervisor = mcp && commerce ? autoProducerFromEnvironment(env, { commerce, issued, mcp }) : null;
  const payouts = commerce ? payoutsFromEnvironment(env, commerce) : null;
  const concierge = commerce ? conciergeFromEnvironment(env, { ...commerce.service, ...(payouts ? { payouts } : {}), ...(paidOperations ? { paidOperations } : {}) }) : null;
  const reconciler = commerce ? reconcilerFromEnvironment(env, commerce) : null;
  const service = commerce && (supervisor || concierge || reconciler || payouts) ? { ...commerce.service, ...(payouts ? { payouts } : {}),
    // A started session gets its producer right away; the start response never waits for it.
    ...(supervisor ? {
      /** @param {string} owner @param {unknown} input */
      async start(owner, input) { const broadcast = await commerce.service.start(owner, input); supervisor.ensure(owner, broadcast.id); return broadcast; },
      /** @param {string} owner @param {string} id */
      producer: (owner, id) => supervisor.status(owner, id) } : {}),
    ...(concierge ? {
      /** @param {string} owner @param {unknown} input */
      concierge: (owner, input) => concierge.turn(owner, input) } : {}),
    ...(reconciler ? {
      /** @param {string} owner */
      reconcile: owner => reconciler.run(owner) } : {}) } : commerce?.service;
  const api = createCommerceHandler({ service: service ?? previewService, publicOrigin, authenticate: request => db ? verifiedUserId(db, request) : Promise.resolve(null) });
  const workers = env.ODDBOUT_BROADCAST_WORKERS_JSON ? JSON.parse(env.ODDBOUT_BROADCAST_WORKERS_JSON) : [];
  const worker = db && commerce ? createBroadcastWorkerHandler({ store: createCommerceStore(db), workers }) : null;
  const campaignMedia = db && paidOperations ? createCampaignMedia({db,modelCall:env.OPENAI_API_KEY && env.ODDBOUT_BROADCAST_MODEL
    ? createConciergeModel({model:env.ODDBOUT_BROADCAST_MODEL,apiKey:env.OPENAI_API_KEY,maxOutputTokens:500}) : null}) : null;
  const campaignExecution=commerce&&campaignMedia?createCampaignExecution({store:commerce.store,supervisor,payouts,reconciler,
    hostId:env.ODDBOUT_CAMPAIGN_HOST_ID??(workers.length===1?workers[0].hostId:null)}):null;
  const campaigns = db && campaignMedia ? createCampaignService({db,...campaignMedia,...(campaignExecution?{execution:campaignExecution}:{})}) : null;
  let recoveringCampaigns=false;
  const campaignTimer=campaignExecution?setInterval(async()=>{
    if(recoveringCampaigns)return;recoveringCampaigns=true;
    try{await campaignExecution.recover();}catch{console.error('campaign-recovery-unavailable');}finally{recoveringCampaigns=false;}
  },10000):null;
  campaignTimer?.unref();
  const campaignApi = campaigns && db && campaignMedia ? createCampaignHandler({service:campaigns,publicOrigin,
    authenticate:request=>verifiedUserId(db,request),upload:async(owner,id,input)=>{
      const order=await campaigns.get(owner,id);if(order.status==='started')throw new Problem(409,'campaign-already-started');
      return campaignMedia.upload(id,input);
    }}) : null;
  const files = new Map([
    ['/broadcast/', ['web/broadcast/shop.html', 'text/html; charset=utf-8']],
    ['/broadcast/shop.mjs', ['web/broadcast/shop.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/execution.mjs', ['web/broadcast/execution.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/shop.css', ['web/broadcast/shop.css', 'text/css; charset=utf-8']],
    ['/broadcast/media-links.mjs', ['api/commerce/media-links.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/external-player.mjs', ['web/broadcast/external-player.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/watch/', ['web/broadcast/watch.html', 'text/html; charset=utf-8']],
    ['/broadcast/watch.mjs', ['web/broadcast/watch.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/program.mjs', ['web/broadcast/program.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/watch.css', ['web/broadcast/watch.css', 'text/css; charset=utf-8']],
    ['/broadcast/operator/', ['web/broadcast/index.html', 'text/html; charset=utf-8']],
    ['/broadcast/assets/showrunner.svg', ['web/broadcast/assets/showrunner.svg', 'image/svg+xml']],
    ['/broadcast/assets/don.svg', ['web/broadcast/assets/don.svg', 'image/svg+xml']],
    ['/broadcast/style.css', ['web/broadcast/style.css', 'text/css; charset=utf-8']],
    ['/broadcast/app.mjs', ['web/broadcast/app.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/operations.mjs', ['web/broadcast/operations.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/tasks/', ['web/broadcast/tasks.html', 'text/html; charset=utf-8']],
    ['/broadcast/tasks/app.mjs', ['web/broadcast/tasks.mjs', 'text/javascript; charset=utf-8']],
    ['/broadcast/tasks/style.css', ['web/broadcast/tasks.css', 'text/css; charset=utf-8']],
    ['/broadcast/supabase.js', ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'text/javascript; charset=utf-8']],
  ]);
  // Explicit asset allowlist: never turn this into an arbitrary filesystem route.
  for (const name of ['oddbout-logo', 'kuma', 'yume', 'bravow', 'beotim', 'quickcat', 'kungjjak', 'sikeundung', 'duldul', 'eoridung']) {
    files.set(`/broadcast/assets/${name}.webp`, [`web/broadcast/assets/${name}.webp`, 'image/webp']);
  }
  for (const name of ['paypal', 'google-signin']) {
    files.set(`/broadcast/assets/${name}.png`, [`web/broadcast/assets/${name}.png`, 'image/png']);
  }
  for (const name of ['dm-sans', 'space-grotesk']) {
    files.set(`/broadcast/assets/${name}.ttf`, [`web/broadcast/assets/${name}.ttf`, 'font/ttf']);
    files.set(`/broadcast/assets/${name}-OFL.txt`, [`web/broadcast/assets/${name}-OFL.txt`, 'text/plain; charset=utf-8']);
  }
  // Preserve legacy operator links and their explicitly allowlisted relative assets.
  for(const [path,file] of [...files]) if(path.startsWith('/broadcast/')&&!path.startsWith('/broadcast/operator/')) {
    if(path!=='/broadcast/')files.set(path.replace('/broadcast/','/broadcast/operator/'),file);
  }
  // The judges' entry page (static, no scripts) and the sample sponsor clip it links. Added after the legacy loop
  // so they have no /broadcast/operator/ copies.
  files.set('/broadcast/judges/', ['web/broadcast/judges.html', 'text/html; charset=utf-8']);
  // Every link on the page is absolute, so the address typed without the trailing slash serves the same page.
  files.set('/broadcast/judges', ['web/broadcast/judges.html', 'text/html; charset=utf-8']);
  files.set('/broadcast/judges.css', ['web/broadcast/judges.css', 'text/css; charset=utf-8']);
  files.set('/broadcast/assets/sample-promo.mp4', ['web/broadcast/assets/sample-promo.mp4', 'video/mp4']);
  const server = createServer(async (req, res) => {
    try {
      // Proxy health checks may use an internal Host. This route exposes liveness only.
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end('{"ok":true,"service":"oddbout-broadcast-sandbox"}'); return;
      }
      if (req.url === '/readyz' && req.method === 'GET') {
        let ready = true;
        if (paidOperations && commerce) {
          try { ready = (await commerce.store.recovery(null, 'health')).schemaVersion === 3; } catch { ready = false; }
        }
        if(campaigns&&db){for(const rpc of ['commerce_campaign','commerce_campaign_execution']){const {error}=await db.rpc(rpc,{p_owner:null,p_command:'health',p_input:{}});if(error)ready=false;}}
        res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: ready, paidTaskRecovery: Boolean(paidOperations) })); return;
      }
      if (req.headers.host !== publicUrl.host) { res.writeHead(403); res.end('invalid-host'); return; }
      const address = new URL(req.url ?? '/', publicOrigin);
      if(req.method==='GET'&&address.pathname==='/campaigns/catalog'){
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:true,data:{products:CAMPAIGN_PRODUCTS,defaultProductId:'spotlight-hour'}}));return;
      }
      if (address.pathname === '/') { res.writeHead(302, { location: '/broadcast/' }); res.end(); return; }
      if(req.method==='GET'&&address.pathname==='/broadcast/'&&address.searchParams.has('operation')){
        res.writeHead(302,{location:'/broadcast/operator/'+address.search});res.end();return;
      }
      if (req.method === 'GET' && ['/broadcast/config','/broadcast/operator/config'].includes(address.pathname)) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ supabaseUrl: url ?? null, publishableKey: publishableKey ?? null, authConfigured: Boolean(db && publishableKey),
          commerceEnabled: Boolean(commerce), campaigns:Boolean(campaigns), paidOperations: Boolean(paidOperations), autoProducer: Boolean(supervisor), concierge: Boolean(concierge), reconciliation: Boolean(reconciler), payouts: payouts ? { feeCents: payouts.feeCents } : null, publicOrigin, mode: commerce ? 'sandbox' : 'preview-unconfigured' })); return;
      }
      const file = files.get(address.pathname);
      if (req.method === 'GET' && file) {
        const bytes = await readFile(new URL(file[0], root));
        if(['/broadcast/','/broadcast/watch/'].includes(address.pathname)){
          const authOrigin=url?new URL(url).origin:'';
          res.setHeader('content-security-policy',`default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self' blob: ${authOrigin}; connect-src 'self' ${authOrigin}; frame-src https://oddbout-broadcast-arena.onrender.com https://www.youtube-nocookie.com https://player.twitch.tv https://clips.twitch.tv; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`);
          res.setHeader('x-frame-options','DENY');
        }
        if (address.pathname === '/broadcast/tasks/') {
          const authOrigin = url ? new URL(url).origin : '';
          res.setHeader('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${authOrigin}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`);
          res.setHeader('x-frame-options', 'DENY');
          res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
        }
        res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(bytes); return;
      }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 262144) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
      const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const body = Buffer.concat(chunks);
      const request = new Request(address, { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method ?? '') ? {} : { body }) });
      let response;
      if (address.pathname.startsWith('/campaigns/')&&campaignApi) response = await campaignApi(request);
      else if (address.pathname.startsWith('/commerce/')) response = await api(request);
      else if ((address.pathname.startsWith('/paid-operations/') || address.pathname.startsWith('/paid-agent/')) && paidApi) response = await paidApi(request, { clientAddress: req.socket.remoteAddress });
      else if ((address.pathname === '/mcp' || address.pathname === '/mcp/.well-known/oauth-protected-resource') && mcp) response = await mcp(request);
      else if (address.pathname.startsWith('/commerce-worker/') && worker) response = await worker(request);
      else response = new Response(JSON.stringify({ ok: false, code: 'not-configured-or-not-found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"ok":false,"code":"demo-unavailable"}'); }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.once('listening', () => paymentWorker?.start());
  server.once('close', () => { void paymentWorker?.stop(); });
  server.on('close',()=>{if(campaignTimer)clearInterval(campaignTimer);});
  return { server, port, publicOrigin, bindHost, supervisor, paymentWorker };
}

/** Opt-in: ODDBOUT_PAYOUTS=1 pays creators an appearance fee per completed cup through PayPal Sandbox Payouts.
 * ODDBOUT_PAYOUT_RECEIVERS_JSON maps fighter ids to Sandbox personal account emails; fighters without one earn nothing.
 * @param {NodeJS.ProcessEnv} env @param {{store:any,paypal:any,merchantId:string}} commerce */
export function payoutsFromEnvironment(env, { store, paypal, merchantId }) {
  if (env.ODDBOUT_PAYOUTS === undefined || env.ODDBOUT_PAYOUTS === '0') return null;
  if (env.ODDBOUT_PAYOUTS !== '1') throw new Error('invalid-payouts-setting');
  if (!paypal || !merchantId) throw new Error('payouts-paypal-required');
  let receivers;
  try { receivers = JSON.parse(env.ODDBOUT_PAYOUT_RECEIVERS_JSON ?? 'null'); } catch { throw new Error('payout-receivers-required'); }
  return createPayoutService({ store, paypal, receivers: payoutReceivers(receivers, COMMERCE_CATALOG.fighters),
    feeCents: env.ODDBOUT_PAYOUT_FEE_CENTS === undefined ? 2 : Number(env.ODDBOUT_PAYOUT_FEE_CENTS) });
}

/** Opt-in: ODDBOUT_PAYPAL_RECONCILIATION=1 checks an account's top-ups against PayPal through the official PayPal MCP
 * server, installed apart from the kit (`npm ci --prefix deploy/paypal-mcp`). It needs the PayPal Sandbox settings;
 * with ODDBOUT_BROADCAST_MODEL and OPENAI_API_KEY an AI auditor also explains the result.
 * @param {NodeJS.ProcessEnv} env @param {{store:any,paypal:any,merchantId:string}} commerce */
export function reconcilerFromEnvironment(env, { store, paypal, merchantId }) {
  if (env.ODDBOUT_PAYPAL_RECONCILIATION === undefined || env.ODDBOUT_PAYPAL_RECONCILIATION === '0') return null;
  if (env.ODDBOUT_PAYPAL_RECONCILIATION !== '1') throw new Error('invalid-reconciliation-setting');
  if (!paypal || !merchantId) throw new Error('reconciliation-paypal-required');
  const entry = env.ODDBOUT_PAYPAL_MCP_ENTRY ?? fileURLToPath(new URL('../deploy/paypal-mcp/node_modules/@paypal/mcp/dist/index.js', import.meta.url));
  if (!existsSync(entry)) throw new Error('paypal-mcp-not-installed');
  const model = env.ODDBOUT_BROADCAST_MODEL, apiKey = env.OPENAI_API_KEY;
  return createReconciler({ listTopups: owner => store.listTopups(owner),findTopup:(owner,id)=>store.findTopup(owner,id), accessToken: () => paypal.accessToken(), merchantId, entry,
    ...(model && apiKey ? { modelCall: createConciergeModel({ model, apiKey }) } : {}) });
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
  const { server, port, publicOrigin, bindHost, supervisor, paymentWorker } = createBroadcastDemo();
  server.listen(port, bindHost, () => console.log(`ODDBOUT Sandbox console: ${publicOrigin}/broadcast/`));
  if (supervisor) console.log(`AI producers resumed: ${await supervisor.resume()}`);
  const stop = () => { server.close(); server.closeIdleConnections(); void supervisor?.close(); void paymentWorker?.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
