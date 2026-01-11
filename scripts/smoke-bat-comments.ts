/**
 * Smoke test: BaT comment ingestion pipeline (minimal, fast, deterministic).
 *
 * What this validates:
 * - The `extract-auction-comments` Edge Function can be invoked
 * - `auction_comments` rows are writable (no trigger/RLS/schema break)
 *
 * Usage:
 *   npm run -s smoke:bat-comments -- --auction-url="https://bringatrailer.com/listing/..."
 *   npm run -s smoke:bat-comments -- --auction-url="..." --vehicle-id="..."
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function getArg(name: string): string | null {
  const prefix = `${name}=`;
  const found = process.argv.find((a) => a === name || a.startsWith(prefix)) || null;
  if (!found) return null;
  if (found === name) {
    const idx = process.argv.indexOf(found);
    return process.argv[idx + 1] ? String(process.argv[idx + 1]) : null;
  }
  return found.slice(prefix.length);
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    return String(raw).split('#')[0].split('?')[0];
  }
}

async function resolveVehicleId(batUrlNorm: string): Promise<string> {
  const alt = batUrlNorm.endsWith('/') ? batUrlNorm.slice(0, -1) : `${batUrlNorm}/`;
  const candidates = Array.from(new Set([batUrlNorm, alt]));

  // 1) external_listings (canonical for BaT URLs)
  {
    const { data, error } = await supabase
      .from('external_listings')
      .select('vehicle_id')
      .eq('platform', 'bat')
      .in('listing_url', candidates)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.vehicle_id) return String(data.vehicle_id);
  }

  // 2) vehicles fallback
  {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id')
      .in('discovery_url', candidates)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return String(data.id);
  }

  {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id')
      .in('bat_auction_url', candidates)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return String(data.id);
  }

  throw new Error('Unable to resolve vehicle_id from the given BaT URL (no matching external_listings or vehicles row)');
}

async function getAuctionCommentStats(vehicleId: string) {
  const { count: total, error: countErr } = await supabase
    .from('auction_comments')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
    .eq('platform', 'bat');
  if (countErr) throw countErr;

  const { data: lastRow, error: lastErr } = await supabase
    .from('auction_comments')
    .select('created_at')
    .eq('vehicle_id', vehicleId)
    .eq('platform', 'bat')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw lastErr;

  return {
    total: total || 0,
    lastCreatedAt: lastRow?.created_at ? String(lastRow.created_at) : null,
  };
}

async function main() {
  const auctionUrlArg = getArg('--auction-url') || getArg('--url');
  if (!auctionUrlArg) {
    console.error('Missing required arg: --auction-url="https://bringatrailer.com/listing/..."');
    process.exit(1);
  }

  const auctionUrlNorm = normalizeUrl(auctionUrlArg);
  const vehicleIdArg = getArg('--vehicle-id');
  const vehicleId = vehicleIdArg ? String(vehicleIdArg) : await resolveVehicleId(auctionUrlNorm);

  const before = await getAuctionCommentStats(vehicleId);

  const { data, error } = await supabase.functions.invoke('extract-auction-comments', {
    body: { auction_url: auctionUrlNorm, vehicle_id: vehicleId },
  });

  if (error) {
    console.error('FAIL: extract-auction-comments returned an error');
    console.error(String(error.message || error));
    process.exit(1);
  }

  const after = await getAuctionCommentStats(vehicleId);

  const wroteRows = after.total > before.total || (after.lastCreatedAt && after.lastCreatedAt !== before.lastCreatedAt);
  if (!wroteRows) {
    console.error('FAIL: no new auction_comments rows were observed');
    console.error(`vehicle_id=${vehicleId}`);
    console.error(`before.total=${before.total} before.lastCreatedAt=${before.lastCreatedAt}`);
    console.error(`after.total=${after.total} after.lastCreatedAt=${after.lastCreatedAt}`);
    console.error('function_response=' + JSON.stringify(data));
    process.exit(1);
  }

  console.log('PASS: auction_comments write path looks healthy');
  console.log(`vehicle_id=${vehicleId}`);
  console.log(`before.total=${before.total} before.lastCreatedAt=${before.lastCreatedAt}`);
  console.log(`after.total=${after.total} after.lastCreatedAt=${after.lastCreatedAt}`);
  console.log('function_response=' + JSON.stringify(data));
}

main().catch((e) => {
  console.error('FAIL: unhandled error');
  console.error(e?.message ? String(e.message) : String(e));
  process.exit(1);
});

