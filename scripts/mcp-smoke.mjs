// @ts-check
// The workspace MCP tools in process, as creation:tool runs them, with this checkout as the workspace.
import { fileURLToPath } from 'node:url';
import { creationTool } from './creation-tool.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { tools } = /** @type {{ tools: { name: string }[] }} */ (await creationTool({ workspace: root }));
console.log('tools:', tools.map(t => t.name).join(', '));
for (const [name, args] of /** @type {[string, Record<string, unknown>][]} */ ([
  ['get_fighter_spec', { section: 'overview' }],
  ['validate_fighter_package', { manifestPath: 'examples/sparring-bot/fighter.json' }],
])) {
  const result = await creationTool({ workspace: root, name, args });
  console.log(JSON.stringify({ tool: name, result: result.structuredContent }, null, 2));
  if (result.isError) process.exitCode = 1;
}
