// @ts-check
// In-memory ODDBOUT stand-in. No network, no tokens, no production roster.
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import spec from '../../contracts/ai-fighter/v1/spec.json' with { type: 'json' };
import schema from '../../contracts/ai-fighter/v1/fighter.schema.json' with { type: 'json' };
import { parseFighterJson, validateFighter } from '../../contracts/ai-fighter/validate.mjs';
import { entryRequest } from '../../api/fighter-entry.mjs';
import { parseProfileSet } from '../../api/profile-set-contract.mjs';
import { stamp } from './seal.mjs';

const MOTIONS = Object.keys(spec.motions);
const NOW = '2026-11-10T00:00:00.000Z';
const AUTO = '2026-11-10T00:10:00.000Z';
const ACCOUNT = { id: '00000000-0000-4000-8000-00000000d0a1', email: 'dummy-owner@oddbout.invalid', nickname: 'ODDBOUT' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUMMONS = ['crane', 'bolt', 'sportsCar', 'roadster'];
const SUPERS = ['slam', 'combo', 'fast', 'dash'];
const SPECIALS = ['slam', 'combo', 'fast'];
const TEMPERS = ['guard', 'retreat', 'measure', 'patience'];
const checkStyle = new Ajv({ allErrors: true, ownProperties: true }).compile(schema.properties.combat.properties.style);

const sha256 = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @param {number} status
 * @param {Record<string, unknown>} body
 * @returns {{ status: number, body: Record<string, any> }}
 */
function reply(status, body) {
  return { status, body: stamp({ ok: status < 400, ...body }) };
}

/** @param {{ fighterLimit?: number, tokenBalance?: number, policy?: 'happy' | 'reject-review' | 'legacy-motion', seed?: boolean }} [options] */
export function createDummyStore({ fighterLimit = 3, tokenBalance = 500_000, policy = 'happy', seed = false } = {}) {
  let limit = fighterLimit;
  let tokens = tokenBalance;
  let sequence = 1;
  /** @type {string | null} */
  let pageBase = null;
  /** @type {{ text: string, sha: string, files: Map<string, Buffer> } | null} */
  let placeholder = null;
  /** @type {Map<string, any>} */
  const submissions = new Map();
  /** @type {Map<string, any>} */
  const fighters = new Map();
  /** @type {Map<string, any>} */
  const jobs = new Map();
  /** @type {Map<string, any>} */
  const sets = new Map();
  /** @type {Map<string, { sha: string, submissionId: string }>} */
  const submissionKeys = new Map();
  /** @type {Map<string, string>} */
  const jobKeys = new Map();
  /** @type {Map<string, { sha: string, fighterId: string, profileSetId: string }>} */
  const setKeys = new Map();
  /** @type {Map<string, { fighterId: string, text: string, result: any }>} */
  const styleKeys = new Map();
  /** @type {any[]} */
  const notifications = [];
  let delivered = 0;

  const nextId = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
  const page = (/** @type {string} */ kind, /** @type {string} */ id) => (pageBase ? `${pageBase}/dummy/page/${kind}/${id}` : null);
  /** @param {string} kind @param {Record<string, unknown>} detail */
  const notify = (kind, detail) => {
    const item = stamp({ id: nextId(), at: NOW, kind, ...detail });
    notifications.push(item);
    return item;
  };

  if (seed) {
    const id = nextId();
    fighters.set(id, {
      id,
      name: 'DUMMY Seed',
      localId: 'dummy-seed',
      manifestSha256: null,
      submissionIds: [],
      entered: false,
      front: null,
      style: null,
      createdAt: NOW,
    });
  }

  const account = () => ({
    id: ACCOUNT.id,
    email: ACCOUNT.email,
    fighterCount: fighters.size,
    fighterLimit: limit,
  });

  /** @param {any} row */
  function submissionBody(row) {
    const assets = row.manifest.assets.map((/** @type {any} */ asset) => ({ id: asset.id, path: asset.path, bytes: asset.bytes, sha256: asset.sha256 }));
    const missingAssets = assets.filter((/** @type {any} */ asset) => !row.assets.has(asset.id));
    const pending =
      row.stage === 'uploading'
        ? ['server-validation', 'registration']
        : row.stage === 'validating'
          ? [row.code === 'fighter-quota' ? 'registration' : 'server-validation']
          : [];
    return {
      submissionId: row.id,
      stage: row.stage,
      fighterId: row.stage === 'registered' ? row.fighterId : row.targetFighterId,
      manifestSha256: row.sha,
      pending,
      pendingStages: pending,
      assetUploadState: 'confirmed',
      missingAssets,
      assets,
      ...(row.code ? { code: row.code } : {}),
      ...(row.reason ? { reason: row.reason } : {}),
      ...(row.rejection ? { rejection: row.rejection } : {}),
      dummyPage: page('submission', row.id),
      ...(row.stage === 'uploading'
        ? { next: 'pending and pendingStages are pipeline stage names, never asset ids. Upload each missingAssets entry, then submit.' }
        : {}),
    };
  }

  /** @param {any} row @param {string} sha */
  function finishRegistration(row, sha) {
    // Admission does not reserve a fighter slot. Another completed job can fill it
    // before this submission finishes; retain the uploaded package for a retry.
    if (!row.targetFighterId && fighters.size >= limit) {
      if (row.code !== 'fighter-quota') row.event = notify('fighter-quota', { submissionId: row.id, ...account() });
      row.code = 'fighter-quota';
      row.reason = 'The fighter limit is full. The dummy package is preserved for registration retry.';
      return;
    }
    if (policy === 'reject-review') {
      row.stage = 'rejected';
      row.code = 'review-rejected';
      row.rejection = 'review';
      row.reason = 'Dummy operator rejected this labelled package. No live review happened.';
      row.event = notify('submission-rejected', { submissionId: row.id, code: row.code, reason: row.reason });
      return;
    }
    let fighterId = row.targetFighterId;
    if (!fighterId) {
      fighterId = nextId();
      fighters.set(fighterId, {
        id: fighterId,
        name: row.manifest.profile.name,
        localId: row.manifest.localId,
        manifestSha256: sha,
        submissionIds: [],
        entered: false,
        front: null,
        style: row.manifest.combat?.style ?? null,
        createdAt: NOW,
      });
    }
    const fighter = fighters.get(fighterId);
    fighter.name = row.manifest.profile.name;
    fighter.localId = row.manifest.localId;
    fighter.manifestSha256 = sha;
    fighter.entered = false;
    fighter.hasSkill = Boolean(row.manifest.clips.skill);
    fighter.submissionIds = [...fighter.submissionIds, row.id];
    fighter.style = row.manifest.combat?.style ?? null;
    row.fighterId = fighterId;
    row.stage = 'registered';
    row.code = undefined;
    row.reason = undefined;
    row.event = notify('submission-registered', { submissionId: row.id, fighterId, manifestSha256: sha });
  }

  /** @param {any} job */
  function statusSummary(job) {
    const registered = job.status === 'submitted' && job.submissionStage === 'registered';
    const failed = job.status === 'rejected' || job.submissionStage === 'rejected';
    const state = registered
      ? 'registered'
      : failed
        ? 'stopped'
        : job.status === 'needs_review'
          ? 'needs_review'
          : job.status === 'appearance_ready'
            ? 'choose_look'
            : job.status === 'motion_ready'
              ? 'registration_pending'
              : job.status === 'motions'
                ? 'motions'
                : job.status === 'submitted'
                  ? 'validating'
                  : 'unknown';
    return {
      state,
      completed: registered,
      terminal: registered || failed,
      actionRequired: registered
        ? 'enter_on_site'
        : job.status === 'needs_review'
          ? 'retry_registration'
          : job.status === 'appearance_ready'
            ? 'choose_look'
            : job.status === 'motion_ready'
              ? 'register_or_revise'
              : job.status === 'motions'
                ? 'wait'
                : 'none',
      stageProgress: job.status === 'motions' ? { done: job.drafts.length, of: MOTIONS.length } : null,
      note: 'stageProgress is this stage only. completed is true only when the dummy submission is registered.',
    };
  }

  /** @param {any} job */
  function jobBody(job, extra = {}) {
    return {
      job: {
        id: job.id,
        status: job.status,
        description: job.description,
        language: job.language,
        delegate: job.delegate,
        choice: job.choice,
        candidates: job.candidates,
        drafts: job.drafts,
        revisionsLeft: job.revisionsLeft,
        motionNote: job.motionNote,
        errorCode: job.errorCode,
        registrationBlocked: job.registrationBlocked,
        appearanceAutoSelectAt: job.status === 'appearance_ready' ? AUTO : null,
        appearanceAutoSelection: null,
        tokens: 0,
        tokensCharged: false,
        submission: job.submissionId ? { id: job.submissionId, stage: job.submissionStage, fighterId: job.fighterId } : null,
        artChanged: false,
        dummyPage: page('job', job.id),
      },
      statusSummary: statusSummary(job),
      tokens,
      tokensCharged: false,
      ...extra,
    };
  }

  /** @param {any} job */
  function registerHostedJob(job) {
    if (!placeholder) return reply(409, { code: 'dummy-placeholder-missing', next: 'The dummy worker has no placeholder package.' });
    // Match the hosted registration admission failure: completed art survives,
    // but no submission exists until a slot is available. Retrying never draws.
    if (fighters.size >= limit) {
      const event = job.registrationBlocked ? null : notify('hosted-registration-blocked', { jobId: job.id, code: 'fighter-quota' });
      job.status = 'needs_review';
      job.errorCode = 'fighter-quota';
      job.registrationBlocked = true;
      return reply(409, {
        code: 'fighter-quota',
        account: account(),
        ...jobBody(job, event ? { event } : {}),
        next: 'Completed dummy motions are preserved. After capacity is restored, retry submit kind hosted with this same jobId; do not request a new generation.',
      });
    }
    const parsed = parseFighterJson(placeholder.text);
    if (!parsed.ok) return reply(422, { code: 'invalid-manifest' });
    const row = {
      id: nextId(),
      targetFighterId: null,
      fighterId: null,
      sha: placeholder.sha,
      manifest: parsed.data,
      assets: new Map(placeholder.files),
      stage: 'validating',
      code: undefined,
      reason: undefined,
      rejection: undefined,
      event: null,
    };
    submissions.set(row.id, row);
    finishRegistration(row, placeholder.sha);
    job.submissionId = row.id;
    job.submissionStage = row.stage;
    job.fighterId = row.fighterId;
    job.status = 'submitted';
    job.errorCode = null;
    job.registrationBlocked = false;
    return reply(200, {
      ...jobBody(job, { event: row.event }),
      next:
        row.stage === 'registered'
          ? 'Registered on the dummy server only. The owner would enter on the site; this dummy does not put the fighter in public play.'
          : 'The dummy submission was rejected. No fighter was registered.',
    });
  }

  return {
    motions: MOTIONS,
    setPageBase(/** @type {string} */ base) {
      pageBase = base;
    },
    setFighterLimit(/** @type {number} */ value) {
      limit = value;
    },
    setTokenBalance(/** @type {number} */ value) {
      tokens = value;
    },
    /**
     * @param {{ text: string, files: Map<string, Buffer> }} pack
     */
    setPlaceholder(pack) {
      const parsed = parseFighterJson(pack.text);
      if (!parsed.ok) throw new Error('dummy-placeholder-invalid');
      for (const asset of parsed.data.assets) {
        const bytes = pack.files.get(asset.id);
        if (!bytes || bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`dummy-placeholder-asset:${asset.id}`);
      }
      placeholder = { text: pack.text, sha: sha256(Buffer.from(pack.text)), files: pack.files };
    },
    health() {
      return reply(200, { ok: true, ready: true, acceptsLiveSubmission: false });
    },
    profile() {
      return reply(200, { id: ACCOUNT.id, email: ACCOUNT.email, nickname: ACCOUNT.nickname });
    },
    /** @param {string} purpose */
    readiness(purpose) {
      return reply(200, {
        purpose,
        scope: 'dummy-registration',
        account: { ...account(), nickname: ACCOUNT.nickname },
        registration: { status: 'ready', requiresPc: false, auth: 'dummy-no-oauth' },
        generation: { status: 'dummy-placeholder', reason: 'no-model-called' },
        hosted: { tool: 'request_hosted_fighter', tokensCharged: false, note: 'Dummy worker. Requests are not charged.' },
        delivery: { status: 'dummy-local', reason: 'results are returned on the tool result and the notification list' },
        nextCommands: [],
      });
    },
    /** @param {string} section */
    spec(section) {
      if (section === 'schema')
        return reply(200, { section, note: 'Read contracts/ai-fighter/v1/fighter.schema.json in the repository. This dummy does not echo the live schema.' });
      if (section === 'creation') {
        return reply(200, {
          section,
          steps: [
            'get_profile',
            'get_my_fighters view readiness',
            'placeholder sprites and local validate',
            'prepare_fighter_registration kind package',
            'upload_fighter_asset for each missingAssets id (pending is not an asset id)',
            'submit_fighter_registration kind package',
            'get_my_fighters view submission',
            'profile set after registration',
          ],
          hosted: 'request_hosted_fighter then follow statusSummary. One motion is added per get_hosted_fighter. Tokens are not spent.',
          files: 'Pass absolute paths inside this connector’s roots. URLs are refused.',
        });
      }
      return reply(200, {
        section: 'overview',
        data: {
          specVersion: spec.specVersion,
          motions: MOTIONS,
          registration: { auth: 'dummy-no-oauth', assetUpload: 'dummy-local-path', requiresPc: false },
          note: 'Dummy summary of the repository contract. Not a live spec response.',
        },
      });
    },
    styleGuide() {
      return reply(200, {
        view: 'style_guide',
        source: 'repository-summary',
        rules: {
          super: SUPERS,
          special: SPECIALS,
          temper: TEMPERS,
          summon: SUMMONS,
          extrasBudget: 2,
          mix: 'fast ≤ slam + combo, and one of slam, combo, fast is above 0',
          skillKinds: ['stretch', 'pincer', 'flight', 'feint', 'slide', 'counter', 'brace'],
        },
      });
    },
    listFighters() {
      const quota = { exceeded: fighters.size >= limit, fighterCount: fighters.size, fighterLimit: limit };
      const fresh = notifications.slice(delivered);
      delivered = notifications.length;
      return reply(200, {
        account: account(),
        quota,
        fighters: [...fighters.values()].map(publicFighter),
        notifications: fresh,
        notificationsDelivered: fresh.length,
      });
    },
    /** @param {string} fighterId */
    fighter(fighterId) {
      const row = fighters.get(fighterId);
      if (!row) return reply(404, { code: 'fighter-not-found' });
      return reply(200, { fighter: publicFighter(row), dummyPage: page('fighter', fighterId) });
    },
    /** @param {string} submissionId */
    getSubmission(submissionId) {
      const row = submissions.get(submissionId);
      if (!row) return reply(404, { code: 'not-found' });
      if (row.stage === 'validating') finishRegistration(row, row.sha);
      return reply(200, { ...submissionBody(row), ...(row.event ? { event: row.event } : {}) });
    },
    /**
     * @param {{ text: string, fighterId?: string | null, idempotencyKey: string }} input
     */
    createSubmission(input) {
      if (!UUID.test(input.idempotencyKey)) return reply(400, { code: 'invalid-id' });
      const key = input.idempotencyKey.toLowerCase();
      const target = input.fighterId ? input.fighterId.toLowerCase() : null;
      if (target && !UUID.test(target)) return reply(400, { code: 'invalid-id' });
      const parsed = parseFighterJson(input.text);
      const checked = parsed.ok ? validateFighter(parsed.data) : parsed;
      if (!parsed.ok || !checked.ok) return reply(422, { code: 'invalid-manifest', errors: (checked.errors ?? []).slice(0, 10) });
      const sha = sha256(Buffer.from(input.text));
      if (styleKeys.has(key)) return reply(409, { code: 'idempotency-conflict' });
      const prior = submissionKeys.get(key);
      if (prior && (prior.sha !== sha || submissions.get(prior.submissionId).targetFighterId !== target)) return reply(409, { code: 'idempotency-conflict' });
      if (prior) return reply(200, submissionBody(submissions.get(prior.submissionId)));
      if (target && !fighters.has(target)) return reply(404, { code: 'fighter-not-found' });
      if (!target && fighters.size >= limit) {
        notify('fighter-quota', { fighterCount: fighters.size, fighterLimit: limit });
        return reply(409, { code: 'fighter-quota', account: account() });
      }
      if (target && fighters.get(target).manifestSha256 === sha) return reply(409, { code: 'fighter-unchanged' });
      const row = {
        id: nextId(),
        targetFighterId: target,
        fighterId: null,
        sha,
        manifest: parsed.data,
        assets: new Map(),
        stage: 'uploading',
        code: undefined,
        reason: undefined,
        rejection: undefined,
        event: null,
      };
      submissions.set(row.id, row);
      submissionKeys.set(key, { sha, submissionId: row.id });
      return reply(200, submissionBody(row));
    },
    /** @param {string} submissionId @param {string} assetId @param {Buffer} bytes */
    putAsset(submissionId, assetId, bytes) {
      const row = submissions.get(submissionId);
      if (!row) return reply(404, { code: 'not-found' });
      if (row.stage !== 'uploading') return reply(409, { code: 'upload-closed' });
      const asset = row.manifest.assets.find((/** @type {any} */ item) => item.id === assetId);
      if (!asset) return reply(404, { code: 'asset-not-found' });
      if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')
        return reply(422, { code: 'webp-required' });
      if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) return reply(422, { code: 'asset-hash-or-size' });
      row.assets.set(assetId, Buffer.from(bytes));
      return reply(200, { stage: 'uploaded', assetId, bytes: bytes.length });
    },
    /** @param {string} submissionId */
    submit(submissionId) {
      const row = submissions.get(submissionId);
      if (!row) return reply(404, { code: 'not-found' });
      if (row.stage === 'registered' || row.stage === 'rejected') return reply(200, submissionBody(row));
      const missing = row.manifest.assets.filter((/** @type {any} */ asset) => !row.assets.has(asset.id));
      if (missing.length) {
        notify('assets-incomplete', { submissionId, missingAssets: missing.map((/** @type {any} */ asset) => asset.id) });
        return reply(409, { code: 'assets-incomplete', ...submissionBody(row) });
      }
      if (row.stage === 'uploading') row.stage = 'validating';
      return reply(200, submissionBody(row));
    },
    /** @param {string} fighterId @param {any} style @param {string} idempotencyKey */
    updateStyle(fighterId, style, idempotencyKey) {
      if (!UUID.test(idempotencyKey)) return reply(400, { code: 'invalid-id' });
      const key = idempotencyKey.toLowerCase();
      const text = JSON.stringify(style);
      const prior = styleKeys.get(key);
      if (submissionKeys.has(key) || (prior && (prior.fighterId !== fighterId || prior.text !== text))) return reply(409, { code: 'idempotency-conflict' });
      if (prior) return prior.result;
      const row = fighters.get(fighterId);
      if (!row) return reply(404, { code: 'fighter-not-found' });
      const code = styleError(style, Boolean(row.hasSkill));
      if (code) return reply(422, { code });
      row.style = style;
      const event = notify('style-updated', { fighterId });
      const result = reply(200, { fighterId, style, artChanged: false, event });
      styleKeys.set(key, { fighterId, text, result });
      return result;
    },
    /**
     * @param {{ description: string, language: string, idempotencyKey: string, delegate?: boolean }} input
     */
    requestHosted(input) {
      if (!UUID.test(input.idempotencyKey)) return reply(400, { code: 'invalid-id' });
      if (typeof input.description !== 'string' || input.description.length < 4 || input.description.length > 600)
        return reply(422, { code: 'invalid-description' });
      if (input.language !== 'ko' && input.language !== 'en') return reply(422, { code: 'invalid-language' });
      const key = input.idempotencyKey.toLowerCase();
      const existing = jobKeys.get(key);
      if (existing) return reply(200, jobBody(jobs.get(existing)));
      if (fighters.size >= limit) {
        notify('fighter-quota', account());
        return reply(409, { code: 'fighter-quota', account: account(), tokensCharged: false });
      }
      if (tokens <= 0) {
        notify('generation-quota', { tokens });
        return reply(409, { code: 'generation-quota', tokens, tokensCharged: false });
      }
      const id = nextId();
      const job = {
        id,
        description: input.description,
        language: input.language,
        delegate: input.delegate === true,
        choice: input.delegate === true ? 'a' : null,
        candidates: [
          { id: 'a', label: 'DUMMY look A', media: 'placeholder', note: 'Not an image from a model.' },
          { id: 'b', label: 'DUMMY look B', media: 'placeholder', note: 'Not an image from a model.' },
        ],
        drafts: /** @type {string[]} */ ([]),
        revisionsLeft: { appearance: 1, motion: 1 },
        motionNote: null,
        status: input.delegate === true ? (policy === 'legacy-motion' ? 'motion_ready' : 'motions') : 'appearance_ready',
        submissionId: null,
        submissionStage: null,
        fighterId: null,
        errorCode: null,
        registrationBlocked: false,
      };
      jobs.set(id, job);
      jobKeys.set(key, id);
      const event =
        input.delegate === true
          ? notify('hosted-look-chosen', { jobId: id, choice: job.choice, delegated: true, status: job.status })
          : notify('hosted-appearance-ready', { jobId: id });
      return reply(200, {
        ...jobBody(job, { event }),
        next:
          input.delegate === true
            ? job.status === 'motion_ready'
              ? 'Delegated DUMMY look A was selected. Legacy dummy job: submit kind hosted continues registration.'
              : 'Delegated DUMMY look A was selected. Read get_hosted_fighter to complete the placeholder motions and registration.'
            : 'Show both DUMMY looks and call request_hosted_fighter step choose_look. appearanceAutoSelectAt is informational only in this dummy.',
      });
    },
    /** @param {string} jobId @param {string} choice */
    chooseLook(jobId, choice) {
      const job = jobs.get(jobId);
      if (!job) return reply(404, { code: 'not-found' });
      if (job.status !== 'appearance_ready')
        return reply(409, { code: 'generation-state', job: jobBody(job).job, next: 'The choice was not applied. Read get_hosted_fighter.' });
      if (choice !== 'a' && choice !== 'b') return reply(422, { code: 'invalid-choice' });
      job.choice = choice;
      job.status = policy === 'legacy-motion' ? 'motion_ready' : 'motions';
      const event = notify('hosted-look-chosen', { jobId, choice, status: job.status });
      return reply(200, {
        ...jobBody(job, { event }),
        next:
          job.status === 'motion_ready'
            ? 'Legacy dummy job. revise_motion is accepted, then submit kind hosted.'
            : 'Read get_hosted_fighter. Each read adds one placeholder motion. No pixels are drawn.',
      });
    },
    /** @param {string} jobId @param {string} motion @param {string} note */
    reviseMotion(jobId, motion, note) {
      const job = jobs.get(jobId);
      if (!job) return reply(404, { code: 'not-found' });
      if (job.status !== 'motion_ready' || job.revisionsLeft.motion < 1) {
        return reply(409, {
          code: 'generation-state',
          applied: false,
          artChanged: false,
          next: 'revise_motion applies only to a legacy job at motion_ready. A registered fighter needs a new package and fighterId.',
        });
      }
      if (motion === 'idle' || !MOTIONS.includes(motion) || typeof note !== 'string' || note.length < 2 || note.length > 200)
        return reply(422, { code: 'invalid-motion' });
      job.revisionsLeft.motion -= 1;
      job.motionNote = { motion, note };
      const event = notify('hosted-motion-note', { jobId, motion });
      return reply(200, {
        ...jobBody(job, { event }),
        applied: true,
        artChanged: false,
        next: 'The note is recorded. Placeholder art did not change. submit kind hosted continues registration.',
      });
    },
    /** @param {{ jobId?: string, idempotencyKey?: string }} input */
    getHosted(input) {
      if (!input.jobId && !input.idempotencyKey) {
        return reply(200, {
          tokens,
          tokensCharged: false,
          jobs: [...jobs.values()].map(job => ({ id: job.id, status: job.status, statusSummary: statusSummary(job) })),
        });
      }
      const job = input.jobId ? jobs.get(input.jobId) : jobs.get(jobKeys.get(input.idempotencyKey?.toLowerCase() ?? '') ?? '');
      if (!job) return reply(404, { code: 'not-found' });
      if (job.status === 'motions' && job.drafts.length < MOTIONS.length) {
        job.drafts = [...job.drafts, MOTIONS[job.drafts.length]];
        const event = notify('hosted-motion-draft', { jobId: job.id, motion: job.drafts.at(-1), done: job.drafts.length, of: MOTIONS.length });
        return reply(200, {
          ...jobBody(job, { event, waitedMs: 0 }),
          next: 'Dummy advanced one motion for this read and did not sleep. Stage progress is not registration.',
        });
      }
      if (job.status === 'motions' && job.drafts.length === MOTIONS.length) {
        const registered = registerHostedJob(job);
        return { status: registered.status, body: { ...registered.body, waitedMs: 0 } };
      }
      return reply(200, { ...jobBody(job, { waitedMs: 0 }) });
    },
    /** @param {string} jobId */
    registerHosted(jobId) {
      const job = jobs.get(jobId);
      if (!job) return reply(404, { code: 'not-found' });
      if (job.status === 'submitted' && job.submissionStage === 'registered') return reply(200, jobBody(job));
      if (
        job.status !== 'motion_ready' &&
        !(job.status === 'motions' && job.drafts.length === MOTIONS.length) &&
        !(job.status === 'needs_review' && job.registrationBlocked)
      ) {
        return reply(409, { code: 'generation-state', next: 'Hosted registration is not waiting for this job.' });
      }
      return registerHostedJob(job);
    },
    /** @param {string} fighterId @param {string} text @param {string} idempotencyKey */
    prepareProfileSet(fighterId, text, idempotencyKey) {
      if (!UUID.test(idempotencyKey)) return reply(400, { code: 'invalid-id' });
      const fighter = fighters.get(fighterId);
      if (!fighter) return reply(404, { code: 'fighter-not-found' });
      const parsed = parseProfileSet(text);
      if (!parsed.ok) return reply(422, { code: 'invalid-profile-set', errors: parsed.errors?.slice?.(0, 10) ?? parsed.errors });
      const key = idempotencyKey.toLowerCase();
      const sha = sha256(Buffer.from(text));
      const prior = setKeys.get(key);
      if (prior && (prior.sha !== sha || prior.fighterId !== fighterId)) return reply(409, { code: 'idempotency-conflict' });
      if (prior) return reply(200, profileSetBody(sets.get(prior.profileSetId)));
      const id = nextId();
      const files = new Map();
      sets.set(id, { id, fighterId, set: parsed.data, files, stage: 'uploading' });
      setKeys.set(key, { sha, fighterId, profileSetId: id });
      return reply(200, profileSetBody(sets.get(id)));
    },
    /** @param {string} setId @param {string} assetId @param {Buffer} bytes */
    uploadProfileAsset(setId, assetId, bytes) {
      const row = sets.get(setId);
      if (!row) return reply(404, { code: 'not-found' });
      if (row.stage !== 'uploading') return reply(409, { code: 'upload-closed' });
      const file = ['front', 'expressions'].includes(assetId) ? row.set[assetId] : null;
      if (!file) return reply(404, { code: 'asset-not-found' });
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) return reply(422, { code: 'asset-hash-or-size' });
      row.files.set(assetId, Buffer.from(bytes));
      return reply(200, { stage: 'uploaded', assetId, bytes: bytes.length });
    },
    /** @param {string} setId */
    submitProfileSet(setId) {
      const row = sets.get(setId);
      if (!row) return reply(404, { code: 'not-found' });
      if (row.stage === 'ready') return reply(200, { ...profileSetBody(row), front: fighters.get(row.fighterId).front });
      const needed = ['front', 'expressions'].filter(id => row.set[id]);
      const missingAssets = needed.filter((/** @type {string} */ id) => !row.files.has(id));
      if (missingAssets.length) return reply(409, { code: 'assets-incomplete', missingAssets });
      row.stage = 'ready';
      const fighter = fighters.get(row.fighterId);
      fighter.front = { ok: true, operatorApproved: false, dummyChecked: true, profileSetId: setId, expressions: Boolean(row.set.expressions) };
      const event = notify('profile-set-ready', { fighterId: row.fighterId, profileSetId: setId, operatorApproved: false });
      return reply(200, {
        profileSetId: setId,
        fighterId: row.fighterId,
        stage: 'ready',
        front: fighter.front,
        event,
        next: 'Local file check passed. Operator approval is not granted in dummy mode.',
      });
    },
    /** @param {string} profileSetId */
    profileSet(profileSetId) {
      const row = sets.get(profileSetId);
      if (!row) return reply(404, { code: 'not-found' });
      return reply(200, { ...profileSetBody(row), front: fighters.get(row.fighterId).front, operatorApproved: false });
    },
    /** @param {string} fighterId @param {any} input */
    enter(fighterId, input) {
      const fighter = fighters.get(fighterId);
      if (!fighter) return reply(404, { code: 'fighter-not-found' });
      let checked;
      try {
        checked = entryRequest({ expectedManifestSha256: input?.expectedManifestSha256, reviewedClips: input?.reviewedClips });
      } catch {
        return reply(422, { code: 'invalid-entry' });
      }
      if (checked.sha !== fighter.manifestSha256) return reply(409, { code: 'fighter-changed' });
      if (!fighter.front?.ok) return reply(409, { code: 'profile-set-required' });
      fighter.entered = true;
      const event = notify('dummy-entered', { fighterId, publicPlay: false });
      return reply(200, {
        fighterId,
        entered: true,
        publicPlay: false,
        productionRoster: false,
        event,
        next: 'Recorded only in this dummy store. Nobody else can meet this fighter.',
      });
    },
    /** @param {string} kind @param {string} id */
    page(kind, id) {
      if (kind === 'fighter' && fighters.has(id)) return publicFighter(fighters.get(id));
      if (kind === 'submission' && submissions.has(id)) return submissionBody(submissions.get(id));
      if (kind === 'job' && jobs.has(id)) return jobBody(jobs.get(id)).job;
      return null;
    },
  };
}

/** @param {any} fighter */
function publicFighter(fighter) {
  return {
    id: fighter.id,
    name: fighter.name,
    localId: fighter.localId,
    status: 'dummy-held',
    availability: 'dummy-not-public',
    entered: fighter.entered,
    publicPlay: false,
    manifestSha256: fighter.manifestSha256,
    submissionIds: fighter.submissionIds,
    front: fighter.front,
    style: fighter.style,
    createdAt: fighter.createdAt,
  };
}

/** @param {any} row */
function profileSetBody(row) {
  const assets = ['front', 'expressions'].filter(id => row.set[id]).map(id => ({ id, ...row.set[id] }));
  const pending = row.stage === 'uploading' ? ['upload-front', 'submit'] : [];
  return {
    profileSetId: row.id,
    fighterId: row.fighterId,
    stage: row.stage,
    pending,
    pendingStages: pending,
    assets,
    missingAssets: assets.filter(asset => !row.files.has(asset.id)),
    next: 'pending is stage names. Upload missingAssets (front, then expressions).',
  };
}

/** @param {any} style @param {boolean} hasSkill */
function styleError(style, hasSkill) {
  if (style === null) return null;
  if (!checkStyle(style)) return 'invalid-style';
  const mix = style.mix;
  if (mix && (mix.fast > mix.slam + mix.combo || mix.slam + mix.combo + mix.fast < 1)) return 'invalid-style';
  const extras = (style.shockwave === true ? 1 : 0) + (style.summon ? 1 : 0) + (hasSkill ? 1 : 0);
  if (extras > 2) return 'invalid-style';
  return null;
}
