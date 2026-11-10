// @ts-check
// Agent-facing dummy tools. Paths stay inside the roots handed to this process. URLs are not fetched.
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/**
 * @param {any} store
 * @param {{ roots: string[] }} options
 */
export function createConnector(store, { roots }) {
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
    if (!found) return { error: { ok: false, code: 'dummy-path-refused', production: false } };
    return { bytes: await readFile(found) };
  }
  return {
    /**
     * @param {string} name
     * @param {any} args
     */
    async call(name, args = {}) {
      if (name === 'get_profile') return store.profile().body;
      if (name === 'get_fighter_spec') return store.spec(args.section ?? 'overview').body;
      if (name === 'browse_oddbout') {
        if ((args.view ?? 'style_guide') !== 'style_guide') return stampUnavailable(args.view);
        return store.styleGuide().body;
      }
      if (name === 'get_my_fighters') {
        const view = args.view ?? 'list';
        if (view === 'list') return store.listFighters().body;
        if (view === 'readiness') return store.readiness(args.purpose ?? 'registration').body;
        if (view === 'submission') return store.getSubmission(args.submissionId).body;
        if (view === 'fighter') return store.fighter(args.fighterId).body;
        if (view === 'profile_set') return store.profileSet(args.profileSetId).body;
        return stampUnavailable(view);
      }
      if (name === 'prepare_fighter_registration') {
        const found = typeof args.manifestPath === 'string' ? await confined(args.manifestPath) : null;
        if (!found)
          return {
            ok: false,
            code: 'dummy-path-refused',
            production: false,
            mode: 'dummy',
            service: 'oddbout-dummy',
            label: 'ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.',
          };
        const text = await readFile(found, 'utf8');
        if (args.kind === 'profile_set') return store.prepareProfileSet(args.fighterId, text, args.idempotencyKey).body;
        if (args.kind === 'package' || !args.kind) return store.createSubmission({ text, fighterId: args.fighterId, idempotencyKey: args.idempotencyKey }).body;
        return stampUnavailable(args.kind);
      }
      if (name === 'upload_fighter_asset') {
        const file = await bytesOf(args.filePath);
        if (file.error) return file.error;
        if (args.kind === 'profile_set') return store.uploadProfileAsset(args.profileSetId, args.assetId ?? 'front', file.bytes).body;
        return store.putAsset(args.submissionId, args.assetId, file.bytes).body;
      }
      if (name === 'submit_fighter_registration') {
        if (args.kind === 'profile_set') return store.submitProfileSet(args.profileSetId).body;
        if (args.kind === 'hosted') return store.registerHosted(args.jobId).body;
        return store.submit(args.submissionId).body;
      }
      if (name === 'update_fighter') {
        if (args.kind === 'style') return store.updateStyle(args.fighterId, args.style, args.idempotencyKey).body;
        return stampUnavailable(args.kind ?? 'profile');
      }
      if (name === 'request_hosted_fighter') {
        const step = args.step ?? 'request';
        if (step === 'request') {
          return store.requestHosted({ description: args.description, language: args.language, idempotencyKey: args.idempotencyKey, delegate: args.delegate })
            .body;
        }
        if (step === 'choose_look') return store.chooseLook(args.jobId, args.choose).body;
        if (step === 'revise_motion') return store.reviseMotion(args.jobId, args.clip, args.note).body;
        return stampUnavailable(step);
      }
      if (name === 'get_hosted_fighter') return store.getHosted({ jobId: args.jobId, idempotencyKey: args.idempotencyKey }).body;
      if (name === 'enter_fighter') return store.enter(args.fighterId, args).body;
      return {
        ok: false,
        code: 'unknown-tool',
        tool: name,
        production: false,
        mode: 'dummy',
        service: 'oddbout-dummy',
        label: 'ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.',
      };
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
    shape: { kind: z.enum(['package', 'profile_set']).optional(), manifestPath: z.string(), idempotencyKey: UUID.optional(), fighterId: UUID.optional() },
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
    },
  },
  {
    name: 'update_fighter',
    title: 'ODDBOUT-DUMMY style',
    description: banner + 'kind style stores a fighting style on the dummy fighter. It does not draw art.',
    shape: { kind: z.enum(['style']), fighterId: UUID, style: z.union([z.record(z.string(), z.unknown()), z.null()]), idempotencyKey: UUID },
  },
  {
    name: 'request_hosted_fighter',
    title: 'ODDBOUT-DUMMY hosted',
    description: banner + 'steps: request, choose_look, revise_motion. revise_motion only at motion_ready. Looks are labels, not model images.',
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
    },
  },
  {
    name: 'get_hosted_fighter',
    title: 'ODDBOUT-DUMMY hosted status',
    description: banner + 'Read a hosted job. Each read adds at most one placeholder motion and does not wait.',
    shape: { jobId: UUID.optional(), idempotencyKey: UUID.optional(), waitSeconds: z.number().optional() },
  },
  {
    name: 'enter_fighter',
    title: 'ODDBOUT-DUMMY enter',
    description: banner + 'Records a local flag only. publicPlay stays false.',
    shape: { fighterId: UUID, expectedManifestSha256: z.string().regex(/^[a-f0-9]{64}$/), reviewedClips: z.array(z.string()) },
  },
];
