#!/usr/bin/env node
// @ts-check
// npm run flow:mcp — stdio MCP for an agent. Loopback memory only. stderr carries the dummy banner.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDummyMcp } from '../tools/flow/mcp.mjs';
import { DUMMY_LABEL } from '../tools/flow/seal.mjs';
import { createDummyPackage, readPackageFiles } from '../tools/flow/sprites.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';

const store = createDummyStore();
// The scripted runner supplies this fixture too. The standalone MCP must have a worker output before it offers hosted creation.
const work = await mkdtemp(path.join(tmpdir(), 'oddbout-dummy-mcp-'));
try {
  const pack = await createDummyPackage(path.join(work, 'hosted'), {
    name: 'DUMMY Hosted Bot',
    localId: 'dummy-hosted-bot',
    prompt: 'teal geometric hosted placeholder',
  });
  store.setPlaceholder(await readPackageFiles(pack.dir));
} finally {
  // All bytes are now in the in-memory store. No temporary directory needs to survive the MCP process.
  await rm(work, { recursive: true, force: true });
}
const server = createDummyMcp(store, { roots: [process.cwd()] });
process.stderr.write(`${DUMMY_LABEL}\nThis process does not open a production connection.\n`);
await server.connect(new StdioServerTransport());
