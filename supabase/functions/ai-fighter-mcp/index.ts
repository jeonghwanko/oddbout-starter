import { createClient } from '@supabase/supabase-js';
import { ARENA_URL, createCloudHandler, timedFetch } from '../../../mcp/cloud.mjs';

const url = Deno.env.get('SUPABASE_URL'),
  secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !secret) throw new Error('Missing server credentials');
// Every database, Storage and Auth call ends by DATABASE_TIMEOUT_MS (2026-11-03): supabase-js sets no limit of its own.
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch() } });
// The agent tools (3단계) list only with the arena's agent key (the same secret as oddbout-arena's ODDBOUT_ARENA_AGENT_KEY).
const arenaKey = Deno.env.get('ODDBOUT_ARENA_AGENT_KEY');
// The hosted generation tools (2026-10-28) list only while this secret is '1'; the service switch still decides whether a request is taken.
const hosted = Deno.env.get('ODDBOUT_HOSTED_GENERATION_TOOLS') === '1' ? {} : null;
// Embedded ChatGPT launch stays disabled unless both operator settings are present and validated by the MCP server.
const gameLauncherConfig = {
  enabled: Deno.env.get('ODDBOUT_CHATGPT_GAME_LAUNCHER') === '1',
  gameUrl: Deno.env.get('ODDBOUT_CHATGPT_GAME_URL') ?? '',
};
Deno.serve(createCloudHandler({ db, arena: arenaKey ? { url: ARENA_URL, key: arenaKey } : null, hosted, gameLauncherConfig }));
