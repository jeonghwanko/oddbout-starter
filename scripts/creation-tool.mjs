// @ts-check
// The same validated project tools in PC and hosted workspaces, without installing a second plugin.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, InMemoryTransport, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client';
import { createServer } from '../mcp/server.mjs';
import { writeCliJson } from '../dots.mjs';
import { fileContextRequest, parseContextFileArgs } from './creation-context-file.mjs';
import kit from '../package.json' with { type: 'json' };

// The server runs in this process and its tools ignore cancellation, so the SDK's 60 s request timeout never stopped one: it
// reported a fitted pack that went on to finish as failed (74 s on CI, 2026-11-02). A tool's own limits decide how long it runs.
const IN_PROCESS_TIMEOUT_MS = 2 ** 31 - 1;

/** @param {{ workspace?: string, name?: string, args?: Record<string, unknown>, contextRequest?: typeof fetch }} [options] */
export async function creationTool({ workspace, name, args = {}, contextRequest } = {}) {
  if (!workspace || !path.isAbsolute(workspace)) throw Error('absolute-workspace-required');
  const root = await realpath(workspace);
  if (!(await stat(root)).isDirectory()) throw Error('workspace-directory-required');
  // Registration belongs to the connected ODDBOUT account. Never inherit a CLI login or its tokens.
  const server = createServer({ root, contextRequest });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'oddbout-workspace', version: kit.version });
  try {
    await server.connect(serverSide);
    await client.connect(clientSide);
    const options = { timeout: IN_PROCESS_TIMEOUT_MS };
    if (!name) return await client.listTools(undefined, options);
    try { return await client.callTool({ name, arguments: args }, options); }
    catch (error) {
      // SDK v2 answers a tool the server does not list with the spec's -32602, not a tool result (v1 gave one): name it, so a mistyped
      // tool reads as one and not as a workspace command that failed.
      if (error instanceof ProtocolError && error.code === ProtocolErrorCode.InvalidParams && /^Tool .+ not found$/.test(error.message)) throw Error('unknown-tool');
      throw error;
    }
  } finally { await client.close(); await server.close(); }
}

/** @param {string[]} argv */
export async function main(argv) {
  // Arguments are in a JSON file so prompts and shell metacharacters are never executed as code.
  const { args: positional, contextFile, contextReceipt } = parseContextFileArgs(argv);
  const [operation, workspace, name, input, ...extra] = positional;
  if (extra.length || !['list', 'call'].includes(operation) || operation === 'list' && (name || input)
    || operation === 'call' && !name) throw Error('usage: creation:tool -- list <absolute-workspace> | call <absolute-workspace> <tool> [arguments.json]');
  const args = input ? JSON.parse(await readFile(input, 'utf8')) : {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('arguments-object-required');
  const contextRequest = contextFile && contextReceipt ? await fileContextRequest(contextFile, contextReceipt) : undefined;
  return creationTool({ workspace, name, args, contextRequest });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await main(process.argv.slice(2));
    await writeCliJson(1, result);
    if (result.isError) process.exitCode = 1;
  } catch (/** @type {any} */ error) {
    // Do not echo file contents, login data or arbitrary server exception text.
    process.exitCode = 1;
    try { await writeCliJson(2, { ok: false, code: /^[a-z][a-z-]+$/.test(error.message) ? error.message : 'workspace-command-failed' }); }
    catch { /* Preserve failure when stderr cannot deliver an error. */ }
  }
}
