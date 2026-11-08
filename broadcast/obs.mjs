// @ts-check
import { createHash, randomUUID } from 'node:crypto';

export class ObsError extends Error {
  /** @param {string} code @param {number} [status] */
  constructor(code, status = 0) {
    super(code);
    this.name = 'ObsError';
    this.code = code;
    this.status = status;
  }
}

/** @param {string} value */
export function validateObsUrl(value) {
  try {
    const url = new URL(value);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    if (url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error();
    return url.href;
  } catch {
    throw new ObsError('obs_invalid_url');
  }
}

/** @typedef {{request:(type:string,data?:Record<string,unknown>)=>Promise<Record<string,any>>,close:()=>void}} ObsClient */
/** OBS WebSocket 5 / RPC 1, JSON text transport. No automatic reconnect/retry.
 * @param {{url:string,password?:string,WebSocketImpl?:typeof WebSocket,timeoutMs?:number}} options
 * @returns {Promise<ObsClient>} */
export async function createObsClient({ url, password = '', WebSocketImpl = globalThis.WebSocket, timeoutMs = 5000 }) {
  validateObsUrl(url);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 || typeof password !== 'string') throw new ObsError('obs_invalid_options');
  /** @type {WebSocket} */
  let socket;
  try {
    socket = new WebSocketImpl(url, 'obswebsocket.json');
  } catch {
    throw new ObsError('obs_connect_failed');
  }
  let state = 'hello';
  /** @type {Map<string,{type:string,resolve:(data:Record<string,any>)=>void,reject:(error:ObsError)=>void,timer:ReturnType<typeof setTimeout>}>} */
  const pending = new Map();
  /** @type {(client:ObsClient)=>void} */
  let connected;
  /** @type {(error:ObsError)=>void} */
  let rejected;
  const ready = new Promise((resolve, reject) => {
    connected = resolve;
    rejected = reject;
  });
  const handshakeTimer = setTimeout(() => fail(new ObsError('obs_handshake_timeout')), timeoutMs);

  function cleanup() {
    clearTimeout(handshakeTimer);
    socket.removeEventListener('message', message);
    socket.removeEventListener('error', socketError);
    socket.removeEventListener('close', socketClose);
  }
  /** @param {ObsError} error */
  function fail(error) {
    if (state === 'closed') return;
    state = 'closed';
    cleanup();
    rejected(error);
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
    try {
      socket.close();
    } catch {
      /* No upstream exception details. */
    }
  }
  const socketError = () => fail(new ObsError('obs_connection_error'));
  const socketClose = () => fail(new ObsError('obs_connection_closed'));

  /** @type {ObsClient} */
  const client = {
    request(type, data = {}) {
      if (state !== 'ready') return Promise.reject(new ObsError('obs_not_connected'));
      if (!/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(type) || !data || typeof data !== 'object' || Array.isArray(data))
        return Promise.reject(new ObsError('obs_invalid_request'));
      if (pending.size >= 32) return Promise.reject(new ObsError('obs_too_many_requests'));
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new ObsError('obs_request_timeout'));
        }, timeoutMs);
        pending.set(requestId, { type, resolve, reject, timer });
        try {
          const frame = JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data } });
          if (Buffer.byteLength(frame) > 256 * 1024) throw new Error();
          socket.send(frame);
        } catch {
          clearTimeout(timer);
          pending.delete(requestId);
          reject(new ObsError('obs_send_failed'));
        }
      });
    },
    close() {
      fail(new ObsError('obs_client_closed'));
    },
  };

  /** @param {MessageEvent} event */
  function message(event) {
    try {
      if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 256 * 1024) throw new Error();
      const frame = JSON.parse(event.data);
      if (!frame || typeof frame.d !== 'object' || !frame.d || Array.isArray(frame.d)) throw new Error();
      if (state === 'hello') {
        if (frame.op !== 0 || !Number.isInteger(frame.d.rpcVersion) || frame.d.rpcVersion < 1) throw new Error();
        /** @type {{rpcVersion:number,eventSubscriptions:number,authentication?:string}} */
        const identify = { rpcVersion: 1, eventSubscriptions: 0 };
        if (frame.d.authentication !== undefined) {
          const auth = frame.d.authentication;
          if (!password || typeof auth?.salt !== 'string' || typeof auth?.challenge !== 'string' || auth.salt.length > 1024 || auth.challenge.length > 1024) {
            fail(new ObsError('obs_authentication_required'));
            return;
          }
          const secret = createHash('sha256')
            .update(password + auth.salt)
            .digest('base64');
          identify.authentication = createHash('sha256')
            .update(secret + auth.challenge)
            .digest('base64');
        }
        state = 'identifying';
        socket.send(JSON.stringify({ op: 1, d: identify }));
      } else if (state === 'identifying') {
        if (frame.op !== 2 || frame.d.negotiatedRpcVersion !== 1) throw new Error();
        state = 'ready';
        clearTimeout(handshakeTimer);
        connected(client);
      } else if (state === 'ready') {
        if (frame.op === 5) return;
        if (frame.op !== 7 || typeof frame.d.requestId !== 'string') throw new Error();
        const item = pending.get(frame.d.requestId);
        if (!item) return; // Timed out, duplicated, or unrelated response.
        if (frame.d.requestType !== item.type || typeof frame.d.requestStatus?.result !== 'boolean' || !Number.isInteger(frame.d.requestStatus.code))
          throw new Error();
        pending.delete(frame.d.requestId);
        clearTimeout(item.timer);
        if (!frame.d.requestStatus.result) item.reject(new ObsError('obs_request_failed', frame.d.requestStatus.code));
        else if (frame.d.requestStatus.code !== 100) item.reject(new ObsError('obs_invalid_response'));
        else if (
          frame.d.responseData !== undefined &&
          (!frame.d.responseData || typeof frame.d.responseData !== 'object' || Array.isArray(frame.d.responseData))
        )
          item.reject(new ObsError('obs_invalid_response'));
        else item.resolve(frame.d.responseData ?? {});
      }
    } catch {
      fail(new ObsError('obs_protocol_error'));
    }
  }
  socket.addEventListener('message', message);
  socket.addEventListener('error', socketError);
  socket.addEventListener('close', socketClose);
  return /** @type {Promise<ObsClient>} */ (ready);
}
