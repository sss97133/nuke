/**
 * instagram-connect — Instagram Connect for org profiles (Meta app "Nuke Connect", app id 1025281197031266)
 *
 * ONE function, path-routed (50-fn cap):
 *   GET  /start?org_id&return_to   org admin kicks off OAuth (Instagram API with Instagram Login)
 *   GET  /callback                 Meta redirect: code -> long-lived token -> Vault -> connection row
 *   POST /deauth                   Meta deauthorize webhook (signed_request) -> revoke + purge
 *   POST /data-deletion            Meta data-deletion webhook -> revoke + purge + confirmation code
 *   POST /sync                     cron/service: refresh due feeds into org_instagram_media + mirror binaries
 *
 * Substrate: concierge_partner_connections (channel='instagram', token in Vault via credential_secret_id),
 * org_instagram_media (metadata cache), storage bucket concierge-media/instagram/<org>/<media_id>.
 * IG CDN media_url is signed + short-lived — NEVER hotlink; binaries are mirrored on sync.
 * org_instagram_media is a compliance-purgeable CACHE, not testimony: Meta Platform Terms require
 * actual deletion on disconnect, so revoke paths hard-delete rows + storage objects.
 * Scope: instagram_business_basic only. Tokens live 60d; sync refreshes any token older than 45d.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const IG_APP_ID = Deno.env.get('IG_APP_ID') ?? '';
const IG_APP_SECRET = Deno.env.get('IG_APP_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const FN_BASE = `${SUPABASE_URL}/functions/v1/instagram-connect`;
const REDIRECT_URI = `${FN_BASE}/callback`;

const RETURN_TO_ALLOWLIST = [
  'https://nuke.ag',
  'https://lofficiel-concierge.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

const svc = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------- crypto helpers ----------
const enc = new TextEncoder();

async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s: string) => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
};

async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmacSha256(IG_APP_SECRET, body));
  return `${body}.${sig}`;
}
async function verifyState(state: string): Promise<Record<string, unknown> | null> {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expect = b64url(await hmacSha256(IG_APP_SECRET, body));
  if (expect !== sig) return null;
  const payload = JSON.parse(b64urlDecode(body));
  if (typeof payload.ts !== 'number' || Date.now() - payload.ts > 10 * 60 * 1000) return null; // 10-min expiry
  return payload;
}

/** Meta signed_request: "<b64url sig>.<b64url payload>", HMAC-SHA256 with app secret over payload segment. */
async function parseSignedRequest(signedRequest: string): Promise<Record<string, unknown> | null> {
  const [sig, payload] = signedRequest.split('.');
  if (!sig || !payload) return null;
  const expected = b64url(await hmacSha256(IG_APP_SECRET, payload));
  if (expected !== sig) return null;
  return JSON.parse(b64urlDecode(payload));
}

// ---------- vault (via service-role-only RPCs from the migration) ----------
async function vaultStore(name: string, secret: string): Promise<string> {
  const { data, error } = await svc().rpc('ig_vault_store', { p_name: name, p_secret: secret });
  if (error) throw new Error(`vault store: ${error.message}`);
  return data as string;
}
async function vaultRead(id: string): Promise<string> {
  const { data, error } = await svc().rpc('ig_vault_read', { p_id: id });
  if (error) throw new Error(`vault read: ${error.message}`);
  return data as string;
}
async function vaultDelete(id: string): Promise<void> {
  await svc().rpc('ig_vault_delete', { p_id: id });
}

/** Runtime SUPABASE_SERVICE_ROLE_KEY can differ in format from callers' valid service keys
 * (legacy JWT vs sb_secret_ rotation) — verify capability, not string equality. */
async function isServiceCaller(jwt: string): Promise<boolean> {
  if (!jwt) return false;
  if (jwt === SERVICE_ROLE_KEY) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: jwt, Authorization: `Bearer ${jwt}` },
    });
    return res.ok;
  } catch { return false; }
}

// ---------- IG API ----------
async function igJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`IG ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body as Record<string, unknown>;
}

// ---------- routes ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const route = url.pathname.split('/instagram-connect')[1]?.replace(/\/$/, '') || '';
  const db = svc();

  try {
    // ---- GET /start ----
    if (route === '/start' && req.method === 'GET') {
      const orgId = url.searchParams.get('org_id') ?? '';
      const returnTo = url.searchParams.get('return_to') ?? RETURN_TO_ALLOWLIST[0];
      if (!/^[0-9a-f-]{36}$/.test(orgId)) return json({ error: 'org_id required' }, 400);
      if (!RETURN_TO_ALLOWLIST.some((p) => returnTo.startsWith(p))) return json({ error: 'return_to not allowed' }, 400);

      // caller must be an authenticated platform user; org-admin enforcement tightens at surface-ship time
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
      const anon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
      const { data: userData } = await anon.auth.getUser(jwt);
      const userId = userData?.user?.id ?? null;
      if (!userId && !(await isServiceCaller(jwt))) return json({ error: 'auth required' }, 401);

      const state = await signState({ org_id: orgId, return_to: returnTo, user_id: userId, ts: Date.now() });
      const authorize = 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({
        client_id: IG_APP_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'instagram_business_basic',
        state,
      });
      return Response.redirect(authorize, 302);
    }

    // ---- GET /callback ----
    if (route === '/callback' && req.method === 'GET') {
      if (url.searchParams.get('error')) {
        return json({ error: 'user denied', detail: url.searchParams.get('error_description') }, 400);
      }
      const code = url.searchParams.get('code') ?? '';
      const payload = await verifyState(url.searchParams.get('state') ?? '');
      if (!code || !payload) return json({ error: 'bad code/state' }, 400);
      const orgId = payload.org_id as string;

      // code -> short-lived token
      const form = new URLSearchParams({
        client_id: IG_APP_ID, client_secret: IG_APP_SECRET,
        grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code,
      });
      const short = await igJson('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
      // short -> long-lived (60d)
      const long = await igJson(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${short.access_token}`,
      );
      const token = long.access_token as string;
      const me = await igJson(`https://graph.instagram.com/me?fields=user_id,username,account_type&access_token=${token}`);

      // rotate any prior secret for this org
      const { data: existing } = await db.from('concierge_partner_connections')
        .select('id, credential_secret_id').eq('org_id', orgId).eq('channel', 'instagram').maybeSingle();
      if (existing?.credential_secret_id) await vaultDelete(existing.credential_secret_id);

      const secretId = await vaultStore(`instagram:${orgId}`, token);
      const consent = {
        ig_user_id: String(me.user_id ?? short.user_id),
        username: me.username,
        account_type: me.account_type,
        scopes: ['instagram_business_basic'],
        granted_by_user_id: payload.user_id,
        granted_at: new Date().toISOString(),
        token_created_at: new Date().toISOString(),
        token_expires_in: long.expires_in,
      };
      const { data: conn, error: connErr } = await db.from('concierge_partner_connections').upsert({
        org_id: orgId, channel: 'instagram', endpoint: 'https://graph.instagram.com',
        credential_secret_id: secretId, mandate: 'display', access_tier_default: 'public',
        consent, status: 'connected', sync_interval_minutes: 360,
        next_sync_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,channel' }).select('id').single();
      if (connErr) throw new Error(`connection upsert: ${connErr.message}`);

      // OAuth is the strongest identity claim (external_identities anticipated proof_type='oauth')
      await db.from('external_identities').upsert({
        platform: 'instagram', handle: String(me.username ?? ''), profile_url: `https://instagram.com/${me.username}`,
        claimed_by_user_id: payload.user_id ?? null, claimed_at: new Date().toISOString(), claim_confidence: 95,
        last_seen_at: new Date().toISOString(),
        metadata: { org_id: orgId, ig_user_id: consent.ig_user_id, via: 'instagram-connect oauth' },
      }, { onConflict: 'platform,handle' });

      // best-effort immediate first sync (small)
      try { await syncConnection(db, conn.id, { maxPages: 1 }); } catch (e) { console.error('first sync', e); }

      const dest = new URL(payload.return_to as string);
      dest.searchParams.set('instagram', 'connected');
      dest.searchParams.set('handle', String(me.username ?? ''));
      return Response.redirect(dest.toString(), 302);
    }

    // ---- POST /deauth  |  POST /data-deletion ----
    if ((route === '/deauth' || route === '/data-deletion') && req.method === 'POST') {
      const body = await req.text();
      const signedRequest = new URLSearchParams(body).get('signed_request') ?? '';
      const payload = await parseSignedRequest(signedRequest);
      if (!payload) return json({ error: 'bad signed_request' }, 400);
      const igUserId = String(payload.user_id ?? '');
      const confirmation = crypto.randomUUID().slice(0, 8);

      const { data: conns } = await db.from('concierge_partner_connections')
        .select('id, org_id, credential_secret_id').eq('channel', 'instagram')
        .eq('consent->>ig_user_id', igUserId);
      for (const c of conns ?? []) await revokeConnection(db, c);

      if (route === '/data-deletion') {
        return json({ url: `https://nuke.ag/privacy#ig-deletion-${confirmation}`, confirmation_code: confirmation });
      }
      return json({ ok: true });
    }

    // ---- POST /sync ---- (cron or service role)
    if (route === '/sync' && req.method === 'POST') {
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
      if (!(await isServiceCaller(jwt))) return json({ error: 'service only' }, 401);
      const body = await req.json().catch(() => ({}));

      let q = db.from('concierge_partner_connections')
        .select('id').eq('channel', 'instagram').in('status', ['connected', 'error'])
        .not('credential_secret_id', 'is', null);
      if (body.connection_id) q = q.eq('id', body.connection_id);
      else q = q.lte('next_sync_at', new Date().toISOString());
      const { data: due } = await q.limit(10);

      const results: Record<string, unknown>[] = [];
      for (const c of due ?? []) {
        try { results.push(await syncConnection(db, c.id, { maxPages: 10 })); }
        catch (e) { results.push({ connection_id: c.id, error: String(e) }); }
      }
      return json({ synced: results.length, results });
    }

    return json({ error: `no route ${req.method} ${route}` }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ---------- sync core ----------
async function revokeConnection(db: ReturnType<typeof svc>, c: { id: string; org_id: string; credential_secret_id: string | null }) {
  if (c.credential_secret_id) await vaultDelete(c.credential_secret_id);
  await db.from('concierge_partner_connections').update({
    status: 'revoked', credential_secret_id: null, last_error: null, updated_at: new Date().toISOString(),
  }).eq('id', c.id);
  // compliance purge — cache table + mirrored binaries (NOT testimony; Meta Platform Terms require deletion)
  const { data: rows } = await db.from('org_instagram_media').select('storage_path, thumb_path').eq('connection_id', c.id);
  const paths = (rows ?? []).flatMap((r) => [r.storage_path, r.thumb_path]).filter(Boolean) as string[];
  for (let i = 0; i < paths.length; i += 100) {
    await db.storage.from('concierge-media').remove(paths.slice(i, i + 100));
  }
  await db.from('org_instagram_media').delete().eq('connection_id', c.id);
}

async function syncConnection(db: ReturnType<typeof svc>, connectionId: string, opts: { maxPages: number }) {
  const runStart = new Date().toISOString();
  const { data: conn, error } = await db.from('concierge_partner_connections')
    .select('id, org_id, credential_secret_id, consent, status').eq('id', connectionId).single();
  if (error || !conn?.credential_secret_id) throw new Error('connection not found / no credential');

  let token = await vaultRead(conn.credential_secret_id);
  const consent = (conn.consent ?? {}) as Record<string, unknown>;

  // refresh tokens older than 45d (60d hard expiry; must be >=24h old to refresh)
  const created = new Date(String(consent.token_created_at ?? runStart)).getTime();
  if (Date.now() - created > 45 * 24 * 3600 * 1000) {
    try {
      const refreshed = await igJson(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`,
      );
      token = refreshed.access_token as string;
      await vaultDelete(conn.credential_secret_id);
      const newSecret = await vaultStore(`instagram:${conn.org_id}`, token);
      await db.from('concierge_partner_connections').update({
        credential_secret_id: newSecret,
        consent: { ...consent, token_created_at: new Date().toISOString(), token_expires_in: refreshed.expires_in },
      }).eq('id', conn.id);
    } catch (e) {
      await db.from('concierge_partner_connections').update({
        status: 'expired', last_error: `token refresh failed: ${String(e).slice(0, 300)}`,
      }).eq('id', conn.id);
      throw e;
    }
  }

  // pull feed (paginated)
  const seen: string[] = [];
  let landed = 0;
  let next = `https://graph.instagram.com/me/media?fields=id,media_type,media_url,thumbnail_url,permalink,caption,timestamp&limit=50&access_token=${token}`;
  let pages = 0;
  let complete = true;
  while (next && pages < opts.maxPages) {
    const page = await igJson(next);
    for (const m of (page.data as Record<string, unknown>[]) ?? []) {
      seen.push(String(m.id));
      const { data: existing } = await db.from('org_instagram_media')
        .select('id, storage_path').eq('ig_media_id', String(m.id)).maybeSingle();

      const row = {
        org_id: conn.org_id, connection_id: conn.id, ig_media_id: String(m.id),
        media_type: m.media_type, caption: m.caption ?? null, permalink: m.permalink,
        taken_at: m.timestamp, raw: { source: 'instagram_api', method: 'oauth_sync', observed_at: new Date().toISOString(), trust: 'owner_connected' },
        synced_at: new Date().toISOString(), deleted_at: null as string | null,
      };
      const { data: up, error: upErr } = await db.from('org_instagram_media')
        .upsert(row, { onConflict: 'ig_media_id' }).select('id, storage_path').single();
      if (upErr) { console.error('upsert', upErr.message); continue; }
      landed++;

      // mirror binary once (images: media_url; video/carousel: thumbnail as display asset)
      if (!up.storage_path) {
        const src = (m.media_type === 'VIDEO' ? (m.thumbnail_url ?? m.media_url) : m.media_url) as string | undefined;
        if (src) {
          try {
            const bin = await fetch(src);
            if (bin.ok) {
              const bytes = new Uint8Array(await bin.arrayBuffer());
              const ext = (m.media_type === 'VIDEO' ? 'jpg' : (src.split('?')[0].split('.').pop() ?? 'jpg')).slice(0, 4);
              const path = `instagram/${conn.org_id}/${m.id}.${ext}`;
              const { error: stErr } = await db.storage.from('concierge-media')
                .upload(path, bytes, { contentType: bin.headers.get('content-type') ?? 'image/jpeg', upsert: true });
              if (!stErr) await db.from('org_instagram_media').update({ storage_path: path }).eq('id', up.id);
            }
          } catch (e) { console.error('mirror', String(e).slice(0, 200)); }
        }
      }
    }
    next = (page.paging as Record<string, Record<string, string>>)?.next ?? '';
    pages++;
  }
  if (next) complete = false; // more pages exist than we walked — do NOT mark absents deleted

  // posts deleted on IG must disappear here too (honesty + platform terms)
  if (complete && seen.length) {
    await db.from('org_instagram_media')
      .update({ deleted_at: new Date().toISOString() })
      .eq('connection_id', conn.id).is('deleted_at', null).not('ig_media_id', 'in', `(${seen.join(',')})`);
  }

  await db.from('concierge_partner_connections').update({
    status: 'connected', last_sync_at: new Date().toISOString(),
    next_sync_at: new Date(Date.now() + 360 * 60 * 1000).toISOString(),
    last_sync_count: seen.length, last_error: null, updated_at: new Date().toISOString(),
  }).eq('id', conn.id);

  await db.from('concierge_partner_sync_runs').insert({
    connection_id: conn.id, started_at: runStart, finished_at: new Date().toISOString(),
    ok: true, items_seen: seen.length, items_landed: landed,
  });

  return { connection_id: conn.id, items_seen: seen.length, items_landed: landed, complete };
}
