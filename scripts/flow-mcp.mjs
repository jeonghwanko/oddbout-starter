#!/usr/bin/env node
// @ts-check
// npm run flow:mcp — stdio MCP for an agent. Loopback memory only. stderr carries the dummy banner.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDummyMcp } from '../tools/flow/mcp.mjs';
import { DUMMY_LABEL } from '../tools/flow/seal.mjs';
import { FIXTURE_NAMES, prepareDummyFixture } from '../tools/flow/fixtures.mjs';
import { startDummyServer } from '../tools/flow/server.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--fixture' || !FIXTURE_NAMES.includes(args[1]))) {
  throw new Error('Usage: npm run flow:mcp -- [--fixture empty|registered|quota]');
}
const { store, setup } = await prepareDummyFixture(args[1] ?? 'empty');
const packageRoot = await mkdtemp(path.join(tmpdir(), 'oddbout-dummy-packages-'));
const http = await startDummyServer(store);
const server = createDummyMcp(store, { roots: [process.cwd(), packageRoot], packageRoot });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await server.close();
  await http.close();
  await rm(packageRoot, { recursive: true, force: true });
  process.stdin.pause();
}
server.server.onclose = () => {
  void shutdown();
};
process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
process.stderr.write(
  `${DUMMY_LABEL}\n${JSON.stringify({ ...setup, dummyRegistrationUrl: http.url, packageRoot })}\nThis process does not open a production connection.\n`,
);
try {
  await server.connect(new StdioServerTransport());
} catch (error) {
  await shutdown();
  throw error;
}
