const $ = id => document.getElementById(id);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const query = new URLSearchParams(location.search), fragment = new URLSearchParams(location.hash.slice(1));
const storageKey = 'oddbout-paid-task-navigation';
let navigation = {};
try { navigation = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}'); } catch { /* Navigation is optional, never auth. */ }
if (UUID.test(query.get('operation') ?? '')) navigation.operation = query.get('operation');
if (UUID.test(fragment.get('device') ?? '') && /^[A-F0-9]{8}$/.test(fragment.get('code') ?? '')) {
  navigation.device = fragment.get('device'); navigation.code = fragment.get('code');
  history.replaceState(null, '', location.pathname + location.search);
}
function saveNavigation() { try { sessionStorage.setItem(storageKey, JSON.stringify(navigation)); } catch { /* Server discovery still works. */ } }
saveNavigation();
let client, session, config, selected, approvalLink, epoch = 0, revision = 0, busy = false, timer;
const states = { awaiting_approval: 'Review needed', awaiting_payment: 'Funding needed', ready: 'Ready to resume', queued: 'Queued',
  running: 'Running', completed: 'Completed', failed: 'Execution failed', needs_reconciliation: 'Outcome unknown — held',
  cancelled: 'Cancelled', expired: 'Approval window expired', blocked: 'Payment needs reconciliation' };
const errors = { 'not-found':'This task or connection is not available to this account.',
  'approval-expired':'The approval deadline has passed. Your original task and payment records are preserved.',
  'device-expired':'This connection expired. Start a new connection from your agent.',
  'wallet-frozen':'A payment adjustment needs reconciliation before further spending.',
  'checkout-needs-reconciliation':'The original checkout needs review. No replacement payment was created.',
  'checkout-outcome-unknown':'The original payment status is not known yet. Check this same task again.',
  'operation-not-payable':'This task cannot start a checkout in its current state.',
  'insufficient-credits':'There are not enough available credits for this task.',
  'web-approval-required':'Review and approve this action on this page.',
  'authentication-required':'Sign in again to view your saved tasks.' };
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function controls() {
  $('signin').disabled = !client || busy; $('signin').hidden = Boolean(session); $('signout').hidden = !session;
  for (const id of ['refresh','pair-approve','approve','checkout','verify','resume','cancel']) $(id).disabled = !session || !config?.paidOperations || busy || (id === 'approve' && !$('consent').checked);
}
async function call(path, body) {
  if (!session) throw new Error('Sign in with the same Google account used for this task.');
  const scope = epoch;
  const response = await fetch('/paid-operations/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + session.access_token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (scope !== epoch) throw new Error('Account changed. Reload your own tasks.');
  if (!response.ok || !result.ok) throw new Error(errors[result.code] ?? 'Request unavailable. The original task is retained; check again before starting anything new.');
  return result.data;
}
function action(id, callback) {
  $(id).addEventListener('click', async () => {
    if (busy) return;
    const scope = epoch; busy = true; revision++; clearTimeout(timer); controls();
    try { await callback(); }
    catch (error) { if (scope === epoch) message(error.message, true); }
    finally { busy = false; controls(); }
  });
}
function element(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function render(operation) {
  selected = operation; $('detail').hidden = !operation;
  if (approvalLink?.id === operation?.id && operation?.state === 'awaiting_payment') {
    $('paypal').href=approvalLink.url; $('paypal').hidden=false;
  } else { $('paypal').hidden = true; $('paypal').removeAttribute('href'); }
  if (!operation) return;
  const input = operation.input, state = operation.state;
  $('state').textContent = states[state] ?? state; $('task-title').textContent = input.channelId;
  const fields = [['Task','One cup · three rendered bouts'], ['Cost',`${input.maxCredits} credits on verified completion`],
    ['Host',input.hostId], ['Fighters',input.fighterIds.join(' / ')], ['Deadline',new Date(input.endsAt).toLocaleString()],
    ['Balance',`${operation.availableCredits} available credits`],
    ['Funding',operation.payment ? `${operation.payment.status} · $${(operation.payment.amountCents/100).toFixed(2)} Sandbox / ${operation.payment.credits} credits` : 'Existing credits, or $10 Sandbox for 1,000 credits']];
  $('summary').replaceChildren(...fields.flatMap(([label,value]) => [element('dt',label),element('dd',value)]));
  $('approval').hidden = state !== 'awaiting_approval';
  $('checkout').hidden = state !== 'awaiting_payment';
  $('checkout').textContent = operation.payment ? 'Continue the same PayPal checkout' : 'Add $10 Sandbox · 1,000 credits';
  $('verify').hidden = !operation.payment || operation.payment.status === 'credited';
  $('resume').hidden = state !== 'ready';
  $('cancel').hidden = ['completed','failed','cancelled','expired'].includes(state);
  $('next-step').textContent = ({ awaiting_approval: 'Review the fixed task above. Approval does not start execution.',
    awaiting_payment: 'Funding and task approval are separate. After payment, resume this task from your PC agent.',
    ready: 'Ready. Your PC agent can find this task and resume it without another payment.',
    queued: 'The original job is queued. Repeated recovery returns this same job.', running: 'The original job is running. You can close this page.',
    needs_reconciliation: 'The execution outcome is unknown. Funds remain held; recovery will not launch a replacement.',
    blocked: 'A payment adjustment needs reconciliation. Further execution is blocked.',
    expired: 'The approved deadline cannot be extended by recovery. Any confirmed credit purchase remains in your wallet.',
    failed: 'This job was not charged. Recovery returns its recorded failure; it does not silently retry.',
    cancelled: 'New execution is stopped. A job already running can still finish and settle.' })[state] ?? 'Your result is saved to your account.';
  $('result').hidden = !operation.job;
  $('winner').textContent = state === 'completed' ? `Winner: ${operation.job.result?.winnerId ?? 'See evidence'}` : '';
  $('evidence').textContent = JSON.stringify({ operationId: operation.id, approvalId: operation.approvalId, approvedAt: operation.approvedAt,
    payment: operation.payment, broadcastId: operation.broadcastId, job: operation.job }, null, 2);
  controls();
}
async function refresh() {
  clearTimeout(timer);
  const current = ++revision, list = await call('operations');
  if (current !== revision) return;
  $('tasks').replaceChildren(...list.map(operation => {
    const button = element('button', operation.input.channelId); button.className = 'task';
    button.setAttribute('aria-current', String(operation.id === navigation.operation));
    button.append(element('span', `${states[operation.state] ?? operation.state} · ${operation.input.maxCredits} credits`));
    button.onclick = () => { if (busy) return; navigation.operation = operation.id; saveNavigation(); $('consent').checked = false; refresh().catch(error => message(error.message, true)); };
    return button;
  }));
  if (!list.length) $('tasks').append(element('p','No saved tasks yet. Ask your connected agent to prepare one.'));
  const operation = navigation.operation ? await call('operations/' + encodeURIComponent(navigation.operation)) : null;
  if (current !== revision) return;
  render(operation);
  const devices = await call('devices');
  if (current !== revision) return;
  $('devices-section').hidden = devices.length === 0;
  $('devices').replaceChildren(...devices.map(device => {
    const row = element('div',''); row.className = 'device'; row.append(element('span',device.label));
    const button = element('button','Disconnect'); button.className = 'secondary';
    button.onclick = async () => { button.disabled = true; try { await call('devices/revoke',{id:device.id,confirmed:true}); await refresh(); } catch(error) { message(error.message,true); button.disabled=false; } };
    row.append(button); return row;
  }));
  timer = setTimeout(() => { if (session && !document.hidden && !busy) refresh().catch(error => message(error.message,true)); }, 10000);
}
action('signin', async () => {
  saveNavigation();
  const {error} = await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/broadcast/tasks/'}});
  if (error) throw error;
});
action('signout', async () => { const {error} = await client.auth.signOut(); if(error) throw error; });
action('refresh', refresh);
action('pair-approve', async () => {
  const result = await call('devices/approve',{id:navigation.device,userCode:navigation.code,confirmed:true});
  delete navigation.device; delete navigation.code; saveNavigation(); $('pairing').hidden=true;
  message(`Connected ${result.label}. Return to your agent to continue.`); await refresh();
});
$('consent').addEventListener('change',controls);
action('approve', async () => { if (!$('consent').checked) return; render(await call(`operations/${selected.id}/approve`,{confirmed:true})); message('Task approved. Execution starts only when you resume it.'); });
action('checkout', async () => {
  const result = await call(`operations/${selected.id}/checkout`,{confirmed:true}); render(result.operation);
  if (result.checkout.approvalUrl) {
    const url = new URL(result.checkout.approvalUrl);
    if (url.origin !== 'https://www.sandbox.paypal.com') throw new Error('Invalid PayPal approval address.');
    approvalLink={id:result.operation.id,url:url.href}; $('paypal').href=url.href; $('paypal').hidden=false;
    message('Open PayPal Sandbox below. After approval, your PC agent can recover this task.');
  } else message('Payment already confirmed. Recover the original task.');
});
action('verify', async () => { render(await call(`operations/${selected.id}/reconcile`,{})); message(selected.state==='ready'?'Payment confirmed. Ready to resume.':'Payment status checked. See the task status.'); });
action('resume', async () => { render(await call(`operations/${selected.id}/resume`,{})); message('Original task recovered.'); await refresh(); });
action('cancel', async () => { render(await call(`operations/${selected.id}/cancel`,{confirmed:true})); message('Task cancellation recorded. Any running or uncertain job remains tracked.'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && !busy) refresh().catch(error=>message(error.message,true)); });
function authChanged(value) {
  const changed = session?.user.id !== value?.user.id;
  session = value;
  if (changed) { epoch++; revision++; clearTimeout(timer); approvalLink=null; render(null); $('tasks').replaceChildren(); $('devices').replaceChildren(); $('devices-section').hidden=true; $('consent').checked=false; }
  $('account').textContent = value?.user.email ?? '';
  $('pairing').hidden = !navigation.device; $('pair-code').textContent = navigation.code ?? '';
  controls(); message(value ? 'Connected. Your tasks are stored on the server.' : 'Sign in with the same Google account on each device.');
  if (value && config?.paidOperations) setTimeout(()=>refresh().catch(error=>message(error.message,true)),0);
}
async function initialize() {
  config = await fetch('/broadcast/config').then(response=>response.json());
  if (!config.paidOperations) { message('Paid task recovery is not enabled on this server.'); return; }
  if (!config.authConfigured) { message('Account connection is not configured.'); return; }
  client = globalThis.supabase.createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:true}});
  client.auth.onAuthStateChange((_event,value)=>authChanged(value));
  authChanged((await client.auth.getSession()).data.session);
}
initialize().catch(error=>message(error.message,true));
