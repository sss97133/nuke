#!/usr/bin/env node
/**
 * Backfill vehicle_timeline_events from timeline_events for a vehicle.
 * Safe for environments where vehicle_timeline_events is a VIEW.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(__dirname, '..', '.env')
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      raw.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (!match) return;
        const key = match[1];
        if (process.env[key]) return;
        process.env[key] = match[2].replace(/^["']|["']$/g, '');
      });
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv) {
  const opts = {
    vehicleId: null,
    dryRun: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vehicle-id' && argv[i + 1]) opts.vehicleId = argv[++i];
    if (a === '--dry-run') opts.dryRun = true;
  }
  if (!opts.vehicleId && argv[0] && !argv[0].startsWith('-')) {
    opts.vehicleId = argv[0];
  }
  return opts;
}

function isViewError(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('view') ||
    m.includes('read-only') ||
    m.includes('schema cache') ||
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('not found')
  );
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.vehicleId) {
    console.error('Usage: node scripts/backfill-vehicle-timeline-events.cjs --vehicle-id <uuid> [--dry-run]');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!supabaseKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { count: timelineCount } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', opts.vehicleId);

  const { count: vehicleTimelineCount } = await supabase
    .from('vehicle_timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', opts.vehicleId);

  console.log(`timeline_events: ${timelineCount || 0}`);
  console.log(`vehicle_timeline_events: ${vehicleTimelineCount || 0}`);

  const { data: rows, error } = await supabase
    .from('timeline_events')
    .select('id, vehicle_id, user_id, event_type, event_date, title, description, image_urls, metadata, source, created_at, updated_at')
    .eq('vehicle_id', opts.vehicleId)
    .order('event_date', { ascending: false })
    .limit(400);

  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log('No timeline_events to backfill.');
    return;
  }

  if (opts.dryRun) {
    console.log(`Would upsert ${rows.length} event(s) into vehicle_timeline_events.`);
    return;
  }

  const { error: upsertError } = await supabase
    .from('vehicle_timeline_events')
    .upsert(rows, { onConflict: 'id' });

  if (upsertError) {
    if (isViewError(upsertError.message)) {
      console.log('vehicle_timeline_events appears to be a view; no backfill needed.');
      return;
    }
    throw upsertError;
  }

  console.log(`Backfilled ${rows.length} event(s) into vehicle_timeline_events.`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
