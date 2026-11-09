import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// What coding agents load on their own (Codex and Grok: AGENTS.md; Claude Code: CLAUDE.md), the skill the plugin
// hands them, and the pages that route them to the rest of docs/. The checkout copies are the same workflow
// with the plugin root fixed, and they do not name the canonical skill file again.
const docs = [
  'AGENTS.md',
  'CLAUDE.md',
  'plugins/ai-fighter/skills/create-fighter/SKILL.md',
  'plugins/ai-fighter/skills/create-fighter/references/workspace.md',
  'docs/README.md',
  'docs/START-HERE.md',
  '.grok/skills/create-fighter/SKILL.md',
  '.cursor/skills/create-fighter/SKILL.md',
];
// The game repository's deploy scripts, which these docs name.
const gameScripts = ['fighter:edge', 'fighter:mcp'];
const repositoryPath = /^(?:api|contracts|deploy|docs|examples|host|mcp|packages|plugins|scripts|server|supabase|test|tools|vendor|web|website|worker)\//;
// A checkout made without its submodule (a new worktree, a clone without --recurse-submodules) has no engine files;
// CI checks out the submodule, so it still checks these names.
const engineCheckedOut = existsSync(path.join(root, 'vendor/sprite-gen/SKILL.md'));

/** GitHub's heading anchors: lower case, punctuation dropped, spaces as hyphens. @param {string} text */
const anchors = text =>
  new Set(
    [...text.matchAll(/^#{1,6} +(.+)$/gm)].map(([, heading]) =>
      heading
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\- _]/gu, '')
        .replace(/ /g, '-'),
    ),
  );

test('Claude Code imports the AGENTS.md that Codex and Grok load', async () => {
  assert.match(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md$/m);
});

test('Grok and Cursor checkout skills repeat the canonical workflow', () => {
  execFileSync(process.execPath, ['scripts/checkout-skill.mjs', '--check'], { cwd: root, stdio: 'pipe' });
  // A same-named installed plugin stays beside this skill and both lose the bare name. Disabling that
  // plugin in the project config leaves one create-fighter. The setting must not touch MCP or permissions.
  return readFile(path.join(root, '.grok/config.toml'), 'utf8').then(config => {
    assert.match(config, /^disabled = \["oddbout"\]$/m);
    assert.doesNotMatch(config, /mcp|permission|allow/i);
  });
});

test('AGENTS.md fits within what Codex reads', async () => {
  // Codex reads AGENTS.md files up to project_doc_max_bytes (32 KiB by default, shared by every AGENTS.md from the
  // repository root to the working directory) and drops the rest.
  const { size } = await stat(path.join(root, 'AGENTS.md'));
  assert.ok(size <= 32 * 1024, `AGENTS.md is ${size} bytes`);
});

test('agent instructions name only files, anchors and npm scripts that exist', async () => {
  const { scripts } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const missing = [];
  for (const doc of docs) {
    const text = await readFile(path.join(root, doc), 'utf8');
    // A code span names a file from the repository root; a link resolves from its document. Placeholders (<name>)
    // are skipped.
    for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
      const file = span.split(/\s+/)[0];
      if (!repositoryPath.test(file) || /[<*]/.test(file) || (!engineCheckedOut && file.startsWith('vendor/sprite-gen/'))) continue;
      if (!existsSync(path.join(root, file))) missing.push(`${doc}: ${file}`);
    }
    for (const [, target, fragment] of text.matchAll(/\]\(([^)#\s]*)(?:#([^)\s]+))?\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      const file = target ? path.join(root, path.dirname(doc), target) : path.join(root, doc);
      if (!existsSync(file)) {
        missing.push(`${doc}: ${target}`);
        continue;
      }
      if (fragment && file.endsWith('.md') && !anchors(await readFile(file, 'utf8')).has(decodeURIComponent(fragment)))
        missing.push(`${doc}: ${target}#${fragment}`);
    }
    for (const [, name] of text.matchAll(/npm run ([\w:-]+)/g)) if (!scripts[name] && !gameScripts.includes(name)) missing.push(`${doc}: npm run ${name}`);
  }
  assert.deepEqual(missing, []);
});
