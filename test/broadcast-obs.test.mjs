import test from 'node:test';
import assert from 'node:assert/strict';
import { createObsClient, validateObsUrl } from '../broadcast/obs.mjs';

function websocket({ hello = { rpcVersion: 1 }, onIdentify, onRequest, silent = false } = {}) {
  const instances = [];
  class FakeSocket extends EventTarget {
    sent = [];
    closed = false;
    constructor(url, protocol) {
      super();
      this.url = url;
      this.protocol = protocol;
      instances.push(this);
      if (!silent) queueMicrotask(() => this.frame({ op: 0, d: hello }));
    }
    frame(value) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
    }
    send(text) {
      const frame = JSON.parse(text);
      this.sent.push(frame);
      if (frame.op === 1) {
        onIdentify?.(frame, this);
        queueMicrotask(() => this.frame({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      }
      if (frame.op === 6) onRequest?.(frame, this);
    }
    close() {
      this.closed = true;
    }
  }
  return { WebSocketImpl: FakeSocket, instances };
}
function response(frame, data, result = true) {
  return {
    op: 7,
    d: {
      requestType: frame.d.requestType,
      requestId: frame.d.requestId,
      requestStatus: { result, code: result ? 100 : 600, comment: 'never expose private-password' },
      responseData: data,
    },
  };
}

test('OBS authentication algorithm with documented challenge, Identify once, correlated out-of-order replies', async () => {
  const requests = [];
  const fake = websocket({
    hello: {
      rpcVersion: 1,
      authentication: { challenge: '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=', salt: 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=' },
    },
    onIdentify(frame) {
      assert.deepEqual(frame.d, { rpcVersion: 1, eventSubscriptions: 0, authentication: '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=' });
    },
    onRequest(frame) {
      requests.push(frame);
    },
  });
  const client = await createObsClient({ url: 'ws://127.0.0.1:4455', password: 'supersecretpassword', ...fake });
  const first = client.request('GetVersion');
  const second = client.request('GetStreamStatus');
  assert.notEqual(requests[0].d.requestId, requests[1].d.requestId);
  fake.instances[0].frame(response(requests[1], { outputActive: false }));
  fake.instances[0].frame({ op: 5, d: { eventType: 'IgnoredEvent' } });
  fake.instances[0].frame(response(requests[0], { obsVersion: '32.0.0' }));
  assert.deepEqual(await first, { obsVersion: '32.0.0' });
  assert.deepEqual(await second, { outputActive: false });
  assert.equal(fake.instances[0].sent.filter(frame => frame.op === 1).length, 1);
  assert.doesNotMatch(JSON.stringify(fake.instances[0].sent), /supersecretpassword/);
  client.close();
  assert.equal(fake.instances[0].closed, true);
  await assert.rejects(client.request('GetVersion'), /obs_not_connected/);
});

test('missing auth and malformed protocol close cleanly without leaking server data', async () => {
  for (const hello of [{ rpcVersion: 1, authentication: { salt: 's', challenge: 'c' } }, { rpcVersion: 0 }, { rpcVersion: 'private-password' }]) {
    const fake = websocket({ hello });
    await assert.rejects(createObsClient({ url: 'ws://localhost:4455', ...fake }), error => {
      assert.doesNotMatch(error.stack + JSON.stringify(error), /private-password/);
      return true;
    });
    assert.equal(fake.instances[0].closed, true);
  }
});

test('handshake and request timeouts are bounded; late reply is ignored', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = websocket({ silent: true });
  const connect = createObsClient({ url: 'ws://localhost:4455', timeoutMs: 10, ...silent });
  const rejected = assert.rejects(connect, /obs_handshake_timeout/);
  t.mock.timers.tick(10);
  await rejected;
  assert.equal(silent.instances[0].closed, true);
  let request;
  const fake = websocket({
    onRequest(frame) {
      request = frame;
    },
  });
  const client = await createObsClient({ url: 'ws://localhost:4455', timeoutMs: 10, ...fake });
  const pending = assert.rejects(client.request('GetVersion'), /obs_request_timeout/);
  t.mock.timers.tick(10);
  await pending;
  fake.instances[0].frame(response(request, { late: true }));
  client.close();
});

test('request failure redacts comments; mismatched response type rejects active work', async () => {
  const fake = websocket({
    onRequest(frame, socket) {
      socket.frame(response(frame, {}, false));
    },
  });
  const client = await createObsClient({ url: 'ws://localhost:4455', ...fake });
  await assert.rejects(client.request('GetVersion'), error => {
    assert.equal(error.code, 'obs_request_failed');
    assert.equal(error.status, 600);
    assert.doesNotMatch(error.stack + JSON.stringify(error), /private-password/);
    return true;
  });
  client.close();
  const mismatch = websocket({
    onRequest(frame, socket) {
      const reply = response(frame, {});
      reply.d.requestType = 'StartStream';
      socket.frame(reply);
    },
  });
  const other = await createObsClient({ url: 'ws://localhost:4455', ...mismatch });
  await assert.rejects(other.request('GetVersion'), /obs_protocol_error/);
  assert.equal(mismatch.instances[0].closed, true);
});

test('socket failure closes and rejects pending requests, including explicit close', async () => {
  for (const action of ['error', 'close', 'explicit']) {
    const fake = websocket();
    const client = await createObsClient({ url: 'ws://localhost:4455', ...fake });
    const pending = assert.rejects(client.request('GetVersion'), /obs_(connection_error|connection_closed|client_closed)/);
    if (action === 'explicit') client.close();
    else fake.instances[0].dispatchEvent(new Event(action));
    await pending;
    assert.equal(fake.instances[0].closed, true);
  }
});

test('rejects plaintext external OBS, URL credentials and unsupported schemes', () => {
  for (const value of [
    'ws://office-stable:4455',
    'ws://127.0.0.1.attacker.test',
    'wss://password@host',
    'http://localhost:4455',
    'ws://localhost:4455/?password=secret',
  ])
    assert.throws(() => validateObsUrl(value), /obs_invalid_url/);
  assert.equal(validateObsUrl('wss://obs.example.test'), 'wss://obs.example.test/');
});
