// @ts-check
import { Problem, UUID, jsonResponse, logFailure, readBody, unstorableTextPath } from './http.mjs';

const CORS = { methods: 'POST, OPTIONS', headers: 'Content-Type' };
const BUCKET = 'site-inquiry';
const PAGE_SIZE = 20;
/** @param {{ db: any, limiter: import('./http.mjs').Limiter | null }} options @returns {import('./http.mjs').Route} */
export function createInquiryHandler({ db, limiter }) {
  return async request => {
    const reply = (/** @type {object} */ body, status = 200) => jsonResponse(body, status, CORS);
    try {
      if (request.method === 'OPTIONS') return reply({ ok: true });
      if (request.method !== 'POST') throw new Problem(405, 'method-not-allowed');
      let body;
      try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 26_000)));
      } catch (error) {
        if (error instanceof Problem) throw error;
        throw new Problem(400, 'invalid-inquiry');
      }
      const { id, title, message } = body ?? {};
      if (
        typeof id !== 'string' ||
        !UUID.test(id) ||
        typeof title !== 'string' ||
        typeof message !== 'string' ||
        !title.trim() ||
        !message.trim() ||
        title.length > 120 ||
        message.length > 4000 ||
        unstorableTextPath({ title, message }) !== null
      )
        throw new Problem(400, 'invalid-inquiry');

      if (limiter && !(await limiter.allow(request, BUCKET, 5, 3600))) throw new Problem(429, 'rate-limit');
      // Keep a global cap even when the per-client limiter has no trusted address.
      const budget = await db.rpc('af_rate_hit', { p_bucket: BUCKET, p_key: '0'.repeat(64), p_limit: 200, p_window_seconds: 86_400 });
      if (budget.error || typeof budget.data !== 'boolean') throw new Problem(503, 'inquiries-unavailable');
      if (!budget.data) throw new Problem(429, 'rate-limit');
      // Retrying a request whose response was lost must not create another inquiry.
      const { error } = await db
        .from('af_inquiries')
        .upsert({ id, title: title.trim(), message: message.trim() }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw new Problem(503, 'inquiries-unavailable');
      return reply({ ok: true }, 201);
    } catch (error) {
      logFailure('inquiries', request, error);
      return error instanceof Problem ? reply({ code: error.message }, error.status) : reply({ code: 'inquiries-unavailable' }, 503);
    }
  };
}

/** This is called only after createAdminHandler has verified the administrator. @param {any} db @param {Request} request */
export async function listInquiries(db, request) {
  const page = new URL(request.url).searchParams.get('page') ?? '0';
  if (!/^\d{1,5}$/.test(page)) throw new Problem(400, 'invalid-query');
  const start = Number(page) * PAGE_SIZE;
  const { data, error } = await db
    .from('af_inquiries')
    .select('id,title,message,created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + PAGE_SIZE);
  if (error || !Array.isArray(data)) throw new Problem(503, 'inquiries-unavailable');
  return { ok: true, inquiries: data.slice(0, PAGE_SIZE), hasMore: data.length > PAGE_SIZE };
}
