// @ts-check
// Stdio MCP the owner can point an agent at. It serves the in-memory dummy store and nothing on the public internet.
import { McpServer } from '@modelcontextprotocol/server';
import { createConnector, DUMMY_TOOLS, dummyToolSchema } from './connector.mjs';
import { DUMMY_LABEL } from './seal.mjs';
import { permissionFor } from '../../mcp/tool-permissions.mjs';

/**
 * @param {any} store
 * @param {{ roots: string[], packageRoot?: string }} options
 */
export function createDummyMcp(store, options) {
  const connector = createConnector(store, options);
  const server = new McpServer(
    { name: 'oddbout-dummy', version: '0.0.0-dummy' },
    {
      instructions: `${DUMMY_LABEL} Do not treat any result as production registration. Do not call a live ODDBOUT URL. Tokens are not spent. Images are not generated.`,
    },
  );
  for (const tool of DUMMY_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: /** @type {any} */ (dummyToolSchema(tool)),
        _meta: { oddbout: { permission: permissionFor(tool.name) } },
      },
      async (/** @type {any} */ args) => {
        const body = await connector.call(tool.name, args);
        return {
          isError: body.ok === false,
          structuredContent: body,
          content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(body) }],
        };
      },
    );
  }
  return server;
}
