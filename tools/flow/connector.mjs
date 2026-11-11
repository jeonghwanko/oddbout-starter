// @ts-check
// Agent-facing dummy tools. Paths stay inside the roots handed to this process. URLs are not fetched.
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { buildDummyPackage } from './package-builder.mjs';
import { DUMMY_LABEL, stamp } from './seal.mjs';
import { canonicalToolName, decidePermission } from '../../mcp/tool-permissions.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** @param {string} code */
const dummyError = code => `${DUMMY_LABEL} production: false. mode: dummy. service: oddbout-dummy. code: ${code}`;
const UUID = z.string({ error: dummyError('invalid-id') }).regex(UUID_PATTERN, { error: dummyError('invalid-id') });
const REQUIRED_KEY = z.string({ error: dummyError('idempotency-key-required') }).regex(UUID_PATTERN, { error: dummyError('invalid-id') });
const MOVE = z.object({ name: z.string().min(1).max(24), description: z.string().min(1).max(160) });

/**
 * @param {any} store
 * @param {{ roots: string[], packageRoot?: string }} options
 */
export function createConnector(store, { roots, packageRoot }) {
  /** @param {string} file */
  async function confined(file) {
    if (typeof file !== 'string' || file.includes('\0')) return null;
    let resolved;
    try {
      resolved = await realpath(file);
    } catch {
      return null;
    }
    for (const root of roots) {
      const base = await realpath(root);
      if (resolved === base || resolved.startsWith(base + path.sep)) return resolved;
    }
    return null;
  }
  /** @param {unknown} file */
  async function bytesOf(file) {
    const found = typeof file === 'string' ? await confined(file) : null;
    if (!found) return { error: stamp({ ok: false, code: 'dummy-path-refused' }) };
    return { bytes: await readFile(found) };
  }
  return {
    /**
     * @param {string} name
     * @param {any} args
     */
    async call(name, args = {}) {
      const decision = decidePermission(name, args);
      if (!decision.allow) {
        return stamp({
          ok: false,
          code: decision.code,
          permission: decision.tier,
          executed: false,
          tool: canonicalToolName(name),
          bypassIgnored: decision.bypassIgnored,
        });
      }
      const tool = canonicalToolName(name);
      /** @param {any} result */
      const finish = result =>
        decision.tier === 'mutate' && result && typeof result === 'object'
          ? {
              ...result,
              confirmationTrail: {
                tool,
                text: String(args.confirmationText ?? '')
                  .trim()
                  .slice(0, 200),
              },
            }
          : result;
      if (tool === 'create_dummy_package') {
        if (!packageRoot) return stampUnavailable('dummy-package-builder-unavailable');
        return finish(await buildDummyPackage(store, packageRoot, args));
      }
      if (tool === 'get_profile') return store.profile().body;
      if (tool === 'get_fighter_spec') return store.spec(args.section ?? 'overview').body;
      if (tool === 'browse_oddbout') {
        if ((args.view ?? 'style_guide') !== 'style_guide') return stampUnavailable(args.view);
        return store.styleGuide().body;
      }
      if (tool === 'get_my_fighters') {
        const view = args.view ?? 'list';
        if (view === 'list') return store.listFighters().body;
        if (view === 'readiness') return store.readiness(args.purpose ?? 'registration').body;
        if (view === 'submission') return store.getSubmission(args.submissionId).body;
        if (view === 'fighter') return store.fighter(args.fighterId).body;
        if (view === 'profile_set') return store.profileSet(args.profileSetId).body;
        return stampUnavailable(view);
      }
      if (tool === 'prepare_fighter_registration') {
        const found = typeof args.manifestPath === 'string' ? await confined(args.manifestPath) : null;
        if (!found) return stamp({ ok: false, code: 'dummy-path-refused' });
        const text = await readFile(found, 'utf8');
        if (args.kind === 'profile_set') return finish(store.prepareProfileSet(args.fighterId, text, args.idempotencyKey).body);
        if (args.kind === 'package' || !args.kind)
          return finish(store.createSubmission({ text, fighterId: args.fighterId, idempotencyKey: args.idempotencyKey }).body);
        return stampUnavailable(args.kind);
      }
      if (tool === 'upload_fighter_asset') {
        const file = await bytesOf(args.filePath);
        if (file.error) return file.error;
        if (args.kind === 'profile_set') return finish(store.uploadProfileAsset(args.profileSetId, args.assetId ?? 'front', file.bytes).body);
        return finish(store.putAsset(args.submissionId, args.assetId, file.bytes).body);
      }
      if (tool === 'submit_fighter_registration') {
        if (args.kind === 'profile_set') return finish(store.submitProfileSet(args.profileSetId).body);
        if (args.kind === 'hosted') return finish(store.registerHosted(args.jobId).body);
        return finish(store.submit(args.submissionId).body);
      }
      if (tool === 'update_fighter') {
        if (args.kind === 'style') return finish(store.updateStyle(args.fighterId, args.style, args.idempotencyKey).body);
        return stampUnavailable(args.kind ?? 'profile');
      }
      if (tool === 'request_hosted_fighter') {
        const step = args.step ?? 'request';
        if (step === 'request') {
          return finish(
            store.requestHosted({ description: args.description, language: args.language, idempotencyKey: args.idempotencyKey, delegate: args.delegate }).body,
          );
        }
        if (step === 'choose_look') return finish(store.chooseLook(args.jobId, args.choose).body);
        if (step === 'revise_motion') return finish(store.reviseMotion(args.jobId, args.clip, args.note).body);
        return stampUnavailable(step);
      }
      if (tool === 'get_hosted_fighter') {
        return (await store.waitHosted({ jobId: args.jobId, idempotencyKey: args.idempotencyKey, waitSeconds: 0, observe: true })).body;
      }
      if (tool === 'advance_hosted_fighter') {
        return finish((await store.waitHosted({ jobId: args.jobId, idempotencyKey: args.idempotencyKey, waitSeconds: args.waitSeconds, observe: false })).body);
      }
      if (tool === 'enter_fighter' || tool === 'delete_fighter' || tool === 'withdraw_fighter') {
        return stamp({ ok: false, code: 'permission-forbidden', permission: 'forbidden', executed: false, tool });
      }
      return stamp({ ok: false, code: 'unknown-tool', tool });
    },
  };
}

/** @param {string} name */
function stampUnavailable(name) {
  return {
    ok: false,
    code: 'dummy-view-unavailable',
    view: name,
    production: false,
    mode: 'dummy',
    service: 'oddbout-dummy',
    label: 'ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.',
    next: 'This dummy connector implements the creation flow only.',
  };
}

const banner = 'DUMMY ONLY. Not the live ODDBOUT service. No tokens, no model calls, no production writes. ';

/** Tools the stdio dummy MCP lists. */
export const DUMMY_TOOLS = [
  {
    name: 'create_dummy_package',
    title: 'ODDBOUT-DUMMY package builder',
    description:
      banner +
      'Create a fresh sealed geometric package for this test session. For a revision pass an existing fighterId; missing targets are refused. Does not submit or generate real art. Returned paths work with prepare/upload or fighter:register --dummy using get_profile.dummyRegistrationUrl.',
    shape: {
      fighterId: UUID.optional(),
      name: z.string().min(1).max(40).optional(),
      description: z.string().min(1).max(800).optional(),
      language: z.enum(['ko', 'en']).optional(),
      style: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
      moves: z.object({ combo: MOVE.optional(), slam: MOVE.optional(), dash: MOVE.optional(), block: MOVE.optional() }).strict().optional(),
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  { name: 'get_profile', title: 'ODDBOUT-DUMMY account', description: banner + 'Read the dummy account. Nickname is ODDBOUT.', shape: {} },
  {
    name: 'get_fighter_spec',
    title: 'ODDBOUT-DUMMY spec',
    description: banner + 'Read a short dummy summary of the repository contract.',
    shape: { section: z.enum(['overview', 'schema', 'creation']).optional() },
  },
  {
    name: 'get_my_fighters',
    title: 'ODDBOUT-DUMMY fighters',
    description: banner + 'views: list, readiness, submission, fighter, profile_set. pending is never an asset id.',
    shape: {
      view: z.enum(['list', 'readiness', 'submission', 'fighter', 'profile_set']).optional(),
      purpose: z.enum(['generation', 'connection', 'registration']).optional(),
      submissionId: UUID.optional(),
      fighterId: UUID.optional(),
      profileSetId: UUID.optional(),
    },
  },
  {
    name: 'browse_oddbout',
    title: 'ODDBOUT-DUMMY guide',
    description: banner + 'view style_guide returns the repository style rules. Nothing is fetched.',
    shape: { view: z.enum(['style_guide']).optional() },
  },
  {
    name: 'prepare_fighter_registration',
    title: 'ODDBOUT-DUMMY prepare',
    description: banner + 'kind package or profile_set. manifestPath is an absolute path inside the dummy roots.',
    shape: {
      kind: z.enum(['package', 'profile_set']).optional(),
      manifestPath: z.string(),
      idempotencyKey: REQUIRED_KEY,
      fighterId: UUID.optional(),
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  {
    name: 'upload_fighter_asset',
    title: 'ODDBOUT-DUMMY upload',
    description: banner + 'filePath is an absolute path. Size and SHA-256 must match the manifest.',
    shape: {
      kind: z.enum(['package', 'profile_set']).optional(),
      submissionId: UUID.optional(),
      profileSetId: UUID.optional(),
      assetId: z.string().optional(),
      filePath: z.string(),
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  {
    name: 'submit_fighter_registration',
    title: 'ODDBOUT-DUMMY submit',
    description: banner + 'kind package, profile_set, or hosted. A dummy registration is not public.',
    shape: {
      kind: z.enum(['package', 'profile_set', 'hosted']).optional(),
      submissionId: UUID.optional(),
      profileSetId: UUID.optional(),
      jobId: UUID.optional(),
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  {
    name: 'update_fighter',
    title: 'ODDBOUT-DUMMY style',
    description: banner + 'kind style stores a fighting style on the dummy fighter. It does not draw art.',
    shape: {
      kind: z.enum(['style']),
      fighterId: UUID,
      style: z.union([z.record(z.string(), z.unknown()), z.null()]),
      idempotencyKey: REQUIRED_KEY,
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  {
    name: 'request_hosted_fighter',
    title: 'ODDBOUT-DUMMY hosted',
    description:
      banner +
      'steps: request (requires description, language and idempotencyKey), choose_look, revise_motion. Reuse the original key for immutable retries. revise_motion only at motion_ready. Looks are labels, not model images.',
    shape: {
      step: z.enum(['request', 'choose_look', 'revise_motion']).optional(),
      description: z.string().optional(),
      language: z.enum(['ko', 'en']).optional(),
      idempotencyKey: UUID.optional(),
      delegate: z.boolean().optional(),
      jobId: UUID.optional(),
      choose: z.enum(['a', 'b']).optional(),
      clip: z.string().optional(),
      note: z.string().optional(),
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  {
    name: 'get_hosted_fighter',
    title: 'ODDBOUT-DUMMY hosted status',
    description: banner + 'Read a hosted job. This call does not advance motions or register, even with waitSeconds or confirmed.',
    shape: {
      jobId: UUID.optional(),
      idempotencyKey: UUID.optional(),
      waitSeconds: z.number().int().min(0).max(30).optional(),
      observe: z.boolean().optional(),
    },
  },
  {
    name: 'advance_hosted_fighter',
    title: 'ODDBOUT-DUMMY hosted advance',
    description: banner + 'Mutating. Moves the dummy worker. get_hosted_fighter does not.',
    shape: {
      jobId: UUID.optional(),
      idempotencyKey: UUID.optional(),
      waitSeconds: z.number().int().min(0).max(30).optional(),
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  {
    name: 'enter_fighter',
    title: 'ODDBOUT-DUMMY enter',
    description: banner + 'Forbidden by the tool permission tier. Entry is not performed.',
    shape: {
      fighterId: UUID,
      expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      reviewedClips: z.array(z.string()),
      confirmed: z.boolean().optional(),
      confirmationText: z.string().max(200).optional(),
    },
  },
  {
    name: 'delete_fighter',
    title: 'ODDBOUT-DUMMY delete',
    description: banner + 'Forbidden. This dummy does not delete a fighter.',
    shape: { fighterId: UUID.optional(), confirmed: z.boolean().optional(), confirmationText: z.string().max(200).optional(), yolo: z.boolean().optional() },
  },
];

/** The request selector requires a key; choosing an existing look does not.
 * Both advertised JSON Schema and runtime validation come from these same branches.
 * @param {(typeof DUMMY_TOOLS)[number]} tool */
export function dummyToolSchema(tool) {
  const base = z.object(tool.shape);
  if (tool.name !== 'request_hosted_fighter') return base;
  return z.union(
    [
      base.extend({
        step: z.literal('request').optional(),
        description: z.string().min(4).max(600),
        language: z.enum(['ko', 'en']),
        idempotencyKey: REQUIRED_KEY,
      }),
      base.extend({ step: z.literal('choose_look'), jobId: UUID, choose: z.enum(['a', 'b']) }),
      base.extend({ step: z.literal('revise_motion'), jobId: UUID, clip: z.string(), note: z.string().min(2).max(200) }),
    ],
    {
      error: issue => {
        const input = issue.input;
        if (input && typeof input === 'object' && !Array.isArray(input)) {
          const record = /** @type {{ step?: string, idempotencyKey?: unknown }} */ (input);
          if (
            record.step !== 'choose_look' &&
            record.step !== 'revise_motion' &&
            (typeof record.idempotencyKey !== 'string' || record.idempotencyKey.length === 0)
          )
            return dummyError('idempotency-key-required');
        }
        return dummyError('invalid-input');
      },
    },
  );
}
