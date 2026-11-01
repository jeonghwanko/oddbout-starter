// @ts-check
// 호스팅 생성 (2026-10-27): a creator asks our generation worker to make his fighter. The creator's routes (`generations/…`, his own token)
// and the worker's (`generation-worker/…`, a worker key of scope `generation`). The state machine, quotas and leases are the database's
// (`supabase/migrations/20261028100000_oddbout_hosted_generation.sql`); pictures stay in the private bucket `af-generation` and reach a reader
// only as signed URLs of ten minutes. The package the worker makes goes through the same submission checks as any other
// (`submissions.mjs`) under the creator's account — the job row names the owner, never the worker.
import spec from '../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { profileLimits } from '../contracts/ai-fighter/profile-limits.mjs';
import { text } from './canon.mjs';
import { probeImage } from './image-probe.mjs';
import { Problem, UUID, jsonResponse, readBody, rpcCaller, sha256 } from './http.mjs';
import { SUBMISSION_STATUS, checkedManifest, storeAsset } from './submissions.mjs';
import { DECISIONS, reviewEvidence } from './decisions-review.mjs';
import { benchmarkReview } from './decisions-benchmark.mjs';
import { BENCHMARK_BODY_BYTES } from './sequence-benchmark.mjs';
import { PROFILE_SET_LIMITS, PROFILE_SET_VERSION, parseProfileSet, profileSetKey, storeOnce } from './profile-sets.mjs';
import { BUCKET } from './submissions.mjs';
import { accountTokens } from './account.mjs';
/**
 * A row of af_generation_jobs, as `select('*')` or a generation function returns it. Its jsonb columns are as the worker and the creator
 * wrote them: `candidates` and `preview` are checked where they are read, the others passed on.
 * @typedef {{ id: string, owner_id: string, status: string, description: string, language: string, brief: any, candidates: unknown,
 *   choice: string | null, appearance_note: string | null, appearance_revisions: number, motion_note: any, motion_revisions: number,
 *   preview: unknown, profile: any, submission_id: string | null, progress: number, error_code: string | null, lease_token: string | null,
 *   lease_expires_at: string | null, created_at: string, updated_at: string, delegate: boolean, host_choice: string,
 *   requested_host: string | null, assigned_host: string | null, started_at?: string | null, charged_at?: string | null,
 *   refunded_at?: string | null, profile_front?: any, profile_set_id?: string | null }} Job
 * @typedef {{ id: string, path: string, content_type: string, width: number, height: number }} Upload  A job's reference picture (af_generation_uploads).
 */

export const GENERATION_BUCKET = 'af-generation';
// One line from four characters ("고양이 복서", 첫 선수 무료 2026-10-30): the site asks one line; the job's check says the same.
export const GENERATION_LIMITS = Object.freeze({ descriptionMin: 4, description: 600, refs: 2, refBytes: 4_000_000, refSide: Object.freeze([64, 4096]),
  note: 200, artifactBytes: 8_000_000, result: 12_000, signedSeconds: 600 });
const ARTIFACT = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MOTIONS = Object.keys(spec.motions);
/** What the worker may say about one preview clip: `run-from-walk`, a run the gate refused made from the walk (2026-10-29). */
export const PREVIEW_NOTES = Object.freeze(['run-from-walk']);
/** What the worker may say about one draft (2026-11-01): a walk or run take shown as it is cut, `checking` while the gate looks at it,
 * `retaking` when the gate refused it and the next take films. A draft with no state passed (or is an action clip). */
export const DRAFT_STATES = Object.freeze(['checking', 'retaking']);
const DRAFT_EVENTS_READ = 5;
const CORS = { methods: 'GET, POST, PATCH, DELETE, OPTIONS', headers: 'Authorization, Content-Type, Idempotency-Key' };
// A join code (내 PC 붙이기): made by the site for a signed-in host, copied into his PC's terminal once; 160 bits, so nobody guesses one.
export const JOIN_CODE = /^ohj_[a-f0-9]{40}$/;
/**
 * 그림 올리기 표 (2026-11-01): an agent with no file attachment of ChatGPT's asks for one; a terminal sends a picture with its secret in this
 * header (`generations/ticket-uploads`), the signed-in owner on the site with its id (`generations/uploads?ticket=`). 256 bits, shown once.
 */
export const UPLOAD_TICKET = /^afu_[a-f0-9]{64}$/;
export const UPLOAD_TICKET_HEADER = 'x-oddbout-upload-ticket';
/** @type {(bytes: Uint8Array) => string} */
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const workerToken = () => `afw_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
/** @type {Record<string, number>} */
const STATUS = { 'generation-unavailable': 409, 'generation-quota': 409, 'generation-capacity': 409, 'generation-state': 409, 'revision-limit': 409,
  'fighter-quota': 409, 'lease-lost': 409, 'rate-limit': 429, 'invalid-refs': 422, 'rights-required': 422, 'invalid-answer': 422,
  'invalid-result': 422, 'not-found': 404, 'account-disabled': 403, 'invite-required': 403,
  // 커뮤니티 호스트 (2026-10-28).
  'invalid-host': 422, 'host-consent-required': 422, 'host-offline': 409, 'host-capacity': 409, 'host-terms-required': 422,
  'host-not-approved': 403, 'host-key-limit': 409, 'host-not-found': 404, 'join-code-invalid': 410, 'invalid-join-code': 400, 'host-busy': 409,
  'upload-closed': 409,
  // 그림 올리기 표 (2026-11-01).
  'invalid-ticket': 403, 'ticket-expired': 410, 'ticket-full': 409,
  // The submission path's own refusals (`af_create_submission`, `af_submit`), with the statuses the creator's routes give them.
  ...SUBMISSION_STATUS };
/** Stats the contract takes: 1-5 each, summing to 9 (`contracts/ai-fighter/validate.mjs`). */
export const STAT_TOTAL = 9;

/** @type {(parts: string[]) => boolean} Is this path the hosted generation's? */
export const generationRoute = parts => parts[0] === 'generations' || parts[0] === 'generation-worker';

/** @type {(value: any) => string} An id from the path, a header or a body, checked here. */
const id = value => { if (!UUID.test(value ?? '')) throw new Problem(400, 'invalid-id'); return value.toLowerCase(); };
/** @type {(value: unknown) => boolean} */
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/**
 * A worker's subscription reading as the database takes it (2026-10-31): a percent 0–100, an optional window in minutes, an optional reset time.
 * @param {unknown} value
 */
const usageReading = value => {
  if (!isObject(value) || JSON.stringify(value).length > 300) return false;
  const reading = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(reading).every(key => ['usedPercent', 'windowMinutes', 'resetsAt'].includes(key))
    && typeof reading.usedPercent === 'number' && Number.isFinite(reading.usedPercent) && reading.usedPercent >= 0 && reading.usedPercent <= 100
    && (reading.windowMinutes === undefined || (Number.isInteger(reading.windowMinutes) && Number(reading.windowMinutes) >= 1 && Number(reading.windowMinutes) <= 100000))
    && (reading.resetsAt === undefined || (typeof reading.resetsAt === 'string' && Number.isFinite(Date.parse(reading.resetsAt))));
};
/**
 * A stage's codex tokens as the worker reports them (2026-10-31): { total, input, cachedInput, output, reasoning }, whole numbers.
 * @param {unknown} value
 */
const stageTokens = value => {
  if (!isObject(value)) return false;
  const tokens = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(tokens).every(key => ['total', 'input', 'cachedInput', 'output', 'reasoning'].includes(key))
    && Object.values(tokens).every(n => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 1e11) && Number(tokens.total) > 0;
};
/** @type {(body: any, allowed: string[]) => Record<string, any>} A JSON object with only the allowed keys, checked here. */
const fields = (body, allowed) => {
  if (!isObject(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new Problem(422, 'invalid-body');
  return body;
};
/** @param {Request} request @param {number} limit */
async function readJson(request, limit) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, limit))); }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-body'); }
}
/** @type {(job: string, name: string) => string} */
export const artifactPath = (job, name) => `jobs/${job}/${name}.webp`;

/**
 * 선수 프로필 세트 (2026-10-31): a hosted fighter's set, made the moment the validator registers his package. The job kept his chosen front
 * and its face square (`profile-front`); they become a set under his owner (idempotency key: the job's id), its front copied from the job's
 * artifact into the submissions bucket, submitted to the validator. Null when the submission is no hosted job's or carries no front; a
 * failure never touches the registration (handler.mjs ignores it — the owner can upload a set himself).
 * @param {any} db @param {{ id: string, status: string, fighter_id?: string | null }} submission
 * @returns {Promise<string | null>} the set's id
 */
export async function attachJobProfileSet(db, submission) {
  if (submission?.status !== 'registered' || !submission.fighter_id) return null;
  const { data: job, error } = await db.from('af_generation_jobs').select('id,owner_id,profile_front,profile_set_id').eq('submission_id', submission.id).maybeSingle();
  if (error) throw new Problem(503, 'database-unavailable');
  if (!job?.profile_front || job.profile_set_id) return job?.profile_set_id ?? null;
  const { artifact, face, ...front } = job.profile_front;
  const text = JSON.stringify({ version: PROFILE_SET_VERSION, front, face });
  const parsed = parseProfileSet(text);
  if (!parsed.ok || typeof artifact !== 'string') return null;
  const { data: download, error: downloadError } = await db.storage.from(GENERATION_BUCKET).download(artifactPath(job.id, artifact));
  if (downloadError || !download) throw new Problem(503, 'storage-unavailable');
  const bytes = new Uint8Array(await download.arrayBuffer());
  if (bytes.length !== front.bytes || await sha256(bytes) !== front.sha256) return null;
  /** @type {(name: string, args: Record<string, unknown>) => Promise<any>} */
  const rpc = async (name, args) => { const { data, error: rpcError } = await db.rpc(name, args); if (rpcError) throw new Problem(409, rpcError.message); return data; };
  const set = await rpc('af_profile_set_create', { p_owner: job.owner_id, p_fighter: submission.fighter_id, p_key: job.id, p_text: text,
    p_sha: await sha256(new TextEncoder().encode(text)), p_bytes: front.bytes });
  await storeOnce(db, BUCKET, profileSetKey(job.owner_id, set.id, 'front'), bytes, front.sha256);
  await rpc('af_profile_set_submit', { p_owner: job.owner_id, p_id: set.id });
  const { error: linkError } = await db.from('af_generation_jobs').update({ profile_set_id: set.id }).eq('id', job.id);
  if (linkError) throw new Problem(503, 'database-unavailable');
  return set.id;
}

/**
 * The profile the creator confirms before registering: name and description (required), his fighter's names, bout lines and stats — each
 * within the v1 contract's limits. Null fields are left out; the worker fills the rest from the brief.
 * @param {any} value  Unchecked: this checks it.
 */
export function confirmedProfile(value) {
  const body = fields(value, ['name', 'description', 'names', 'lines', 'stats']);
  /** @type {{ name: string, description: string, names?: Record<string, string>, lines?: Record<string, string>, stats?: { power: number, toughness: number, speed: number } }} */
  const out = { name: text(body.name, profileLimits.name, '/profile/name', { code: 'invalid-profile' }),
    description: text(body.description, profileLimits.description, '/profile/description', { lines: true, code: 'invalid-profile' }) };
  for (const [key, allowed, max] of /** @type {['names' | 'lines', string[], number][]} */ ([['names', profileLimits.languages, profileLimits.displayName], ['lines', profileLimits.lineKeys, profileLimits.line]])) {
    if (body[key] === undefined || body[key] === null) continue;
    const part = fields(body[key], allowed), kept = /** @type {Record<string, string>} */ ({});
    for (const name of allowed) if (part[name] !== undefined && part[name] !== null && part[name] !== '')
      kept[name] = text(part[name], max, `/profile/${key}/${name}`, { code: 'invalid-profile' });
    if (Object.keys(kept).length) out[key] = kept;
  }
  if (body.stats !== undefined && body.stats !== null) {
    const stats = fields(body.stats, ['power', 'toughness', 'speed']);
    if (['power', 'toughness', 'speed'].some(key => !Number.isInteger(stats[key]) || stats[key] < 1 || stats[key] > 5)
      || stats.power + stats.toughness + stats.speed !== STAT_TOTAL) throw new Problem(422, 'invalid-profile');
    out.stats = { power: stats.power, toughness: stats.toughness, speed: stats.speed };
  }
  return out;
}

/**
 * @param {{ db: any, authenticate: { (request: Request, worker: false): Promise<string>, (request: Request, worker: 'generation'): Promise<string | null> },
 *   present: (row: any) => Promise<object>, decisionsReviewer?: import('./http.mjs').Reviewer | null, responsesReviewer?: import('./http.mjs').Reviewer | null,
 *   cascadeReviewer?: import('./http.mjs').Reviewer | null }} options
 *   `authenticate` resolves to the signed-in creator's id, or for a generation worker key to its host's id (null: the official host); it
 *   throws a Problem for any other caller. `present` shows a submission row (as the database returns it) the way its creator reads it.
 * @returns {import('./http.mjs').Route}
 */
export function createGenerationHandler({ db, authenticate, present, decisionsReviewer = null, responsesReviewer = null, cascadeReviewer = null }) {
  const productionReviewer = cascadeReviewer ?? decisionsReviewer;
  const call = rpcCaller(db, STATUS, { contains: true });
  const bucket = () => db.storage.from(GENERATION_BUCKET);
  /** @param {string[]} paths @returns {Promise<Map<string, string>>} */
  async function signed(paths) {
    if (!paths.length) return new Map();
    const { data, error } = await bucket().createSignedUrls(paths, GENERATION_LIMITS.signedSeconds);
    if (error || !Array.isArray(data)) throw new Problem(503, 'storage-unavailable');
    return new Map(data.filter(item => !item.error && typeof item.signedUrl === 'string').map(item => [item.path, item.signedUrl]));
  }
  /** @type {(row: Job) => string[]} */
  const candidatesOf = row => Array.isArray(row.candidates) ? row.candidates.filter(name => ARTIFACT.test(name ?? '')) : [];
  /** @type {(row: Job) => Record<string, any>[]} The worker's preview clips whose clip and name check out. */
  const previewOf = row => Array.isArray(row.preview) ? row.preview.filter(p => isObject(p) && MOTIONS.includes(p.clip) && ARTIFACT.test(p.name ?? '')) : [];
  /** The hosts a job names, by id: their names (and whether official) for its creator. @param {(string | null)[]} ids */
  async function hostsOf(ids) {
    const wanted = [...new Set(ids.filter(Boolean))];
    if (!wanted.length) return new Map();
    const { data, error } = await db.from('af_generation_hosts').select('id,name,official').in('id', wanted);
    if (error) throw new Problem(503, 'database-unavailable');
    return new Map((data ?? []).map(/** @param {{ id: string, name: string, official: boolean }} h */ h => [h.id, { id: h.id, name: h.name, official: h.official === true }]));
  }
  // A job as its creator reads it: no lease, no prompt, no brief beyond its profile draft; pictures as signed URLs.
  // While the motions are made: the previews the worker put up as its branches passed, and each gait's take before its gate (its latest
  // `drafts` event, this round's).
  /** @param {Job} row */
  async function draftsOf(row) {
    if (row.status !== 'motions') return [];
    const { data: rows, error } = await db.from('af_generation_events').select('data').eq('job_id', row.id).eq('kind', 'drafts')
      .order('at', { ascending: false }).limit(DRAFT_EVENTS_READ);
    if (error) throw new Problem(503, 'database-unavailable');
    // Of the latest few, the list the worker sent last (its `seq`, 2026-11-01): a send it timed out on may land after a later one.
    // Lists without a `seq` (a worker before it) go by their time.
    const seqOf = (/** @type {any} */ r) => Number.isSafeInteger(r?.data?.seq) ? r.data.seq : -1;
    const latest = /** @type {any[]} */ (rows ?? []);
    const data = latest.reduce((best, r) => seqOf(r) > seqOf(best) ? r : best, latest[0] ?? null);
    const round = `-${row.motion_revisions}`;
    return /** @type {any[]} */ (Array.isArray(data?.data?.clips) ? data.data.clips : []).filter(d => isObject(d) && MOTIONS.includes(d.clip)
      && ARTIFACT.test(d.name ?? '') && d.name.startsWith('draft-') && d.name.endsWith(round)).slice(0, MOTIONS.length);
  }
  /**
   * The side still drawn from the chosen front (2026-10-31, the worker's latest `side` event naming it): its artifact, or null. Only the one
   * of the current look round and choice: a new look makes a new one.
   * @param {Job} row
   */
  async function sideOf(row) {
    if (!row.choice || !['motions', 'motion_ready', 'submitting', 'submitted', 'needs_review'].includes(row.status)) return null;
    const { data, error } = await db.from('af_generation_events').select('data').eq('job_id', row.id).eq('kind', 'side')
      .order('at', { ascending: false }).limit(5);
    if (error) throw new Problem(503, 'database-unavailable');
    const name = `side-${row.appearance_revisions}-${row.choice}`;
    return (data ?? []).some(/** @param {{ data: any }} event */ event => event.data?.outcome === 'chosen' && event.data?.artifact === name) ? name : null;
  }
  /**
   * What these jobs took from their creator's tokens so far (보유 토큰, 2026-10-31: af_generation_charged), by id, in one query; null when
   * it cannot be read (a database before the tokens, an error): the jobs still read, their tokens null.
   * @param {string[]} ids @returns {Promise<Map<string, number> | null>}
   */
  async function jobTokens(ids) {
    try {
      const sums = await call('af_generation_job_tokens', { p_jobs: ids });
      if (!isObject(sums)) return null;
      return new Map(ids.map(job => { const n = Number(sums[job] ?? 0); return [job, Number.isSafeInteger(n) && n >= 0 ? n : 0]; }));
    } catch { return null; }
  }
  /** @param {Job} row @param {Map<string, number> | null} [taken]  Read for a list at once (jobTokens); read here when not given. */
  async function view(row, taken) {
    const candidates = candidatesOf(row), preview = previewOf(row), drafts = await draftsOf(row), side = await sideOf(row);
    const hosts = await hostsOf([row.requested_host, row.assigned_host]);
    const urls = await signed([...candidates.map(name => artifactPath(row.id, name)), ...preview.map(p => artifactPath(row.id, p.name)),
      ...drafts.map(d => artifactPath(row.id, d.name)), ...(side ? [artifactPath(row.id, side)] : [])]);
    let submission = /** @type {{ id: any, stage: any, fighterId: any } | null} */ (null);
    if (row.submission_id) {
      const { data, error } = await db.from('af_submissions').select('id,status,fighter_id').eq('id', row.submission_id).maybeSingle();
      if (error) throw new Problem(503, 'database-unavailable');
      if (data) submission = { id: data.id, stage: data.status, fighterId: data.fighter_id ?? null };
    }
    // 첫 선수 무료 (2026-10-30): a request to ODDBOUT on a full day waits for its looks; where it stands, for the page's line.
    const queue = row.host_choice === 'oddbout' && !row.started_at && ['queued', 'appearance'].includes(row.status)
      ? await call('af_generation_queue', { p_id: row.id }) : null;
    const tokens = taken === undefined ? await jobTokens([row.id]) : taken;
    return { id: row.id, status: row.status, progress: row.progress, error: row.error_code ?? null, description: row.description, language: row.language,
      delegate: row.delegate === true, createdAt: row.created_at, updatedAt: row.updated_at, profile: row.profile ?? (isObject(row.brief?.profile) ? row.brief.profile : null),
      candidates: candidates.map((name, i) => ({ key: i === 0 ? 'a' : 'b', url: urls.get(artifactPath(row.id, name)) ?? null })), choice: row.choice ?? null,
      revisionsLeft: { appearance: 2 - row.appearance_revisions, motions: 3 - row.motion_revisions },
      // The free fighter's mark (첫 선수 무료 2026-10-30), kept for a page from before: tokens decide a request now (보유 토큰 2026-10-31).
      charged: Boolean(row.charged_at) && !row.refunded_at && !['needs_review', 'failed', 'rejected'].includes(row.status)
        && submission?.stage !== 'rejected',
      queue: isObject(queue) ? queue : null,
      preview: preview.map(p => ({ clip: p.clip, url: urls.get(artifactPath(row.id, p.name)) ?? null, ...(PREVIEW_NOTES.includes(p.note) ? { note: p.note } : {}) })),
      submission,
      drafts: drafts.map(d => ({ clip: d.clip, url: urls.get(artifactPath(row.id, d.name)) ?? null, ...(DRAFT_STATES.includes(d.state) ? { state: d.state } : {}) })),
      // 선수 프로필 세트 (2026-10-31): the candidates are fronts; the side still the motions are made from, and the set made at registration.
      side: side ? { url: urls.get(artifactPath(row.id, side)) ?? null } : null,
      profileSetId: row.profile_set_id ?? null,
      // What it took from his tokens so far (null: not readable now).
      tokens: tokens ? tokens.get(row.id) ?? 0 : null,
      host: { choice: row.host_choice ?? 'oddbout', requested: hosts.get(row.requested_host) ?? null, assigned: hosts.get(row.assigned_host) ?? null } };
  }
  /** @param {string} owner @param {string} jobId @returns {Promise<Job>} */
  async function ownJob(owner, jobId) {
    const { data, error } = await db.from('af_generation_jobs').select('*').eq('id', id(jobId)).eq('owner_id', owner).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data) throw new Problem(404, 'not-found');
    return data;
  }
  // The job the worker holds for its submission routes: his lease, and the job registering.
  /** @param {Request} request @param {string} jobId @returns {Promise<Job>} */
  async function heldForSubmission(request, jobId) {
    const row = await call('af_generation_held', { p_id: id(jobId), p_token: id(request.headers.get('x-generation-lease')) });
    if (row.status !== 'submitting') throw new Problem(409, 'generation-state');
    return row;
  }
  /** @param {Job} row */
  async function jobSubmission(row) {
    const { data, error } = await db.from('af_submissions').select('*').eq('owner_id', row.owner_id).eq('idempotency_key', row.id).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data) throw new Problem(404, 'not-found');
    return data;
  }

  /**
   * A creator's own host (커뮤니티 호스트): his settings, whether he is on now, today's jobs and live keys, and his subscriptions as his worker
   * last checked them (`health` — the site's My agents shows them on his Codex and Grok cards). A removed host is none.
   * @param {string} owner
   */
  async function ownHost(owner) {
    const { data, error } = await db.from('af_generation_hosts').select('*').eq('owner_id', owner).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!data || data.removed_at) return null;
    const { data: keys, error: keyError } = await db.from('af_workers').select('expires_at,enabled').eq('host_id', data.id);
    if (keyError) throw new Problem(503, 'database-unavailable');
    // On now, approved or not (not approved, he makes his own requests: 내 선수는 내 PC로).
    const live = data.enabled && Date.parse(data.worker_seen_at ?? '') > Date.now() - 180_000 && data.worker_health?.ok === true;
    const today = await call('af_generation_host_today', { p_host: data.id });
    return { id: data.id, name: data.name, approved: data.approved, enabled: data.enabled, acceptsAny: data.accepts_any, billing: data.billing,
      dailyLimit: data.daily_limit, online: live, todayLeft: Math.max(data.daily_limit - (Number(today) || 0), 0), lastSeenAt: data.worker_seen_at ?? null,
      health: { codex: data.worker_health?.codex === true, grok: data.worker_health?.grok === true,
        checkedAt: typeof data.worker_health?.at === 'string' ? data.worker_health.at : null },
      keys: /** @type {{ expires_at: string, enabled: boolean }[]} */ (keys ?? []).filter(k => k.enabled && Date.parse(k.expires_at) > Date.now()).map(k => ({ expiresAt: k.expires_at })) };
  }
  /** @type {(row: { id: string, name: string, approved: boolean, enabled: boolean, accepts_any: boolean, billing: string, daily_limit: number }) => object} */
  const hostView = row => ({ id: row.id, name: row.name, approved: row.approved, enabled: row.enabled, acceptsAny: row.accepts_any,
    billing: row.billing, dailyLimit: row.daily_limit });

  /**
   * A ticket of the owner's and the pictures it took (그림 올리기 표): open while it has room and time.
   * @param {string} owner @param {string} ticketId
   */
  async function ticketView(owner, ticketId) {
    const { data: ticket, error } = await db.from('af_generation_upload_tickets').select('id,expires_at').eq('id', id(ticketId)).eq('owner_id', owner).maybeSingle();
    if (error) throw new Problem(503, 'database-unavailable');
    if (!ticket) throw new Problem(404, 'not-found');
    const { data, error: uploadError } = await db.from('af_generation_uploads').select('id,width,height,job_id,created_at').eq('ticket_id', ticket.id).order('created_at');
    if (uploadError) throw new Problem(503, 'database-unavailable');
    /** @type {{ id: string, width: number, height: number, job_id: string | null }[]} */
    const uploads = data ?? [];
    const expired = !(Date.parse(ticket.expires_at) > Date.now());
    return { id: ticket.id, expiresAt: ticket.expires_at, open: !expired && uploads.length < GENERATION_LIMITS.refs, expired,
      uploads: uploads.map(upload => ({ id: upload.id, width: upload.width, height: upload.height, used: upload.job_id !== null })) };
  }
  /**
   * A reference picture kept privately for its owner: a known kind within the sizes, twelve a day; under a ticket, two while it is open.
   * @param {Request} request @param {string} owner @param {string | null} ticket
   */
  async function keepPicture(request, owner, ticket) {
    // A ticket that cannot take it says so before the picture is stored (the database decides again when it is).
    if (ticket) {
      const view = await ticketView(owner, ticket);
      if (!view.open) throw new Problem(view.expired ? 410 : 409, view.expired ? 'ticket-expired' : 'ticket-full');
    }
    const bytes = await readBody(request, GENERATION_LIMITS.refBytes), image = probeImage(bytes), [min, max] = GENERATION_LIMITS.refSide;
    if (!image) throw new Problem(415, 'image-required');
    if (image.width < min || image.height < min || image.width > max || image.height > max) throw new Problem(422, 'image-size');
    const upload = crypto.randomUUID(), path = `refs/${owner}/${upload}.${image.ext}`;
    const { error } = await bucket().upload(path, bytes, { contentType: image.type, upsert: false });
    if (error) throw new Problem(503, 'storage-unavailable');
    const kept = { p_owner: owner, p_id: upload, p_path: path, p_type: image.type, p_bytes: bytes.length, p_width: image.width, p_height: image.height };
    try { await call(ticket ? 'af_generation_ticket_upload' : 'af_generation_upload', ticket ? { ...kept, p_ticket: ticket } : kept); }
    catch (problem) { await bucket().remove([path]).catch(() => {}); throw problem; }
    return { id: upload, width: image.width, height: image.height };
  }

  /**
   * A request's body, read the same way for its check and for the request itself.
   * @param {Request} request @param {string} owner
   */
  async function requested(request, owner) {
    const body = fields(await readJson(request, 8000), ['description', 'language', 'refs', 'rightsConfirmed', 'delegate', 'host', 'hostConsent']);
    if (!['ko', 'en'].includes(body.language)) throw new Problem(422, 'invalid-language');
    if (body.delegate !== undefined && typeof body.delegate !== 'boolean') throw new Problem(422, 'invalid-body');
    // Where it goes (커뮤니티 호스트): ODDBOUT's own worker by default, any approved host, one host by id, or `mine` — his own host,
    // approved or not, with no consent to give (내 선수는 내 PC로, 2026-10-28).
    let host = body.host ?? 'oddbout';
    if (host === 'mine') {
      const { data: own, error: ownError } = await db.from('af_generation_hosts').select('id,removed_at').eq('owner_id', owner).maybeSingle();
      if (ownError) throw new Problem(503, 'database-unavailable');
      if (!own || own.removed_at) throw new Problem(404, 'host-not-found');
      host = own.id;
    }
    if (!['oddbout', 'any'].includes(host) && !UUID.test(host)) throw new Problem(422, 'invalid-host');
    const target = host === 'oddbout' ? {} : { p_host_choice: UUID.test(host) ? 'host' : 'any', ...(UUID.test(host) ? { p_host: host.toLowerCase() } : {}),
      p_host_consent: body.hostConsent === true };
    if (body.refs !== undefined && (!Array.isArray(body.refs) || body.refs.length > GENERATION_LIMITS.refs)) throw new Problem(422, 'invalid-refs');
    return { body, target, refs: (body.refs ?? []).map(id),
      description: text(body.description, GENERATION_LIMITS.description, '/description', { min: GENERATION_LIMITS.descriptionMin, lines: true, code: 'invalid-description' }) };
  }

  /** @param {Request} request @param {string[]} parts @param {string} owner */
  async function creator(request, parts, owner) {
    const method = request.method, route = parts.join('/');
    if (route === 'generations/host') {
      if (method === 'GET') return { ok: true, host: await ownHost(owner) };
      if (method === 'POST') {
        // Applying (or renaming): his name for requesters, how he pays the providers, and his acceptance of the host terms.
        const body = fields(await readJson(request, 2000), ['name', 'billing', 'termsAccepted']);
        return { ok: true, host: hostView(await call('af_generation_host_apply', { p_owner: owner, p_name: typeof body.name === 'string' ? body.name : null,
          p_billing: body.billing ?? null, p_terms: body.termsAccepted === true })) };
      }
      if (method === 'PATCH') {
        const body = fields(await readJson(request, 2000), ['enabled', 'acceptsAny', 'dailyLimit']);
        for (const key of ['enabled', 'acceptsAny']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new Problem(422, 'invalid-host');
        if (body.dailyLimit !== undefined && !Number.isInteger(body.dailyLimit)) throw new Problem(422, 'invalid-host');
        return { ok: true, host: hostView(await call('af_generation_host_update', { p_owner: owner, p_enabled: body.enabled ?? null,
          p_accepts_any: body.acceptsAny ?? null, p_daily_limit: body.dailyLimit ?? null })) };
      }
      // 삭제 (My agents, 2026-10-28): off every list and claim, keys off; refused while a request for him is not over.
      if (method === 'DELETE') {
        const removed = await call('af_generation_host_remove', { p_owner: owner });
        return { ok: true, removed: true, revoked: Number(removed?.revoked) || 0 };
      }
    }
    if (route === 'generations/host/keys') {
      if (method === 'POST') {
        // The key is shown once, here; the database keeps its hash.
        const token = workerToken();
        const issued = await call('af_generation_host_key', { p_owner: owner, p_hash: await sha256(new TextEncoder().encode(token)),
          p_label: `host-${new Date().toISOString().slice(0, 10)}` });
        return { ok: true, key: token, host: issued.host, expiresAt: issued.expiresAt };
      }
      if (method === 'DELETE') return { ok: true, revoked: await call('af_generation_host_revoke', { p_owner: owner }) };
    }
    if (route === 'generations/host/join-codes' && method === 'POST') {
      // Shown once, here, for the host to paste into his PC (`npm run host -- join <code>`); the database keeps its hash.
      const code = `ohj_${hex(crypto.getRandomValues(new Uint8Array(20)))}`;
      const made = await call('af_generation_host_join_code', { p_owner: owner, p_hash: await sha256(new TextEncoder().encode(code)) });
      return { ok: true, code, host: made.host, expiresAt: made.expiresAt };
    }
    if (method === 'GET' && route === 'generations') {
      const { data, error } = await db.from('af_generation_jobs').select('*').eq('owner_id', owner).order('created_at', { ascending: false }).limit(5);
      if (error) throw new Problem(503, 'database-unavailable');
      const rows = data ?? [], taken = await jobTokens(rows.map(/** @param {Job} row */ row => row.id));
      const jobs = await Promise.all(rows.map(/** @param {Job} row */ row => view(row, taken)));
      // Whether he may still ask (the request check's own rule over all his jobs): read from the newest five, it
      // fell out of view past five fighters made on his own PC (API 점검 2026-10-29).
      // His tokens (보유 토큰, 2026-10-31): granted, spent and the balance (null: not readable now); `used` is a balance at or below zero
      // (never for an operator), as the request check reads it (`af_generation_free_used`).
      const tokens = accountTokens(await call('af_generation_balance', { p_owner: owner }).catch(() => null));
      return { ok: true, jobs, used: await call('af_generation_free_used', { p_owner: owner }) === true, tokens,
        capabilities: await call('af_generation_capabilities', {}) };
    }
    if (method === 'POST' && route === 'generations/uploads') {
      // On the site under a ticket of his (the link an agent gave him), or on its own (the site's request form, ChatGPT's attachments).
      const ticket = new URL(request.url).searchParams.get('ticket');
      return { ok: true, upload: await keepPicture(request, owner, ticket === null ? null : id(ticket)) };
    }
    if (method === 'POST' && route === 'generations/upload-tickets') {
      const secret = `afu_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
      const made = await call('af_generation_upload_ticket', { p_owner: owner, p_id: crypto.randomUUID(), p_secret_hash: await sha256(new TextEncoder().encode(secret)) });
      return { ok: true, ticket: { ...await ticketView(owner, made.id), secret } };
    }
    if (method === 'GET' && parts.length === 3 && parts[1] === 'upload-tickets') return { ok: true, ticket: await ticketView(owner, parts[2]) };
    // The checks of a request without making it (MCP 점검 2026-10-29): the connector asks before it uploads the user's pictures, so a
    // refused request keeps none of them. Nothing is made or kept.
    if (method === 'POST' && route === 'generations/check') {
      const { target } = await requested(request, owner);
      await call('af_generation_check', { p_owner: owner, ...target });
      return { ok: true };
    }
    if (method === 'POST' && route === 'generations') {
      const key = id(request.headers.get('idempotency-key'));
      const { body, description, refs, target } = await requested(request, owner);
      const row = await call('af_generation_create', { p_owner: owner, p_key: key, p_description: description,
        p_language: body.language, p_refs: refs, p_rights: body.rightsConfirmed === true,
        // 맡기기 (2026-10-28): the worker picks the look and goes on to the motions; the creator answers once, at the end.
        ...(body.delegate ? { p_delegate: true } : {}), ...target });
      return { ok: true, job: await view(row) };
    }
    if (parts[0] === 'generations' && parts.length === 2 && method === 'GET') return { ok: true, job: await view(await ownJob(owner, parts[1])) };
    if (parts[0] === 'generations' && parts.length === 2 && method === 'DELETE')
      return { ok: true, job: await view(await call('af_generation_cancel', { p_owner: owner, p_id: id(parts[1]) })) };
    if (parts[0] === 'generations' && parts.length === 3 && method === 'POST') {
      const job = id(parts[1]);
      if (parts[2] === 'appearance') {
        const body = fields(await readJson(request, 2000), ['choose', 'revise']);
        if ((body.choose === undefined) === (body.revise === undefined)) throw new Problem(422, 'invalid-answer');
        if (body.choose !== undefined && !['a', 'b'].includes(body.choose)) throw new Problem(422, 'invalid-answer');
        const note = body.revise === undefined ? null : text(body.revise, GENERATION_LIMITS.note, '/revise', { min: 2, code: 'invalid-answer' });
        return { ok: true, job: await view(await call('af_generation_appearance', { p_owner: owner, p_id: job, p_choice: body.choose ?? null, p_note: note })) };
      }
      if (parts[2] === 'motions') {
        const body = fields(await readJson(request, 2000), ['revise']), revise = fields(body.revise, ['clip', 'note']);
        // idle is the look itself, not a motion (the worker sends a change to it to the operator, and a cancel there would give the free
        // fighter back — 리뷰 2026-10-30): a new look is the looks' change, before the motions.
        if (!MOTIONS.includes(revise.clip) || revise.clip === 'idle') throw new Problem(422, 'invalid-answer');
        const note = text(revise.note, GENERATION_LIMITS.note, '/revise/note', { min: 2, code: 'invalid-answer' });
        return { ok: true, job: await view(await call('af_generation_motion', { p_owner: owner, p_id: job, p_clip: revise.clip, p_note: note })) };
      }
      if (parts[2] === 'register') {
        const body = fields(await readJson(request, 8000), ['profile']);
        return { ok: true, job: await view(await call('af_generation_register', { p_owner: owner, p_id: job, p_profile: confirmedProfile(body.profile) })) };
      }
    }
    throw new Problem(404, 'route-not-found');
  }

  /** @param {Request} request @param {string[]} parts @param {string | null} host  The worker key's host (null: the official one). */
  async function worker(request, parts, host) {
    const method = request.method, route = parts.join('/');
    if (method === 'POST' && parts[1] === 'decision-benchmarks' && parts.length === 3)
      return { ok: true, review: await benchmarkReview({ db, reviewer: decisionsReviewer, responsesReviewer, cascadeReviewer, host, caseId: id(parts[2]),
        body: await readJson(request, BENCHMARK_BODY_BYTES) }) };
    if (method === 'POST' && parts[1] === 'jobs' && parts[3] === 'decisions' && parts.length === 4) {
      const lease = id(request.headers.get('x-generation-lease'));
      const row = await call('af_generation_held', { p_id: id(parts[2]), p_token: lease });
      if (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.now()) throw new Problem(409, 'lease-lost');
      const effectiveHost = host ?? await call('af_generation_official', {});
      if (row.assigned_host !== effectiveHost) throw new Problem(403, 'worker-required');
      if (!['appearance', 'motions'].includes(row.status)) throw new Problem(409, 'generation-state');
      if (!productionReviewer?.enabled) return { ok: true, review: { mode: 'off', status: 'disabled', advisory: true, visualApproval: false } };
      const evidence = await reviewEvidence(await readJson(request, DECISIONS.bodyBytes));
      return { ok: true, review: await productionReviewer.review({ db, job: row, host, lease, evidence }) };
    }
    if (method === 'PUT' && parts[1] === 'jobs' && parts[3] === 'artifacts' && parts.length === 5) {
      const row = await call('af_generation_held', { p_id: id(parts[2]), p_token: id(request.headers.get('x-generation-lease')) });
      if (!ARTIFACT.test(parts[4])) throw new Problem(422, 'invalid-artifact');
      const bytes = await readBody(request, GENERATION_LIMITS.artifactBytes);
      if (probeImage(bytes)?.type !== 'image/webp') throw new Problem(415, 'webp-required');
      // A stage made again writes its pictures again (a new round uses new names; a retried upload replaces its own).
      const { error } = await bucket().upload(artifactPath(row.id, parts[4]), bytes, { contentType: 'image/webp', upsert: true });
      if (error) throw new Problem(503, 'storage-unavailable');
      return { ok: true, artifact: parts[4], bytes: bytes.length };
    }
    // 선수 프로필 세트 (2026-10-31): the chosen front (the job's own candidate) and its face square, kept on the job until the validator
    // registers his package; then attachJobProfileSet (profile-sets.mjs) makes them his set. Checked as any set file is.
    if (method === 'POST' && parts[1] === 'jobs' && parts[3] === 'profile-front' && parts.length === 4) {
      const row = await heldForSubmission(request, parts[2]);
      const body = fields(await readJson(request, 1000), ['artifact', 'face']);
      const chosen = candidatesOf(row)[row.choice === 'b' ? 1 : 0];
      if (typeof body.artifact !== 'string' || !chosen || body.artifact !== chosen || !chosen.startsWith('front-')) throw new Problem(422, 'invalid-artifact');
      const { data, error } = await bucket().download(artifactPath(row.id, chosen));
      if (error || !data) throw new Problem(503, 'storage-unavailable');
      const bytes = new Uint8Array(await data.arrayBuffer()), probed = probeImage(bytes);
      if (probed?.type !== 'image/webp' || bytes.length > PROFILE_SET_LIMITS.frontBytes) throw new Problem(422, 'invalid-profile-set');
      const front = { path: 'front.webp', bytes: bytes.length, sha256: await sha256(bytes), width: probed.width, height: probed.height };
      const parsed = parseProfileSet(JSON.stringify({ version: PROFILE_SET_VERSION, front, face: body.face }));
      if (!parsed.ok) throw new Problem(422, 'invalid-profile-set', parsed.errors);
      const profileFront = { artifact: chosen, ...front, face: parsed.data.face };
      const { error: saveError } = await db.from('af_generation_jobs').update({ profile_front: profileFront }).eq('id', row.id);
      if (saveError) throw new Problem(503, 'database-unavailable');
      return { ok: true, profileFront };
    }
    if (parts[1] === 'jobs' && parts[3] === 'submission') {
      const row = await heldForSubmission(request, parts[2]);
      if (method === 'POST' && parts.length === 4) {
        const manifest = await checkedManifest(request);
        const submission = await call('af_create_submission', { p_owner: row.owner_id, p_key: row.id, p_text: manifest.text, p_sha: manifest.sha,
          p_bytes: manifest.bytes, p_fighter: null });
        return present(submission);
      }
      if (method === 'PUT' && parts[4] === 'assets' && parts.length === 6) return storeAsset(db, await jobSubmission(row), parts[5], request);
      if (method === 'POST' && parts[4] === 'submit' && parts.length === 5)
        return present(await call('af_submit', { p_owner: row.owner_id, p_id: (await jobSubmission(row)).id }));
      throw new Problem(404, 'route-not-found');
    }
    // A stage's tokens without its lease (리뷰 2026-10-31): the job was cancelled under it (lease lost) or its finish was refused, and the
    // tokens were spent all the same. The lease it ran under keeps one row per stage run, whichever route reports it; `kept` false: before.
    if (method === 'POST' && parts[1] === 'jobs' && parts[3] === 'usage' && parts.length === 4) {
      const body = fields(await readJson(request, 2000), ['leaseToken', 'stage', 'tokens']);
      if (typeof body.stage !== 'string' || !stageTokens(body.tokens)) throw new Problem(422, 'invalid-result');
      const kept = await call('af_generation_record_usage_after', { p_host: host, p_id: id(parts[2]), p_lease: id(body.leaseToken),
        p_stage: body.stage, p_tokens: body.tokens });
      return { ok: true, kept: kept === true };
    }
    if (method !== 'POST') throw new Problem(404, 'route-not-found');
    const body = await readJson(request, GENERATION_LIMITS.result + 2000);
    if (route === 'generation-worker/heartbeat') {
      const { health, usage } = fields(body, ['health', 'usage']);
      if (!isObject(health) || JSON.stringify(health).length > 2000) throw new Problem(422, 'invalid-health');
      // The subscription's rate-limit reading (2026-10-31, host/codex-usage.mjs), kept for the operator: the budget is the day's tokens.
      // A reading that does not parse is left out, never the heartbeat.
      if (usageReading(usage)) await call('af_generation_host_usage', { p_host: host, p_usage: usage }).catch(() => null);
      return { ok: true, capabilities: await call('af_generation_host_heartbeat', { p_host: host, p_health: health }) };
    }
    // Which of this host's jobs are over for him (the worker closes their folders). A community host: his own jobs that ended. The official
    // host writes every job's brief, so it also hears of jobs that ended anywhere, and of jobs another host took after its brief (2026-10-28 —
    // the brief folder of the first test host's job stayed open on the office PC and blocked og setup).
    if (route === 'generation-worker/ended') {
      const jobs = fields(body, ['jobs']).jobs;
      if (!Array.isArray(jobs) || jobs.length > 50) throw new Problem(422, 'invalid-body');
      if (!jobs.length) return { ok: true, ended: [] };
      const ids = jobs.map(id), official = host ? null : await call('af_generation_official', {});
      const { data, error } = await db.from('af_generation_jobs').select('id,status,assigned_host').in('id', ids);
      if (error) throw new Problem(503, 'database-unavailable');
      /** @type {(row: { status: string }) => boolean} */
      const over = row => ['cancelled', 'expired', 'rejected', 'failed', 'submitted'].includes(row.status);
      return { ok: true, ended: /** @type {Pick<Job, 'id' | 'status' | 'assigned_host'>[]} */ (data ?? []).filter(row => host ? row.assigned_host === host && over(row)
        : over(row) || (row.assigned_host !== null && row.assigned_host !== official)).map(row => row.id) };
    }
    if (route === 'generation-worker/claim') {
      const row = await call('af_generation_claim_for', { p_host: host });
      if (!row?.id) return { ok: true, stage: 'idle' };
      const { data: refs, error } = await db.from('af_generation_uploads').select('id,path,content_type,width,height').eq('job_id', row.id);
      if (error) throw new Problem(503, 'database-unavailable');
      const candidates = candidatesOf(row);
      const urls = await signed([...(refs ?? []).map(/** @param {Upload} ref */ ref => ref.path), ...candidates.map(name => artifactPath(row.id, name))]);
      return { ok: true, job: { id: row.id, status: row.status, leaseToken: row.lease_token, owner: row.owner_id, createdAt: row.created_at, description: row.description,
        language: row.language, brief: row.brief ?? null, delegate: row.delegate === true, choice: row.choice ?? null, appearanceNote: row.appearance_note ?? null,
        decisionsReview: { mode: productionReviewer?.enabled ? 'shadow' : 'off' },
        appearanceRound: row.appearance_revisions, motionNote: row.motion_note ?? null, motionRound: row.motion_revisions, profile: row.profile ?? null,
        refs: (refs ?? []).map(/** @param {Upload} ref */ ref => ({ id: ref.id, contentType: ref.content_type, width: ref.width, height: ref.height, url: urls.get(ref.path) ?? null })),
        candidates: candidates.map((name, i) => ({ key: i === 0 ? 'a' : 'b', name, url: urls.get(artifactPath(row.id, name)) ?? null })),
        preview: previewOf(row) } };
    }
    const lease = fields(body, ['jobId', 'leaseToken', 'progress', 'event', 'outcome', 'result']);
    const at = { p_id: id(lease.jobId), p_token: id(lease.leaseToken) };
    if (route === 'generation-worker/progress') {
      if (lease.event !== undefined && (!isObject(lease.event) || JSON.stringify(lease.event).length > 2000)) throw new Problem(422, 'invalid-event');
      const row = await call('af_generation_progress', { ...at, p_progress: Number.isInteger(lease.progress) ? lease.progress : null, p_event: lease.event ?? null });
      return { ok: true, status: row.status, leaseExpiresAt: row.lease_expires_at };
    }
    if (route === 'generation-worker/finish') {
      if (!['ok', 'rejected', 'review', 'failed', 'retry'].includes(lease.outcome)) throw new Problem(422, 'invalid-result');
      /** @type {Record<string, any>} The worker's result, checked here. */
      const result = lease.result ?? {};
      if (!isObject(result) || JSON.stringify(result).length > GENERATION_LIMITS.result) throw new Problem(422, 'invalid-result');
      if (result.candidates !== undefined && (!Array.isArray(result.candidates) || result.candidates.some(name => !ARTIFACT.test(name ?? ''))))
        throw new Problem(422, 'invalid-result');
      if (result.choice !== undefined && !['a', 'b'].includes(result.choice)) throw new Problem(422, 'invalid-result');
      if (result.preview !== undefined && (!Array.isArray(result.preview)
        || result.preview.some(p => !isObject(p) || !MOTIONS.includes(p.clip) || !ARTIFACT.test(p.name ?? '')
          || (p.note !== undefined && !PREVIEW_NOTES.includes(p.note))))) throw new Problem(422, 'invalid-result');
      // The stage's codex tokens (2026-10-31, host/codex-usage.mjs): kept per stage for the official host's daily budget
      // (af_generation_official_wait). Spent whatever the outcome; a count that cannot be kept never holds the result back.
      if (stageTokens(result.tokens)) await call('af_generation_record_usage', { ...at, p_tokens: result.tokens }).catch(() => null);
      const row = await call('af_generation_finish', { ...at, p_outcome: lease.outcome, p_result: result });
      return { ok: true, status: row.status };
    }
    throw new Problem(404, 'route-not-found');
  }

  return async (request, parts) => {
    const isWorker = parts[0] === 'generation-worker';
    /** @type {(body: any, status?: number) => Response} */
    const json = (body, status = 200) => jsonResponse(body, status, isWorker ? undefined : CORS);
    try {
      if (request.method === 'OPTIONS' && !isWorker) return json({ ok: true });
      if (!isWorker && request.method === 'GET' && parts.join('/') === 'generations/capabilities')
        return json({ ok: true, capabilities: await call('af_generation_capabilities', {}) });
      if (!isWorker && request.method === 'GET' && parts.join('/') === 'generations/hosts')
        return json({ ok: true, hosts: await call('af_generation_hosts_public', {}) });
      // A PC trades a join code for its worker key: no account session on the PC, a host key only.
      if (!isWorker && request.method === 'POST' && parts.join('/') === 'generations/host/join') {
        const body = fields(await readJson(request, 1000), ['code']);
        if (typeof body.code !== 'string' || !JOIN_CODE.test(body.code)) throw new Problem(400, 'invalid-join-code');
        const token = workerToken();
        const joined = await call('af_generation_host_join', { p_code_hash: await sha256(new TextEncoder().encode(body.code)),
          p_key_hash: await sha256(new TextEncoder().encode(token)), p_label: `host-join-${new Date().toISOString().slice(0, 10)}` });
        return json({ ok: true, key: token, host: joined.host, name: joined.name, approved: joined.approved, expiresAt: joined.expiresAt });
      }
      // A terminal agent's picture (그림 올리기 표): the ticket's secret names the owner and the ticket, no account session on that PC.
      if (!isWorker && request.method === 'POST' && parts.join('/') === 'generations/ticket-uploads') {
        const secret = request.headers.get(UPLOAD_TICKET_HEADER) ?? '';
        if (!UPLOAD_TICKET.test(secret)) throw new Problem(403, 'invalid-ticket');
        const { data: ticket, error } = await db.from('af_generation_upload_tickets').select('id,owner_id')
          .eq('secret_hash', await sha256(new TextEncoder().encode(secret))).maybeSingle();
        if (error) throw new Problem(503, 'database-unavailable');
        if (!ticket) throw new Problem(403, 'invalid-ticket');
        return json({ ok: true, upload: await keepPicture(request, ticket.owner_id, ticket.id) });
      }
      // The key names the worker's host; the stages it may take are his (the official host's when the key names none).
      if (isWorker) return json(await worker(request, parts, await authenticate(request, 'generation')));
      const owner = await authenticate(request, false);
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'reviews') {
        const job = await ownJob(owner, parts[1]);
        const { data, error } = await db.from('af_decision_reviews').select('id,created_at,report').eq('job_id', job.id).order('created_at', { ascending: true }).limit(100);
        if (error) throw new Problem(503, 'review-store-unavailable');
        return json({ ok: true, reviews: (data ?? []).map(/** @param {{ id: string, created_at: string, report: unknown }} r */ r => ({ id: r.id, createdAt: r.created_at, report: r.report })) });
      }
      return json(await creator(request, parts, owner));
    } catch (error) {
      if (error instanceof Problem) return json({ ok: false, stage: 'generation', code: error.message, ...(error.errors ? { errors: error.errors } : {}) }, error.status);
      return json({ ok: false, stage: 'generation', code: 'service-unavailable' }, 503);
    }
  };
}
