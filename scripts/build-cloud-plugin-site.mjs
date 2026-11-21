// @ts-check
import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { content, identity } from '../website/cloud-plugin/content.mjs';
/** @type {(value: string) => string} */
const esc = value =>
  value.replace(/[&<>"']/g, c => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** A section's text, escaped; `[words](https://…)` becomes a link (2026-11-01: the Claude page links its install dialog and the policies). @param {string} value */
export const prose = value => esc(value).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
/** @param {'en'|'ko'} language */
function arcadeGallery(language) {
  const ko = language === 'ko';
  const heading = ko ? '어떤 웹게임을 하고 싶나요?' : 'What do you feel like playing?';
  const intro = ko
    ? '“친구랑 키보드 하나로 할 게임?”처럼 물어보세요. ODDBOUT이 30개 게임에서 조건에 맞는 2~3개를 추천합니다.'
    : 'Ask for a game you can play with a friend on one keyboard. ODDBOUT picks two or three matches from 30 browser games.';
  const pictures = [
    [
      '01-pick.png',
      ko ? '키보드 하나로 둘이 즐기는 Basketball Stars와 Tag 추천 카드' : 'Basketball Stars and Tag recommended for two players sharing a keyboard',
    ],
    ['02-play.png', ko ? 'ChatGPT 안에서 실행 중인 Legendary Forge' : 'Playing Legendary Forge inside ChatGPT'],
  ];
  return `<section class="arcade-gallery"><h1>${heading}</h1><p>${intro}</p><div class="arcade-shots">${pictures
    .map(([file, alt]) => `<a href="./arcade/${file}"><img src="./arcade/${file}" width="1600" height="900" alt="${alt}"></a>`)
    .join('')}</div>
    <p>${ko ? 'ODDBOUT 오리지널은 채팅 안에서, 외부 게임은 Poki에서 열립니다.' : 'Play ODDBOUT originals in chat, or open an external game on Poki.'}</p>
    <a class="button" href="https://chatgpt.com/plugins/plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af">${ko ? 'ChatGPT에서 게임 고르기' : 'Find a game in ChatGPT'}</a></section>`;
}

/** @param {string} siteRoot */
export async function buildCloudPluginSite(siteRoot) {
  const dir = join(siteRoot, 'cloud-plugin');
  await mkdir(dir, { recursive: true });
  /** @type {('index' | 'privacy' | 'terms' | 'support' | 'claude')[]} */
  const keys = ['index', 'privacy', 'terms', 'support', 'claude'];
  for (const language of /** @type {(keyof typeof content)[]} */ (['en', 'ko']))
    for (const key of keys) {
      const p = content[language][key],
        suffix = language === 'ko' ? '.ko' : '',
        file = key + suffix + '.html';
      const html = `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(p.title)} · ODDBOUT</title><link rel="canonical" href="https://oddbout.com/cloud-plugin/${file}"><link rel="stylesheet" href="./style.css"><header><a class="brand" href="./index${suffix}.html"><img src="/art/ui/oddbout-logo.webp" alt="ODDBOUT Fight Club" width="188" height="38"></a><nav>${keys.map((k, i) => `<a href="./${k + suffix}.html" ${k === key ? 'aria-current="page"' : ''}>${content[language].nav[i]}</a>`).join('')}<a href="./${key + (language === 'ko' ? '' : '.ko')}.html" lang="${language === 'ko' ? 'en' : 'ko'}">${language === 'ko' ? 'EN' : 'KR'}</a></nav></header><main>${key === 'index' ? arcadeGallery(language) : ''}<div class="hero"><p class="eyebrow">ODDBOUT CONNECTOR</p><${key === 'index' ? 'h2' : 'h1'}>${esc(p.title)}</${key === 'index' ? 'h2' : 'h1'}><p class="intro">${esc(p.intro)}</p><p class="meta">${identity.publisher} · ${identity.effective[key]}</p></div><article>${p.sections.map(([title, text], i) => `<section><span class="section-number">${String(i + 1).padStart(2, '0')}</span><div><h2>${esc(title)}</h2><p>${prose(text)}</p></div></section>`).join('')}</article></main><footer><p>ODDBOUT · ${identity.publisher}</p><a href="mailto:${identity.support}">${identity.support}</a></footer></html>`;
      await writeFile(join(dir, file), html);
    }
  const shared = await readFile(new URL('../website/ai-fighter-creator/style.css', import.meta.url), 'utf8');
  await writeFile(
    join(dir, 'style.css'),
    shared +
      '\n@font-face{font-family:Pretendard;src:url(/fonts/Pretendard-Regular.woff2);font-weight:400;font-display:swap}@font-face{font-family:Pretendard;src:url(/fonts/Pretendard-Bold.woff2);font-weight:700;font-display:swap}:root{font-family:Pretendard,Arial,sans-serif}article{max-width:800px;margin:45px 0 70px}header nav{flex-wrap:wrap}.arcade-gallery{padding:20px 0 32px;border-bottom:1px solid var(--line)}.arcade-gallery h1{font-size:clamp(28px,4.5vw,52px);margin-bottom:12px}.arcade-shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}.arcade-shots img{display:block;width:100%;height:auto;border-radius:12px}@media(max-width:700px){.arcade-shots{grid-template-columns:1fr;gap:10px}}',
  );
  await cp(new URL('../website/cloud-plugin/arcade/', import.meta.url), join(dir, 'arcade'), { recursive: true });
  // Review links must survive full game releases, which replace the public tree.
  await cp(new URL('../website/cloud-plugin/review-20261024/', import.meta.url), join(dir, 'review-20261024'), { recursive: true });
  await cp(new URL('../website/cloud-plugin/review-20261025/', import.meta.url), join(dir, 'review-20261025'), { recursive: true });
  await cp(new URL('../website/cloud-plugin/review-1.0.4/', import.meta.url), join(dir, 'review-1.0.4'), { recursive: true });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Supply the existing site root');
  await buildCloudPluginSite(resolve(process.argv[2]));
}
