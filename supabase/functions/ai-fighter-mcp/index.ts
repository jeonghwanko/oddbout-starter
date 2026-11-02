import { createClient } from '@supabase/supabase-js';
import { ARENA_URL, createCloudHandler } from '../../../mcp/cloud.mjs';

const url = Deno.env.get('SUPABASE_URL'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !secret) throw new Error('Missing server credentials');
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
// The agent tools (3단계) list only with the arena's agent key (the same secret as oddbout-arena's ODDBOUT_ARENA_AGENT_KEY).
const arenaKey = Deno.env.get('ODDBOUT_ARENA_AGENT_KEY');
// The hosted generation tools (2026-10-28) list only while this secret is '1'; the service switch still decides whether a request is taken.
const hosted = Deno.env.get('ODDBOUT_HOSTED_GENERATION_TOOLS') === '1' ? {} : null;
Deno.serve(createCloudHandler({ db, arena: arenaKey ? { url: ARENA_URL, key: arenaKey } : null, hosted }));
