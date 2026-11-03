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
  updateConcierge();
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
    const [report, jobs, producer] = await Promise.all([call(path + '/report'), call(path + '/jobs'),
      config?.autoProducer ? call(path + '/producer').catch(() => ({ unavailable: true })) : null]);
    if (revision !== refreshRevision || $('broadcastId').value.trim() !== id) return;
    $('report').textContent = JSON.stringify(report, null, 2);
    renderProducer(producer);
    if (['running', 'waiting'].includes(producer?.state)) schedulePoll(revision);
    $('active-jobs').replaceChildren(...jobs.map(job => {
      const row = document.createElement('p'); row.textContent = job.status + ' · ' + job.priceCredits + ' credits · ' + job.fighterIds.join(' / '); return row;
    }));
  } else renderProducer(null);
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
  clearProducer();
});
action('stop', async () => { const result = await call('broadcasts/' + encodeURIComponent($('broadcastId').value.trim()) + '/stop', {}); show(result); await refresh(); });
// The AI concierge is a chat with the commerce service's agent. Its reply text is model output and is
// untrusted: it is only written with textContent and a URL inside it is never made a link. Controls come
// only from the server's `actions` list, and the PayPal link only after its origin is checked. The agent
// can quote a plan and start a Sandbox top-up; the person still approves every budget with the form below.
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
  const builders = { checkout: checkoutAction, topup: topupAction, plan: planAction };
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
    const data = await call('concierge', conciergeId ? { conversationId: conciergeId, message } : { message });
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
function authChanged(value) {
  const previousOwner = session?.user.id;
  if (previousOwner !== value?.user.id) { refreshRevision++; walletSpendingBlocked = false; $('wallet-status').textContent = ''; budgetFeedback(''); resetConcierge(); }
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
    clearProducer();
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
