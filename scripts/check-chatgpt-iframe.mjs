#!/usr/bin/env node
// @ts-check
// Read-only, fixed-origin iframe diagnostics. This cannot prove ChatGPT gameplay.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { GAME_URL } from '../mcp/cloud/game-launcher-ui.mjs';

/** @param {Headers} headers */
export function inspectFrameHeaders(headers) {
  const csp = headers.get('content-security-policy') ?? '';
  const reportOnly = headers.get('content-security-policy-report-only') ?? '';
  const xfo = headers.get('x-frame-options') ?? '';
  const frameAncestors = [...csp.matchAll(/(?:^|[,;])\s*frame-ancestors\s+([^;,]+)/gi)].map(match => match[1].trim());
  const findings = [];
  if (/\bDENY\b/i.test(xfo)) findings.push('X-Frame-Options: DENY may block all frames');
  else if (/\bSAMEORIGIN\b/i.test(xfo)) findings.push('X-Frame-Options: SAMEORIGIN may block ChatGPT framing');
  for (const ancestors of frameAncestors) {
    if (/(?:^|\s)'none'(?:\s|$)/i.test(ancestors)) findings.push('CSP frame-ancestors contains none');
    else if (/^'self'$/i.test(ancestors)) findings.push('CSP frame-ancestors is self only');
  }
  return {
    xFrameOptions: xfo || '(not set)',
    frameAncestors: frameAncestors.length ? frameAncestors : ['(not set)'],
    reportOnlyCsp: reportOnly ? '(present; not enforced)' : '(not set)',
    findings,
  };
}

/** @param {typeof fetch} [fetcher] */
export async function checkGameIframe(fetcher = fetch) {
  const response = await fetcher(GAME_URL, {
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(12000),
  });
  return {
    url: GAME_URL,
    status: response.status,
    redirected: response.status >= 300 && response.status < 400,
    contentType: response.headers.get('content-type'),
    ...inspectFrameHeaders(response.headers),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await checkGameIframe();
    console.log(JSON.stringify(result, null, 2));
    if (result.redirected || result.status !== 200) {
      console.error('Game endpoint did not return HTTP 200 directly. Check the deployed URL and authentication.');
      process.exitCode = 1;
    } else if (result.findings.length) {
      console.error('Potential framing blockers. Browser CSP/XFO precedence and ChatGPT sandbox must be tested in host.');
      process.exitCode = 2;
    }
    console.log('HTTP headers are necessary but NOT sufficient evidence of iframe, login or Phaser execution.');
  } catch (error) {
    console.error('Unable to read game headers:', error instanceof Error ? error.message : 'unknown-error');
    process.exitCode = 1;
  }
}
