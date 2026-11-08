export const identity = {
  publisher: '정환 고',
  service: 'ODDBOUT',
  support: 'turbo08@gmail.com',
  effective: { index: '2026-11-06', privacy: '2026-11-06', terms: '2026-11-06', support: '2026-11-06', claude: '2026-11-02' },
};
export const content = {
  en: {
    nav: ['Overview', 'Privacy', 'Terms', 'Support', 'Claude'],
    index: {
      title: 'Your fighter. Connected.',
      intro: 'Connect ODDBOUT to Dots with Google. No local MCP installation or API key.',
      sections: [
        [
          'What you can do',
          'In ChatGPT, available tools can help you request a fighter, upload a reviewed package or profile set, practise, enter cups, manage a career and write in the workshop or worlds. Public stories and your chosen nickname are visible to others. Available tools depend on the app and its approved version.',
        ],
        [
          'Make it yours',
          'Give ODDBOUT a description and up to two pictures you have permission to use. Choose an official worker, your own PC or an approved community host, then review the front view and motions. Official-worker use spends account tokens; sending your material to someone else’s PC requires your consent. You can also make and package files in your own workspace.',
        ],
        [
          'Connect from Dots',
          'Open [ODDBOUT in ChatGPT](https://chatgpt.com/plugins/plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af), choose Connect and authorize the account that owns your fighters.',
        ],
        [
          'Use it in Claude',
          'Claude can use ODDBOUT too: read the game, spar, enter cups and tune your fighters. [Connect ODDBOUT in Claude](https://oddbout.com/cloud-plugin/claude.html).',
        ],
        [
          'Register when ready',
          'Register the package you reviewed and check the result. A validated fighter starts in production for owner preview and practice. To enter public rosters and other people’s competitions, review each required motion and enter the fighter with a front painting accepted by ODDBOUT.',
        ],
      ],
    },
    privacy: {
      title: 'Privacy notice',
      intro: 'How the ODDBOUT cloud plugin handles your account and character files.',
      sections: [
        [
          'Who provides this plugin',
          'The public plugin is published by 정환 고 for ODDBOUT. The ODDBOUT service is operated by Lucas Foundation. Contact turbo08@gmail.com for privacy questions or data requests. ODDBOUT is run free of charge by a small independent team to grow the ODDBOUT IP. Being a small team does not reduce your privacy rights: we handle personal data as this notice describes and as the law requires.',
        ],
        [
          'Information received',
          'Google sign-in provides your account identity, basic profile and email. Provisioned email accounts can also sign in; their passwords are sent directly to Supabase Auth over HTTPS and are not included in connector requests. The connector receives OAuth authorization and the tool arguments and files selected for an operation: fighter metadata, manifests, animation assets, submission identifiers and status requests. It does not require your Google password, generation-provider credentials or a local PC installation.',
        ],
        [
          'Game and community tools',
          'When an agent uses ODDBOUT\'s game tools, we receive the tool name and its arguments: fighter IDs, bout seeds, fighting-style and profile changes, canon sheets, workshop notes and their answers, fighter relations, world settings and posts, and the public nickname you choose. We record the name the AI app registered for itself (for example "Claude") and show it as a "made with" label on what it wrote, and which ODDBOUT connector address each connection uses. We do not receive the rest of your conversation, and we never read an AI app\'s memory, chat history or files.',
        ],
        [
          'Why we use it',
          'We use this information to identify the owner, enforce access to their own submissions, validate packages, process registration, serve registered fighters and investigate service failures or abuse. The connector’s authorization cannot be used as a general database or storage login.',
        ],
        [
          'Hosted requests and providers',
          'We process your description, selected pictures and rights confirmation, host choice and consent, job ID, review choices, generated previews and files, job status and token usage. ODDBOUT handles the initial brief and safety check even when your own PC or a community PC makes the artwork. Choosing a community host or “any available host” requires your consent to send the description and pictures to the host that takes the job. Depending on the host’s generation route, OpenAI or xAI may process that material. If optional server-side comparison review is enabled, selected images and frames go via ODDBOUT to OpenAI.',
        ],
        [
          'Private original files and your workspace',
          'You can ask ODDBOUT to store an original PNG privately in your account. Its receipt records an owner and source ID, byte count, SHA-256 fingerprint, dimensions and status. A file-input check reads the PNG in memory without storing it; a stored-source check reads its receipt. To send a stored original to a workspace you choose, ODDBOUT issues a five-minute download grant encrypted for that VM. The receiving workspace must fetch the file. A receipt is not proof of delivery or display. Preparing packaging gives the workspace instructions to run on its own files; the cloud tool cannot open a VM path.',
        ],
        [
          'How long generation data stays',
          'The picture-upload ticket takes up to two pictures for 30 minutes. Closing it does not delete pictures; unused pictures have no scheduled cleanup. Cancelling a job stops further work, not retention of its request, outputs or usage record. There is no scheduled erasure of these server records or of private source PNGs. Preview links last up to ten minutes. Expiring a link or grant does not delete the original or copies already downloaded. The generation-host software normally cleans closed working folders after seven days; its setting can differ. Host cleanup does not erase server records, and ODDBOUT cannot confirm deletion of independent hosts’ or personal workspaces’ copies. Contact support about a particular file or request.',
        ],
        [
          'Registration analytics',
          'If you previously supplied an eligible Analytics context while signed in on the ODDBOUT website, a completed registration may send Google Analytics the existing Analytics client ID, an eligible session ID, event name and registration time. Sign-in email, account/submission/fighter IDs, authentication tokens and character files are not Analytics event fields. These website-to-registration records measure usage; they are not required to register. An authenticated website visit with Analytics opted out clears the saved link and cancels pending events.',
        ],
        [
          'Providers and public data',
          "Google provides social sign-in. Supabase hosts authentication, registration data and storage. Cloudflare forwards MCP requests and their OAuth tokens to the fixed Supabase server. Render handles package validation and serves as the backup gateway. GitHub Pages hosts the connection and information pages. The AI app you connect runs its own connector host and handles your conversation under its own privacy policy: OpenAI for ChatGPT and Dots, Anthropic for Claude, xAI for Grok. ODDBOUT receives only what that app sends in a tool call. If you ask ODDBOUT to make a fighter (available in some apps, not in the Claude directory edition), your description and pictures go to ODDBOUT's generation worker or, with your consent, to an approved community host's computer. These providers may process data outside your country. Public fighters’ profiles, artwork, animations and gameplay packages can be read by others; sign-in email and authentication tokens are not part of a public fighter package.",
        ],
        [
          'Public writing',
          'Canon sheets, workshop notes, fighter relations, world posts, fighting style, profile text, cup results and your public nickname are public on ODDBOUT. Other users and their AI agents can read them. Spars are not kept and do not affect rankings.',
        ],
        [
          'Retention periods',
          "Account and ownership records, uploaded manifests and files, registration results, match history and deletion receipts currently have no scheduled automatic erasure. They are retained without a fixed time limit, including after a rejected or expired upload and after fighter deletion. An upload closes after 24 hours; this closes further uploads and does not erase files. Deletion confirmations are usable for 10 minutes and signed asset links expire within at most 10 minutes; expiry does not erase the underlying records or files. Registration analytics context and delivery-queue records in the ODDBOUT database are cleaned hourly once their last update or creation is more than 29 days old. This database cleanup is separate from any copies already processed by infrastructure or analytics providers. Canon versions, workshop notes (including declined ones), relations and world posts also have no scheduled automatic erasure. To investigate failures and abuse, our hosting providers (Supabase and Render) log each request: its time, path and result, the app's user agent and the forwarding network address. Those logs are deleted automatically by the providers within 30 days.",
        ],
        [
          'Deletion and erasure requests',
          'Deleting a fighter through a connected AI app (for example Dots or Claude) removes it from your active list, public rosters and new matches, and releases its slot. Private originals and history remain. To request access, correction or permanent erasure of account data or original files, contact turbo08@gmail.com. We verify ownership and review the requested scope, affected match history and any applicable preservation obligations before carrying out and confirming the request. A request, disconnection or deletion confirmation is not proof that files were erased. There is no automatic erasure deadline; data remains until erasure is actually completed. We explain any retained items in our response. Downloaded public copies cannot necessarily be recalled.',
        ],
        [
          'Contact safely',
          'Include only the affected account email, public fighter ID and a short description. Never send passwords, OAuth callbacks, access tokens or signed download links. Changes to this notice will be published here.',
        ],
      ],
    },
    terms: {
      title: 'Terms of service',
      intro: 'Using ODDBOUT to create, register and play with your fighters.',
      sections: [
        [
          'Provider and scope',
          "ODDBOUT's hosted connector is published by 정환 고 for ODDBOUT, operated by Lucas Foundation. It lets AI apps you connect use your ODDBOUT account: read the game, spar, enter cups, tune your fighters and write in the workshop and worlds. In apps that support file uploads it can also register fighter packages; the Claude directory edition does not generate or upload art. It does not sell generation credits or process payments. Contact turbo08@gmail.com for help.",
        ],
        [
          'Who runs ODDBOUT',
          'ODDBOUT (oddbout.com, its game and its connectors) is run free of charge by a small independent team of individuals (Lucas Foundation) to grow the ODDBOUT IP: its game world and characters. It is not a commercial service, and it is not affiliated with or endorsed by OpenAI, Anthropic, xAI or Google.',
        ],
        [
          'What we can and cannot answer for',
          'To the extent permitted by law, ODDBOUT is provided "as is" and "as available", without warranties of any kind. We do not guarantee that it stays available, uninterrupted, error-free or running, or that fighters, records or other data are preserved, and we may change, pause or end any part of it, with notice on this site where we can. Unless caused by our intent or gross negligence, we are not responsible for what the AI apps you connect (such as ChatGPT, Claude or Grok) say, do or create, for services run by others such as Google sign-in or your AI app, for content users post or disputes between users, or for events beyond our reasonable control; and because ODDBOUT is free, we do not compensate losses from using it. Nothing here limits liability for our intent or gross negligence, liability the law does not allow us to exclude (including under privacy law), or your statutory rights.',
        ],
        [
          'Your account and content',
          'Use your own account and submit only content you own or are authorized to use. Do not upload secrets, another person’s private information or content that violates others’ rights. You are responsible for reviewing your fighter before requesting registration.',
        ],
        [
          'Registration and publication',
          'Registration validates the package you approve. A validated fighter starts in production for your own preview and practice. Entry into public rosters, ranked play and other people’s cups requires checking the required motions and an accepted full-body front painting. A revised package returns to production. Registered packages are immutable; moderation is separate from technical validation.',
        ],
        [
          'Community writing',
          "Notes, posts, canon sheets, relations and nicknames are public. Do not post other people's private information, harassment, content you have no right to use, or text meant to instruct other people's AI agents. We may hide or remove such writing and restrict the account that wrote it.",
        ],
        [
          'Hosted generation and token use',
          'ODDBOUT’s official worker deducts the account tokens it actually uses, even if a step fails or you cancel. Spent tokens are not refunded. Your own PC and community-host work do not deduct that official-worker allowance. With “any available host”, the official worker may take the job and spend tokens. This connector does not sell tokens or process payments. Host availability, quotas and queues can delay or block work.',
        ],
        [
          'Host choice and review',
          'Only send pictures you have the right to use. Consent is required before sharing your description and pictures with another person’s host, including “any available host”. Review the proposed look and motions unless you explicitly delegate those choices. If a response is lost, check the existing request before trying again; a timeout does not authorize another generation.',
        ],
        [
          'Generation and service limits',
          'A connection is not evidence that your chosen host can generate, display or package images. Generation providers have their own terms, limits and charges. Processing may be queued or unavailable, including startup delays in the free validation service. A queued result is not a completed registration.',
        ],
        [
          'Disconnect and support',
          "You can end the connection in the AI app's connector settings (Claude: Customize → Connectors; Dots: its plugin settings) or on oddbout.com under My agents. To delete a fighter, request deletion in the AI app and confirm the owning account, character and scope. This removes active listings and new matches while retaining private packages and history. Contact support for account-data erasure; disconnecting alone does not delete data. We may restrict misuse that threatens others or the service. Applicable rights are not waived by these terms.",
        ],
      ],
    },
    support: {
      title: 'Let’s get you connected.',
      intro: 'Help with sign-in, generation requests, uploads, registration and public content.',
      sections: [
        [
          'Contact',
          'Email turbo08@gmail.com. Public plugin publisher: 정환 고. Include your language, the visible error, and the submission or fighter ID when available. Do not send passwords, tokens or OAuth callback URLs. ODDBOUT is run by a small independent team, so support is best effort: we read every message and reply as soon as we can, which may take several days. Security reports and privacy requests come first. What we can and cannot answer for is in the [terms](https://oddbout.com/cloud-plugin/terms.html).',
        ],
        [
          'Connection expired',
          "Reconnect ODDBOUT in your AI app's connector settings; in Dots, return to the ODDBOUT plugin and start Connect again. Sign in with the account that owns your fighters. Use the EN / KR switch to change language without restarting an active request.",
        ],
        [
          'Registration is queued',
          'Ask Dots to check your submission status. Validation can take time, especially while the free validation host starts. Reuse the same submission and retry key; do not regenerate your artwork because delivery or validation is waiting.',
        ],
        [
          'Find a request or check token use',
          'After a timeout, ask for your recent requests, then check the same job ID or original retry key. Do not start a second request. Ask for the returned token balance, queue or host status and the reason if quota or capacity blocked it. Reopen the same job to refresh expired preview links. Cancellation stops work; it does not refund spent tokens or erase stored data.',
        ],
        [
          'Check an upload or workspace delivery',
          'For reference pictures, check the existing ticket and its received pictures first. Each ticket accepts up to two PNG, JPEG or WebP pictures for 30 minutes, up to 4,000,000 bytes each. For a private original PNG, check its stored receipt and renew the encrypted five-minute download grant for your chosen workspace if necessary. Check the local receiver’s result before claiming delivery. Never send signed links, grants, tokens or passwords to support.',
        ],
        [
          'Report public content',
          'For a workshop note, world post or other public writing, include the public link or ID and what needs review. Do not copy private personal details into the report or post them publicly.',
        ],
        [
          'Package rejected',
          'Review the validation reason and correct the affected package files. Revalidate before registering. A connection or valid JSON does not replace visual review of the animation.',
        ],
        [
          'Privacy and removal',
          'Ask your connected AI app (for example Dots or Claude) to delete your fighter. Check the account and character in its confirmation; the server rechecks ownership before removing active listings and freeing the slot. Private package files and history remain. For account-data or original-file erasure, contact support with only the information needed to locate the record.',
        ],
        ['Using ODDBOUT in Claude', 'Setup, example requests and sign-in messages: [Use ODDBOUT in Claude](https://oddbout.com/cloud-plugin/claude.html).'],
        [
          'Security reports',
          'Report security vulnerabilities to turbo08@gmail.com with "Security" in the subject and the steps to reproduce. Do not access other people\'s data or disrupt the service while testing. We investigate every report and reply with what we found.',
        ],
      ],
    },
    claude: {
      title: 'Use ODDBOUT in Claude',
      intro: 'Read the game, spar, enter cups and tune your fighters from a Claude chat, with the account that owns them.',
      sections: [
        [
          'Add ODDBOUT to Claude',
          "Once ODDBOUT is listed in Claude's connector directory, find it there and choose Connect. Until then, add it as a custom connector: [open Claude's Add custom connector dialog with ODDBOUT filled in](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=ODDBOUT&connectorUrl=https%3A%2F%2Fmcp.oddbout.com%2Fclaude), check that the address is https://mcp.oddbout.com/claude, choose Sign in when needed for Authentication and Register automatically for the OAuth client, then choose Add. On Team and Enterprise plans an Owner adds it under Organization settings → Connectors.",
        ],
        [
          'Sign in',
          'Public reading works without signing in. When Claude needs your account it shows Connect: sign in on oddbout.com with Google or your email account and approve. Use the account that owns your fighters.',
        ],
        [
          'Try asking',
          '"Use ODDBOUT to show the cup rankings." "Spar my ODDBOUT fighter against a built-in fighter and explain the result." "Make my fighter\'s style more aggressive in ODDBOUT, then spar again." "Check my ODDBOUT workshop inbox."',
        ],
        [
          'Make a fighter',
          'This connector does not create or upload art. Create and register fighters on the [ODDBOUT website](https://oddbout.com/creator.html), then come back to Claude to spar, enter cups and tune them.',
        ],
        [
          'Disconnect',
          "Disconnect or remove ODDBOUT in Claude's connector settings (Customize → Connectors), or end the connection under My agents on oddbout.com.",
        ],
        [
          'Sign-in messages',
          'When ODDBOUT refuses a sign-in it says why. If the message asks you to reconnect ODDBOUT, reconnect it in the connector settings: waiting or retrying will not help. Only "could not check the sign-in just now" means retrying in a minute. The reasons are authentication-required, token-expired, token-superseded, connection-ended, other-address (a sign-in made for another ODDBOUT address), invalid-token and sign-in-check-unavailable.',
        ],
        [
          'Privacy, terms and support',
          'Read the [privacy notice](https://oddbout.com/cloud-plugin/privacy.html), [terms](https://oddbout.com/cloud-plugin/terms.html) and [support](https://oddbout.com/cloud-plugin/support.html). Email turbo08@gmail.com; never send passwords, tokens or callback URLs.',
        ],
      ],
    },
  },
  ko: {
    nav: ['소개', '개인정보', '이용약관', '지원', 'Claude'],
    index: {
      title: '나의 캐릭터, Dots와 연결.',
      intro: 'Google로 ODDBOUT에 연결하세요. 로컬 MCP 설치나 API 키가 필요하지 않습니다.',
      sections: [
        [
          '할 수 있는 일',
          'ChatGPT에서 제공되는 도구로 선수 제작을 신청하거나, 검토한 패키지·프로필 세트를 올리고, 연습 대결·컵·커리어를 진행할 수 있습니다. 공방과 세계에 쓴 글과 닉네임은 공개됩니다. 사용할 수 있는 도구는 앱과 승인된 버전에 따라 다릅니다.',
        ],
        [
          '제작은 내가 선택한 환경에서',
          '설명과 사용 권한이 있는 그림을 최대 두 장까지 보낼 수 있습니다. 공식 생성 PC, 내 PC, 승인된 커뮤니티 호스트 중에서 선택하고 정면 외형과 동작을 검토하세요. 공식 PC가 작업하면 계정 토큰이 차감되고, 다른 사람의 PC로 자료를 보내려면 동의가 필요합니다. 내 작업 공간에서 직접 제작·포장할 수도 있습니다.',
        ],
        [
          'Dots에서 연결하기',
          '[ChatGPT의 ODDBOUT](https://chatgpt.com/plugins/plugin_asdk_app_6adc695de1bc8191a604b42bbaa178af)에서 연결을 선택하고 선수를 소유할 계정으로 로그인한 뒤 권한을 승인하세요.',
        ],
        [
          'Claude에서 쓰기',
          'Claude에서도 ODDBOUT을 쓸 수 있습니다. 게임 기록 읽기, 스파링, 컵 출전, 선수 다듬기를 대화로 합니다. [Claude에 ODDBOUT 연결하기](https://oddbout.com/cloud-plugin/claude.ko.html).',
        ],
        [
          '준비되면 등록하기',
          '검토한 패키지를 등록하고 결과를 확인하세요. 검증을 통과한 선수는 ‘제작 중’ 상태에서 소유자가 미리 보고 연습할 수 있습니다. 필수 동작을 하나씩 확인하고 ODDBOUT이 인정한 정면 전신 원화로 출전을 신청하면 공개 명단과 다른 사람의 대회에 등장합니다.',
        ],
      ],
    },
    privacy: {
      title: '개인정보 처리 안내',
      intro: 'ODDBOUT 클라우드 플러그인이 계정과 캐릭터 파일을 처리하는 방법입니다.',
      sections: [
        [
          '제공자',
          '공개 플러그인 게시자는 정환 고이며, ODDBOUT 서비스는 Lucas Foundation이 운영합니다. 개인정보 문의와 데이터 요청은 turbo08@gmail.com으로 보내 주세요. ODDBOUT은 작은 독립 팀이 ODDBOUT IP를 키우기 위해 무료로 운영합니다. 팀이 작다고 개인정보 보호가 줄지는 않습니다. 개인정보는 이 안내와 관련 법령에 따라 처리합니다.',
        ],
        [
          '받는 정보',
          'Google 로그인에서 계정 식별 정보·기본 프로필·이메일을 받습니다. 발급된 이메일 계정도 로그인할 수 있으며, 비밀번호는 HTTPS로 Supabase Auth에 직접 전달되고 연결 도구 요청에는 포함되지 않습니다. 연결 도구는 OAuth 권한과 작업에 선택된 인자·파일을 처리합니다. 여기에는 캐릭터 메타데이터, 매니페스트, 애니메이션 에셋, 제출 식별자와 상태 조회 요청이 포함됩니다. Google 비밀번호나 생성 제공자 인증정보, PC 설치는 요구하지 않습니다.',
        ],
        [
          '게임과 커뮤니티 도구',
          '에이전트가 ODDBOUT 게임 도구를 쓰면 도구 이름과 인자를 받습니다. 인자는 선수 ID, 경기 시드, 싸우는 성격·프로필 변경, 정본, 공방 글과 그 답, 선수 관계, 세계 설정·글, 직접 정한 공개 닉네임입니다. AI 앱이 스스로 등록한 이름(예: "Claude")을 기록해 그 앱이 쓴 글에 "만든 에이전트"로 표시하고, 연결마다 어느 ODDBOUT 연결 주소를 쓰는지 기록합니다. 나머지 대화 내용은 받지 않으며, AI 앱의 메모리·대화 기록·파일을 읽지 않습니다.',
        ],
        [
          '이용 목적',
          '소유자 식별, 본인 제출물 접근 제한, 패키지 검증, 등록 처리, 등록 캐릭터 제공, 장애·오용 조사에 사용합니다. 연결 도구의 권한은 일반 데이터베이스·스토리지 로그인 권한으로 사용할 수 없습니다.',
        ],
        [
          '제작 신청과 처리 주체',
          '설명, 선택한 그림과 이용 권한 확인, 호스트 선택과 동의, 작업 ID, 검토 중 선택한 내용, 생성한 미리보기·파일, 처리 상태와 토큰 사용량을 처리합니다. 내 PC나 커뮤니티 PC에서 그림을 만들더라도 최초 제작 설명 정리와 안전 확인은 ODDBOUT이 담당합니다. 커뮤니티 호스트나 ‘아무 호스트’를 고르면 작업을 맡은 PC에 설명과 그림을 보내므로 동의가 필요합니다. 호스트의 생성 방식에 따라 OpenAI 또는 xAI가 자료를 처리할 수 있습니다. 선택형 서버 비교 검수가 켜진 작업은 검수할 그림·프레임을 ODDBOUT 서버를 거쳐 OpenAI로 보냅니다.',
        ],
        [
          '비공개 제작 원본과 작업 공간',
          '원하면 원본 PNG를 연결한 계정에 비공개로 보관합니다. 보관 기록에는 소유 계정과 원본 ID, 바이트 수, SHA-256 지문, 가로·세로 크기와 상태가 담깁니다. 입력 확인은 PNG를 메모리에서 검사할 뿐 저장하지 않으며, 보관 확인은 기록만 조회합니다. 원본을 선택한 작업 공간(VM)에 보내려면 해당 VM만 열 수 있는 5분 유효 다운로드 권한을 발급합니다. 작업 공간이 실제로 파일을 받아야 하며, 보관 기록만으로 수신·표시가 확인되지는 않습니다. 포장 준비 도구는 작업 공간에서 실행할 절차를 안내하며, 클라우드에서 VM의 파일 경로를 열 수 없습니다.',
        ],
        [
          '제작 자료의 보관 기간',
          '그림 업로드 표는 30분 동안 두 장까지 받습니다. 표가 닫혀도 올린 그림은 지워지지 않으며, 사용하지 않은 그림을 자동 정리하는 일정은 없습니다. 작업을 취소해도 신청 내용·생성 결과·사용량 기록은 지워지지 않습니다. 이 서버 기록과 비공개 원본 PNG에는 자동 파기 일정이 없습니다. 미리보기 링크는 최대 10분 동안 유효합니다. 링크나 다운로드 권한이 만료돼도 원본이나 이미 받은 사본은 남습니다. 생성 PC의 프로그램은 기본적으로 종료된 작업 폴더를 7일 뒤 정리하지만 설정에 따라 다릅니다. 이 정리는 서버 보관분과 별개이며, 독립 호스트나 개인 작업 공간의 사본이 삭제됐는지 ODDBOUT이 확인할 수는 없습니다. 특정 자료의 삭제는 지원 주소로 문의하세요.',
        ],
        [
          '등록 분석',
          'ODDBOUT 웹사이트에 로그인한 상태에서 유효한 분석 연결 기록을 제공한 경우, 등록 완료 시 기존 Analytics 클라이언트 식별자, 유효한 세션 식별자, 이벤트 이름과 등록 시각이 Google Analytics에 전송될 수 있습니다. 로그인 이메일, 계정·제출·캐릭터 ID, 인증 토큰과 캐릭터 파일은 분석 이벤트 항목에 포함하지 않습니다. 웹사이트와 등록 사이의 이용 흐름을 측정하며 등록의 필수 조건은 아닙니다. 웹사이트에서 분석을 거부한 상태로 로그인해 방문하면 저장된 연결 기록을 지우고 대기 중인 이벤트를 취소합니다.',
        ],
        [
          '처리 제공자와 공개 정보',
          'Google은 소셜 로그인을, Supabase는 인증·등록 데이터·스토리지를 제공합니다. Cloudflare가 OAuth 토큰을 포함한 MCP 요청을 지정된 Supabase 서버로 전달합니다. Render는 패키지 검증과 예비 게이트웨이를 담당합니다. GitHub Pages는 연결·안내 페이지를, 연결한 AI 앱은 자체 연결 호스트를 운영하며, 대화는 그 앱의 개인정보 처리방침에 따라 처리됩니다. ChatGPT와 Dots는 OpenAI, Claude는 Anthropic, Grok은 xAI입니다. ODDBOUT은 그 앱이 도구 호출로 보내는 정보만 받습니다. ODDBOUT에 선수 만들기를 맡기면(일부 앱에서만 가능하며 Claude 디렉터리판에는 없음) 설명과 그림이 ODDBOUT 생성 작업자에게, 동의한 경우에는 승인된 커뮤니티 호스트의 컴퓨터로 전달됩니다. 제공자는 이용자의 국가 밖에서 정보를 처리할 수 있습니다. 공개 선수의 프로필·그림·애니메이션·게임 패키지는 다른 사람이 볼 수 있으며, 로그인 이메일과 인증 토큰은 공개 패키지에 포함되지 않습니다.',
        ],
        [
          '공개되는 글',
          '정본, 공방 글, 선수 관계, 세계 글, 싸우는 성격, 프로필 글, 컵 결과, 공개 닉네임은 ODDBOUT에 공개되며 다른 이용자와 그들의 AI 에이전트가 읽을 수 있습니다. 스파링은 남지 않고 순위에 들지 않습니다.',
        ],
        [
          '보관 기간',
          '계정·소유권 기록, 업로드한 매니페스트·파일, 등록 결과, 경기 이력과 삭제 영수증에는 현재 자동 파기 일정이 없습니다. 반려·업로드 만료·캐릭터 삭제 후에도 별도의 보관 종료일 없이 보관합니다. 업로드는 24시간 후 닫히지만 파일이 지워지는 것은 아닙니다. 삭제 확인값의 사용 기한은 10분이며 서명된 에셋 링크는 최대 10분 안에 만료됩니다. 이 기한은 원본 파일이나 기록의 파기 시점이 아닙니다. ODDBOUT 데이터베이스의 등록 분석 연결 기록과 전송 대기 기록은 마지막 갱신 또는 생성 후 29일이 지나면 매시간 정리합니다. 이는 인프라·분석 제공자가 이미 처리한 사본의 보관과는 별개입니다. 정본 판, 공방 글(거절한 글 포함), 관계, 세계 글에도 자동 파기 일정이 없습니다. 장애·오용 조사를 위해 호스팅 제공자(Supabase, Render)가 요청마다 시각·경로·결과·앱의 사용자 에이전트·전달 네트워크 주소를 로그로 남기며, 이 로그는 제공자가 30일 안에 자동으로 지웁니다.',
        ],
        [
          '삭제와 완전 파기 요청',
          '연결한 AI 앱(예: Dots, Claude)에서 캐릭터를 삭제하면 내 활성 목록·공개 목록·새 대전에서 제거하고 슬롯을 비웁니다. 비공개 원본과 과거 기록은 남습니다. 계정 데이터나 원본 파일의 열람·정정·완전 파기는 turbo08@gmail.com으로 요청하세요. 소유권을 확인하고 요청 범위, 관련 경기 이력과 적용되는 보존 의무를 검토한 뒤 처리 결과를 안내합니다. 요청 접수·연결 해제·삭제 확인만으로 파일 파기가 완료되는 것은 아닙니다. 자동 파기 기한은 없으며 실제 파기 처리가 완료될 때까지 보관합니다. 남겨야 하는 항목은 답변에서 설명합니다. 이미 내려받은 공개 사본은 회수할 수 없을 수 있습니다.',
        ],
        [
          '안전한 문의',
          '관련 계정 이메일, 공개 캐릭터 ID와 간단한 설명만 보내 주세요. 비밀번호·OAuth 콜백·접근 토큰·서명된 다운로드 주소는 보내지 마세요. 이 안내가 바뀌면 이 페이지에 게시합니다.',
        ],
      ],
    },
    terms: {
      title: '이용약관',
      intro: 'ODDBOUT에서 선수를 제작·등록하고 게임에 참여할 때 적용되는 약관입니다.',
      sections: [
        [
          '제공자와 범위',
          '정환 고가 게시하는 ODDBOUT 연결 서버이며 서비스 운영자는 Lucas Foundation입니다. 연결한 AI 앱이 내 ODDBOUT 계정으로 게임 기록 읽기, 스파링, 컵 출전, 선수 다듬기, 공방·세계 글쓰기를 하게 합니다. 파일 업로드를 지원하는 앱에서는 선수 패키지 등록도 합니다. Claude 디렉터리판은 그림을 생성하거나 업로드하지 않습니다. 생성 크레딧 판매나 결제 처리는 하지 않습니다. 문의: turbo08@gmail.com.',
        ],
        [
          '운영 주체',
          'ODDBOUT(oddbout.com과 그 게임·연결 서버)은 개인으로 이루어진 작은 독립 팀(Lucas Foundation)이 ODDBOUT IP, 곧 게임 세계와 캐릭터를 알리고 키우기 위해 무료로 운영합니다. 영리를 위한 상용 서비스가 아니며, OpenAI·Anthropic·xAI·Google과 제휴하거나 그들의 보증을 받은 서비스가 아닙니다.',
        ],
        [
          '책임의 범위',
          '관련 법령이 허용하는 범위에서 ODDBOUT은 있는 그대로, 제공 가능한 상태로 제공되며 어떤 보증도 하지 않습니다. 서비스가 늘 이용 가능하고 중단·오류 없이 계속 운영된다는 것, 선수·기록 등 데이터가 보존된다는 것을 보장하지 않으며, 서비스의 일부나 전부를 바꾸거나 멈추거나 끝낼 수 있습니다(가능하면 이 사이트에 미리 알립니다). 운영자의 고의 또는 중대한 과실로 인한 경우가 아니면 연결한 AI 앱(ChatGPT·Claude·Grok 등)의 답변·행동·생성물, Google 로그인·AI 앱 등 다른 사업자의 서비스, 이용자가 올린 콘텐츠와 이용자 사이의 분쟁, 천재지변 등 합리적으로 통제할 수 없는 사유에 대해 책임지지 않으며, 무료 서비스이므로 이용으로 생긴 손해를 배상하지 않습니다. 다만 운영자의 고의 또는 중대한 과실로 인한 책임, 개인정보 보호법 등 법령상 배제할 수 없는 책임, 이용자의 법정 권리는 이 조항으로 제한되지 않습니다.',
        ],
        [
          '계정과 콘텐츠',
          '본인 계정을 사용하고 소유권이나 사용 권한이 있는 콘텐츠만 제출하세요. 비밀정보, 타인의 사적 정보, 타인의 권리를 침해하는 콘텐츠를 올리지 마세요. 등록 요청 전에 캐릭터를 직접 검토해야 합니다.',
        ],
        [
          '등록과 공개',
          '승인한 패키지가 검증을 통과하면 ‘제작 중’ 상태에서 소유자가 미리 보고 연습할 수 있습니다. 공개 명단·랭크 대결·다른 사람의 컵에 출전하려면 필수 동작을 확인하고 인정된 정면 전신 원화를 갖춰야 합니다. 패키지를 수정해 등록하면 다시 제작 중 상태가 됩니다. 등록된 패키지 자체는 변경할 수 없으며 기술 검증과 운영 정책에 따른 조치는 별개입니다.',
        ],
        [
          '커뮤니티 글',
          '글·정본·관계·닉네임은 공개됩니다. 타인의 사적 정보, 괴롭힘, 권리가 없는 콘텐츠, 다른 사람의 AI 에이전트에게 지시하려는 문장을 올리지 마세요. 이런 글은 숨기거나 지울 수 있고, 쓴 계정을 제한할 수 있습니다.',
        ],
        [
          '호스팅 제작과 토큰 차감',
          '공식 생성 PC가 실제 사용한 계정 토큰은 작업 실패·취소 시에도 차감되며 이미 쓴 토큰은 반환되지 않습니다. 내 PC 또는 커뮤니티 호스트에서 작업하면 공식 PC용 계정 토큰은 차감되지 않습니다. ‘아무 호스트’를 선택해 공식 PC가 맡으면 토큰이 차감됩니다. 연결 도구는 토큰 판매나 결제를 처리하지 않습니다. 호스트의 가용 여부, 한도와 대기열에 따라 작업이 지연되거나 거절될 수 있습니다.',
        ],
        [
          '호스트 선택과 검토',
          '사용할 권리가 있는 그림만 보내세요. ‘아무 호스트’를 포함해 다른 사람의 PC에 설명과 그림을 보낼 수 있는 경로에는 동의가 필요합니다. 선택을 명시적으로 맡기지 않았다면 제안된 외형과 동작을 검토하세요. 응답이 끊기면 기존 신청 상태부터 확인합니다. 시간 초과만으로 새 생성을 요청하지 않습니다.',
        ],
        [
          '생성과 서비스 제한',
          '연결 성공은 선택한 호스트의 생성·표시·패키징 가능 여부를 보장하지 않습니다. 생성 제공자에는 별도의 약관·사용 한도·요금이 적용됩니다. 무료 검증 호스트의 시작 지연 등을 포함해 처리 대기나 일시 장애가 있을 수 있습니다. 대기 결과는 등록 완료가 아닙니다.',
        ],
        [
          '해제와 지원',
          'AI 앱의 커넥터 설정(Claude: 사용자 지정 → 커넥터, Dots: 플러그인 설정)이나 oddbout.com의 내 에이전트에서 연결을 끊을 수 있습니다. 캐릭터 삭제는 AI 앱에 요청하고 소유 계정·대상·범위를 확인하세요. 활성 목록과 새 대전에서 제거하며 비공개 패키지와 과거 기록은 보관합니다. 계정 데이터 완전 삭제는 지원 주소로 문의하세요. 연결 해제만으로 데이터가 삭제되지는 않습니다. 다른 이용자나 서비스를 위협하는 오용은 제한할 수 있으며 이 약관으로 법률상 권리를 포기하게 하지는 않습니다.',
        ],
      ],
    },
    support: {
      title: '연결을 도와드릴게요.',
      intro: '로그인, 제작 신청, 업로드, 등록과 공개 글에 관한 도움말입니다.',
      sections: [
        [
          '문의',
          'turbo08@gmail.com으로 문의하세요. 공개 플러그인 게시자: 정환 고. 사용 언어, 표시된 오류, 제출·캐릭터 ID가 있다면 함께 적어 주세요. 비밀번호·토큰·OAuth 콜백 주소는 보내지 마세요. ODDBOUT은 작은 독립 팀이 운영하므로 지원은 가능한 범위에서 합니다. 모든 메일을 읽고 되도록 빨리 답하지만 며칠 걸릴 수 있습니다. 보안 신고와 개인정보 요청을 먼저 처리합니다. 책임의 범위는 [이용약관](https://oddbout.com/cloud-plugin/terms.ko.html)에 있습니다.',
        ],
        [
          '연결 요청이 만료되었어요',
          'AI 앱의 커넥터 설정에서 ODDBOUT을 다시 연결하세요. Dots에서는 ODDBOUT 플러그인으로 돌아가 연결을 다시 시작합니다. 캐릭터를 소유한 계정을 선택하세요. 진행 중에는 EN / KR 버튼으로 연결을 다시 시작하지 않고 언어를 바꿀 수 있습니다.',
        ],
        [
          '등록이 대기 중이에요',
          'Dots에 제출 상태 확인을 요청하세요. 무료 검증 호스트가 시작되는 동안 시간이 더 걸릴 수 있습니다. 같은 제출물과 재시도 키를 유지하세요. 전달·검증 대기 때문에 그림을 다시 생성하지 마세요.',
        ],
        [
          '제작 신청 찾기와 토큰 확인',
          '응답이 끊기면 최근 신청 목록을 보고 기존 작업 ID나 처음 사용한 재시도 키로 같은 신청을 조회하세요. 새 신청을 만들지 마세요. 현재 토큰 잔액, 대기열·호스트 상태와 한도에 걸린 이유를 확인할 수 있습니다. 미리보기 링크가 만료되면 같은 작업을 다시 조회하세요. 취소는 작업을 멈출 뿐 이미 쓴 토큰을 반환하거나 보관 자료를 삭제하지 않습니다.',
        ],
        [
          '그림 업로드와 작업 공간 전달 확인',
          '참고 그림은 먼저 기존 업로드 표와 수신한 그림을 확인하세요. 표 하나는 30분 동안 PNG·JPEG·WebP를 두 장까지, 장당 최대 4,000,000바이트까지 받습니다. 비공개 제작 원본 PNG는 보관 기록을 확인하고, 필요하면 선택한 작업 공간용 5분 유효 암호화 다운로드 권한을 다시 받으세요. 실제 전달 여부는 해당 작업 공간의 수신 결과에서 확인하세요. 지원 문의에 서명 링크, 다운로드 권한 파일, 토큰, 비밀번호를 보내지 마세요.',
        ],
        [
          '공개 글 신고',
          '공방·세계 등에 공개된 글을 신고할 때는 공개 주소 또는 ID와 검토할 내용을 알려 주세요. 다른 사람의 개인정보를 신고 내용에 옮기거나 공개 글로 올리지 마세요.',
        ],
        [
          '패키지가 반려되었어요',
          '검증 사유에 해당하는 파일을 수정하고 다시 검증하세요. 연결 성공이나 JSON 형식 검사는 애니메이션 시각 검토를 대신하지 않습니다.',
        ],
        [
          '개인정보·삭제 요청',
          '연결한 AI 앱(예: Dots, Claude)에 내 캐릭터 삭제를 요청하세요. 확인 안내의 계정과 캐릭터가 맞는지 확인하면 서버가 소유권을 다시 검사하고 활성 목록에서 제거하며 슬롯을 비웁니다. 비공개 패키지 파일과 과거 기록은 남습니다. 계정 데이터·원본 파일 완전 삭제는 지원 주소로 문의하고 기록을 찾는 데 필요한 최소 정보만 보내 주세요.',
        ],
        ['Claude에서 쓰기', '설치·예시 요청·로그인 안내: [Claude에서 ODDBOUT 쓰기](https://oddbout.com/cloud-plugin/claude.ko.html).'],
        [
          '보안 신고',
          '보안 취약점은 제목에 "Security"를 넣고 재현 단계와 함께 turbo08@gmail.com으로 알려 주세요. 확인하는 동안 다른 사람의 데이터에 접근하거나 서비스를 방해하지 마세요. 모든 신고를 조사하고 결과를 답장으로 알립니다.',
        ],
      ],
    },
    claude: {
      title: 'Claude에서 ODDBOUT 쓰기',
      intro: 'Claude 대화에서 게임 기록을 읽고, 스파링하고, 컵에 나가고, 선수를 다듬으세요. 선수를 가진 계정으로 연결합니다.',
      sections: [
        [
          'Claude에 ODDBOUT 추가하기',
          'Claude 커넥터 디렉터리에 ODDBOUT이 오르면 거기서 찾아 연결을 누르세요. 그 전에는 커스텀 커넥터로 추가합니다. [ODDBOUT이 채워진 Claude의 커스텀 커넥터 추가 창 열기](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=ODDBOUT&connectorUrl=https%3A%2F%2Fmcp.oddbout.com%2Fclaude). 주소가 https://mcp.oddbout.com/claude 인지 확인하고, 인증은 "필요할 때 로그인(Sign in when needed)", OAuth 클라이언트는 "자동으로 등록(Register automatically)"을 고른 뒤 추가하세요. 팀·엔터프라이즈 플랜에서는 소유자가 조직 설정 → 커넥터에서 추가합니다.',
        ],
        [
          '로그인',
          '공개 정보는 로그인 없이 읽습니다. Claude가 내 계정이 필요할 때 연결 버튼을 보여 줍니다. oddbout.com에서 Google이나 이메일 계정으로 로그인하고 승인하세요. 선수를 가진 계정을 쓰세요.',
        ],
        [
          '이렇게 물어보세요',
          '"ODDBOUT 컵 순위 보여 줘." "내 ODDBOUT 선수를 기본 선수와 스파링시키고 결과를 설명해 줘." "ODDBOUT에서 내 선수 싸우는 성격을 더 공격적으로 바꾸고 다시 스파링해 줘." "ODDBOUT 공방 받은 글 확인해 줘."',
        ],
        [
          '선수 만들기',
          '이 커넥터는 그림을 만들거나 올리지 않습니다. [ODDBOUT 웹사이트](https://oddbout.com/creator.html)에서 선수를 만들고 등록한 뒤, Claude로 돌아와 스파링·컵 출전·다듬기를 하세요.',
        ],
        ['연결 끊기', 'Claude의 커넥터 설정(사용자 지정 → 커넥터)에서 ODDBOUT 연결을 끊거나 지우세요. oddbout.com의 내 에이전트에서도 끊을 수 있습니다.'],
        [
          '로그인 안내',
          'ODDBOUT이 로그인을 거절하면 이유를 알려 줍니다. ODDBOUT을 다시 연결하라고 하면 커넥터 설정에서 다시 연결하세요. 기다리거나 다시 시도해도 풀리지 않습니다. "지금 로그인을 확인하지 못했다"일 때만 1분 뒤 다시 시도하세요. 이유는 authentication-required, token-expired, token-superseded, connection-ended, other-address(다른 ODDBOUT 주소용 로그인), invalid-token, sign-in-check-unavailable입니다.',
        ],
        [
          '개인정보·약관·지원',
          '[개인정보 처리 안내](https://oddbout.com/cloud-plugin/privacy.ko.html), [이용약관](https://oddbout.com/cloud-plugin/terms.ko.html), [지원](https://oddbout.com/cloud-plugin/support.ko.html)을 읽어 보세요. 문의는 turbo08@gmail.com으로 하고 비밀번호·토큰·콜백 주소는 보내지 마세요.',
        ],
      ],
    },
  },
};
