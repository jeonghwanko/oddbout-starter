// @ts-check
// Keep the lightweight Git-installable skill aligned with the creator kit.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'plugins/ai-fighter');
const target = path.join(root, 'plugins/oddbout-codex');
const check = process.argv.includes('--check');
const localScope = `\n## Codex local installation\n\nThis package provides the creation skill only and deliberately declares no MCP server.\nReuse the configured ODDBOUT HTTPS MCP at https://mcp.oddbout.com/mcp (normally oddbout-mcp).\nDo not add another server, log in, or generate merely because this skill was installed.\nIf no connection exists, follow this repository's docs/CODEX-PLUGIN.md; let the user\ncomplete OAuth in their browser, never ask for a callback URL or token. Honor a request\nto leave login pending for recording. The local installation does not install a Dots cloud App.\nThis package has no bundled launcher or generation runtime. For workspace creation,\nread references/workspace.md and locate a separate user-owned creator-kit checkout.\n`;
const workspaceScope = `## Locate the kit and preserve work\n\nThis Git-installed Codex plugin contains skills only, without launcher.mjs or a bundled runtime.\nFor account lookup and hosted creation, use the existing connected MCP; no kit is needed.\nFor explicitly requested workspace creation, prefer the user's existing creator-kit checkout\nand workspace. Read its AGENTS.md, docs/CREATION-UX.md, docs/DOT-CREATION.md,\ndocs/AUTHORING.md, docs/EXECUTION-HOST.md, docs/DELIVERY.md and vendor/sprite-gen/SKILL.md\nbefore generation. Inspect existing notes, selected versions, jobs and sessions first.\nNever pull or update an in-progress checkout, switch providers or copy credentials.\nIf there is no checkout, obtain the creator kit from the public oddbout-starter repository\nusing its docs/START-HERE.md and reviewed installation procedure, only within the user's\nchosen workspace-creation scope. A repository link alone does not authorize generation.\nDo not install dependencies, assets, a Python venv or project state in this plugin cache.\nUse the chosen checkout as the runtime and the user's existing project as the workspace.\nA missing runtime is not permission to switch a Dots task to this PC.\n\n`;
const skill = await readFile(path.join(source, 'skills/create-fighter/SKILL.md'), 'utf8');
const workspace = await readFile(path.join(source, 'skills/create-fighter/references/workspace.md'), 'utf8');
if (!skill.includes('# ODDBOUT\n') || !workspace.includes('## Locate the kit and preserve work') || !workspace.includes('## Call the workspace tools')) {
  throw new Error('Canonical skill headings changed; review the local adapter before syncing.');
}
const files = new Map([
  ['skills/create-fighter/SKILL.md', skill.replace('# ODDBOUT\n', '# ODDBOUT\n' + localScope)],
  ['skills/create-fighter/references/workspace.md', workspace.replace(/## Locate the kit and preserve work[\s\S]*?(?=## Call the workspace tools)/, workspaceScope)],
  ['skills/create-fighter/agents/openai.yaml', await readFile(path.join(source, 'skills/create-fighter/agents/openai.yaml'), 'utf8')],
  ['assets/icon.svg', await readFile(path.join(source, 'assets/icon.svg'), 'utf8')],
]);
for (const [name, text] of files) {
  const destination = path.join(target, name);
  if (check) {
    if (await readFile(destination, 'utf8') !== text) throw new Error(`Stale Codex plugin file: ${name}; run node scripts/sync-codex-plugin.mjs`);
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, text);
  }
}
console.log(check ? 'Codex skill matches canonical workflow.' : 'Codex skill synchronized.');
