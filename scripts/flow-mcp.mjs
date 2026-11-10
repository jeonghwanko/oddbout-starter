#!/usr/bin/env node
// @ts-check
// npm run flow:mcp — stdio MCP for an agent. Loopback memory only. stderr carries the dummy banner.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createDummyMcp } from '../tools/flow/mcp.mjs';
import { DUMMY_LABEL } from '../tools/flow/seal.mjs';
import { FIXTURE_NAMES, prepareDummyFixture } from '../tools/flow/fixtures.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--fixture' || !FIXTURE_NAMES.includes(args[1]))) {
  throw new Error('Usage: npm run flow:mcp -- [--fixture empty|registered|quota]');
}
const { store, setup } = await prepareDummyFixture(args[1] ?? 'empty');
const server = createDummyMcp(store, { roots: [process.cwd()] });
process.stderr.write(`${DUMMY_LABEL}\n${JSON.stringify(setup)}\nThis process does not open a production connection.\n`);
await server.connect(new StdioServerTransport());
