// @ts-check
// What the hosted MCP sends (MCP 최적화 2026-11-05): each edition's tools/list, and get_hosted_fighter on a job in its motions — the full view,
// a watch (waitSeconds) that a new draft ends, one that eight drafts in one event end (MCP 리뷰 2026-11-05), and the recent list — for
// ChatGPT (`openai/*` _meta) and for any other host. In process on the
// PGlite fixture (test/helpers), no network; signed URLs are shaped like Storage's. `node scripts/measure-mcp-bytes.mjs` prints JSON.
import { createCloudHandler, CLOUD_ISSUER, CLOUD_RESOURCE, DIRECTORY_RESOURCE, SIGN_IN_RESOURCE } from '../mcp/cloud.mjs';
import { generation, webp } from '../test/helpers/generation-database.mjs';

const PROJECT = new URL(CLOUD_RESOURCE).origin;
/** @type {(value: unknown) => string} */
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
/** A Storage signed URL of ten minutes (an HS256 token over the object's path), as createSignedUrls answers. @type {(bucket: string, path: string) => string} */
const signedUrl = (bucket, path) => {
  const iat = Math.floor(Date.now() / 1000);
  return `${PROJECT}/storage/v1/object/sign/${bucket}/${path}?token=${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ url: `${bucket}/${path}`, iat, exp: iat + 600 })}.${'s'.repeat(43)}`;
};
/** One JSON-RPC call; `bytes` is its HTTP body as sent. @type {(handle: (request: Request) => Promise<Response>, url: string, method: string, params?: object, headers?: Record<string, string>) => Promise<{ bytes: number, body: any }>} */
const post = async (handle, url, method, params = {}, headers = {}) => {
  const response = await handle(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  const text = await response.text();
  return { bytes: new TextEncoder().encode(text).length, body: JSON.parse(text) };
};
/** A tool's JSON, from whichever part of the result holds it. @type {(call: { body: any }) => any} */
const valueOf = ({ body }) => body.result.structuredContent ?? JSON.parse(body.result.content[0].text);
/** @type {(owner: string) => Record<string, unknown>} */
const claims = owner => ({ sub: owner, client_id: crypto.randomUUID(), session_id: crypto.randomUUID(), iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE,
  role: 'af_mcp', af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600, email: 'measure@example.com' });
const bearer = { authorization: 'Bearer signed-connector-token-for-measure' };
const arena = { url: 'https://arena.test/oddbout-arena', key: 'k'.repeat(64), fetcher: async () => Response.json({ ok: true }) };

// The handler's own log lines would mix into the printed JSON.
const print = console.log;
console.log = () => {};
/** @type {any} */
const g = await generation();
try {
  // tools/list as a host reads it: /mcp and /claude signed out, /signin signed in (it asks every request for one).
  /** @type {any} */
  const fake = { auth: { getClaims: async () => ({ data: { claims: claims(crypto.randomUUID()) } }) }, rpc: async () => ({ data: 'usable' }) };
  const lists = createCloudHandler({ db: fake, arena, hosted: {} });
  /** @type {Record<string, { tools: number, bytes: number }>} */
  const toolsList = {};
  for (const [edition, url, headers] of /** @type {[string, string, Record<string, string>][]} */ ([['mcp', CLOUD_RESOURCE, {}], ['claude', DIRECTORY_RESOURCE, {}],
    ['signin', SIGN_IN_RESOURCE, bearer]])) {
    const { bytes, body } = await post(lists, url, 'tools/list', {}, headers);
    toolsList[edition] = { tools: body.result.tools.length, bytes };
  }

  // A job in its motions: two looks, the side view, his faces and nine drafts; a tenth comes while a watch waits.
  await g.healthy();
  const storage = g.db.storage.from;
  g.db.storage.from = (/** @type {string} */ bucket) => ({ ...storage(bucket),
    createSignedUrls: async (/** @type {string[]} */ paths) => ({ data: paths.map(path => ({ path, signedUrl: signedUrl(bucket, path) })) }) });
  const owner = claims(g.owner);
  /** @type {any} */
  const db = { ...g.db, auth: { getClaims: async () => ({ data: { claims: owner } }) },
    rpc: (/** @type {string} */ name, /** @type {any} */ args) => name === 'af_mcp_session_state' ? { data: 'usable' } : g.db.rpc(name, args) };
  const handle = createCloudHandler({ db, hosted: { pollMs: 50 } });
  /** @type {(name: string, args: object, chatgpt?: boolean) => Promise<{ bytes: number, body: any }>} */
  const call = (name, args, chatgpt = false) => post(handle, CLOUD_RESOURCE, 'tools/call', { name, arguments: args,
    ...(chatgpt ? { _meta: { 'openai/locale': 'ko' } } : {}) }, bearer);
  const jobId = valueOf(await call('request_hosted_fighter', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko',
    idempotencyKey: crypto.randomUUID() })).job.id;
  const claim = async () => (await g.work('POST', 'claim', {})).body.job;
  let held = await claim();
  /** @type {(body: object) => Promise<unknown>} */
  const lease = body => g.work('POST', 'progress', { jobId, leaseToken: held.leaseToken, ...body });
  /** @type {(name: string) => Promise<unknown>} */
  const artifact = name => g.work('PUT', `jobs/${jobId}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
  await g.work('POST', 'finish', { jobId, leaseToken: held.leaseToken, outcome: 'ok', result: { brief: { profile: { name: '빨간 주먹', names: { ko: '빨간 주먹', en: 'Red Fist' },
    description: '귀가 큰 고양이 복서.', concept: '성급하다', lines: { challenge: '덤벼!', win: '한 판 더!', lose: '다음엔…' }, stats: { power: 4, toughness: 3, speed: 2 } } } } });
  held = await claim();
  for (const name of ['look-a-0', 'look-b-0']) await artifact(name);
  await g.work('POST', 'finish', { jobId, leaseToken: held.leaseToken, outcome: 'ok', result: { candidates: ['look-a-0', 'look-b-0'] } });
  await call('choose_hosted_look', { jobId, choose: 'a' });
  held = await claim();
  for (const kind of ['side', 'expressions']) { await artifact(`${kind}-0-a`); await lease({ event: { kind, outcome: 'chosen', artifact: `${kind}-0-a` } }); }
  const clips = ['walk', 'run', 'fightIdle', 'combo', 'slam', 'dash', 'block', 'hit', 'groggy', 'fall'];
  let seq = 0;
  /** The worker's drafts list with its first `count` clips. @type {(count: number) => Promise<unknown>} */
  const drafts = async count => {
    const list = clips.slice(0, count).map(clip => ({ clip, name: `draft-${clip.toLowerCase()}-0` }));
    for (const { name } of list) await artifact(name);
    return lease({ progress: 40 + count, event: { kind: 'drafts', seq: ++seq, clips: list } });
  };
  /** A watch's look-back (90 s) names every picture of shortly before it: these events are long past, as in a chat that watches. */
  const age = () => g.sql.query("update public.af_generation_events set at = at - interval '5 minutes' where job_id = $1", [jobId]);
  /** A watch that `send` ends. @type {(chatgpt: boolean, send: () => Promise<unknown>) => Promise<number>} */
  const watch = async (chatgpt, send) => (await Promise.all([call('get_hosted_fighter', { jobId, waitSeconds: 10 }, chatgpt),
    new Promise(done => setTimeout(done, 300)).then(send)]))[0].bytes;
  /** @type {Record<string, Record<string, number>>} */
  const hosted = { full: {}, watch: {}, watchBurst: {}, list: {} };
  for (const [host, chatgpt] of /** @type {[string, boolean][]} */ ([['other', false], ['chatgpt', true]])) {
    await drafts(9);
    hosted.full[host] = (await call('get_hosted_fighter', { jobId }, chatgpt)).bytes;
    // Most reads of a chat that watches end on a change: here the tenth draft.
    await age();
    hosted.watch[host] = await watch(chatgpt, () => drafts(10));
    // After assembly the worker sends every action clip not yet drafted in one event: here eight, past two.
    await drafts(2); await age();
    hosted.watchBurst[host] = await watch(chatgpt, () => drafts(10));
    hosted.list[host] = (await call('get_hosted_fighter', {}, chatgpt)).bytes;
  }
  console.log = print;
  console.log(JSON.stringify({ toolsList, hosted: { scenario: 'one job in its motions: 2 looks, side, faces, 9 drafts (the watch ends on the 10th; '
    + 'watchBurst: on 8 drafts in one event)',
    signedUrlChars: signedUrl('af-generation', `jobs/${jobId}/draft-walk-0.webp`).length, ...hosted } }, null, 2));
} finally { console.log = print; await g.sql.close(); }
