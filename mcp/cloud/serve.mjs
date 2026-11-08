// @ts-check
import { WebStandardStreamableHTTPServerTransport, createMcpHandler, isLegacyRequest } from '@modelcontextprotocol/server';

/** @typedef {import('@modelcontextprotocol/server').McpServer} McpServer */

/**
 * Serves one request on a server built for it, whichever protocol its client speaks (SDK v2, 2026-11-03), answered as one JSON body: the
 * gateway and the hosts read one body, and no tool sends progress. A 2025-era request (no 2026-07-28 envelope) goes through a stateless
 * transport as before v2, which closes the server after; a 2026-07-28 one through the SDK's own handler, given the server through authInfo
 * (passed through as-is, never read from headers). Make one per handler, not per request: the SDK warns at each that JSON answers drop progress.
 * @param {number} maxRequestBodySize
 * @returns {(server: McpServer, request: Request, body: unknown) => Promise<Response>}
 */
export function mcpServing(maxRequestBodySize) {
  // biome-ignore lint/correctness/noUnsafeOptionalChaining: a request without auth info throws here, as it always has
  const modern = createMcpHandler(ctx => /** @type {{ server: McpServer }} */ (ctx.authInfo?.extra).server, {
    legacy: 'reject',
    responseMode: 'json',
    maxRequestBodySize,
  });
  return async (server, request, body) => {
    if (!(await isLegacyRequest(request, body))) {
      return modern.fetch(request, { parsedBody: body, authInfo: { token: 'verified-by-oddbout', clientId: 'oddbout', scopes: [], extra: { server } } });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request, { parsedBody: body });
    } finally {
      await server.close();
    }
  };
}
