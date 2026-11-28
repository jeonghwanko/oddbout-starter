// @ts-check
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = 'browser-fighting-game';
const url = `https://oddbout.com/${directory}/`;
const englishUrl = url + 'index.en';
const copy = {
  ko: {
    file: 'index.html',
    title: '나만의 캐릭터로 싸우는 브라우저 격투 게임',
    description: '설치 없이 브라우저에서 2D 격투 경기를 시작하세요. ODDBOUT에서 나만의 캐릭터를 만들어 경기에 출전시킬 수 있습니다.',
    play: '바로 한 판 해보기',
    create: '내 캐릭터 만들기',
    trial: '로그인 없이 벨로라와 레온의 연습 경기가 시작됩니다. 경기는 AI가 진행합니다.',
    highlight: 'ODDBOUT 벨로라 대 레온 경기 하이라이트',
    createTitle: '내가 만든 캐릭터를 링 위로',
    createBody: '캐릭터를 글로 설명하거나 참고 이미지를 준비하세요. 정면 원화와 움직임을 확인하고 캐릭터를 등록한 뒤 경기에 출전시킬 수 있습니다.',
    example: '벨로라 제작 과정 보기',
    switchLabel: 'English',
  },
  en: {
    file: 'index.en.html',
    title: 'Free 2D Browser Fighting Game with AI Fighters',
    description:
      'Watch free 2D AI fights in your browser. Learn the ODDBOUT controls, build a 16-fighter cup bracket, and create and register your own fighter.',
    play: 'Watch an AI practice match',
    create: 'Create my fighter',
    trial: 'Velora and Leon fight automatically. Watch in your browser without downloading the game or signing in.',
    highlight: 'ODDBOUT match highlights featuring Velora and Leon',
    createTitle: 'Bring your own fighter into the ring',
    createBody: 'Describe a character or bring a reference image. Review the original art and moves, then register your fighter and enter them in a match.',
    example: 'See how Velora was made',
    switchLabel: '한국어',
  },
};

const englishGuide = `
    <nav class="guide-nav" aria-label="On this page">
      <a href="#controls">Controls</a>
      <a href="#ai-matches">AI matches</a>
      <a href="#register-a-fighter">Register a fighter</a>
    </nav>
    <section class="guide-section" id="controls" aria-labelledby="controls-heading">
      <h2 id="controls-heading">How to play and use the controls</h2>
      <p>Choose the fighters and set up the matchup. Once a bout starts, the AI moves, attacks and guards for both fighters. On a phone or tablet, tap the on-screen controls to make selections and open menus.</p>
      <table class="controls">
        <caption>Keyboard shortcuts for the arena menus</caption>
        <thead><tr><th scope="col">Action</th><th scope="col">Keys</th></tr></thead>
        <tbody>
          <tr><th scope="row">Move between choices</th><td><kbd>Arrow keys</kbd></td></tr>
          <tr><th scope="row">Confirm a selection</th><td><kbd>F</kbd> or <kbd>Enter</kbd></td></tr>
          <tr><th scope="row">Open or close the game menu</th><td><kbd>O</kbd></td></tr>
          <tr><th scope="row">Close the open game menu</th><td><kbd>Esc</kbd></td></tr>
        </tbody>
      </table>
    </section>
    <section class="guide-section" id="ai-matches" aria-labelledby="ai-heading">
      <h2 id="ai-heading">How AI fighting matches work</h2>
      <dl class="match-modes">
        <div><dt>Practice match</dt><dd>Watch a free one-on-one fight with the game’s ready-made fighters. The practice match above opens with Velora and Leon.</dd></div>
        <div><dt>16-fighter cup</dt><dd>Pick a fighter to represent your club and decide who goes in each bracket slot. The fighters play each bout automatically. Win four matches to take the cup. Sign in with Google to save your club and its progress.</dd></div>
        <div><dt>Ranked duel</dt><dd>Choose fighters that have been entered into the arena. Completed server-run AI duels count toward the registered fighters’ rankings.</dd></div>
      </dl>
      <p>Shared bouts keep the fighters and the starting seed, so you can replay the same fight under the same rules.</p>
    </section>
    <section class="guide-section" id="register-a-fighter" aria-labelledby="registration-heading">
      <h2 id="registration-heading">Create and register your own fighter</h2>
      <ol class="registration">
        <li><strong>Open My fighters on a computer.</strong> <a href="/creator?lang=en">Sign in with Google</a> and open <strong>My fighters</strong> from your account menu.</li>
        <li><strong>Start with a character idea or a reference image.</strong> Request creation in My fighters, or follow the <a href="/fight-club/docs/?lang=en">AI Fighter creation guide</a> to make a fighter with your own AI assistant.</li>
        <li><strong>Review the art and movements.</strong> Check the character’s appearance and fight animations. If you make the fighter in your workspace, validate the finished package before submitting it to the same ODDBOUT account.</li>
        <li><strong>Register, then enter the fighter.</strong> Find the registered fighter in My fighters, open the motion preview, and enter them into the arena. Entry makes the fighter available for other players to face in cups and ranked duels.</li>
      </ol>
      <p><a href="/ai-fighter-creator/#velora">See how Velora was made <span aria-hidden="true">→</span></a></p>
    </section>`;

export const browserFightingFiles = [...Object.values(copy).map(page => page.file), 'play.css'].map(file => `${directory}/${file}`);

/** @param {string} root */
export async function buildBrowserFightingGame(root) {
  const output = join(root, directory);
  await mkdir(output, { recursive: true });
  for (const [lang, page] of Object.entries(copy)) {
    const canonical = lang === 'ko' ? url : englishUrl;
    const other = lang === 'ko' ? 'en' : 'ko';
    const home = lang === 'ko' ? '/ko/' : '/?lang=en';
    const example = lang === 'ko' ? '/ai-fighter-creator/index.ko#velora' : '/ai-fighter-creator/#velora';
    const highlight = '/ai-fighter-creator/velora/velora-vs-leon';
    const breadcrumbs = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ODDBOUT', item: 'https://oddbout.com/' },
        { '@type': 'ListItem', position: 2, name: page.title, item: canonical },
      ],
    };
    const html = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${page.title} · ODDBOUT</title>
  <meta name="description" content="${page.description}">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="ko" href="${url}">
  <link rel="alternate" hreflang="en" href="${englishUrl}">
  <link rel="alternate" hreflang="x-default" href="${englishUrl}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${page.title} · ODDBOUT">
  <meta property="og:description" content="${page.description}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="https://oddbout.com${highlight}.webp">
  <meta property="og:image:alt" content="${page.highlight}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(breadcrumbs)}</script>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="./play.css">
</head>
<body>
  <header class="wrap">
    <a href="${home}" aria-label="ODDBOUT"><img src="/art/ui/oddbout-logo.webp" width="376" height="76" alt="ODDBOUT"></a>
    <a href="${other === 'ko' ? './' : './index.en'}" hreflang="${other}" lang="${other}">${page.switchLabel}</a>
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
      <video class="match" poster="${highlight}.webp" width="960" height="540" controls playsinline preload="none" aria-label="${page.highlight}">
        <source src="${highlight}.mp4" type="video/mp4">
      </video>
    </div>
    ${
      lang === 'en'
        ? englishGuide
        : `<section class="creation">
      <h2>${page.createTitle}</h2>
      <div><p>${page.createBody}</p><a href="${example}">${page.example} <span aria-hidden="true">→</span></a></div>
    </section>`
    }
  </main>
</body>
</html>
`;
    await writeFile(join(output, page.file), html);
  }
  await cp(new URL('../website/browser-fighting-game/play.css', import.meta.url), join(output, 'play.css'));
}
