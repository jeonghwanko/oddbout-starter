// @ts-check
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import QRCode from 'qrcode';

/** This client owns the scoped secret; tool results never include it. No session/token file is written.
 * Reconnect a new VM/PC through the phone, then discover the same server-side operations.
 * @param {{origin:string,fetchImpl?:typeof fetch}} options */
export function createPaidOperationClient({ origin, fetchImpl = fetch }) {
  const url = new URL(origin);
  if (url.origin !== origin || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('invalid-paid-operations-origin');
  let token = '';
  /** @type {Promise<any>|undefined} */ let connecting;
  /** @type {{verificationUrl:string,userCode:string,expiresAt:string}|null} */ let pending = null;
  /** @param {string} path @param {any} [body] */
  async function request(path, body) {
    const response = await fetchImpl(`${origin}/paid-agent/${path}`, { method: body === undefined ? 'GET' : 'POST',
      redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(typeof result.code === 'string' && /^[a-z_-]{1,80}$/.test(result.code) ? result.code : 'paid-operations-unavailable');
    return result.data;
  }
  return {
    /** @param {string} label */
    async connect(label) {
      if (connecting) return connecting;
      connecting = (async () => {
      if (token) {
        try {
          const status = await request('status');
          if (status.state === 'connected') { pending = null; return status; }
          return { state: 'pending', ...pending };
        } catch (error) {
          if (!(error instanceof Error && error.message === 'device-expired')) throw error;
          token = ''; pending = null;
        }
      }
      const data = await request('connect', { label });
      token = data.token;
      pending = { verificationUrl: data.verificationUrl, userCode: data.userCode, expiresAt: data.expiresAt };
      return { state: 'pending', ...pending };
      })();
      try { return await connecting; } finally { connecting = undefined; }
    },
    catalog: () => request('catalog'),
    /** @param {any} input */
    prepare: input => request('operations', input),
    /** @param {any} input */
    prepareBroadcast: input => request('broadcasts', input),
    /** @param {{cursor?:string,filter?:string,query?:string,limit?:number,kind?:string}} [options] */
    list: (options = {}) => request('operations/page?' + new URLSearchParams(Object.entries(options).map(([key,value]) => [key,String(value)]))),
    /** @param {string} id */
    get: id => request(`operations/${encodeURIComponent(id)}`),
    /** @param {string} id */
    resume: id => request(`operations/${encodeURIComponent(id)}/resume`, {}),
  };
}

/** @param {ReturnType<typeof createPaidOperationClient>} client */
export function createPaidOperationMcp(client) {
  const server = new McpServer({ name: 'oddbout-paid-tasks', version: '1.0.0' }, { instructions:
    'Recover paid tasks across devices. First connect this client: show the pairing link/code and wait for the user to approve on their own phone. '
    + 'Always list_my_operations before creating a new task after an interruption. Resume the original operation ID; do not replace an unknown payment or job. '
    + 'Preparing a task spends nothing. Show its approval link/QR; only the owner can approve execution and PayPal Sandbox funding on the web. '
    + 'Do not ask for passwords, OTPs, callback URLs or access tokens. A completed cup proves rendering, not live streaming. '
    + 'A new requestKey means a separate purchase intent. Never create a replacement merely because a reply was lost.' });
  /** @param {string} name @param {string} description @param {z.ZodRawShape} schema
   * @param {(args:any)=>Promise<any>} run @param {boolean} [write] */
  const register = (name, description, schema, run, write = false) => server.registerTool(name,
    { description, inputSchema: z.object(schema), annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: true, openWorldHint: write } },
    async args => {
      try {
        const data = await run(args);
        /** @type {import('@modelcontextprotocol/server').CallToolResult['content']} */
        const content = [{ type: 'text', text: JSON.stringify({ ok: true, data }) }];
        const link = data?.verificationUrl ?? (['prepare_paid_operation','prepare_broadcast'].includes(name) ? data?.approvalUrl : null);
        if (link) {
          // A preview failure must not hide an already-created durable operation.
          try {
            const png = await QRCode.toDataURL(link, { width: 256, margin: 2 });
            content.push({ type: 'image', mimeType: 'image/png', data: png.split(',')[1] });
          } catch { /* The text still contains the same usable link. */ }
        }
        return { content };
      } catch (error) {
        const message = error instanceof Error && /^[a-z_-]{1,80}$/.test(error.message) ? error.message : 'paid-operations-unavailable';
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: message }) }] };
      }
    });
  register('connect_paid_operations', 'Connect this VM or PC through a phone approval. Call again after approval to confirm. The link/code are public; no credentials enter the conversation.',
    { label: z.string().min(1).max(64) }, args => client.connect(args.label), true);
  register('get_paid_operation_catalog', 'Read the configured hosts, fighters and server prices before preparing a broadcast or standalone cup.', {}, () => client.catalog());
  register('prepare_paid_operation', 'Save one four-fighter cup for human approval. No payment or execution. Reuse the exact requestKey and input after reply loss; list existing tasks after restarting.',
    { requestKey: z.uuid(), hostId: z.string().max(64), channelId: z.string().min(1).max(64), endsAt: z.string().max(40), fighterIds: z.array(z.string().max(64)).length(4) }, args => client.prepare(args), true);
  register('prepare_broadcast', 'Save the ordinary AI-produced broadcast plan in Broadcast Studio. The person explicitly approves its budget and automatic start once funded, then the existing producer schedules cups. Preparation spends nothing. Reuse the exact requestKey/input after reply loss; discover the original operation after interruption.',
    { requestKey:z.uuid(),hostId:z.string().max(64),channelId:z.string().min(1).max(64),endsAt:z.string().max(40),
      maxCredits:z.number().int().min(25).max(1000000),fighterIds:z.array(z.string().max(64)).min(4).max(9) },args=>client.prepareBroadcast(args),true);
  register('list_my_operations', 'Discover saved tasks across devices. Follow nextCursor to older pages; filter active, attention or completed tasks and search by name. Never replace a task because it is not on the first page.',
    { cursor:z.string().max(256).optional(), filter:z.enum(['all','active','attention','completed']).optional(), kind:z.enum(['broadcast','one_cup']).optional(),query:z.string().max(64).optional(), limit:z.number().int().min(1).max(50).optional() }, args => client.list(args));
  register('get_paid_operation', 'Read the original task, payment evidence and saved execution result.', { operationId: z.uuid() }, args => client.get(args.operationId));
  register('resume_paid_operation', 'Reconcile the same payment and recover the original broadcast session or standalone cup. Broadcasts continue automatically after explicit human consent and funding; standalone cups queue once on resume. Unknown work stays held. This cannot grant approval.',
    { operationId: z.uuid() }, args => client.resume(args.operationId), true);
  return server;
}
