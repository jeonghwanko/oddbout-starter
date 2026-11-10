import assert from 'node:assert/strict';
import test from 'node:test';
import { deployPages } from '../scripts/pages-deploy.mjs';

const sha = 'a'.repeat(40);
function fixture(statuses, current = sha) {
  const calls = [], logs = [];
  let clock = 0;
  return {
    calls, logs,
    action: {
      context: { repo: { owner: 'test', repo: 'site' }, sha: 'c'.repeat(40) },
      core: { getIDToken: async () => 'private-token', info: value => logs.push(value), warning: value => logs.push(value), setOutput() {} },
      github: { async request(route, args) {
        calls.push({ route, args });
        if (route.includes('/git/ref/')) return { data: { object: { sha: current } } };
        if (route.endsWith('/cancel')) return {};
        if (route.startsWith('POST')) return { data: { id: 'deployment-1', page_url: 'https://example.com' } };
        return { data: { status: statuses.shift() ?? 'syncing_files' } };
      } },
    },
    options: { now: () => clock, sleep: async ms => { clock += ms; }, timeoutMs: 30_000 },
  };
}
test('publishes the supplied artifact and recognizes success without logging credentials', async () => {
  const f = fixture(['syncing_files', 'succeed']);
  await deployPages(f.action, '123', sha, f.options);
  assert.equal(f.calls[1].args.artifact_id, 123);
  assert.equal(f.calls[1].args.pages_build_version, f.action.context.sha);
  assert.equal(f.calls[1].args.oidc_token, 'private-token');
  assert.equal(f.calls.some(call => call.route.endsWith('/cancel')), false);
  assert.equal(f.logs.join('').includes('private-token'), false);
});
test('refuses a stale branch before requesting an OIDC token or deployment', async () => {
  const f = fixture([], 'b'.repeat(40));
  await assert.rejects(deployPages(f.action, '123', sha, f.options), /stale deployment/);
  assert.equal(f.calls.length, 1);
});
test('rejects malformed input before contacting GitHub', async () => {
  const f = fixture([]);
  await assert.rejects(deployPages(f.action, 'oops', sha, f.options), /Invalid/);
  assert.equal(f.calls.length, 0);
});
test('reports a terminal content failure and cancels only its own deployment', async () => {
  const f = fixture(['deployment_content_failed']);
  await assert.rejects(deployPages(f.action, '123', sha, f.options), /deployment_content_failed/);
  assert.equal(f.calls.at(-1).args.deployment_id, 'deployment-1');
  assert.match(f.calls.at(-1).route, /cancel$/);
});
test('bounds polling and reports the stalled phase on timeout', async () => {
  const f = fixture(['syncing_files']);
  await assert.rejects(deployPages(f.action, '123', sha, f.options), /timed out in syncing_files/);
  assert.match(f.calls.at(-1).route, /cancel$/);
});
