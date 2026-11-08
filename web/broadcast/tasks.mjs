const $ = id => document.getElementById(id);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const query = new URLSearchParams(location.search),
  fragment = new URLSearchParams(location.hash.slice(1));
const storageKey = 'oddbout-paid-task-navigation';
let navigation = {};
try {
  navigation = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}');
} catch {
  /* Navigation is optional, never auth. */
}
if (UUID.test(query.get('operation') ?? '')) navigation.operation = query.get('operation');
if (UUID.test(fragment.get('device') ?? '') && /^[A-F0-9]{8}$/.test(fragment.get('code') ?? '')) {
  navigation.device = fragment.get('device');
  navigation.code = fragment.get('code');
  history.replaceState(null, '', location.pathname + location.search);
}
function saveNavigation() {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(navigation));
  } catch {
    /* Server discovery still works. */
  }
}
saveNavigation();
let client,
  session,
  config,
  selected,
  approvalLink,
  epoch = 0,
  revision = 0,
  busy = false,
  timer,
  searchTimer;
let listed = [],
  nextCursor = null,
  historyBefore = null,
  historyId = null,
  renewalId = null;
const states = {
  awaiting_approval: 'Review needed',
  awaiting_payment: 'Funding needed',
  ready: 'Ready to resume',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Execution failed',
  needs_reconciliation: 'Outcome unknown — held',
  cancelled: 'Cancelled',
  cancelling: 'Stopping after current work',
  payment_review: 'Payment needs review',
  expired: 'Approval window expired',
  blocked: 'Payment needs reconciliation',
};
const errors = {
  'not-found': 'This task or connection is not available to this account.',
  'approval-expired': 'The approval deadline has passed. Your original task and payment records are preserved.',
  'device-expired': 'This connection expired. Start a new connection from your agent.',
  'wallet-frozen': 'A payment adjustment needs reconciliation before further spending.',
  'checkout-needs-reconciliation': 'The original checkout needs review. No replacement payment was created.',
  'checkout-outcome-unknown': 'The original payment status is not known yet. Check this same task again.',
  'operation-not-payable': 'This task cannot start a checkout in its current state.',
  'insufficient-credits': 'There are not enough available credits for this task.',
  'web-approval-required': 'Review and approve this action on this page.',
  'authentication-required': 'Sign in again to view your saved tasks.',
};
errors['too-many-requests'] = 'Too many requests. Wait a minute; your original task is saved.';
errors['operation-not-renewable'] = 'This task has started or was cancelled. Its original record is preserved.';
errors['consent-still-valid'] = 'This task still has a valid approval.';
const eventNames = {
  task_prepared: 'Task saved',
  task_approved: 'Execution approved',
  consent_renewed: 'New deadline approved',
  funding_requested: 'Credit purchase requested',
  job_queued: 'Original job queued',
  job_running: 'Execution started',
  job_succeeded: 'Execution completed',
  job_failed: 'Execution failed without a charge',
  job_unknown: 'Execution outcome needs review',
  task_cancelled: 'Task cancellation requested',
  payment_ordered: 'PayPal order linked',
  payment_credited: 'Payment confirmed and credits added',
  payment_check_requested: 'Payment verification requested',
  payment_check_pending: 'Payment check will retry',
  payment_check_waiting_for_approval: 'Waiting for PayPal approval',
  payment_check_succeeded: 'Payment verified',
  payment_check_needs_attention: 'Payment requires review',
};
eventNames.payment_adjusted = 'Payment refund or reversal recorded';
eventNames.payment_link_recovered = 'Original PayPal order recovered after review';
function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
function controls() {
  $('signin').disabled = !client || busy;
  $('signin').hidden = Boolean(session);
  $('signout').hidden = !session;
  for (const id of ['refresh', 'pair-approve', 'approve', 'checkout', 'verify', 'resume', 'cancel', 'more', 'renew', 'retry-payment', 'older-history'])
    $(id).disabled =
      !session || !config?.paidOperations || busy || (id === 'approve' && !$('consent').checked) || (id === 'renew' && !$('renew-consent').checked);
}
async function call(path, body) {
  if (!session) throw new Error('Sign in with the same Google account used for this task.');
  const scope = epoch;
  const response = await fetch('/paid-operations/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    signal: AbortSignal.timeout(55000),
    headers: { authorization: 'Bearer ' + session.access_token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (scope !== epoch) throw new Error('Account changed. Reload your own tasks.');
  if (!response.ok || !result.ok)
    throw new Error(errors[result.code] ?? 'Request unavailable. The original task is retained; check again before starting anything new.');
  return result.data;
}
function action(id, callback) {
  $(id).addEventListener('click', async () => {
    if (busy) return;
    const scope = epoch;
    busy = true;
    revision++;
    clearTimeout(timer);
    controls();
    try {
      await callback();
    } catch (error) {
      if (scope === epoch) message(error.message, true);
    } finally {
      busy = false;
      controls();
      scheduleRefresh();
    }
  });
}
function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
function render(operation) {
  selected = operation;
  $('detail').hidden = !operation;
  $('broadcast-notice').hidden = operation?.kind !== 'broadcast';
  if (operation?.kind === 'broadcast') {
    $('detail').hidden = true;
    $('broadcast-note').textContent = `${states[operation.state] ?? operation.state}. This plan and its producer status are managed in Broadcast Studio.`;
    $('broadcast-link').href = '/broadcast/?operation=' + encodeURIComponent(operation.id);
    return;
  }
  if (approvalLink?.id === operation?.id && operation?.state === 'awaiting_payment') {
    $('paypal').href = approvalLink.url;
    $('paypal').hidden = false;
  } else {
    $('paypal').hidden = true;
    $('paypal').removeAttribute('href');
  }
  if (!operation) return;
  const input = operation.input,
    state = operation.state;
  $('state').textContent = states[state] ?? state;
  $('task-title').textContent = input.channelId;
  const fields = [
    ['Task', 'One cup · three rendered bouts'],
    ['Cost', `${input.maxCredits} credits on verified completion`],
    ['Host', input.hostId],
    ['Fighters', input.fighterIds.join(' / ')],
    ['Deadline', new Date(operation.effectiveEndsAt ?? input.endsAt).toLocaleString()],
    ['Balance', `${operation.availableCredits} available credits`],
    [
      'Funding',
      operation.payment
        ? `${operation.payment.status} · $${(operation.payment.amountCents / 100).toFixed(2)} Sandbox / ${operation.payment.credits} credits`
        : 'Existing credits, or $10 Sandbox for 1,000 credits',
    ],
  ];
  $('summary').replaceChildren(...fields.flatMap(([label, value]) => [element('dt', label), element('dd', value)]));
  $('approval').hidden = state !== 'awaiting_approval';
  $('checkout').hidden = state !== 'awaiting_payment' || operation.payment?.status === 'credited';
  $('wallet-funding').hidden = state !== 'awaiting_payment' || operation.payment?.status !== 'credited';
  $('checkout').textContent = operation.payment ? 'Continue the same PayPal checkout' : 'Add $10 Sandbox · 1,000 credits';
  $('verify').hidden = !operation.payment || operation.payment.status === 'credited';
  $('resume').hidden = state !== 'ready';
  $('retry-payment').hidden = state !== 'payment_review';
  const canRenew =
    !operation.jobId && !operation.cancelledAt && !operation.spendingBlocked && Date.parse(operation.effectiveEndsAt ?? input.endsAt) <= Date.now() + 240000;
  $('renewal').hidden = !canRenew;
  if (canRenew && renewalId !== operation.id) {
    renewalId = operation.id;
    $('renew-consent').checked = false;
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $('new-deadline').value = d.toISOString().slice(0, 16);
  }
  const recovery = operation.recovery;
  $('recovery-status').hidden = !recovery || operation.payment?.status === 'credited';
  $('recovery-status').textContent =
    recovery?.state === 'needs_attention'
      ? 'Payment verification needs review. Keep this task; do not create a replacement payment.'
      : recovery?.state === 'leased'
        ? 'The server is checking the original payment. You may leave this page.'
        : recovery?.state === 'pending'
          ? `Payment verification will retry automatically${recovery.nextAt ? ' after ' + new Date(recovery.nextAt).toLocaleTimeString() : ''}.`
          : 'After PayPal approval, the server will verify the same payment even if you close this page.';
  $('cancel').hidden = ['completed', 'failed', 'cancelled', 'cancelling'].includes(state);
  $('next-step').textContent =
    {
      awaiting_approval: 'Review the fixed task above. Approval does not start execution.',
      awaiting_payment: 'Funding and task approval are separate. After payment, resume this task from your PC agent.',
      ready: 'Ready. Your PC agent can find this task and resume it without another payment.',
      queued: 'The original job is queued. Repeated recovery returns this same job.',
      running: 'The original job is running. You can close this page.',
      needs_reconciliation: 'The execution outcome is unknown. Funds remain held; recovery will not launch a replacement.',
      payment_review: 'We could not confirm the original payment. You can request another verification; a new payment will not be created.',
      blocked: 'A payment adjustment needs reconciliation. Further execution is blocked.',
      expired: 'Review and approve a new deadline below to keep the same task and funding. An agent cannot extend consent.',
      failed: 'This job was not charged. Recovery returns its recorded failure; it does not silently retry.',
      cancelled: 'New execution is stopped. Your payment record is retained.',
      cancelling: 'New work is stopped. The current job is finishing; its final result and charge will be recorded here.',
    }[state] ?? 'Your result is saved to your account.';
  $('result').hidden = !operation.job;
  $('winner').textContent = state === 'completed' ? `Winner: ${operation.job.result?.winnerId ?? 'See evidence'}` : '';
  $('evidence').textContent = JSON.stringify(
    {
      operationId: operation.id,
      approvalId: operation.approvalId,
      approvedAt: operation.approvedAt,
      payment: operation.payment,
      broadcastId: operation.broadcastId,
      job: operation.job,
    },
    null,
    2,
  );
  controls();
}
async function refresh(resetList = true) {
  clearTimeout(timer);
  const current = ++revision,
    page = await call('operations/page?' + new URLSearchParams({ filter: $('filter').value, query: $('search').value, limit: '20' }));
  if (current !== revision) return;
  if (!resetList && listed.length) {
    const fresh = new Set(page.items.map(x => x.id));
    listed = [...page.items, ...listed.filter(x => !fresh.has(x.id))];
  } else {
    listed = page.items;
    nextCursor = page.nextCursor;
  }
  renderList();
  let operation = null;
  if (navigation.operation) {
    try {
      operation = await call('operations/' + encodeURIComponent(navigation.operation));
    } catch (error) {
      if (current !== revision) return;
      render(null);
      message(error.message, true);
    }
  }
  if (current !== revision) return;
  render(operation);
  if (operation) {
    listed = listed.map(x => (x.id === operation.id ? operation : x));
    renderList();
    if (resetList || historyId !== operation.id || !$('history-panel').open) {
      const events = await call(`operations/${operation.id}/events`);
      if (current !== revision) return;
      historyId = operation.id;
      renderEvents(events, false);
    }
  }
  const devices = await call('devices');
  if (current !== revision) return;
  $('devices-section').hidden = devices.length === 0;
  $('devices').replaceChildren(
    ...devices.map(device => {
      const row = element('div', '');
      row.className = 'device';
      row.append(element('span', device.label + ' · expires ' + new Date(device.expiresAt).toLocaleString()));
      const button = element('button', 'Disconnect');
      button.className = 'secondary';
      button.onclick = async () => {
        button.disabled = true;
        try {
          await call('devices/revoke', { id: device.id, confirmed: true });
          await refresh();
        } catch (error) {
          message(error.message, true);
          button.disabled = false;
        }
      };
      row.append(button);
      return row;
    }),
  );
  scheduleRefresh();
}
function scheduleRefresh() {
  clearTimeout(timer);
  if (!session || !config?.paidOperations) return;
  timer = setTimeout(async () => {
    try {
      if (!document.hidden && !busy) await refresh(false);
    } catch (error) {
      message(error.message, true);
    } finally {
      scheduleRefresh();
    }
  }, 10000);
}
function renderList() {
  $('tasks').replaceChildren(
    ...listed
      .filter(operation => operation.kind !== 'broadcast')
      .map(operation => {
        const button = element('button', operation.input.channelId);
        button.className = 'task';
        button.setAttribute('aria-current', String(operation.id === navigation.operation));
        button.append(element('span', `${states[operation.state] ?? operation.state} · ${operation.input.maxCredits} credits`));
        button.onclick = () => {
          if (busy) return;
          navigation.operation = operation.id;
          saveNavigation();
          $('consent').checked = false;
          renewalId = null;
          render(null);
          $('history').replaceChildren();
          refresh(false).catch(error => message(error.message, true));
        };
        return button;
      }),
  );
  if (!listed.some(operation => operation.kind !== 'broadcast'))
    $('tasks').append(
      element(
        'p',
        $('search').value || $('filter').value !== 'all' ? 'No matching saved cups. Clear the filters to see your other work.' : 'No saved cups yet.',
      ),
    );
  $('more').hidden = !nextCursor;
}
function renderEvents(events, append) {
  if (!append) $('history').replaceChildren();
  for (const event of events) {
    const row = element('li', eventNames[event.kind] ?? 'Task updated');
    const time = element('time', new Date(event.createdAt).toLocaleString());
    time.dateTime = event.createdAt;
    row.append(time);
    $('history').append(row);
  }
  historyBefore = events.length === 50 ? String(events.at(-1).id) : null;
  $('older-history').hidden = !historyBefore;
}
action('signin', async () => {
  saveNavigation();
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/broadcast/tasks/' } });
  if (error) throw error;
});
action('signout', async () => {
  const { error } = await client.auth.signOut();
  if (error) throw error;
});
action('refresh', refresh);
action('more', async () => {
  if (!nextCursor) return;
  const page = await call('operations/page?' + new URLSearchParams({ cursor: nextCursor, filter: $('filter').value, query: $('search').value, limit: '20' }));
  listed.push(...page.items);
  nextCursor = page.nextCursor;
  renderList();
});
action('older-history', async () => {
  if (historyBefore && selected) renderEvents(await call(`operations/${selected.id}/events?before=${historyBefore}`), true);
});
$('filter').addEventListener('change', () => refresh().catch(error => message(error.message, true)));
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refresh().catch(error => message(error.message, true)), 300);
});
action('pair-approve', async () => {
  const result = await call('devices/approve', { id: navigation.device, userCode: navigation.code, confirmed: true });
  delete navigation.device;
  delete navigation.code;
  saveNavigation();
  $('pairing').hidden = true;
  message(`Connected ${result.label}. Return to your agent to continue.`);
  await refresh();
});
$('consent').addEventListener('change', controls);
$('renew-consent').addEventListener('change', controls);
$('new-deadline').addEventListener('change', () => {
  $('renew-consent').checked = false;
  controls();
});
action('renew', async () => {
  if (!$('renew-consent').checked) return;
  const endsAt = new Date($('new-deadline').value);
  if (!Number.isFinite(endsAt.getTime())) throw new Error('Choose a valid deadline.');
  render(await call(`operations/${selected.id}/renew`, { endsAt: endsAt.toISOString(), confirmed: true }));
  message('New deadline approved. The same task and funding are preserved.');
});
action('retry-payment', async () => {
  render(await call(`operations/${selected.id}/retry-payment`, { confirmed: true }));
  message('Verification requested for the original payment.');
});
action('approve', async () => {
  if (!$('consent').checked) return;
  render(await call(`operations/${selected.id}/approve`, { confirmed: true }));
  message('Task approved. Execution starts only when you resume it.');
});
action('checkout', async () => {
  const result = await call(`operations/${selected.id}/checkout`, { confirmed: true });
  render(result.operation);
  if (result.checkout.approvalUrl) {
    const url = new URL(result.checkout.approvalUrl);
    if (url.origin !== 'https://www.sandbox.paypal.com') throw new Error('Invalid PayPal approval address.');
    approvalLink = { id: result.operation.id, url: url.href };
    $('paypal').href = url.href;
    $('paypal').hidden = false;
    message('Open PayPal Sandbox below. After approval, your PC agent can recover this task.');
  } else
    message(
      result.operation.payment?.status === 'credited'
        ? 'Payment already confirmed. Recover the original task.'
        : 'The original payment is being checked. Its status is saved here.',
    );
});
action('verify', async () => {
  render(await call(`operations/${selected.id}/reconcile`, {}));
  message(selected.state === 'ready' ? 'Payment confirmed. Ready to resume.' : 'Payment status checked. See the task status.');
});
action('resume', async () => {
  render(await call(`operations/${selected.id}/resume`, {}));
  message('Original task recovered.');
  await refresh();
});
action('cancel', async () => {
  render(await call(`operations/${selected.id}/cancel`, { confirmed: true }));
  message('Task cancellation recorded. Any running or uncertain job remains tracked.');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session && !busy) refresh().catch(error => message(error.message, true));
});
function authChanged(value) {
  const changed = session?.user.id !== value?.user.id;
  session = value;
  if (changed) {
    epoch++;
    revision++;
    clearTimeout(timer);
    listed = [];
    nextCursor = null;
    approvalLink = null;
    renewalId = null;
    render(null);
    $('history').replaceChildren();
    $('tasks').replaceChildren();
    $('devices').replaceChildren();
    $('devices-section').hidden = true;
    $('consent').checked = false;
  }
  $('account').textContent = value?.user.email ?? '';
  $('pairing').hidden = !navigation.device;
  $('pair-code').textContent = navigation.code ?? '';
  controls();
  message(value ? 'Connected. Your tasks are stored on the server.' : 'Sign in with the same Google account on each device.');
  if (value && config?.paidOperations) setTimeout(() => refresh().catch(error => message(error.message, true)), 0);
}
async function initialize() {
  config = await fetch('/broadcast/config').then(response => response.json());
  if (!config.paidOperations) {
    message('Paid task recovery is not enabled on this server.');
    return;
  }
  if (!config.authConfigured) {
    message('Account connection is not configured.');
    return;
  }
  client = globalThis.supabase.createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: true,
      storage: sessionStorage,
      storageKey: 'oddbout-paid-auth',
      flowType: 'pkce',
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  client.auth.onAuthStateChange((_event, value) => authChanged(value));
  authChanged((await client.auth.getSession()).data.session);
}
initialize().catch(error => message(error.message, true));
