import type { VercelRequest, VercelResponse } from '@vercel/node';

// GET /api/journal — 90-day density rows for the journal index page.
// Backed by vw_journal_density (date, photo_count, receipt_count,
// receipt_total, payment_total, top_vehicle_id). This endpoint never existed
// before 2026-06-09: JournalIndex.tsx shipped fetching /api/journal while the
// rewrite catchall sent it to the mailbox function (404). Same service-role
// PostgREST pattern as api/v1/vehicle.
//
// DEPLOYED UNIVERSE: must live in nuke_frontend/api/ — deploys run
// `vercel deploy` from ./nuke_frontend, so repo-root api/ never ships.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url =
    `${SUPABASE_URL}/rest/v1/vw_journal_density` +
    `?select=date,photo_count,receipt_count,receipt_total,payment_total,top_vehicle_id` +
    `&date=gte.${since}&order=date.desc&limit=120`;

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return res.status(502).json({ error: 'Upstream error', status: response.status });
  }

  const rows = await response.json();
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ rows });
}
