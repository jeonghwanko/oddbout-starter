import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SOURCE_REVISION = '28bf2c7a83b8a64836297340c52a45d716684aed';
export const MODEL_REVISION = '724fb5abbf5502583fb520898d45929e62f02c0b';
const MAX_WAV_BYTES = 32 * 1024 * 1024;
const DEFAULT_TEXT = '하암… 한 판만 하고, 다시 잘래.';

export function localBaseUrl(value = 'http://127.0.0.1:3900') {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('VoiceStudio URL must be a loopback origin without credentials, path, query or fragment.');
  }
  // A hosts-file change must not send the localhost alias to another machine.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}

async function responseBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Response exceeds size limit.');
  if (!response.body) throw new Error('Empty HTTP response.');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > limit) {
      await reader.cancel();
      throw new Error('Response exceeds size limit.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function request(base, endpoint, { fetchImpl = fetch, timeoutMs = 30000, ...options } = {}) {
  const response = await fetchImpl(`${localBaseUrl(base)}${endpoint}`, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await responseBytes(response, 64 * 1024);
    throw new Error(`VoiceStudio ${endpoint}: HTTP ${response.status}: ${body.toString('utf8').slice(0, 500)}`);
  }
  return response;
}

async function jsonGet(base, endpoint, options) {
  const response = await request(base, endpoint, options);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`${endpoint} did not return JSON.`);
  return JSON.parse((await responseBytes(response, 2 * 1024 * 1024)).toString('utf8'));
}

export async function status({ baseUrl, fetchImpl } = {}) {
  const base = localBaseUrl(baseUrl);
  const health = await jsonGet(base, '/health', { fetchImpl });
  const schema = await jsonGet(base, '/openapi.json', { fetchImpl });
  const voices = await jsonGet(base, '/v1/audio/voices', { fetchImpl });
  const engine = voices.engines?.find(item => item.id === 'supertonic3');
  const speechRoute = Boolean(schema.paths?.['/v1/audio/speech']?.post);
  const revisionMatches = health.source_revision === SOURCE_REVISION;
  return {
    base_url: base,
    health,
    speech_route_present: speechRoute,
    source_revision_verified: revisionMatches,
    engine: engine ?? null,
    ready: speechRoute && revisionMatches && engine?.available === true,
    readiness_scope: 'API and engine availability; no synthesis or model download is performed by status',
    network_policy: 'loopback only; redirects rejected; no fallback provider',
  };
}

export function inspectWav(bytes) {
  const buffer = Buffer.from(bytes);
  if (
    buffer.length < 44 ||
    buffer.length > MAX_WAV_BYTES ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE' ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  )
    throw new Error('Invalid or truncated RIFF WAV.');
  let format;
  let data;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > buffer.length) throw new Error('Truncated WAV chunk.');
    const id = buffer.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk.');
      format = {
        encoding: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sample_rate: buffer.readUInt32LE(offset + 12),
        block_align: buffer.readUInt16LE(offset + 20),
        bits_per_sample: buffer.readUInt16LE(offset + 22),
      };
    }
    if (id === 'data') data = buffer.subarray(offset + 8, end);
    offset = end + (size % 2);
  }
  if (
    !format ||
    !data?.length ||
    format.encoding !== 1 ||
    format.bits_per_sample !== 16 ||
    format.channels !== 1 ||
    format.sample_rate !== 44100 ||
    format.block_align !== 2 ||
    data.length % 2
  )
    throw new Error('Expected a nonempty 44.1 kHz mono PCM16 WAV.');
  let peak = 0;
  let squareSum = 0;
  let clipped = 0;
  for (let offset = 0; offset < data.length; offset += 2) {
    const sample = data.readInt16LE(offset);
    peak = Math.max(peak, Math.abs(sample));
    squareSum += (sample / 32768) ** 2;
    if (sample === -32768 || sample === 32767) clipped++;
  }
  const frames = data.length / 2;
  const rms = Math.sqrt(squareSum / frames);
  if (rms < 0.001) throw new Error('WAV is silent or near-silent.');
  if (clipped) throw new Error('WAV contains full-scale clipped samples.');
  return {
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    sample_rate: format.sample_rate,
    channels: format.channels,
    bits_per_sample: format.bits_per_sample,
    frames,
    duration_seconds: frames / format.sample_rate,
    peak_dbfs: 20 * Math.log10(peak / 32768),
    rms_dbfs: 20 * Math.log10(rms),
    clipped_samples: clipped,
    runtime_fighter_contract: false,
  };
}

async function save(output, bytes, provenance) {
  const destination = path.resolve(output);
  const reportPath = `${destination}.provenance.json`;
  for (const file of [destination, reportPath]) {
    try {
      await stat(file);
      throw new Error(`Refusing to overwrite ${file}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx' });
  await writeFile(reportPath, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
  return { output: destination, provenance: reportPath, ...provenance };
}

export async function reuse({ input, output, sourceReport, baseUrl, fetchImpl }) {
  const connected = await status({ baseUrl, fetchImpl });
  if (!connected.ready) throw new Error('Pinned Supertonic-3 service is not ready; inspect status.');
  if ((await stat(input)).size > MAX_WAV_BYTES) throw new Error('Input WAV exceeds size limit.');
  const bytes = await readFile(input);
  const wav = inspectWav(bytes);
  const previous = sourceReport ? JSON.parse(await readFile(sourceReport, 'utf8')) : null;
  if (previous && previous.sha256 !== wav.sha256) throw new Error('Source report SHA256 does not match the WAV.');
  const originalRevision = previous?.health?.source_revision ?? previous?.source_revision ?? null;
  return save(output, bytes, {
    operation: 'reuse-existing-wav',
    generation_performed: false,
    created_at: new Date().toISOString(),
    source_file: path.resolve(input),
    source_report: sourceReport ? path.resolve(sourceReport) : null,
    original_request: previous?.request ?? null,
    original_generation_status: previous?.response_status ?? null,
    ai_generated: previous?.ai_generated === true ? true : null,
    source_revision: originalRevision,
    model_revision: originalRevision === SOURCE_REVISION ? MODEL_REVISION : null,
    connected_service_revision: SOURCE_REVISION,
    base_url: connected.base_url,
    wav,
  });
}

export async function generate({ output, text = DEFAULT_TEXT, voice = 'M1', language = 'ko', speed = 0.85, baseUrl, fetchImpl } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4096) throw new Error('Text must contain 1–4096 characters.');
  if (!['M1', 'M3', 'M4', 'M5', 'F3', 'F4', 'F5'].includes(voice)) throw new Error('Unsupported Supertonic-3 preset.');
  if (!Number.isFinite(speed) || speed < 0.7 || speed > 2) throw new Error('Supertonic-3 speed must be 0.7–2.0.');
  // Refuse occupied outputs before any synthesis work.
  for (const file of [output, `${output}.provenance.json`]) {
    try {
      await stat(file);
      throw new Error(`Refusing to overwrite ${file}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const connected = await status({ baseUrl, fetchImpl });
  if (!connected.ready) throw new Error('Pinned Supertonic-3 service is not ready; inspect status.');
  const body = { model: 'supertonic3', voice, language, speed, response_format: 'wav', input: text };
  const response = await request(connected.base_url, '/v1/audio/speech', {
    fetchImpl,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 600000,
  });
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/')) throw new Error('Speech response is not audio.');
  const bytes = await responseBytes(response, MAX_WAV_BYTES);
  const wav = inspectWav(bytes);
  return save(output, bytes, {
    operation: 'local-synthesis',
    generation_performed: true,
    ai_generated: true,
    created_at: new Date().toISOString(),
    source_revision: SOURCE_REVISION,
    model_revision: MODEL_REVISION,
    base_url: connected.base_url,
    request: body,
    response_status: response.status,
    wav,
  });
}
