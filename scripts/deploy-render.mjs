// @ts-check
import { fileURLToPath } from 'node:url';
import { git, waitForJson } from './hosting-lib.mjs';

const [commit, option, ...extra] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(commit ?? '') || extra.length || (option && option !== '--dry-run')) {
  throw new Error('Usage: node scripts/deploy-render.mjs <full-reviewed-commit-sha> [--dry-run]');
}
const root = fileURLToPath(new URL('../', import.meta.url));
if (git(root, 'rev-parse', 'HEAD') !== commit || git(root, 'status', '--porcelain', '--untracked-files=no')) {
  throw new Error('Deploy only the clean commit that was checked out and tested');
}
if (option === '--dry-run') {
  console.log(JSON.stringify({ status: 'verified-only', commit, service: 'ai-fighter-validator' }));
} else {
  let hook;
  try {
    hook = new URL(/** @type {string} */ (process.env.AI_FIGHTER_RENDER_DEPLOY_HOOK));
  } catch {
    throw new Error('Missing Render deploy hook');
  }
  if (
    hook.origin !== 'https://api.render.com' ||
    hook.pathname !== '/deploy/srv-dbbohr8m7kps73flja7g' ||
    hook.username ||
    hook.password ||
    !hook.searchParams.get('key')
  )
    throw new Error('Unexpected Render deploy hook');
  hook.searchParams.set('ref', commit);
  let response;
  try {
    response = await fetch(hook, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error('Render deploy request failed; check the dashboard before retrying (outcome unknown)');
  }
  if (!response.ok) throw new Error(`Render deploy rejected (${response.status})`);
  console.log(JSON.stringify({ status: 'accepted', commit }));
  // The previous deployment may still return 200 while the new one builds.
  await waitForJson('https://ai-fighter-validator.onrender.com/health', body => body.ok && body.commit === commit);
  console.log(JSON.stringify({ status: 'live', commit, url: 'https://ai-fighter-validator.onrender.com' }));
}
