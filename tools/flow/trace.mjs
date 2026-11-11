// @ts-check
// Opt-in local evidence for dummy flows. Never proves that a live model chose a call.
import { openSync, writeSync, closeSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

/** @param {string} file @param {Record<string, unknown>} metadata */
export function createTraceRecorder(file, metadata) {
  // Do not overwrite a previous run or follow an existing symlink.
  const fd = openSync(file, 'wx', 0o600);
  let sequence = 0;
  let closed = false;
  /** @param {string} type @param {unknown} data */
  const record = (type, data) => {
    if (closed) throw new Error('dummy-trace-closed');
    const bytes = Buffer.from(JSON.stringify({ sequence: sequence++, time: new Date().toISOString(), type, data }) + '\n');
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (!written) throw new Error('dummy-trace-write-failed');
      offset += written;
    }
  };
  try {
    record('metadata', { ...metadata, version: 1, production: false, evaluation: 'unscored-tool-transcript' });
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return {
    record,
    /** @param {string} [reason] */
    close(reason = 'session-closed') {
      if (closed) return;
      try {
        record('end', { reason });
      } finally {
        closed = true;
        closeSync(fd);
      }
    },
  };
}

/** Records parsed protocol messages before tool validation, not only successful handler calls. */
export class TracedStdioTransport extends StdioServerTransport {
  /** @param {ReturnType<typeof createTraceRecorder>} trace */
  constructor(trace) {
    super();
    this.trace = trace;
  }
  async start() {
    const receive = this.onmessage;
    const reportError = this.onerror;
    this.onerror = (/** @type {Error} */ error) => {
      try {
        this.trace.record('transport_error', { message: error.message });
      } catch {
        // Evidence storage may be the failed component. Close even when it cannot record the error.
      } finally {
        try {
          reportError?.(error);
        } finally {
          void this.close();
        }
      }
    };
    this.onmessage = (/** @type {Parameters<StdioServerTransport['send']>[0]} */ message) => {
      // A failed evidence write must not dispatch an unrecorded action.
      try {
        this.trace.record('receive', message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        void this.close();
        return;
      }
      receive?.(message);
    };
    await super.start();
  }
  /** @param {Parameters<StdioServerTransport['send']>[0]} message */
  async send(message) {
    try {
      this.trace.record('send', message);
      await super.send(message);
    } catch (error) {
      await this.close();
      throw error;
    }
  }
}
