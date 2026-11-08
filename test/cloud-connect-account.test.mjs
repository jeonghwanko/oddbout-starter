import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, copy, agentOf, fillAgent, agentWords } from '../web/cloud-connect/connect.mjs';

function harness({
  session = { user: { email: 'review@example.test', is_anonymous: false } },
  language = 'en',
  signOutError = null,
  details = { redirect_url: 'https://chatgpt.com/connector_platform/oauth/callback' },
  approved = null,
  denied = null,
} = {}) {
  const elements = new Map(),
    calls = [],
    redirects = [],
    values = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, value: '', textContent: '', setAttribute() {} });
    return elements.get(id);
  };
  const id = 'review-authorization-123456';
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    signOut: async options => {
      calls.push(['signOut', options]);
      return { error: signOutError };
    },
    signInWithOAuth: async options => {
      calls.push(['google', options]);
      return { error: null };
    },
    signInWithPassword: async () => ({ data: { session: { user: { email: 'owner@example.test', is_anonymous: false } } }, error: null }),
    oauth: {
      getAuthorizationDetails: async requestId => {
        calls.push(['details', requestId]);
        return { data: details, error: null };
      },
      approveAuthorization: async () => ({ data: { redirect_url: approved }, error: null }),
      denyAuthorization: async () => ({ data: { redirect_url: denied }, error: null }),
    },
  };
  const env = {
    document: { documentElement: {}, getElementById: element, querySelector: element, querySelectorAll: () => [] },
    location: {
      search: `?authorization_id=${id}&lang=${language}`,
      href: `https://oddbout.com/connect.html?authorization_id=${id}&lang=${language}`,
      origin: 'https://oddbout.com',
      replace: value => redirects.push(value),
    },
    sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigator: { language },
    history: { replaceState() {} },
    supabase: { createClient: () => ({ auth }) },
  };
  return { env, element, calls, redirects, values, id };
}

test('a saved account cannot silently reuse a prior OAuth grant before the user chooses it', async () => {
  const h = harness();
  await start(h.env);
  assert.equal(h.element('account-choice').hidden, false);
  assert.equal(h.element('existing-account').textContent, 'review@example.test');
  assert.equal(h.element('panel-title').textContent, copy.en.accountChoice);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.redirects, []);
  await h.element('continue-account').onclick();
  assert.deepEqual(h.calls, [['details', h.id]]);
  assert.deepEqual(h.redirects, ['https://chatgpt.com/connector_platform/oauth/callback']);
  assert.equal(h.values.has('oddbout-authorization-id'), false);
});

test('switching account signs out only the local session and preserves the pending authorization', async () => {
  const h = harness({ language: 'ko' });
  await start(h.env);
  assert.equal(h.element('panel-title').textContent, copy.ko.accountChoice);
  h.element('email-address').value = 'review@example.test';
  h.element('email-password').value = 'test-only';
  await h.element('switch-account').onclick();
  assert.deepEqual(h.calls, [['signOut', { scope: 'local' }]]);
  assert.equal(h.values.get('oddbout-authorization-id'), h.id);
  assert.equal(h.element('login').hidden, false);
  assert.equal(h.element('account-choice').hidden, true);
  assert.equal(h.element('email-address').value, '');
  assert.equal(h.element('email-password').value, '');
  await h.element('login').onclick();
  const options = h.calls[1][1].options;
  assert.equal(options.queryParams.prompt, 'select_account');
  assert.equal(new URL(options.redirectTo).searchParams.get('authorization_id'), h.id);
  assert.deepEqual(h.redirects, []);
});

test('a failed local sign-out cannot approve the old account or proceed as if it changed', async () => {
  const h = harness({ signOutError: new Error('test failure') });
  await start(h.env);
  await h.element('switch-account').onclick();
  assert.equal(h.element('login').hidden, true);
  assert.equal(h.element('retry-link').hidden, false);
  assert.equal(h.values.get('oddbout-authorization-id'), h.id);
  assert.equal(
    h.calls.some(c => c[0] === 'details'),
    false,
  );
  assert.deepEqual(h.redirects, []);
});

test('fresh email login still resolves consent for the explicitly chosen new account', async () => {
  const h = harness({ session: null });
  await start(h.env);
  assert.equal(h.element('login').hidden, false);
  h.element('email-address').value = 'owner@example.test';
  h.element('email-password').value = 'test-only';
  await h.element('email-form').onsubmit({ preventDefault() {} });
  assert.deepEqual(h.calls, [['details', h.id]]);
  assert.equal(h.element('email-password').value, '');
  assert.equal(h.redirects.length, 1);
});

test('each agent comes back only to its own callback addresses', () => {
  assert.equal(agentOf('https://chatgpt.com/connector_platform/oauth/callback'), 'dots');
  assert.equal(agentOf('https://chat.openai.com/aip/oauth/callback?code=x'), 'dots');
  assert.equal(agentOf('https://grok.com/connectors-oauth-exchange-code/?code=x&state=y'), 'grok');
  assert.equal(agentOf('https://www.cursor.com/agents/mcp/oauth/callback'), 'grok');
  assert.equal(agentOf('https://www.cursor.com/bot/mcp/oauth/callback?code=x'), 'grok');
  // Claude's custom connectors (2026-10-28): Anthropic's MCP callback on claude.ai and claude.com, nothing else there.
  assert.equal(agentOf('https://claude.ai/api/mcp/auth_callback?code=x&state=y'), 'claude');
  assert.equal(agentOf('https://claude.com/api/mcp/auth_callback'), 'claude');
  for (const refused of [
    'https://grok.com/',
    'https://grok.com/connectors-oauth-exchange-code-evil',
    'http://grok.com/connectors-oauth-exchange-code/',
    'https://www.cursor.com/settings',
    'https://cursor.com/agents/mcp/oauth/callback',
    'https://grok.com:8443/connectors-oauth-exchange-code/',
    'https://user@grok.com/connectors-oauth-exchange-code/',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'not a url',
    'https://claude.ai/',
    'https://claude.ai/settings/connectors',
    'https://claude.ai/api/mcp/auth_callback-evil',
    'http://claude.ai/api/mcp/auth_callback',
    'https://www.claude.ai/api/mcp/auth_callback',
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callback/x',
    'https://claude.ai/api/mcp/auth_callback/..%2f..%2fx',
    'https://claude.com/api/mcp/auth_callback/',
  ])
    assert.equal(agentOf(refused), null, refused);
});

// An app on this computer (2026-10-29): Claude Code, Codex and Gemini CLI register a loopback callback on a port of their own. Only the loopback
// literals and localhost over http, any port and path; a look-alike host, credentials, another 127/8 address, https or an app scheme are refused.
// One app scheme is the exception (2026-11-06): the Claude desktop app's /mcp sign-in comes back on claude://claude.ai/mcp-auth-callback/sdk,
// that address character for character, alone or with its query; any other path, host, port, case, fragment or spelling is refused.
test('an app on this computer comes back on a loopback callback, nowhere else', () => {
  for (const local of [
    'http://127.0.0.1:52381/callback',
    'http://127.0.0.1:52381/callback/b7f1c0de?code=x&state=y',
    'http://localhost:7777/oauth/callback',
    'http://localhost:3118/callback',
    'http://[::1]:8080/cb',
    'http://127.0.0.1/callback',
    'http://LOCALHOST:7777/oauth/callback',
    'claude://claude.ai/mcp-auth-callback/sdk',
    'claude://claude.ai/mcp-auth-callback/sdk?code=abc&state=xyz',
  ])
    assert.equal(agentOf(local), 'local', local);
  for (const refused of [
    'http://127.0.0.1.evil.example:7777/callback',
    'http://localhost.evil.example/callback',
    'http://user@127.0.0.1:7777/callback',
    'http://user:pass@localhost:7777/callback',
    'http://127.0.0.2:7777/callback',
    'http://0.0.0.0:7777/callback',
    'http://192.168.0.10:7777/callback',
    'https://localhost:7777/callback',
    'http://localhost.:7777/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://callback',
    'javascript://localhost/%0aalert(1)',
    'file://localhost/etc/passwd',
    'claude://claude.ai/mcp-auth-callback/sdk/',
    'claude://claude.ai/mcp-auth-callback/sdkx',
    'claude://claude.ai/mcp-auth-callback',
    'claude://claude.ai/mcp-auth-callback/sdk/x',
    'claude://evil.example/mcp-auth-callback/sdk',
    'claude://user@claude.ai/mcp-auth-callback/sdk',
    'claude://claude.ai:443/mcp-auth-callback/sdk',
    'claude://claude.ai/mcp-auth-callback/sdk#x',
    'claude://claude.ai/mcp-auth-callback/sdk?code=a#x',
    'claude:claude.ai/mcp-auth-callback/sdk',
    'claude://Claude.ai/mcp-auth-callback/sdk',
    'CLAUDE://claude.ai/mcp-auth-callback/sdk',
    'claude://claude.ai/mcp-auth-callback/./sdk',
    'claude://claude.ai/mcp-auth-callback/x/../sdk',
    ' claude://claude.ai/mcp-auth-callback/sdk',
    'claude://claude.ai/api/mcp/auth_callback',
  ])
    assert.equal(agentOf(refused), null, refused);
});

test('a local app is consented as an app on this computer, with its host and port, a warning, and its approval goes back to it', async () => {
  const h = harness({
    language: 'ko',
    details: { redirect_uri: 'http://localhost:7777/oauth/callback', client: { name: 'Gemini CLI MCP Client' } },
    approved: 'http://localhost:7777/oauth/callback?code=abc&state=xyz',
  });
  await start(h.env);
  assert.equal(h.element('local-warning').hidden, true);
  await h.element('continue-account').onclick();
  assert.equal(h.element('consent').hidden, false);
  assert.equal(h.element('panel-title').textContent, '이 컴퓨터의 앱에 연결할까요?');
  // The name is the client's own claim; the host and port are where the code goes.
  assert.equal(h.element('client').textContent, 'Gemini CLI MCP Client · localhost:7777');
  assert.equal(h.element('local-warning').hidden, false);
  assert.equal(h.element('retry-link').href, 'https://oddbout.com/creator.html#view=agents');
  await h.element('approve').onclick();
  assert.deepEqual(h.redirects, ['http://localhost:7777/oauth/callback?code=abc&state=xyz']);
});

// The Claude desktop app (2026-11-06): consented as an app on this computer, named with its scheme so it does not read as claude.ai, warned,
// and its approval goes back to the app's own address.
test('the Claude desktop app is consented as an app on this computer and its approval goes back to the app', async () => {
  const h = harness({
    language: 'ko',
    details: { redirect_uri: 'claude://claude.ai/mcp-auth-callback/sdk', client: { name: 'Claude' } },
    approved: 'claude://claude.ai/mcp-auth-callback/sdk?code=abc&state=xyz',
  });
  await start(h.env);
  await h.element('continue-account').onclick();
  assert.equal(h.element('consent').hidden, false);
  assert.equal(h.element('panel-title').textContent, '이 컴퓨터의 앱에 연결할까요?');
  assert.equal(h.element('client').textContent, 'Claude · claude://claude.ai');
  assert.equal(h.element('local-warning').hidden, false);
  assert.match(copy.ko.localWarning, /Claude 데스크톱 앱/);
  assert.match(copy.en.localWarning, /Claude desktop app/);
  assert.equal(h.element('eyebrow').textContent, 'ODDBOUT');
  await h.element('approve').onclick();
  assert.deepEqual(h.redirects, ['claude://claude.ai/mcp-auth-callback/sdk?code=abc&state=xyz']);
  // The app scheme leaves this page where it was (2026-11-06: it stayed on "completing" with a disabled button): it says the app has it.
  assert.equal(h.element('consent').hidden, true);
  assert.equal(h.element('panel-title').textContent, '이 컴퓨터의 앱으로 연결을 넘겼습니다');
  assert.equal(h.element('status').textContent, copy.ko.handedOff);
  assert.equal(h.element('step-number').textContent, '02');
  assert.deepEqual([h.element('open-app').hidden, h.element('open-app').href], [false, 'claude://claude.ai/mcp-auth-callback/sdk?code=abc&state=xyz']);
});

test('a cancelled app request says so and offers no app link', async () => {
  const h = harness({
    language: 'en',
    details: { redirect_uri: 'claude://claude.ai/mcp-auth-callback/sdk', client: { name: 'Claude' } },
    denied: 'claude://claude.ai/mcp-auth-callback/sdk?error=access_denied&state=xyz',
  });
  await start(h.env);
  await h.element('continue-account').onclick();
  await h.element('deny').onclick();
  assert.deepEqual(h.redirects, ['claude://claude.ai/mcp-auth-callback/sdk?error=access_denied&state=xyz']);
  assert.equal(h.element('panel-title').textContent, 'Handed off to an app on this computer');
  assert.equal(h.element('status').textContent, copy.en.deniedHandedOff);
  assert.equal(h.element('open-app').hidden, true);
});

test('a loopback approval leaves the page to its callback, with no hand-off state', async () => {
  const h = harness({
    details: { redirect_uri: 'http://127.0.0.1:52381/callback', client: { name: 'Codex' } },
    approved: 'http://127.0.0.1:52381/callback?code=abc&state=xyz',
  });
  await start(h.env);
  await h.element('continue-account').onclick();
  await h.element('approve').onclick();
  assert.deepEqual(h.redirects, ['http://127.0.0.1:52381/callback?code=abc&state=xyz']);
  assert.equal(h.element('consent').hidden, false);
  assert.equal(h.element('open-app').hidden, true);
});

test('a web agent shows no local warning', async () => {
  const h = harness({ details: { redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client: { name: 'Claude' } } });
  await start(h.env);
  await h.element('continue-account').onclick();
  assert.equal(h.element('consent').hidden, false);
  assert.equal(h.element('local-warning').hidden, true);
  assert.equal(h.element('client').textContent, 'Claude · claude.ai');
  // The page names the web agent it serves (it said DOTS × ODDBOUT for every agent until 2026-11-06).
  assert.equal(h.element('eyebrow').textContent, 'CLAUDE × ODDBOUT');
  // Claude keeps its connectors under Customize (2026-10-29); settings/connectors only says they moved.
  assert.equal(h.element('retry-link').href, 'https://claude.ai/customize/connectors');
});

test('the copy names the agent with the particles its sound takes', () => {
  assert.equal(fillAgent(copy.ko.consentTitle, agentWords.ko.grok), 'Grok에 연결할까요?');
  assert.equal(fillAgent(copy.ko.returnDots, agentWords.ko.grok), 'Grok으로 돌아가기');
  assert.equal(fillAgent(copy.ko.returnDots, agentWords.ko.dots), 'Dots로 돌아가기');
  assert.equal(fillAgent(copy.ko.consentTitle, agentWords.ko.claude), 'Claude에 연결할까요?');
  assert.equal(fillAgent(copy.ko.returnDots, agentWords.ko.claude), 'Claude로 돌아가기');
  assert.equal(fillAgent(copy.en.consentTitle, agentWords.en.any), 'Connect to your agent?');
  assert.equal(fillAgent(copy.ko.consentTitle, agentWords.ko.local), '이 컴퓨터의 앱에 연결할까요?');
  assert.equal(fillAgent(copy.en.consentTitle, agentWords.en.local), 'Connect to an app on this computer?');
  for (const language of ['ko', 'en'])
    for (const text of Object.values(copy[language])) {
      for (const words of Object.values(agentWords[language])) assert.doesNotMatch(fillAgent(text, words), /[{}]/);
    }
});

test('a Grok request is consented as Grok, returns to Grok, and its approval goes back to Grok', async () => {
  const h = harness({
    language: 'ko',
    details: { redirect_uri: 'https://grok.com/connectors-oauth-exchange-code/', client: { name: 'Grok' } },
    approved: 'https://grok.com/connectors-oauth-exchange-code/?code=abc&state=xyz',
  });
  await start(h.env);
  await h.element('continue-account').onclick();
  assert.equal(h.element('consent').hidden, false);
  assert.equal(h.element('panel-title').textContent, 'Grok에 연결할까요?');
  assert.equal(h.element('client').textContent, 'Grok · grok.com');
  assert.equal(h.element('retry-link').href, 'https://grok.com/connectors');
  assert.equal(h.values.get('oddbout-connect-agent'), `${h.id} grok`);
  await h.element('approve').onclick();
  assert.deepEqual(h.redirects, ['https://grok.com/connectors-oauth-exchange-code/?code=abc&state=xyz']);
});

test('an unknown agent is refused and approves nothing', async () => {
  const h = harness({ details: { redirect_uri: 'https://evil.example/callback', client: { name: 'Grok' } } });
  await start(h.env);
  await h.element('continue-account').onclick();
  assert.equal(h.element('consent').hidden, true);
  assert.equal(h.element('status').textContent, copy.en.unsafe);
  assert.deepEqual(h.redirects, []);
});
