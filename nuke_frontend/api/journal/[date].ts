import type { VercelRequest, VercelResponse } from '@vercel/node';

// GET /api/journal/:date — public work-log projection for one day.
// Read-only composition of the same sources as the canonical
// project_work_log tool in mcp-connector (which remains the writer of
// audited projection_event rows). JournalPage.tsx consumes the
// { date, audience, work_log } shape.
//
// DEPLOYED UNIVERSE: this file MUST live in nuke_frontend/api/. Both
// deploy-vercel.yml and deploy-preview.yml run `vercel deploy` with
// working-directory ./nuke_frontend, so only nuke_frontend/api/** becomes
// functions and nuke_frontend/vercel.json is the live routing config.
// Repo-root api/ is never uploaded (commit f07181e05 moved these handlers
// there and prod /api/journal/* fell through to the mailbox 404).

// This route has no session, so every caller is a logged-out visitor. It reads with the publishable key, and the
// database's logged-out row policies and column grants decide what comes back: a caller without owner rights reads
// what a logged-out visitor reads. SUPABASE_PUBLISHABLE_KEY is set for production only; VITE_SUPABASE_ANON_KEY (the
// publishable key the web bundle ships) is set in every environment.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Profiles whose photos the day read covers: 100 ids keep the request line under 4 KB.
const MAX_PROFILES = 100;

async function rest(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY!,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      Accept: 'application/json',
    },
  });
  // A table or column a visitor may not read answers 42501: that part of the day is empty, not an error. Any other
  // refusal (a rejected key) stays an error so a misconfigured key cannot pass for an empty day.
  if (r.status === 401 || r.status === 403) {
    const body: any = await r.json().catch(() => null);
    if (body?.code === '42501') {
      console.warn(`journal: ${path.split('?')[0]} answered ${r.status}/42501 for a visitor`);
      return [];
    }
  }
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`);
  return r.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const raw = req.query.date;
  const date = Array.isArray(raw) ? raw[0] : raw;
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;

  try {
    // Photos: vehicle_images has no index that leads with taken_at, so a day-range read across every photo is a
    // scan (17 s cold, measured 2026-11-21). (user_id, taken_at) is indexed, so the day is read per documenting
    // profile: first the profiles a visitor may read, then their photos for the day. Both reads use the publishable
    // key, so the logged-out photo policy decides which rows come back. The profile list is capped; past the cap the
    // day needs a database reader that walks profiles itself, the way vw_journal_density does.
    const profiles = await rest(`profiles?select=id&order=id.asc&limit=${MAX_PROFILES}`);
    if (profiles.length >= MAX_PROFILES) {
      console.warn(`journal: the profile list reached its cap of ${MAX_PROFILES}; later profiles' photos are not listed`);
    }
    const profileIds = profiles
      .map((p: any) => p?.id)
      .filter((id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id));
    const [photos, labor, parts, payments, receipts] = await Promise.all([
      profileIds.length
        ? rest(
            `vehicle_images?select=id,vehicle_id,image_url,angle,taken_at` +
              `&user_id=in.(${profileIds.join(',')})` +
              `&taken_at=gte.${dayStart}&taken_at=lte.${dayEnd}&order=taken_at.asc&limit=200`,
          )
        : Promise.resolve([] as any[]),
      rest(
        `work_order_labor?select=id,work_order_id` +
          `&created_at=gte.${dayStart}&created_at=lte.${dayEnd}`,
      ),
      rest(
        `work_order_parts?select=id,work_order_id` +
          `&created_at=gte.${dayStart}&created_at=lte.${dayEnd}`,
      ),
      rest(
        `work_order_payments?select=id,work_order_id,status` +
          `&payment_date=gte.${dayStart}&payment_date=lte.${dayEnd}&status=eq.completed`,
      ),
      rest(
        `receipts?select=id,vehicle_id,transaction_date,scope_type,scope_id` +
          `&or=(transaction_date.eq.${date},purchase_date.eq.${date},receipt_date.eq.${date})&limit=200`,
      ),
    ]);

    const woIds = Array.from(
      new Set(
        [...labor, ...parts, ...payments].map((r: any) => r.work_order_id).filter(Boolean),
      ),
    );
    const workOrders = woIds.length
      ? await rest(
          `work_orders?select=id,vehicle_id,title,status&id=in.(${woIds.join(',')})`,
        )
      : [];

    // Public view: counts and attribution only. Vendors and amounts are the owner's, read through the
    // authenticated day receipt with its money mask, never through this unauthenticated route.
    const work_log = {
      date,
      vehicle_id: null,
      audience: 'public',
      photos: photos.map((p: any) => ({
        id: p.id,
        url: p.image_url,
        angle: p.angle ?? null,
        vehicle_id: p.vehicle_id ?? null,
        taken_at: p.taken_at ?? null,
      })),
      work_orders: workOrders.map((w: any) => ({
        id: w.id,
        title: w.title ?? null,
        status: w.status ?? null,
        vehicle_id: w.vehicle_id ?? null,
      })),
      receipts: receipts.map((r: any) => ({
        id: r.id,
        date: r.transaction_date ?? null,
        vehicle_id: r.vehicle_id ?? null,
        scope_type: r.scope_type ?? null,
        scope_id: r.scope_id ?? null,
      })),
      summary: {
        photo_count: photos.length,
        work_order_count: workOrders.length,
        labor_lines: labor.length,
        parts_lines: parts.length,
        payment_count: payments.length,
        receipt_count: receipts.length,
      },
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ date, audience: 'public', work_log });
  } catch (e: any) {
    return res.status(502).json({ error: 'Upstream error', note: String(e?.message || e) });
  }
}
