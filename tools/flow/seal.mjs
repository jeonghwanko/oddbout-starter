// @ts-check
// Marks and address checks for the dummy flow. A sealed package must not be offered to the live registration client.
import { lstat } from 'node:fs/promises';
import path from 'node:path';

export const DUMMY_MODE = 'dummy';
export const DUMMY_SERVICE = 'oddbout-dummy';
export const DUMMY_SEAL = 'ODDBOUT-DUMMY';
export const DUMMY_LABEL = 'ODDBOUT-DUMMY — not production. No live server, no tokens, no model calls.';
export const DUMMY_SIDECAR = '.oddbout-dummy.json';

/**
 * Loopback HTTP only. Rejects any other host, userinfo, a non-root path, and names that look like production.
 * @param {string} value
 * @returns {URL}
 */
export function assertDummyBase(value) {
  /** @type {URL} */
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('dummy-url-invalid');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const productionName = /oddbout\.com|supabase|render\.com|workers\.dev/i.test(`${url.hostname}${url.href}`);
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    (host !== '127.0.0.1' && host !== '::1') ||
    productionName
  ) {
    throw new Error(productionName ? 'dummy-url-refused' : 'dummy-url-not-loopback');
  }
  return url;
}

/**
 * The manifest itself carries the seal. Stripping it changes the package bytes.
 * @param {any} data
 */
export function manifestSealed(data) {
  const description = data?.profile?.description;
  const name = data?.profile?.name;
  const localId = data?.localId;
  return (
    (typeof description === 'string' && description.includes(DUMMY_SEAL)) ||
    (typeof name === 'string' && name.startsWith('DUMMY ')) ||
    (typeof localId === 'string' && localId.startsWith('dummy-'))
  );
}

/** @param {string} directory */
export async function sidecarSealed(directory) {
  try {
    // Its presence is the marker. Do not follow links or read potentially unbounded/special files.
    await lstat(path.join(directory, DUMMY_SIDECAR));
    return true;
  } catch (/** @type {any} */ error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {Record<string, unknown>} body */
export function stamp(body) {
  return { ...body, mode: DUMMY_MODE, service: DUMMY_SERVICE, label: DUMMY_LABEL, production: false };
}
