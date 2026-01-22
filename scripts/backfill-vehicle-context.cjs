#!/usr/bin/env node
/**
 * Backfill vehicle context from known sources into timeline_events.
 * - ClassicValuer: auction price + date
 * - RacingSportsCars: race photo dates/locations
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
  const opts = { vehicleId: null, classicValuer: null, racingSportsCars: null, limit: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vehicle-id' && argv[i + 1]) opts.vehicleId = argv[++i];
    if (a === '--classicvaluer' && argv[i + 1]) opts.classicValuer = argv[++i];
    if (a === '--racingsportscars' && argv[i + 1]) opts.racingSportsCars = argv[++i];
    if (a === '--limit' && argv[i + 1]) opts.limit = Math.max(1, Number(argv[++i]));
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

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  return await resp.text();
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.vehicleId) {
    console.error('Usage: node scripts/backfill-vehicle-context.cjs --vehicle-id <uuid> --classicvaluer <url> --racingsportscars <url>');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!supabaseKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = new Date().toISOString().slice(0, 10);

  if (opts.classicValuer) {
    try {
      const html = await fetchHtml(opts.classicValuer);
      const priceMatch = html.match(/£\s*([0-9,]+)/);
      const dateMatch = html.match(/\b(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})\b/);
      const priceGbp = priceMatch?.[1] ? Number(priceMatch[1].replace(/,/g, '')) : null;
      const eventDate = toDateOnly(dateMatch?.[1]) || today;

      const { data: existing } = await supabase
        .from('timeline_events')
        .select('id')
        .eq('vehicle_id', opts.vehicleId)
        .contains('metadata', { source_url: opts.classicValuer, provenance: 'context_backfill' })
        .maybeSingle();

      if (!existing?.id) {
        const { error } = await supabase
          .from('timeline_events')
          .insert({
            vehicle_id: opts.vehicleId,
            event_type: 'auction_listed',
            event_date: eventDate,
            title: 'Auction listing',
            description: priceGbp ? `Listed at £${priceGbp.toLocaleString()}` : `Listed on ${shortHost(opts.classicValuer)}`,
            source: 'theclassicvaluer',
            metadata: {
              source_url: opts.classicValuer,
              price_gbp: priceGbp,
              date_precision: dateMatch ? 'day' : 'unknown',
              provenance: 'context_backfill'
            }
          });
        if (error) throw error;
        console.log('Inserted ClassicValuer context event.');
      }
    } catch (err) {
      console.warn('ClassicValuer parse failed:', err?.message || err);
    }
  }

  if (opts.racingSportsCars) {
    try {
      const html = await fetchHtml(opts.racingSportsCars);
      const photoRe = /https?:\/\/www\.racingsportscars\.com\/photo\/\d{4}\/([^"']+?)-(\d{4}-\d{2}-\d{2})-[^"']+?\.jpg/gi;
      const found = new Map();
      for (const match of html.matchAll(photoRe)) {
        const rawLocation = match[1] || '';
        const date = match[2] || '';
        if (!date) continue;
        if (date.includes('-00-')) continue;
        const location = rawLocation.replace(/_/g, ' ').replace(/-/g, ' ').trim();
        const key = `${date}|${location}`;
        if (!found.has(key)) found.set(key, { date, location });
      }

      const entries = Array.from(found.values()).slice(0, opts.limit);
      if (entries.length > 0) {
        const { data: existing } = await supabase
          .from('timeline_events')
          .select('id,metadata')
          .eq('vehicle_id', opts.vehicleId)
          .contains('metadata', { source_url: opts.racingSportsCars });

        const existingKeys = new Set(
          (existing || []).map((row) => {
            const md = row?.metadata || {};
            return `${md?.event_date || ''}|${md?.location || ''}`;
          })
        );

        for (const entry of entries) {
          const key = `${entry.date}|${entry.location}`;
          if (existingKeys.has(key)) continue;
          const { error } = await supabase
            .from('timeline_events')
            .insert({
              vehicle_id: opts.vehicleId,
              event_type: 'other',
              event_date: entry.date,
              title: 'Race appearance',
              description: entry.location ? `${entry.location}` : 'RacingSportsCars photo',
              source: 'racingsportscars',
              metadata: {
                source_url: opts.racingSportsCars,
                event_date: entry.date,
                location: entry.location,
                date_precision: 'day',
                provenance: 'rsc_photo'
              }
            });
          if (error) throw error;
        }
        console.log(`Inserted ${entries.length} RacingSportsCars event(s) (deduped).`);
      }
    } catch (err) {
      console.warn('RacingSportsCars parse failed:', err?.message || err);
    }
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
