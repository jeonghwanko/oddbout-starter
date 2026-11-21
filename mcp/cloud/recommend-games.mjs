// @ts-check
import { z } from 'zod';
import { chartUrl, reviewedOn, webGames } from './web-game-catalog.mjs';

const conditions = z.enum([
  'action',
  'runner',
  'platformer',
  'sports',
  'management',
  'strategy',
  'board',
  'puzzle',
  'driving',
  'physics',
  'racing',
  'observation',
  'building',
  'merge',
  'local-multiplayer',
  'shared-keyboard',
  'online-multiplayer',
  'one-button',
  'one-hand',
  'phone',
  'guest-play',
  'oddbout',
  'popular',
]);
export const recommendationSchema = {
  required: z
    .array(conditions)
    .max(20)
    .optional()
    .describe(
      'All hard requirements inferred from the request. shared-keyboard means simultaneous players, local-multiplayer includes taking turns. popular means documented presence on the Poki popular list.',
    ),
  preferred: z.array(conditions).max(20).optional().describe('Soft preferences for ranking the qualifying games.'),
  unverifiedRequirements: z
    .array(z.string().min(1).max(120))
    .max(8)
    .optional()
    .describe('Mandatory conditions not represented above, e.g. ad-free, exact round length or a specific language. Never silently drop one.'),
  exclude: z.array(z.string().max(80)).max(30).optional().describe('IDs already rejected in this conversation. Retain the other preferences on follow-ups.'),
  count: z.union([z.literal(2), z.literal(3)]).optional(),
};

/** @param {{required?:string[],preferred?:string[],unverifiedRequirements?:string[],exclude?:string[],count?:number}} args */
export function recommendGames({ required = [], preferred = [], unverifiedRequirements = [], exclude = [], count = 3 } = {}) {
  const candidates = webGames
    .map(game => {
      const traits = [...game.tags, game.studio === 'ODDBOUT' ? 'oddbout' : 'popular'];
      return { game, traits, score: new Set(preferred.filter(tag => traits.includes(tag))).size };
    })
    .filter(({ game, traits }) => !exclude.includes(game.id) && required.every(tag => traits.includes(tag)));
  const picks = [];
  const genres = new Set();
  while (!unverifiedRequirements.length && picks.length < count && candidates.length) {
    candidates.sort((a, b) => b.score - a.score || Number(genres.has(a.game.tags[0])) - Number(genres.has(b.game.tags[0])) || b.game.votes - a.game.votes);
    const [{ game, traits }] = candidates.splice(0, 1);
    genres.add(game.tags[0]);
    const owned = game.studio === 'ODDBOUT';
    picks.push({
      ...game,
      matched: [...new Set([...required, ...preferred])].filter(t => traits.includes(t)),
      launch: owned ? 'embedded' : 'publisher-page',
      evidence: owned ? { reviewedOn } : { reviewedOn, chart: chartUrl, ratingCount: game.votes },
    });
  }
  return {
    ok: true,
    kind: 'web-game-recommendations',
    games: picks,
    required,
    unverifiedRequirements,
    next: picks.length
      ? 'Let the user choose. In text-only clients show each official play URL. Explain the matching controls or genre.'
      : 'Tell the user which requirements were requested and ask which to relax.',
  };
}
