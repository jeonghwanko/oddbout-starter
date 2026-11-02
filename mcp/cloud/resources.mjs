// @ts-check
// The cloud MCP's addresses, one copy for the function (mcp/cloud.mjs) and the mcp.oddbout.com gateway (worker/cloud-gateway.mjs). No imports:
// the Render gateway loads it without the server API. Two copies had to be changed together for every new address (MCP 점검 2026-11-03).

/** The production project: its functions and its Auth. The issuer and these addresses are what a token is checked against. */
const PROJECT = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co';
/** The function itself, and the gateway's only upstream. */
export const CLOUD_RESOURCE = `${PROJECT}/functions/v1/ai-fighter-mcp`;
export const LEGACY_PUBLIC_RESOURCE = 'https://ai-fighter-validator.onrender.com/mcp';
export const PUBLIC_RESOURCE = 'https://mcp.oddbout.com/mcp';
/**
 * Sign-in first (2026-10-28): the same server at `<function>/signin` asks every request for a sign-in, not only the account tools. Grok's custom
 * connector has no option for it: it decides at its first request whether a server needs one. At mcp.oddbout.com the public tools answer signed
 * out (ChatGPT relies on that), so Grok connected without an account and never offered the sign-in. Its tokens carry the same audience.
 */
export const SIGN_IN_RESOURCE = `${CLOUD_RESOURCE}/signin`;
/**
 * The same sign-in-first address through mcp.oddbout.com (2026-11-01, worker/cloud-gateway.mjs). There the host root is ours, so a client that
 * looks for the metadata at `/.well-known/oauth-protected-resource/signin` (RFC 9728, as Cursor's Grok Bot does) finds it; at the Supabase
 * host it got a 401 and gave up its sign-in. The Supabase address keeps working for connectors already added with it.
 */
export const PUBLIC_SIGN_IN_RESOURCE = 'https://mcp.oddbout.com/signin';
/**
 * The Claude directory edition (2026-11-01, cloud/directory-edition.mjs): the same server at `<function>/claude` lists only the tools a
 * directory reviewer can run in Claude, signed out like the public address. Its tokens carry the same audience, as the sign-in-first ones do.
 */
export const DIRECTORY_RESOURCE = `${CLOUD_RESOURCE}/claude`;
/** The address the directory listing names, through mcp.oddbout.com (worker/cloud-gateway.mjs). */
export const PUBLIC_DIRECTORY_RESOURCE = 'https://mcp.oddbout.com/claude';
/** The page the directory edition's metadata points to: connecting ODDBOUT in Claude. */
export const DIRECTORY_DOCUMENTATION = 'https://oddbout.com/cloud-plugin/claude.html';
export const CLOUD_ISSUER = `${PROJECT}/auth/v1`;
/** ODDBOUT's arena function (the game's `oddbout-arena`): rankings, records, cups, bout records, and the agent calls behind its key. */
export const ARENA_URL = `${PROJECT}/functions/v1/oddbout-arena`;
/** The API function's own ticket upload route (the terminal picture route skips the gateway, whose body limit is 64 KB). */
export const TICKET_UPLOAD_URL = `${PROJECT}/functions/v1/ai-fighter/generations/ticket-uploads`;
