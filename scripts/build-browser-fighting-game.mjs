// @ts-check
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = 'browser-fighting-game';
const url = `https://oddbout.com/${directory}/`;
const copy = {
  ko: {
    file: 'index.html',
    title: '나만의 캐릭터로 싸우는 브라우저 격투 게임',
    description: '설치 없이 브라우저에서 2D 격투 경기를 시작하세요. ODDBOUT에서 나만의 캐릭터를 만들어 경기에 출전시킬 수 있습니다.',
    play: '바로 한 판 해보기',
    create: '내 캐릭터 만들기',
    trial: '로그인 없이 벨로라와 레온의 연습 경기가 시작됩니다. 경기는 AI가 진행합니다.',
    imageAlt: 'ODDBOUT 경기장에서 레온과 맞붙은 벨로라',
    createTitle: '내가 만든 캐릭터를 링 위로',
    createBody: '캐릭터를 글로 설명하거나 참고 이미지를 준비하세요. 정면 원화와 움직임을 확인하고 캐릭터를 등록한 뒤 경기에 출전시킬 수 있습니다.',
    example: '벨로라 제작 과정 보기',
    switchLabel: 'English',
  },
  en: {
    file: 'index.en.html',
    title: 'A browser fighting game for your own characters',
    description: 'Start a 2D fighting match in your browser. Create your own character in ODDBOUT, register them, and send them into the ring.',
    play: 'Try a match now',
    create: 'Create my fighter',
    trial: 'An AI practice match between Velora and Leon starts without signing in.',
    imageAlt: 'Velora facing Leon in the ODDBOUT arena',
    createTitle: 'Bring your own fighter into the ring',
    createBody: 'Describe a character or bring a reference image. Review the original art and moves, then register your fighter and enter them in a match.',
    example: 'See how Velora was made',
    switchLabel: '한국어',
  },
};

export const browserFightingFiles = [...Object.values(copy).map(page => page.file), 'play.css'].map(file => `${directory}/${file}`);

/** @param {string} root */
export async function buildBrowserFightingGame(root) {
  const output = join(root, directory);
  await mkdir(output, { recursive: true });
  for (const [lang, page] of Object.entries(copy)) {
    const canonical = lang === 'ko' ? url : url + copy.en.file;
    const other = lang === 'ko' ? 'en' : 'ko';
    const home = lang === 'ko' ? '/ko/' : '/?lang=en';
    const example = lang === 'ko' ? '/ai-fighter-creator/index.ko#velora' : '/ai-fighter-creator/#velora';
    const image = '/ai-fighter-creator/velora/velora-vs-leon.webp';
    const html = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${page.title} · ODDBOUT</title>
  <meta name="description" content="${page.description}">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="ko" href="${url}">
  <link rel="alternate" hreflang="en" href="${url}${copy.en.file}">
  <link rel="alternate" hreflang="x-default" href="${url}${copy.en.file}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${page.title} · ODDBOUT">
  <meta property="og:description" content="${page.description}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="https://oddbout.com${image}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="./play.css">
</head>
<body>
  <header class="wrap">
    <a href="${home}" aria-label="ODDBOUT"><img src="/art/ui/oddbout-logo.webp" width="376" height="76" alt="ODDBOUT"></a>
    <a href="${other === 'ko' ? './' : './index.en.html'}" hreflang="${other}" lang="${other}">${page.switchLabel}</a>
  </header>
  <main class="wrap">
    <div class="hero">
      <div>
        <h1>${page.title}</h1>
        <p class="lead">${page.description}</p>
        <div class="actions">
          <a class="primary" href="/fighter?play=1&amp;fighter=velora&amp;opponent=leon&amp;lang=${lang}">${page.play} <span aria-hidden="true">▶</span></a>
          <a class="secondary" href="/creator?lang=${lang}">${page.create} <span aria-hidden="true">↗</span></a>
        </div>
        <p class="note">${page.trial}</p>
      </div>
      <img class="match" src="${image}" width="960" height="540" alt="${page.imageAlt}" fetchpriority="high">
    </div>
    <section class="creation">
      <h2>${page.createTitle}</h2>
      <div><p>${page.createBody}</p><a href="${example}">${page.example} <span aria-hidden="true">→</span></a></div>
    </section>
  </main>
</body>
</html>
`;
    await writeFile(join(output, page.file), html);
  }
  await cp(new URL('../website/browser-fighting-game/play.css', import.meta.url), join(output, 'play.css'));
}
