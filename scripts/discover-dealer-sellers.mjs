#!/usr/bin/env node
/**
 * P06: Auto-discover dealer sellers from BaT listing patterns.
 *
 * Identifies professional sellers by:
 * - Volume: 15+ listings on BaT
 * - Temporal spread: active across 3+ years
 * - Already not in bat_seller_monitors
 *
 * For each discovered dealer:
 * 1. Create/match a businesses record (status='discovered')
 * 2. Insert bat_seller_monitors row
 * 3. Run seller→org wiring (backfill-bat-seller-to-org pattern)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const MIN_LISTINGS = parseInt(process.argv.find(a => a.startsWith('--min='))?.split('=')[1] || '15', 10);
const MIN_YEARS = parseInt(process.argv.find(a => a.startsWith('--years='))?.split('=')[1] || '3', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1. Find high-volume sellers not already monitored
  const { data: existing } = await supabase
    .from('bat_seller_monitors')
    .select('seller_username');
  const monitored = new Set((existing || []).map(e => e.seller_username.toLowerCase()));

  // Query sellers with volume + temporal spread
  const { data: sellers, error } = await supabase.rpc('exec_sql_readonly', {
    sql: `SELECT bat_seller, count(*) as listings,
            count(DISTINCT EXTRACT(YEAR FROM sale_date::date)) as active_years,
            round(avg(sale_price)) as avg_price,
            round(sum(sale_price)) as total_gmv
          FROM vehicles
          WHERE bat_seller IS NOT NULL AND sale_price > 0
            AND bat_seller NOT IN (${[...monitored].map(s => `'${s}'`).join(',') || "'__none__'"})
          GROUP BY bat_seller
          HAVING count(*) >= ${MIN_LISTINGS}
            AND count(DISTINCT EXTRACT(YEAR FROM sale_date::date)) >= ${MIN_YEARS}
          ORDER BY count(*) DESC`
  });

  // Fallback if RPC doesn't exist
  let candidates = sellers || [];
  if (error || !sellers) {
    console.log('SQL RPC unavailable, using REST fallback...');
    // Use a simpler approach - get all sellers and filter in JS
    let allSellers = [];
    let page = 0;
    while (true) {
      const { data: batch } = await supabase
        .from('vehicles')
        .select('bat_seller, sale_price, sale_date')
        .not('bat_seller', 'is', null)
        .gt('sale_price', 0)
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (!batch || batch.length === 0) break;
      allSellers.push(...batch);
      if (batch.length < 1000) break;
      page++;
      if (page > 500) break; // safety
    }

    // Aggregate in JS
    const sellerMap = new Map();
    for (const v of allSellers) {
      const key = v.bat_seller;
      if (monitored.has(key.toLowerCase())) continue;
      const entry = sellerMap.get(key) || { bat_seller: key, listings: 0, years: new Set(), total_gmv: 0 };
      entry.listings++;
      if (v.sale_date) entry.years.add(new Date(v.sale_date).getFullYear());
      entry.total_gmv += Number(v.sale_price) || 0;
      sellerMap.set(key, entry);
    }

    candidates = [...sellerMap.values()]
      .filter(s => s.listings >= MIN_LISTINGS && s.years.size >= MIN_YEARS)
      .map(s => ({
        bat_seller: s.bat_seller,
        listings: s.listings,
        active_years: s.years.size,
        avg_price: Math.round(s.total_gmv / s.listings),
        total_gmv: Math.round(s.total_gmv),
      }))
      .sort((a, b) => b.listings - a.listings);
  }

  console.log(`Found ${candidates.length} dealer candidates (>=${MIN_LISTINGS} listings, >=${MIN_YEARS} years)`);

  if (dryRun) {
    for (const c of candidates.slice(0, 20)) {
      console.log(`  ${c.bat_seller}: ${c.listings} listings, ${c.active_years} years, avg $${(c.avg_price || 0).toLocaleString()}, GMV $${Math.round((c.total_gmv || 0) / 1000).toLocaleString()}K`);
    }
    if (candidates.length > 20) console.log(`  ... and ${candidates.length - 20} more`);
    return;
  }

  let created = 0;
  let wired = 0;

  for (const c of candidates) {
    const username = c.bat_seller;

    // 2. Check if a business already exists with this name
    const { data: existingOrg } = await supabase
      .from('businesses')
      .select('id')
      .ilike('business_name', username)
      .maybeSingle();

    let orgId;
    if (existingOrg) {
      orgId = existingOrg.id;
    } else {
      // Create new business record
      const { data: newOrg, error: orgErr } = await supabase
        .from('businesses')
        .insert({
          business_name: username,
          business_type: 'dealer',
          status: 'active',
          verification_level: 'unverified',
          is_public: true,
          description: `Auto-discovered BaT dealer. ${c.listings} listings, ${c.active_years} years active, avg $${(c.avg_price || 0).toLocaleString()}.`,
        })
        .select('id')
        .single();

      if (orgErr) {
        console.warn(`  Failed to create org for ${username}: ${orgErr.message}`);
        continue;
      }
      orgId = newOrg.id;
      created++;
    }

    // 3. Insert bat_seller_monitors
    const { error: monErr } = await supabase
      .from('bat_seller_monitors')
      .upsert(
        { seller_username: username, organization_id: orgId, is_active: true },
        { onConflict: 'organization_id,seller_username', ignoreDuplicates: true }
      );

    if (monErr) {
      console.warn(`  Failed to create monitor for ${username}: ${monErr.message}`);
      continue;
    }

    // 4. Upsert external_identity
    await supabase
      .from('external_identities')
      .upsert(
        { platform: 'bat', handle: username, first_seen_at: new Date().toISOString() },
        { onConflict: 'platform,handle', ignoreDuplicates: true }
      );

    // 5. Wire vehicles (paginated)
    let vehicleOffset = 0;
    let vehiclesLinked = 0;
    while (true) {
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('bat_seller', username)
        .range(vehicleOffset, vehicleOffset + 499);

      if (!vehicles || vehicles.length === 0) break;

      const orgVehicleRows = vehicles.map(v => ({
        organization_id: orgId,
        vehicle_id: v.id,
        relationship_type: 'sold_by',
        status: 'active',
        auto_tagged: true,
        auto_matched_at: new Date().toISOString(),
        auto_matched_reasons: ['dealer_auto_discovery'],
      }));

      await supabase
        .from('organization_vehicles')
        .upsert(orgVehicleRows, {
          onConflict: 'organization_id,vehicle_id,relationship_type',
          ignoreDuplicates: true,
        });

      // Wire vehicle_events
      await supabase
        .from('vehicle_events')
        .update({ source_organization_id: orgId })
        .in('vehicle_id', vehicles.map(v => v.id))
        .eq('source_platform', 'bat')
        .is('source_organization_id', null);

      vehiclesLinked += vehicles.length;
      if (vehicles.length < 500) break;
      vehicleOffset += 500;
      await sleep(100);
    }

    wired += vehiclesLinked;
    console.log(`  ${username}: org ${orgId.slice(0,8)}, ${vehiclesLinked} vehicles linked (${c.listings} listings, $${Math.round((c.total_gmv || 0) / 1000)}K GMV)`);
    await sleep(100);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Orgs created: ${created}`);
  console.log(`Sellers monitored: ${candidates.length}`);
  console.log(`Vehicles wired: ${wired}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
