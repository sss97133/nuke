/**
 * tryon-generate — on-demand virtual try-on for L'Officiel concierge commerce.
 *
 * ONE function, path-routed (50-fn cap):
 *   POST /submit   consumer: {product_id, client_id, model_image_url?} -> resolve garment
 *                  from concierge_products.media[0], submit to engine, insert tryon_jobs row.
 *   POST /poll     cron/service: drain tryon_jobs where next_poll_at <= now(); on completion
 *                  mirror the result into concierge-media and write a tryon_results row.
 *
 * Substrate: tryon_jobs (async ledger), tryon_results (SYNTHESIS output, trust='synthetic'),
 *   storage bucket concierge-media/tryon/<job_id>/. NEVER mutates the real product row.
 *
 * ENGINE: Kling virtual try-on (Kolors). human_image = the MODEL, cloth_image = the GARMENT.
 *   ⚠️ DORMANT + UNVERIFIED: the Kling request/response shape below is the DOCUMENTED shape,
 *   not yet validated against a live funded call (Move-1 validation was deferred — track "B").
 *   Until KLING_ACCESS_KEY/KLING_SECRET are set + funded, /submit returns engine_not_funded.
 *
 * Modeled 1:1 on instagram-connect (concierge-native writes + concierge-media mirror +
 * service-role gating + JWT-signed provider auth).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const KLING_ACCESS_KEY = Deno.env.get('KLING_ACCESS_KEY') ?? '';
const KLING_SECRET = Deno.env.get('KLING_SECRET') ?? '';
// A hosted default model image (person) to dress when the consumer doesn't upload their own.
const KLING_DEFAULT_MODEL_URL = Deno.env.get('KLING_DEFAULT_MODEL_URL') ?? '';
const KLING_BASE = 'https://api.klingai.com';
const KLING_MODEL = 'kolors-virtual-try-on-v1-5';

const svc = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const enc = new TextEncoder();
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Kling API auth: HS256 JWT, iss=access_key, short exp. (Bearer). */
async function klingToken(): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ iss: KLING_ACCESS_KEY, exp: now + 1800, nbf: now - 5 })));
  const key = await crypto.subtle.importKey('raw', enc.encode(KLING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`))));
  return `${header}.${payload}.${sig}`;
}

async function klingJson(path: string, init?: RequestInit): Promise<Record<string, any>> {
  const token = await klingToken();
  const res = await fetch(`${KLING_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.code !== 0) throw new Error(`kling ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** concierge_products.media arrives in two shapes — mirror productImages() in the web repo. */
function firstImage(media: unknown): string | null {
  if (Array.isArray(media)) {
    const m0 = media[0];
    if (typeof m0 === 'string') return m0;
    if (m0 && typeof m0 === 'object' && 'url' in (m0 as any)) return (m0 as any).url ?? null;
  } else if (media && typeof media === 'object' && Array.isArray((media as any).images)) {
    return (media as any).images[0]?.url ?? null;
  }
  return null;
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const route = url.pathname.split('/tryon-generate')[1]?.replace(/\/$/, '') || '';
  const db = svc();

  try {
    // ---- POST /submit ---- (consumer; keyed on ephemeral client_id, no auth yet)
    if (route === '/submit' && req.method === 'POST') {
      const { product_id, client_id, model_image_url } = await req.json().catch(() => ({}));
      if (!product_id) return json({ error: 'product_id required' }, 400);

      const { data: product, error: pErr } = await db.from('concierge_products')
        .select('id, media, name, org_id').eq('id', product_id).eq('status', 'live').maybeSingle();
      if (pErr || !product) return json({ error: 'product not found' }, 404);
      const garment = firstImage(product.media);
      if (!garment) return json({ error: 'product has no image to try on' }, 422);

      const modelUrl = model_image_url || KLING_DEFAULT_MODEL_URL || null;

      // create the job row first so the plumbing is always exercised (even when unfunded)
      const { data: job, error: jErr } = await db.from('tryon_jobs').insert({
        client_id: client_id ?? null, product_id, garment_image_url: garment,
        model_image_url: modelUrl, engine: 'kling', status: 'submitted',
        params: { model_name: KLING_MODEL, product_name: product.name },
      }).select('id').single();
      if (jErr) throw new Error(`job insert: ${jErr.message}`);

      // DORMANT gate: no funded engine key -> record and return, no external call
      if (!KLING_ACCESS_KEY || !KLING_SECRET) {
        await db.from('tryon_jobs').update({ status: 'error', error: 'engine_not_funded', updated_at: new Date().toISOString() }).eq('id', job.id);
        return json({ ok: false, reason: 'engine_not_funded', job_id: job.id }, 503);
      }
      if (!modelUrl) {
        await db.from('tryon_jobs').update({ status: 'error', error: 'no_model_image', updated_at: new Date().toISOString() }).eq('id', job.id);
        return json({ ok: false, reason: 'no_model_image', job_id: job.id }, 422);
      }

      // submit to Kling (human_image = model, cloth_image = garment)
      try {
        const resp = await klingJson('/v1/images/kolors-virtual-try-on', {
          method: 'POST',
          body: JSON.stringify({ model_name: KLING_MODEL, human_image: modelUrl, cloth_image: garment }),
        });
        const taskId = resp.data?.task_id;
        await db.from('tryon_jobs').update({
          provider_job_id: taskId, status: 'polling',
          next_poll_at: new Date(Date.now() + 30_000).toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        return json({ ok: true, job_id: job.id, provider_job_id: taskId, status: 'polling' });
      } catch (e) {
        await db.from('tryon_jobs').update({ status: 'error', error: String(e).slice(0, 300), updated_at: new Date().toISOString() }).eq('id', job.id);
        return json({ ok: false, reason: 'submit_failed', job_id: job.id, detail: String(e).slice(0, 300) }, 502);
      }
    }

    // ---- POST /poll ---- (cron/service only) — drain due jobs
    if (route === '/poll' && req.method === 'POST') {
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
      if (!(await isServiceCaller(jwt))) return json({ error: 'service only' }, 401);
      if (!KLING_ACCESS_KEY || !KLING_SECRET) return json({ ok: false, reason: 'engine_not_funded' }, 503);

      const { data: due } = await db.from('tryon_jobs')
        .select('id, provider_job_id, product_id, client_id, garment_image_url, model_image_url, attempts, params')
        .in('status', ['submitted', 'polling']).lte('next_poll_at', new Date().toISOString()).limit(10);

      const results: Record<string, unknown>[] = [];
      for (const j of due ?? []) {
        try { results.push(await pollJob(db, j)); }
        catch (e) { results.push({ job_id: j.id, error: String(e).slice(0, 200) }); }
      }
      return json({ polled: results.length, results });
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

/** Check one job's engine status; on success mirror the image + write the result row. */
async function pollJob(db: ReturnType<typeof svc>, j: Record<string, any>) {
  if (!j.provider_job_id) {
    await db.from('tryon_jobs').update({ status: 'error', error: 'no provider_job_id', updated_at: new Date().toISOString() }).eq('id', j.id);
    return { job_id: j.id, status: 'error' };
  }
  const resp = await klingJson(`/v1/images/kolors-virtual-try-on/${j.provider_job_id}`, { method: 'GET' });
  const taskStatus = resp.data?.task_status; // submitted | processing | succeed | failed
  const attempts = (j.attempts ?? 0) + 1;

  if (taskStatus === 'succeed') {
    const imgUrl: string | undefined = resp.data?.task_result?.images?.[0]?.url;
    if (!imgUrl) {
      await db.from('tryon_jobs').update({ status: 'error', error: 'no result image', attempts, updated_at: new Date().toISOString() }).eq('id', j.id);
      return { job_id: j.id, status: 'error' };
    }
    // mirror binary into concierge-media (same primitive as instagram-connect)
    let storagePath: string | null = null;
    try {
      const bin = await fetch(imgUrl);
      if (bin.ok) {
        const bytes = new Uint8Array(await bin.arrayBuffer());
        storagePath = `tryon/${j.id}/0.png`;
        const { error: stErr } = await db.storage.from('concierge-media')
          .upload(storagePath, bytes, { contentType: bin.headers.get('content-type') ?? 'image/png', upsert: true });
        if (stErr) storagePath = null;
      }
    } catch (e) { console.error('mirror', String(e).slice(0, 200)); }

    const publicUrl = storagePath
      ? `${SUPABASE_URL}/storage/v1/object/public/concierge-media/${storagePath}`
      : imgUrl;

    const { data: result } = await db.from('tryon_results').insert({
      job_id: j.id, product_id: j.product_id, client_id: j.client_id,
      source: 'kling', method: 'virtual_tryon', observed_at: new Date().toISOString(), trust: 'synthetic',
      provenance: {
        product_id: j.product_id, model_image_ref: j.model_image_url, garment_image_ref: j.garment_image_url,
        provider_job_id: j.provider_job_id, engine: 'kling', engine_version: j.params?.model_name ?? KLING_MODEL,
        generated_at: new Date().toISOString(),
      },
      media: [{ url: publicUrl, type: 'image', source: 'kling' }],
      storage_path: storagePath,
    }).select('id').single();

    await db.from('tryon_jobs').update({ status: 'done', attempts, updated_at: new Date().toISOString() }).eq('id', j.id);
    return { job_id: j.id, status: 'done', result_id: result?.id };
  }

  if (taskStatus === 'failed') {
    await db.from('tryon_jobs').update({
      status: 'error', error: `engine failed: ${resp.data?.task_status_msg ?? ''}`.slice(0, 300), attempts, updated_at: new Date().toISOString(),
    }).eq('id', j.id);
    return { job_id: j.id, status: 'error' };
  }

  // still processing — reschedule (cap attempts to avoid infinite poll)
  const nextStatus = attempts > 40 ? 'error' : 'polling';
  await db.from('tryon_jobs').update({
    status: nextStatus, attempts,
    error: nextStatus === 'error' ? 'poll timeout' : null,
    next_poll_at: new Date(Date.now() + 30_000).toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', j.id);
  return { job_id: j.id, status: nextStatus };
}
