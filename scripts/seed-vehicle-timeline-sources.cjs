#!/usr/bin/env node
/**
 * Seed timeline_events with source URLs for a vehicle.
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
  const opts = { vehicleId: null, urls: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vehicle-id' && argv[i + 1]) opts.vehicleId = argv[++i];
    if (a === '--url' && argv[i + 1]) opts.urls.push(argv[++i]);
  }
  if (!opts.vehicleId && argv[0] && !argv[0].startsWith('-')) {
    opts.vehicleId = argv[0];
  }
  return opts;
}

function shortHost(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.vehicleId || opts.urls.length === 0) {
    console.error('Usage: node scripts/seed-vehicle-timeline-sources.cjs --vehicle-id <uuid> --url <sourceUrl> [--url <sourceUrl> ...]');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!supabaseKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;

  for (const url of opts.urls) {
    const { data: existing } = await supabase
      .from('timeline_events')
      .select('id')
      .eq('vehicle_id', opts.vehicleId)
      .contains('metadata', { source_url: url })
      .maybeSingle();
    if (existing?.id) continue;

    const { error } = await supabase
      .from('timeline_events')
      .insert({
        vehicle_id: opts.vehicleId,
        event_type: 'other',
        event_date: today,
        title: 'Source discovered',
        description: `Source captured: ${shortHost(url)}`,
        source: 'manual_research',
        metadata: {
          source_url: url,
          date_precision: 'unknown',
          provenance: 'manual_seed'
        }
      });
    if (error) {
      throw error;
    }
    inserted += 1;
  }

  console.log(`Seeded ${inserted} source event(s).`);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
