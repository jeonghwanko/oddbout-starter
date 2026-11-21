export const arcadeIntro = {
  ko: {
    title: 'ChatGPT에서 내 격투가를 만들고, 오늘 할 웹게임을 고르세요',
    lead: 'ODDBOUT은 대화에서 게임을 만들고 즐길 수 있는 플러그인입니다. 직접 상상한 격투가를 경기장에 세우고 싶다면 외모와 싸우는 모습을 들려주세요. 지금 한 판 하고 싶다면 누구와 어떤 기기로 할지 말해 주세요. 30개 웹게임 중 조건에 맞는 두세 개를 카드로 받아 고를 수 있습니다.',
    cost: '본인의 ChatGPT 구독으로 로그인해 ODDBOUT을 사용하면, 구독에 포함된 GPT 작업에는 별도 OpenAI API 비용이 들지 않습니다.',
    costDetail: '사용 가능한 생성 기능과 한도는 구독을 따릅니다. ODDBOUT 서버에 격투가 제작을 맡기면 ODDBOUT 제작 토큰을 사용합니다.',
    fighterTitle: '“앞치마를 두른 너구리 대장장이를 격투가로 만들고 싶어.”',
    fighterSteps: [
      [
        '캐릭터를 설명하세요',
        '이름을 정하지 않았어도 시작할 수 있습니다. 앞치마에 남은 그을음, 큰 망치를 들기 전의 작은 기합처럼 화면에 꼭 보였으면 하는 특징을 적어 보세요. 직접 그렸거나 사용할 권리가 있는 참고 그림도 첨부할 수 있습니다.',
      ],
      [
        '경기장에 세울 모습을 고르세요',
        'ODDBOUT에 제작을 맡기면 정면 외형 후보를 보고 마음에 드는 모습을 고릅니다. 선택한 모습을 바탕으로 걷기, 달리기, 공격, 막기, 피격, 쓰러지기까지 한 캐릭터의 동작을 제작합니다.',
      ],
      [
        '내 격투가로 연습하고 출전하세요',
        '등록한 캐릭터는 같은 계정의 ‘내 격투가’에서 만납니다. 연습 경기에서 움직임을 보고, 필수 동작 11개를 확인하세요. 정면 이미지 심사를 통과하고 출전을 선택하면 다른 사람도 컵과 랭크 대전에서 내 캐릭터를 만날 수 있습니다. 직접 조작하거나 AI에 전투를 맡길 수 있습니다.',
      ],
    ],
    clip: '실제 ODDBOUT 경기 · 10초. 두 격투가가 경기장에서 맞붙는 장면입니다. 위 너구리 설정은 처음 요청할 때 써볼 수 있는 예시입니다.',
    arcadeTitle: '지금 한 판 하고 싶다면? 게임 이름 대신 상황을 말하세요',
    start: 'ChatGPT에서 ODDBOUT 열기',
    setup: '처음이라면 플러그인 페이지에서 ‘채팅에서 사용해 보기’를 누르세요. 새 대화에서는 @ODDBOUT을 선택하고 아래 문장처럼 물어보면 됩니다.',
    exampleTitle: '같은 키보드라도, 두 사람이 즐기는 방식은 다릅니다',
    example:
      '“친구랑 키보드 하나로 동시에 할 인기 게임 두 개 보여줘.” 실제로 이렇게 물었을 때 나온 게임은 Basketball Stars와 Tag였습니다. 농구를 고르면 상대의 공을 빼앗아 슛을 겨룹니다. 술래잡기를 고르면 서로 다른 키로 달리며 친구를 터치해 술래를 넘깁니다. 두 게임 모두 함께할 수 있지만, 지금 어떤 승부를 하고 싶은지에 따라 선택이 달라집니다.',
    promptsTitle: '내 상황에 맞춰 이렇게 물어보세요',
    prompts: [
      [
        '휴대폰으로 한 손 플레이',
        '“휴대폰으로 한 손에 들고 할 게임 두 개 추천해줘. 달리는 게임이면 더 좋아.”',
        '휴대폰과 한 손 조작을 먼저 확인하고, 그 안에서 러너를 우선합니다.',
      ],
      [
        '차분하게 키우는 게임',
        '“가게를 운영하거나 재료를 합치는 게임을 하고 싶어. 처음 할 일을 알려줘.”',
        '경영과 합성 중 어떤 쪽이 당기는지 카드 설명으로 비교하세요. Monkey Mart에서는 바나나를 수확해 매대에 놓고, Legendary Forge에서는 광석을 합쳐 장비를 만듭니다.',
      ],
      [
        '조건 하나만 바꿔 다시 고르기',
        '“같은 키보드로 한다는 건 그대로야. 방금 본 농구 게임은 빼줘.”',
        '앞에서 고른 조건을 유지하면서 본 게임을 제외할 수 있습니다. 남는 게임이 하나라면 한 개만 보여줍니다.',
      ],
    ],
    originalsTitle: '채팅 안에서 바로 할 수 있는 ODDBOUT 오리지널',
    originals: [
      ['Pudding Escape', '젤리를 골라 달리고 장애물을 피하세요. 달릴 때마다 기록을 다시 노리는 러너입니다.'],
      [
        'Legendary Forge',
        '광맥을 눌러 광석을 캐고 같은 광석 둘을 합치세요. 모루에서 장비를 만들어 납품합니다. 아래 화면은 실제로 게임을 열고 채굴한 장면입니다.',
      ],
      ['Bounce Ball', '공은 스스로 튀어 오릅니다. 좌우로 움직일 순간을 골라 장애물을 넘고 다음 스테이지에 도전하세요.'],
    ],
    launch:
      '오리지널 카드에서 ‘여기서 플레이’를 누르면 ChatGPT 런처 안에 게임이 열립니다. ‘런처로 돌아가기’를 누르면 다시 고를 수 있습니다. 외부 게임은 ‘Poki에서 플레이’를 누르고 ChatGPT의 링크 열기 확인을 거쳐 Poki 공식 게임 페이지에서 시작합니다.',
    evidenceTitle: '어떤 게임을 추천하나요?',
    evidence:
      '첫 목록은 ODDBOUT 오리지널 3개와 Poki 인기 목록에서 고른 웹게임 27개입니다. 외부 카드의 ‘Poki 평가’는 2026년 11월 21일 검수 당시 게임 페이지에 표시된 누적 평가 수입니다. ‘두 사람이 동시에’, ‘가입 없이’처럼 꼭 필요한 조건을 먼저 적용하고, 선호 장르가 맞는 게임을 우선합니다. 광고 없음이나 정확한 한 판 시간처럼 확인하지 못한 조건이 꼭 필요하다면, 어느 조건을 바꿀 수 있는지 되묻습니다.',
    chart: 'Poki 인기 목록 보기',
  },
  en: {
    title: 'Create a fighter in ChatGPT or find a web game to play',
    lead: 'ODDBOUT brings character creation and a browser-game launcher into your conversation. Describe a fighter you want to see in the arena. Or tell ODDBOUT who is playing and on what device. It recommends two or three matches from a catalog of 30 web games, with a card for each game.',
    cost: 'When you use ODDBOUT with your ChatGPT subscription, GPT work included in your plan incurs no separate OpenAI API charges.',
    costDetail:
      'Available generation features and limits depend on your plan. Asking ODDBOUT to produce a fighter on its servers uses ODDBOUT creation tokens.',
    fighterTitle: '“Make me a raccoon blacksmith who fights in a scorched apron.”',
    fighterSteps: [
      [
        'Describe your fighter',
        'Start with something you want to see on screen, like soot on the apron or the little grunt before a hammer swing. You can attach a sketch or reference image you have the right to use.',
      ],
      [
        'Choose their appearance',
        'When ODDBOUT handles creation, you pick a front view. That design carries through walking, running, attacking, blocking, taking a hit and falling.',
      ],
      [
        'Practise and enter the arena',
        'Open My fighters with the account you registered with. Try a practice bout and check all 11 required motions. Once the front image passes review and you enter the fighter, other players can meet it in cups and ranked duels. Control your fighter yourself or let the AI fight.',
      ],
    ],
    clip: 'Actual ODDBOUT gameplay · 10 seconds. Two fighters meet in the arena. The raccoon above is a sample creation prompt.',
    arcadeTitle: 'Looking for a quick game? Describe your setup',
    start: 'Open ODDBOUT in ChatGPT',
    setup: 'On the plugin page, choose the option to try it in chat. In a new conversation, select @ODDBOUT and ask a question like the ones below.',
    exampleTitle: 'One keyboard. Two very different contests.',
    example:
      'We asked for two popular games that friends could play simultaneously on one keyboard. ODDBOUT returned Basketball Stars and Tag. In Basketball Stars, steal the ball and shoot before your friend can block you. In Tag, use separate keys to chase each other until you can pass the chase to your friend. Pick the kind of rivalry you feel like today.',
    promptsTitle: 'Try a request that fits your setup',
    prompts: [
      [
        'Playing on your phone',
        '“Find two games I can play one-handed on my phone. A runner would be great.”',
        'Phone and one-handed controls are requirements. A runner gets preference among the games that fit.',
      ],
      [
        'In the mood to build something',
        '“I’d like to run a shop or merge materials. What would I do first?”',
        'Compare the opening moves. Harvest bananas and stock a shelf in Monkey Mart, or combine ore and forge equipment in Legendary Forge.',
      ],
      [
        'Keep one condition and change another',
        '“Keep the shared keyboard, but leave out the basketball game you just showed me.”',
        'Keep your setup and rule out a previous pick. If only one game fits, you’ll see one.',
      ],
    ],
    originalsTitle: 'Three ODDBOUT originals you can play in chat',
    originals: [
      ['Pudding Escape', 'Pick a jelly, run and dodge obstacles. Come back for another run to beat your score.'],
      [
        'Legendary Forge',
        'Tap a vein to mine ore, merge two matching pieces, then take them to the anvil to make equipment for delivery. The screenshot shows the forge after mining in a live game.',
      ],
      ['Bounce Ball', 'The ball bounces on its own. Time your moves left and right to clear obstacles and advance to the next stage.'],
    ],
    launch:
      'Choose the in-chat play button on an original to open the game inside the launcher. Return to the launcher to pick again. For an external game, choose the Poki button and confirm the link in ChatGPT to open the official game page.',
    evidenceTitle: 'Where the picks come from',
    evidence:
      'The starting catalog pairs three ODDBOUT originals with 27 games selected from Poki’s popular list. The count on each external card is the cumulative number of Poki ratings when we reviewed it on November 21, 2026. Requirements such as simultaneous play or guest access narrow the shortlist first. Preferences such as genre help order the matches. If a requirement like ad-free play or an exact round length hasn’t been verified, ODDBOUT asks what you can relax.',
    chart: 'Explore popular games on Poki',
  },
};
