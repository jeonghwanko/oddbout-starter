import { createClient } from '@supabase/supabase-js';
import { createHandler } from '../../../api/handler.mjs';
import { timedFetch } from '../../../api/http.mjs';
import { createRegistrationAnalytics } from '../../../api/registration-analytics.mjs';
import { createCreatorLink } from '../../../api/creator-link.mjs';
import { simulateDuel, engineVersion } from './duel-engine.mjs';
import { engines } from './duel-engines.mjs';
import { release } from './release.mjs';
import { createClientLimiter } from '../../../api/client-limit.mjs';
import { createDecisionsReviewer } from '../../../api/decisions-review.mjs';
import { createResponsesBenchmarkReviewer } from '../../../api/responses-benchmark.mjs';
import { createLunaSolReviewer } from '../../../api/luna-sol-review.mjs';

const url = Deno.env.get('SUPABASE_URL');
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !secret) throw new Error('Missing server credentials');
// Every database, Storage and Auth call ends by DATABASE_TIMEOUT_MS, as in ai-fighter-mcp (the routes are the same handler's).
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch() } });
// Per-caller brakes stay off until AI_FIGHTER_CLIENT_IP_SOURCE names a header verified with spoofed requests (api/client-limit.mjs).
const limiter = createClientLimiter({ db, secret: Deno.env.get('AI_FIGHTER_CLIENT_LIMIT_SECRET'), source: Deno.env.get('AI_FIGHTER_CLIENT_IP_SOURCE') });
Deno.serve(
  createHandler({
    db,
    simulateDuel,
    engineVersion,
    engines,
    release,
    embed: {
      enabled: Deno.env.get('ODDBOUT_CHATGPT_GAME_LAUNCHER') === '1',
      gameOrigin: Deno.env.get('ODDBOUT_CHATGPT_GAME_ORIGIN') ?? '',
    },
    limiter,
    creatorLink: createCreatorLink({ db }),
    cascadeReviewer: createLunaSolReviewer({ apiKey: Deno.env.get('ODDBOUT_DECISIONS_API_KEY'), enabled: Deno.env.get('ODDBOUT_DECISIONS_MODE') === 'shadow' }),
    decisionsReviewer: createDecisionsReviewer({
      apiKey: Deno.env.get('ODDBOUT_DECISIONS_API_KEY'),
      enabled: Deno.env.get('ODDBOUT_DECISIONS_MODE') === 'shadow',
    }),
    responsesReviewer: createResponsesBenchmarkReviewer({
      apiKey: Deno.env.get('ODDBOUT_DECISIONS_API_KEY'),
      enabled: Deno.env.get('ODDBOUT_DECISIONS_MODE') === 'shadow',
    }),
    analytics: createRegistrationAnalytics({ db, measurementId: Deno.env.get('GA4_MEASUREMENT_ID'), apiSecret: Deno.env.get('GA4_API_SECRET') }),
  }),
);
