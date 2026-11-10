// @ts-check
// Runs the dummy creation scenarios and prints a step-by-step report. No production URL is contacted.
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFighterJson } from '../../contracts/ai-fighter/validate.mjs';
import { runRegister } from '../../scripts/register-fighter.mjs';
import { validateFighterPackage } from '../../server/ai-fighter-package.mjs';
import { annotateValidation } from '../../tools/ai-fighter/landmark-lint.mjs';
import { createDummyClient } from './client.mjs';
import { createConnector } from './connector.mjs';
import { FIXTURES, SCENARIOS, checkDocs, checkFixtures } from './prompts.mjs';
import { DUMMY_LABEL } from './seal.mjs';
import { startDummyServer } from './server.mjs';
import { createDummyPackage, createDummyProfileSet, readPackageFiles } from './sprites.mjs';
import { createDummyStore } from './store.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KEY = {
  cli: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  revise: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  mcp: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  missing: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  reject: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  hosted: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  legacy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
  quota: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
  rejectCli: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
};
const STYLE = { mix: { slam: 3, combo: 2, fast: 1 }, special: 'slam', super: 'dash', distance: 2, temper: { patience: 5 }, summon: 'sportsCar' };

/** @typedef {{ kind: 'agent' | 'probe', tool?: string, selector?: string, title: string, detail: string, ok: boolean }} Event */
/** @typedef {{ id: string, title: string, expect: { tool: string, selector?: string }[] | null, ok: boolean, events: Event[] }} RunState */

/** @param {string} id @returns {RunState} */
function begin(id) {
  const meta = SCENARIOS.find(item => item.id === id);
  if (!meta) throw new Error(`unknown-scenario:${id}`);
  return { id, title: meta.title, expect: meta.expect, ok: true, events: [] };
}
/** @param {RunState} state @param {string} tool @param {string} selector @param {string} title @param {string} detail @param {boolean} [ok] */
function agent(state, tool, selector, title, detail, ok = true) {
  state.events.push({ kind: 'agent', tool, selector, title, detail, ok });
  if (!ok) state.ok = false;
}
/** @param {RunState} state @param {string} title @param {string} detail @param {boolean} [ok] */
function probe(state, title, detail, ok = true) {
  state.events.push({ kind: 'probe', title, detail, ok });
  if (!ok) state.ok = false;
}
/** @param {RunState} state */
function checkSequence(state) {
  if (!state.expect) return;
  const taken = state.events.filter(event => event.kind === 'agent');
  const wanted = state.expect.map(step => `${step.tool}${step.selector ? `:${step.selector}` : ''}`);
  const got = taken.map(event => `${event.tool}${event.selector ? `:${event.selector}` : ''}`);
  const same = wanted.length === got.length && wanted.every((step, index) => step === got[index] && taken[index].ok);
  if (!same) probe(state, 'sequence', `expected ${wanted.join(' → ')} but ran ${got.join(' → ')}`, false);
}

/** @param {string} source @param {string} dest */
const copyPackage = (source, dest) => cp(source, dest, { recursive: true });

/** @param {string} dir */
async function validatePackage(dir) {
  const manifestPath = path.join(dir, 'fighter.json');
  const text = await readFile(manifestPath, 'utf8');
  const parsed = parseFighterJson(text);
  const result = annotateValidation(await validateFighterPackage(manifestPath), parsed.ok ? parsed.data : null);
  const warnings = Array.isArray(result.warnings) ? result.warnings.map((/** @type {any} */ warning) => warning.code).join(', ') : '';
  return {
    ok: result.ok === true,
    detail: `stage ${result.stage}, assets ${parsed.data?.assets?.length ?? 0}, pending [${(result.pending ?? []).join(', ')}]${warnings ? `, warnings ${warnings}` : ''}`,
    result,
  };
}

/**
 * @param {string} dir
 * @param {string} url
 * @param {string[]} extra
 */
async function cliSubmit(dir, url, extra = []) {
  let calls = 0;
  const result = await runRegister({
    argv: ['--dir', dir, '--dummy', url, '--submit', ...extra],
    env: {},
    wait: async () => {},
    connect: async () => {
      calls += 1;
      throw new Error('production-connect-called');
    },
  });
  return { result, calls };
}

/** @param {ReturnType<typeof createDummyStore>} store @param {string[]} roots */
const connectorFor = (store, roots) => createConnector(store, { roots });

/**
 * @param {any} connector
 * @param {string} submissionId
 * @param {string} dir
 * @param {any[]} missing
 */
async function uploadMissing(connector, submissionId, dir, missing) {
  for (const asset of missing) {
    const body = await connector.call('upload_fighter_asset', { kind: 'package', submissionId, assetId: asset.id, filePath: path.join(dir, asset.path) });
    if (!body.ok) return { ok: false, count: 0, code: body.code };
  }
  return { ok: true, count: missing.length, code: '' };
}

/** @param {{ scenario?: string }} [options] */
export async function runFlows({ scenario } = {}) {
  const known = SCENARIOS.map(item => item.id);
  if (scenario && !known.includes(scenario)) throw new Error(`unknown-scenario:${scenario}`);
  const ids = scenario ? [scenario, ...(scenario === 'guard' ? [] : ['guard'])] : known;
  const work = await mkdtemp(path.join(tmpdir(), 'oddbout-dummy-'));
  /** @type {RunState[]} */
  const scenarios = [];
  try {
    const drill = await createDummyPackage(path.join(work, 'drill'), {
      name: 'DUMMY Drill Bot',
      localId: 'dummy-drill-bot',
      prompt: 'teal geometric drill bot',
    });
    const revised = await createDummyPackage(path.join(work, 'revised'), {
      variant: 'challenger',
      name: 'DUMMY Drill Bot v2',
      localId: 'dummy-drill-bot-v2',
      prompt: 'revised drill bot, walk changed as placeholder pixels',
    });
    const drillCheck = await validatePackage(drill.dir);
    const revisedCheck = await validatePackage(revised.dir);
    const profileDir = path.join(work, 'profile');
    const profile = await createDummyProfileSet(profileDir);
    const pack = await readPackageFiles(drill.dir);
    const roots = [work];

    /** @type {Record<string, (state: RunState) => Promise<void>>} */
    const runners = {
      async 'hosted-new'(state) {
        const store = createDummyStore();
        store.setPlaceholder(pack);
        const connector = connectorFor(store, roots);
        const profileBody = await connector.call('get_profile');
        agent(
          state,
          'get_profile',
          '',
          'get_profile',
          `id ${profileBody.id}, ${profileBody.email}, nickname ${profileBody.nickname}`,
          profileBody.ok && profileBody.nickname === 'ODDBOUT' && profileBody.production === false,
        );
        const ready = await connector.call('get_my_fighters', { view: 'readiness', purpose: 'generation' });
        agent(
          state,
          'get_my_fighters',
          'readiness',
          'get_my_fighters view readiness',
          `registration ${ready.registration?.status}, generation ${ready.generation?.status}`,
          ready.ok && ready.generation?.status === 'dummy-placeholder',
        );
        const spec = await connector.call('get_fighter_spec', { section: 'overview' });
        agent(
          state,
          'get_fighter_spec',
          'overview',
          'get_fighter_spec overview',
          `motions ${spec.data?.motions?.length}`,
          spec.ok && spec.data?.motions?.length === 11,
        );
        store.setTokenBalance(0);
        const blocked = await connector.call('request_hosted_fighter', {
          description: '빨간 글러브를 낀 고양이 복서',
          language: 'ko',
          idempotencyKey: KEY.hosted,
        });
        probe(
          state,
          'zero token balance',
          `code ${blocked.code}, tokensCharged ${blocked.tokensCharged}`,
          blocked.ok === false && blocked.code === 'generation-quota' && blocked.tokensCharged === false,
        );
        store.setTokenBalance(500_000);
        const requested = await connector.call('request_hosted_fighter', {
          description: '빨간 글러브를 낀 고양이 복서, 귀가 크다',
          language: 'ko',
          idempotencyKey: KEY.hosted,
        });
        agent(
          state,
          'request_hosted_fighter',
          'request',
          'request_hosted_fighter step request',
          `status ${requested.job?.status}, candidates ${(requested.job?.candidates ?? []).map((/** @type {any} */ item) => item.label).join(', ')}, tokensCharged ${requested.tokensCharged}`,
          requested.ok && requested.job?.status === 'appearance_ready' && requested.tokensCharged === false && requested.job?.appearanceAutoSelection === null,
        );
        const choice = await connector.call('request_hosted_fighter', { step: 'choose_look', jobId: requested.job.id, choice: 'a' });
        agent(
          state,
          'request_hosted_fighter',
          'choose_look',
          'request_hosted_fighter step choose_look',
          `choice a, status ${choice.job?.status}`,
          choice.ok && choice.job?.status === 'motions',
        );
        /** @type {any} */
        let watched = choice;
        /** @type {string[]} */
        const seen = [];
        for (let read = 0; read < 16 && !watched.statusSummary?.terminal; read++) {
          watched = await connector.call('get_hosted_fighter', { jobId: requested.job.id, waitSeconds: 25 });
          if ((watched.job?.drafts?.length ?? 0) > seen.length) seen.push(watched.job.drafts.at(-1));
        }
        agent(
          state,
          'get_hosted_fighter',
          'until-registered',
          'get_hosted_fighter until registered',
          `drafts ${seen.join(', ')}; state ${watched.statusSummary?.state}; fighter ${watched.job?.submission?.fighterId}; tokensCharged ${watched.tokensCharged}; waitedMs ${watched.waitedMs}`,
          watched.statusSummary?.completed === true && seen.length === 11 && watched.tokensCharged === false && watched.waitedMs === 0,
        );
      },
      async 'workspace-new'(state) {
        const store = createDummyStore();
        const connector = connectorFor(store, roots);
        const profileBody = await connector.call('get_profile');
        agent(state, 'get_profile', '', 'get_profile', `${profileBody.id} ${profileBody.email}`, profileBody.ok && profileBody.nickname === 'ODDBOUT');
        const ready = await connector.call('get_my_fighters', { view: 'readiness' });
        agent(
          state,
          'get_my_fighters',
          'readiness',
          'get_my_fighters view readiness',
          ready.registration?.status ?? '',
          ready.ok && ready.registration?.status === 'ready',
        );
        const spec = await connector.call('get_fighter_spec', { section: 'overview' });
        agent(state, 'get_fighter_spec', 'overview', 'get_fighter_spec overview', `spec ${spec.data?.specVersion}`, spec.ok);
        agent(
          state,
          'local',
          'placeholder-sprites',
          'placeholder sprites',
          `${drill.data.localId}, name ${drill.data.profile.name}`,
          drill.data.profile.description.includes('ODDBOUT-DUMMY'),
        );
        agent(state, 'local', 'validate', 'validate placeholder package', drillCheck.detail, drillCheck.ok);
        const prepared = await connector.call('prepare_fighter_registration', { kind: 'package', manifestPath: drill.manifestPath, idempotencyKey: KEY.mcp });
        agent(
          state,
          'prepare_fighter_registration',
          'package',
          'prepare_fighter_registration kind package',
          `stage ${prepared.stage}, pending [${(prepared.pending ?? []).join(', ')}], missing ${prepared.missingAssets?.length}`,
          prepared.ok && prepared.stage === 'uploading' && prepared.missingAssets?.length === 11 && !(prepared.pending ?? []).includes('idle'),
        );
        const uploaded = await uploadMissing(connector, prepared.submissionId, drill.dir, prepared.missingAssets);
        agent(
          state,
          'upload_fighter_asset',
          'package',
          'upload_fighter_asset for each missingAssets id',
          `${uploaded.count} files`,
          uploaded.ok && uploaded.count === 11,
        );
        const submitted = await connector.call('submit_fighter_registration', { kind: 'package', submissionId: prepared.submissionId });
        agent(
          state,
          'submit_fighter_registration',
          'package',
          'submit_fighter_registration kind package',
          `stage ${submitted.stage}`,
          submitted.ok && submitted.stage === 'validating',
        );
        const status = await connector.call('get_my_fighters', { view: 'submission', submissionId: prepared.submissionId });
        agent(
          state,
          'get_my_fighters',
          'submission',
          'get_my_fighters view submission',
          `stage ${status.stage}, fighter ${status.fighterId}, event ${status.event?.kind}`,
          status.ok && status.stage === 'registered' && status.event?.kind === 'submission-registered',
        );
        if (!profile.ok || !('folder' in profile)) {
          agent(state, 'prepare_fighter_registration', 'profile_set', 'profile set build', JSON.stringify(profile.errors ?? profile).slice(0, 300), false);
          return;
        }
        const setPrepared = await connector.call('prepare_fighter_registration', {
          kind: 'profile_set',
          fighterId: status.fighterId,
          manifestPath: path.join(profile.folder, 'profile-set.json'),
        });
        agent(
          state,
          'prepare_fighter_registration',
          'profile_set',
          'prepare_fighter_registration kind profile_set',
          `missing ${(setPrepared.missingAssets ?? []).map((/** @type {any} */ asset) => asset.id).join(', ')}`,
          setPrepared.ok && setPrepared.stage === 'uploading',
        );
        const front = await connector.call('upload_fighter_asset', {
          kind: 'profile_set',
          setId: setPrepared.setId,
          assetId: 'front',
          filePath: path.join(profile.folder, 'front.webp'),
        });
        agent(state, 'upload_fighter_asset', 'profile_set:front', 'upload profile front', `bytes ${front.bytes}`, front.ok === true);
        const expressions = await connector.call('upload_fighter_asset', {
          kind: 'profile_set',
          setId: setPrepared.setId,
          assetId: 'expressions',
          filePath: path.join(profile.folder, 'expressions.webp'),
        });
        agent(state, 'upload_fighter_asset', 'profile_set:expressions', 'upload expression sheet', `bytes ${expressions.bytes}`, expressions.ok === true);
        const setSubmitted = await connector.call('submit_fighter_registration', { kind: 'profile_set', setId: setPrepared.setId });
        agent(
          state,
          'submit_fighter_registration',
          'profile_set',
          'submit_fighter_registration kind profile_set',
          `front.ok ${setSubmitted.front?.ok}, operatorApproved ${setSubmitted.front?.operatorApproved}`,
          setSubmitted.ok && setSubmitted.front?.ok === true && setSubmitted.front?.operatorApproved === false,
        );
        const fighter = await connector.call('get_my_fighters', { view: 'fighter', fighterId: status.fighterId });
        const entered = await connector.call('enter_fighter', { fighterId: status.fighterId });
        agent(
          state,
          'get_my_fighters',
          'fighter',
          'get_my_fighters view fighter',
          `status ${fighter.fighter?.status}, publicPlay ${fighter.fighter?.publicPlay}, front.ok ${fighter.fighter?.front?.ok}`,
          fighter.ok && fighter.fighter?.publicPlay === false && fighter.fighter?.front?.ok === true,
        );
        probe(
          state,
          'enter_fighter stays off the public roster',
          `publicPlay ${entered.publicPlay}, productionRoster ${entered.productionRoster}`,
          entered.ok && entered.publicPlay === false && entered.productionRoster === false,
        );
      },
      async 'cli-register'(state) {
        const dir = path.join(work, 'cli');
        await copyPackage(drill.dir, dir);
        const store = createDummyStore();
        const server = await startDummyServer(store);
        try {
          const connector = connectorFor(store, roots);
          const profileBody = await connector.call('get_profile');
          agent(state, 'get_profile', '', 'get_profile', profileBody.email, profileBody.nickname === 'ODDBOUT');
          const ready = await connector.call('get_my_fighters', { view: 'readiness', purpose: 'registration' });
          agent(
            state,
            'get_my_fighters',
            'readiness',
            'get_my_fighters view readiness',
            ready.registration?.status ?? '',
            ready.registration?.status === 'ready',
          );
          agent(state, 'local', 'placeholder-sprites', 'placeholder sprites', drill.data.profile.name, true);
          agent(state, 'local', 'validate', 'validate placeholder package', drillCheck.detail, drillCheck.ok);
          const first = await cliSubmit(dir, server.url, ['--idempotency-key', KEY.cli]);
          agent(
            state,
            'fighter:register',
            'submit',
            'fighter:register --dummy --submit',
            `ok ${first.result.ok}, stage ${first.result.stage}, polls ${first.result.polls}, fighter ${first.result.fighterId}, production connects ${first.calls}`,
            first.result.ok === true &&
              first.result.stage === 'registered' &&
              first.result.polls === 1 &&
              first.calls === 0 &&
              first.result.production === false,
          );
          const status = await connector.call('get_my_fighters', { view: 'submission', submissionId: first.result.submissionId });
          agent(
            state,
            'get_my_fighters',
            'submission',
            'connector sees the CLI submission',
            `stage ${status.stage}, event ${status.event?.kind}`,
            status.stage === 'registered',
          );
          const again = await cliSubmit(dir, server.url);
          agent(
            state,
            'fighter:register',
            'retry',
            'retry the same bytes and key',
            `same submission ${again.result.submissionId === first.result.submissionId}, reused ${again.result.idempotencyKeyReused}`,
            again.result.ok === true &&
              again.result.submissionId === first.result.submissionId &&
              again.result.idempotencyKey === first.result.idempotencyKey &&
              again.calls === 0,
          );
          const page = await fetch(`${server.url}/dummy/page/fighter/${first.result.fighterId}`, { redirect: 'error' });
          const html = await page.text();
          probe(
            state,
            'dummy page',
            `status ${page.status}, labelled ${html.includes('ODDBOUT-DUMMY')}`,
            page.status === 200 && html.includes('ODDBOUT-DUMMY') && !html.includes('oddbout.com'),
          );
        } finally {
          await server.close();
        }
      },
      async revise(state) {
        const original = path.join(work, 'revise-a');
        const next = path.join(work, 'revise-b');
        await copyPackage(drill.dir, original);
        await copyPackage(revised.dir, next);
        const store = createDummyStore();
        const server = await startDummyServer(store);
        try {
          const connector = connectorFor(store, roots);
          const created = await cliSubmit(original, server.url, ['--idempotency-key', KEY.cli]);
          if (created.result.ok !== true) {
            probe(state, 'setup registration', `code ${created.result.code}`, false);
            return;
          }
          const profileBody = await connector.call('get_profile');
          agent(state, 'get_profile', '', 'get_profile', profileBody.id, profileBody.nickname === 'ODDBOUT');
          const list = await connector.call('get_my_fighters', { view: 'list' });
          agent(
            state,
            'get_my_fighters',
            'list',
            'get_my_fighters view list',
            `count ${list.account?.fighterCount}, limit ${list.account?.fighterLimit}`,
            list.account?.fighterCount === 1 && list.fighters?.[0]?.id === created.result.fighterId,
          );
          agent(state, 'local', 'placeholder-sprites', 'new placeholder package', revised.data.profile.name, revised.data.localId === 'dummy-drill-bot-v2');
          agent(state, 'local', 'validate', 'validate revised package', revisedCheck.detail, revisedCheck.ok);
          const updated = await cliSubmit(next, server.url, ['--fighter', created.result.fighterId, '--idempotency-key', KEY.revise]);
          const previous = await connector.call('get_my_fighters', { view: 'submission', submissionId: created.result.submissionId });
          agent(
            state,
            'fighter:register',
            'revise',
            'fighter:register --fighter --dummy --submit',
            `fighter ${updated.result.fighterId} stays, new submission ${updated.result.submissionId}, previous submission still ${previous.stage}`,
            updated.result.ok === true &&
              updated.result.fighterId === created.result.fighterId &&
              updated.result.submissionId !== created.result.submissionId &&
              previous.stage === 'registered' &&
              previous.manifestSha256 !== updated.result.manifestSha256 &&
              updated.calls === 0,
          );
          const current = await connector.call('get_my_fighters', { view: 'submission', submissionId: updated.result.submissionId });
          agent(
            state,
            'get_my_fighters',
            'submission',
            'get_my_fighters view submission',
            `stage ${current.stage}, fighter ${current.fighterId}`,
            current.stage === 'registered' && current.fighterId === created.result.fighterId,
          );
          const same = await connector.call('prepare_fighter_registration', {
            kind: 'package',
            manifestPath: path.join(next, 'fighter.json'),
            fighterId: created.result.fighterId,
            idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
          });
          probe(state, 'same bytes are fighter-unchanged', `code ${same.code}`, same.ok === false && same.code === 'fighter-unchanged');
        } finally {
          await server.close();
        }
      },
      async 'style-only'(state) {
        const store = createDummyStore({ seed: true });
        const connector = connectorFor(store, roots);
        const profileBody = await connector.call('get_profile');
        agent(state, 'get_profile', '', 'get_profile', profileBody.nickname, profileBody.nickname === 'ODDBOUT');
        const list = await connector.call('get_my_fighters', { view: 'list' });
        const fighterId = list.fighters?.[0]?.id;
        agent(
          state,
          'get_my_fighters',
          'list',
          'get_my_fighters view list',
          `count ${list.account?.fighterCount}, limit ${list.account?.fighterLimit}`,
          Boolean(fighterId) && list.account?.fighterLimit === 3,
        );
        const guide = await connector.call('browse_oddbout', { view: 'style_guide' });
        agent(
          state,
          'browse_oddbout',
          'style_guide',
          'browse_oddbout view style_guide',
          `extrasBudget ${guide.rules?.extrasBudget}`,
          guide.ok && guide.rules?.extrasBudget === 2,
        );
        const bad = await connector.call('update_fighter', { kind: 'style', fighterId, style: { mix: { slam: 0, combo: 0, fast: 4 } } });
        probe(state, 'illegal mix is refused', `code ${bad.code}`, bad.ok === false && bad.code === 'invalid-style');
        const saved = await connector.call('update_fighter', { kind: 'style', fighterId, style: STYLE });
        agent(
          state,
          'update_fighter',
          'style',
          'update_fighter kind style',
          `super ${saved.style?.super}, artChanged ${saved.artChanged}`,
          saved.ok && saved.style?.super === 'dash' && saved.artChanged === false,
        );
      },
      async quota(state) {
        const store = createDummyStore({ seed: true, fighterLimit: 1 });
        const server = await startDummyServer(store);
        try {
          const connector = connectorFor(store, roots);
          const profileBody = await connector.call('get_profile');
          agent(state, 'get_profile', '', 'get_profile', profileBody.id, profileBody.ok);
          const list = await connector.call('get_my_fighters', { view: 'list' });
          agent(
            state,
            'get_my_fighters',
            'list',
            'get_my_fighters view list',
            `count ${list.account?.fighterCount} / limit ${list.account?.fighterLimit}, exceeded ${list.quota?.exceeded}`,
            list.quota?.exceeded === true && list.account?.fighterCount === 1,
          );
          const dir = path.join(work, 'quota');
          await copyPackage(drill.dir, dir);
          const attempted = await connector.call('prepare_fighter_registration', {
            kind: 'package',
            manifestPath: path.join(dir, 'fighter.json'),
            idempotencyKey: KEY.quota,
          });
          probe(state, 'prepare is fighter-quota', `code ${attempted.code}`, attempted.ok === false && attempted.code === 'fighter-quota');
          const viaCli = await cliSubmit(dir, server.url, ['--idempotency-key', KEY.quota]);
          probe(
            state,
            'fighter:register --dummy is fighter-quota',
            `code ${viaCli.result.code}, production connects ${viaCli.calls}`,
            viaCli.result.ok === false && viaCli.result.code === 'fighter-quota' && viaCli.calls === 0,
          );
        } finally {
          await server.close();
        }
      },
      async 'missing-asset'(state) {
        const store = createDummyStore();
        const connector = connectorFor(store, roots);
        const prepared = await connector.call('prepare_fighter_registration', {
          kind: 'package',
          manifestPath: drill.manifestPath,
          idempotencyKey: KEY.missing,
        });
        agent(
          state,
          'prepare_fighter_registration',
          'package',
          'prepare_fighter_registration',
          `missing ${prepared.missingAssets?.length}, pending [${(prepared.pending ?? []).join(', ')}]`,
          prepared.ok && prepared.stage === 'uploading',
        );
        const early = await connector.call('submit_fighter_registration', { submissionId: prepared.submissionId });
        probe(state, 'submit before upload', `code ${early.code}`, early.ok === false && early.code === 'assets-incomplete');
        const wrong = await connector.call('upload_fighter_asset', {
          submissionId: prepared.submissionId,
          assetId: 'server-validation',
          filePath: drill.manifestPath,
        });
        probe(state, 'pending name is not an asset id', `code ${wrong.code}`, wrong.ok === false && wrong.code === 'asset-not-found');
        const uploaded = await uploadMissing(connector, prepared.submissionId, drill.dir, prepared.missingAssets);
        agent(state, 'upload_fighter_asset', 'package', 'upload each missingAssets id', `${uploaded.count} after the 409`, uploaded.ok);
        const submitted = await connector.call('submit_fighter_registration', { submissionId: prepared.submissionId });
        agent(
          state,
          'submit_fighter_registration',
          'package',
          'submit after the missing files',
          `stage ${submitted.stage}`,
          submitted.ok && submitted.stage === 'validating',
        );
        const status = await connector.call('get_my_fighters', { view: 'submission', submissionId: prepared.submissionId });
        agent(state, 'get_my_fighters', 'submission', 'get_my_fighters view submission', `stage ${status.stage}`, status.stage === 'registered');
      },
      async rejected(state) {
        const store = createDummyStore({ policy: 'reject-review' });
        const server = await startDummyServer(store);
        try {
          const connector = connectorFor(store, roots);
          const prepared = await connector.call('prepare_fighter_registration', { manifestPath: drill.manifestPath, idempotencyKey: KEY.reject });
          agent(state, 'prepare_fighter_registration', 'package', 'prepare_fighter_registration', `stage ${prepared.stage}`, prepared.ok);
          const uploaded = await uploadMissing(connector, prepared.submissionId, drill.dir, prepared.missingAssets);
          agent(state, 'upload_fighter_asset', 'package', 'upload assets', `${uploaded.count}`, uploaded.ok);
          const submitted = await connector.call('submit_fighter_registration', { submissionId: prepared.submissionId });
          agent(state, 'submit_fighter_registration', 'package', 'submit_fighter_registration', `stage ${submitted.stage}`, submitted.stage === 'validating');
          const status = await connector.call('get_my_fighters', { view: 'submission', submissionId: prepared.submissionId });
          agent(
            state,
            'get_my_fighters',
            'submission',
            'review rejection returned to the agent',
            `stage ${status.stage}, code ${status.code}, reason ${status.reason}`,
            status.stage === 'rejected' && status.code === 'review-rejected' && status.event?.kind === 'submission-rejected',
          );
          const dir = path.join(work, 'reject');
          await copyPackage(drill.dir, dir);
          const viaCli = await cliSubmit(dir, server.url, ['--idempotency-key', KEY.rejectCli]);
          probe(
            state,
            'CLI maps a rejected stage to validation-rejected',
            `code ${viaCli.result.code}, rejection ${viaCli.result.rejection}, production connects ${viaCli.calls}`,
            viaCli.result.ok === false && viaCli.result.code === 'validation-rejected' && viaCli.result.rejection === 'review' && viaCli.calls === 0,
          );
        } finally {
          await server.close();
        }
      },
      async 'legacy-motion'(state) {
        const store = createDummyStore({ policy: 'legacy-motion' });
        store.setPlaceholder(pack);
        const connector = connectorFor(store, roots);
        const requested = await connector.call('request_hosted_fighter', {
          description: 'legacy drill bot at motion_ready',
          language: 'en',
          idempotencyKey: KEY.legacy,
        });
        const tooSoon = await connector.call('request_hosted_fighter', { step: 'revise_motion', jobId: requested.job.id, motion: 'walk', note: 'slower' });
        probe(
          state,
          'revise_motion before motion_ready',
          `code ${tooSoon.code}, applied ${tooSoon.applied}`,
          tooSoon.ok === false && tooSoon.code === 'generation-state' && tooSoon.applied === false,
        );
        const choice = await connector.call('request_hosted_fighter', { step: 'choose_look', jobId: requested.job.id, choice: 'b' });
        if (choice.job?.status !== 'motion_ready') {
          probe(state, 'setup motion_ready', `status ${choice.job?.status}`, false);
          return;
        }
        const current = await connector.call('get_hosted_fighter', { jobId: requested.job.id });
        agent(state, 'get_hosted_fighter', 'job', 'get_hosted_fighter', `status ${current.job?.status}`, current.job?.status === 'motion_ready');
        const revisedMotion = await connector.call('request_hosted_fighter', {
          step: 'revise_motion',
          jobId: requested.job.id,
          motion: 'walk',
          note: 'slower walk',
        });
        agent(
          state,
          'request_hosted_fighter',
          'revise_motion',
          'request_hosted_fighter step revise_motion',
          `applied ${revisedMotion.applied}, artChanged ${revisedMotion.artChanged}, motion ${revisedMotion.job?.motionNote?.motion}`,
          revisedMotion.ok && revisedMotion.applied === true && revisedMotion.artChanged === false,
        );
        const registered = await connector.call('submit_fighter_registration', { kind: 'hosted', jobId: requested.job.id });
        agent(
          state,
          'submit_fighter_registration',
          'hosted',
          'submit_fighter_registration kind hosted',
          `stage ${registered.job?.submission?.stage}, fighter ${registered.job?.submission?.fighterId}`,
          registered.ok && registered.job?.submission?.stage === 'registered',
        );
        const after = await connector.call('get_hosted_fighter', { jobId: requested.job.id });
        agent(
          state,
          'get_hosted_fighter',
          'job',
          'get_hosted_fighter after registration',
          `state ${after.statusSummary?.state}, completed ${after.statusSummary?.completed}`,
          after.statusSummary?.completed === true && after.statusSummary?.actionRequired === 'enter_on_site',
        );
      },
      async guard(state) {
        const dir = path.join(work, 'guard');
        await copyPackage(drill.dir, dir);
        let calls = 0;
        const refused = await runRegister({
          argv: ['--dir', dir, '--submit'],
          env: {},
          connect: async () => {
            calls += 1;
            throw new Error('production-connect-called');
          },
        });
        probe(
          state,
          'sealed package without --dummy',
          `code ${refused.code}, production connects ${calls}`,
          refused.ok === false && refused.code === 'dummy-package-refused' && calls === 0 && refused.production === false,
        );
        let fetches = 0;
        let refusedCode = '';
        try {
          await createDummyClient('https://oddbout.com/functions/v1/ai-fighter', {
            fetchImpl: async () => {
              fetches += 1;
              throw new Error('fetched');
            },
          });
        } catch (/** @type {any} */ error) {
          refusedCode = error instanceof Error ? error.message : String(error);
        }
        probe(state, 'production-shaped URL', `code ${refusedCode}, fetches ${fetches}`, refusedCode === 'dummy-url-refused' && fetches === 0);
        const fake = await listenJson({ ok: true, mode: 'production', production: true });
        try {
          let handshake = '';
          try {
            await createDummyClient(fake.url);
          } catch (/** @type {any} */ error) {
            handshake = error instanceof Error ? error.message : String(error);
          }
          probe(state, 'loopback server that is not labelled dummy', `code ${handshake}`, handshake === 'dummy-response-unlabelled');
        } finally {
          await fake.close();
        }
        const dry = await runRegister({
          argv: ['--dir', dir, '--dummy', 'http://127.0.0.1:9'],
          env: {},
          connect: async () => {
            calls += 1;
            throw new Error('production-connect-called');
          },
        });
        probe(
          state,
          'dry run against a loopback URL does not connect',
          `dryRun ${dry.dryRun}, mode ${dry.mode}, connects ${calls}`,
          dry.ok === true && dry.dryRun === true && dry.mode === 'dummy' && calls === 0,
        );
      },
    };

    for (const id of ids) {
      const state = begin(id);
      try {
        await runners[id](state);
        checkSequence(state);
      } catch (/** @type {any} */ error) {
        probe(state, 'threw', error instanceof Error ? error.message : String(error), false);
      }
      scenarios.push(state);
    }
    const docs = await checkDocs(ROOT);
    const fixtures = checkFixtures();
    const recognition = FIXTURES.map(fixture => {
      const hits = FIXTURES.filter(item => item.pattern?.test(fixture.prompt));
      const ok = fixture.scenario === null ? hits.length === 0 : hits.length === 1 && hits[0].id === fixture.id;
      return {
        id: fixture.id,
        prompt: fixture.prompt,
        scenario: fixture.scenario,
        ok,
        detail: ok ? (fixture.scenario ?? 'no tools') : `hits ${hits.map(item => item.id).join(', ') || 'none'}`,
      };
    });
    const ok = docs.ok && fixtures.ok && scenarios.every(item => item.ok) && recognition.every(item => item.ok);
    return { ok, label: DUMMY_LABEL, productionContact: false, tokensSpent: 0, docs, fixtures, recognition, scenarios };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** @param {Record<string, unknown>} body */
function listenJson(body) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise(done => {
            server.close(() => done(undefined));
          }),
      });
    });
  });
}

/** @param {Awaited<ReturnType<typeof runFlows>>} result */
export function formatReport(result) {
  /** @type {string[]} */
  const lines = [
    result.label,
    'productionContact: none',
    `tokensSpent: ${result.tokensSpent}`,
    'generation: deterministic placeholder sprites (no model call)',
    '',
    `docs: ${result.docs.ok ? 'PASS' : 'FAIL'}${result.docs.problems.length ? ` — ${result.docs.problems.join('; ')}` : ''}`,
    `fixtures: ${result.fixtures.ok ? 'PASS' : 'FAIL'}${result.fixtures.problems.length ? ` — ${result.fixtures.problems.join('; ')}` : ''}`,
    '',
    'prompt recognition (scripted rules checked against the skill and AGENTS.md, not a live model):',
  ];
  for (const item of result.recognition) lines.push(`  [${item.ok ? 'PASS' : 'FAIL'}] ${item.id} → ${item.detail}`);
  lines.push('');
  for (const scenario of result.scenarios) {
    lines.push(`[${scenario.ok ? 'PASS' : 'FAIL'}] ${scenario.id} — ${scenario.title}`);
    for (const event of scenario.events) {
      const name = event.kind === 'agent' ? `${event.tool}${event.selector ? `:${event.selector}` : ''}` : 'probe';
      lines.push(`  ${event.ok ? 'ok' : 'FAIL'}  ${name}  ${event.title}${event.detail ? ` — ${event.detail}` : ''}`);
    }
    lines.push('');
  }
  lines.push(result.ok ? 'result: PASS' : 'result: FAIL');
  return lines.join('\n');
}
