import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const guard = fileURLToPath(new URL('../deploy/dots-environment/check-clean-image.sh', import.meta.url));
async function fixture(t) {
  try {
    await access(bash);
  } catch {
    t.skip('Bash required');
    return;
  }
  const home = await mkdtemp(path.join(tmpdir(), 'oddbout-clean-image-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  // This is an empty synthetic test home, never a real login or credential copy.
  const env = { ...process.env, HOME: home, XAI_API_KEY: '', OPENAI_API_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' };
  delete env.GROK_HOME;
  delete env.AI_FIGHTER_ROOT;
  return { home, run: extra => exec(bash, [guard], { env: { ...env, ...extra } }) };
}
async function denied(run, code = 'snapshot-has-personal-auth') {
  await assert.rejects(run(), e => {
    assert.equal(e.code, 1);
    assert.ok(e.stderr.startsWith(code));
    assert.equal(e.stdout, '');
    assert.ok(!e.stderr.includes('synthetic-secret'));
    return true;
  });
}
test('image guard accepts a clean home and the official binary-only Grok cache', async t => {
  const f = await fixture(t);
  if (!f) return;
  await f.run();
  await mkdir(path.join(f.home, '.grok/bin'), { recursive: true });
  await writeFile(path.join(f.home, '.grok/bin/grok'), 'binary-cache-fixture');
  await f.run();
});
test('image guard rejects credentials, unknown and hidden entries without disclosing contents', async t => {
  const f = await fixture(t);
  if (!f) return;
  const grok = path.join(f.home, '.grok');
  await mkdir(grok);
  for (const name of ['auth.json', 'credentials.json', '.saved-session', 'unexpected-cache']) {
    await writeFile(path.join(grok, name), 'synthetic-secret');
    await denied(f.run);
    await rm(path.join(grok, name));
  }
  await mkdir(path.join(f.home, '.oddbout/auth'), { recursive: true });
  await denied(f.run);
});
test('image guard rejects injected API and service keys without disclosing them', async t => {
  const f = await fixture(t);
  if (!f) return;
  for (const key of ['XAI_API_KEY', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
    await denied(() => f.run({ [key]: 'synthetic-secret' }), 'snapshot-has-service-keys');
});
test('image guard rejects symlinked Grok directories and binary caches', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  if (!f) return;
  const target = path.join(f.home, 'target');
  await mkdir(target);
  const grok = path.join(f.home, '.grok');
  await symlink(target, grok);
  await denied(f.run);
  await rm(grok);
  await mkdir(grok);
  await symlink(target, path.join(grok, 'bin'));
  await denied(f.run);
});
test('image guard rejects custom account credentials and a user workspace account directory', async t => {
  const f = await fixture(t);
  if (!f) return;
  const custom = path.join(f.home, 'custom-grok');
  await mkdir(custom);
  const shellPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  await f.run({ GROK_HOME: shellPath(custom) });
  await writeFile(path.join(custom, 'auth.json'), 'synthetic-secret');
  await denied(() => f.run({ GROK_HOME: shellPath(custom) }));
  const work = path.join(f.home, 'work');
  await mkdir(path.join(work, '.oddbout-private/grok-account'), { recursive: true });
  await denied(() => f.run({ AI_FIGHTER_ROOT: shellPath(work) }));
  await denied(() => f.run({ GROK_HOME: '' }));
});
