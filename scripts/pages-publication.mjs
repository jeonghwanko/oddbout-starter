// @ts-check
import { execFileSync } from 'node:child_process';

const repository = 'jeonghwanko/oddbout-starter';
/** Request publication of an already verified, pushed tree. Legacy Pages publishes on push. */
export function requestPagesPublication(/** @type {string} */ sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Pages publication requires a full commit SHA');
  const env = { ...process.env };
  if (env.AI_FIGHTER_PAGES_TOKEN) env.GH_TOKEN = env.AI_FIGHTER_PAGES_TOKEN;
  const site = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/pages`], { encoding: 'utf8', env }));
  if (site.build_type === 'legacy') return;
  if (site.build_type !== 'workflow') throw Error('Unknown Pages publication mode');
  execFileSync('gh', ['api', '--method', 'POST', `repos/${repository}/actions/workflows/pages.yml/dispatches`, '--input', '-'], {
    input: JSON.stringify({ ref: 'main', inputs: { pages_sha: sha } }),
    encoding: 'utf8',
    env,
  });
  console.log(`Requested Pages publication: ${sha}`);
}
