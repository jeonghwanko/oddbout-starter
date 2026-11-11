#!/usr/bin/env node
// @ts-check
// Read-only diagnostics for the configured ChatGPT embed route. HTTP headers cannot prove in-host gameplay.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { configuredGameLauncher } from '../mcp/cloud/game-launcher-ui.mjs';

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

/** @param {typeof fetch} [fetcher] @param {string} [gameUrl] */
export async function checkGameIframe(fetcher = fetch, gameUrl) {
  const game = configuredGameLauncher({ enabled: true, gameUrl });
  if (!game) throw new Error('Set ODDBOUT_CHATGPT_GAME_URL to the exact HTTPS /embed/chatgpt/ URL.');
  const response = await fetcher(game.url, {
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(12000),
  });
  return {
    url: game.url,
    status: response.status,
    redirected: response.status >= 300 && response.status < 400,
    contentType: response.headers.get('content-type'),
    ...inspectFrameHeaders(response.headers),
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
      const result = await checkGameIframe(fetch, game.url);
      console.log(JSON.stringify(result, null, 2));
      if (result.redirected || result.status !== 200) {
        console.error('Embed route did not return HTTP 200 directly. Check the configured URL and route.');
        process.exitCode = 1;
      } else if (result.findings.length) {
        console.error('Potential framing blockers. Browser policy and ChatGPT sandbox still need host verification.');
        process.exitCode = 2;
      }
      console.log('HTTP headers are necessary but not sufficient evidence of iframe, sign-in or game readiness.');
    } catch (error) {
      console.error('Unable to read game headers:', error instanceof Error ? error.message : 'unknown-error');
      process.exitCode = 1;
    }
  }
}
