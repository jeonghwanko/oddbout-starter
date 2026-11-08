// @ts-check
import { randomUUID, createHash } from 'node:crypto';
import { realpath, readFile } from 'node:fs/promises';
import { hostname, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicJson, localPath, readJson } from './creation-store.mjs';
import { withFileLock } from './file-lock.mjs';
import { bundledProfiles, canonical, profileHash, profileSchema, fetchProfileEnvelope } from './environment-profiles.mjs';
import { inspectGenerationLogin } from './generation-connection.mjs';
import { checkCreationDelivery } from '../scripts/check-creation-delivery.mjs';
import { errorCode } from './error-code.mjs';

export const accountChoice = z.enum(['gpt', 'grok', 'both', 'stop']);
const text = z.string().trim().min(1).max(1000);
const capabilities = z.array(z.enum(['gpt-image', 'grok-image', 'grok-video'])).max(3);
const proof = z.object({ evidence: text, status: z.enum(['allowed', 'denied', 'unknown']) }).strict();
export const environmentChange = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('configure'),
      account: accountChoice,
      host: z.enum(['dots', 'local', 'owned-vm']),
      conversationId: text,
      confirmedAccess: capabilities.default([]),
      feedback: text,
    })
    .strict(),
  z.object({ type: z.literal('rebind'), host: z.enum(['dots', 'local', 'owned-vm']), conversationId: text, feedback: text }).strict(),
  z.object({ type: z.literal('approve-network'), planHash: z.string().regex(/^[a-f0-9]{64}$/), feedback: text }).strict(),
  z.object({ type: z.literal('report-host-network'), planHash: z.string().regex(/^[a-f0-9]{64}$/), ...proof.shape }).strict(),
  z.object({ type: z.literal('check-network') }).strict(),
  z.object({ type: z.literal('delivery'), path: z.string().min(1).max(512) }).strict(),
  z.object({ type: z.literal('refresh-profile') }).strict(),
  z.object({ type: z.literal('revoke-network'), feedback: text }).strict(),
]);
/**
 * The workspace's environment record. `network` holds the current plan's approval, host report and probe, or a revocation.
 * @typedef {import('./environment-profiles.mjs').Profile} Profile
 * @typedef {{ host: string, status: string, httpStatus?: number }} ProbeResult
 * @typedef {{ approval?: { planHash: string, feedback: string, at: string },
 *   hostReport?: { planHash: string, status: 'allowed' | 'denied' | 'unknown', evidence: string, at: string, source: string },
 *   probe?: { planHash: string, at: string, destinations: ProbeResult[] } | null,
 *   revocation?: { at: string, feedback: string, hostActionRequired: boolean, note: string } }} Network
 * @typedef {{ schemaVersion: 1, revision: number, environmentId: string, previousEnvironmentId?: string, hostBinding: string, profile: Profile,
 *   account: z.infer<typeof accountChoice>, host: 'dots' | 'local' | 'owned-vm', conversationId: string, confirmedAccess: z.infer<typeof capabilities>,
 *   feedback: string, network?: Network | null, delivery?: { path: string, hash: string, at: string } | null, createdAt: string, updatedAt?: string,
 *   history?: object[] }} EnvironmentState
 */
/** @type {(value: unknown) => string} */
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
/** @type {(at: string, now: number) => boolean} */
const fresh = (at, now) => Number.isFinite(Date.parse(at)) && now - Date.parse(at) >= 0 && now - Date.parse(at) < 15 * 60 * 1000;
const prefix = 'output/creation-environment';

/** @param {EnvironmentState} state */
export function environmentPlan(state) {
  const profile = state.profile.profiles.find(p => p.id === 'gpt-appearance');
  const destinations = ['gpt', 'both'].includes(state.account) ? (profile?.destinations ?? []) : [];
  const content = {
    environmentId: state.environmentId,
    hostBinding: state.hostBinding,
    host: state.host,
    account: state.account,
    profileHash: profileHash(state.profile),
    profileRevision: state.profile.revision,
    destinations,
  };
  const supported = destinations.length > 0;
  return {
    ...content,
    planHash: digest(content),
    coverage: 'bootstrap-only',
    unresolved: supported
      ? /** @type {NonNullable<typeof profile>} */ (profile).unresolved
      : ['현재 온보딩 어댑터는 GPT 외형 연결부터 지원합니다. 기존 Grok workflow는 유지됩니다.'],
    approvalPrompt: supported
      ? '이 제작 환경의 GPT 로그인·생성 접속을 허용할까요? 참고 이미지는 선택한 제공자에게 전송됩니다. 도메인 상세와 현재 환경 범위를 확인하세요.'
      : null,
    hostAdapter: {
      status: 'manual-handoff',
      automaticApply: false,
      instruction:
        '호스트의 실제 네트워크 승인·설정 기능을 사용하세요. 이 도구의 승인 기록은 방화벽을 변경하지 않습니다. 적용 결과를 확인한 후 report-host-network에 근거를 기록하세요.',
    },
  };
}

/**
 * Root requests never follow a redirect, upload a reference or start generation. HTTP 403 is not success.
 * @param {{ host: string }} destination @param {typeof fetch} [fetchImpl] @returns {Promise<ProbeResult>}
 */
export async function probeDestination(destination, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`https://${destination.host}/`, {
      method: 'HEAD',
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    return { host: destination.host, status: response.status >= 200 && response.status < 400 ? 'reachable' : 'unverified', httpStatus: response.status };
  } catch {
    return { host: destination.host, status: 'unreachable-or-blocked' };
  }
}

/**
 * @param {string} root
 * @param {{ loginProbe?: typeof inspectGenerationLogin, fetchImpl?: typeof fetch, now?: () => number, hostId?: string,
 *   trustedKeys?: Record<string, string>, profileSource?: string }} [options]
 */
export function createEnvironmentStore(
  root,
  { loginProbe = inspectGenerationLogin, fetchImpl = fetch, now = () => Date.now(), hostId = hostname(), trustedKeys, profileSource } = {},
) {
  const file = () => localPath(root, `${prefix}/environment.json`);
  const binding = async () =>
    digest({
      root: await realpath(root),
      host: hostId,
      platform: process.platform,
      credentialHome: path.resolve(process.env.CODEX_HOME || path.join(homedir(), '.codex')),
    });
  /** @param {{ allowMoved?: boolean }} [options] @returns {Promise<EnvironmentState | null>} */
  async function read({ allowMoved = false } = {}) {
    const state = await readJson(await file()).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!state) return null;
    if (state.schemaVersion !== 1 || !Number.isInteger(state.revision) || !z.string().uuid().safeParse(state.environmentId).success)
      throw Error('environment-record-invalid');
    profileSchema.parse(state.profile);
    if (!allowMoved && state.hostBinding !== (await binding())) throw Error('environment-host-changed-reconnect-required');
    return state;
  }
  /** @template T @param {() => Promise<T>} action @returns {Promise<T>} */
  async function locked(action) {
    await localPath(root, prefix, { createParents: true, directory: true });
    // A device login holds this for minutes, so other callers get environment-busy after a short wait.
    return withFileLock(await localPath(root, `${prefix}/environment.lock`), action, { busy: 'environment-busy', waitMs: 2000 });
  }
  /** @param {EnvironmentState} state */
  async function deliveryStatus(state) {
    if (!state.delivery) return { status: 'unknown', ready: false };
    try {
      const record = await readJson(await localPath(root, state.delivery.path));
      if (digest(record) !== state.delivery.hash || record.environment !== state.environmentId) return { status: 'stale', ready: false };
      const check = /** @type {Extract<ReturnType<typeof checkCreationDelivery>, { ready: boolean }>} */ (
        checkCreationDelivery(record, { phase: 'preflight', conversationId: state.conversationId })
      ); // the preflight verdict
      return { status: check.ready ? 'recorded-preconditions' : 'blocked', ...check };
    } catch {
      return { status: 'invalid-or-missing-record', ready: false };
    }
  }
  async function inspect() {
    const state = await read({ allowMoved: true });
    if (!state)
      return {
        status: 'not-configured',
        readyForGeneration: false,
        nextActions: ['configure'],
        generation: { status: 'unknown' },
        network: { status: 'unknown' },
        delivery: { status: 'unknown' },
      };
    if (state.hostBinding !== (await binding()))
      return {
        status: 'host-changed-reconnect-required',
        revision: state.revision,
        account: state.account,
        readyForGeneration: false,
        nextActions: ['rebind'],
        meaning:
          'Reconnect only within the user’s request. Rebind preserves project files and account choice, but resets access, permission and delivery confirmations. It never copies credentials.',
      };
    const plan = environmentPlan(state),
      clock = now();
    const approved = state.network?.approval?.planHash === plan.planHash;
    const hostReport = state.network?.hostReport;
    const applied = approved && hostReport?.planHash === plan.planHash && hostReport.status === 'allowed' && fresh(hostReport.at, clock);
    const probe = state.network?.probe;
    const reached =
      applied &&
      probe?.planHash === plan.planHash &&
      fresh(probe.at, clock) &&
      probe.destinations.length === plan.destinations.length &&
      probe.destinations.length > 0 &&
      probe.destinations.every(d => d.status === 'reachable');
    const generation = ['gpt', 'both'].includes(state.account)
      ? await loginProbe({ cwd: root })
      : { status: state.account === 'stop' ? 'stopped' : 'adapter-unavailable', provider: state.account === 'grok' ? 'grok' : null };
    const delivery = await deliveryStatus(state);
    const blockers = [];
    if (state.account === 'stop') blockers.push('user-stopped');
    if (!plan.destinations.length) blockers.push('selected-provider-onboarding-unavailable');
    if (!approved) blockers.push('network-approval-required');
    if (!applied) blockers.push('host-network-application-unverified');
    if (!reached) blockers.push('network-reachability-unverified');
    if (generation.status !== 'signed-in') blockers.push(`generation:${generation.status}`);
    if (!state.confirmedAccess.includes('gpt-image')) blockers.push('image-access-confirmation-required');
    if (!delivery.ready) blockers.push('generation-and-delivery-preflight-required');
    return {
      status: blockers.length ? 'action-required' : 'preconditions-recorded',
      environmentId: state.environmentId,
      revision: state.revision,
      conversationId: state.conversationId,
      account: state.account,
      confirmedAccess: state.confirmedAccess,
      plan,
      generation,
      network: {
        approved,
        application: applied ? 'host-reported' : 'unverified',
        reachability: reached ? 'bootstrap-hosts-reachable' : 'unverified',
        hostReport: hostReport ?? null,
        probe: probe ?? null,
        automaticApply: false,
        coverage: 'bootstrap-only',
      },
      delivery,
      blockers,
      readyForGeneration: blockers.length === 0,
      meaning:
        'Precondition records only. Host application is reported, HEAD probes cover bootstrap hosts only. Actual generation, download, image backend, account identity and conversation display remain unverified until the requested result completes.',
    };
  }
  /** @param {number} expectedRevision @param {unknown} input */
  async function update(expectedRevision, input) {
    /** @type {z.infer<typeof environmentChange> & { feedback?: string }} */
    const change = environmentChange.parse(input);
    return locked(async () => {
      let state = /** @type {EnvironmentState} */ (await read({ allowMoved: change.type === 'rebind' })); // null only before configure: checked below
      if ((state?.revision ?? 0) !== expectedRevision) throw Error('environment-revision-conflict');
      if (!state && change.type !== 'configure') throw Error('environment-not-configured');
      const at = new Date(now()).toISOString();
      if (change.type === 'rebind') {
        state.previousEnvironmentId = state.environmentId;
        Object.assign(state, {
          environmentId: randomUUID(),
          hostBinding: await binding(),
          host: change.host,
          conversationId: change.conversationId,
          network: null,
          delivery: null,
          confirmedAccess: [],
          feedback: change.feedback,
        });
      } else if (change.type === 'configure') {
        const allowed =
          change.account === 'both'
            ? ['gpt-image', 'grok-image', 'grok-video']
            : change.account === 'gpt'
              ? ['gpt-image']
              : change.account === 'grok'
                ? ['grok-image', 'grok-video']
                : [];
        if (change.confirmedAccess.some(c => !allowed.includes(c))) throw Error('access-choice-conflict');
        state ??= /** @type {EnvironmentState} */ ({
          schemaVersion: 1,
          revision: 0,
          environmentId: randomUUID(),
          hostBinding: await binding(),
          profile: await bundledProfiles(),
          createdAt: at,
        }); // the choice is assigned below
        if (state.account !== change.account || state.host !== change.host) state.network = null;
        if (state.conversationId !== change.conversationId) state.delivery = null;
        Object.assign(state, {
          account: change.account,
          host: change.host,
          conversationId: change.conversationId,
          confirmedAccess: [...new Set(change.confirmedAccess)],
          feedback: change.feedback,
        });
      } else {
        const plan = environmentPlan(state);
        if ('planHash' in change && change.planHash !== plan.planHash) throw Error('network-plan-changed');
        state.network ??= {};
        if (change.type === 'approve-network') {
          if (!plan.destinations.length) throw Error('network-profile-unavailable');
          state.network = { approval: { planHash: plan.planHash, feedback: change.feedback, at } };
        }
        if (change.type === 'report-host-network') {
          if (state.network.approval?.planHash !== plan.planHash) throw Error('network-approval-required');
          state.network.hostReport = { planHash: plan.planHash, status: change.status, evidence: change.evidence, at, source: 'host-reported' };
          state.network.probe = null;
        }
        if (change.type === 'check-network') {
          if (
            state.network.approval?.planHash !== plan.planHash ||
            state.network.hostReport?.planHash !== plan.planHash ||
            state.network.hostReport.status !== 'allowed' ||
            !fresh(state.network.hostReport.at, now())
          )
            throw Error('host-network-application-unverified');
          const destinations = [];
          for (const destination of plan.destinations) destinations.push(await probeDestination(destination, fetchImpl));
          state.network.probe = { planHash: plan.planHash, at: new Date(now()).toISOString(), destinations };
        }
        if (change.type === 'delivery') {
          const record = await readJson(await localPath(root, change.path));
          if (record.environment !== state.environmentId || record.conversationId !== state.conversationId) throw Error('delivery-environment-mismatch');
          state.delivery = { path: change.path, hash: digest(record), at };
        }
        if (change.type === 'refresh-profile') {
          const config = JSON.parse(await readFile(new URL('../deploy/creator-site.json', import.meta.url), 'utf8'));
          const url = profileSource ?? new URL('creation-environments/v1.json', config.siteUrl).href;
          const installedTrust = JSON.parse(await readFile(new URL('../deploy/creation-environment-trust.json', import.meta.url), 'utf8'));
          if (installedTrust.schemaVersion !== 1) throw Error('profile-trust-invalid');
          const next = await fetchProfileEnvelope(url, {
            bundled: await bundledProfiles(),
            minimumRevision: state.profile.revision,
            trustedKeys: trustedKeys ?? installedTrust.keys,
            fetchImpl,
          });
          if (next.profile.revision === state.profile.revision && next.hash !== profileHash(state.profile)) throw Error('profile-revision-conflict');
          if (next.hash !== profileHash(state.profile)) {
            state.profile = next.profile;
            state.network = null;
            state.delivery = null;
          }
        }
        if (change.type === 'revoke-network')
          state.network = {
            revocation: {
              at,
              feedback: change.feedback,
              hostActionRequired: true,
              note: 'Local consent revoked. Revoke the actual host permission separately; this tool cannot change it.',
            },
          };
      }
      state.revision++;
      state.updatedAt = at;
      state.history = [
        ...(state.history ?? []),
        {
          type: change.type,
          revision: state.revision,
          at,
          ...(change.feedback ? { feedback: change.feedback } : {}),
          ...('planHash' in change ? { planHash: change.planHash } : {}),
        },
      ].slice(-100);
      await atomicJson(await file(), state);
      return {
        environmentId: state.environmentId,
        revision: state.revision,
        plan: environmentPlan(state),
        nextAction: change.type === 'revoke-network' ? 'revoke-host-permission' : 'get_creation_environment',
      };
    });
  }
  async function prepareLogin() {
    const state = await read();
    if (!state || !['gpt', 'both'].includes(state.account)) throw Error('gpt-environment-required');
    const view = /** @type {Extract<Awaited<ReturnType<typeof inspect>>, { plan: object }>} */ (await inspect()); // read() above found it on this host
    if (!view.network.approved || view.network.application !== 'host-reported' || view.network.reachability !== 'bootstrap-hosts-reachable')
      throw Error('host-network-application-unverified');
    if (view.generation.status === 'signed-in') return { status: 'already-signed-in', generation: view.generation };
    const entry = fileURLToPath(new URL('../scripts/connect-generation.mjs', import.meta.url));
    return {
      status: 'login-command-prepared',
      provider: 'codex',
      environmentId: state.environmentId,
      revision: state.revision,
      execution: { command: process.execPath, args: [entry, await realpath(root), String(state.revision)], cwd: await realpath(root) },
      instruction:
        'Run through the normal host execution tool. Show only the emitted verificationUrl and userCode. The user completes the official login; inspect the connection afterward. Do not paste callbacks or use an API key fallback.',
    };
  }
  return { read, inspect, update, prepareLogin, locked };
}
/** @typedef {ReturnType<typeof createEnvironmentStore>} EnvironmentStore */

/** @typedef {import('@modelcontextprotocol/server').CallToolResult} CallToolResult */
/**
 * @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {{ root: string, respond: import('./server.mjs').Respond, outputSchema: import('./server.mjs').OutputSchema }} options
 */
export function registerEnvironmentTools(server, { root, respond, outputSchema }) {
  const store = createEnvironmentStore(root);
  const readonly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  /** @type {<A>(action: (args: A) => Promise<unknown>) => (args: A) => Promise<CallToolResult>} */
  const handle = action => async args => {
    try {
      return respond({ ok: true, stage: 'creation-environment', data: await action(args) });
    } catch (error) {
      return respond({ ok: false, stage: 'creation-environment', code: errorCode(error, 'environment-request-invalid') });
    }
  };
  server.registerTool(
    'get_creation_environment',
    {
      description:
        'Inspect this workspace connection and its missing steps. No generation or permission change. Auth, user consent, host-reported permission, bootstrap reachability and delivery records are separate. Unknown stays unknown.',
      inputSchema: z.object({}),
      outputSchema,
      annotations: readonly,
    },
    handle(() => store.inspect()),
  );
  server.registerTool(
    'update_creation_environment',
    {
      description:
        'Configure only user-stated provider/capability choices; record the user’s exact network approval for the displayed plan hash. report-host-network requires actual host permission evidence, never inferred from a click or network probe. No firewall change. check-network sends bounded HEAD requests only after approval and host evidence. Revoke clears local consent and requires a separate host revocation. Refresh accepts bundled-identical or trusted signed profiles only. Delivery is a record check, never proof of display.',
      inputSchema: z.object({ expectedRevision: z.number().int().min(0), change: environmentChange }),
      outputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handle(({ expectedRevision, change }) => store.update(expectedRevision, change)),
  );
  server.registerTool(
    'prepare_generation_login',
    {
      description:
        'Prepare the official GPT device login command for the configured environment after host network approval. Does not execute or authenticate. Run only within a user-requested account connection, through the normal host tool. Tokens and callback URLs never go through chat. Grok onboarding is not implemented here.',
      inputSchema: z.object({}),
      outputSchema,
      annotations: readonly,
    },
    handle(() => store.prepareLogin()),
  );
  return store;
}
