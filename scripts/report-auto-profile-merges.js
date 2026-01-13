#!/usr/bin/env node
/**
 * Report Auto Vehicle Profile Merges
 *
 * Purpose:
 * - Find destructive auto-merges (timeline_events.event_type='profile_merged')
 * - Highlight risky match types (anything other than vin_exact)
 *
 * Usage:
 *   node scripts/report-auto-profile-merges.js --limit 200
 *
 * Env:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(repoRoot, '.env.local') });
dotenv.config({ path: path.join(repoRoot, '.env') });

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('ERROR: Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function errorToMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string') return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function parseArgs(argv) {
  const out = { limit: 200 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') out.limit = Number(argv[i + 1] || out.limit);
  }
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 200;
  return out;
}

function coalesceUrl(v) {
  const url = v?.bat_auction_url || v?.listing_url || v?.discovery_url || null;
  return url ? String(url) : null;
}

async function main() {
  const { limit } = parseArgs(process.argv);

  const { data: merges, error } = await supabase
    .from('timeline_events')
    .select('id, vehicle_id, created_at, event_date, title, metadata')
    .eq('event_type', 'profile_merged')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = Array.isArray(merges) ? merges : [];
  const normalized = rows.map((r) => {
    const meta = r?.metadata || {};
    return {
      id: r?.id,
      vehicle_id: r?.vehicle_id,
      created_at: r?.created_at,
      auto_merged: meta?.auto_merged === true || meta?.auto_merged === 'true',
      match_type: meta?.match_type || null,
      confidence: meta?.confidence ?? null,
      duplicate_vehicle_id: meta?.duplicate_vehicle_id || null,
    };
  });

  const risky = normalized.filter((r) => r.auto_merged && String(r.match_type || '').toLowerCase() !== 'vin_exact');

  // Fetch vehicle identities for primaries (and any surviving duplicates)
  const vehicleIds = Array.from(
    new Set(
      risky
        .flatMap((r) => [r.vehicle_id, r.duplicate_vehicle_id])
        .filter(Boolean)
        .map(String)
    )
  );

  const vehicleMap = new Map();
  if (vehicleIds.length > 0) {
    const { data: vehicles, error: vErr } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin, listing_url, discovery_url, bat_auction_url, merged_into_vehicle_id, deleted_at')
      .in('id', vehicleIds);
    if (vErr) throw vErr;
    for (const v of vehicles || []) {
      vehicleMap.set(v.id, v);
    }
  }

  console.log(`Found ${rows.length} merge events (showing up to ${limit}).`);
  console.log(`Risky auto-merges (auto_merged=true AND match_type!=vin_exact): ${risky.length}\n`);

  for (const r of risky) {
    const primary = vehicleMap.get(r.vehicle_id) || null;
    const dup = vehicleMap.get(r.duplicate_vehicle_id) || null;
    const primaryIdentity = primary ? `${primary.year || '?'} ${primary.make || '?'} ${primary.model || '?'}` : '(vehicle missing)';
    const dupIdentity = dup ? `${dup.year || '?'} ${dup.make || '?'} ${dup.model || '?'}` : '(duplicate missing/deleted)';

    console.log(`- merged_at=${r.created_at} confidence=${r.confidence} match_type=${r.match_type}`);
    console.log(`  primary=${r.vehicle_id} ${primaryIdentity} vin=${primary?.vin || 'n/a'} url=${coalesceUrl(primary) || 'n/a'}`);
    console.log(`  dup=${r.duplicate_vehicle_id} ${dupIdentity} vin=${dup?.vin || 'n/a'} url=${coalesceUrl(dup) || 'n/a'}`);
  }

  if (risky.length === 0) {
    console.log('(none)');
  }
}

main().catch((err) => {
  console.error(`ERROR: ${errorToMessage(err)}`);
  process.exit(1);
});

