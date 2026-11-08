// @ts-check
// Live, non-publishing checks using the explicitly authorized dedicated reviewer.
// Passwords and OAuth tokens stay in memory; evidence is scrubbed before saving.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

/**
 * @typedef {{ title: string, tool: string, arguments: Record<string, unknown>, response: any, status: 'passed' }} Step  response: the tool's scrubbed JSON
 * @typedef {{ endpoint: string, startedAt: string, presentation: string, account: string, steps: Step[], limitations: string[],
 *   authentication?: string, boundaries?: { unauthenticatedPrivateCall: number, identitySelector: boolean, paymentTools: string[],
 *   registrationRequiresSubmissionId: unknown, finalPublicationMarkedDestructive: unknown }, status?: 'passed' | 'failed', failure?: string,
 *   testGrantRevoked?: boolean, finishedAt?: string }} Evidence
 */

const credentialPath = process.env.ODDBOUT_REVIEW_CREDENTIAL_FILE;
if (!credentialPath) throw new Error('ODDBOUT_REVIEW_CREDENTIAL_FILE is required');
const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
assert.equal(credentials.email, 'turbo08+oddbout-review@gmail.com');
const supabase = 'https://ztfxxhtmtrvxvuxlqmgz.supabase.co';
const endpoint = 'https://mcp.oddbout.com/mcp';
const expectedFighterId = process.env.ODDBOUT_REVIEW_EXPECTED_FIGHTER_ID;
const expectedSubmissionId = process.env.ODDBOUT_REVIEW_EXPECTED_SUBMISSION_ID;
const expectedManifestSha = process.env.ODDBOUT_REVIEW_EXPECTED_MANIFEST_SHA256;
if (expectedFighterId || expectedSubmissionId || expectedManifestSha) {
  assert.match(expectedFighterId ?? '', /^[a-f0-9-]{36}$/);
  assert.match(expectedSubmissionId ?? '', /^[a-f0-9-]{36}$/);
  assert.match(expectedManifestSha ?? '', /^[a-f0-9]{64}$/);
}
const client = createClient(supabase, 'sb_publishable_6UkV7tRAQ1P4qss5cTYSwQ_kVxSIv_V', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
/** @type {Evidence} */
const evidence = {
  endpoint,
  startedAt: new Date().toISOString(),
  presentation: 'Actual hosted MCP protocol checks, not a ChatGPT conversation recording',
  account: 'Dedicated review account',
  steps: [],
  limitations: [
    'No character generation, visual approval or public registration.',
    'Host file attachment transfer and a successful full registration are not exercised here.',
    'Negative checks verify server boundaries; they do not certify model responses to prompts.',
  ],
};
const out = path.resolve(process.argv[2] || 'output/cloud-review/evidence.json');
let /** @type {string | undefined} */ oauthClient,
  /** @type {string | undefined} */ accessToken,
  seq = 1;
/** @type {(data: unknown) => any} */
const scrub = data =>
  JSON.parse(JSON.stringify(data).replaceAll(credentials.email, '<REVIEW_ACCOUNT_EMAIL>').replaceAll(credentials.id, '<REVIEW_ACCOUNT_ID>'));
/** @param {string} method @param {object} params @param {string | null} [token] */
async function rpc(method, params, token = accessToken) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: seq++, method, params }),
  });
  return { status: response.status, body: await response.json() };
}
/** @param {string} title @param {string} tool @param {Record<string, unknown>} args @param {(value: any) => void} verify  value: the tool's JSON result */
async function step(title, tool, args, verify) {
  const result = await rpc('tools/call', { name: tool, arguments: args });
  assert.equal(result.status, 200);
  // A host other than ChatGPT gets the tool's JSON as the text only (MCP 최적화 2026-11-05); get_profile's is structured too.
  const answer = result.body.result,
    text = answer?.content?.[0]?.text;
  let value = answer?.structuredContent ?? answer;
  if (!answer?.structuredContent && typeof text === 'string') {
    try {
      value = JSON.parse(text);
    } catch {
      /* not JSON: the result itself */
    }
  }
  verify(value);
  evidence.steps.push({ title, tool, arguments: args, response: scrub(value), status: 'passed' });
  console.log(JSON.stringify({ title, status: 'passed' }));
  return value;
}
try {
  const signedIn = await client.auth.signInWithPassword({ email: credentials.email, password: credentials.password });
  assert.ok(!signedIn.error && signedIn.data.session, 'Dedicated reviewer sign-in failed');
  assert.equal(signedIn.data.user.id, credentials.id);
  const discovery = await (await fetch(supabase + '/auth/v1/.well-known/oauth-authorization-server')).json();
  const redirectUri = 'https://oddbout.com/cloud-plugin/review-callback.html';
  const registered = await fetch(discovery.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ODDBOUT isolated review checks',
      client_uri: 'https://oddbout.com/cloud-plugin/',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  assert.ok(registered.ok, `Review client registration HTTP ${registered.status}`);
  const registration = await registered.json();
  oauthClient = registration.client_id;
  assert.ok(oauthClient, 'No review client ID');
  const verifier = randomBytes(48).toString('base64url'),
    state = randomBytes(24).toString('base64url');
  const authorize = new URL(discovery.authorization_endpoint);
  authorize.search = /** @type {any} */ (
    new URLSearchParams({
      client_id: oauthClient,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })
  ); // set as its string
  const start = await fetch(authorize, { redirect: 'manual' });
  assert.ok([302, 303].includes(start.status), `Review authorization HTTP ${start.status}`);
  const consent = new URL(/** @type {string} */ (start.headers.get('location')));
  assert.equal(consent.origin, 'https://oddbout.com');
  const authorizationId = consent.searchParams.get('authorization_id');
  assert.ok(authorizationId);
  const details = await client.auth.oauth.getAuthorizationDetails(authorizationId);
  assert.ok(!details.error && details.data, 'Review consent details unavailable');
  assert.equal(/** @type {import('@supabase/supabase-js').OAuthAuthorizationDetails} */ (details.data).redirect_uri, redirectUri);
  const approved = await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  assert.ok(!approved.error && approved.data?.redirect_url, 'Review consent failed');
  const callback = new URL(approved.data.redirect_url);
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), state);
  const exchanged = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: /** @type {string} */ (callback.searchParams.get('code')),
      client_id: oauthClient,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  assert.ok(exchanged.ok, `Review token exchange HTTP ${exchanged.status}`);
  accessToken = (await exchanged.json()).access_token;
  assert.ok(accessToken);
  evidence.authentication = 'Normal password login, dedicated OAuth client, PKCE S256, explicit test-account consent';
  await step('Identify connected account', 'get_profile', {}, r => assert.equal(r.id, credentials.id));
  await step('Check cloud registration access', 'check_creation_readiness', { purpose: 'registration' }, r => {
    assert.equal(r.ok, true);
    assert.equal(r.registration.requiresPc, false);
    assert.equal(r.registration.status, 'ready');
    assert.equal(r.generation.status, 'unverified');
    assert.equal(r.package.status, 'unverified');
  });
  await step('Read fighter requirements', 'get_fighter_spec', { section: 'overview' }, r => assert.equal(r.ok, true));
  await step('List owned fighters', 'list_my_fighters', {}, r => {
    assert.equal(r.ok, true);
    if (expectedFighterId)
      assert.deepEqual(
        /** @type {any[]} */ (r.fighters).map(f => f.id),
        [expectedFighterId],
      );
    else assert.deepEqual(r.fighters, []);
  });
  if (expectedFighterId) {
    if (process.env.ODDBOUT_REVIEW_CHECK_DELETION === '1') {
      const prepared = await step('Prepare owned deletion without executing it', 'prepare_fighter_deletion', { fighterId: expectedFighterId }, r => {
        assert.equal(r.ok, true);
        assert.equal(r.stage, 'confirmation-required');
        assert.equal(r.account.id, credentials.id);
        assert.equal(r.effects.retainPrivatePackageAndHistory, true);
      });
      await step(
        'Reject a forged deletion confirmation',
        'delete_fighter',
        {
          fighterId: expectedFighterId,
          confirmationToken: crypto.randomUUID(),
          confirmName: prepared.confirmName,
          confirm: true,
        },
        r => {
          assert.equal(r.ok, false);
          assert.equal(r.code, 'invalid-deletion-confirmation');
        },
      );
      await step(
        'Reject the wrong confirmation name',
        'delete_fighter',
        {
          fighterId: expectedFighterId,
          confirmationToken: prepared.confirmationToken,
          confirmName: 'Wrong confirmation name',
          confirm: true,
        },
        r => {
          assert.equal(r.ok, false);
          assert.equal(r.code, 'deletion-name-mismatch');
        },
      );
      const foreign = process.env.ODDBOUT_REVIEW_FOREIGN_FIGHTER_ID;
      if (foreign)
        await step('Reject another account’s fighter', 'prepare_fighter_deletion', { fighterId: foreign }, r => {
          assert.equal(r.ok, false);
          assert.equal(r.code, 'not-found');
        });
      // Confirmation tokens are not credentials, but keep them out of saved/public evidence too.
      for (const entry of evidence.steps) {
        if (entry.response?.confirmationToken) entry.response.confirmationToken = '<REDACTED>';
        if (entry.arguments?.confirmationToken) entry.arguments.confirmationToken = '<REDACTED>';
      }
    }
    await step('Verify the native Dots registration through the public gateway', 'get_fighter_submission', { submissionId: expectedSubmissionId }, r => {
      assert.equal(r.ok, true);
      assert.equal(r.stage, 'registered');
      assert.equal(r.fighterId, expectedFighterId);
      assert.equal(r.manifestSha256, expectedManifestSha);
      assert.equal(r.runtimeApproved, true);
    });
    await step('Verify the immutable registered fighter', 'get_registered_fighter', { fighterId: expectedFighterId }, r => {
      assert.equal(r.ok, true);
      assert.equal(r.fighter.id, expectedFighterId);
      assert.equal(r.fighter.submission_id, expectedSubmissionId);
      assert.equal(r.fighter.manifest_sha, expectedManifestSha);
      assert.equal(r.fighter.profile.name, 'ODDBOUT Review Test');
      assert.equal(r.fighter.runtime_approved, true);
    });
  }
  await step('Handle an unknown submission accurately', 'get_fighter_submission', { submissionId: '00000000-0000-4000-8000-000000000000' }, r => {
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not-found');
  });
  const tools = /** @type {any[]} */ ((await rpc('tools/list', {})).body.result.tools);
  const denied = await rpc('tools/call', { name: 'get_profile', arguments: {} }, null);
  assert.equal(denied.status, 401);
  evidence.boundaries = {
    unauthenticatedPrivateCall: 401,
    identitySelector: tools.some(t => Object.keys(t.inputSchema.properties ?? {}).some(k => ['email', 'owner', 'ownerId', 'userId'].includes(k))),
    paymentTools: tools.filter(t => /payment|purchase|subscription/i.test(t.name)).map(t => t.name),
    registrationRequiresSubmissionId: tools.find(t => t.name === 'submit_fighter_registration').inputSchema.required,
    finalPublicationMarkedDestructive: tools.find(t => t.name === 'submit_fighter_registration').annotations.destructiveHint,
  };
  assert.equal(evidence.boundaries.identitySelector, false);
  assert.deepEqual(evidence.boundaries.paymentTools, []);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = error instanceof assert.AssertionError ? error.message : 'Live review check failed';
  console.error(evidence.failure);
  process.exitCode = 1;
} finally {
  if (oauthClient) {
    const revoked = await client.auth.oauth.revokeGrant({ clientId: oauthClient });
    evidence.testGrantRevoked = !revoked.error;
  }
  await client.auth.signOut({ scope: 'local' });
  evidence.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, steps: evidence.steps.length, evidence: out, testGrantRevoked: evidence.testGrantRevoked }));
}
