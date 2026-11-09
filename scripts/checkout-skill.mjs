// @ts-check
// Grok CLI and Cursor discover one checkout skill. The body is the canonical workflow so invoking
// it does not also open that file. The Codex and Claude Code packages stay the adapter from
// sync-codex-plugin.mjs.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destinations = [
  '.grok/skills/create-fighter/SKILL.md',
  '.cursor/skills/create-fighter/SKILL.md',
];

/** @param {string} canonical */
export function checkoutSkillText(canonical) {
  const description = /^description: (.+)$/m.exec(canonical)?.[1];
  if (!description) throw new Error('Canonical skill has no description line');
  const body = canonical.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  if (!body.startsWith('\n# ODDBOUT\n')) throw new Error('Canonical skill frontmatter did not split');
  // A markdown link is resolved from this file's directory. Name the canonical page from the repo root instead.
  const from = '[workspace routing](references/workspace.md)';
  const to = '`plugins/ai-fighter/skills/create-fighter/references/workspace.md`';
  if (!body.includes(from)) throw new Error('Canonical skill workspace link was not found');
  const rewritten = body.replaceAll(from, to);
  if (rewritten.includes('(references/workspace.md)')) throw new Error('A relative workspace link remains');
  const text = `---
name: create-fighter
description: ${description}
---

# Checkout copy

The workflow below is complete. Do not open another create-fighter skill. The plugin root is \`plugins/ai-fighter\`, which contains \`plugins/ai-fighter/launcher.mjs\`. Do not treat this skill file's directory as the plugin root.
${rewritten}`;
  if (text.includes('skills/create-fighter/SKILL.md')) throw new Error('Checkout skill points at a second copy of itself');
  return text;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  const check = process.argv.includes('--check');
  const canonical = await readFile(path.join(root, 'plugins/ai-fighter/skills/create-fighter/SKILL.md'), 'utf8');
  const text = checkoutSkillText(canonical);
  for (const relative of destinations) {
    const destination = path.join(root, relative);
    if (check) {
      if (await readFile(destination, 'utf8') !== text) {
        throw new Error(`Stale checkout skill: ${relative}; run node scripts/checkout-skill.mjs`);
      }
    } else {
      await writeFile(destination, text);
    }
  }
  console.log(check ? 'Checkout skills match the canonical workflow.' : 'Checkout skills written.');
}
