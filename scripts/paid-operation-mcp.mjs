#!/usr/bin/env node
// @ts-check
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createPaidOperationClient, createPaidOperationMcp } from '../mcp/paid-operations.mjs';

const origin = process.env.ODDBOUT_COMMERCE_ORIGIN;
if (!origin) throw new Error('ODDBOUT_COMMERCE_ORIGIN-required');
const server = createPaidOperationMcp(createPaidOperationClient({ origin }));
await server.connect(new StdioServerTransport());
