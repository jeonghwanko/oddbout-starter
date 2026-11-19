// @ts-check
/// <reference path="./site-globals.d.ts" />
// Only the ODDBOUT build consumes these hooks; the shared game's simulation stays unchanged.
export const milestoneVirtualId = 'virtual:oddbout-milestones';
/**
 * @typedef {import('./site-analytics.mjs').SitePlugin} SitePlugin
 */
function bridge() {
  const bouts = new WeakMap();
  /** @param {string} name @param {object | undefined} bout @param {Record<string, unknown>} [parameters] */
  function milestone(name, bout, parameters = {}) {
    if (!bout) return;
    let seen = bouts.get(bout);
    if (!seen) {
      seen = new Set();
      bouts.set(bout, seen);
    }
    if (seen.has(name) || (name === 'match_complete' && !seen.has('game_start'))) return;
    seen.add(name);
    window.dispatchEvent(new CustomEvent('oddbout:milestone', { detail: { name, parameters } }));
  }
  function creationStart() {
    window.dispatchEvent(new CustomEvent('oddbout:milestone', { detail: { name: 'creation_start', parameters: { method: 'request_copy' } } }));
  }
  /** @param {string} name @param {Record<string, string | number>} [parameters] */
  function puddingMilestone(name, parameters = {}) {
    try {
      window.dispatchEvent(new CustomEvent('oddbout:milestone', { detail: { name, parameters } }));
    } catch {
      /* Analytics cannot stop play. */
    }
  }
  /** @param {string} api @param {string} token @param {string} key */
  function bindIdentity(api, token, key) {
    const bind = () => window.oddboutBindAnalytics?.(api, token, key);
    bind();
    window.addEventListener('oddbout:analytics-ready', bind, { once: true });
  }
  return { milestone, creationStart, bindIdentity, puddingMilestone };
}
export const milestoneModule = `const {milestone, creationStart, bindIdentity, puddingMilestone} = (${bridge.toString()})(); export {milestone, creationStart, bindIdentity, puddingMilestone};`;
const targets = {
  '/src/dev/pudding-escape.ts': [
    ['function startRun() {', 'let puddingActiveSeconds = 0;\nfunction startRun() {'],
    [
      "  showPhase('play');",
      "  showPhase('play');\n  puddingActiveSeconds = 0;\n  puddingMilestone('pudding_run_start', { mode: runs === 0 ? 'first' : 'retry' });",
    ],
    ['  tutorialUpdate(fdt);', "  tutorialUpdate(fdt);\n  if (phase === 'play' && !paused && !tf.active) puddingActiveSeconds += fdt;"],
    ['function endRun() {', "function endRun() {\n  if (phase !== 'play') return;"],
    [
      "  showPhase('over');",
      "  showPhase('over');\n  puddingMilestone('pudding_run_end', { distance_m: dist, duration_seconds: puddingActiveSeconds, pudding_form: runStage, result: wasBest ? 'new_best' : 'finished' });",
    ],
    [
      'tf.burst = true; stage += 1; runStage = stage;',
      "tf.burst = true; stage += 1; runStage = stage;\n  puddingMilestone('pudding_transform', { pudding_form: stage });",
    ],
    [
      '      await nav.share(file && nav.canShare?.(withFile) ? withFile : { title: GAME_TITLE, text, url: SHARE_URL });',
      "      await nav.share(file && nav.canShare?.(withFile) ? withFile : { title: GAME_TITLE, text, url: SHARE_URL });\n      puddingMilestone('pudding_share', { method: 'native' });",
    ],
    [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the game's source text to find, its template literal included.
      'await navigator.clipboard.writeText(`${text} ${SHARE_URL}`);',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the game's source text to write, its template literal included.
      "await navigator.clipboard.writeText(`${text} ${SHARE_URL}`); puddingMilestone('pudding_share', { method: 'clipboard' });",
    ],
  ],
  '/src/render/scenes/ArenaDuelScene.ts': [
    [
      'const decided = duel.session.snapshot.result !== null;',
      'const decided = duel.session.snapshot.result !== null;\n        if (!decided) milestone("game_start", duel.session, { mode: this.dataIn.player ? "play" : "watch" });',
    ],
  ],
  // The bout's end moved from the duel scene to its finish controller (2026-11-18 duel scene split); the session is the same object game_start keyed.
  '/src/render/scenes/arena/ArenaDuelFinishController.ts': [
    [
      'finishBout(result: CityFightBoutResult): void {',
      'finishBout(result: CityFightBoutResult): void {\n    milestone("match_complete", this.deps.duel?.session, { result: result.how });',
    ],
  ],
  '/src/render/scenes/ArenaScene.ts': [
    [
      'this.started = true;\n    this.combat.challenge();',
      'this.started = true;\n    milestone("game_start", this.bout, { mode: this.entryData.mode });\n    this.combat.challenge();',
    ],
    [
      'private finish(result: ArenaBoutResult): void {',
      'private finish(result: ArenaBoutResult): void {\n    milestone("match_complete", this.bout, { result: result.how });',
    ],
  ],
  '/src/creator/main.ts': [
    ['await navigator.clipboard.writeText(request.value);', 'await navigator.clipboard.writeText(request.value);\n        creationStart();'],
  ],
  '/src/platform/fighterCreator.ts': [
    [
      'this.user = data.user; this.access = { token, expiresAt: claims.exp };',
      'this.user = data.user; this.access = { token, expiresAt: claims.exp };\n    bindIdentity(this.config.api, token, this.config.key);',
    ],
  ],
};
/** @param {string} code @param {string} id */
export function transformMilestones(code, id) {
  const match = Object.entries(targets).find(([suffix]) => id.replaceAll('\\', '/').endsWith(suffix));
  if (!match) return null;
  let result = code.replaceAll('\r\n', '\n');
  for (const [before, after] of match[1]) {
    if (result.split(before).length !== 2) throw new Error('Review ODDBOUT milestone hook: ' + match[0]);
    result = result.replace(before, after);
  }
  return `import { milestone, creationStart, bindIdentity, puddingMilestone } from '${milestoneVirtualId}';\n` + result;
}
/** @returns {SitePlugin} */
export function milestonePlugin() {
  return {
    name: 'oddbout-milestones',
    enforce: 'pre',
    resolveId(id) {
      if (id === milestoneVirtualId) return '\0oddbout-milestones';
    },
    load(id) {
      if (id === '\0oddbout-milestones') return milestoneModule;
    },
    transform: transformMilestones,
  };
}
