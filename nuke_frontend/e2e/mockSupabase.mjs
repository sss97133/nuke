// A network-level stand-in for Supabase. The app runs against https://e2e-mock.supabase.co; every request to that host
// is answered here from fixtures that mirror the live readers' shapes (pg_get_functiondef and anon reads, 2026-10-19).
// Writer calls are recorded and answered { ok: true } — no request ever reaches a real Supabase project, and every
// other external host is aborted, so a test cannot touch production.
export const MOCK_HOST = 'https://e2e-mock.supabase.co';
export const STORAGE_KEY = 'sb-e2e-mock-auth-token';

export const WRITERS = new Set([
  'accept_work_order_quote', 'issue_work_order_quote', 'issue_change_order', 'attest_work_completion', 'accept_work_completion', 'start_work',
  'issue_work_order_invoice', 'record_work_order_payment', 'cosign_provider', 'vouch_for_provider', 'withdraw_vouch', 'reserve_facility',
  'confirm_facility_reservation', 'cancel_facility_reservation', 'request_contact', 'respond_contact_request', 'withdraw_contact_request',
  'post_contact_message', 'record_inspection_findings', 'grant_inspection_access', 'attach_job_evidence', 'offer_on_requirement', 'accept_offer',
  'publish_work_order', 'unpublish_work_order', 'claim_organization', 'create_supplier_invite', 'redeem_supplier_invite',
  'mark_notification_read', 'mark_all_notifications_read', 'approve_job_part_listing',
]);

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A signed-in persona: synthetic ids, no real names or contact details. */
export function persona(id, handle) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, aud: 'authenticated', role: 'authenticated', email: `${handle}@e2e.invalid`, app_metadata: {}, user_metadata: { username: handle },
    created_at: '2026-01-01T00:00:00Z' };
  const access_token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, role: 'authenticated', aud: 'authenticated', exp })}.e2e`;
  return { id, handle, user, session: { access_token, refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user } };
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Route a browser context. `readers` maps an RPC name to a fixture or to (args) => fixture; `tables` maps a REST table to
 * rows. Returns the list of writer calls, in order, as { rpc, args }.
 */
export async function mockSupabase(context, { who = null, readers = {}, tables = {}, functions = {} } = {}) {
  const writes = [];
  if (who) {
    await context.addInitScript(([key, value]) => { window.localStorage.setItem(key, value); }, [STORAGE_KEY, JSON.stringify(who.session)]);
  }
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.origin !== MOCK_HOST) return route.abort();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const path = url.pathname;
    if (path.startsWith('/auth/v1/')) {
      if (!who) return json(route, { code: 401, msg: 'not signed in' }, 401);
      if (path === '/auth/v1/user') return json(route, who.user);
      if (path === '/auth/v1/token') return json(route, who.session);
      return json(route, {});
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.slice('/rest/v1/rpc/'.length);
      let args = {};
      try { args = req.postDataJSON() ?? {}; } catch { args = {}; }
      if (WRITERS.has(name)) {
        writes.push({ rpc: name, args });
        if (!who) return json(route, { code: '42501', message: 'Authentication required' }, 401);
        // A writer whose answer a page renders (e.g. redeem_supplier_invite) may be given its real shape in readers.
        if (name in readers) return json(route, typeof readers[name] === 'function' ? readers[name](args) : readers[name]);
        return json(route, { ok: true, version: 1, duplicate: false, payment_authorized: false });
      }
      if (name in readers) {
        const f = readers[name];
        return json(route, typeof f === 'function' ? f(args) : f);
      }
      return json(route, { code: 'PGRST202', message: `Could not find the function public.${name} (e2e mock)` }, 404);
    }
    if (path.startsWith('/functions/v1/')) {
      const name = path.slice('/functions/v1/'.length);
      return json(route, name in functions ? functions[name] : { error: 'not mocked' }, name in functions ? 200 : 404);
    }
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      const rows = tables[table] ?? [];
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      if (single) return rows.length ? json(route, rows[0]) : json(route, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' }, 406);
      return json(route, rows);
    }
    if (path.startsWith('/storage/v1/')) return json(route, []);
    return json(route, {});
  });
  return writes;
}
