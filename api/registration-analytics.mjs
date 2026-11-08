// @ts-check
import { jsonResponse, Problem, readBody } from './http.mjs';
/** @type {(value: unknown) => boolean} */
export const validClient = value => typeof value === 'string' && /^\d{1,20}\.\d{1,20}$/.test(value);
const cors = { methods: 'POST, OPTIONS', headers: 'authorization, apikey, content-type' };

/**
 * @param {{ db: any, measurementId?: string, apiSecret?: string, send?: typeof fetch }} options
 * @returns {import('./http.mjs').Analytics}
 */
export function createRegistrationAnalytics({ db, measurementId, apiSecret, send = fetch }) {
  /** @param {Request} request @param {string} owner */
  async function context(request, owner) {
    if (request.method === 'OPTIONS') return jsonResponse({ ok: true }, 200, cors);
    if (request.method !== 'POST') throw new Problem(405, 'method-not-allowed');
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(await readBody(request, 512)));
    } catch {
      throw new Problem(400, 'invalid-analytics-context');
    }
    if (!body || !Object.keys(body).every(key => ['clientId', 'sessionId', 'enabled'].includes(key))) throw new Problem(400, 'invalid-analytics-context');
    if (body.enabled === false) {
      const { error } = await db.from('af_analytics_context').delete().eq('owner_id', owner);
      if (error) throw new Problem(503, 'analytics-unavailable');
      await db.from('af_analytics_outbox').update({ status: 'cancelled' }).eq('owner_id', owner).eq('status', 'pending');
    } else {
      if (body.enabled !== true || !validClient(body.clientId) || !/^\d{1,20}$/.test(body.sessionId ?? '')) throw new Problem(400, 'invalid-analytics-context');
      const { error } = await db
        .from('af_analytics_context')
        .upsert({ owner_id: owner, client_id: body.clientId, session_id: body.sessionId, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
      if (error) throw new Problem(503, 'analytics-unavailable');
    }
    return jsonResponse({ ok: true, stage: 'analytics-context' }, 200, cors);
  }
  /** @param {{ id: string, status: string } | null} row  The submission row as its registration left it. */
  async function registered(row) {
    if (row?.status !== 'registered' || !apiSecret || !/^G-[A-Z0-9]+$/.test(measurementId ?? '')) return;
    // Atomic claim: repeated worker receipts and concurrent requests cannot send this registration twice.
    const { data, error } = await db
      .from('af_analytics_outbox')
      .update({ status: 'sending' })
      .eq('submission_id', row.id)
      .eq('status', 'pending')
      .select('submission_id,client_id,session_id,created_at')
      .maybeSingle();
    if (error || !data) return;
    const url = new URL('https://www.google-analytics.com/mp/collect');
    // measurementId matched the G- pattern above, so it is a string.
    url.searchParams.set('measurement_id', /** @type {string} */ (measurementId));
    url.searchParams.set('api_secret', apiSecret);
    /** @type {{ event_source: string, engagement_time_msec: number, session_id?: number }} */
    const params = { event_source: 'server', engagement_time_msec: 1 };
    if (data.session_id && Number.isSafeInteger(Number(data.session_id))) params.session_id = Number(data.session_id);
    try {
      const response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({
          client_id: data.client_id,
          timestamp_micros: Math.trunc(Date.parse(data.created_at) * 1000),
          consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
          events: [{ name: 'character_registered', params }],
        }),
      });
      await db
        .from('af_analytics_outbox')
        .update({ status: response.ok ? 'sent' : 'failed' })
        .eq('submission_id', row.id);
    } catch {
      // Delivery is unknown. Keep it out of automatic retries to avoid duplicate key events.
      await db.from('af_analytics_outbox').update({ status: 'unknown' }).eq('submission_id', row.id);
    }
  }
  return { context, registered, preflight: () => jsonResponse({ ok: true }, 200, cors) };
}
