// @ts-check
/** Deploy through the supported REST API using github-script's current SDK, without deploy-pages' deprecated punycode dependency.
 * @param {{github: any, core: any, context: any}} action
 * @param {string} artifactId
 * @param {string} sha
 * @param {{sleep?: (ms: number) => Promise<void>, now?: () => number, timeoutMs?: number}} options
 */
export async function deployPages({ github, core, context }, artifactId, sha, options = {}) {
  if (!/^\d+$/.test(artifactId) || !/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid Pages artifact or commit');
  const repo = context.repo;
  const head = await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { ...repo, ref: 'heads/codex/creator-pages' });
  if (head.data.object.sha !== sha) throw Error('Pages branch changed; refusing a stale deployment');
  const created = await github.request('POST /repos/{owner}/{repo}/pages/deployments', {
    ...repo, artifact_id: Number(artifactId), pages_build_version: context.sha, oidc_token: await core.getIDToken(),
  });
  const deployment_id = created.data.id;
  core.setOutput('page_url', created.data.page_url);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (options.timeoutMs ?? 600_000);
  let status = 'deployment_in_progress';
  try {
    while (now() < deadline) {
      const response = await github.request('GET /repos/{owner}/{repo}/pages/deployments/{deployment_id}', {
        ...repo, deployment_id, request: { timeout: 30_000 },
      });
      status = response.data.status || 'unknown';
      core.info(`Pages deployment ${deployment_id}: ${status}`);
      if (status === 'succeed') return;
      if (['deployment_failed', 'deployment_content_failed', 'deployment_cancelled', 'deployment_lost'].includes(status)) {
        throw Error(`Pages deployment failed: ${status}`);
      }
      await sleep(15_000);
    }
    throw Error(`Pages timed out in ${status}; inspect this deployment before retrying`);
  } catch (error) {
    await github.request('POST /repos/{owner}/{repo}/pages/deployments/{deployment_id}/cancel', { ...repo, deployment_id })
      .catch(() => core.warning('Pages cancellation could not be confirmed; inspect the deployment status'));
    throw error;
  }
}
