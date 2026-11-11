#!/usr/bin/env node
// @ts-check
// Read-only diagnostics for the configured ChatGPT embed route. HTTP headers cannot prove in-host gameplay.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { configuredGameLauncher } from '../mcp/cloud/game-launcher-ui.mjs';

/** @param {unknown} value */
function expectedAncestorOrigins(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    throw new Error('Set ODDBOUT_CHATGPT_EXPECTED_ANCESTORS to a JSON array of 1–8 exact HTTPS origins.');
  const result = value.map(item => {
    if (typeof item !== 'string' || item === '*' || item === 'null' || item === "'none'" || item === "'self'")
      throw new Error('Expected ancestors must be exact HTTPS origins; wildcard, null, none, and self are not allowed.');
    let url;
    try {
      url = new URL(item);
    } catch {
      throw new Error('Expected ancestors must be exact HTTPS origins; wildcard, null, none, and self are not allowed.');
    }
    if (url.protocol !== 'https:' || item !== url.origin || url.username || url.password || item.includes('*'))
      throw new Error('Expected ancestors must be exact HTTPS origins; wildcard, null, none, and self are not allowed.');
    return item;
  });
  if (new Set(result).size !== result.length) throw new Error('Expected ancestors must not contain duplicates.');
  return result;
}

/** @param {string} source */
function isExactHttpsOrigin(source) {
  if (!source || source.includes('*') || source.toLowerCase() === 'null' || /^'(?:none|self)'$/i.test(source)) return false;
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && source === url.origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** @param {Headers} headers @param {unknown} expectedAncestors */
export function inspectFrameHeaders(headers, expectedAncestors) {
  const csp = headers.get('content-security-policy') ?? '';
  const reportOnly = headers.get('content-security-policy-report-only') ?? '';
  const xfo = headers.get('x-frame-options') ?? '';
  let expected = /** @type {string[]} */ ([]);
  const findings = [];
  try {
    expected = expectedAncestorOrigins(expectedAncestors);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : 'Invalid expected ancestor origins');
  }
  if (xfo) findings.push(`X-Frame-Options is set (${xfo}); the embed route must remove it`);

  const policies = csp
    .split(',')
    .map(policy => policy.trim())
    .filter(Boolean);
  const frameAncestors = [];
  if (!policies.length) findings.push('Enforced Content-Security-Policy is missing');
  for (const [index, policy] of policies.entries()) {
    const directives = policy
      .split(';')
      .map(directive => directive.trim())
      .filter(Boolean);
    const matching = directives.filter(directive => /^frame-ancestors(?:\s|$)/i.test(directive));
    if (matching.length !== 1) {
      findings.push(`CSP policy ${index + 1} must contain exactly one frame-ancestors directive`);
      frameAncestors.push('(invalid)');
      continue;
    }
    const sources = matching[0]
      .replace(/^frame-ancestors\s*/i, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    frameAncestors.push(sources.length ? sources.join(' ') : '(empty)');
    if (!sources.length || sources.some(source => !isExactHttpsOrigin(source))) {
      findings.push(`CSP policy ${index + 1} frame-ancestors must use exact HTTPS origins; wildcard, null, none, and self are not allowed`);
      continue;
    }
    const actual = new Set(sources);
    if (expected.length && (actual.size !== expected.length || expected.some(origin => !actual.has(origin))))
      findings.push(`CSP policy ${index + 1} frame-ancestors does not exactly match the configured ancestor origins`);
  }
  return {
    xFrameOptions: xfo || '(not set)',
    expectedAncestors: expected.length ? expected : ['(invalid or not set)'],
    frameAncestors: frameAncestors.length ? frameAncestors : ['(not set)'],
    reportOnlyCsp: reportOnly ? '(present; not enforced)' : '(not set)',
    findings,
  };
}

/** @param {typeof fetch} [fetcher] @param {string} [gameUrl] @param {unknown} [expectedAncestors] */
export async function checkGameIframe(fetcher = fetch, gameUrl, expectedAncestors) {
  expectedAncestorOrigins(expectedAncestors);
  const game = configuredGameLauncher({ enabled: true, gameUrl });
  if (!game) throw new Error('Set ODDBOUT_CHATGPT_GAME_URL to the exact HTTPS /embed/chatgpt/ URL.');
  const response = await fetcher(game.url, {
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(12000),
  });
  const headerChecks = inspectFrameHeaders(response.headers, expectedAncestors);
  const contentType = response.headers.get('content-type');
  return {
    url: game.url,
    status: response.status,
    redirected: response.status >= 300 && response.status < 400,
    contentType,
    ...headerChecks,
    findings: [
      ...(response.status === 200 ? [] : [`Expected HTTP 200, received ${response.status}`]),
      ...(response.status >= 300 && response.status < 400 ? ['Embed route redirected'] : []),
      ...(contentType?.split(';', 1)[0].trim().toLowerCase() === 'text/html' ? [] : ['Embed route did not return text/html']),
      ...headerChecks.findings,
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const game = configuredGameLauncher({
    enabled: process.env.ODDBOUT_CHATGPT_GAME_LAUNCHER === '1',
    gameUrl: process.env.ODDBOUT_CHATGPT_GAME_URL,
  });
  if (!game) {
    console.log('ChatGPT game launcher is disabled or not configured. No network request was made.');
  } else {
    try {
      const expectedRaw = process.env.ODDBOUT_CHATGPT_EXPECTED_ANCESTORS;
      if (!expectedRaw) throw new Error('Set ODDBOUT_CHATGPT_EXPECTED_ANCESTORS to a JSON array of 1–8 exact HTTPS origins.');
      const expectedAncestors = JSON.parse(expectedRaw);
      expectedAncestorOrigins(expectedAncestors);
      const result = await checkGameIframe(fetch, game.url, expectedAncestors);
      console.log(JSON.stringify(result, null, 2));
      if (result.findings.length) {
        console.error('Embed route failed its HTTP and framing policy checks.');
        process.exitCode = 1;
      }
      console.log('HTTP headers are necessary but not sufficient evidence of iframe, sign-in or game readiness.');
    } catch (error) {
      console.error('Unable to read game headers:', error instanceof Error ? error.message : 'unknown-error');
      process.exitCode = 1;
    }
  }
}
