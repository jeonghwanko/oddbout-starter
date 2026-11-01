// @ts-check
// 호스팅 생성 도구 (2026-10-28): ODDBOUT's generation worker makes the fighter; the agent carries the user's answers.
import { z } from 'zod';
import { GENERATION_LIMITS, UPLOAD_TICKET_HEADER } from '../../api/generations.mjs';
import { Problem } from '../../api/http.mjs';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { profileLimits } from '../../contracts/ai-fighter/profile-limits.mjs';
import { FILE, LIBRARY_FILE_HOSTS, UUID_ARG, downloadHostFile } from './common.mjs';
/**
 * @typedef {import('./common.mjs').Identity} Identity
 * @typedef {import('./common.mjs').Hosted} Hosted
 * @typedef {import('./common.mjs').Invoke} Invoke
 * @typedef {import('./common.mjs').Register} Register
 * @typedef {import('./common.mjs').HostFile} HostFile
 */
/**
 * A job as the API shows it (api/generations.mjs), the fields hostedNext reads.
 * @typedef {{ status: string, delegate?: boolean, error?: string | null, choice?: string | null,
 *   revisionsLeft?: { appearance?: number, motions?: number }, preview?: { note?: string }[],
 *   submission?: { stage: string, fighterId?: string | null } | null,
 *   host?: { choice: string, requested?: { name?: string } | null, assigned?: unknown },
 *   queue?: { position: number, reason?: 'turn' | 'usage' | 'paused', usedPercent?: number, resetsAt?: string, dailyLimit: number, startedToday: number } | null,
 *   profileSetId?: string | null, tokens?: number | null }} HostedJob
 */

/**
 * 호스팅 생성 도구 (2026-10-28): ODDBOUT's generation worker makes the fighter from the user's words (and up to two of his pictures) and
 * the agent only carries his answers — which of two looks, one change at a time, the registration. Without them an agent drove every
 * generation step itself (dozens of calls and long guides per fighter); Grok and ChatGPT could not make a fighter at all. The routes are the
 * site's (`api/generations.mjs`); the state machine, quotas and the service switch are the database's. Listed only while the function is
 * configured for them (`ODDBOUT_HOSTED_GENERATION_TOOLS`), so a release of this code alone does not change the published tool list.
 */
export const HOSTED_INSTRUCTIONS = 'When the user wants ODDBOUT to make the fighter for him (no generation setup of his own), '
  + 'use request_hosted_fighter and follow each result\'s next. '
  + 'Save the verified get_profile account id, idempotencyKey and original arguments before sending, '
  + 'and the returned job.id. After a timeout or disconnection, verify get_profile still matches that account, '
  + 'then use get_hosted_fighter with jobId or, if the response was lost, idempotencyKey. '
  + 'With neither identifier, inspect the recent jobs without picking one arbitrarily. A key lookup never creates work; '
  + 'not-found may mean the original call has not saved its job yet. '
  + 'Preserve the unknown outcome and inspect the original call, rather than replaying request_hosted_fighter to recover it. '
  + 'Never create a new key or repeat a look/motion revision merely to recover an unknown outcome. '
  + 'Read the same job again for fresh preview URLs; a URL is not proof that the user saw the image. ';
/** States the worker is on; an answer from the user is not awaited. */
const HOSTED_WORKING = new Set(['queued', 'appearance', 'motions', 'submitting']);
/** A submission still on its way to the registry (`af_submissions`). */
const SUBMISSION_PENDING = new Set(['uploading', 'queued', 'validating']);
/** The longest wait one get_hosted_fighter call holds: enter_cup's proven wait (CUP_WAIT_MS), inside the hosts' tool timeouts and the Edge limit. */
export const HOSTED_WAIT_SECONDS = 25;
const HOSTED_POLL_MS = 3000;
const PROFILE_KEYS = ['name', 'description', 'names', 'lines', 'stats'];
/** @type {(status: string, submission: string | null) => boolean} */
const hostedSettled = (status, submission) => !HOSTED_WORKING.has(status) && !(status === 'submitted' && SUBMISSION_PENDING.has(submission ?? 'queued'));

/** What the agent does next with a job, from its state: the user's answer it asks for, or how long to wait. */
// A run the gate refused, made from the walk (the worker's `run-from-walk` preview note, 2026-10-29): the creator hears it and may film it again.
const RUN_FROM_WALK_NEXT = 'The run preview is the walk played faster: no filmed run passed the checks. Tell the user so; '
  + 'if he wants a real run, revise_hosted_motion with clip run and his words. ';
/**
 * The tokens a job took off the user's balance (보유 토큰, 2026-10-31: every token ODDBOUT's making spends, whatever the outcome).
 * @param {HostedJob} job
 */
const spent = job => Number.isSafeInteger(job.tokens) && /** @type {number} */ (job.tokens) > 0 ? ` It used ${job.tokens} of the user's tokens.` : '';
/** @param {HostedJob} job */
export function hostedNext(job) {
  const left = job.revisionsLeft ?? {}, error = job.error ? ` (${job.error})` : '';
  switch (job.status) {
    case 'queued': case 'appearance':
      if (job.status === 'appearance' && job.host?.choice !== 'oddbout' && job.host && !job.host.assigned)
        return `Waiting for ${job.host.choice === 'host' ? `the host ${job.host.requested?.name ?? ''}` : 'a host'} to take it. Tell the user, and check later with get_hosted_fighter.`;
      // 사용량으로 시작 (2026-10-31): a request to ODDBOUT waits for the worker's turn (minutes), for the subscription to come back
      // (`usage`, until `resetsAt`) or while ODDBOUT's making is paused.
      if (job.queue?.reason === 'usage')
        return `ODDBOUT's generation capacity is used up for now: this request is number ${job.queue.position} in line and starts by itself`
          + `${job.queue.resetsAt ? ` after ${job.queue.resetsAt}` : ' when capacity comes back'}. Tell the user (he may close the chat), and check later with get_hosted_fighter.`;
      if (job.queue?.reason === 'paused')
        return `ODDBOUT's making is paused: this request is number ${job.queue.position} in line and starts by itself when it resumes. `
          + 'Tell the user, and check later with get_hosted_fighter.';
      if (job.queue && job.queue.position > 1)
        return `This request is number ${job.queue.position} in line: ODDBOUT makes one stage at a time and starts it within minutes. `
          + 'Tell the user, and check later with get_hosted_fighter.';
      return job.delegate
        ? 'ODDBOUT is writing the profile, painting two front-view looks and picking one itself, '
          + 'then it makes the eleven motions (about 15 to 30 minutes in all). '
          + 'Tell the user, and check later with get_hosted_fighter.'
        : 'ODDBOUT is writing the profile and painting two front-view looks (a few minutes). Call get_hosted_fighter with waitSeconds to wait.';
    case 'appearance_ready':
      return `${job.delegate ? 'ODDBOUT could not pick a look by itself. ' : ''}Show the user both looks (candidates a and b, his fighter from the front) as images `
        + 'and ask which one: the one he picks is also his profile picture on the site and in the arena. '
        + `Then choose_hosted_look with his pick, or with one sentence to change both (${left.appearance ?? 0} changes left).`;
    case 'motions':
      return `ODDBOUT is drawing ${job.delegate ? 'the look it picked' : 'the chosen look'} from the side (job.side once it is drawn) and making the eleven motions `
        + 'from that side view (about 15 to 30 minutes). Each motion shows in job.drafts as soon as it is made; a walk or run with a state '
        + 'is still being checked and may be filmed again. Tell the user, and check later with get_hosted_fighter.';
    case 'motion_ready':
      return `${job.preview?.some(p => p.note === 'run-from-walk') ? RUN_FROM_WALK_NEXT : ''}`
        + `Show the user ${job.delegate ? `the look ODDBOUT picked (candidate ${job.choice}), ` : ''}the motion previews as images, and the profile draft. `
        + 'If he likes them, register_hosted_fighter (change only what he asks in the profile). '
        + `To fix one motion, revise_hosted_motion (${left.motions ?? 0} changes left).`;
    case 'submitting':
      return 'ODDBOUT is packaging the fighter and submitting it under the user\'s account. Call get_hosted_fighter with waitSeconds.';
    case 'submitted':
      // 출전 (2026-10-30): a registered fighter is in production until the user watches his motions and enters him.
      if (job.submission?.stage === 'registered') return `Registered: fighter ${job.submission.fighterId}, in production. Tell the user: he can watch `
        + 'every motion on his fighter page and enter him there (출전); other people meet him only after that. enter_fighter does it here '
        + 'once he confirmed each of the eleven motions. '
        + (job.profileSetId ? `His chosen front went in as his profile set (${job.profileSetId}): the home shows him once an operator approves it.`
          : 'His profile set (front picture) did not go in with it: prepare_profile_set can upload one.');
      if (job.submission?.stage === 'rejected') return `The server check refused the package. A person at ODDBOUT will look at it.${spent(job)}`;
      return 'The server is checking the package. Call get_hosted_fighter with waitSeconds.';
    case 'needs_review': return `A person at ODDBOUT is checking this step. Nothing to do now; check later.${spent(job)}`;
    case 'rejected': return `ODDBOUT declined this request${error}.${spent(job)} A different request may be made while his balance is above zero.`;
    case 'failed': return `This request failed${error}.${spent(job)} He may ask again while his balance is above zero.`;
    default: return `This request is ${job.status}; it is over.`;
  }
}
/** @param {any} result  The API's JSON. */
const withNext = result => result?.ok && result.job ? { ...result, next: hostedNext(result.job) } : result;

/**
 * 그림 올리기 표 (2026-11-01, 사용자: "grok, gemini도 이미지 생성해서 붙일 수 있어야지"): where a ticket's pictures go in. The page is the
 * site's, for the signed-in owner (the ticket's id); the terminal route is the API's own address, not mcp.oddbout.com, whose gateway takes
 * 64 KB bodies (`worker/cloud-gateway.mjs`).
 */
export const PICTURE_PAGE = 'https://oddbout.com/creator.html#view=upload&ticket=';
export const TICKET_UPLOAD_URL = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co/functions/v1/ai-fighter/generations/ticket-uploads';
/** The schemes an agent's file addresses use, named in the log; any other is `other`. */
const FILE_SCHEMES = new Set(['file:', 'sandbox:', 'attachment:', 'content:', 'cid:', 'file-service:', 'ftp:']);
/** Who made the picture, as the agent names it: one of these words, so the log keeps no free text. */
export const PICTURE_MAKERS = /** @type {const} */ (['grok', 'gemini', 'chatgpt', 'claude', 'other']);
/**
 * What an agent passed as a picture's address, without the address (Grok 그림 주소 관찰, 2026-11-01): which host its pictures come from
 * decides whether ODDBOUT can take them straight from the chat, and nobody has seen it yet (AGENTS.md: never invent origins). Only an http(s)
 * address names its host (its path, query and fragment stay out); a `blob:` one names the origin that made it; another scheme only itself
 * (`file-service://file-…` would put a file's id where a host goes), and only a scheme known for files: any word before a colon parses as
 * one (`password:…`, 2차 리뷰 2026-11-01). A value that is no URL shows only its shape, every letter of any script an a and every digit a 9
 * (리뷰 2026-11-01: Korean text went into the log as it was). `length` is the whole value's, which the agent gives for one too long to send
 * (a data: address).
 * @param {string} value @param {number} [fullLength]
 */
export function pictureLinkShape(value, fullLength = value.length) {
  const length = Math.max(fullLength, value.length);
  // A picture's media type only: any word/word parses as one (3차 리뷰 2026-11-01: `data:name-phone+password/x` logged as it was).
  if (/^data:/i.test(value)) {
    const type = /^data:([a-z]+\/[a-z0-9.+-]{1,24})[;,]/i.exec(value)?.[1]?.toLowerCase() ?? null;
    return { kind: 'data-url', mediaType: type === null ? null : type.startsWith('image/') ? type : 'other', length };
  }
  let url;
  try { url = new URL(value); }
  catch { return { kind: 'not-a-url', length, shape: value.slice(0, 40).replace(/\p{L}/gu, 'a').replace(/\p{N}/gu, '9') }; }
  if (url.protocol === 'blob:') return { kind: 'blob-url', origin: /^https?:\/\//.test(url.origin) ? url.origin : null, length };
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'other-scheme', scheme: FILE_SCHEMES.has(url.protocol) ? url.protocol : 'other', length };
  const last = url.pathname.split('/').at(-1) ?? '';
  return { kind: 'url', protocol: url.protocol, hostname: url.hostname, port: url.port, hasUserInfo: Boolean(url.username || url.password),
    hasQuery: Boolean(url.search), hasFragment: Boolean(url.hash), pathSegments: url.pathname.split('/').filter(Boolean).length,
    extension: /\.([a-z0-9]{2,5})$/i.exec(last)?.[1]?.toLowerCase() ?? null, length };
}

/**
 * `identity` is null only on a signed-out call, which register lets reach the public tools alone: the account tools cast it.
 * @param {{ register: Register, db: any, identity: Identity | null, invoke: Invoke, fetcher: typeof fetch, hosted: Hosted }} options
 */
export function registerHostedTools({ register, db, identity, invoke, fetcher, hosted }) {
  const JOB = UUID_ARG();
  /** @type {(path: string, body: object, headers?: Record<string, string>) => Promise<any>} */
  const post = (path, body, headers = {}) => invoke(path, 'POST', JSON.stringify(body), { 'content-type': 'application/json', ...headers });
  /** @param {string} key */
  const jobIdForKey = async key => {
    const { data, error } = await db.from('af_generation_jobs').select('id').eq('owner_id', /** @type {Identity} */ (identity).owner).eq('idempotency_key', key.toLowerCase()).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    return data?.id ?? null;
  };
  register('request_hosted_fighter', 'ODDBOUT에 선수 만들기 맡기기', 'ODDBOUT makes a fighter for the connected user on its own generation worker: '
    + 'two front-view looks to choose from (the chosen one is also his profile picture), then a side view drawn from it and the eleven '
    + 'motions, then registration under his account. delegate: '
    + 'true when he leaves the choices to ODDBOUT ("알아서 해 줘", "just make it"): '
    + 'ODDBOUT picks the look itself (or asks him if neither suits) and he answers once, at the finished motions. host: '
    + 'oddbout (default, ODDBOUT\'s own worker), mine (his own PC as a host: '
    + 'no consent to give, approval not needed), any (any approved community host) or a host id from list_generation_hosts; '
    + 'any or another person\'s host sends his words and pictures to that host\'s PC, so ask him first and pass hostConsent: '
    + 'true. Pass his words (what the fighter is and looks like) and, if he gave them, '
    + 'up to two of his own pictures with his confirmation that he has the rights to them: attached files (picture, secondPicture) where '
    + 'this host attaches files, else pictureUploads (usable ids from get_picture_upload, shown to him first). '
    + 'Each account holds tokens (500,000 at sign-up). What ODDBOUT\'s own worker makes for him (host oddbout, or any when ODDBOUT\'s worker '
    + 'takes it) takes off every token it spends, whatever the outcome; a request his own PC or another person\'s host makes takes none. '
    + 'Unless it is on his own PC, a request is refused (generation-quota) once his balance is at or below zero; get_hosted_fighter '
    + 'without a job shows his balance (tokens) and each job the tokens it took. '
    + 'On a full day the request waits in line. Requires the user\'s request. '
    + 'Save the verified account id and idempotencyKey before calling, and the returned job.id. '
    + 'If the response is lost, recover with get_hosted_fighter using that key; '
    + 'do not replay this creation call while its outcome is unknown. '
    + 'A confirmed safe retry keeps the original key and arguments. Returns the job; follow its next.',
    { description: z.string().min(GENERATION_LIMITS.descriptionMin).max(GENERATION_LIMITS.description), language: z.enum(['ko', 'en']),
      picture: FILE.optional(), secondPicture: FILE.optional(), pictureUploads: z.array(UUID_ARG()).max(GENERATION_LIMITS.refs).optional(),
      rightsConfirmed: z.boolean().optional(), delegate: z.boolean().optional(),
      host: z.union([z.enum(['oddbout', 'any', 'mine']), UUID_ARG()]).optional(), hostConsent: z.boolean().optional(), idempotencyKey: UUID_ARG() },
    async ({ description, language, picture, secondPicture, pictureUploads = [], rightsConfirmed, delegate, host, hostConsent, idempotencyKey }) => {
      // Once saved, the same key returns its job without re-uploading pictures. Before that, use read-only recovery.
      const existingId = await jobIdForKey(idempotencyKey);
      if (existingId) return withNext(await invoke(`generations/${existingId}`));
      // Off (the service switch, the worker away or unwell) before any picture is kept. A failed read is the database's, not the switch's.
      const service = await invoke('generations/capabilities');
      if (!service.ok) return service;
      if (!service.capabilities?.hosted) return { ok: false, code: 'generation-unavailable', reason: service.capabilities?.reason ?? null };
      const pictures = /** @type {HostFile[]} */ ([picture, secondPicture].filter(Boolean));
      // Pictures already in (a ticket's) count with the attached ones: two in all, refused before an attached one moves.
      if (pictures.length + pictureUploads.length > GENERATION_LIMITS.refs) return { ok: false, code: 'invalid-refs' };
      if ((pictures.length || pictureUploads.length) && rightsConfirmed !== true) return { ok: false, code: 'rights-required' };
      const ask = { description, language, ...(delegate ? { delegate: true } : {}), ...(host && host !== 'oddbout' ? { host, hostConsent: hostConsent === true } : {}) };
      // The request's own checks (consent, one at a time, the day's limits, the host) before a picture moves: each kept picture spends one
      // of the day's uploads and stays in storage (MCP 점검 2026-10-29). A request without pictures is checked where it is made.
      // The pictures already in are checked there too (his, unused, from the last day): a refusal keeps no attached picture.
      if (pictures.length) {
        const checked = await post('generations/check', { ...ask, ...(pictureUploads.length ? { refs: pictureUploads } : {}) });
        if (!checked.ok) return checked;
      }
      const refs = [...pictureUploads];
      for (const file of pictures) {
        const uploaded = await invoke('generations/uploads', 'POST', await downloadHostFile(file, GENERATION_LIMITS.refBytes, fetcher, LIBRARY_FILE_HOSTS),
          { 'content-type': 'application/octet-stream' });
        if (!uploaded.ok) return uploaded;
        refs.push(uploaded.upload.id);
      }
      return withNext(await post('generations', { ...ask, ...(refs.length ? { refs, rightsConfirmed: true } : {}) }, { 'idempotency-key': idempotencyKey }));
    }, { write: true, openWorld: true, idempotent: false, files: ['picture', 'secondPicture'] });
  // 그림 올리기 표: ChatGPT attaches files to the request; the other agents send the pictures through a ticket (`api/generations.mjs`).
  register('start_picture_upload', '그림 올리기', 'For up to two of the user\'s own pictures (one he drew, or one an image model made for him '
    + 'in this chat) where this host does not attach files to request_hosted_fighter (only ChatGPT does). First the request\'s own checks: '
    + 'pass the host and hostConsent you will pass to request_hosted_fighter; a refusal (generation-unavailable, generation-quota, '
    + 'host-consent-required…) gives no ticket. Then a ticket for 30 minutes and page, a link the user opens to add the pictures on '
    + 'oddbout.com signed in with this same account: give it to him as a link. '
    + 'terminal: true only when you run commands on the computer that holds the picture file: then also command, which you run once per '
    + 'file with <file> replaced by its path (curl.exe on Windows); it carries a secret, so do not put it in your reply or ask him to paste it. '
    + 'A command that got no answer or a 5xx may still have put the picture in: get_picture_upload before running it again. An account gets '
    + 'twelve pictures and twelve tickets a day: get_picture_upload with no ticketId lists the open ones to reuse. Then get_picture_upload.',
    { terminal: z.boolean().optional(), host: z.union([z.enum(['oddbout', 'any', 'mine']), UUID_ARG()]).optional(), hostConsent: z.boolean().optional() },
    async ({ terminal, host, hostConsent }) => {
      // Off (the service switch, the worker away or unwell): no ticket, as request_hosted_fighter keeps no picture then.
      const service = await invoke('generations/capabilities');
      if (!service.ok) return service;
      if (!service.capabilities?.hosted) return { ok: false, code: 'generation-unavailable', reason: service.capabilities?.reason ?? null };
      const made = await invoke('generations/upload-tickets', 'POST', JSON.stringify({ terminal: terminal === true,
        ...(host && host !== 'oddbout' ? { host, hostConsent: hostConsent === true } : {}) }), { 'content-type': 'application/json' });
      if (!made.ok) {
        return made.code === 'rate-limit' ? { ...made, next: 'The account\'s twelve tickets or twelve pictures of the last 24 hours may be used, '
          + 'or too many calls came this minute: get_picture_upload with no ticketId lists the tickets to reuse; else wait.' } : made;
      }
      const { secret, ...ticket } = made.ticket;
      return { ok: true, ticket, page: `${PICTURE_PAGE}${ticket.id}`,
        ...(secret ? { command: `curl -sS -H "${UPLOAD_TICKET_HEADER}: ${secret}" --data-binary "@<file>" ${TICKET_UPLOAD_URL}` } : {}),
        next: `Give the user the page link (PNG, JPEG or WebP, up to 4 MB, 64 to 4096 pixels a side)${secret ? ', or run the command with the file '
          + '(one with no answer or a 5xx: get_picture_upload before running it again)' : ''}. When he says the pictures are in, get_picture_upload with ticket.id.` };
    }, { write: true, idempotent: false });
  register('get_picture_upload', '올린 그림 확인', 'The pictures a start_picture_upload ticket took (at most two), each with its address for ten '
    + 'minutes, and why it takes no more (closed: full, expired, day-limit). Show the user the pictures and ask that they are his to use; '
    + 'then pass the ids with usable true as request_hosted_fighter pictureUploads with rightsConfirmed. With no ticketId: his tickets of the '
    + 'last day, newest first, without the addresses (to find one again before starting another).',
    { ticketId: UUID_ARG().optional() }, async ({ ticketId }) => {
      if (!ticketId) {
        const listed = await invoke('generations/upload-tickets');
        return listed.ok ? { ...listed, next: 'Reuse an open one, or read one by its ticketId to show its pictures.' } : listed;
      }
      const read = await invoke(`generations/upload-tickets/${ticketId}`);
      if (!read.ok) return read;
      const usable = read.ticket.uploads.filter((/** @type {{ usable: boolean }} */ upload) => upload.usable).length;
      return { ...read, next: usable ? 'Show him the pictures (url, ten minutes) and ask that they are his to use; then request_hosted_fighter '
        + 'with the usable ids as pictureUploads and rightsConfirmed.'
        : read.ticket.open ? 'Nothing in yet: give him the page link again, or wait until he says the pictures are in.'
          : 'This ticket takes no more and holds no usable picture: start_picture_upload for a new one.' };
    });
  // Grok 그림 주소 관찰: one call when the user tests it; the server log keeps the shape (pictureLinkShape), nothing is fetched or kept.
  register('report_picture_link', '그림 주소 확인', 'Diagnostic, only when the user asks to test it: pass the address you hold for a '
    + 'picture made or shown in this chat, exactly as you have it, and which tool or model made it. One longer than 8,000 characters (a data: '
    + 'address): pass its first 200 characters and its whole length as fullLength. ODDBOUT notes the maker you name and the address\'s shape, '
    + 'never the address: its kind and length; for http and https its host, port, extension, path depth and whether it has a query, fragment '
    + 'or user info; for a file scheme its name; for text that is no address, its letters as a and digits as 9. It does not fetch the picture, '
    + 'keep it or use it for a fighter. Never invent or rewrite an address; if you hold none, say so.',
    { url: z.string().min(1).max(8192), fullLength: z.number().int().min(1).max(1e9).optional(), madeBy: z.enum(PICTURE_MAKERS).optional() },
    async ({ url, fullLength, madeBy }) => {
      const observed = pictureLinkShape(url, fullLength);
      console.log(JSON.stringify({ event: 'picture-link-probe', client: /** @type {Identity} */ (identity).claims.client_id,
        madeBy: madeBy ?? null, ...observed }));
      return { ok: true, observed, fetched: false, kept: false,
        next: 'Tell the user what was noted. Pictures from this chat go in through start_picture_upload until ODDBOUT takes this host.' };
    }, { diagnostic: true });
  register('list_generation_hosts', '선수 만드는 호스트', 'List who can make a fighter: ODDBOUT itself and the community hosts the operator approved (creators who run the '
    + 'generation worker on their own PC and subscription). For each: '
    + 'id, name, whether it is on now, whether it takes requests that name no host, and how many it can still take today. '
    + 'Pass an id as request_hosted_fighter\'s host.',
    {}, () => invoke('generations/hosts'), { publicTool: true });
  register('get_hosted_fighter', 'ODDBOUT이 만드는 선수', `Read or resume the connected user's hosted fighter after a timeout or disconnection: its state, `
    + `the two front-view looks, the side view drawn from the chosen one (side) or the motion previews as fresh image URLs (ten minutes), `
    + `the profile draft, the profile set made at registration (profileSetId) and next. `
    + `Supply either jobId or the original request's idempotencyKey, never both. `
    + `Key lookup only reads an existing job under this account, even when new generation is disabled; `
    + `not-found does not prove that an interrupted request never started. With neither identifier: `
    + `his latest five requests and whether hosted generation is open. Read the same job again if a preview URL expired; `
    + `do not regenerate. waitSeconds (up to ${HOSTED_WAIT_SECONDS}) is a bounded wait, not a completion guarantee; `
    + `if still working, check this job again later.`,
    { jobId: JOB.optional(), idempotencyKey: UUID_ARG().optional(), waitSeconds: z.number().int().min(0).max(HOSTED_WAIT_SECONDS).optional() }, async ({ jobId, idempotencyKey, waitSeconds = 0 }) => {
      if (jobId && idempotencyKey) return { ok: false, code: 'invalid-selector' };
      if (idempotencyKey) {
        jobId = await jobIdForKey(idempotencyKey);
        if (!jobId) return { ok: false, code: 'not-found', next: 'No saved job was found for this key in the connected account. The original request may still be running. '
          + 'Check the account and original call; do not submit again to recover it.' };
      }
      if (!jobId) {
        const list = await invoke('generations');
        return list.ok ? { ...list, jobs: list.jobs.map(/** @param {HostedJob} job */ job => ({ ...job, next: hostedNext(job) })) } : list;
      }
      // Wait on the state alone (no signed URLs per look), then read the job once.
      const deadline = Date.now() + waitSeconds * 1000, pollMs = hosted.pollMs ?? HOSTED_POLL_MS;
      while (Date.now() + pollMs <= deadline) {
        const { data: row, error } = await db.from('af_generation_jobs').select('status,submission_id').eq('id', jobId).eq('owner_id', /** @type {Identity} */ (identity).owner).maybeSingle();
        if (error || !row) break;
        let stage = null;
        if (row.status === 'submitted' && row.submission_id) {
          const { data } = await db.from('af_submissions').select('status').eq('id', row.submission_id).maybeSingle();
          stage = data?.status ?? null;
        }
        if (hostedSettled(row.status, stage)) break;
        await new Promise(done => setTimeout(done, pollMs));
      }
      return withNext(await invoke(`generations/${jobId}`));
    });
  register('choose_hosted_look', '외형 고르기', 'Answer the two front-view looks of the connected user\'s hosted fighter with his words: '
    + 'choose a or b (it is also his profile picture; ODDBOUT then draws it from the side and makes the motions from that), '
    + 'or revise with one sentence (both looks are painted again). '
    + 'Requires the user\'s answer. Revisions are not idempotent: '
    + 'after an unknown outcome, read get_hosted_fighter instead of repeating this call.',
    { jobId: JOB, choose: z.enum(['a', 'b']).optional(), revise: z.string().min(2).max(GENERATION_LIMITS.note).optional() },
    ({ jobId, choose, revise }) => (choose === undefined) === (revise === undefined) ? { ok: false, code: 'invalid-answer' }
      : post(`generations/${jobId}/appearance`, choose !== undefined ? { choose } : { revise }).then(withNext), { write: true, idempotent: false });
  register('revise_hosted_motion', '동작 하나 고치기', 'Ask ODDBOUT to make one motion of the connected user\'s hosted fighter again with his sentence; the other motions stay. '
    + 'Not idle: the standing pose is the look itself. Requires the user\'s request. Not idempotent: '
    + 'after an unknown outcome, read get_hosted_fighter instead of repeating this call.',
    // Not idle: it is the look itself (choose_hosted_look changes the look, before the motions).
    { jobId: JOB, clip: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(spec.motions).filter(clip => clip !== 'idle'))), note: z.string().min(2).max(GENERATION_LIMITS.note) },
    ({ jobId, clip, note }) => post(`generations/${jobId}/motions`, { revise: { clip, note } }).then(withNext), { write: true, idempotent: false });
  register('register_hosted_fighter', '맡긴 선수 등록', 'Register the connected user\'s hosted fighter once he approved its motions: '
    + 'ODDBOUT packages it and submits it under his account, through the same server check as any fighter. '
    + 'profile holds only what he changed in the draft (name, description, names, bout lines, stats summing to 9). '
    + 'Requires the user\'s registration request.',
    { jobId: JOB, profile: z.object({ name: z.string().min(1).max(profileLimits.name), description: z.string().min(1).max(profileLimits.description),
      names: z.record(z.string(), z.string()), lines: z.record(z.string(), z.string()),
      stats: z.object({ power: z.number().int(), toughness: z.number().int(), speed: z.number().int() }).strict() }).partial().strict().optional() },
    async ({ jobId, profile = {} }) => {
      const read = await invoke(`generations/${jobId}`);
      if (!read.ok) return read;
      // The draft the worker wrote, with his changes over it; the API checks the result against the contract.
      const draft = read.job.profile ?? {}, merged = { ...draft, ...profile };
      for (const key of /** @type {const} */ (['names', 'lines'])) if (profile[key] && draft[key]) merged[key] = { ...draft[key], ...profile[key] };
      const confirmed = Object.fromEntries(PROFILE_KEYS.filter(key => merged[key] != null).map(key => [key, merged[key]]));
      return withNext(await post(`generations/${jobId}/register`, { profile: confirmed }));
    }, { write: true, publish: true, openWorld: true, idempotent: true });
  register('cancel_hosted_fighter', '맡긴 선수 취소', 'Cancel the connected user\'s hosted fighter request; '
    + 'work in progress stops at its next step. Tokens it already spent stay spent. Only on his explicit request.',
    { jobId: JOB }, async ({ jobId }) => withNext(await invoke(`generations/${jobId}`, 'DELETE')), { write: true, publish: true, idempotent: true });
}
