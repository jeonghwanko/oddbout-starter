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
  const params = new URL(request.url).searchParams;
  const page = params.get('page') ?? '0',
    status = params.get('status') ?? 'all',
    search = (params.get('q') ?? '').trim();
  if (!/^\d{1,5}$/.test(page) || !['all', 'unread', 'read', 'done'].includes(status) || search.length > 120 || unstorableTextPath({ search }) !== null)
    throw new Problem(400, 'invalid-query');
  const start = Number(page) * PAGE_SIZE;
  let query = db.from('af_inquiries').select('id,title,message,created_at,status');
  if (status !== 'all') query = query.eq('status', status);
  if (search) {
    // Literal, case-insensitive substring search. Quote the filter value as well as escaping regex syntax.
    const pattern = JSON.stringify(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    query = query.or(`title.imatch.${pattern},message.imatch.${pattern}`);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + PAGE_SIZE);
  if (error || !Array.isArray(data)) throw new Problem(503, 'inquiries-unavailable');
  return { ok: true, inquiries: data.slice(0, PAGE_SIZE), hasMore: data.length > PAGE_SIZE };
}

/** Count the whole inbox without returning inquiry text. Called after the administrator check. @param {any} db */
export async function unreadInquiryCount(db) {
  const { count, error } = await db.from('af_inquiries').select('id', { count: 'exact', head: true }).eq('status', 'unread');
  if (error || !Number.isSafeInteger(count) || count < 0) throw new Problem(503, 'inquiries-unavailable');
  return { ok: true, unreadCount: count };
}

/** Called only after the admin handler verifies the caller. @param {any} db @param {Request} request @param {string} id @param {string} action */
export async function manageInquiry(db, request, id, action) {
  if (!UUID.test(id)) throw new Problem(400, 'invalid-inquiry');
  if (action === 'delete') {
    const { error } = await db.from('af_inquiries').delete().eq('id', id);
    if (error) throw new Problem(503, 'inquiries-unavailable');
    return { ok: true };
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 512)));
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(400, 'invalid-inquiry');
  }
  const states = ['unread', 'read', 'done'];
  if (
    !body ||
    Array.isArray(body) ||
    Object.keys(body).some(key => !['status', 'previous'].includes(key)) ||
    !states.includes(body.status) ||
    !states.includes(body.previous)
  )
    throw new Problem(400, 'invalid-inquiry');
  const { data, error } = await db.from('af_inquiries').update({ status: body.status }).eq('id', id).eq('status', body.previous).select('id').maybeSingle();
  if (error) throw new Problem(503, 'inquiries-unavailable');
  if (!data) throw new Problem(409, 'review-conflict');
  return { ok: true };
}
