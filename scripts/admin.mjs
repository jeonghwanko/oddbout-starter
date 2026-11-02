// @ts-check
// 운영자 화면(admin.html)을 에이전트가 쓰는 길 (2026-11-01). The operator's own sign-in (`npm run login`, or `--device` on a VM) is the
// only credential: the admin API takes his session as it takes the site's, and refuses any account that is not an operator.
// Usage: npm run admin -- <command> [args] [--yes] [--session <file>]
//   whoami | review | open | show <job> | retry <job> | cancel <job>
//   hosts | host-approve <host> | host-withdraw <host>
//   profiles [--status review|approved|rejected] | profile-approve <set> | profile-reject <set> --reason <text>
//   fighters [--status active|removed|all] [--search <text>] [--page <n>] | fighter-remove <fighter> --version <n> --reason <text>
//   fighter-restore <fighter> --version <n> --reason <text>
//   fighter <fighter> | replace-package <fighter> <package dir or fighter.json> --reason <text> [--key <uuid>]
//   edit-profile <fighter> --reason <text> [--profile <json or @file>] [--style <json, null or @file>]
// Every answer is one JSON object on stdout. A command that changes something only shows what it would do (`dryRun: true`) until it is
// run again with --yes: the agent shows that to its user and asks first.
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteClient } from '../api/client.mjs';
import { parseFighterJson, validateFighter } from '../contracts/ai-fighter/validate.mjs';
import { defaultSessionPath } from './login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @typedef {{ request: (route: string, options?: { method?: string, body?: any, headers?: Record<string, string> }) => Promise<any> }} Client */
/**
 * @typedef {{ method: 'GET' | 'POST', route: string, body?: Record<string, unknown>, change?: string }} Call
 *   `change` (a sentence for the user) marks a command that changes something; only --yes sends it.
 */

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, string | true>} */
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const name = arg.slice(2);
    if (['yes', 'help'].includes(name)) flags[name] = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
    else throw new Error(`missing-value:--${name}`);
  }
  return { positional, flags };
}

/** @param {string | true | undefined} value @param {string} name */
function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing-value:--${name}`);
  return value.trim();
}
/** @param {string | undefined} value @param {string} what */
function id(value, what) {
  if (!value || !UUID.test(value)) throw new Error(`invalid-id:${what}`);
  return value.toLowerCase();
}

/**
 * The admin API call a command makes. Throws `unknown-command:<name>` or a missing or invalid argument.
 * @param {string[]} positional @param {Record<string, string | true>} flags
 * @returns {Call}
 */
export function planCall([command, target], flags) {
  const query = (/** @type {Record<string, string>} */ values) => new URLSearchParams(values).toString();
  switch (command) {
    case 'whoami': return { method: 'GET', route: 'me' };
    case 'review': return { method: 'GET', route: `generations?${query({ status: 'needs_review' })}` };
    case 'open': return { method: 'GET', route: `generations?${query({ status: 'open' })}` };
    case 'show': return { method: 'GET', route: `generations/${id(target, 'job')}` };
    case 'retry': return { method: 'POST', route: `generations/${id(target, 'job')}/retry`, body: {}, change: `신청 ${target}의 멈춘 단계를 다시 돌립니다.` };
    case 'cancel': return { method: 'POST', route: `generations/${id(target, 'job')}/cancel`, body: {}, change: `신청 ${target}을 취소합니다. 제작자에게 취소로 보입니다.` };
    case 'hosts': return { method: 'GET', route: 'generation-hosts' };
    case 'host-approve': return { method: 'POST', route: `generation-hosts/${id(target, 'host')}/approval`, body: { approved: true },
      change: `호스트 ${target}을 승인합니다. 다른 사람의 신청도 만듭니다.` };
    case 'host-withdraw': return { method: 'POST', route: `generation-hosts/${id(target, 'host')}/approval`, body: { approved: false },
      change: `호스트 ${target}의 승인을 거둡니다. 자기 신청만 만듭니다.` };
    case 'profiles': {
      const status = typeof flags.status === 'string' ? flags.status : 'review';
      if (!['review', 'approved', 'rejected'].includes(status)) throw new Error('invalid-value:--status');
      return { method: 'GET', route: `profile-sets?${query({ status })}` };
    }
    case 'profile-approve': return { method: 'POST', route: `profile-sets/${id(target, 'profile-set')}/approve`, body: {},
      change: `프로필 세트 ${target}을 승인합니다. 홈과 무투장에 보입니다.` };
    case 'profile-reject': {
      const reason = text(flags.reason, 'reason');
      return { method: 'POST', route: `profile-sets/${id(target, 'profile-set')}/reject`, body: { reason },
        change: `프로필 세트 ${target}을 돌려보냅니다. 제작자에게 보이는 이유: ${reason}` };
    }
    case 'fighters': {
      const status = typeof flags.status === 'string' ? flags.status : 'active', page = typeof flags.page === 'string' ? flags.page : '0';
      if (!['active', 'removed', 'all'].includes(status)) throw new Error('invalid-value:--status');
      if (!/^(0|[1-9][0-9]{0,4})$/.test(page)) throw new Error('invalid-value:--page');
      return { method: 'GET', route: `fighters?${query({ status, search: typeof flags.search === 'string' ? flags.search : '', page })}` };
    }
    case 'fighter': return { method: 'GET', route: `fighters/${id(target, 'fighter')}` };
    case 'fighter-remove': case 'fighter-restore': {
      const version = Number(text(flags.version, 'version')), reason = text(flags.reason, 'reason');
      if (!Number.isSafeInteger(version) || version < 0) throw new Error('invalid-value:--version');
      const action = command === 'fighter-remove' ? 'remove' : 'restore';
      return { method: 'POST', route: `fighters/${id(target, 'fighter')}/moderation`, body: { action, version, reason },
        change: `선수 ${target}을 ${action === 'remove' ? '내립니다' : '복원합니다'}. 제작자에게 보이는 사유: ${reason}` };
    }
    default: throw new Error(`unknown-command:${command ?? ''}`);
  }
}

/**
 * Run one command. A change without --yes is not sent: the answer says what it would do.
 * @param {{ argv?: string[], connect?: (sessionPath: string) => Promise<Client>, env?: NodeJS.ProcessEnv, wait?: (ms: number) => Promise<unknown> }} [options]
 *   `wait`: the pause between polls of a replaced package's validation.
 */
export async function runAdmin({ argv = process.argv.slice(2), connect = createRemoteClient, env = process.env,
  wait = (/** @type {number} */ ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const { positional, flags } = parseArgs(argv);
  if (flags.help || !positional.length) return { ok: true, usage: USAGE };
  const signIn = async () => {
    const sessionPath = typeof flags.session === 'string' ? flags.session : env.ODDBOUT_ADMIN_SESSION || defaultSessionPath();
    return connect(sessionPath).catch(error => { throw error?.code === 'ENOENT' ? new Error('client-sign-in-required') : error; });
  };
  if (positional[0] === 'replace-package') return replacePackage(positional, flags, signIn, wait);
  if (positional[0] === 'edit-profile') return editProfile(positional, flags, signIn);
  const call = planCall(positional, flags);
  if (call.change && flags.yes !== true) return { ok: true, dryRun: true, change: call.change, request: { method: call.method, route: `admin/${call.route}`, body: call.body } };
  const client = await signIn();
  const result = await client.request(`admin/${call.route}`, call.method === 'POST'
    ? { method: 'POST', body: JSON.stringify(call.body ?? {}), headers: { 'content-type': 'application/json' } } : {});
  return call.change ? { ...result, done: call.change } : result;
}

/** One idempotency key per (fighter, content): a rerun after a dropped connection resumes the same submission. @param {string[]} parts */
export function editKey(...parts) {
  const hex = createHash('sha256').update(parts.join('\n')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 | parseInt(hex[16], 16) & 3).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const sha256 = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A package on disk (a directory with fighter.json, or the fighter.json itself) as the contract checks it, with every asset's bytes
 * matching the manifest. Throws `package-invalid` (with the contract's errors) or `asset-mismatch:<id>`.
 * @param {string} where
 */
export async function readPackage(where) {
  const manifestPath = (await stat(where)).isDirectory() ? path.join(where, 'fighter.json') : where;
  const text = await readFile(manifestPath, 'utf8'), parsed = parseFighterJson(text);
  const checked = parsed.ok ? validateFighter(parsed.data) : parsed;
  if (!parsed.ok || !checked.ok) throw Object.assign(new Error('package-invalid'), { errors: (checked.errors ?? []).slice(0, 10) });
  /** @type {{ id: string, path: string, bytes: number, sha256: string }[]} */
  const assets = parsed.data.assets, files = [];
  for (const asset of assets) {
    const bytes = await readFile(path.join(path.dirname(manifestPath), asset.path));
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`asset-mismatch:${asset.id}`);
    files.push({ id: asset.id, bytes });
  }
  return { text, sha: sha256(Buffer.from(text, 'utf8')), name: parsed.data.profile?.name ?? '', files };
}

/** A value of --profile or --style: JSON, or `@file` holding JSON. @param {string | true | undefined} value @param {string} name */
async function jsonFlag(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`missing-value:--${name}`);
  try { return JSON.parse(value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value); }
  catch { throw new Error(`invalid-value:--${name}`); }
}

/** The fighter an edit is about, as the operator sees him before it: name, owner, entry and package hash. @param {Client} client @param {string} fighter */
async function current(client, fighter) {
  const { fighter: f } = await client.request(`admin/fighters/${fighter}`);
  return { name: f.name, ownerId: f.ownerId, entered: Boolean(f.enteredAt), manifestSha256: f.manifestSha256 };
}
/** The reason as the edit routes take it: a header, percent-encoded (an address would keep it in the request logs). @param {string} reason */
const reasonHeader = reason => ({ 'x-admin-reason': encodeURIComponent(reason) });

/**
 * replace-package: the owner's create → upload → submit, as the operator, then the validation's answer (polled up to ten minutes). The
 * dry run reads the fighter (name, owner, entry) so the user sees whose fighter changes; the key names the package it replaces, so the
 * same package sent again over a newer one is a new submission, not the old answer. Only a package that is now the fighter's is done.
 * @param {string[]} positional @param {Record<string, string | true>} flags @param {() => Promise<Client>} signIn
 * @param {(ms: number) => Promise<unknown>} wait
 */
async function replacePackage([, target, where], flags, signIn, wait) {
  const fighter = id(target, 'fighter'), reason = text(flags.reason, 'reason');
  if (!where) throw new Error('missing-value:package');
  const pkg = await readPackage(where), client = await signIn(), now = await current(client, fighter);
  const key = typeof flags.key === 'string' ? id(flags.key, 'key') : editKey('package', fighter, now.manifestSha256, pkg.sha);
  const change = `선수 「${now.name}」(${fighter}, 주인 ${now.ownerId}, ${now.entered ? '출전 중 — 유지' : '출전 안 함'})의 패키지를 `
    + `${pkg.sha.slice(0, 12)}…(파일 ${pkg.files.length}개)로 바꿉니다. 사유: ${reason}`;
  const warning = pkg.name !== now.name ? { warning: 'name-differs', packageName: pkg.name, fighterName: now.name } : {};
  if (flags.yes !== true) return { ok: true, dryRun: true, change, ...warning,
    request: { method: 'POST', route: `admin/fighters/${fighter}/submissions`, manifestSha256: pkg.sha, idempotencyKey: key } };
  let state = await client.request(`admin/fighters/${fighter}/submissions`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key, ...reasonHeader(reason) }, body: pkg.text });
  if (state.stage === 'uploading' && state.code !== 'upload-expired') {
    for (const file of pkg.files) await client.request(`admin/submissions/${state.submissionId}/assets/${file.id}`, { method: 'PUT',
      headers: { 'content-type': 'image/webp' }, body: file.bytes });
    state = await client.request(`admin/submissions/${state.submissionId}/submit`, { method: 'POST' });
  }
  for (let polls = 0; !['registered', 'rejected'].includes(state.stage) && state.code !== 'upload-expired' && polls < 60; polls++) {
    await wait(10000);
    state = await client.request(`admin/submissions/${state.submissionId}`);
  }
  if (state.stage === 'registered' && state.availability === 'active') return { ...state, ...warning, done: change };
  const code = state.code === 'upload-expired' ? 'upload-expired' : state.stage === 'rejected' ? 'validation-rejected'
    : state.stage === 'registered' ? `package-${state.availability ?? 'inactive'}` : 'validation-timeout';
  return { ...state, ok: false, code };
}

/**
 * edit-profile: the owner's profile or style edit, as the operator, from the fighter's current package. The dry run reads the fighter too.
 * @param {string[]} positional @param {Record<string, string | true>} flags @param {() => Promise<Client>} signIn
 */
async function editProfile([, target], flags, signIn) {
  const fighter = id(target, 'fighter'), reason = text(flags.reason, 'reason');
  const profile = await jsonFlag(flags.profile, 'profile'), style = await jsonFlag(flags.style, 'style');
  if (profile === undefined && style === undefined) throw new Error('missing-value:--profile');
  const edit = { ...(profile === undefined ? {} : { profile }), ...(style === undefined ? {} : { style }) };
  const client = await signIn(), now = await current(client, fighter);
  const change = `선수 「${now.name}」(${fighter}, 주인 ${now.ownerId})의 ${[profile === undefined ? null : `프로필(${Object.keys(profile ?? {}).join(', ')})`,
    style === undefined ? null : style === null ? '전투 스타일 지우기' : '전투 스타일'].filter(Boolean).join('·')}을 고칩니다. 출전은 그대로입니다. 사유: ${reason}`;
  if (flags.yes !== true) return { ok: true, dryRun: true, change, request: { method: 'PATCH', route: `admin/fighters/${fighter}/profile`, body: edit } };
  const body = JSON.stringify({ ...edit, expectedManifestSha256: now.manifestSha256 });
  const result = await client.request(`admin/fighters/${fighter}/profile`, { method: 'PATCH',
    headers: { 'content-type': 'application/json', 'idempotency-key': editKey('profile', fighter, now.manifestSha256, body), ...reasonHeader(reason) }, body });
  return { ...result, done: change };
}

export const USAGE = [
  'npm run admin -- whoami | review | open | show <job> | retry <job> --yes | cancel <job> --yes',
  'npm run admin -- hosts | host-approve <host> --yes | host-withdraw <host> --yes',
  'npm run admin -- profiles [--status review|approved|rejected] | profile-approve <set> --yes | profile-reject <set> --reason <text> --yes',
  'npm run admin -- fighters [--status active|removed|all] [--search <text>] [--page <n>]',
  'npm run admin -- fighter-remove|fighter-restore <fighter> --version <n> --reason <text> --yes',
  'npm run admin -- fighter <fighter> | replace-package <fighter> <package dir|fighter.json> --reason <text> [--key <uuid>] --yes',
  'npm run admin -- edit-profile <fighter> --reason <text> [--profile <json|@file>] [--style <json|null|@file>] --yes',
  'Session: --session <file>, else ODDBOUT_ADMIN_SESSION, else the npm run login session file.',
];

// Messages for the codes the agent most often meets; the code itself is always in the answer.
const HINTS = /** @type {Record<string, string>} */ ({
  'admin-required': '이 세션의 계정은 운영자가 아닙니다. 운영자 계정으로 npm run login (VM이면 --device) 하세요.',
  'client-sign-in-required': '세션 파일이 없거나 만료됐습니다. npm run login (VM이면 npm run login -- --device) 하세요.',
  'review-conflict': '상태가 이미 바뀌었습니다. 목록을 다시 읽으세요.',
  'not-found': '대상을 찾지 못했습니다.',
  'fighter-not-found': '선수를 찾지 못했습니다(지운 선수이거나 id가 틀렸습니다).',
  'fighter-unchanged': '운영 패키지와 같은 내용입니다. 바꿀 것이 없습니다.',
  'open-submission-exists': '그 선수 주인의 다른 제출이 아직 열려 있습니다. 끝난 뒤 다시 하세요.',
  'idempotency-conflict': '같은 키의 다른 제출이 있습니다. --key 로 새 UUID 를 주세요.',
  'validation-rejected': '서버 검사가 패키지를 거절했습니다(validation). 고친 뒤 다시 보내세요.',
  'validation-timeout': '10분 안에 검사가 끝나지 않았습니다. fighter <id> 로 상태를 다시 보세요.',
  'package-superseded': '이 패키지는 이미 다른 패키지로 대체됐습니다. 선수는 지금 패키지 그대로입니다.',
  'package-invalid': '패키지가 계약 검사를 통과하지 못했습니다(errors).',
});

function isEntry() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntry()) {
  runAdmin().then(answer => { console.log(JSON.stringify(answer, null, 2)); }, error => {
    const code = error instanceof Error ? error.message : String(error);
    const errors = /** @type {any} */ (error)?.errors;
    console.log(JSON.stringify({ ok: false, code, ...(errors ? { errors } : {}),
      hint: HINTS[code] ?? (code.startsWith('unknown-command') ? USAGE.join('\n') : undefined) }, null, 2));
    process.exitCode = 1;
  });
}
