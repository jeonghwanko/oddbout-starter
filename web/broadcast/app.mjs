import { createOperationJournal, isConfirmedRejection } from './operations.mjs';
const $ = id => document.getElementById(id);
let client, session, catalog, journal, config;
let walletSpendingBlocked = false;
let refreshRevision = 0, pollTimer;
const FIGHTER_NAMES = { kuma: 'Kuma', yume: 'Yume', bravow: 'Bravow', beotim: 'Beotim' };
// The AI producer card is data-driven from the owner-only producer route. Every string it shows may
// come from a model, so it is only ever written with textContent.
const PRODUCER_POLL_MS = 10_000;
const PRODUCER_STATES = { running: 'Running', waiting: 'Waiting for a slot', finished: 'Finished', none: 'Not started' };
const PRODUCER_ACTIONS = { host_cup: 'Queued a cup', wait: 'Waited', stop: 'Stopped the show' };
const PRODUCER_OUTCOMES = { succeeded: 'Cup succeeded', failed: 'Cup failed' };
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
  if (!response.ok || !result.ok) throw Object.assign(new Error(result.code ?? 'Request failed.'), { code: result.code, status: response.status, responseOk: result.ok, outcomeUnknown: result.outcomeUnknown === true });
  return result.data;
}
function requireJournal() { if (!session || !journal) throw new Error('Sign in to your ODDBOUT account first.'); return journal; }
function updateControls() {
  $('google-signin').disabled = !client || busyActions.has('google-signin');
  for (const id of ['topup-form', 'budget-form', 'broadcast-form', 'host-cup', 'stop', 'refresh', 'verify-payment', 'payout-propose']) {
    const disabled = busyActions.has(id) || !session || !config?.commerceEnabled
      || (walletSpendingBlocked && ['topup-form', 'budget-form', 'broadcast-form', 'host-cup'].includes(id))
      || (['topup-form', 'verify-payment'].includes(id) && !catalog?.paypalConfigured);
    for (const button of [...$(id).querySelectorAll('button'), ...($(id).tagName === 'BUTTON' ? [$(id)] : [])]) button.disabled = disabled;
  }
  updateConcierge();
  updateReconcile();
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
      if (id === 'payout-propose') proposeFailed(error);
      if (id === 'google-signin') $('login-status').textContent = error.message;
    }
    finally { busyActions.delete(id); buttons.forEach(button => button.disabled = false); updateControls(); }
  });
}
const fighters = () => $('fighterIds').value.split(',').map(id => id.trim()).filter(Boolean);
const renderHost = () => { $('hosts-readiness').textContent = $('hostId').value + ' · Check OBS on this host before starting.'; };
function renderLineup() {
  $('fighter-lineup').replaceChildren(...fighters().map(id => {
    const chip = document.createElement('span');
    if (Object.hasOwn(FIGHTER_NAMES, id)) {
      const image = document.createElement('img'); image.src = './assets/' + id + '.webp';
      image.alt = ''; image.width = 30; image.height = 30; chip.append(image);
    }
    chip.append(document.createTextNode(Object.hasOwn(FIGHTER_NAMES, id) ? FIGHTER_NAMES[id] : id)); return chip;
  }));
}
$('fighterIds').addEventListener('input', renderLineup);
const PAYPAL_SANDBOX_ORIGIN = 'https://www.sandbox.paypal.com';
/** The normalized PayPal Sandbox approval address, or null for anything else. */
function sandboxApprovalUrl(value) {
  try { const url = new URL(value); return url.origin === PAYPAL_SANDBOX_ORIGIN ? url.href : null; }
  catch { return null; }
}
function showCheckout(result) {
  const href = result.approvalUrl ? sandboxApprovalUrl(result.approvalUrl) : null;
  if (result.approvalUrl && !href) throw new Error('Invalid approval address.');
  $('payment-intent').value = result.intentId;
  const link = $('paypal-approval');
  link.hidden = !href;
  if (href) link.href = href;
  $('payment-recovery').hidden = false;
  show('Open PayPal in the new tab, approve the order, then return here and verify payment.');
}
const plain = (value, max = 400) => typeof value === 'string' ? value.slice(0, max) : '';
function clearProducer() {
  clearTimeout(pollTimer);
  $('producer-card').hidden = true;
  for (const id of ['producer-model', 'producer-calls', 'producer-result']) $(id).textContent = '';
  $('producer-result').hidden = true;
  $('producer-decisions').replaceChildren();
}
function textElement(tag, className, text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function producerDecision(item) {
  const row = document.createElement('li'), head = document.createElement('div');
  row.className = 'producer-decision'; head.className = 'producer-decision-head';
  const action = plain(item?.action, 40);
  head.append(textElement('strong', 'producer-action', Object.hasOwn(PRODUCER_ACTIONS, action) ? PRODUCER_ACTIONS[action] : action || 'Decision'));
  const outcome = plain(item?.outcome?.status, 40);
  if (outcome) {
    const badge = textElement('span', 'producer-outcome', Object.hasOwn(PRODUCER_OUTCOMES, outcome) ? PRODUCER_OUTCOMES[outcome] : outcome);
    if (Object.hasOwn(PRODUCER_OUTCOMES, outcome)) badge.dataset.outcome = outcome;
    head.append(badge);
  }
  row.append(head);
  const episode = plain(item?.episode, 120);
  if (episode) row.append(textElement('p', 'producer-episode', episode));
  const ids = (Array.isArray(item?.fighterIds) ? item.fighterIds : []).filter(id => typeof id === 'string' && id).slice(0, 4);
  if (ids.length) row.append(textElement('p', 'producer-fighters', ids.map(id => Object.hasOwn(FIGHTER_NAMES, id) ? FIGHTER_NAMES[id] : id.slice(0, 64)).join(' · ')));
  const reason = plain(item?.reason);
  if (reason) row.append(textElement('p', 'producer-reason', reason));
  return row;
}
/** @param {any} data The producer route's data, `{ unavailable: true }` when it could not be read, or null to hide the card. */
function renderProducer(data) {
  if (!config?.autoProducer || !data) { clearProducer(); return; }
  const badge = $('producer-state');
  if (data.unavailable) {
    clearProducer(); $('producer-card').hidden = false;
    badge.dataset.state = 'unavailable'; badge.textContent = 'Status unavailable'; return;
  }
  const state = Object.hasOwn(PRODUCER_STATES, data.state) ? data.state : 'none';
  badge.dataset.state = state; badge.textContent = PRODUCER_STATES[state];
  $('producer-model').textContent = plain(data.model, 80);
  const calls = Number.isSafeInteger(data.modelCalls) && Number.isSafeInteger(data.maxModelCalls);
  $('producer-calls').textContent = calls ? 'Model calls ' + data.modelCalls + ' / ' + data.maxModelCalls : '';
  const reason = state === 'finished' ? plain(data.result?.reason, 120).replaceAll('_', ' ') || plain(data.result?.status, 40) : '';
  $('producer-result').textContent = reason ? 'Result: ' + reason : '';
  $('producer-result').hidden = !reason;
  $('producer-decisions').replaceChildren(...(Array.isArray(data.decisions) ? data.decisions.slice(-5).reverse().map(producerDecision) : []));
  $('producer-card').hidden = false;
}
// A running producer changes on its own, so refresh the selected session while it is active.
// This reuses refresh() and its revision guard; a new selection, account or refresh supersedes the timer.
function schedulePoll(revision) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    if (revision !== refreshRevision || !session) return;
    if (document.hidden) { schedulePoll(revision); return; }
    refresh().catch(error => show(error.message));
  }, PRODUCER_POLL_MS);
}
async function refresh() {
  const revision = ++refreshRevision, selected = $('broadcastId').value.trim();
  clearTimeout(pollTimer);
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
    const path = 'broadcasts/' + encodeURIComponent(id);
    const payoutsScopeNow = payoutsScope, payoutsLoadNow = ++payoutsLoad;
    const [report, jobs, producer, payouts] = await Promise.all([call(path + '/report'), call(path + '/jobs'),
      config?.autoProducer ? call(path + '/producer').catch(() => ({ unavailable: true })) : null,
      payoutFee() ? call(path + '/payouts').catch(() => ({ unavailable: true })) : null]);
    if (revision !== refreshRevision || $('broadcastId').value.trim() !== id) return;
    $('report').textContent = JSON.stringify(report, null, 2);
    renderProducer(producer);
    // A payout action or a newer list that finished meanwhile is newer than this answer.
    if (payoutsScopeNow === payoutsScope && payoutsLoadNow === payoutsLoad) setPayouts(payouts);
    if (['running', 'waiting'].includes(producer?.state)) schedulePoll(revision);
    $('active-jobs').replaceChildren(...jobs.map(job => {
      const row = document.createElement('p'); row.textContent = job.status + ' · ' + job.priceCredits + ' credits · ' + job.fighterIds.join(' / '); return row;
    }));
  } else { renderProducer(null); clearPayouts(); }
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
    staleReconcile();
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
  clearProducer(); clearPayouts();
});
action('stop', async () => { const result = await call('broadcasts/' + encodeURIComponent($('broadcastId').value.trim()) + '/stop', {}); show(result); await refresh(); });
// Creator payouts pay each fighter's creator a small appearance fee for a completed cup through PayPal Sandbox
// Payouts. Proposing moves nothing: a person approves each batch with a click here. Everything the server sends
// is untrusted text, so it is written with textContent and createElement only, never as markup or a link, and a
// receiver's address is masked before it is shown.
const PAYOUT_STATUSES = { proposed: 'Proposed', submitting: 'Sending', submitted: 'Submitted', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled' };
const PAYOUT_FINAL = ['paid', 'failed', 'cancelled'];
const PAYOUT_LOST = "PayPal's answer was lost. Approve again to retry the same payout — it cannot pay twice.";
const PAYOUT_UNFINISHED = 'The request did not finish, so the result is unknown. Refresh to check; approving again cannot pay twice.';
const PAYOUT_ERRORS = {
  'nothing-to-pay': 'No completed cups are waiting to be paid.',
  'not-found': 'That session or payout was not found.',
  'web-approval-required': 'A payout can only be approved with a click on this console page. Reload the page and try again.',
  'authentication-required': 'Sign in again to manage payouts.',
  'commerce-unavailable': 'Payouts are unavailable right now. Please try again in a moment.',
};
const PAYOUT_MAX_BATCHES = 20, PAYOUT_MAX_ITEMS = 24;
let payoutBatches = [], payoutsUnavailable = false, payoutsRendered = '';
// payoutsScope changes when the selected session or account changes: results meant for another view are dropped.
// payoutsLoad changes whenever a newer list or action result lands: an older list answer must not overwrite it.
let payoutsScope = 0, payoutsLoad = 0;
const payoutBusy = new Set(), payoutNotes = new Map();
const payoutFee = () => Number.isSafeInteger(config?.payouts?.feeCents) && config.payouts.feeCents > 0 ? config.payouts.feeCents : 0;
function payoutMoney(cents, currency = 'USD') {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const code = plain(currency, 3).toUpperCase();
  return code === 'USD' ? '$' + (cents / 100).toFixed(2) : (cents / 100).toFixed(2) + ' ' + (code || 'USD');
}
/** `kuma@personal.example.com` becomes `ku***@personal.example.com`; anything that is not an address becomes `***`. */
function maskReceiver(value) {
  const text = plain(value, 254), at = text.lastIndexOf('@');
  if (at < 1) return '***';
  const local = Array.from(text.slice(0, at));
  return local.slice(0, local.length > 3 ? 2 : 1).join('') + '***' + text.slice(at);
}
function payoutTime(value) {
  const time = new Date(typeof value === 'string' ? value : NaN);
  return Number.isNaN(time.getTime()) ? '' : time.toLocaleString();
}
const cupsLabel = cups => Number.isSafeInteger(cups) && cups > 0 ? cups.toLocaleString() + (cups === 1 ? ' cup' : ' cups') : '';
const payoutBatchList = data => (Array.isArray(data) ? data : [])
  .filter(batch => batch && typeof batch === 'object' && typeof batch.id === 'string' && UUID_PATTERN.test(batch.id))
  .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, PAYOUT_MAX_BATCHES);
function payoutStatus(text, error = false) {
  $('payouts-status').textContent = text; $('payouts-status').classList.toggle('is-error', error);
}
function clearPayouts() {
  payoutsScope++; payoutsLoad++;
  payoutBatches = []; payoutsUnavailable = false; payoutsRendered = ''; payoutNotes.clear();
  $('payouts-card').hidden = true; $('payouts-list').replaceChildren(); $('payouts-empty').hidden = true; payoutStatus('');
}
function payoutItem(item, currency) {
  const row = textElement('li', 'payout-item');
  const id = plain(item?.fighterId, 64), name = textElement('span', 'payout-fighter', id ? fighterName(id) : 'Fighter');
  const cups = cupsLabel(item?.cups);
  row.append(name, textElement('span', 'payout-amount', [cups, payoutMoney(item?.cents, currency)].filter(Boolean).join(' · ')),
    textElement('span', 'payout-receiver', maskReceiver(item?.receiver)));
  return row;
}
function payoutButton(label, className, busy, handler) {
  const button = textElement('button', 'button button-small ' + className, label);
  button.type = 'button'; button.disabled = busy; button.addEventListener('click', handler);
  return button;
}
function payoutBatchCard(batch) {
  const status = Object.hasOwn(PAYOUT_STATUSES, batch.status) ? batch.status : 'unknown', busy = payoutBusy.has(batch.id);
  const currency = plain(batch.currency, 3) || 'USD', card = textElement('li', 'payout-batch');
  card.dataset.batchId = batch.id; card.tabIndex = -1;
  const head = textElement('div', 'payout-batch-head'), badge = textElement('span', 'payout-badge', Object.hasOwn(PAYOUT_STATUSES, status) ? PAYOUT_STATUSES[status] : 'Unknown');
  badge.dataset.status = status;
  head.append(badge, textElement('strong', 'payout-total', payoutMoney(batch.totalCents, currency) || '—'));
  const created = payoutTime(batch.createdAt);
  if (created) head.append(textElement('span', 'payout-time', created));
  card.append(head);
  const items = (Array.isArray(batch.items) ? batch.items : []).filter(item => item && typeof item === 'object').slice(0, PAYOUT_MAX_ITEMS);
  if (items.length) { const list = textElement('ul', 'payout-items'); list.append(...items.map(item => payoutItem(item, currency))); card.append(list); }
  else if (['failed', 'cancelled'].includes(status)) card.append(textElement('p', 'payout-meta', 'Nothing was paid. Its cups can be proposed again.'));
  const providerId = plain(batch.providerBatchId, 64), providerStatus = plain(batch.providerStatus, 40).replaceAll('_', ' ');
  if (providerId) card.append(textElement('p', 'payout-meta payout-provider', 'PayPal batch ' + providerId + (providerStatus ? ' · ' + providerStatus : '')));
  const completed = PAYOUT_FINAL.includes(status) ? payoutTime(batch.completedAt) : '';
  if (completed) card.append(textElement('p', 'payout-meta', 'Completed ' + completed));
  const note = payoutNotes.get(batch.id);
  if (status === 'submitting') card.append(textElement('p', 'payout-note is-warning', PAYOUT_LOST));
  if (note?.status === status && note.text && !(status === 'submitting' && note.text === PAYOUT_LOST)) {
    const line = textElement('p', 'payout-note' + (note.error ? ' is-error' : ''), note.text); line.setAttribute('role', 'status'); card.append(line);
  }
  const buttons = [];
  if (status === 'proposed' || status === 'submitting') buttons.push(payoutButton('Approve and pay with PayPal', 'button-primary', busy, () => approvePayout(batch)));
  if (status === 'proposed') buttons.push(payoutButton('Cancel', 'button-secondary', busy, () => cancelPayout(batch)));
  if (status === 'submitted') buttons.push(payoutButton('Refresh status', 'button-secondary', busy, () => refreshPayout(batch)));
  if (buttons.length) { const row = textElement('div', 'payout-buttons'); row.append(...buttons); card.append(row); }
  return card;
}
function renderPayouts() {
  const signature = JSON.stringify([payoutFee(), payoutsUnavailable, payoutBatches, [...payoutNotes], [...payoutBusy]]);
  if (signature === payoutsRendered && !$('payouts-card').hidden) return; // a poll that changed nothing keeps focus where it is
  payoutsRendered = signature;
  $('payouts-intro').textContent = "Each completed cup pays every fighter's creator " + payoutMoney(payoutFee()) + ' (Sandbox).';
  $('payouts-list').replaceChildren(...payoutBatches.map(payoutBatchCard));
  const empty = $('payouts-empty');
  empty.textContent = payoutsUnavailable ? 'Payouts could not be loaded. Use Refresh status above to try again.' : 'No payouts have been proposed for this session yet.';
  empty.classList.toggle('is-error', payoutsUnavailable);
  empty.hidden = payoutBatches.length > 0;
  $('payouts-card').hidden = false;
}
/** @param {any} data The payouts list, `{ unavailable: true }` when it could not be read, or null to hide the card. */
function setPayouts(data) {
  if (!payoutFee() || !data) { clearPayouts(); return; }
  payoutsUnavailable = !Array.isArray(data);
  payoutBatches = payoutBatchList(data);
  try {
    const id = $('broadcastId').value.trim().toLowerCase();
    if (!$('payouts-status').textContent && journal?.get('payout:' + id)) payoutStatus('A payout proposal is waiting for its reply. Propose payout recovers the same request and cannot create a second batch.');
  } catch { /* A damaged journal is reported when the person proposes. */ }
  renderPayouts();
}
function upsertPayout(batch) {
  payoutBatches = payoutBatchList([batch, ...payoutBatches.filter(entry => entry?.id !== batch?.id)]);
}
async function loadPayouts() {
  const id = $('broadcastId').value.trim();
  if (!payoutFee() || !id) return;
  const scope = payoutsScope, load = ++payoutsLoad;
  let data;
  try { data = await call('broadcasts/' + encodeURIComponent(id) + '/payouts'); } catch { data = { unavailable: true }; }
  if (scope !== payoutsScope || load !== payoutsLoad || $('broadcastId').value.trim() !== id) return;
  setPayouts(data);
}
const lostReply = error => error instanceof TypeError || error instanceof SyntaxError;
function proposeFailed(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'nothing-to-pay') { payoutStatus(PAYOUT_ERRORS[code]); return; }
  payoutStatus(lostReply(error) ? 'The reply was lost. Choose Propose payout again to retry the same request.'
    : Object.hasOwn(PAYOUT_ERRORS, code) ? PAYOUT_ERRORS[code] : plain(error?.message, 200) || 'The payout could not be proposed.', true);
}
// One journal entry per session: a lost reply is retried with the same key, and another session is never blocked by it.
action('payout-propose', async () => {
  const saved = requireJournal(), id = $('broadcastId').value.trim().toLowerCase();
  if (!payoutFee() || !UUID_PATTERN.test(id)) throw new Error('Select a session first.');
  payoutStatus('');
  const scope = payoutsScope, name = 'payout:' + id, { op, result } = await mutate(saved, name, { broadcastId: id }, 'payouts');
  saved.complete(name, op.requestKey);
  if (scope !== payoutsScope) return;
  upsertPayout(result); payoutsLoad++;
  payoutStatus(result?.status === 'proposed' ? 'Payout proposed. Nothing is sent until you approve it.' : 'This request already has a payout. Review it below.');
  renderPayouts();
  $('payouts-list').querySelector('[data-batch-id="' + CSS.escape(String(result?.id)) + '"]')?.focus({ preventScroll: true });
}, 'click', true);
function payoutFailure(error, kind) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (kind === 'approve' && error?.status === 502) {
    return error.outcomeUnknown === true ? { text: PAYOUT_LOST, reload: true }
      : { text: 'PayPal refused the payout' + (code ? ' (' + plain(code, 60) + ')' : '') + '. Nothing was paid.', reload: true };
  }
  if (kind === 'refresh' && error?.status === 502) return { text: 'PayPal could not report the status right now. Try again in a moment.', reload: false };
  if (code === 'payout-not-approvable') return { text: 'This payout can no longer be approved. Its status was refreshed.', reload: true };
  if (code === 'payout-not-cancellable') return { text: 'Only a proposed payout can be cancelled. Its status was refreshed.', reload: true };
  if (Object.hasOwn(PAYOUT_ERRORS, code)) return { text: PAYOUT_ERRORS[code], reload: code === 'not-found' };
  if (!code) return { text: kind === 'refresh' ? 'The status could not be checked. Try again in a moment.' : PAYOUT_UNFINISHED, reload: kind !== 'refresh' };
  return { text: 'The payout request failed (' + plain(code, 60) + ').', reload: true };
}
/** Run one batch action: one at a time per batch, discarded when the view changed, with the note kept beside the batch. */
async function runPayout(batch, kind, work) {
  if (payoutBusy.has(batch.id)) return;
  const scope = payoutsScope;
  payoutBusy.add(batch.id); renderPayouts();
  let text = '', error = false, reload = false;
  try {
    const result = await work();
    if (scope === payoutsScope) { upsertPayout(result); text = payoutOutcome(result, kind); }
  } catch (failure) { ({ text, reload } = payoutFailure(failure, kind)); error = true; }
  payoutBusy.delete(batch.id);
  if (scope !== payoutsScope) return;
  payoutsLoad++;
  const current = payoutBatches.find(entry => entry.id === batch.id);
  if (current) payoutNotes.set(batch.id, { text, error, status: current.status }); else payoutNotes.delete(batch.id);
  renderPayouts();
  $('payouts-list').querySelector('[data-batch-id="' + CSS.escape(batch.id) + '"]')?.focus({ preventScroll: true });
  if (reload) loadPayouts().catch(() => {});
}
function payoutOutcome(batch, kind) {
  if (kind === 'cancel') return 'Cancelled. Nothing was sent to PayPal.';
  if (batch?.status === 'submitted') return kind === 'approve' ? 'Sent to PayPal. Use Refresh status to follow it.' : 'Checked with PayPal. It is still in progress.';
  return '';
}
function approvePayout(batch) {
  const creators = new Set((batch.items ?? []).map(item => item?.receiver ?? item?.fighterId)).size, total = payoutMoney(batch.totalCents, batch.currency);
  if (!confirm('Approve and pay ' + total + ' to ' + creators + (creators === 1 ? ' creator' : ' creators') + ' with PayPal?\n'
    + 'This sends Sandbox money from the merchant account. No real money moves.\n'
    + (batch.status === 'submitting' ? 'This retries the same payout; it cannot pay twice.' : 'Each cup is paid once.'))) return;
  runPayout(batch, 'approve', () => call('payouts/' + encodeURIComponent(batch.id) + '/approve', { confirmed: true }));
}
function cancelPayout(batch) {
  if (!confirm('Cancel this ' + payoutMoney(batch.totalCents, batch.currency) + ' payout?\nNothing is sent to PayPal, and its cups can be proposed again.')) return;
  runPayout(batch, 'cancel', () => call('payouts/' + encodeURIComponent(batch.id) + '/cancel', { confirmed: true }));
}
function refreshPayout(batch) { runPayout(batch, 'refresh', () => call('payouts/' + encodeURIComponent(batch.id))); }
/** A concierge payout proposal as a compact card. The concierge only proposes: approval is a click in Creator payouts. */
function payoutAction(item) {
  const card = textElement('div', 'chat-action chat-payout'), id = typeof item.broadcastId === 'string' && UUID_PATTERN.test(item.broadcastId) ? item.broadcastId.toLowerCase() : '';
  const currency = plain(item.currency, 3) || 'USD', total = payoutMoney(item.totalCents, currency);
  if (!id || !total) { card.append(textElement('p', 'chat-action-note', 'The payout proposal could not be shown. Open Creator payouts to check it.')); return card; }
  const status = Object.hasOwn(PAYOUT_STATUSES, item.status) ? PAYOUT_STATUSES[item.status] : 'Proposed';
  const grid = textElement('dl', 'chat-plan-grid');
  for (const row of (Array.isArray(item.items) ? item.items : []).filter(entry => entry && typeof entry === 'object').slice(0, PAYOUT_MAX_ITEMS)) {
    const fighter = plain(row.fighterId, 64), line = document.createElement('div');
    line.append(textElement('dt', 'chat-plan-label', fighter ? fighterName(fighter) : 'Fighter'),
      textElement('dd', 'chat-plan-value', [cupsLabel(row.cups), payoutMoney(row.cents, currency)].filter(Boolean).join(' · ')));
    grid.append(line);
  }
  const review = textElement('button', 'button button-secondary', 'Review in Creator payouts'), note = textElement('p', 'chat-action-note');
  review.type = 'button'; note.setAttribute('role', 'status');
  review.addEventListener('click', () => reviewPayouts(id, review, note));
  card.append(textElement('p', 'chat-action-title', 'Creator payout · ' + status + ' · ' + total), grid, review,
    textElement('p', 'chat-action-note', 'Nothing is sent until you approve it in Creator payouts.'), note);
  return card;
}
async function reviewPayouts(broadcastId, button, note) {
  if (!payoutFee()) { note.textContent = 'Creator payouts are not available on this console.'; return; }
  button.disabled = true; note.textContent = '';
  try {
    if ($('broadcastId').value.trim().toLowerCase() !== broadcastId) {
      $('broadcastId').value = broadcastId; $('broadcastId').dispatchEvent(new Event('input')); await refresh();
    } else await loadPayouts();
    if ($('payouts-card').hidden) note.textContent = 'Creator payouts could not be loaded. Use Refresh status and try again.';
    else { $('payouts-card').scrollIntoView({ block: 'start' }); $('payouts-title').focus({ preventScroll: true }); }
  } catch (error) { note.textContent = plain(error?.message, 200) || 'Creator payouts could not be loaded.'; }
  finally { button.disabled = false; }
}
// The AI concierge is a chat with the commerce service's agent. Its reply text is model output and is
// untrusted: it is only written with textContent and a URL inside it is never made a link. Controls come
// only from the server's `actions` list, and the PayPal link only after its origin is checked. The agent
// can quote a plan, start a Sandbox top-up and propose creator payouts; the person still approves every budget with the
// form below and every payout in Creator payouts.
const CONCIERGE_MAX_CHARS = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONCIERGE_ERRORS = {
  'concierge-busy': 'The concierge is still answering your last message. Try again in a moment.',
  'concierge-conversation-full': 'This conversation reached its length limit. Your next message starts a new one.',
  'concierge-daily-limit': 'The concierge reached its daily limit on this demo. Please try again tomorrow.',
  'concierge-model-unavailable': 'The concierge is unavailable right now. Please try again in a moment.',
  'invalid-concierge-message': 'That message could not be sent. Use up to 1,000 characters of plain text.',
  'authentication-required': 'Sign in again to keep chatting.',
};
const CONCIERGE_FALLBACK_ERROR = 'The concierge could not answer. Please try again.';
const CONCIERGE_TOOL_NOTES = { 'paypal-not-configured': 'PayPal Sandbox is not configured on this server, so a checkout could not be created.' };
let conciergeId = '', conciergeEpoch = 0, conciergeBusy = false;
const conciergeNote = (text, error = false) => textElement('p', 'chat-note' + (error ? ' is-error' : ''), text);
function conciergeCount() { $('concierge-count').textContent = $('concierge-input').value.length + ' / ' + CONCIERGE_MAX_CHARS; }
/** Append to the transcript. A reply scrolls to its own top so its first line is never cut off. */
function addChat(node, scrollToTop = false) {
  const log = $('concierge-log');
  log.append(node);
  if (scrollToTop) log.scrollTop += node.getBoundingClientRect().top - log.getBoundingClientRect().top;
  else log.scrollTop = log.scrollHeight;
  return node;
}
function chatMessage(role, text) {
  const bubble = textElement('div', 'chat-message chat-' + role);
  bubble.append(textElement('p', 'chat-text', text));
  return bubble;
}
function iconNode(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', '#' + id); svg.append(use);
  return svg;
}
/** Forget the conversation: on sign-out, on an account change, or when the person starts a new chat. */
function resetConcierge() {
  conciergeEpoch++; conciergeId = ''; conciergeBusy = false;
  $('concierge-log').replaceChildren(); $('concierge-log').removeAttribute('aria-busy');
  $('concierge-input').value = ''; conciergeCount();
}
function updateConcierge() {
  const available = Boolean(config?.concierge && config.commerceEnabled && session);
  $('concierge').hidden = !available;
  $('concierge-send').disabled = !available || conciergeBusy;
  $('concierge-new').disabled = !available || conciergeBusy || (!conciergeId && !$('concierge-log').hasChildNodes());
}
function checkoutAction(item) {
  const href = typeof item.approvalUrl === 'string' ? sandboxApprovalUrl(item.approvalUrl) : null;
  const intentId = typeof item.intentId === 'string' && UUID_PATTERN.test(item.intentId) ? item.intentId : '';
  const card = textElement('div', 'chat-action');
  if (!href || !intentId) { card.append(textElement('p', 'chat-action-note', 'The PayPal link was not valid, so it was not shown. Ask for a new checkout.')); return card; }
  const product = catalog?.products?.find(entry => entry.id === item.productId);
  card.append(textElement('p', 'chat-action-title', 'PayPal Sandbox checkout' + (product ? ' · ' + product.name : '')));
  const link = textElement('a', 'button button-paypal', 'Approve in PayPal');
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.append(iconNode('i-external'));
  card.append(link, textElement('p', 'chat-action-note', 'After you approve on PayPal, tell me here or choose Verify payment under your credits. No real money moves.'));
  try { showCheckout({ intentId, approvalUrl: href }); } catch (error) { show(error.message); }
  return card;
}
function topupAction(item) {
  const credited = item.status === 'credited', status = plain(item.status, 40).replaceAll('_', ' ');
  if (credited) {
    if (typeof item.intentId === 'string' && $('payment-intent').value === item.intentId) $('paypal-approval').hidden = true;
    refresh().catch(error => show(error.message));
  }
  const card = textElement('div', 'chat-action');
  card.append(textElement('p', 'chat-action-note' + (credited ? ' is-ok' : ''),
    credited ? 'Top-up credited. Your credits are updated.' : 'Top-up not credited yet' + (status ? ' (' + status + ')' : '') + '.'));
  return card;
}
/** A quoted plan from the server, or null when any field is not what the budget form accepts. */
function conciergePlan(item) {
  const whole = value => Number.isSafeInteger(value) && value > 0;
  const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
  const ids = item.fighterIds;
  if (!text(item.hostId, 128) || !text(item.channelId, 64) || ![item.durationMinutes, item.maxCredits, item.cupCredits, item.maxCups].every(whole)
    || !Array.isArray(ids) || ids.length < 4 || ids.length > 9 || !ids.every(id => text(id, 64) && !id.includes(','))) return null;
  return { hostId: item.hostId, channelId: item.channelId, durationMinutes: item.durationMinutes, maxCredits: item.maxCredits,
    cupCredits: item.cupCredits, maxCups: item.maxCups, fighterIds: [...ids] };
}
function durationLabel(minutes) {
  return [Math.floor(minutes / 60) && Math.floor(minutes / 60) + ' h', minutes % 60 && (minutes % 60) + ' min'].filter(Boolean).join(' ');
}
/** The plan's time limit in hours, rounded up to what the time limit input accepts. */
function planHours(minutes) {
  const input = $('durationHours'), min = Number(input.min) || 1, max = Number(input.max) || Infinity, step = Number(input.step) > 0 ? Number(input.step) : 1;
  return Math.min(max, Math.max(min, min + Math.ceil((minutes / 60 - min) / step - 1e-9) * step));
}
const fighterName = id => Object.hasOwn(FIGHTER_NAMES, id) ? FIGHTER_NAMES[id] : id;
/** Fill the budget form with a plan. This never submits it: the person reviews and approves with the form's own button. */
function applyPlan(plan) {
  try { if (journal?.get('approval')) return 'A budget approval is still pending. Review budget to recover it before applying a new plan.'; }
  catch (error) { return error.message; }
  if (busyActions.has('budget-form')) return 'Wait for the current budget review to finish, then apply the plan.';
  if (![...$('hostId').options].some(option => option.value === plan.hostId)) return 'This console has no host called ' + plan.hostId + ', so the plan was not applied.';
  const hours = planHours(plan.durationMinutes);
  $('hostId').value = plan.hostId; $('channelId').value = plan.channelId; $('maxCredits').value = String(plan.maxCredits);
  $('fighterIds').value = plan.fighterIds.join(','); $('durationHours').value = String(hours);
  renderHost(); renderLineup();
  const rounded = hours * 60 === plan.durationMinutes ? '' : ' The time limit was rounded up to ' + hours + (hours === 1 ? ' hour.' : ' hours.');
  budgetFeedback('Plan filled in.' + rounded + ' Review the budget, then approve it here. Nothing is approved yet.');
  $('setup').scrollIntoView();
  $('budget-form').querySelector('button[type="submit"]').focus({ preventScroll: true });
  return 'Plan filled into Set up your show.' + rounded + ' Nothing is approved yet.';
}
function planAction(item) {
  const plan = conciergePlan(item), card = textElement('div', 'chat-action chat-plan');
  if (!plan) { card.append(textElement('p', 'chat-action-note', 'The quoted plan could not be shown. Ask again.')); return card; }
  const grid = textElement('dl', 'chat-plan-grid');
  for (const [label, value] of [['Host', plan.hostId], ['Session', plan.channelId], ['Time limit', durationLabel(plan.durationMinutes)],
    ['Credit limit', plan.maxCredits.toLocaleString() + ' credits'], ['Cups', 'Up to ' + plan.maxCups.toLocaleString() + ' · ' + plan.cupCredits.toLocaleString() + ' credits each'],
    ['Fighters', plan.fighterIds.map(fighterName).join(' · ')]]) {
    const row = document.createElement('div');
    row.append(textElement('dt', 'chat-plan-label', label), textElement('dd', 'chat-plan-value', value)); grid.append(row);
  }
  const apply = textElement('button', 'button button-primary', 'Use this plan'), result = textElement('p', 'chat-action-note');
  apply.type = 'button'; result.setAttribute('role', 'status');
  apply.addEventListener('click', () => { result.textContent = applyPlan(plan); });
  card.append(textElement('p', 'chat-action-title', 'Quoted plan · nothing approved'), grid, apply, result);
  return card;
}
function conciergeActions(actions) {
  const builders = { checkout: checkoutAction, topup: topupAction, plan: planAction, payout: payoutAction };
  return actions.slice(0, 6).filter(item => item && typeof item.type === 'string' && Object.hasOwn(builders, item.type)).map(item => builders[item.type](item));
}
function conciergeError(error) {
  return typeof error?.code === 'string' && Object.hasOwn(CONCIERGE_ERRORS, error.code) ? CONCIERGE_ERRORS[error.code] : CONCIERGE_FALLBACK_ERROR;
}
async function sendConcierge(message) {
  const epoch = conciergeEpoch;
  conciergeBusy = true; updateConcierge();
  $('concierge-input').value = ''; conciergeCount();
  addChat(chatMessage('person', message));
  const thinking = addChat(chatMessage('agent', 'Thinking…'));
  thinking.classList.add('is-thinking'); $('concierge-log').setAttribute('aria-busy', 'true');
  try {
    // The selected session is the concierge's context; the server refuses anything that is not a session id.
    const selected = $('broadcastId').value.trim();
    const data = await call('concierge', { message, ...(conciergeId ? { conversationId: conciergeId } : {}), ...(UUID_PATTERN.test(selected) ? { broadcastId: selected } : {}) });
    if (epoch !== conciergeEpoch) return;
    if (typeof data?.conversationId === 'string' && UUID_PATTERN.test(data.conversationId)) conciergeId = data.conversationId;
    thinking.remove();
    if (data.restarted === true) addChat(conciergeNote('Your earlier conversation expired, so this is a new one.'));
    const bubble = chatMessage('agent', typeof data.reply === 'string' && data.reply ? data.reply : '…');
    const notes = new Set((Array.isArray(data.toolCalls) ? data.toolCalls : []).map(entry => entry?.ok === false ? entry.code : '')
      .filter(code => typeof code === 'string' && Object.hasOwn(CONCIERGE_TOOL_NOTES, code)));
    bubble.append(...[...notes].map(code => textElement('p', 'chat-action-note', CONCIERGE_TOOL_NOTES[code])),
      ...conciergeActions(Array.isArray(data.actions) ? data.actions : []));
    addChat(bubble, true);
  } catch (error) {
    if (epoch !== conciergeEpoch) return;
    thinking.remove();
    addChat(conciergeNote(conciergeError(error), true));
    if (error?.code === 'concierge-conversation-full') conciergeId = '';
    // Keep what the person wrote so a failed send costs no retyping.
    if (!$('concierge-input').value) { $('concierge-input').value = message; conciergeCount(); }
  } finally {
    if (epoch === conciergeEpoch) { conciergeBusy = false; $('concierge-log').removeAttribute('aria-busy'); updateConcierge(); }
  }
}
$('concierge-form').addEventListener('submit', event => {
  event.preventDefault();
  const message = $('concierge-input').value.trim();
  if (message && !conciergeBusy && session && config?.concierge) sendConcierge(message);
});
$('concierge-input').addEventListener('input', conciergeCount);
$('concierge-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); $('concierge-form').requestSubmit(); }
});
for (const chip of document.querySelectorAll('.chat-chip')) chip.addEventListener('click', () => {
  $('concierge-input').value = chip.textContent.trim(); conciergeCount(); $('concierge-input').focus();
});
$('concierge-new').addEventListener('click', () => { resetConcierge(); updateConcierge(); $('concierge-input').focus(); });
// PayPal reconciliation compares this account's Sandbox top-ups with PayPal's own records. The server does the
// lookups through the official PayPal MCP server; this card only shows the result. Everything in it is
// untrusted text (ids, statuses, reason codes and the AI auditor's summary): it is written with textContent and
// createElement only, never as markup, and never turned into a link.
const RECONCILE_RESULTS = { matched: 'Matched', mismatched: 'Mismatched', pending: 'Pending', unavailable: 'Unavailable', 'no-order': 'No order' };
const RECONCILE_REASONS = {
  'capture-id-differs': 'PayPal capture differs from the credited one',
  'capture-refunded': 'PayPal refunded this payment',
  'paypal-record-differs': 'PayPal record differs from the ledger',
  'paypal-completed-not-credited': 'PayPal completed it — choose Verify payment',
  'awaiting-approval-or-capture': 'Waiting for approval or capture on PayPal',
  'paypal_mcp_api_error': 'PayPal could not return this order',
  'paypal_mcp_tool_error': 'The PayPal lookup failed',
  'order-id-format': 'The stored order id is not a PayPal order id',
  'checkout-never-reached-paypal': 'Checkout never reached PayPal',
  'not-fetched': 'This order was not looked up',
};
const RECONCILE_SUMMARY_ERRORS = {
  'reconciliation-daily-limit': 'The AI auditor reached its daily limit on this demo. The comparison above is still complete.',
  'reconciliation-summary-empty': 'The AI auditor returned no explanation. The comparison above is still complete.',
  'reconciliation-summary-incomplete': 'The AI auditor ran out of steps before it could explain. The comparison above is still complete.',
  'reconciliation-model-unavailable': 'The AI auditor is unavailable right now. The comparison above is still complete.',
};
const RECONCILE_SUMMARY_FALLBACK = 'The AI auditor could not explain this check. The comparison above is still complete.';
const RECONCILE_ERRORS = {
  'paypal-mcp-unavailable': "PayPal's MCP server could not be reached right now. Please try again in a moment.",
  'authentication-required': 'Sign in again to run the check.',
};
const RECONCILE_FALLBACK_ERROR = 'The PayPal check could not run. Please try again.';
const RECONCILE_MAX_ROWS = 50;
const RECONCILE_IDLE_LABEL = 'Check with PayPal';
let reconcileEpoch = 0;
function updateReconcile() {
  const available = Boolean(config?.reconciliation && session);
  $('reconcile').hidden = !available;
  $('reconcile-run').disabled = !available || busyActions.has('reconcile-run');
}
function reconcileStatus(text, error = false) {
  $('reconcile-status').textContent = text; $('reconcile-status').classList.toggle('is-error', error);
}
/** Forget the last check: on sign-out or an account change. A check still running is ignored when it finishes. */
function resetReconcile() {
  reconcileEpoch++;
  $('reconcile-result').hidden = true; $('reconcile-panel').removeAttribute('aria-busy');
  for (const id of ['reconcile-rows', 'reconcile-totals']) $(id).replaceChildren();
  for (const id of ['reconcile-checked', 'reconcile-calls', 'reconcile-summary']) $(id).textContent = '';
  $('reconcile-run-label').textContent = RECONCILE_IDLE_LABEL; reconcileStatus('');
}
/** A verified payment changes what the last check showed. */
function staleReconcile() {
  if (!$('reconcile-result').hidden) reconcileStatus('A payment was verified after this check. Check with PayPal again to refresh; a result from the last couple of minutes may still show the old state.');
}
function reconcileReason(value) {
  const code = plain(value, 80);
  if (!code) return '';
  if (Object.hasOwn(RECONCILE_REASONS, code)) return RECONCILE_REASONS[code];
  return code.startsWith('capture-') ? 'PayPal capture status: ' + code.slice('capture-'.length).replaceAll('_', ' ') : code.replace(/[_-]+/g, ' ');
}
function reconcileCalls(toolCalls) {
  const calls = (Array.isArray(toolCalls) ? toolCalls : []).filter(entry => entry && typeof entry === 'object');
  const lookups = who => { const count = calls.filter(entry => entry.by === who).length; return count + ' ' + who + ' ' + (count === 1 ? 'lookup' : 'lookups'); };
  const failed = calls.filter(entry => entry.ok === false).length;
  return 'PayPal MCP: ' + lookups('server') + ' · ' + lookups('auditor') + (failed ? ' · ' + failed + ' failed' : '');
}
/** Fill the payment reference with this top-up and press the existing Verify payment button. That action owns the capture,
 * its journal and its refresh; this only starts it. */
function verifyFromReconcile(intentId, note) {
  const verify = $('verify-payment');
  if (verify.disabled) {
    note.textContent = busyActions.has('verify-payment') ? 'A payment check is already running. Wait for it to finish.'
      : catalog?.paypalConfigured ? 'Verify payment is not available right now.' : 'PayPal Sandbox top-ups are unavailable on this server.';
    return;
  }
  $('payment-intent').value = intentId;
  note.textContent = 'Verifying this payment. The result appears under Activity.';
  verify.click();
}
function reconcileRow(item) {
  const row = textElement('li', 'reconcile-row'), head = textElement('div', 'reconcile-row-head');
  const known = Object.hasOwn(RECONCILE_RESULTS, item?.result), intentId = plain(item?.intentId, 64);
  const badge = textElement('span', 'reconcile-badge', known ? RECONCILE_RESULTS[item.result] : 'Unknown');
  badge.dataset.result = known ? item.result : 'unknown';
  const intent = textElement('span', 'reconcile-intent', intentId.slice(0, 8) || '—'); intent.title = intentId;
  head.append(badge, intent);
  if (Number.isSafeInteger(item?.credits)) head.append(textElement('span', 'reconcile-credits', item.credits.toLocaleString() + ' credits'));
  const status = value => plain(value, 40).replaceAll('_', ' ') || '—';
  const amount = Number.isSafeInteger(item?.amountCents) ? (item.amountCents / 100).toFixed(2) + ' ' + plain(item?.currency, 3).toUpperCase() : '';
  row.append(head, textElement('p', 'reconcile-reason', reconcileReason(item?.reason)),
    textElement('p', 'reconcile-detail', ['Order ' + (plain(item?.orderId, 64) || '—'), 'Ledger ' + status(item?.ledgerStatus), 'PayPal ' + status(item?.paypalStatus), amount]
      .filter(Boolean).join(' · ')));
  if (item?.reason === 'paypal-completed-not-credited' && UUID_PATTERN.test(intentId)) {
    const verify = textElement('button', 'button button-primary button-small', 'Verify this payment'), note = textElement('p', 'reconcile-note');
    verify.type = 'button'; note.setAttribute('role', 'status');
    verify.addEventListener('click', () => verifyFromReconcile(intentId, note));
    row.append(verify, note);
  }
  return row;
}
function renderReconcile(data) {
  const rows = Array.isArray(data?.rows) ? data.rows.slice(0, RECONCILE_MAX_ROWS) : [];
  const checked = new Date(typeof data?.checkedAt === 'string' ? data.checkedAt : NaN);
  $('reconcile-checked').textContent = (Number.isNaN(checked.getTime()) ? 'Check complete' : 'Checked ' + checked.toLocaleString())
    + (data?.cached === true ? ' · cached from a recent check' : '');
  $('reconcile-calls').textContent = reconcileCalls(data?.toolCalls);
  const totals = data?.totals && typeof data.totals === 'object' ? data.totals : {};
  $('reconcile-totals').replaceChildren(...Object.keys(RECONCILE_RESULTS).filter(key => Object.hasOwn(totals, key) && Number.isSafeInteger(totals[key]) && totals[key] > 0)
    .map(key => { const badge = textElement('li', 'reconcile-badge', totals[key].toLocaleString() + ' ' + RECONCILE_RESULTS[key]); badge.dataset.result = key; return badge; }));
  $('reconcile-empty').hidden = rows.length > 0;
  $('reconcile-rows').replaceChildren(...rows.map(reconcileRow));
  const summary = plain(data?.summary, 1500).trim(), summaryError = plain(data?.summaryError, 80);
  $('reconcile-auditor').hidden = !summary && !data?.summaryError;
  $('reconcile-summary').textContent = summary || (Object.hasOwn(RECONCILE_SUMMARY_ERRORS, summaryError) ? RECONCILE_SUMMARY_ERRORS[summaryError] : RECONCILE_SUMMARY_FALLBACK);
  $('reconcile-summary').classList.toggle('is-error', !summary);
  $('reconcile-auditor-note').hidden = !summary;
  $('reconcile-result').hidden = false;
}
async function runReconcile() {
  if (!config?.reconciliation || !session) return;
  const epoch = reconcileEpoch;
  $('reconcile-result').hidden = true; $('reconcile-panel').setAttribute('aria-busy', 'true');
  $('reconcile-run-label').textContent = 'Checking with PayPal…';
  reconcileStatus('Looking up your top-ups with PayPal. This can take up to a minute.');
  try {
    const data = await call('reconciliation', {});
    if (epoch !== reconcileEpoch) return;
    reconcileStatus(''); renderReconcile(data);
  } catch (error) {
    if (epoch !== reconcileEpoch) return;
    reconcileStatus(typeof error?.code === 'string' && Object.hasOwn(RECONCILE_ERRORS, error.code) ? RECONCILE_ERRORS[error.code] : RECONCILE_FALLBACK_ERROR, true);
  } finally {
    if (epoch === reconcileEpoch) { $('reconcile-run-label').textContent = RECONCILE_IDLE_LABEL; $('reconcile-panel').removeAttribute('aria-busy'); }
  }
}
action('reconcile-run', runReconcile);
function authChanged(value) {
  const previousOwner = session?.user.id;
  if (previousOwner !== value?.user.id) { refreshRevision++; walletSpendingBlocked = false; $('wallet-status').textContent = ''; budgetFeedback(''); resetConcierge(); resetReconcile(); }
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
    clearProducer(); clearPayouts();
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
