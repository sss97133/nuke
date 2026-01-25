#!/usr/bin/env node
/**
 * Data Quality Audit Script
 * Compares data coverage across sources
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function auditSource(src, recentOnly = false) {
  console.log('SOURCE:', src.toUpperCase());
  console.log('-'.repeat(50));

  // Build query
  let query = `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.${src}`;
  if (recentOnly) {
    query += '&updated_at=gt.2026-01-24';
  }
  query += '&status=eq.active&select=id,vin,year,make,model,mileage,color,interior_color,engine_size,engine_type,transmission,sale_price,high_bid,description,highlights,primary_image_url&limit=50';

  const res = await fetch(query, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const vehicles = await res.json();

  if (vehicles.length === 0) {
    console.log('No vehicles found\n');
    return;
  }

  const checks = {
    'vin': v => !!v.vin,
    'year/make/model': v => v.year && v.make && v.model,
    'mileage': v => !!v.mileage,
    'ext color': v => !!v.color,
    'int color': v => !!v.interior_color,
    'engine': v => !!(v.engine_size || v.engine_type),
    'transmission': v => !!v.transmission,
    'price': v => !!(v.sale_price || v.high_bid),
    'description': v => !!(v.description && v.description.length > 50),
    'highlights': v => !!(v.highlights && v.highlights.length > 0),
    'image': v => !!v.primary_image_url
  };

  console.log('Sample size:', vehicles.length);
  for (const [name, check] of Object.entries(checks)) {
    const count = vehicles.filter(check).length;
    const pct = Math.round((count / vehicles.length) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${name.padEnd(15)} ${bar} ${pct}%`);
  }
  console.log('');
}

async function checkAuctionEvents() {
  console.log('AUCTION EVENTS BY SOURCE');
  console.log('========================');

  const sources = ['bat', 'carsandbids', 'mecum', 'hagerty', 'pcarmarket', 'hemmings'];

  for (const src of sources) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/auction_events?source=eq.${src}&select=id&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
    );
    const count = res.headers.get('content-range')?.split('/')[1] || '0';
    console.log(`  ${src.padEnd(15)} ${count}`);
  }
  console.log('');
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  DATA QUALITY AUDIT                                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const mode = process.argv[2] || 'recent';
  const recentOnly = mode === 'recent';

  console.log(recentOnly ? 'Mode: RECENTLY UPDATED (last 24h)\n' : 'Mode: ALL ACTIVE VEHICLES\n');

  const sources = ['bat', 'carsandbids', 'mecum', 'hagerty', 'pcarmarket', 'hemmings'];

  for (const src of sources) {
    await auditSource(src, recentOnly);
  }

  await checkAuctionEvents();
}

main().catch(console.error);
