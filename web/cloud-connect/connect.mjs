/**
 * The agents that may ask for a connection, by where they come back after consent (an approval hands its code only there), and the page
 * each one's "return" link opens. Dots/ChatGPT may come back anywhere on its two hosts. Grok (grok.com custom connectors) and Grok Bot
 * (Cursor's web connector) come back only on their published callback paths (2026-10-27; xAI does not document them — taken from their
 * registrations). Claude's custom connectors (claude.ai, and claude.com) come back on Anthropic's MCP callback, that exact path only (`exact`);
 * Claude's web, desktop and mobile apps and Claude Code share that one connector (2026-10-28, the site's My agents).
 *
 * An app on this computer (`local`, 2026-10-29): Claude Code (`claude mcp add`), Codex (CLI, app and IDE share `codex mcp add`) and Gemini CLI
 * (`gemini mcp add`) register themselves with a loopback callback on a port of their own (RFC 8252 §7.3; Supabase Auth's registration takes
 * http only for loopback). The MCP authorization spec (2025-11-25) allows `localhost` or https redirects, and asks a consent screen to show the
 * redirect host and warn on loopback ones: the code goes to whatever listens on that port of this computer, and the client's name is its own
 * claim. So the consent names it as an app on this computer, shows host and port, and warns (`localWarning`). An app scheme (`cursor://`) is
 * still not accepted, with one exception below.
 *
 * The Claude desktop app (2026-11-06, the user's decision): its own /mcp Connect signs in with the callback `claude://claude.ai/mcp-auth-callback/sdk`
 * (read from Claude 4.16336.0.0 for Windows and its log, `redirectScheme=custom`), and the consent refused it, so a server added to the app
 * could be signed in only from a terminal. That one address, exactly (any query, no other path, host, port, credentials or fragment), is an app
 * on this computer too: the same class of risk as loopback (another program could claim the `claude:` scheme), and PKCE still keeps the code
 * useless without the app's verifier. Other app schemes stay refused. The Mac app's callback was not read.
 */
const AGENTS = {
  dots: { hosts: { 'chatgpt.com': null, 'chat.openai.com': null }, home: 'https://chatgpt.com/dots/home' },
  grok: { hosts: { 'grok.com': ['/connectors-oauth-exchange-code'], 'www.cursor.com': ['/agents/mcp/oauth/callback', '/bot/mcp/oauth/callback'] },
    home: 'https://grok.com/connectors' },
  claude: { hosts: { 'claude.ai': ['/api/mcp/auth_callback'], 'claude.com': ['/api/mcp/auth_callback'] }, exact: true,
    home: 'https://claude.ai/customize/connectors' },
  local: { hosts: {}, home: 'https://oddbout.com/creator.html#view=agents' },
};
/** The loopback literals RFC 8252 names (`[::1]` is how a URL spells IPv6's), and `localhost`, which the CLIs use. */
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
/** The Claude desktop app's sign-in callback, the only app-scheme address accepted (above). */
const CLAUDE_APP_CALLBACK = 'claude://claude.ai/mcp-auth-callback/sdk';
/** Which agent a callback address belongs to (`dots`, `grok`, `claude`, `local`), or null for an address no agent may use. */
export function agentOf(value) {
  try {
    // The Claude desktop app: that address character for character (a parsed URL would let `claude:claude.ai/…` or dot segments through),
    // alone or followed by the query its approval adds, never a fragment. Every other `claude:` address is refused below.
    const raw = String(value);
    if ((raw === CLAUDE_APP_CALLBACK || raw.startsWith(CLAUDE_APP_CALLBACK + '?')) && !raw.includes('#')) return 'local';
    const u = new URL(value);
    if (u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !u.username && !u.password) return 'local';
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    for (const [agent, { hosts, exact }] of Object.entries(AGENTS)) {
      if (!Object.hasOwn(hosts, u.hostname)) continue;
      const paths = hosts[u.hostname];
      if (paths === null || paths.some(path => u.pathname === path || (!exact && u.pathname.startsWith(path + '/')))) return agent;
    }
    return null;
  } catch { return null; }
}
export function safeClientRedirect(value) { return agentOf(value) !== null; }
/** The agent's name in each language, with the Korean particles its sound takes; `any` before the request says who asked. */
export const agentWords = {
  ko: { dots: { name: 'Dots', to: 'Dots로', at: 'Dots에서', on: 'Dots에' }, grok: { name: 'Grok', to: 'Grok으로', at: 'Grok에서', on: 'Grok에' },
    claude: { name: 'Claude', to: 'Claude로', at: 'Claude에서', on: 'Claude에' },
    local: { name: '이 컴퓨터의 앱', to: '이 컴퓨터의 앱으로', at: '이 컴퓨터의 앱에서', on: '이 컴퓨터의 앱에' },
    any: { name: '에이전트', to: '에이전트로', at: '에이전트에서', on: '에이전트에' } },
  en: { dots: { name: 'Dots' }, grok: { name: 'Grok' }, claude: { name: 'Claude' }, local: { name: 'an app on this computer' }, any: { name: 'your agent' } },
};
export function fillAgent(text, words) {
  return text.replace(/\{(name|to|at|on)\}/g, (_, key) => words[key] ?? words.name);
}
export function authorizationId(search, stored) {
  const id = new URLSearchParams(search).get('authorization_id') ?? stored;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{16,256}$/.test(id) ? id : null;
}
export function connectionLocale(requested, saved, browser = '') {
  return ['en','ko'].includes(requested) ? requested : ['en','ko'].includes(saved) ? saved : browser.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
export const copy = {
  ko: {
    title:'ODDBOUT · {name} 연결', headline1:'나의 캐릭터,', headline2:'링 위로.',
    lead:'Google 계정을 연결하고\n{at} 캐릭터를 등록하세요.',
    stepConnect:'계정 연결', stepConsent:'권한 확인', panelTitle:'계정을 선택하세요', consentTitle:'{on} 연결할까요?', errorTitle:'연결을 다시 시작해 주세요',
    google:'Google로 계속하기', permissions:'허용할 권한', permission1:'기본 프로필·이메일 확인', permission2:'내 캐릭터·등록 상태 조회', permission3:'내가 요청한 캐릭터 업로드·등록·삭제',
    permissionNote:'생성 구독이나 결제 권한은 포함되지 않습니다.', approve:'연결 승인', cancel:'취소', loginNote:'PC 설치 없이 연결됩니다.',
    privacy:'개인정보', help:'도움말', returnDots:'{to} 돌아가기', loading:'연결 요청을 확인하고 있습니다.',
    login:'캐릭터를 소유할 계정으로 로그인하세요.', consent:'{at} 시작한 요청인지 확인해 주세요.',
    accountChoice:'이 계정으로 연결할까요?', continueAccount:'이 계정으로 계속', switchAccount:'다른 계정 사용', switchingAccount:'다른 계정으로 로그인할 준비를 하고 있습니다.',
    noRequest:'{at} ODDBOUT 연결을 시작해 주세요.', failed:'요청이 만료되었거나 연결할 수 없습니다. {at} 다시 시도해 주세요.',
    unsafe:'지원하는 연결 요청이 아닙니다. 권한을 승인하지 않았습니다.', googleAccount:'ODDBOUT 계정', connecting:'Google 로그인으로 이동합니다.', approving:'연결을 마무리하고 있습니다.',
    emailOption:'이메일 계정으로 로그인', emailLabel:'이메일', passwordLabel:'비밀번호', emailSignIn:'로그인', emailConnecting:'로그인하고 있습니다.', emailFailed:'이메일 또는 비밀번호를 확인해 주세요.',
    localWarning:'승인하면 이 컴퓨터에서 실행 중인 앱(터미널·편집기의 에이전트나 Claude 데스크톱 앱)이 연결을 받습니다. 방금 직접 연결을 시작했을 때만 승인하세요.', returnLocal:'연결 안내 보기'
  },
  en: {
    title:'ODDBOUT · Connect to {name}', headline1:'Your fighter.', headline2:'Into the ring.',
    lead:'Connect with Google to register\nyour fighter from {name}.',
    stepConnect:'CONNECT ACCOUNT', stepConsent:'REVIEW ACCESS', panelTitle:'Choose your account', consentTitle:'Connect to {name}?', errorTitle:'Start a new connection',
    google:'Continue with Google', permissions:'Access you allow', permission1:'Read your basic profile and email', permission2:'View your fighters and registration status', permission3:'Upload, register and delete fighters you request',
    permissionNote:'No access to generation subscriptions or payments.', approve:'Approve connection', cancel:'Cancel', loginNote:'No PC setup required.',
    privacy:'Privacy', help:'Help', returnDots:'Return to {name}', loading:'Checking your connection request.',
    login:'Use the account that will own your fighter.', consent:'Confirm that you started this request in {name}.',
    accountChoice:'Connect with this account?', continueAccount:'Continue with this account', switchAccount:'Use another account', switchingAccount:'Preparing sign-in with another account.',
    noRequest:'Start the ODDBOUT connection from {name}.', failed:'This request expired or could not be completed. Start again from {name}.',
    unsafe:'This connection request is not supported. No access was approved.', googleAccount:'ODDBOUT account', connecting:'Opening Google sign-in.', approving:'Completing your connection.',
    emailOption:'Sign in with an email account', emailLabel:'Email', passwordLabel:'Password', emailSignIn:'Sign in', emailConnecting:'Signing in.', emailFailed:'Check your email and password and try again.',
    localWarning:'If you approve, an app running on this computer (an agent in your terminal or editor, or the Claude desktop app) receives the connection. Approve only if you just started this connection yourself.', returnLocal:'See how to connect'
  }
};
export async function start({ document = globalThis.document, location = globalThis.location,
  sessionStorage = globalThis.sessionStorage, navigator = globalThis.navigator,
  history = globalThis.history, supabase = globalThis.supabase } = {}) {
  const byId = id => document.getElementById(id);
  let savedLanguage;
  try { savedLanguage = sessionStorage.getItem('oddbout-connect-language'); } catch {}
  let language = connectionLocale(new URLSearchParams(location.search).get('lang'), savedLanguage, navigator.language);
  let mode = 'loading', statusKey = 'loading', accountEmail = null, clientLabel = '', agent = null;
  const render = () => {
    // The return link needs a place to go: an agent not yet known is Dots (where most requests start); the other words stay general.
    const named = agentWords[language][agent ?? 'any'], back = agentWords[language][agent ?? 'dots'];
    const words = Object.fromEntries(Object.entries(copy[language]).map(([key, text]) => [key, fillAgent(text, key === 'returnDots' ? back : named)]));
    // An app on this computer has no page to go back to: the link shows how to connect one.
    if (agent === 'local') words.returnDots = words.returnLocal;
    document.documentElement.lang = language; document.title = words.title;
    document.querySelector('.languages').setAttribute('aria-label', language === 'ko' ? '언어' : 'Language');
    document.querySelector('.connection').setAttribute('aria-label', language === 'ko' ? '계정 연결' : 'Account connection');
    document.querySelector('footer nav').setAttribute('aria-label', language === 'ko' ? '안내' : 'Information');
    for (const element of document.querySelectorAll('[data-copy]')) element.textContent = words[element.dataset.copy];
    for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === language));
    byId('status').textContent = words[statusKey];
    byId('step-number').textContent = mode === 'consent' ? '02' : '01';
    byId('step-label').textContent = words[mode === 'consent' ? 'stepConsent' : 'stepConnect'];
    byId('panel-title').textContent = words[mode === 'consent' ? 'consentTitle' : mode === 'account' ? 'accountChoice' : mode === 'error' ? 'errorTitle' : 'panelTitle'];
    byId('login').hidden = mode !== 'login'; byId('consent').hidden = mode !== 'consent';
    byId('account-choice').hidden = mode !== 'account';
    byId('local-warning').hidden = agent !== 'local';
    byId('existing-account').textContent = accountEmail || '';
    byId('email-login').hidden = mode !== 'login';
    byId('login-note').hidden = mode !== 'login'; byId('retry-link').hidden = mode !== 'error';
    byId('account').textContent = accountEmail || words.googleAccount; byId('client').textContent = clientLabel;
    byId('retry-link').href = AGENTS[agent ?? 'dots'].home;
    byId('privacy-link').href = '/cloud-plugin/privacy' + (language === 'ko' ? '.ko' : '') + '.html';
    byId('help-link').href = '/cloud-plugin/support' + (language === 'ko' ? '.ko' : '') + '.html';
    document.querySelector('.brand').href = '/?lang=' + language;
  };
  const state = (nextMode, nextStatus) => { mode = nextMode; statusKey = nextStatus; render(); };
  for (const button of document.querySelectorAll('[data-lang]')) button.onclick = () => {
    language = button.dataset.lang;
    try { sessionStorage.setItem('oddbout-connect-language', language); } catch {}
    const current = new URL(location.href); current.searchParams.set('lang', language);
    history.replaceState(null, '', current.pathname + current.search + current.hash);
    render();
  };
  render();
  const key = 'oddbout-authorization-id', id = authorizationId(location.search, sessionStorage.getItem(key));
  if (!id) { state('error', 'noRequest'); return; }
  sessionStorage.setItem(key, id);
  const agentKey = 'oddbout-connect-agent';
  try { const [savedId, savedAgent] = String(sessionStorage.getItem(agentKey) ?? '').split(' '); if (savedId === id && Object.hasOwn(AGENTS, savedAgent)) { agent = savedAgent; render(); } } catch {}
  const learn = value => { agent = agentOf(value) ?? agent; try { if (agent) sessionStorage.setItem(agentKey, `${id} ${agent}`); } catch {} };
  const auth = supabase.createClient('https://ztfxxhtmtrvxvuxlqmgz.supabase.co',
    'sb_publishable_6UkV7tRAQ1P4qss5cTYSwQ_kVxSIv_V', { auth: { flowType: 'pkce', storage: sessionStorage,
      storageKey: 'oddbout-cloud-consent', detectSessionInUrl: true, persistSession: true } }).auth;
  const go = value => {
    if (!safeClientRedirect(value)) throw new Error('unsafe-redirect');
    sessionStorage.removeItem(key); location.replace(value);
  };
  const fail = () => state('error', 'failed');
  const { data: { session }, error } = await auth.getSession();
  history.replaceState(null, '', '/connect.html?authorization_id=' + encodeURIComponent(id) + '&lang=' + language);
  if (error) { fail(); return; }
    byId('login').onclick = async () => {
      byId('login').disabled = true; statusKey = 'connecting'; render();
      const { error } = await auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo: location.origin + '/connect.html?authorization_id=' + encodeURIComponent(id) + '&lang=' + language, queryParams: { prompt: 'select_account' } } });
      if (error) { fail(); byId('login').disabled = false; }
    };
    byId('email-form').onsubmit = async event => {
      event.preventDefault();
      byId('email-submit').disabled = byId('login').disabled = true;
      statusKey = 'emailConnecting'; render();
      try {
        const result = await auth.signInWithPassword({ email: byId('email-address').value.trim(), password: byId('email-password').value });
        byId('email-password').value = '';
        if (result.error || !result.data.session || result.data.session.user.is_anonymous) { state('login', 'emailFailed'); return; }
        await showConsent(result.data.session);
      } catch { state('login', 'emailFailed'); }
      finally { byId('email-password').value = ''; byId('email-submit').disabled = byId('login').disabled = false; }
    };
  byId('switch-account').onclick = async () => {
    byId('switch-account').disabled = byId('continue-account').disabled = true;
    statusKey = 'switchingAccount'; render();
    try {
      const result = await auth.signOut({ scope: 'local' });
      if (result.error) { fail(); return; }
      accountEmail = null; clientLabel = '';
      byId('email-address').value = byId('email-password').value = '';
      byId('email-login').open = false;
      state('login', 'login');
    } catch { fail(); }
    finally { byId('switch-account').disabled = byId('continue-account').disabled = false; }
  };
  if (!session || session.user.is_anonymous) { state('login', 'login'); return; }
  // An existing grant may immediately return a callback from getAuthorizationDetails.
  // Ask which account to use before that call, so "connect another account" never silently reuses it.
  accountEmail = session.user.email;
  state('account', 'login');
  byId('continue-account').onclick = async () => {
    byId('switch-account').disabled = byId('continue-account').disabled = true;
    try { await showConsent(session); }
    catch { fail(); }
    finally { byId('switch-account').disabled = byId('continue-account').disabled = false; }
  };
  async function showConsent(session) {
  const details = await auth.oauth.getAuthorizationDetails(id);
  if (details.error || !details.data) { fail(); return; }
  if (details.data.redirect_url) { go(details.data.redirect_url); return; }
  if (!safeClientRedirect(details.data.redirect_uri)) { state('error', 'unsafe'); return; }
  learn(details.data.redirect_uri);
  accountEmail = session.user.email;
  // The host the approval goes to; for an app on this computer its port too, the one thing that tells two local apps apart, and for the
  // Claude desktop app its scheme, so `claude://claude.ai` does not read as Claude's website.
  const back = new URL(details.data.redirect_uri);
  clientLabel = (details.data.client.name ?? agentWords.en[agent].name) + ' · '
    + (agent !== 'local' ? back.hostname : back.protocol === 'http:' ? back.host : `${back.protocol}//${back.host}`);
  state('consent', 'consent');
  for (const action of ['approve', 'deny']) byId(action).onclick = async () => {
    byId('approve').disabled = byId('deny').disabled = true; statusKey = 'approving'; render();
    try {
      const result = await auth.oauth[action === 'approve' ? 'approveAuthorization' : 'denyAuthorization'](id, { skipBrowserRedirect: true });
      if (result.error || !result.data?.redirect_url) throw new Error('consent-failed');
      go(result.data.redirect_url);
    } catch { fail(); byId('approve').disabled = byId('deny').disabled = false; }
  };
  }
}
if (typeof document !== 'undefined') start().catch(() => {
  const words = copy[document.documentElement.lang === 'ko' ? 'ko' : 'en'];
  document.getElementById('status').textContent = words.failed;
  document.getElementById('retry-link').hidden = false;
});
