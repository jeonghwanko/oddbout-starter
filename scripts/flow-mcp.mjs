#!/usr/bin/env node
// @ts-check
// npm run flow:mcp — stdio MCP for an agent. Loopback memory only. stderr carries the dummy banner.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createDummyMcp } from '../tools/flow/mcp.mjs';
import { DUMMY_LABEL } from '../tools/flow/seal.mjs';
import { createDummyStore } from '../tools/flow/store.mjs';

const store = createDummyStore();
const server = createDummyMcp(store, { roots: [process.cwd()] });
process.stderr.write(`${DUMMY_LABEL}\nThis process does not open a production connection.\n`);
await server.connect(new StdioServerTransport());
