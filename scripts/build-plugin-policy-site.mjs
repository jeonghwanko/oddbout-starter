// @ts-check
// Static policy renderer. Publication is performed by the normal site deployment.
import { mkdir, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pages, prepared, effectiveDate } from '../website/ai-fighter-creator/content.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const policyFiles = [...pages.map(page => page.file), 'style.css', 'icon.svg'].map(file => `ai-fighter-creator/${file}`);

/** @param {string} html */
export function sitePrivacyNotice(html) {
  const marker = '<section id="scope">';
  const operator = /The service is operated by (?:Supervillain Labs|Lucas Foundation)\./g;
  if (!html.includes(marker) || [...html.matchAll(operator)].length !== 1) {
    throw new Error('Privacy source changed; review the operator and plugin policy links');
  }
  return html
    .replace(operator, 'The service is operated by Lucas Foundation.')
    .replace(
      '</section>',
      '<p>For the local creation plugin, read the <a href="/ai-fighter-creator/privacy.html">AI Fighter Creator privacy notice</a> (<a href="/ai-fighter-creator/privacy.ko.html" lang="ko">한국어</a>), <a href="/ai-fighter-creator/terms.html">terms of service</a> and <a href="/ai-fighter-creator/support.html">support information</a>.</p></section>',
    );
}

/** @param {string} destination @param {{ publish?: boolean }} [options] */
export async function buildPluginPolicySite(destination, { publish = false } = {}) {
  await mkdir(destination, { recursive: true });
  const nav = [
    ['index.html', 'Overview'],
    ['privacy.html', 'Privacy'],
    ['terms.html', 'Terms'],
    ['support.html', 'Support'],
  ];
  for (const page of pages) {
    const date = publish ? (page.lang === 'ko' ? `시행일: ${effectiveDate}` : `Effective: ${prepared}`) : `Prepared ${prepared}`;
    const canonical = `https://oddbout.com/ai-fighter-creator/${page.file}`;
    const sections = page.sections
      .map(
        ([id, heading, body], i) =>
          `<section id="${id}"><span class="section-number">${String(i + 1).padStart(2, '0')}</span><div><h2>${heading}</h2>${body}</div></section>`,
      )
      .join('\n');
    const html = `<!doctype html>
<html lang="${page.lang || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${publish ? `<link rel="canonical" href="${canonical}">` : '<meta name="robots" content="noindex">'}<meta name="referrer" content="strict-origin-when-cross-origin"><title>${page.title} · AI Fighter Creator</title><meta name="description" content="${page.description}"><link rel="stylesheet" href="./style.css"></head>
<body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="./index.html"><img src="./icon.svg" width="36" height="36" alt=""><span>AI FIGHTER<span class="brand-sub">CREATOR / LUCAS FOUNDATION</span></span></a><nav aria-label="Main">${nav.map(([file, label]) => `<a ${file === page.file ? 'aria-current="page"' : ''} href="./${file}">${label}</a>`).join('')}</nav></header>
${publish ? '' : `<div class="preview">POLICY PREVIEW <span>Prepared ${prepared} · publication pending · not an effective notice</span></div>`}
<main id="main"><div class="hero"><p class="eyebrow">${page.eyebrow}</p><h1>${page.title}</h1><p class="intro">${page.description}</p><div class="meta">Lucas Foundation <span>•</span> ${date}${page.translation ? ` <span>•</span> <a href="./${page.translation.file}" lang="${page.translation.lang}">${page.translation.label}</a>` : ''}</div></div>
<div class="layout"><aside aria-label="On this page">${page.sections.map(([id, title]) => `<a href="#${id}">${title}</a>`).join('')}</aside><article>${sections}</article></div></main>
<footer><div><strong>LUCAS FOUNDATION</strong><p>AI Fighter Creator · ODDBOUT</p></div><div><a href="https://oddbout.com/">ODDBOUT</a><a href="./privacy.html">Privacy</a><a href="./terms.html">Terms</a><a href="./support.html">Support</a><a href="https://github.com/jeonghwanko/oddbout-starter">Source code ↗</a></div></footer></body></html>`;
    await writeFile(path.join(destination, page.file), html);
  }
  await cp(path.join(root, 'website/ai-fighter-creator/style.css'), path.join(destination, 'style.css'));
  await cp(path.join(root, 'plugins/ai-fighter/assets/icon.svg'), path.join(destination, 'icon.svg'));
  return { destination, pages: pages.map(p => p.file), mode: publish ? 'publication' : 'preview', published: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [destination, option, ...extra] = process.argv.slice(2);
  if (extra.length || (option && option !== '--publish')) throw new Error('Usage: node scripts/build-plugin-policy-site.mjs [destination] [--publish]');
  console.log(
    JSON.stringify(
      await buildPluginPolicySite(path.resolve(destination || path.join(root, 'output/plugin-review-20261022/site/ai-fighter-creator')), {
        publish: option === '--publish',
      }),
    ),
  );
}
