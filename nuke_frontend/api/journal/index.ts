import type { VercelRequest, VercelResponse } from '@vercel/node';

// GET /api/journal — 90-day density rows for the journal index page.
// Backed by vw_journal_density (date, photo_count, receipt_count,
// payment_count, top_vehicle_id). This endpoint never existed
// before 2026-06-09: JournalIndex.tsx shipped fetching /api/journal while the
// rewrite catchall sent it to the mailbox function (404).
//
// This route has no session, so every caller is a logged-out visitor. It reads with the publishable key, and the
// view reads as its caller (security_invoker), so the database's logged-out row policies and column grants decide
// what is counted: a caller without owner rights reads what a logged-out visitor reads. SUPABASE_PUBLISHABLE_KEY is
// set for production only; VITE_SUPABASE_ANON_KEY (the publishable key the web bundle ships) is set everywhere.
//
// DEPLOYED UNIVERSE: must live in nuke_frontend/api/ — deploys run
// `vercel deploy` from ./nuke_frontend, so repo-root api/ never ships.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url =
    `${SUPABASE_URL}/rest/v1/vw_journal_density` +
    `?select=date,photo_count,receipt_count,payment_count,top_vehicle_id` +
    `&date=gte.${since}&order=date.desc&limit=120`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      Accept: 'application/json',
    },
  });

  // A view a visitor may not read answers 42501: the index is empty, not an error. Any other refusal (a rejected
  // key) stays an error so a misconfigured key cannot pass for an empty index.
  if (response.status === 401 || response.status === 403) {
    const body: any = await response.json().catch(() => null);
    if (body?.code === '42501') {
      console.warn(`journal index: vw_journal_density answered ${response.status}/42501 for a visitor`);
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ rows: [] });
    }
    return res.status(502).json({ error: 'Upstream error', status: response.status });
  }
  if (!response.ok) {
    return res.status(502).json({ error: 'Upstream error', status: response.status });
  }

  const rows = await response.json();
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ rows });
}
