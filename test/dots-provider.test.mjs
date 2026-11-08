import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandRoute, guardDotsExecution } from '../scripts/dots-provider.mjs';

const exec = promisify(execFile),
  dots = { AI_FIGHTER_EXECUTION_HOST: 'dots' };
const grokCommands = [
  ['gen', '--provider', 'grok'],
  ['gen', '--provider=grok'],
  ['gen-set', '--provider=grok'],
  ['video', '--image', 'still.png'],
  ['video-resume', '--request-id', 'existing-request'],
  ['video-set', '--base', 'side=still.png'],
  ['video-set', '--base=front=still.png', '--states=idle'],
  ['video-set', '--base=front=still.png', '--states=walk', '--still-provider=grok'],
  ['video-set', '--base=back=still.png', '--walk-start=as-given'],
];
test('Grok image/video/recovery routes never inspect Codex or change provider arguments', async () => {
  let inspections = 0;
  const inspect = () => {
    inspections++;
    assert.fail('Grok must not inspect Codex');
  };
  for (const args of grokCommands) {
    const before = [...args];
    const route = await guardDotsExecution('/unread-runtime', '/unread-workspace', args, dots, { inspect });
    assert.equal(route.provider, 'grok');
    assert.deepEqual(args, before);
  }
  assert.equal(inspections, 0);
  assert.equal(commandRoute(['video-resume']).operation, 'recover-video');
  assert.equal(commandRoute(['gen'], { SPRITE_GEN_DEFAULT_PROVIDER: 'grok' }).provider, 'grok');
  assert.equal(commandRoute(['gen', '--provider=grok'], { SPRITE_GEN_DEFAULT_PROVIDER: 'codex' }).provider, 'grok');
  assert.equal(commandRoute(['video-set', '--base=front=a'], { SPRITE_GEN_DEFAULT_PROVIDER: 'grok' }).imageProvider, 'grok');
});
test('ambiguous and abbreviated routes fail exactly; actual Codex image routes stay blocked', async () => {
  for (const [args, message] of [
    [['gen'], 'dots-image-provider-required'],
    [['gen-set'], 'dots-image-provider-required'],
    [['video-set', '--base=front=a'], 'dots-video-set-still-provider-required'],
    [['video-set', '--base', ' front =a'], 'dots-video-set-still-provider-required'],
    [['video-set', '--base', 'back@=a'], 'dots-video-set-still-provider-required'],
    [['gen', '--provider=grok', '--provider=codex'], 'duplicate-provider-option'],
    [['gen', '--provider=grok', '--prov=codex'], 'dots-use-complete-provider-route-options'],
    [['gen', '--provider'], 'dots-provider-route-option-value-required'],
    [['gen', '--provider=gpt'], 'dots-subscription-provider-required'],
  ])
    await assert.rejects(guardDotsExecution('/unused', '/unused', args, dots), { message });
  let inspections = 0;
  for (const args of [
    ['gen', '--provider=codex'],
    ['gen-set', '--provider=codex'],
    ['video-set', '--base=back=a', '--still-provider=codex'],
    ['video-set', '--base', ' back =a', '--still-provider=codex'],
  ])
    await assert.rejects(
      guardDotsExecution('/unused', '/unused', args, dots, {
        inspect: async (_, provider) => {
          inspections++;
          assert.equal(provider, 'codex');
          return { status: 'blocked' };
        },
      }),
      /dots-protected-session-provider-blocked/,
    );
  assert.equal(inspections, 4);
});
test(
  'direct CLI reaches a mock engine for Grok, preserves non-Dots behavior and blocks Codex before dispatch',
  { skip: process.platform === 'win32' && 'the mock engine is a shebang script at .venv/bin/python; Windows runs .venv/Scripts/python.exe' },
  async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'dots-provider-cli-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, 'scripts'));
    for (const file of ['sprite-gen.mjs', 'sprite-tools.mjs', 'dots-provider.mjs', 'dots-safety.mjs'])
      await cp(new URL(`../scripts/${file}`, import.meta.url), path.join(root, 'scripts', file));
    // dots-safety's path and hash helpers, shared with the kit launcher.
    await mkdir(path.join(root, 'plugins/ai-fighter'), { recursive: true });
    await cp(new URL('../plugins/ai-fighter/local-files.mjs', import.meta.url), path.join(root, 'plugins/ai-fighter/local-files.mjs'));
    // sprite-tools fetches through api/runtime-fetch (cloud proxy settings), which imports undici.
    await mkdir(path.join(root, 'api'));
    for (const file of ['runtime-fetch.mjs', 'connection-errors.mjs']) await cp(new URL(`../api/${file}`, import.meta.url), path.join(root, 'api', file));
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(root, 'node_modules'), 'junction');
    await mkdir(path.join(root, 'contracts/ai-fighter/v1'), { recursive: true });
    await cp(new URL('../contracts/ai-fighter/v1/spec.json', import.meta.url), path.join(root, 'contracts/ai-fighter/v1/spec.json'));
    const vendor = path.join(root, 'vendor/sprite-gen');
    await mkdir(path.join(vendor, 'sprite_gen/gen'), { recursive: true });
    await writeFile(path.join(vendor, 'pyproject.toml'), 'version = "0.0.0"\n');
    await writeFile(path.join(vendor, 'sprite_gen/gen/gen_motion.py'), '# mock engine presence only\n');
    await writeFile(path.join(vendor, 'sprite_gen/gen/codex_provider.py'), 'def _rollout_files(): pass\n');
    await mkdir(path.join(vendor, '.venv/bin'), { recursive: true });
    const python = path.join(vendor, '.venv/bin/python');
    await writeFile(python, `#!${process.execPath}\nconsole.log(JSON.stringify({ mockEngineArgs: process.argv.slice(2) }));\n`);
    await chmod(python, 0o700);
    const env = { ...process.env, AI_FIGHTER_EXECUTION_HOST: 'dots', INIT_CWD: root, SPRITE_GEN_DEFAULT_PROVIDER: '' };
    for (const args of grokCommands) {
      const result = await exec(process.execPath, [path.join(root, 'scripts/sprite-gen.mjs'), ...args], { cwd: root, env });
      assert.deepEqual(JSON.parse(result.stdout).mockEngineArgs, ['-m', 'sprite_gen.cli', ...args]);
    }
    await assert.rejects(
      exec(process.execPath, [path.join(root, 'scripts/sprite-gen.mjs'), 'gen', '--provider=codex'], { cwd: root, env }),
      error => error.code === 1 && !error.stdout && /dots-protected-session-provider-blocked/.test(error.stderr),
    );
    await assert.rejects(
      exec(process.execPath, [path.join(root, 'scripts/sprite-gen.mjs'), 'gen'], { cwd: root, env }),
      error => error.code === 1 && !error.stdout && /dots-image-provider-required/.test(error.stderr),
    );
    const old = await exec(process.execPath, [path.join(root, 'scripts/sprite-gen.mjs'), 'gen', '--provider=codex'], {
      cwd: root,
      env: { ...env, AI_FIGHTER_EXECUTION_HOST: '' },
    });
    assert.equal(JSON.parse(old.stdout).mockEngineArgs[2], 'gen');
  },
);
