/** Non-secret, owner-scoped recovery journal. Authentication tokens never enter it. */
export function createOperationJournal(storage, owner, { locks = globalThis.navigator?.locks } = {}) {
  const key = `oddbout.broadcast.operations.v1:${owner}`;
  function read() {
    const raw = storage.getItem(key);
    if (!raw) return { pending: {}, selected: {} };
    const state = JSON.parse(raw);
    if (!state?.pending || !state.selected || typeof state.pending !== 'object' || typeof state.selected !== 'object') throw new Error('Saved operations need reconciliation. Do not clear them to retry.');
    return state;
  }
  const write = state => storage.setItem(key, JSON.stringify(state));
  return {
    async exclusive(callback) {
      if (!locks?.request) throw new Error('This browser cannot safely coordinate payments between tabs. Use a browser with Web Locks support.');
      return locks.request(key, { ifAvailable: true }, lock => {
        if (!lock) throw new Error('Another tab is processing this account. Wait for that request before retrying.');
        return callback();
      });
    },
    get: name => read().pending[name] ?? null,
    begin(name, input) {
      const state = read(), existing = state.pending[name];
      if (existing) {
        if (JSON.stringify(existing.input) !== JSON.stringify(input)) throw new Error(`A pending ${name} has different settings. Recover that request before starting another.`);
        return existing;
      }
      const value = { input, requestKey: crypto.randomUUID(), dispatched: false };
      state.pending[name] = value;
      write(state);
      return value;
    },
    markDispatched(name, requestKey) {
      const state = read();
      if (state.pending[name]?.requestKey !== requestKey) throw new Error('The pending request changed. Reconcile the original request.');
      state.pending[name].dispatched = true;
      write(state); // Persist before fetch: a crash or lost reply must retain uncertainty.
    },
    acknowledge(name, requestKey, result) {
      const state = read();
      if (state.pending[name]?.requestKey !== requestKey) throw new Error('The pending request changed. Reconcile the original request.');
      state.pending[name].result = result; write(state);
    },
    complete(name, requestKey) {
      const state = read();
      if (!state.pending[name]) return;
      if (state.pending[name].requestKey !== requestKey) throw new Error('The pending request changed. Reconcile the original request.');
      delete state.pending[name]; write(state);
    },
    select(name, value) { const state = read(); state.selected[name] = value; write(state); },
    selected: name => read().selected[name] ?? '',
  };
}

// A refusal proves only that this attempt did not commit. Callers must also prove
// that no previous attempt was dispatched before clearing the operation key.
export function isConfirmedRejection(error) {
  return error?.responseOk === false && [400, 401, 402, 403, 404, 409, 415, 422].includes(error.status)
    && new Set(['authentication-required', 'web-approval-required', 'json-required', 'unknown-product',
      'unknown-host', 'invalid-channel', 'invalid-budget', 'invalid-end-time', 'invalid-fighters',
      'invalid-request-key', 'not-found', 'insufficient-credits', 'approval-expired', 'approval-used',
      'channel-busy', 'broadcast-stopped', 'price-version-conflict',
      // A payout proposal refused before its batch row exists: nothing was created.
      'nothing-to-pay']).has(error.code);
}
