// @ts-check
// Read-only public MCP discovery. A server response cannot establish host installation or account identity.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const endpoint = 'https://mcp.oddbout.com/mcp';
const pluginConfig = fileURLToPath(new URL('../plugins/ai-fighter/mcp.json', import.meta.url));
const bundledConfig = fileURLToPath(new URL('../../mcp.json', import.meta.url));
const required = ['get_profile', 'check_creation_readiness'];
const limit = 1024 * 1024;
const expectedConfig = { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: { oddbout: {
  type: 'streamable-http', url: endpoint, extensions: { 'com.openai': { auth: { type: 'mixed', client: { mode: 'dcr' },
    baseScopes: ['openid', 'email', 'profile'], oidcEnabled: true } } } } } };
/** @param {unknown} a @param {unknown} b @returns {boolean} */
function sameShape(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameShape(v, b[i]));
  const x = /** @type {Record<string, unknown>} */ (a), y = /** @type {Record<string, unknown>} */ (b);
  return Object.keys(x).length === Object.keys(y).length && Object.keys(y).every(key => Object.hasOwn(x, key) && sameShape(x[key], y[key]));
}

/** @param {Response} response */
async function boundedText(response) {
  if (Number(response.headers.get('content-length')) > limit) throw Error('response-too-large');
  if (!response.body) return '';
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw Error('response-too-large'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** @param {Response} response */
async function message(response) {
  const body = await boundedText(response), type = response.headers.get('content-type') ?? '';
  if (type.includes('text/event-stream')) {
    const events = body.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean);
    if (events.length !== 1) throw Error('malformed-response');
    return JSON.parse(events[0]);
  }
  if (!type.includes('application/json')) throw Error('malformed-response');
  return JSON.parse(body);
}

const MODERN = '2026-07-28';
/**
 * The same server as a 2026-07-28 client sees it: no session, `server/discover` then `tools/list`, each with the Mcp-* headers and its
 * `_meta` envelope. A failure here leaves the 2025 result as it was. It has its own time limit: sharing the 2025 one, the first probe
 * after a deploy (cold function and gateway, five requests in 10 s) reported a network error (2026-11-03).
 * @param {typeof fetch} fetcher @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function discoverModern(fetcher, timeoutMs) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs), signal = controller.signal;
  const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'oddbout-discovery', version: '1' } };
  try {
    /** @param {number} id @param {string} method @returns {Promise<{ status: string } | { result: any }>} */
    const call = async (id, method) => {
      const response = await fetcher(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MODERN, 'mcp-method': method }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { _meta: meta } }),
        redirect: 'error', credentials: 'omit', signal });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { status: response.status === 401 ? 'authentication-required' : 'http-error' }; }
      const reply = await message(response);
      if (!reply || typeof reply !== 'object' || reply.jsonrpc !== '2.0' || reply.id !== id || !reply.result || typeof reply.result !== 'object') throw Error('malformed-response');
      return { result: reply.result };
    };
    const discovered = await call(3, 'server/discover');
    if ('status' in discovered) return discovered.status;
    if (!Array.isArray(discovered.result.supportedVersions) || !discovered.result.supportedVersions.includes(MODERN)) return 'version-unsupported';
    const listed = await call(4, 'tools/list');
    if ('status' in listed) return listed.status;
    if (!Array.isArray(listed.result.tools) || listed.result.nextCursor || !listed.result.tools.every(/** @param {any} tool */ tool => typeof tool?.name === 'string')) {
      return 'malformed-response';
    }
    return required.every(name => listed.result.tools.some(/** @param {any} tool */ tool => tool.name === name)) ? 'discovered' : 'required-tools-missing';
  } catch (error) {
    return error instanceof SyntaxError || error instanceof Error && ['malformed-response','response-too-large'].includes(error.message) ? 'malformed-response' : 'network-error';
  } finally { clearTimeout(timeout); }
}

/** @param {{ probe?: boolean, configPath?: string, fetcher?: typeof fetch, timeoutMs?: number }} [options]  timeoutMs: each protocol's own limit */
export async function checkCloudDiscovery({ probe = false, configPath, fetcher = fetch, timeoutMs = 10000 } = {}) {
  const result = { config: 'invalid', server: 'unverified', modernServer: 'unverified', hostPlugin: 'unverified', conversationTools: 'unverified', account: 'unverified' };
  try {
    const text = configPath ? await readFile(configPath, 'utf8') : await readFile(pluginConfig, 'utf8').catch(() => readFile(bundledConfig, 'utf8'));
    const config = JSON.parse(text);
    if (!sameShape(config, expectedConfig)) return result;
  } catch { return result; }
  result.config = 'valid';
  if (!probe) return result;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
  /** @type {string | null} */ let session = null;
  /** @type {string | null} */ let protocol = null;
  try {
    /** @param {object} body */
    const post = async body => {
      /** @type {Record<string,string>} */ const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      if (session) headers['mcp-session-id'] = session;
      if (protocol) headers['mcp-protocol-version'] = protocol;
      return fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', credentials: 'omit', signal: controller.signal });
    };
    /** @param {Response} response */
    const failed = async response => { await response.body?.cancel().catch(() => {}); result.server = response.status === 401 ? 'authentication-required' : 'http-error'; };
    let response = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'oddbout-discovery', version: '1' } } });
    if (!response.ok) { await failed(response); return result; }
    session = response.headers.get('mcp-session-id');
    const init = await message(response);
    if (!init || typeof init !== 'object' || init.jsonrpc !== '2.0' || init.id !== 1 || typeof init.result?.protocolVersion !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(init.result.protocolVersion)) throw Error('malformed-response');
    protocol = init.result.protocolVersion;
    response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    if (!response.ok) { await failed(response); return result; }
    await boundedText(response);
    response = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    if (!response.ok) { await failed(response); return result; }
    const listed = await message(response);
    if (!listed || typeof listed !== 'object' || listed.jsonrpc !== '2.0' || listed.id !== 2 || !Array.isArray(listed.result?.tools) || listed.result.nextCursor ||
      !listed.result.tools.every(/** @param {any} tool */ tool => typeof tool?.name === 'string')) throw Error('malformed-response');
    result.server = required.every(name => listed.result.tools.some(/** @param {any} tool */ tool => tool.name === name)) ? 'discovered' : 'required-tools-missing';
    if (result.server === 'discovered') result.modernServer = await discoverModern(fetcher, timeoutMs);
  } catch (error) {
    result.server = error instanceof SyntaxError || error instanceof Error && ['malformed-response','response-too-large'].includes(error.message) ? 'malformed-response' : 'network-error';
  } finally { clearTimeout(timeout); }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--probe')) { console.error('usage: check-cloud-discovery.mjs [--probe]'); process.exitCode = 1; }
  else {
    const result = await checkCloudDiscovery({ probe: args.includes('--probe') });
    console.log(JSON.stringify(result, null, 2));
    if (result.config !== 'valid' || args.includes('--probe') && (result.server !== 'discovered' || result.modernServer !== 'discovered')) process.exitCode = 1;
  }
}
