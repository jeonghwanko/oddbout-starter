import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostEnv, installFiles } from '../scripts/host.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// og is a bash script that runs on a Linux host (flock, systemd-run, Unix modes); its fakes are bash scripts too.
const linuxOnly = { skip: process.platform !== 'linux' && 'og runs on a Linux host' };

// A community host's install (커뮤니티 호스트 H2, 2026-10-28): og in <root>/bin beside host.env runs as the caller, no sudo. Fake codex,
// grok, systemctl and systemd-run stand in for the providers and systemd; everything else is the real og.
async function hostInstall() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'og-user-')), root = path.join(base, 'root'), fakes = path.join(base, 'fakes'), units = path.join(base, 'units');
  await mkdir(root, { mode: 0o700 }); await mkdir(fakes);
  await installFiles(root, here);
  await writeFile(path.join(root, 'host.env'), hostEnv({ nodeBin: path.dirname(process.execPath), slots: 2, memory: '4G' }));
  const providers = path.join(root, 'tools', 'node_modules', '.bin');
  await mkdir(providers, { recursive: true });
  const token = plan => `x.${Buffer.from(JSON.stringify({ email: 'Host@Example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: plan, chatgpt_account_id: 'acct-123456' } })).toString('base64url')}.y`;
  const idToken = token('plus'), freeToken = token('free');
  const script = (file, body) => writeFile(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  // Each provider notes the HOME it ran with: the install's root, never the host's own home.
  await script(path.join(providers, 'codex'), `echo "$HOME" > "${base}/codex-home"; echo "$SPRITE_GEN_RIFE_BACKEND" > "${base}/codex-rife"
case "$1" in
  login) mkdir -p "$HOME/.codex"; if [ -f "${base}/free-plan" ]; then t='${freeToken}'; else t='${idToken}'; fi; printf '{"tokens":{"id_token":"%s"}}' "$t" > "$HOME/.codex/auth.json" ;;
  logout) rm -f "$HOME/.codex/auth.json" ;;
  --version) echo "codex-cli 0.157.1" ;;
  *) echo ok ;;
esac`);
  await script(path.join(providers, 'grok'), `case "$1" in
  login) mkdir -p "$HOME/.grok"; printf '{"https://auth.x.ai::u1":{"email":"host@example.com","user_id":"u1","expires_at":"2099-01-01T00:00:00Z"}}' > "$HOME/.grok/auth.json" ;;
  logout) rm -f "$HOME/.grok/auth.json" ;;
  *) echo ok ;;
esac`);
  await script(path.join(fakes, 'systemctl'), `echo "$*" >> "${base}/systemctl.log"`);
  await script(path.join(fakes, 'systemd-run'), `echo "$*" >> "${base}/systemd-run.log"; while [ "$1" != "--" ]; do shift; done; shift; exec "$@"`);
  await script(path.join(fakes, 'sudo'), `echo "sudo $*" >> "${base}/sudo.log"; exit 1`);
  // Read at each call: a test sets OG_SLOT_WAIT in process.env for one run.
  const env = () => ({ ...process.env, PATH: `${fakes}:${process.env.PATH}`, OG_UNIT_DIR: units, OG_SVC_USER: '', OG_ROOT: '' });
  const og = (args, input) => spawnSync(path.join(root, 'bin', 'og'), args, { input, encoding: 'utf8', env: env() });
  return { base, root, units, og, env };
}

test('a host install runs og as its own account: providers signed in inside the root, the ledger marks the host, no sudo', linuxOnly, async () => {
  const { base, root, units, og } = await hostInstall();
  try {
    assert.match(og(['status']).stdout, new RegExp(`root +${root} \\(user ${os.userInfo().username}, user install\\)`));
    // The official host's manual flow is not a host's.
    for (const args of [['new', 'red-cat', '1', 'a@b.c'], ['deliver', 'x'], ['close', 'x', 'y'], ['self-update']]) {
      const r = og(args, 'a request');
      assert.notEqual(r.status, 0); assert.match(r.stderr, /official host|npm run host -- update/);
    }
    // A ChatGPT account on the free plan is named at once; signing in pins the host's own account; health calls both through the install's HOME.
    await writeFile(path.join(base, 'free-plan'), '');
    assert.match(og(['login', 'codex']).stderr, /free plan — hosting needs a paid plan/);
    await rm(path.join(base, 'free-plan'));
    const paid = og(['login', 'codex', '--replace']);
    assert.equal(paid.status, 0); assert.doesNotMatch(paid.stderr, /free plan/);
    const pinned = og(['login', 'grok']);
    assert.equal(pinned.status, 0); assert.match(pinned.stdout, /this host's own subscription/);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'accounts.json'), 'utf8')), { codex: 'host@example.com', grok: 'host@example.com', personal: {} });
    const health = og(['health']);
    assert.match(health.stdout, /^og: codex ok \(host@example\.com\)$/m); assert.match(health.stdout, /^og: grok ok \(host@example\.com\)$/m);
    assert.equal((await readFile(path.join(base, 'codex-home'), 'utf8')).trim(), root);

    // A worker job's run: under the memory slice, codex slots inside the root, the ledger's account `host`.
    const job = '20261028-gen-0123abcd', dir = path.join(root, 'kit', 'output', job);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'request.json'), '{}');
    const run = og(['run', job, '--', 'codex', 'exec', 'hello']);
    assert.equal(run.status, 0, run.stderr);
    assert.match(await readFile(path.join(base, 'systemd-run.log'), 'utf8'), /--slice=oddbout-host\.slice/);
    assert.ok(existsSync(path.join(root, 'slots', 'slot0')));
    const end = (await readFile(path.join(root, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1);
    assert.deepEqual([end.kind, end.phase, end.provider, end.account, end.exit], ['run', 'end', 'codex', 'host', 0]);
    // Refused before its command started: exit 3, sprite-gen's "nothing was sent", which the worker may run again.
    const refused = og(['run', '20261028-gen-missing0', '--', 'codex', 'exec', 'hello']);
    assert.equal(refused.status, 3, refused.stderr); assert.match(refused.stderr, /no job 20261028-gen-missing0/);
    // Every codex slot held elsewhere: past OG_SLOT_WAIT the run is not started (exit 3), and the ledger ends it as such.
    const holders = [];
    for (const slot of ['slot0', 'slot1']) {
      const file = path.join(root, 'slots', slot);
      if (!existsSync(file)) await writeFile(file, '');
      holders.push(spawn('flock', [file, 'sleep', '30'], { stdio: 'ignore' }));
    }
    await new Promise(done => setTimeout(done, 500));
    process.env.OG_SLOT_WAIT = '1';
    try {
      const waited = og(['run', job, '--', 'codex', 'exec', 'hello']);
      assert.equal(waited.status, 3, waited.stderr); assert.match(waited.stderr, /no 1 free codex slot\(s\) within 1s — not started/);
      const last = (await readFile(path.join(root, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1);
      assert.deepEqual([last.kind, last.phase, last.exit], ['run', 'end', 3]);
    } finally { delete process.env.OG_SLOT_WAIT; for (const holder of holders) holder.kill(); }
    // Signed out after its pin (2026-11-03): the account's refusal exits 75, sprite-gen's "the provider cannot run here now", before any
    // ledger line, so the worker marks codex down instead of running the job again into `stage-attempts`.
    const ledgerLines = async () => (await readFile(path.join(root, 'ledger.jsonl'), 'utf8')).trim().split('\n').length;
    const before = await ledgerLines();
    await rm(path.join(root, '.codex', 'auth.json'));
    const signedOut = og(['run', job, '--', 'codex', 'exec', 'hello']);
    assert.equal(signedOut.status, 75, signedOut.stderr); assert.match(signedOut.stderr, /codex is not signed in/);
    assert.equal(await ledgerLines(), before);
    assert.equal(og(['login', 'codex', '--replace']).status, 0);

    // The worker: its key on stdin (mode 600), codex locked first, a user unit in the host's own systemd.
    assert.notEqual(og(['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter'], 'not-a-key').status, 0);
    assert.equal(og(['worker', 'key', 'https://example.supabase.co/functions/v1/ai-fighter'], `afw_${'c'.repeat(64)}\n`).status, 0);
    assert.equal(statSync(path.join(root, 'worker.env')).mode & 0o777, 0o600);
    assert.equal(og(['harden']).status, 0);
    const configFile = path.join(root, '.codex', 'config.toml'), config = await readFile(configFile, 'utf8');
    assert.match(config, /^shell_tool = false$/m);
    // Project instructions off (2026-11-05): a top-level key, so before the [features] table og appends (after it, it would be that table's).
    const docs = /^project_doc_max_bytes = 0$/m;
    assert.ok(docs.test(config) && config.search(docs) < config.indexOf('[features]'), config);
    // A config hardened before (features only): og harden adds the line at the top, once, and keeps one [features] table.
    await writeFile(configFile, `model = "gpt-6.1-sol"\n${config.replace(/^# og harden \(project docs\).*\nproject_doc_max_bytes = 0\n\n/, '')}`);
    assert.ok(!docs.test(await readFile(configFile, 'utf8')));
    assert.equal(og(['harden']).status, 0);
    assert.equal(og(['harden']).status, 0);
    const hardened = await readFile(configFile, 'utf8');
    assert.equal(hardened.match(/^project_doc_max_bytes = 0$/gm)?.length, 1);
    assert.ok(hardened.startsWith('# og harden (project docs)') && hardened.match(/^\[features\]$/gm)?.length === 1, hardened);
    // An operator's own value is theirs to change: og harden stops and says so.
    await writeFile(configFile, `project_doc_max_bytes = 4096\n${hardened.replace(/^# og harden \(project docs\).*\nproject_doc_max_bytes = 0\n\n/, '')}`);
    const own = og(['harden']);
    assert.notEqual(own.status, 0); assert.match(own.stderr, /sets project_doc_max_bytes — set it to 0 there by hand/);
    await writeFile(configFile, hardened);
    assert.equal(og(['worker', 'install']).status, 0);
    const unit = await readFile(path.join(units, 'oddbout-host-worker.service'), 'utf8');
    assert.match(unit, new RegExp(`^ExecStart=${root}/bin/og worker run$`, 'm')); assert.match(unit, /^Slice=oddbout-host\.slice$/m);
    assert.match(await readFile(path.join(base, 'systemctl.log'), 'utf8'), /--user enable --now oddbout-host-worker\.service/);
    await mkdir(units, { recursive: true }); await writeFile(path.join(units, 'oddbout-host.slice'), '[Slice]\n');
    assert.equal(og(['worker', 'uninstall']).status, 0);
    assert.ok(!existsSync(path.join(units, 'oddbout-host-worker.service')));
    assert.ok(!existsSync(path.join(units, 'oddbout-host.slice')), 'a host\'s slice goes with its install');
    assert.ok(!existsSync(path.join(base, 'sudo.log')));
  } finally { await rm(base, { recursive: true, force: true }); }
});

// The worker stops a stage by signalling og's process group (2026-11-02). timeout runs the command in a process group of its own, which
// that signal never reached: og exited and the paid command ran on to RUN_TIMEOUT. og passes the signal on and ends after its command.
test('a signal to og\'s process group stops the command og runs, og ends after it, and the command still reads the caller\'s stdin', linuxOnly, async () => {
  const { base, root, og, env } = await hostInstall();
  try {
    const job = '20261102-gen-0123abcd', dir = path.join(root, 'kit', 'output', job);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'request.json'), '{}');
    const bin = path.join(root, 'tools', 'node_modules', '.bin'), script = (file, body) => writeFile(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    // Local commands (no codex slot, no login). A brief's prompt reaches its command on stdin, as before the run went to the background.
    await script(path.join(bin, 'read-step'), `cat > "${base}/stdin"`);
    const read = og(['run', job, '--', 'read-step'], 'the prompt');
    assert.equal(read.status, 0, read.stderr);
    assert.equal(await readFile(path.join(base, 'stdin'), 'utf8'), 'the prompt');

    await script(path.join(bin, 'slow-step'), `trap 'echo term > "${base}/stopped"; exit 143' TERM
echo started > "${base}/started"; sleep 60 & wait`);
    // As the worker runs og: its own process group, stopped by signalling that group.
    const child = spawn(path.join(root, 'bin', 'og'), ['run', job, '--', 'slow-step'], { env: env(), detached: true, stdio: 'ignore' });
    const exited = new Promise(done => child.on('exit', (code, signal) => done({ code, signal, at: Date.now() })));
    for (let i = 0; i < 100 && !existsSync(path.join(base, 'started')); i++) await new Promise(done => setTimeout(done, 100));
    assert.ok(existsSync(path.join(base, 'started')), 'the command started');
    const stoppedAt = Date.now();
    process.kill(-child.pid, 'SIGTERM');
    const { code, at } = await exited;
    assert.equal(code, 143);
    assert.ok(at - stoppedAt < 20_000, `og ended ${at - stoppedAt} ms after the signal`);
    assert.equal((await readFile(path.join(base, 'stopped'), 'utf8')).trim(), 'term', 'the command itself got the signal');
    const end = (await readFile(path.join(root, 'ledger.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).at(-1);
    assert.deepEqual([end.kind, end.phase, end.tool, end.exit], ['run', 'end', 'slow-step', 143]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

// og rife torch (2026-10-28): RIFE on PyTorch only with an NVIDIA GPU that PyTorch sees; once chosen every provider run carries it.
test('og rife torch needs a GPU, then every run carries SPRITE_GEN_RIFE_BACKEND=torch; og rife ncnn goes back', linuxOnly, async () => {
  const { base, root, og } = await hostInstall();
  try {
    assert.match(og(['rife', 'status']).stdout, /^rife +ncnn$/m);
    const venv = path.join(root, 'kit', 'vendor', 'sprite-gen', '.venv', 'bin'), fakes = path.join(base, 'fakes');
    await mkdir(venv, { recursive: true });
    const script = (file, body) => writeFile(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    await script(path.join(venv, 'python'), 'exit 0');
    await script(path.join(venv, 'pip'), 'exit 0');
    await script(path.join(venv, 'sprite-gen'), `echo "$SPRITE_GEN_RIFE_BACKEND $*" > "${base}/rife-install"`);
    await script(path.join(fakes, 'nvidia-smi'), 'exit 9'); // a driver that answers nothing (the real one may sit later on PATH)
    const noGpu = og(['rife', 'torch']);
    assert.notEqual(noGpu.status, 0); assert.match(noGpu.stderr, /no NVIDIA GPU/);
    await script(path.join(fakes, 'nvidia-smi'), 'echo "GPU 0: Test GPU"');
    const chosen = og(['rife', 'torch']);
    assert.equal(chosen.status, 0, chosen.stderr);
    assert.equal((await readFile(path.join(base, 'rife-install'), 'utf8')).trim(), 'torch rife install --backend torch');
    assert.match(og(['status']).stdout, /^rife +torch$/m);
    // A provider run sees it (the fake codex notes its environment).
    const job = '20261028-gen-0123abcd', dir = path.join(root, 'kit', 'output', job);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'request.json'), '{}');
    assert.equal(og(['login', 'codex']).status, 0); assert.equal(og(['harden']).status, 0);
    const ran = og(['run', job, '--', 'codex', 'exec', 'hello']); assert.equal(ran.status, 0, ran.stderr);
    assert.equal((await readFile(path.join(base, 'codex-rife'), 'utf8')).trim(), 'torch');
    await writeFile(path.join(dir, '.closed'), '');
    assert.equal(og(['rife', 'ncnn']).status, 0);
    assert.match(og(['rife', 'status']).stdout, /^rife +ncnn$/m);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('og prune clears closed jobs past the keep days and worker jobs the API ended without telling (idle 14 days)', linuxOnly, async () => {
  const { base, root, og } = await hostInstall();
  try {
    const output = path.join(root, 'kit', 'output'), daysAgo = d => new Date(Date.now() - d * 86_400_000);
    const job = async (name, age, closed) => {
      const dir = path.join(output, name);
      await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'request.json'), '{}');
      if (closed) await writeFile(path.join(dir, '.closed'), '');
      for (const file of await readdir(dir)) await utimes(path.join(dir, file), daysAgo(age), daysAgo(age));
      await utimes(dir, daysAgo(age), daysAgo(age));
    };
    await job('20261001-gen-aaaa', 10, true);    // closed 10 days ago: past 7
    await job('20261020-gen-bbbb', 3, true);     // closed 3 days ago: kept
    await job('20261002-gen-cccc', 20, false);   // never closed, untouched 20 days: the API cancelled or expired it
    await job('20261018-gen-dddd', 9, false);    // waiting for its creator (up to 7 days) and a little more: kept
    const pruned = og(['prune', '7']);
    assert.equal(pruned.status, 0, pruned.stderr);
    assert.deepEqual((await readdir(output)).sort(), ['20261018-gen-dddd', '20261020-gen-bbbb']);
  } finally { await rm(base, { recursive: true, force: true }); }
});
