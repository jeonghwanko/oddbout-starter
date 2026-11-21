const replay = 'https://oddbout.com/fighter?play=1&amp;fighter=velora&amp;opponent=leon&amp;bout=2301950712&amp;rules=57&amp;d=a0bd771e';

const copy = {
  en: {
    title: 'How to make a 2D fighting game sprite sheet with AI',
    description: 'Follow Velora from original character art to idle, walk and combo sprite sheets, then watch her fight in ODDBOUT.',
    heading: 'How Velora went from character art to a real fight',
    intro: 'Velora started as a registered creator fighter and became part of the ODDBOUT roster. The images below show her original design and the animation frames used in the game.',
    concept: 'Original character art',
    conceptAlt: 'Velora’s original front-view character art in red robes',
    conceptNote: 'Start with a full-body reference. Use it to keep the silhouette, clothes and proportions consistent when drawing the side view and the motions.',
    sheets: 'Idle, walk and combo sprite sheets',
    sheetsNote: 'Arrange the side-view animation frames in a grid of equal cells, with a separate sheet for each motion. Open an image to inspect its frames.',
    captions: ['Fighting stance', 'Walk cycle', 'Combo attack'],
    fix: 'Velora’s combo needed an alignment fix. Its opening stance used a different origin from her idle stance, so the body could shift as the move began. The game adjusted the combo’s origin so she starts the attack from the same place.',
    battle: 'Watch Velora fight Leon',
    videoLabel: 'Velora versus Leon match highlights',
    battleNote: 'In this ODDBOUT exhibition, Leon wins by KO at 34.3 seconds. Watch how Velora moves between her stance, movement and attacks in the actual game.',
    watch: 'Replay the full match in ODDBOUT',
    guide: 'Read the fighter creation guide',
  },
  ko: {
    title: 'AI로 2D 격투 게임 캐릭터 스프라이트 시트 만들기',
    description: '벨로라의 정면 원화에서 대기·걷기·연속 공격 스프라이트 시트까지 살펴보고, 완성된 캐릭터의 ODDBOUT 경기를 보세요.',
    heading: '벨로라는 어떻게 원화에서 경기까지 갔을까?',
    intro: '벨로라는 제작자가 등록한 파이터로 시작해 ODDBOUT의 정식 선수가 됐습니다. 처음 외형을 잡은 원화와 실제 게임에 쓰인 동작 프레임을 차례로 볼 수 있습니다.',
    concept: '캐릭터 정면 원화',
    conceptAlt: '붉은 로브를 입은 벨로라의 정면 전신 원화',
    conceptNote: '전신이 보이는 원화에서 시작합니다. 이 그림을 기준으로 옆모습과 동작을 만들면서 실루엣, 의상, 몸의 비율을 유지합니다.',
    sheets: '대기·걷기·연속 공격 스프라이트 시트',
    sheetsNote: '옆에서 본 동작의 프레임을 같은 크기의 칸에 배치합니다. 동작마다 시트 한 장을 씁니다. 이미지를 누르면 프레임을 크게 볼 수 있습니다.',
    captions: ['전투 대기 자세', '걷기 반복 동작', '연속 공격'],
    fix: '벨로라의 연속 공격은 시작 자세의 기준점이 대기 자세와 달라 공격이 시작될 때 몸이 옆으로 튈 수 있었습니다. 게임에서 연속 공격의 기준점을 옮겨 같은 위치에서 동작이 이어지도록 맞췄습니다.',
    battle: '벨로라 대 레온 경기',
    videoLabel: '벨로라 대 레온 경기 하이라이트',
    battleNote: '이 ODDBOUT 시범 경기에서는 34.3초에 레온이 KO로 이겼습니다. 대기 자세에서 이동과 공격으로 이어지는 벨로라의 동작을 실제 게임 화면에서 확인해 보세요.',
    watch: 'ODDBOUT에서 전체 경기 다시 보기',
    guide: '내 파이터 제작 가이드 보기',
  },
};

const sheets = [
  { file: 'fight-idle', height: 1064 },
  { file: 'walk', height: 532 },
  { file: 'combo', height: 665 },
];

/** @param {'en' | 'ko'} lang */
export function veloraCase(lang) {
  const text = copy[lang];
  return {
    title: text.title,
    description: text.description,
    section: [
      'velora',
      text.heading,
      `<p>${text.intro}</p>
      <h3>${text.concept}</h3>
      <div class="fighter-concept">
        <img src="./velora/concept.webp" alt="${text.conceptAlt}" width="271" height="600" decoding="async">
        <p>${text.conceptNote}</p>
      </div>
      <h3>${text.sheets}</h3><p>${text.sheetsNote}</p>
      <div class="fighter-sheets">
        ${sheets.map(({ file, height }, i) => `<figure>
          <figcaption>${text.captions[i]}</figcaption>
          <a href="./velora/${file}.webp"><img src="./velora/${file}.webp" alt="${text.captions[i]}" width="1520" height="${height}" loading="lazy" decoding="async"></a>
        </figure>`).join('')}
      </div>
      <p>${text.fix}</p>
      <h3>${text.battle}</h3><p>${text.battleNote}</p>
      <video class="fighter-bout" controls playsinline preload="none" width="960" height="540" poster="./velora/velora-vs-leon.webp" aria-label="${text.videoLabel}">
        <source src="./velora/velora-vs-leon.mp4" type="video/mp4">
      </video>
      <p><a class="button" href="${replay}&amp;lang=${lang}">${text.watch} →</a></p>
      <p><a href="https://oddbout.com/docs?lang=${lang}">${text.guide} →</a></p>`,
    ],
  };
}
