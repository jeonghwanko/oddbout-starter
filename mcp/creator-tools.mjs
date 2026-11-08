// @ts-check
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { changeSchema, createCreationStore, identifier } from './creation-store.mjs';
import { createJobStore, jobPlanSchema } from './creation-jobs.mjs';
import { errorCode } from './error-code.mjs';

/** A tool's input, checked by its schema. @template {z.ZodRawShape} S @typedef {z.output<z.ZodObject<S>>} ShapeOutput */
/**
 * @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {{ root: string, contextRequest?: typeof fetch, respond: import('./server.mjs').Respond, outputSchema: import('./server.mjs').OutputSchema,
 *   validatePackage?: (relative: string) => Promise<import('./package-access.mjs').PackageCheck> }} options
 */
export function registerCreatorTools(server, { root, contextRequest, respond, outputSchema, validatePackage }) {
  const store = createCreationStore(root, { contextRequest, validatePackage }),
    jobs = createJobStore(store);
  // Session reads and changes check the game's current context over the network; job records are local files only.
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const write = { ...read, readOnlyHint: false, idempotentHint: false };
  const localRead = { ...read, openWorldHint: false },
    localWrite = { ...write, openWorldHint: false };
  const session = { sessionId: identifier },
    revision = z.number().int().positive();
  const job = { ...session, jobId: z.string().uuid() };
  /**
   * Each tool's fields, checked as one z.object. The SDK cannot resolve its callback type for a generic shape, so the call passes a
   * plain object schema and `fn` gets S's input.
   * @template {z.ZodRawShape} S
   * @param {string} name @param {string} description @param {S} shape
   * @param {import('@modelcontextprotocol/server').ToolAnnotations} annotations
   * @param {(input: ShapeOutput<S>) => unknown} fn
   */
  const register = (name, description, shape, annotations, fn) =>
    server.registerTool(name, { description, inputSchema: /** @type {z.ZodObject} */ (z.object(shape)), outputSchema, annotations }, async input => {
      try {
        return respond({ ok: true, stage: name, data: await fn(/** @type {ShapeOutput<S>} */ (input)) });
      } catch (error) {
        return respond({ ok: false, stage: name, code: errorCode(error, 'invalid-input-or-local-operation-failed', { missing: 'record-or-file-not-found' }) });
      }
    });
  register('list_creation_sessions', 'List local fighter projects to resume. Does not create or generate anything.', {}, localRead, () => store.list());
  register(
    'create_creation_session',
    'Start a local project from actual user intent; dialogue-only sessions cannot execute jobs. Does not generate or confirm provider access.',
    { ...session, brief: z.string().min(1).max(4000), mode: z.enum(['creation', 'dialogue-only']).default('creation') },
    write,
    input => store.create(input),
  );
  register(
    'get_creation_session',
    'Read preserved versions and selections, check file fingerprints and current game context, and return remaining group blockers.',
    session,
    read,
    ({ sessionId }) => store.inspect(sessionId),
  );
  register(
    'update_creation_session',
    'Record one actual observation or user decision with optimistic revision checking. Select only the stated current version; a revision keeps older versions. Reviews are agent observations, not automatic visual certification. Advance requires all prior group checks.',
    { ...session, expectedRevision: revision, change: changeSchema },
    write,
    ({ sessionId, expectedRevision, change }) => store.change(sessionId, expectedRevision, change),
  );
  register(
    'prepare_creation_job',
    'Reserve an immutable engine command and expected files, without executing. Reuse jobId for identical retries. Unknown/running work blocks new work on the same motion. The returned CLI must be run through the local host after reading the sprite-gen workflow and confirming current user access.',
    { ...job, expectedRevision: revision, plan: jobPlanSchema },
    { ...write, idempotentHint: true },
    async ({ sessionId, jobId, expectedRevision, plan }) => {
      const result = await jobs.prepare(sessionId, expectedRevision, jobId, plan);
      return {
        job: result,
        execution: {
          command: process.execPath,
          args: [fileURLToPath(new URL('../scripts/run-creation-job.mjs', import.meta.url)), sessionId, jobId],
          cwd: root,
          env: { AI_FIGHTER_ROOT: root },
        },
      };
    },
  );
  register(
    'get_creation_job',
    'Inspect an existing job or list jobs. Never retries generation. succeeded is process/output evidence only; visual review remains separate. An unreadable record is listed as such and blocks new jobs until inspected.',
    { ...session, jobId: z.string().uuid().optional() },
    localRead,
    async ({ sessionId, jobId }) =>
      jobId
        ? jobs.inspect(sessionId, jobId)
        : Promise.all((await jobs.list(sessionId)).map(job => ('unreadable' in job ? job : jobs.inspect(sessionId, job.jobId)))),
  );
  register(
    'cancel_creation_job',
    'Cancel an unstarted reservation, for example after changing its inputs. For a running job, ask its runner to stop the engine (within seconds); the job then ends unknown for generation, since a provider request may already be billed, or failed for packing. Never erases evidence or reruns.',
    job,
    { ...localWrite, idempotentHint: true },
    ({ sessionId, jobId }) => jobs.cancel(sessionId, jobId),
  );
  // Readiness reads the same records to tell whether a character is already in progress.
  const stores = { store, jobs };
  register(
    'resolve_creation_job',
    'Resolve an unknown outcome only after inspecting provider records and outputs. Record evidence; duplicate-risk-accepted requires the user’s explicit choice acknowledging possible duplicate usage. Resolution never reexecutes a job or approves art.',
    {
      ...job,
      outcome: z.enum(['recovered', 'not-started', 'duplicate-risk-accepted']),
      evidence: z.array(z.string()).min(1).max(32),
      note: z.string().min(1).max(4000),
    },
    localWrite,
    ({ sessionId, jobId, ...resolution }) => jobs.resolve(sessionId, jobId, resolution),
  );
  return stores;
}
