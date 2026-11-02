import { createOperationJournal, isConfirmedRejection } from './operations.mjs';
const $ = id => document.getElementById(id);
let client, session, catalog, journal, config;
let walletSpendingBlocked = false;
let refreshRevision = 0;
const busyActions = new Set();
const budgetErrors = {
  'invalid-channel': 'Use 1–64 letters, numbers, spaces, hyphens or underscores for the session name.',
  'invalid-budget': 'Set a credit limit between 25 and 1,000,000.',
  'invalid-end-time': 'Choose a time limit from 1 to 24 hours and review again.',
  'invalid-fighters': 'Choose 4–9 different fighters from the available lineup.',
  'unknown-host': 'Choose a configured broadcast host.',
};
function budgetFeedback(message, error = false) {
  $('budget-feedback').textContent = message;
  $('budget-feedback').classList.toggle('is-error', error);
}
const show = value => {
  $('status').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  $('activity-summary').textContent = typeof value === 'string' ? value
    : value.status === 'credited' ? 'Top-up complete. Your credits are ready.'
    : value.approved ? 'Budget approved. You can start your rehearsal.'
    : 'Session updated. View the details below.';
};
async function call(path, body) {
  if (!session) throw new Error('Sign in to your ODDBOUT account first.');
  const owner = session.user.id, accountScope = journal;
  const response = await fetch('/commerce/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + session.access_token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (session?.user.id !== owner || journal !== accountScope) throw new Error('Account changed. Sign in to the original account to recover the request.');
  if (!response.ok || !result.ok) throw Object.assign(new Error(result.code ?? 'Request failed.'), { code: result.code, status: response.status, responseOk: result.ok });
  return result.data;
}
function requireJournal() { if (!session || !journal) throw new Error('Sign in to your ODDBOUT account first.'); return journal; }
function updateControls() {
  $('google-signin').disabled = !client || busyActions.has('google-signin');
  for (const id of ['topup-form', 'budget-form', 'broadcast-form', 'host-cup', 'stop', 'refresh', 'verify-payment']) {
    const disabled = busyActions.has(id) || !session || !config?.commerceEnabled
      || (walletSpendingBlocked && ['topup-form', 'budget-form', 'broadcast-form', 'host-cup'].includes(id))
      || (['topup-form', 'verify-payment'].includes(id) && !catalog?.paypalConfigured);
    for (const button of [...$(id).querySelectorAll('button'), ...($(id).tagName === 'BUTTON' ? [$(id)] : [])]) button.disabled = disabled;
  }
}
async function mutate(saved, name, input, path, extra = {}) {
  const op = saved.begin(name, input);
  // Legacy journal entries without this marker may already have reached the server.
  const previouslyDispatched = op.dispatched !== false;
  saved.markDispatched(name, op.requestKey);
  try { return { op, result: await call(path, { ...op.input, requestKey: op.requestKey, ...extra }) }; }
  catch (error) { if (!previouslyDispatched && isConfirmedRejection(error)) saved.complete(name, op.requestKey); throw error; }
}
function action(id, callback, event = 'click', exclusive = false) {
  $(id).addEventListener(event, async e => {
    e.preventDefault();
    if (busyActions.has(id)) return;
    if (id === 'budget-form') budgetFeedback('');
    busyActions.add(id);
    const buttons = [...$(id).querySelectorAll('button'), ...($(id).tagName === 'BUTTON' ? [$(id)] : [])];
    buttons.forEach(button => button.disabled = true);
    try {
      if (exclusive) {
        const saved = requireJournal();
        await saved.exclusive(async () => {
          if (saved !== journal || !session) throw new Error('Account changed. Sign in to the original account to recover the request.');
          await callback();
        });
      } else await callback();
    } catch (error) {
      const message = id === 'budget-form' ? budgetErrors[error.code] ?? error.message : error.message;
      show(message);
      if (id === 'budget-form') budgetFeedback(message, true);
      if (id === 'google-signin') $('login-status').textContent = error.message;
    }
    finally { busyActions.delete(id); buttons.forEach(button => button.disabled = false); updateControls(); }
  });
}
const fighters = () => $('fighterIds').value.split(',').map(id => id.trim()).filter(Boolean);
const renderHost = () => { $('hosts-readiness').textContent = $('hostId').value + ' · Check OBS on this host before starting.'; };
function renderLineup() {
  const names = { kuma: 'Kuma', yume: 'Yume', bravow: 'Bravow', beotim: 'Beotim' };
  $('fighter-lineup').replaceChildren(...fighters().map(id => {
    const chip = document.createElement('span');
    if (Object.hasOwn(names, id)) {
      const image = document.createElement('img'); image.src = './assets/' + id + '.webp';
      image.alt = ''; image.width = 30; image.height = 30; chip.append(image);
    }
    chip.append(document.createTextNode(Object.hasOwn(names, id) ? names[id] : id)); return chip;
  }));
}
$('fighterIds').addEventListener('input', renderLineup);
function showCheckout(result) {
  $('payment-intent').value = result.intentId;
  const link = $('paypal-approval');
  link.hidden = !result.approvalUrl;
  if (result.approvalUrl) {
    const url = new URL(result.approvalUrl);
    if (url.origin !== 'https://www.sandbox.paypal.com') throw new Error('Invalid approval address.');
    link.href = url.href;
  }
  $('payment-recovery').hidden = false;
  show('Open PayPal in the new tab, approve the order, then return here and verify payment.');
}
async function refresh() {
  const revision = ++refreshRevision, selected = $('broadcastId').value.trim();
  const wallet = await call('wallet');
  if (revision !== refreshRevision) return;
  walletSpendingBlocked = wallet.spendingBlocked === true;
  $('wallet-status').textContent = walletSpendingBlocked ? 'Spending is frozen after a payment adjustment. Stop and report remain available; reconcile the original payment before further spending.' : '';
  for (const [id, field] of [['balance', 'balanceCredits'], ['available', 'availableCredits'], ['reserved', 'reservedCredits']]) $(id).textContent = Number(wallet[field]).toLocaleString();
  if (walletSpendingBlocked) $('available').textContent = 'Blocked';
  if ($('activity-summary').textContent === 'Account connected. Loading your current balance.') {
    show(wallet.balanceCredits > 0 ? 'Ready when you are. Set a budget to begin.' : 'Add credits to set up your first show.');
  }
  updateControls();
  const id = selected;
  if (id) {
    const [report, jobs] = await Promise.all([call('broadcasts/' + encodeURIComponent(id) + '/report'), call('broadcasts/' + encodeURIComponent(id) + '/jobs')]);
    if (revision !== refreshRevision || $('broadcastId').value.trim() !== id) return;
    $('report').textContent = JSON.stringify(report, null, 2);
    $('active-jobs').replaceChildren(...jobs.map(job => {
      const row = document.createElement('p'); row.textContent = job.status + ' · ' + job.priceCredits + ' credits · ' + job.fighterIds.join(' / '); return row;
    }));
  }
}
action('google-signin', async () => {
  if (!client) throw new Error('Account connection is not configured on this development server.');
  $('login-status').textContent = '';
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/broadcast/' } });
  if (error) throw error;
});
action('signout', async () => { const result = await client?.auth.signOut(); if (result?.error) throw result.error; });
action('topup-form', async () => {
  const saved = requireJournal(), { op, result } = await mutate(saved, 'topup', { productId: $('productId').value }, 'checkout');
  if (result.status === 'credited') { saved.complete('topup', op.requestKey); show(result); await refresh(); }
  else { saved.acknowledge('topup', op.requestKey, result); showCheckout(result); }
}, 'submit', true);
action('verify-payment', async () => {
  const saved = requireJournal(), intent = $('payment-intent').value.trim();
  if (!intent) throw new Error('Recover the checkout request first.');
  const result = await call('topups/' + encodeURIComponent(intent) + '/capture', {});
  if (result.status === 'credited') {
    const pending = saved.get('topup');
    if (pending?.result?.intentId === intent) saved.complete('topup', pending.requestKey);
    $('paypal-approval').hidden = true;
  }
  show(result); await refresh();
}, 'click', true);
action('budget-form', async () => {
  const saved = requireJournal(), existing = saved.get('approval');
  const input = { hostId: $('hostId').value, channelId: $('channelId').value.trim(), maxCredits: Number($('maxCredits').value), fighterIds: fighters(),
    endsAt: existing?.input.endsAt ?? new Date(Date.now() + Number($('durationHours').value) * 3600000 - 1000).toISOString() };
  let quote;
  try { quote = await call('quote', input); }
  catch (error) {
    // An expired approval can never authorize another session, even if its old reply was lost.
    if (existing && error.code === 'invalid-end-time' && Date.parse(existing.input.endsAt) <= Date.now()) saved.complete('approval', existing.requestKey);
    throw error;
  }
  budgetFeedback('Budget reviewed: ' + quote.cupCredits + ' credits per cup · Up to ' + quote.maxCups + ' cups. Nothing approved yet.');
  if (!confirm('Approve up to ' + quote.maxCredits + ' Sandbox credits on ' + quote.hostId + ' for ' + quote.channelId + '?\n' + quote.cupCredits + ' credits per completed cup.\nEnds ' + quote.endsAt + '.\nLive streaming has not been verified.')) return;
  const { op, result: approved } = await mutate(saved, 'approval', input, 'approvals', { confirmed: true });
  saved.select('approvalId', approved.id); saved.complete('approval', op.requestKey); $('approvalId').value = approved.id; show({ approved });
  budgetFeedback('Budget approved. You can start your rehearsal.');
}, 'submit', true);
$('budget-form').addEventListener('input', () => budgetFeedback(''));
action('broadcast-form', async () => {
  const saved = requireJournal(), { op, result } = await mutate(saved, 'start', { approvalId: $('approvalId').value.trim() }, 'broadcasts');
  saved.select('broadcastId', result.id); saved.complete('start', op.requestKey); $('broadcastId').value = result.id; show(result); await refresh();
}, 'submit', true);
action('host-cup', async () => {
  const saved = requireJournal(), { op, result } = await mutate(saved, 'cup', { broadcastId: $('broadcastId').value.trim(), fighterIds: fighters().slice(0, 4) }, 'cups');
  saved.complete('cup', op.requestKey); show(result); await refresh();
}, 'click', true);
action('refresh', refresh);
$('broadcastId').addEventListener('input', () => {
  refreshRevision++;
  $('active-jobs').replaceChildren(); $('report').textContent = 'Refresh to load the selected session.';
});
action('stop', async () => { const result = await call('broadcasts/' + encodeURIComponent($('broadcastId').value.trim()) + '/stop', {}); show(result); await refresh(); });
function authChanged(value) {
  const previousOwner = session?.user.id;
  if (previousOwner !== value?.user.id) { refreshRevision++; walletSpendingBlocked = false; $('wallet-status').textContent = ''; budgetFeedback(''); }
  session = value; $('signout').hidden = !value;
  $('google-signin').hidden = Boolean(value);
  $('account-identity').hidden = !value;
  const profileName = value?.user.user_metadata?.full_name;
  const name = typeof profileName === 'string' && profileName.trim() ? profileName : value?.user.email || 'Your account';
  $('account-name').textContent = value ? name : '';
  $('account-avatar').textContent = value ? Array.from(name)[0].toUpperCase() : '';
  $('account-identity').title = value?.user.email ?? '';
  updateControls();
  $('login-status').textContent = '';
  if (previousOwner !== value?.user.id) {
    journal = value ? createOperationJournal(localStorage, value.user.id) : null;
    show(value ? 'Account connected. Loading your current balance.' : 'Signed out.');
    for (const id of ['balance', 'available', 'reserved']) $(id).textContent = '—';
    $('active-jobs').replaceChildren(); $('report').textContent = 'No report loaded.';
    $('approvalId').value = journal?.selected('approvalId') ?? '';
    $('broadcastId').value = journal?.selected('broadcastId') ?? '';
    $('payment-recovery').hidden = true;
    $('payment-intent').value = ''; $('paypal-approval').removeAttribute('href'); $('paypal-approval').hidden = true;
    const pendingTopup = journal?.get('topup');
    if (pendingTopup) $('productId').value = pendingTopup.input.productId;
    if (pendingTopup?.result) showCheckout(pendingTopup.result);
    else if (pendingTopup) show('A checkout request is pending. Continue checkout to recover the same order.');
    const pendingApproval = journal?.get('approval')?.input;
    if (pendingApproval) {
      for (const id of ['hostId', 'channelId', 'maxCredits']) $(id).value = pendingApproval[id];
      $('fighterIds').value = pendingApproval.fighterIds.join(',');
      show('A budget approval is pending. Review budget to recover its original deadline and settings.');
    }
    const pendingStart = journal?.get('start')?.input;
    if (pendingStart) $('approvalId').value = pendingStart.approvalId;
    const pendingCup = journal?.get('cup')?.input;
    if (pendingCup) { $('broadcastId').value = pendingCup.broadcastId; $('fighterIds').value = pendingCup.fighterIds.join(','); show('A cup request is pending. Queue one cup recovers the same request.'); }
  }
  renderLineup();
  renderHost();
  if (value && config?.commerceEnabled) setTimeout(() => refresh().catch(error => show(error.message)), 0);
}
async function initialize() {
  renderLineup();
  config = await fetch('./config').then(r => r.json());
  const result = await fetch('/commerce/catalog').then(r => r.json()); catalog = result.catalog;
  $('productId').replaceChildren(...catalog.products.map(product => new Option(product.name + ' · $' + (product.amountCents / 100).toFixed(2) + ' USD', product.id)));
  $('hostId').replaceChildren(...catalog.hosts.map(host => new Option(host.id, host.id)));
  $('hostId').addEventListener('change', renderHost); renderHost();
  updateControls();
  $('configuration-status').textContent = !config.commerceEnabled
    ? 'Commerce is disabled on this server. This is a preview; payment and broadcast actions are unavailable.'
    : !catalog.paypalConfigured ? 'PayPal Sandbox is not configured. Top-ups are unavailable; existing credits can still be used.'
    : '';
  $('configuration-status').hidden = !$('configuration-status').textContent;
  const query = new URLSearchParams(location.search), intent = query.get('intent');
  if (intent) {
    show(query.get('cancelled') === '1' ? 'PayPal approval cancelled. No credits were added by this return.' : 'Return to your original console tab and choose Verify payment. If it was closed, sign in and recover the same checkout.');
    history.replaceState(null, '', '/broadcast/');
  }
  if (!config.authConfigured) { show('No balances or successful operations are simulated.'); return; }
  client = globalThis.supabase.createClient(config.supabaseUrl, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: true } });
  client.auth.onAuthStateChange((_event, value) => { try { authChanged(value); } catch (error) { show(error.message); } });
  authChanged((await client.auth.getSession()).data.session);
}
initialize().catch(error => show(error.message));
