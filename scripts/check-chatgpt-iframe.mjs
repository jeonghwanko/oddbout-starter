#!/usr/bin/env node
// Read-only diagnostic for ChatGPT iframe integration.
// Run: node scripts/check-chatgpt-iframe.mjs
const url = process.env.ODDBOUT_GAME_URL || 'https://oddbout.com/fighter.html';
const timeout = AbortSignal.timeout(12000);
try {
  const response = await fetch(url, { signal: timeout, redirect: 'follow' });
  const csp = response.headers.get('content-security-policy') || '';
  const xfo = response.headers.get('x-frame-options') || '';
  const ancestors = csp.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/i)?.[1] || '(not set)';
  console.log(JSON.stringify({
    url: response.url, status: response.status, frameAncestors: ancestors,
    xFrameOptions: xfo || '(not set)', contentType: response.headers.get('content-type')
  }, null, 2));
  if (!response.ok) process.exitCode = 1;
  if (/deny|sameorigin/i.test(xfo) || /'none'|'self'/i.test(ancestors)) {
    console.error('Potential iframe embedding blocker: verify actual ChatGPT sandbox ancestors.');
    process.exitCode = 2;
  }
  console.log('Header checks alone cannot establish ChatGPT policy compliance, authentication or gameplay.');
} catch (error) {
  console.error('Could not reach game endpoint:', error.message);
  process.exitCode = 1;
}
