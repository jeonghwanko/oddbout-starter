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

/** @param {{ probe?: boolean, configPath?: string, fetcher?: typeof fetch }} [options] */
export async function checkCloudDiscovery({ probe = false, configPath, fetcher = fetch } = {}) {
  const result = { config: 'invalid', server: 'unverified', hostPlugin: 'unverified', conversationTools: 'unverified', account: 'unverified' };
  try {
    const text = configPath ? await readFile(configPath, 'utf8') : await readFile(pluginConfig, 'utf8').catch(() => readFile(bundledConfig, 'utf8'));
    const config = JSON.parse(text);
    if (!sameShape(config, expectedConfig)) return result;
  } catch { return result; }
  result.config = 'valid';
  if (!probe) return result;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
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
    if (result.config !== 'valid' || args.includes('--probe') && result.server !== 'discovered') process.exitCode = 1;
  }
}
