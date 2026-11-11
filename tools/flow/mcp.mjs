// @ts-check
// Stdio MCP the owner can point an agent at. It serves the in-memory dummy store and nothing on the public internet.
import { McpServer } from '@modelcontextprotocol/server';
import { createConnector, DUMMY_TOOLS, dummyToolSchema } from './connector.mjs';
import { DUMMY_LABEL } from './seal.mjs';

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
  let stopping = false;
  /** @type {Set<Promise<any>>} */
  const active = new Set();
  for (const tool of DUMMY_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: /** @type {any} */ (dummyToolSchema(tool)) },
      async (/** @type {any} */ args) => {
        if (stopping) throw new Error('dummy-session-closing');
        const operation = connector.call(tool.name, args);
        active.add(operation);
        let body;
        try {
          body = await operation;
        } finally {
          active.delete(operation);
        }
        return {
          isError: body.ok === false,
          structuredContent: body,
          content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(body) }],
        };
      },
    );
  }
  return Object.assign(server, {
    async closeAndDrain() {
      // Closing MCP aborts replies, not Sharp/file writes already started by a tool.
      // Stop admission first and settle those writes before deleting the session directory.
      stopping = true;
      try {
        await server.close();
      } finally {
        await Promise.allSettled([...active]);
      }
    },
  });
}
