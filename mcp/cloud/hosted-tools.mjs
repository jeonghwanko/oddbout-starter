// @ts-check
// 호스팅 생성 도구 (2026-10-28): ODDBOUT's generation worker makes the fighter; the agent carries the user's answers.
import { z } from 'zod';
import { GENERATION_LIMITS, UPLOAD_TICKET_HEADER, artifactPath, confirmedProfile } from '../../api/generations.mjs';
import { Problem, readBody, UUID } from '../../api/http.mjs';
import { encodeBase64 } from '../../api/base64.mjs';
import { probeImage } from '../../api/image-probe.mjs';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import { profileLimits } from '../../contracts/ai-fighter/profile-limits.mjs';
import { CREATOR_PAGE, LIBRARY_FILE_HOSTS, SITE_URL_NEXT, UUID_ARG, allowedFileUrl, downloadHostFile, fileSchema, pause, siteUrl, timeLeft, unavailable, within } from './common.mjs';
import { CLOUD_RESOURCE, TICKET_UPLOAD_URL } from './resources.mjs';
import { toolRef } from './merged-tools.mjs';
/**
 * @typedef {import('./common.mjs').Identity} Identity
 * @typedef {import('./common.mjs').Hosted} Hosted
 * @typedef {import('./common.mjs').Invoke} Invoke
 * @typedef {import('./common.mjs').Register} Register
 * @typedef {import('./common.mjs').HostFile} HostFile
 */
/**
 * A job as the API shows it (api/generations.mjs), the fields hostedNext reads.
 * @typedef {{ id: string, status: string, delegate?: boolean, error?: string | null, choice?: string | null,
 *   revisionsLeft?: { appearance?: number, motions?: number }, preview?: { note?: string }[],
 *   submission?: { stage: string, fighterId?: string | null } | null,
 *   host?: { choice: string, requested?: { name?: string } | null, assigned?: unknown },
 *   queue?: { position: number, reason?: 'turn' | 'usage' | 'paused', usedPercent?: number, resetsAt?: string, dailyLimit: number, startedToday: number } | null,
 *   profileSetId?: string | null, profileFront?: { outcome: string, code?: string, errors?: string[] } | null,
 *   tokens?: number | null, expressions?: { url: string | null } | null,
 *   progress?: number, description?: string, profile?: { name?: string } | null, createdAt?: string, updatedAt?: string, agent?: string | null,
 *   side?: { url: string | null } | null, drafts?: { clip: string, url: string | null, state?: string }[],
 *   appearanceAutoSelectAt?: string | null, candidates?: { key: string, url: string | null }[] }} HostedJob
 * @typedef {{ id: number, at: string, kind: string, data: any }} JobEvent  A row of af_generation_events.
 * @typedef {{ status: string, progress: number, submission: string | null, picture: number | null }} WatchTick  What a wait sees of a job;
 *   `picture`: while the motions are made, the id of its newest event that carries a picture.
 * @typedef {{ kind: string, clip?: string, name: string, id: number }} PictureChange  A picture an event added or changed: a draft (a new
 *   clip, a new take's name or a new state), or a chosen side view or faces (`name`: its artifact).
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
  + 'Read the same job again for fresh preview URLs; a URL is not proof that the user saw the image. '
  + 'While the user watches a working job in this chat, read it again with waitSeconds 25 each time a read returns and tell him each change. '
  + 'Use statusSummary for the current stage, completion and required action; progress is stage-local, never overall completion. '
  + 'When appearanceAutoSelectAt is present, explain that unanswered looks default to A ten minutes after the pair is ready. '
  + 'The server selects it; do not send a fabricated user choice or run a chat timer. '
  + 'Do not ask for motion approval before registration. Hosted creation includes registration into production; only the owner enters on the site. '
  + 'Never promise background chat notifications or scheduling unless the host actually supports them. '
  + 'A result\'s siteUrl is the user\'s page for that request (or, once registered, for his fighter) on the ODDBOUT website. ';
/**
 * picture and secondPicture: a file the host attaches, whose refusal says where any other picture goes (Grok 점검 2026-11-03: an address
 * alone, one without a file id or a long data: address failed the schema with zod's words only). Agents read it in the validation error.
 */
const ATTACHED_ONLY = 'only a file this host attaches (ChatGPT does). Send any other picture, one made in this chat too, through '
  + 'start_picture_upload and pass its id in pictureUploads';
const PICTURE = fileSchema(ATTACHED_ONLY);
/** The worker's events that may carry a picture the job shows (api/generations.mjs: draftsOf, chosenArtifactOf). */
const PICTURE_EVENTS = ['drafts', 'side', 'expressions'];
/**
 * Whether an event carries a picture: every drafts list; a side view or faces only once chosen (MCP 리뷰 2026-11-05: a side take's pass or
 * fail and failed faces carry none, and as the newest event they hid the draft that came just before).
 * @param {JobEvent} event
 */
const carriesPicture = event => event.kind === 'drafts' || (event.data?.outcome === 'chosen' && typeof event.data?.artifact === 'string');
/** States the worker is on; an answer from the user is not awaited. */
const HOSTED_WORKING = new Set(['queued', 'appearance', 'motions', 'submitting']);
/** A submission still on its way to the registry (`af_submissions`). */
const SUBMISSION_PENDING = new Set(['uploading', 'queued', 'validating']);
/** The longest wait one get_hosted_fighter call holds: enter_cup's proven wait (CUP_WAIT_MS), inside the hosts' tool timeouts and the Edge limit. */
export const HOSTED_WAIT_SECONDS = 25;
const HOSTED_POLL_MS = 3000;
/** What a wait leaves of the call's deadline for the job's own read and its signed URLs (2026-11-03: the wait once took the whole budget). */
const HOSTED_READ_MS = 4000;
const PROFILE_KEYS = ['name', 'description', 'names', 'lines', 'stats'];
/** @type {(status: string, submission: string | null) => boolean} */
const hostedSettled = (status, submission) => !HOSTED_WORKING.has(status) && !(status === 'submitted' && SUBMISSION_PENDING.has(submission ?? 'queued'));

/** What the agent does next with a job, from its state: the user's answer it asks for, or how long to wait. */
// A run the gate refused, made from the walk (the worker's `run-from-walk` preview note, 2026-10-29): the creator hears it and may film it again.
const RUN_FROM_WALK_NEXT = 'The run preview is the walk played faster: no filmed run passed the checks. Tell the user so; '
  + 'if he wants a real run, revise_hosted_motion with clip run and his words. ';
/**
 * How an agent puts a job's pictures in its chat (Grok 점검 2026-11-03): Cursor's Grok Bot chat printed a picture's address as text, markdown
 * or its own image card, and showed the picture once the bot downloaded the file and attached it.
 */
const IMAGES_NEXT = 'where this chat shows no picture from its url, download each file (the url lasts ten minutes) and attach it';

// Keep the pair under 5.4 MB after base64 encoding. Oversize or unavailable previews retain the ordinary signed-link response.
const INLINE_CANDIDATE_BYTES = 2_000_000;
/**
 * Attach only the two looks from a successful owner-scoped job read. Never fetch a caller-supplied URL or follow a redirect.
 * @param {HostedJob | undefined} job @param {typeof fetch} fetcher @param {import('./common.mjs').ToolContext} context
 * @returns {Promise<Array<{type:'image', mimeType:'image/webp', data:string}>>}
 */
export async function hostedCandidateImages(job, fetcher, { signal, deadline }) {
  // Keep finished looks available after selection, including a provider stop. Working polls use the card's signed URLs
  // instead of downloading and sending the same pair of images every 25 seconds.
  if (!job || HOSTED_WORKING.has(job.status) || !UUID.test(job.id) || job.candidates?.length !== 2 || signal.aborted || Date.now() >= deadline) return [];
  const cancel = new AbortController();
  try {
    const prefix = '/storage/v1/object/sign/af-generation/jobs/' + job.id + '/';
    const urls = job.candidates.map((candidate, i) => {
      const url = new URL(candidate.url ?? '');
      if (candidate.key !== ['a', 'b'][i] || url.origin !== new URL(CLOUD_RESOURCE).origin || url.username || url.password
        || url.hash || !url.searchParams.get('token') || !url.pathname.startsWith(prefix)
        || !/^[a-z0-9][a-z0-9-]{0,47}\.webp$/.test(url.pathname.slice(prefix.length))) throw Error('invalid-candidate');
      return url;
    });
    if (urls[0].pathname === urls[1].pathname) return [];
    const bounded = AbortSignal.any([within(signal, timeLeft(deadline, HOSTED_READ_MS)), cancel.signal]);
    return await Promise.all(urls.map(async url => {
      const response = await fetcher(url.href, { signal: bounded, redirect: 'error', credentials: 'omit' });
      if (!response.ok) throw Error('candidate-unavailable');
      const bytes = await readBody(response, INLINE_CANDIDATE_BYTES);
      if (probeImage(bytes)?.type !== 'image/webp') throw Error('invalid-candidate-image');
      return { type: /** @type {const} */ ('image'), mimeType: /** @type {const} */ ('image/webp'), data: encodeBase64(bytes) };
    }));
  } catch {
    return [];
  } finally {
    cancel.abort();
  }
}
/**
 * How an agent follows a working job (Grok 점검 2026-11-03: the bot's own schedule checked every 5 to 10 minutes, and the user asked for
 * 25 seconds): a wait returns as soon as something the user sees changes, so a chat he watches hears of each motion as it is made.
 */
const WATCH_NEXT = 'While the user watches this chat, call get_hosted_fighter again with waitSeconds 25 each time it returns (it returns '
  + 'early when the state, the progress or a picture changes) and tell him each change at once: new pictures, the progress (percent) or the '
  + 'place in line. If the chat stops, give him siteUrl to follow the server job; do not promise a background notification.';
/**
 * The tokens a job took off the user's balance (보유 토큰, 2026-10-31: every token ODDBOUT's making spends, whatever the outcome).
 * @param {HostedJob} job
 */
const spent = job => Number.isSafeInteger(job.tokens) && /** @type {number} */ (job.tokens) > 0 ? ` It used ${job.tokens} of the user's tokens.` : '';
/**
 * Why a registered job holds no profile set, from the worker's last word on it (job.profileFront, 2026-11-07: 깔깔이's square front was
 * refused and the next said only that no set went in). Without one he cannot enter, so the user hears it.
 * @param {HostedJob} job
 */
const setMissed = job => {
  const said = job.profileFront;
  if (!said || said.outcome === 'ok') return '';
  const codes = [said.code, ...(said.errors ?? [])].filter(Boolean).join(', ');
  return ` (ODDBOUT could not make it from his chosen front: ${said.outcome}${codes ? `, ${codes}` : ''}). Tell the user: he enters (출전) only once`
    + ' his fighter has a front painting that passes ODDBOUT\'s front check';
};
/** The states the user can follow on the site and answer there; a job over, a refused package and a registered fighter (whose text names his page) say nothing of it. */
const HOSTED_FOLLOWED = new Set(['queued', 'appearance', 'appearance_ready', 'motions', 'motion_ready', 'submitting', 'needs_review']);
/**
 * What the agent does next with a job, and (siteUrl, 2026-11-03) where the user can follow it on the site. `uploads`: whether this address
 * lists the upload tools (the full edition's do); without them a step names none.
 * @param {HostedJob} job @param {{ uploads?: boolean }} [options]
 */
export function hostedNext(job, { uploads = true } = {}) {
  const step = hostedStep(job, uploads);
  return HOSTED_FOLLOWED.has(job.status) || (job.status === 'submitted' && !['registered', 'rejected'].includes(job.submission?.stage ?? '')) ? `${step} ${SITE_URL_NEXT}` : step;
}
/** @param {HostedJob} job @param {boolean} [uploads] */
function hostedStep(job, uploads = true) {
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
          + `Tell the user. ${WATCH_NEXT}`;
      return job.delegate
        ? 'ODDBOUT is writing the profile, painting two front-view looks and picking one itself, '
          + 'then it makes the eleven motions (about 15 to 30 minutes in all). '
          + `Tell the user. ${WATCH_NEXT}`
        : `ODDBOUT is writing the profile and painting two front-view looks (a few minutes). ${WATCH_NEXT}`;
    case 'appearance_ready':
      return `${job.delegate ? 'ODDBOUT could not pick a look by itself. ' : ''}Show the user both looks (candidates a and b, his fighter from the front) as images `
        + `(${IMAGES_NEXT}) and ask which one: the one he picks is also his profile picture on the site and in the arena. `
        + `Then choose_hosted_look with his pick, or with one sentence to change both (${left.appearance ?? 0} changes left).`
        + (job.appearanceAutoSelectAt ? ` Tell him: if no choice or revision is received, the server automatically selects A after ${job.appearanceAutoSelectAt}`
          + ' (ten minutes after this pair was ready, checked once a minute), even if he closes the chat. The host continues when available.'
          + ' Do not send choose_hosted_look on his behalf just because time elapsed; read the job to confirm the actual selection.' : '');
    case 'motions':
      return `ODDBOUT is drawing ${job.delegate ? 'the look it picked' : 'the chosen look'} from the side (job.side once it is drawn) and making the eleven motions `
        + 'from that side view (about 15 to 30 minutes), and his six arena faces from the front (job.expressions once drawn; the last is his '
        + 'knocked-out face on the KO card). Each motion shows in job.drafts as soon as it is made; a walk or run with a state '
        + `is still being checked and may be filmed again. Tell the user and show him what is made so far (${IMAGES_NEXT}). ${WATCH_NEXT}`;
    case 'motion_ready':
      return `${job.preview?.some(p => p.note === 'run-from-walk') ? RUN_FROM_WALK_NEXT : ''}`
        + `Show the user ${job.delegate ? `the look ODDBOUT picked (candidate ${job.choice}), ` : ''}the motion previews as images (${IMAGES_NEXT}), `
        + `${job.expressions?.url ? 'his six arena faces (job.expressions: the last one is his face when he is knocked out), ' : ''}and the profile draft. `
        + 'The motions are finished, but registration has not started. This is a legacy waiting job: '
        + 'continue the requested creation with register_hosted_fighter now, without asking for motion approval. '
        + 'If the user has explicitly asked to hold or revise instead, honor that request.';
    case 'submitting':
      return `ODDBOUT is packaging the fighter and submitting it under the user's account. ${WATCH_NEXT}`;
    case 'submitted':
      // 출전 (2026-10-30): a registered fighter is in production until the user watches his motions and enters him.
      if (job.submission?.stage === 'registered') return `Registered: fighter ${job.submission.fighterId}. Tell the user: he can check current entry status and watch `
        + 'every motion on his fighter page (give him siteUrl) and enter him there if needed (출전). Registration alone does not report current entry status. '
        + 'Leave entry to the owner on the website; do not enter him from this creation flow. '
        // Not a promise (2026-11-03, 레온: his set was refused by the file check while this said he could enter once it was checked).
        + (job.profileSetId ? `His chosen front went in as his profile set (${job.profileSetId}). Before he enters, read ${toolRef('get_registered_fighter')}: its `
          + 'front says whether the set passed ODDBOUT\'s checks, and its next what to do if not. The home and the arena show it once an operator approves it. '
          + (job.expressions?.url ? `His six arena faces were sent with it; ${toolRef('get_profile_set')} says whether they passed the check (sheetErrors when not).` : '')
          : `His profile set (front picture) did not go in with it${setMissed(job)}: `
            + (uploads ? 'prepare_profile_set can upload one.' : 'this connector cannot upload one; the user uploads it from the ODDBOUT app in ChatGPT or with the creator kit.'));
      if (job.submission?.stage === 'rejected') return `The server check refused the package. A person at ODDBOUT will look at it.${spent(job)}`;
      return `The server is checking the package. ${WATCH_NEXT}`;
    case 'needs_review': return `This step needs an ODDBOUT operator's attention; it is not waiting for user motion approval${error}. Tell the user and show him what is made so far `
      + `(${IMAGES_NEXT}); check later.${spent(job)}`;
    case 'rejected': return `ODDBOUT declined this request${error}.${spent(job)} A different request may be made while his balance is above zero.`;
    case 'failed': return `This request failed${error}.${spent(job)} He may ask again while his balance is above zero.`;
    default: return `This request is ${job.status}; it is over.`;
  }
}
/**
 * Where the user follows a job on the site: his fighter's all-motions page once registered (that is where he checks the motions and
 * enters him), else the request's page.
 * @param {HostedJob} job
 */
const jobSite = job => siteUrl({ fighterId: job.submission?.stage === 'registered' ? job.submission.fighterId : null, jobId: job.id });
/**
 * An answer the job does not wait for now (Grok 점검 2026-11-03: the bot sent a second motion change while the first was being made, got a
 * bare generation-state and had to guess): what to do instead.
 */
const ANSWER_LATER = 'The requested change was not applied. Read get_hosted_fighter for the current state before doing anything else. '
  + 'Newly completed motions register automatically; do not wait for motion_ready or repeat the change automatically.';
/** @param {any} result  The API's JSON. @param {boolean} uploads */
const withNextOf = (result, uploads) => result?.ok && result.job ? { ...result, statusSummary: hostedStatus(result.job), next: hostedNext(result.job, { uploads }), siteUrl: jobSite(result.job) } : result;

/** A stable status contract shared by full reads, compact waits and the chat card.
 * Progress belongs to one stage. Only a registered submission means creation completed.
 * @param {HostedJob} job
 */
export function hostedStatus(job) {
  const registered = job.status === 'submitted' && job.submission?.stage === 'registered';
  const failed = ['failed', 'rejected', 'cancelled', 'expired'].includes(job.status) || job.submission?.stage === 'rejected';
  const state = registered ? 'registered' : failed ? 'stopped' : job.status === 'appearance_ready' ? 'choose_look'
    : job.status === 'needs_review' ? 'operator_review' : job.status === 'motion_ready' ? 'registration_pending'
    : job.status === 'submitted' ? 'validating' : HOSTED_WORKING.has(job.status) ? job.status : 'unknown';
  return { state, completed: registered, terminal: registered || failed,
    actionRequired: registered ? 'enter_on_site' : job.status === 'appearance_ready' ? (job.appearanceAutoSelectAt ? 'choose_look_or_wait' : 'choose_look')
      : job.status === 'motion_ready' ? 'agent_register' : job.status === 'needs_review' ? 'operator' : failed ? 'inspect_error'
        : state === 'unknown' ? 'inspect_status' : 'none',
    stageProgress: Number.isFinite(job.progress) ? Math.max(0, Math.min(100, /** @type {number} */ (job.progress))) : null,
    updatedAt: job.updatedAt ?? null, checkedAt: new Date().toISOString(), error: job.error ?? null,
    appearanceAutoSelectAt: job.status === 'appearance_ready' ? job.appearanceAutoSelectAt ?? null : null,
    queue: job.queue ? { position: job.queue.position, reason: job.queue.reason ?? 'turn', resetsAt: job.queue.resetsAt ?? null } : null };
}

/**
 * 감시 응답 줄이기 (MCP 최적화 2026-11-05): a chat that watches a job read the whole of it — every picture's signed URL and the long next — at
 * each 25-second wait, 40 to 80 times a fighter (10 to 15 KB each). A wait on a job whose own next only asks to be watched answers with where
 * it stands and what changed while it waited; a read without waitSeconds, and any answer at a decision point or the end, stays whole.
 * @param {HostedJob} job
 */
const onlyWatched = job => hostedStep(job).endsWith(WATCH_NEXT);
/** The newest picture events a tick reads: a few picture-less verdicts after a picture do not hide it. */
const TICK_EVENTS_READ = 8;
/**
 * How far before a watch began its answer looks for pictures (MCP 리뷰 2026-11-05): a draft made while the agent wrote to the user, between
 * two waits, is in the next answer too. The server keeps nothing between calls, so a picture is named in each answer for about this long.
 */
const WATCH_LOOKBACK_MS = 90_000;
/** The picture events a watch's answer reads: those of the look-back and the wait, beside the drafts list sent before them. */
const WATCH_EVENTS_READ = 40;
/** The most pictures one watch's answer names, newest first; `more` counts the rest. */
const WATCH_PICTURES = 12;
/** A drafts event's entries. @param {JobEvent | undefined} event @returns {{ clip: string, name: string, key: string }[]} */
const draftEntries = event => (Array.isArray(event?.data?.clips) ? /** @type {any[]} */ (event.data.clips) : [])
  .map(d => ({ clip: String(d?.clip), name: String(d?.name), key: `${d?.clip}:${d?.name}:${d?.state ?? ''}` }));
/** The order the worker sent its drafts lists in: its `seq`, a list without one first (as api/generations.mjs draftsOf). @param {JobEvent} event */
const draftOrder = event => Number.isSafeInteger(event.data?.seq) ? event.data.seq : -1;
/**
 * The pictures these events added or changed, the latest per draft clip and per kind (MCP 리뷰 2026-11-05): each drafts list against the
 * one sent before it — a new clip, a new take's name or a new state, several when the worker sends them in one list (after assembly, every
 * action clip at once) — and each chosen side view or faces.
 * @param {JobEvent[]} events  picture-less ones included @param {JobEvent | undefined} before  the drafts list sent before them
 * @returns {PictureChange[]}
 */
function pictureChanges(events, before) {
  const pictures = events.filter(carriesPicture);
  /** @type {Map<string, PictureChange>} */
  const changes = new Map();
  let previous = new Set(draftEntries(before).map(d => d.key));
  for (const event of pictures.filter(event => event.kind === 'drafts').sort((a, b) => draftOrder(a) - draftOrder(b) || a.id - b.id)) {
    const entries = draftEntries(event);
    for (const d of entries) if (!previous.has(d.key)) changes.set(`draft:${d.clip}`, { kind: 'draft', clip: d.clip, name: d.name, id: event.id });
    previous = new Set(entries.map(d => d.key));
  }
  for (const event of pictures.filter(event => event.kind !== 'drafts').sort((a, b) => a.id - b.id))
    changes.set(event.kind, { kind: event.kind, name: event.data.artifact, id: event.id });
  return [...changes.values()];
}
/**
 * A changed picture with its URL from the job just read, or null. Only that very picture's URL (the signed URL names its artifact's path): a
 * draft since replaced or dropped gives none, never another's (MCP 리뷰 2026-11-05: an unrelated older draft once stood in, marked new).
 * @param {HostedJob} job @param {PictureChange} change @param {number | null} baseline  the newest picture event before this wait
 */
function pictureOf(job, change, baseline) {
  const draft = change.kind === 'draft' ? job.drafts?.find(d => d.clip === change.clip) : undefined;
  const shown = draft ?? (change.kind === 'side' ? job.side : change.kind === 'expressions' ? job.expressions : null);
  if (!shown?.url) return null;
  let path;
  try { path = new URL(shown.url).pathname; } catch { return null; }
  if (!path.endsWith(`/${artifactPath(job.id, change.name)}`)) return null;
  return { kind: change.kind, ...(draft ? { clip: draft.clip, name: change.name } : {}), ...(draft?.state ? { state: draft.state } : {}),
    url: shown.url, new: baseline !== null && change.id > baseline };
}
/**
 * A watch's short answer: the job's state (with its place in line or its package's check), what changed during this wait (status, progress,
 * the submission's check, pictures), and while the motions are made each picture added or changed since shortly before the wait (newest
 * first; `new`: it came during this wait), which pictures there are by name, and for a request left to ODDBOUT the look it picked.
 * @param {HostedJob} job @param {WatchTick | null} first @param {PictureChange[]} changes @param {number | null} baseline
 */
function watchedView(job, first, changes, baseline) {
  const listed = [...changes].sort((a, b) => b.id - a.id).flatMap(change => { const picture = pictureOf(job, change, baseline); return picture ? [picture] : []; });
  const pictures = listed.slice(0, WATCH_PICTURES), more = listed.length - pictures.length;
  // 맡기기: a request left to ODDBOUT goes from its looks straight to the motions; the look it picked (his profile picture too) shows here.
  const look = job.status === 'motions' && job.delegate && job.choice ? job.candidates?.find(c => c.key === job.choice)?.url ?? null : null;
  const submission = job.status === 'submitted' ? job.submission?.stage ?? null : null;
  const changed = first === null ? [] : [...(first.status !== job.status ? ['status'] : []), ...(first.progress !== job.progress ? ['progress'] : []),
    ...(first.submission !== submission ? ['submission'] : []), ...(pictures.some(picture => picture.new) ? ['pictures'] : [])];
  const show = [...(pictures.length ? ['each picture in pictures'] : []), ...(look ? ['look (the front ODDBOUT picked, also his profile picture)'] : [])];
  return { ok: true, watch: true, statusSummary: hostedStatus(job),
    job: { id: job.id, status: job.status, progress: job.progress ?? null,
      ...(job.queue ? { queue: { position: job.queue.position, ...(job.queue.reason ? { reason: job.queue.reason } : {}) } } : {}),
      ...(job.submission ? { submission: { stage: job.submission.stage } } : {}) },
    changed, ...(pictures.length ? { pictures } : {}), ...(more > 0 ? { more } : {}), ...(look ? { look: { choice: job.choice, url: look } } : {}),
    ...(job.status === 'motions' ? { made: { drafts: (job.drafts ?? []).map(d => d.state ? `${d.clip} (${d.state})` : d.clip),
      side: Boolean(job.side?.url), expressions: Boolean(job.expressions?.url) } } : {}),
    siteUrl: jobSite(job),
    next: `Still working: tell the user what changed${show.length ? ` and show him ${show.join(' and ')} unless you already showed it (by kind, `
      + `clip and name; a url changes every read; ${IMAGES_NEXT})` : ''}, then while he watches call get_hosted_fighter again with waitSeconds 25. `
      + 'Without waitSeconds it returns the whole job: every picture\'s url, the profile draft and the full next.' };
}
/**
 * One job of the recent list, enough to tell them apart (MCP 최적화 2026-11-05: five whole jobs, their pictures' URLs mostly, were 16 KB).
 * @param {HostedJob} job
 */
const jobSummary = job => ({ id: job.id, status: job.status, progress: job.progress ?? null, error: job.error ?? null, description: job.description,
  name: job.profile?.name ?? null, createdAt: job.createdAt, updatedAt: job.updatedAt, tokens: job.tokens ?? null, submission: job.submission ?? null,
  agent: job.agent ?? null, statusSummary: hostedStatus(job), siteUrl: jobSite(job) });
const LIST_NEXT = 'Each request in short: read one by its jobId for its pictures, what it asks of the user and what to do next.';

/**
 * 그림 올리기 표 (2026-11-01, 사용자: "grok, gemini도 이미지 생성해서 붙일 수 있어야지"): where a ticket's pictures go in. The page is the
 * site's, for the signed-in owner (the ticket's id); the terminal route is the API's own address, not mcp.oddbout.com, whose gateway takes
 * 64 KB bodies (`worker/cloud-gateway.mjs`).
 */
export const PICTURE_PAGE = `${CREATOR_PAGE}#view=upload&ticket=`;
export { TICKET_UPLOAD_URL };
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
 * `uploads`: whether this address lists the upload tools (the full edition's do): next names them only there.
 * @param {{ register: Register, db: any, identity: Identity | null, invoke: Invoke, fetcher: typeof fetch, hosted: Hosted, uploads?: boolean }} options
 */
export function registerHostedTools({ register, db, identity, invoke, fetcher, hosted, uploads = true }) {
  const JOB = UUID_ARG();
  /** @param {any} result  The API's JSON. */
  const withNext = result => withNextOf(result, uploads);
  /** @param {string} jobId @param {any} result  The API's JSON. */
  const answered = async (jobId, result) => {
    if (result?.code !== 'generation-state') return withNext(result);
    const current = await invoke(`generations/${jobId}`).catch(() => null);
    if (!current?.ok || !current.job) return { ...result, next: ANSWER_LATER };
    return { ...withNext(current), ...result,
      next: 'The requested change was not applied. Do not claim it was saved or repeat it automatically. ' + hostedNext(current.job, { uploads }) };
  };
  /** @type {(path: string, body: object, headers?: Record<string, string>) => Promise<any>} */
  const post = (path, body, headers = {}) => invoke(path, 'POST', JSON.stringify(body), { 'content-type': 'application/json', ...headers });
  /**
   * What a tick sees of the job's picture events (Grok 점검 2026-11-03: the kinds api/generations.mjs shows — drafts, the side view, the
   * faces): `seen`, its newest of these kinds, and `picture`, its newest that carries a picture (0: none). Undefined when not readable.
   * @param {string} jobId @returns {Promise<{ seen: number, picture: number } | undefined>}
   */
  const newestPicture = async jobId => {
    const { data, error } = await db.from('af_generation_events').select('id,at,kind,data').eq('job_id', jobId).in('kind', PICTURE_EVENTS)
      .order('at', { ascending: false }).limit(TICK_EVENTS_READ);
    if (error) return undefined;
    const events = /** @type {JobEvent[]} */ (data ?? []);
    return { seen: Math.max(0, ...events.map(event => event.id)), picture: Math.max(0, ...events.filter(carriesPicture).map(event => event.id)) };
  };
  /**
   * The pictures added or changed since `since` (pictureChanges), from the picture events after it and the drafts list sent before them.
   * Undefined when not readable.
   * @param {string} jobId @param {string} since  an ISO time @returns {Promise<PictureChange[] | undefined>}
   */
  const recentPictures = async (jobId, since) => {
    const events = () => db.from('af_generation_events').select('id,at,kind,data').eq('job_id', jobId);
    const [recent, before] = await Promise.all([events().in('kind', PICTURE_EVENTS).gt('at', since).order('at', { ascending: false }).limit(WATCH_EVENTS_READ),
      events().eq('kind', 'drafts').lte('at', since).order('at', { ascending: false }).limit(1)]);
    if (recent.error || before.error) return undefined;
    return pictureChanges(/** @type {JobEvent[]} */ (recent.data ?? []), /** @type {JobEvent[]} */ (before.data ?? [])[0]);
  };
  /** @param {string} key */
  const jobIdForKey = async key => {
    const { data, error } = await db.from('af_generation_jobs').select('id').eq('owner_id', /** @type {Identity} */ (identity).owner).eq('idempotency_key', key.toLowerCase()).maybeSingle();
    if (error) throw unavailable('database-unavailable', error);
    return data?.id ?? null;
  };
  register('request_hosted_fighter', 'ODDBOUT에 선수 만들기 맡기기', 'ODDBOUT makes a fighter for the connected user on its own generation worker: '
    + 'two front-view looks to choose from (the chosen one is also his profile picture), then a side view drawn from it and the eleven '
    + 'motions, then registration under his account. New pairs default to A after ten minutes without a choice or revision; '
    + 'the job reports appearanceAutoSelectAt when this applies. Explain this before waiting for his choice. delegate: '
    + 'true when he leaves the choices to ODDBOUT ("알아서 해 줘", "just make it"): '
    + 'ODDBOUT picks the look itself (or offers the pair if it cannot pick) and continues through registration without motion approval. host: '
    + 'oddbout (default, ODDBOUT\'s own worker), mine (his own PC as a host: '
    + 'no consent to give, approval not needed), any (any approved community host) or a host id from list_generation_hosts; '
    + 'any or another person\'s host sends his words and pictures to that host\'s PC, so ask him first and pass hostConsent: '
    + 'true. imageProvider: who draws the pictures, grok (default) or gpt (refused with image-provider-unavailable where that host '
    + 'draws no GPT pictures now). Pass his words (what the fighter is and looks like) and, if he gave them, '
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
      picture: PICTURE.optional(), secondPicture: PICTURE.optional(), pictureUploads: z.array(UUID_ARG()).max(GENERATION_LIMITS.refs).optional(),
      rightsConfirmed: z.boolean().optional(), delegate: z.boolean().optional(),
      host: z.union([z.enum(['oddbout', 'any', 'mine']), UUID_ARG()]).optional(), hostConsent: z.boolean().optional(),
      imageProvider: z.enum(['grok', 'gpt']).optional(), idempotencyKey: UUID_ARG() },
    async ({ description, language, picture, secondPicture, pictureUploads = [], rightsConfirmed, delegate, host, hostConsent, imageProvider, idempotencyKey },
      { signal, deadline }) => {
      // Once saved, the same key returns its job without re-uploading pictures. Before that, use read-only recovery.
      const existingId = await jobIdForKey(idempotencyKey);
      if (existingId) return withNext(await invoke(`generations/${existingId}`));
      // A file of the shape but from no host ODDBOUT takes (an agent's own address with an id it holds), named before any check: the
      // service, the rights the user would be asked about, the request's checks. Its pictures go in through a ticket.
      const refused = /** @type {const} */ ([['picture', picture], ['secondPicture', secondPicture]]).filter(([, file]) => file
        && !allowedFileUrl(file.download_url, LIBRARY_FILE_HOSTS)).map(([field]) => field);
      if (refused.length) return { ok: false, code: 'unsupported-file-origin', fields: refused,
        next: `${refused.join(' and ')} ${refused.length > 1 ? 'take' : 'takes'} ${ATTACHED_ONLY}. Nothing was fetched or kept; `
          + 'start_picture_upload takes the host and hostConsent you will request.' };
      // Off (the service switch, the worker away or unwell) before any picture is kept. A failed read is the database's, not the switch's.
      const service = await invoke('generations/capabilities');
      if (!service.ok) return service;
      if (!service.capabilities?.hosted) return { ok: false, code: 'generation-unavailable', reason: service.capabilities?.reason ?? null };
      const pictures = /** @type {HostFile[]} */ ([picture, secondPicture].filter(Boolean));
      // Pictures already in (a ticket's) count with the attached ones: two in all, refused before an attached one moves.
      if (pictures.length + pictureUploads.length > GENERATION_LIMITS.refs) return { ok: false, code: 'invalid-refs' };
      if ((pictures.length || pictureUploads.length) && rightsConfirmed !== true) return { ok: false, code: 'rights-required' };
      const ask = { description, language, ...(delegate ? { delegate: true } : {}), ...(host && host !== 'oddbout' ? { host, hostConsent: hostConsent === true } : {}),
        ...(imageProvider ? { imageProvider } : {}) };
      // The request's own checks (consent, one at a time, the day's limits, the host) before a picture moves: each kept picture spends one
      // of the day's uploads and stays in storage (MCP 점검 2026-10-29). A request without pictures is checked where it is made.
      // The pictures already in are checked there too (his, unused, from the last day): a refusal keeps no attached picture.
      if (pictures.length) {
        const checked = await post('generations/check', { ...ask, ...(pictureUploads.length ? { refs: pictureUploads } : {}) });
        if (!checked.ok) return checked;
      }
      const refs = [...pictureUploads];
      for (const file of pictures) {
        // Each download within what is left of the call (two once took 40 seconds), and not past a client that went away.
        const bytes = await downloadHostFile(file, GENERATION_LIMITS.refBytes, fetcher, LIBRARY_FILE_HOSTS, within(signal, timeLeft(deadline, 20000)));
        const uploaded = await invoke('generations/uploads', 'POST', bytes, { 'content-type': 'application/octet-stream' });
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
          + `or too many calls came this minute: ${toolRef('get_picture_upload')} with no ticketId lists the tickets to reuse; else wait.` } : made;
      }
      const { secret, ...ticket } = made.ticket;
      return { ok: true, ticket, page: `${PICTURE_PAGE}${ticket.id}`,
        ...(secret ? { command: `curl -sS -H "${UPLOAD_TICKET_HEADER}: ${secret}" --data-binary "@<file>" ${TICKET_UPLOAD_URL}` } : {}),
        next: `Give the user the page link (PNG, JPEG or WebP, up to 4 MB, 64 to 4096 pixels a side; a picture made in this chat: the user saves it `
          + `first, then adds it there)${secret ? ', or run the command with the file '
          + `(one with no answer or a 5xx: ${toolRef('get_picture_upload')} before running it again)` : ''}. When he says the pictures are in, ${toolRef('get_picture_upload')} with ticket.id.` };
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
    + `the two front-view looks, the side view drawn from the chosen one (side), his six arena faces (expressions: 3 × 2, the last his KO face) `
    + `or the motion previews as fresh image URLs (ten minutes), `
    + `the profile draft, the profile set made at registration (profileSetId) and next. `
    + `Supply either jobId or the original request's idempotencyKey, never both. `
    + `Key lookup only reads an existing job under this account, even when new generation is disabled; `
    + `not-found does not prove that an interrupted request never started. With neither identifier: `
    + `his latest five requests and whether hosted generation is open. Read the same job again if a preview URL expired; `
    + `do not regenerate. waitSeconds (up to ${HOSTED_WAIT_SECONDS}) is a bounded wait, not a completion guarantee: it returns early when the `
    + `state, the progress or a picture changes; if still working, read this job again.`,
    { jobId: JOB.optional(), idempotencyKey: UUID_ARG().optional(), waitSeconds: z.number().int().min(0).max(HOSTED_WAIT_SECONDS).optional() }, async ({ jobId, idempotencyKey, waitSeconds = 0 }, { signal, deadline: due }) => {
      if (jobId && idempotencyKey) return { ok: false, code: 'invalid-selector' };
      if (idempotencyKey) {
        jobId = await jobIdForKey(idempotencyKey);
        if (!jobId) return { ok: false, code: 'not-found', next: 'No saved job was found for this key in the connected account. The original request may still be running. '
          + 'Check the account and original call; do not submit again to recover it.' };
      }
      if (!jobId) {
        const list = await invoke('generations');
        return list.ok ? { ...list, jobs: list.jobs.map(jobSummary), next: LIST_NEXT } : list;
      }
      // Wait on what the user sees without the signed URLs (the state, the progress and the newest picture event), then read the job once:
      // the wait leaves the call's last seconds to that read, and stops when the client went away or anything of it changed.
      const started = Date.now(), deadline = Math.min(started + waitSeconds * 1000, due - HOSTED_READ_MS), pollMs = hosted.pollMs ?? HOSTED_POLL_MS;
      // The first tick (what changed while this call waited is told against it) and the newest picture event it saw (`baseline`: what came
      // after it came during this wait).
      /** @type {WatchTick | null} */
      let first = null;
      /** @type {number | null} */
      let baseline = null;
      let picture = 0;
      while (Date.now() + pollMs <= deadline && !signal.aborted) {
        // The job and its submission's state in one query (MCP 점검 2026-11-03: two per tick).
        const { data: row, error } = await db.from('af_generation_jobs').select('status,progress,submission:af_submissions!submission_id(status)')
          .eq('id', jobId).eq('owner_id', /** @type {Identity} */ (identity).owner).maybeSingle();
        if (error || !row) break;
        const submission = row.status === 'submitted' ? row.submission?.status ?? null : null;
        if (hostedSettled(row.status, submission)) break;
        // While the motions are made, a picture the worker sends (a draft, the side view, his faces) is an event of the job; the first tick
        // also notes the newest there is, whatever the state (a request left to ODDBOUT goes from its looks to the motions in one wait).
        const events = row.status === 'motions' || first === null ? await newestPicture(jobId) : null;
        if (events === undefined) break;
        picture = Math.max(picture, events?.picture ?? 0);
        /** @type {WatchTick} */
        const tick = { status: row.status, progress: row.progress, submission, picture: row.status === 'motions' ? picture : null };
        if (first === null) { first = tick; baseline = events?.seen ?? 0; }
        else if (JSON.stringify(tick) !== JSON.stringify(first)) break;
        await pause(pollMs, signal);
      }
      const read = withNext(await invoke(`generations/${jobId}`));
      if (!(waitSeconds > 0 && read.ok && onlyWatched(read.job))) return read;
      // While the motions are made, every picture added or changed since shortly before this wait, each with its URL from the read just made.
      const changes = read.job.status === 'motions' ? await recentPictures(jobId, new Date(started - WATCH_LOOKBACK_MS).toISOString()) : [];
      return changes === undefined ? read : watchedView(read.job, first, changes, baseline);
    });
  register('choose_hosted_look', '외형 고르기', 'Answer the two front-view looks of the connected user\'s hosted fighter with his words: '
    + 'choose a or b (it is also his profile picture; ODDBOUT then draws it from the side and makes the motions from that), '
    + 'or revise with one sentence (both looks are painted again). '
    + 'Requires the user\'s answer. Advances or replaces the working look; ODDBOUT-worker generation spends tokens that are not refunded. Revisions are not idempotent: '
    + 'after an unknown outcome, read get_hosted_fighter instead of repeating this call.',
    { jobId: JOB, choose: z.enum(['a', 'b']).optional(), revise: z.string().min(2).max(GENERATION_LIMITS.note).optional() },
    ({ jobId, choose, revise }) => (choose === undefined) === (revise === undefined) ? { ok: false, code: 'invalid-answer' }
      : post(`generations/${jobId}/appearance`, choose !== undefined ? { choose } : { revise }).then(result => answered(jobId, result)), { write: true, publish: true, idempotent: false });
  register('revise_hosted_motion', '동작 하나 고치기', 'Ask ODDBOUT to make one motion of the connected user\'s hosted fighter again with his sentence; the other motions stay. '
    + 'Available only for a legacy job currently at motion_ready. Newly completed motions register automatically; this tool cannot edit a submitted package. '
    + 'Not idle: the standing pose is the look itself. Requires the user\'s request. Replaces the working motion; ODDBOUT-worker generation spends tokens that are not refunded. Not idempotent: '
    + 'after an unknown outcome, read get_hosted_fighter instead of repeating this call.',
    // Not idle: it is the look itself (choose_hosted_look changes the look, before the motions).
    { jobId: JOB, clip: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(spec.motions).filter(clip => clip !== 'idle'))), note: z.string().min(2).max(GENERATION_LIMITS.note) },
    ({ jobId, clip, note }) => post(`generations/${jobId}/motions`, { revise: { clip, note } }).then(result => answered(jobId, result)), { write: true, publish: true, idempotent: false });
  register('register_hosted_fighter', '맡긴 선수 등록', 'Register a legacy hosted fighter still waiting at motion_ready; no motion approval is required: '
    + 'ODDBOUT packages it and submits it under his account, through the same server check as any fighter. '
    + 'profile holds only what he changed in the draft (name, description, names, bout lines, stats summing to 9). '
    + 'The user\'s hosted creation request includes registration into production. Never enter it for him; entry is on the site.',
    { jobId: JOB, profile: z.object({ name: z.string().min(1).max(profileLimits.name), description: z.string().min(1).max(profileLimits.description),
      names: z.record(z.string(), z.string()), lines: z.record(z.string(), z.string()),
      stats: z.object({ power: z.number().int(), toughness: z.number().int(), speed: z.number().int() }).strict() }).partial().strict().optional() },
    async ({ jobId, profile = {} }) => {
      /** A racing/repeated request must not silently discard a different requested profile.
       * @param {any} current */
      const recovered = current => {
        if (Object.keys(profile).length) {
          const draft = Object.fromEntries(PROFILE_KEYS.filter(key => current.job.profile?.[key] != null).map(key => [key, current.job.profile[key]]));
          const desired = { ...draft, ...profile };
          for (const key of /** @type {const} */ (['names', 'lines'])) if (profile[key] && draft[key]) desired[key] = { ...draft[key], ...profile[key] };
          let same = false;
          try { same = JSON.stringify(confirmedProfile(draft)) === JSON.stringify(confirmedProfile(desired)); } catch { /* unverified edit */ }
          if (!same) return { ...withNext(current), ok: false, code: 'registration-profile-locked',
            next: 'Registration already started. These profile changes were not applied. Do not claim they were saved; keep the existing package and use its siteUrl.' };
        }
        return withNext(current);
      };
      const read = await invoke(`generations/${jobId}`);
      if (!read.ok) return read;
      // An interrupted registration response is recovered by reading, never by submitting the package again.
      if (['submitting', 'submitted'].includes(read.job.status)) return recovered(read);
      // The draft the worker wrote, with his changes over it; the API checks the result against the contract.
      const draft = read.job.profile ?? {}, merged = { ...draft, ...profile };
      for (const key of /** @type {const} */ (['names', 'lines'])) if (profile[key] && draft[key]) merged[key] = { ...draft[key], ...profile[key] };
      const confirmed = Object.fromEntries(PROFILE_KEYS.filter(key => merged[key] != null).map(key => [key, merged[key]]));
      const result = await post(`generations/${jobId}/register`, { profile: confirmed });
      if (!result.ok) {
        // Another caller may have won after our read, or the successful response may have been lost.
        // Read once; no second POST and no fallback to a different job/account.
        const current = await invoke(`generations/${jobId}`);
        if (current.ok && ['submitting', 'submitted'].includes(current.job.status)) return recovered(current);
      }
      return withNext(result);
    }, { write: true, publish: true, openWorld: true, idempotent: true });
  register('cancel_hosted_fighter', '맡긴 선수 취소', 'Cancel the connected user\'s hosted fighter request; '
    + 'work in progress stops at its next step. Tokens it already spent stay spent. Only on his explicit request.',
    { jobId: JOB }, async ({ jobId }) => withNext(await invoke(`generations/${jobId}`, 'DELETE')), { write: true, publish: true, idempotent: true });
}
