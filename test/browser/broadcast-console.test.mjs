import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createBroadcastDemo } from '../../scripts/broadcast-demo.mjs';

// Explicit opt-in: node --test test/browser/broadcast-console.test.mjs
// Requires installed Chrome (or ODDBOUT_TEST_BROWSER_CHANNEL). No real accounts/payments.
test('real browser: disabled integration, cross-tab payment fencing, rejection recovery and sign-out privacy', { timeout: 60_000 }, async t => {
  const { server } = createBroadcastDemo({ ODDBOUT_BROADCAST_PORT: '5189' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5189, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ channel: process.env.ODDBOUT_TEST_BROWSER_CHANNEL ?? 'chrome', headless: true });
  t.after(() => browser.close());
  const errors = [], origin = 'http://127.0.0.1:5189', id = '11111111-1111-4111-8111-111111111111';
  const preview = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await preview.goto(origin + '/broadcast/');
  await preview.getByText('No balances or successful operations are simulated.').waitFor();
  for (const selector of ['#topup-form button', '#host-cup', '#stop']) assert.equal(await preview.locator(selector).isDisabled(), true);
  assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await preview.close();

  const context = await browser.newContext();
  let commerceEnabled = true, paypalConfigured = false;
  await context.route('**/broadcast/config', route => route.fulfill({ json: { commerceEnabled, authConfigured: true, supabaseUrl: 'https://isolated.example', publishableKey: 'test-public' } }));
  await context.route('**/commerce/catalog', async route => {
    const data = await (await route.fetch()).json(); data.catalog.paypalConfigured = paypalConfigured;
    await route.fulfill({ json: data });
  });
  await context.route('**/broadcast/supabase.js', route => route.fulfill({ contentType: 'text/javascript', body:
    `globalThis.supabase={createClient(){let cb;const value={access_token:'fixture-token',user:{id:'${id}'}};globalThis.__fixtureSignIn=()=>cb('SIGNED_IN',value);return {auth:{onAuthStateChange(fn){cb=fn;queueMicrotask(()=>cb('SIGNED_IN',value));},async getSession(){return {data:{session:value}};},async signOut(){cb('SIGNED_OUT',null);return {error:null};}}};}};` }));
  let spendingBlocked = false;
  await context.route('**/commerce/wallet', route => route.fulfill({ json: { ok: true, data: { balanceCredits: 1000, availableCredits: 1000, reservedCredits: 0, spendingBlocked } } }));
  await context.route('**/commerce/broadcasts/*/report', route => route.fulfill({ json: { ok: true, data: { broadcast: { id } } } }));
  await context.route('**/commerce/broadcasts/*/jobs', route => route.fulfill({ json: { ok: true, data: [] } }));
  const tab1 = await context.newPage(), tab2 = await context.newPage();
  for (const page of [tab1, tab2]) page.on('pageerror', error => errors.push(error.message));
  await tab1.goto(origin + '/broadcast/'); await tab1.locator('#signout').waitFor({ state: 'visible' });
  assert.equal(await tab1.locator('#topup-form button').isDisabled(), true);
  assert.match(await tab1.locator('#configuration-status').textContent(), /PayPal Sandbox is not configured/);
  commerceEnabled = false; await tab1.reload(); await tab1.locator('#signout').waitFor({ state: 'visible' });
  assert.equal(await tab1.locator('#host-cup').isDisabled(), true);
  assert.match(await tab1.locator('#configuration-status').textContent(), /Commerce is disabled/);
  commerceEnabled = true; paypalConfigured = true;
  await Promise.all([tab1.reload(), tab2.goto(origin + '/broadcast/')]);
  for (const page of [tab1, tab2]) { await page.locator('#signout').waitFor({ state: 'visible' }); await page.locator('#broadcastId').fill(id); }

  let release, requested; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { requested = resolve; });
  const calls = [];
  await context.route('**/commerce/cups', async route => {
    calls.push(route.request().postDataJSON()); requested(); await gate;
    await route.fulfill({ json: { ok: true, data: { id: 'acknowledged-job' } } });
  });
  await tab1.locator('#host-cup').click(); await started;
  await tab2.locator('#host-cup').click(); await tab2.getByText(/Another tab is processing/).waitFor();
  assert.equal(calls.length, 1);
  release(); await tab1.getByText(/acknowledged-job/).waitFor();
  await context.unroute('**/commerce/cups');

  const rejected = [];
  await context.route('**/commerce/cups', route => {
    rejected.push(route.request().postDataJSON());
    return route.fulfill({ status: 422, json: { ok: false, code: 'invalid-fighters' } });
  });
  await tab1.locator('#fighterIds').fill('bad,yume,bravow,beotim');
  await tab1.locator('#host-cup').click(); await tab1.getByText('invalid-fighters', { exact: true }).waitFor();
  await tab1.locator('#fighterIds').fill('kuma,yume,bravow,beotim');
  await tab1.locator('#host-cup').click();
  await tab1.waitForFunction(() => !document.getElementById('host-cup').disabled);
  assert.equal(rejected.length, 2); assert.notEqual(rejected[0].requestKey, rejected[1].requestKey);
  await context.unroute('**/commerce/cups');

  const retry = [];
  await context.route('**/commerce/cups', route => { retry.push(route.request().postDataJSON()); return route.abort('failed'); });
  await tab1.locator('#host-cup').click(); await tab1.getByText('Failed to fetch', { exact: true }).waitFor();
  await tab1.reload(); await tab1.locator('#signout').waitFor({ state: 'visible' });
  await tab1.locator('#host-cup').click(); await tab1.getByText('Failed to fetch', { exact: true }).waitFor();
  assert.deepEqual(retry[0], retry[1]);
  // A later auth failure cannot prove that the earlier lost response did not commit.
  await context.unroute('**/commerce/cups');
  await context.route('**/commerce/cups', route => {
    retry.push(route.request().postDataJSON());
    return route.fulfill({ status: 401, json: { ok: false, code: 'authentication-required' } });
  });
  await tab1.locator('#host-cup').click(); await tab1.getByText('authentication-required', { exact: true }).waitFor();
  await context.unroute('**/commerce/cups');
  await context.route('**/commerce/cups', route => { retry.push(route.request().postDataJSON()); return route.abort('failed'); });
  await tab1.reload(); await tab1.locator('#signout').waitFor({ state: 'visible' });
  await tab1.locator('#host-cup').click(); await tab1.getByText('Failed to fetch', { exact: true }).waitFor();
  assert.equal(retry.length, 4);
  assert.deepEqual(retry[3], retry[0], 'an auth refusal on recovery must not replace a possibly committed request key');
  const persisted = await tab1.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.equal(persisted.includes('fixture-token'), false);
  await context.unroute('**/commerce/wallet');
  let releaseOldWallet, walletStarted, heldWallet = false;
  const oldWalletGate = new Promise(resolve => { releaseOldWallet = resolve; });
  const firstWallet = new Promise(resolve => { walletStarted = resolve; });
  await context.route('**/commerce/wallet', async route => {
    if (!heldWallet) {
      heldWallet = true; walletStarted(); await oldWalletGate;
      return route.fulfill({ headers: { 'x-test-wallet': 'stale' }, json: { ok: true, data: { balanceCredits: 111, availableCredits: 111, reservedCredits: 0, spendingBlocked: false } } });
    }
    return route.fulfill({ json: { ok: true, data: { balanceCredits: 1000, availableCredits: 1000, reservedCredits: 0, spendingBlocked } } });
  });
  await tab1.locator('#refresh').click(); await firstWallet;
  await tab1.locator('#signout').click(); await tab1.locator('#signout').waitFor({ state: 'hidden' });
  await tab1.evaluate(() => globalThis.__fixtureSignIn());
  await tab1.locator('#available').filter({ hasText: '1,000' }).waitFor();
  const oldResponse = tab1.waitForResponse(response => response.headers()['x-test-wallet'] === 'stale');
  releaseOldWallet(); await (await oldResponse).finished();
  await tab1.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await tab1.locator('#available').textContent(), '1,000', 'a response from before logout cannot overwrite the new login');
  await context.unroute('**/commerce/broadcasts/*/report');
  let releaseOldReport, reportStarted;
  const oldReportGate = new Promise(resolve => { releaseOldReport = resolve; });
  const firstReport = new Promise(resolve => { reportStarted = resolve; });
  const otherSession = '22222222-2222-4222-8222-222222222222';
  await context.route('**/commerce/broadcasts/*/report', async route => {
    const reportId = new URL(route.request().url()).pathname.split('/').at(-2);
    if (reportId === id) { reportStarted(); await oldReportGate; }
    return route.fulfill({ headers: { 'x-test-report': reportId }, json: { ok: true, data: { broadcast: { id: reportId } } } });
  });
  await tab1.locator('#broadcastId').fill(id);
  await tab1.locator('#refresh').click(); await firstReport;
  await tab1.locator('#broadcastId').fill(otherSession);
  const oldReportResponse = tab1.waitForResponse(response => response.headers()['x-test-report'] === id);
  releaseOldReport(); await (await oldReportResponse).finished();
  await tab1.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await tab1.locator('#report').textContent(), 'Refresh to load the selected session.');
  await tab1.locator('#refresh').click(); await tab1.locator('#report').filter({ hasText: otherSession }).waitFor();
  spendingBlocked = true;
  await tab1.locator('#refresh').click(); await tab1.getByText(/Spending is frozen/).waitFor();
  for (const selector of ['#topup-form button', '#budget-form button', '#broadcast-form button', '#host-cup']) assert.equal(await tab1.locator(selector).isDisabled(), true);
  assert.equal(await tab1.locator('#stop').isDisabled(), false);
  assert.equal(await tab1.locator('#available').textContent(), 'Blocked');
  await tab1.locator('#signout').click(); await tab1.locator('#signout').waitFor({ state: 'hidden' });
  assert.equal(await tab1.locator('#available').textContent(), '—');
  assert.equal(await tab1.locator('#status').textContent(), 'Signed out.');
  assert.deepEqual(errors, []);
});
