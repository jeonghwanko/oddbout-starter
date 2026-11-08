import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { errorCode } from '../mcp/error-code.mjs';
import { createServer } from '../mcp/server.mjs';

test('only our kebab-case codes reach the client; raw messages become the fallback', () => {
  assert.equal(errorCode(Error('session-busy-or-interrupted-lock'), 'fallback'), 'session-busy-or-interrupted-lock');
  for (const raw of ['fetch failed', 'Unexpected token < in JSON', "ENOENT: no such file, open 'C:\\Users\\x'", '', '-leading-dash', 'x'.repeat(90)])
    assert.equal(errorCode(Error(raw), 'fallback'), 'fallback', raw);
  assert.equal(errorCode(undefined, 'fallback'), 'fallback');
  assert.equal(errorCode('not an error', 'fallback'), 'fallback');
  assert.equal(
    errorCode(Object.assign(Error('ENOENT: missing'), { code: 'ENOENT' }), 'fallback', { missing: 'record-or-file-not-found' }),
    'record-or-file-not-found',
  );
  assert.equal(errorCode(Error('terminated'), 'context-fallback', { prefix: 'creation-context-' }), 'context-fallback', 'a library word is not ours');
  assert.equal(errorCode(Error('creation-context-incompatible'), 'context-fallback', { prefix: 'creation-context-' }), 'creation-context-incompatible');
});

test('an outdated game context reports why instead of looking like an outage', async () => {
  const call = async contextRequest => {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await createServer({ contextRequest }).connect(serverSide);
    const client = new Client({ name: 'error-code-test', version: '1.0.0' });
    await client.connect(clientSide);
    try {
      return (await client.callTool({ name: 'get_fighter_spec', arguments: { section: 'context' } })).structuredContent;
    } finally {
      await client.close();
    }
  };
  const incompatible = await call(async () => Response.json({ contextVersion: 2, owner: 'game' }));
  assert.deepEqual([incompatible.ok, incompatible.code], [false, 'creation-context-incompatible']);
  const offline = await call(async () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual([offline.ok, offline.code], [false, 'creation-context-unavailable']);
});
