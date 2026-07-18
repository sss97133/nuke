#!/usr/bin/env node
/**
 * pick-next-vehicle.mjs — output the vehicle UUID with the most un-deep-analyzed
 * vehicle_images right now. Companion to the BYOK analysis drain loop.
 *
 * Usage:
 *   dotenvx run -- node scripts/analysis-queue/pick-next-vehicle.mjs
 *
 * Prints a single line: <vehicle_id> <pending_count> <year_make_model>
 * Exits non-zero with "EMPTY" on stdout if nothing is pending.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, KEY);

// Query: count vehicle_images without byok_deep_analysis, grouped by vehicle_id.
// Limit consideration to vehicles Skylar has touched (photos he uploaded or
// vehicles he holds permissions for) — keep scope to user substrate, not the
// 18K-wide auction-scraped vehicle universe.
const SKYLAR = '0b9f107a-d124-49de-9ded-94698f63c1c4';

const { data, error } = await sb.rpc('exec_select_json', {
  q: `
    SELECT
      vi.vehicle_id,
      COUNT(*) FILTER (
        WHERE (vi.ai_scan_metadata IS NULL)
           OR (vi.ai_scan_metadata->'byok_deep_analysis') IS NULL
      ) AS pending,
      v.year,
      v.make,
      v.model
    FROM vehicle_images vi
    JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.vehicle_id IN (
      SELECT DISTINCT vehicle_id FROM vehicle_images
      WHERE user_id = '${SKYLAR}' OR documented_by_user_id = '${SKYLAR}'
      UNION
      SELECT vehicle_id FROM vehicle_user_permissions
      WHERE user_id = '${SKYLAR}' AND status = 'active'
    )
    GROUP BY vi.vehicle_id, v.year, v.make, v.model
    HAVING COUNT(*) FILTER (
      WHERE (vi.ai_scan_metadata IS NULL)
         OR (vi.ai_scan_metadata->'byok_deep_analysis') IS NULL
    ) > 0
    ORDER BY pending DESC
    LIMIT 1
  `,
});

if (error) {
  // RPC may not exist; fall back to direct query via PostgREST select chain.
  const { data: rows, error: e2 } = await sb
    .from('vehicle_images')
    .select('vehicle_id, ai_scan_metadata, user_id, documented_by_user_id')
    .or(`user_id.eq.${SKYLAR},documented_by_user_id.eq.${SKYLAR}`)
    .not('vehicle_id', 'is', null)
    .is('ai_scan_metadata->byok_deep_analysis', null)
    .limit(5000);
  if (e2) {
    console.error('fallback query failed:', e2.message);
    process.exit(2);
  }
  if (!rows || rows.length === 0) {
    console.log('EMPTY');
    process.exit(1);
  }
  const counts = {};
  for (const r of rows) counts[r.vehicle_id] = (counts[r.vehicle_id] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const [vid, pending] = top;
  const { data: veh } = await sb.from('vehicles').select('year, make, model').eq('id', vid).maybeSingle();
  const label = veh ? `${veh.year || '?'} ${veh.make || '?'} ${veh.model || '?'}` : 'unknown';
  console.log(`${vid}\t${pending}\t${label}`);
  process.exit(0);
}

if (!data || data.length === 0) {
  console.log('EMPTY');
  process.exit(1);
}
const r = data[0];
console.log(`${r.vehicle_id}\t${r.pending}\t${r.year || '?'} ${r.make || '?'} ${r.model || '?'}`);
process.exit(0);
