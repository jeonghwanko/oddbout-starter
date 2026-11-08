// @ts-check
// Loopback-only static preview with an explicit allowlist; never serves project/auth files.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 4318);
const allowed = new Set([
  'review-console.html',
  'evidence.json',
  'review.html',
  'walkthrough.mp4',
  'walkthrough.en.vtt',
  'walkthrough.ko.vtt',
  'poster.jpg',
  ...['index.html', 'privacy.html', 'terms.html', 'support.html', 'privacy.ko.html', 'terms.ko.html', 'style.css', 'icon.svg'].map(
    p => 'ai-fighter-creator/' + p,
  ),
]);
/** @type {Record<string, string>} */
const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
  '.jpg': 'image/jpeg',
};
const server = createServer(async (req, res) => {
  const pathname = new URL(/** @type {string} */ (req.url), `http://127.0.0.1:${port}`).pathname.slice(1) || 'ai-fighter-creator/index.html';
  if (!['GET', 'HEAD'].includes(/** @type {string} */ (req.method)) || !allowed.has(pathname)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const file = path.join(root, pathname),
      bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}/`));
