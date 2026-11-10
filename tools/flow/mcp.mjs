// @ts-check
// Stdio MCP the owner can point an agent at. It serves the in-memory dummy store and nothing on the public internet.
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createConnector, DUMMY_TOOLS } from './connector.mjs';
import { DUMMY_LABEL } from './seal.mjs';

/**
 * @param {any} store
 * @param {{ roots: string[] }} options
 */
export function createDummyMcp(store, { roots }) {
  const connector = createConnector(store, { roots });
  const server = new McpServer(
    { name: 'oddbout-dummy', version: '0.0.0-dummy' },
    {
      instructions: `${DUMMY_LABEL} Do not treat any result as production registration. Do not call a live ODDBOUT URL. Tokens are not spent. Images are not generated.`,
    },
  );
  for (const tool of DUMMY_TOOLS) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: z.object(tool.shape) }, async args => {
      const body = await connector.call(tool.name, args);
      return {
        isError: body.ok === false,
        structuredContent: body,
        content: [{ type: 'text', text: JSON.stringify(body) }],
      };
    });
  }
  return server;
}
