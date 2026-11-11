#!/usr/bin/env node
// @ts-check
// npm run flow:mcp — stdio MCP for an agent. Loopback memory only. stderr carries the dummy banner.
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDummyMcp } from '../tools/flow/mcp.mjs';
import { DUMMY_LABEL } from '../tools/flow/seal.mjs';
import { FIXTURE_NAMES, prepareDummyFixture } from '../tools/flow/fixtures.mjs';
import { startDummyServer } from '../tools/flow/server.mjs';
import { createTraceRecorder, TracedStdioTransport } from '../tools/flow/trace.mjs';

const args = process.argv.slice(2);
/** @type {Record<string, string>} */
const options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!['--fixture', '--trace', '--prompt-file'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) {
    throw new Error('Usage: npm run flow:mcp -- [--fixture empty|registered|quota] [--trace <new.jsonl> --prompt-file <prompt.txt>]');
  }
  options[key] = args[i + 1];
}
const fixture = options['--fixture'] ?? 'empty';
if (!FIXTURE_NAMES.includes(fixture)) throw new Error('unknown-dummy-fixture');
if (Boolean(options['--trace']) !== Boolean(options['--prompt-file'])) throw new Error('trace-and-prompt-file-required-together');
// This records the operator's declared prompt; it does not send that prompt to a model.
const prompt = options['--prompt-file'] ? await readFile(options['--prompt-file'], 'utf8') : null;
if (prompt !== null && !prompt.trim()) throw new Error('dummy-trace-empty-prompt');
const sourceHashes = options['--trace']
  ? Object.fromEntries(
      await Promise.all(
        ['AGENTS.md', 'plugins/ai-fighter/skills/create-fighter/SKILL.md', 'tools/flow/connector.mjs'].map(async file => [
          file,
          createHash('sha256')
            .update(await readFile(new URL(`../${file}`, import.meta.url)))
            .digest('hex'),
        ]),
      ),
    )
  : null;
const trace = options['--trace']
  ? createTraceRecorder(options['--trace'], { fixture, prompt, model: null, selectionMode: 'unverified', sourceHashes, node: process.version })
  : null;
/** @type {Awaited<ReturnType<typeof startDummyServer>> | undefined} */
let http;
/** @type {ReturnType<typeof createDummyMcp> | undefined} */
let server;
/** @type {string | undefined} */
let packageRoot;
let closing = false;
let starting = true;
/** @type {string | undefined} */
let pendingStop;
/** @param {string} [reason] */
async function shutdown(reason = 'session-closed') {
  if (closing) return;
  closing = true;
  let cleanupFailed = false;
  try {
    try {
      await server?.closeAndDrain();
    } finally {
      try {
        await http?.close();
      } finally {
        if (packageRoot) await rm(packageRoot, { recursive: true, force: true });
      }
    }
  } catch (error) {
    cleanupFailed = true;
    try {
      trace?.record('lifecycle_error', { message: error instanceof Error ? error.message : String(error) });
    } catch {
      // A failed recorder must remain incomplete, never look like successful cleanup.
    }
    throw error;
  } finally {
    process.stdin.destroy();
    trace?.close(cleanupFailed ? 'cleanup-failed' : reason);
  }
}
/** @param {string} [reason] */
function stop(reason = 'session-closed') {
  if (starting) {
    pendingStop = reason;
    return;
  }
  void shutdown(reason).catch(error => {
    process.exitCode = 1;
    console.error(error);
  });
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
try {
  const { store, setup } = await prepareDummyFixture(fixture);
  packageRoot = await mkdtemp(path.join(tmpdir(), 'oddbout-dummy-packages-'));
  http = await startDummyServer(store);
  server = createDummyMcp(store, { roots: [process.cwd(), packageRoot], packageRoot });
  server.server.onerror = () => {
    process.exitCode = 1;
  };
  server.server.onclose = () => stop();
  const manifest = { ...setup, dummyRegistrationUrl: http.url, packageRoot };
  process.stderr.write(`${DUMMY_LABEL}\n${JSON.stringify(manifest)}\nThis process does not open a production connection.\n`);
  trace?.record('setup', manifest);
  starting = false;
  if (pendingStop) await shutdown(pendingStop);
  else await server.connect(trace ? new TracedStdioTransport(trace) : new StdioServerTransport());
} catch (error) {
  starting = false;
  await shutdown('startup-failed');
  throw error;
}
