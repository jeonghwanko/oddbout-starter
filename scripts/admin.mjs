// @ts-check
// 운영자 화면(admin.html)을 에이전트가 쓰는 길 (2026-11-01). The operator's own sign-in (`npm run login`, or `--device` on a VM) is the
// only credential: the admin API takes his session as it takes the site's, and refuses any account that is not an operator.
// Usage: npm run admin -- <command> [args] [--yes] [--session <file>]
//   whoami | review | open | show <job> | retry <job> | cancel <job>
//   hosts | host-approve <host> | host-withdraw <host>
//   profiles [--status review|approved|rejected] | profile-approve <set> | profile-reject <set> --reason <text>
//   fighters [--status active|removed|all] [--search <text>] [--page <n>] | fighter-remove <fighter> --version <n> --reason <text>
//   fighter-restore <fighter> --version <n> --reason <text>
// Every answer is one JSON object on stdout. A command that changes something only shows what it would do (`dryRun: true`) until it is
// run again with --yes: the agent shows that to its user and asks first.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRemoteClient } from '../api/client.mjs';
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
 * @param {{ argv?: string[], connect?: (sessionPath: string) => Promise<Client>, env?: NodeJS.ProcessEnv }} [options]
 */
export async function runAdmin({ argv = process.argv.slice(2), connect = createRemoteClient, env = process.env } = {}) {
  const { positional, flags } = parseArgs(argv);
  if (flags.help || !positional.length) return { ok: true, usage: USAGE };
  const call = planCall(positional, flags);
  if (call.change && flags.yes !== true) return { ok: true, dryRun: true, change: call.change, request: { method: call.method, route: `admin/${call.route}`, body: call.body } };
  const sessionPath = typeof flags.session === 'string' ? flags.session : env.ODDBOUT_ADMIN_SESSION || defaultSessionPath();
  const client = await connect(sessionPath).catch(error => {
    throw error?.code === 'ENOENT' ? new Error('client-sign-in-required') : error;
  });
  const result = await client.request(`admin/${call.route}`, call.method === 'POST'
    ? { method: 'POST', body: JSON.stringify(call.body ?? {}), headers: { 'content-type': 'application/json' } } : {});
  return call.change ? { ...result, done: call.change } : result;
}

export const USAGE = [
  'npm run admin -- whoami | review | open | show <job> | retry <job> --yes | cancel <job> --yes',
  'npm run admin -- hosts | host-approve <host> --yes | host-withdraw <host> --yes',
  'npm run admin -- profiles [--status review|approved|rejected] | profile-approve <set> --yes | profile-reject <set> --reason <text> --yes',
  'npm run admin -- fighters [--status active|removed|all] [--search <text>] [--page <n>]',
  'npm run admin -- fighter-remove|fighter-restore <fighter> --version <n> --reason <text> --yes',
  'Session: --session <file>, else ODDBOUT_ADMIN_SESSION, else the npm run login session file.',
];

// Messages for the codes the agent most often meets; the code itself is always in the answer.
const HINTS = /** @type {Record<string, string>} */ ({
  'admin-required': '이 세션의 계정은 운영자가 아닙니다. 운영자 계정으로 npm run login (VM이면 --device) 하세요.',
  'client-sign-in-required': '세션 파일이 없거나 만료됐습니다. npm run login (VM이면 npm run login -- --device) 하세요.',
  'review-conflict': '상태가 이미 바뀌었습니다. 목록을 다시 읽으세요.',
  'not-found': '대상을 찾지 못했습니다.',
});

function isEntry() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntry()) {
  runAdmin().then(answer => { console.log(JSON.stringify(answer, null, 2)); }, error => {
    const code = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ ok: false, code, hint: HINTS[code] ?? (code.startsWith('unknown-command') ? USAGE.join('\n') : undefined) }, null, 2));
    process.exitCode = 1;
  });
}
