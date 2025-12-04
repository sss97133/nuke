#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: './nuke_frontend/.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const stats = { updated: 0, failed: 0 };

async function backfillOne(vehicle) {
  process.stdout.write(`${vehicle.vehicle}... `);
  
  try {
    // Scrape the listing
    const { data: result, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: vehicle.url }
    });
    
    if (error || !result?.success) {
      console.log(`❌ Scrape failed`);
      stats.failed++;
      return;
    }
    
    const data = result.data;
    
    // Update vehicle with scraped data
    const updates = {};
    if (data.description) updates.description = data.description;
    if (data.vin) updates.vin = data.vin;
    if (data.auction_outcome) updates.auction_outcome = data.auction_outcome;
    if (data.high_bid) updates.high_bid = data.high_bid;
    if (data.sale_price !== undefined) updates.sale_price = data.sale_price;
    if (data.mileage) updates.mileage = data.mileage;
    if (data.transmission) updates.transmission = data.transmission;
    
    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle.id);
      
      if (updateErr) {
        console.log(`❌ ${updateErr.message}`);
        stats.failed++;
      } else {
        console.log(`✅ ${Object.keys(updates).length} fields`);
        stats.updated++;
      }
    } else {
      console.log(`⚠️ No data`);
    }
    
  } catch (err) {
    console.log(`❌ ${err.message}`);
    stats.failed++;
  }
}

async function main() {
  console.log('🔄 BAT LOW-QUALITY BACKFILL\n');
  
  // Get vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, completion_percentage, bat_auction_url, discovery_url')
    .or('bat_auction_url.not.is.null,discovery_url.like.%bringatrailer%')
    .lt('completion_percentage', 60)
    .order('completion_percentage')
    .limit(30);
  
  if (error || !vehicles) {
    console.error('Error fetching vehicles:', error);
    return;
  }
  
  console.log(`Found ${vehicles.length} BaT vehicles to backfill\n`);
  
  for (const v of vehicles) {
    const url = v.bat_auction_url || v.discovery_url;
    await backfillOne({
      id: v.id,
      vehicle: `${v.year || '?'} ${v.make || '?'} ${v.model || '?'}`,
      url
    });
    
    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }
  
  console.log(`\n✅ Updated: ${stats.updated}, ❌ Failed: ${stats.failed}`);
}

main();

