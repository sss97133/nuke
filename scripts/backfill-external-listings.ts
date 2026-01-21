import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SOURCE_TO_PLATFORM: Record<string, string> = {
  'Bring a Trailer': 'bat',
  'Cars & Bids': 'cars_and_bids',
  'PCarMarket': 'pcarmarket',
  'Collecting Cars': 'collecting_cars',
  'Broad Arrow Auctions': 'broad_arrow',
  'RM Sothebys': 'rmsothebys',
  'Gooding & Company': 'gooding',
  'SBX Cars': 'sbx',
};

const PLATFORM_ORG_IDS: Record<string, string> = {
  'bat': 'bd035ea4-75f0-4b17-ad02-aee06283343f',
  'cars_and_bids': '822cae29-f80e-4859-9c48-a1485a543152',
  'pcarmarket': 'f7c80592-6725-448d-9b32-2abf3e011cf8',
  'collecting_cars': '0d435048-f2c5-47ba-bba0-4c18c6d58686',
  'broad_arrow': 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a',
  'rmsothebys': '5761f2bf-d37f-4b24-aa38-0d8c95ea2ae1',
  'gooding': '98a2e93e-b814-4fda-b48a-0bb5440b7d00',
  'sbx': '37b84b5e-ee28-410a-bea5-8d4851e39525',
};

async function backfillExternalListings() {
  console.log('=== BACKFILLING EXTERNAL LISTINGS ===\n');

  for (const [source, platform] of Object.entries(SOURCE_TO_PLATFORM)) {
    const orgId = PLATFORM_ORG_IDS[platform];

    // Get vehicles from this source that are live
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, listing_url, listing_title, high_bid, bid_count, auction_end_date, primary_image_url, reserve_status')
      .eq('auction_source', source)
      .eq('sale_status', 'auction_live');

    if (!vehicles || vehicles.length === 0) {
      console.log(`${source.padEnd(25)} No active vehicles`);
      continue;
    }

    let created = 0;
    let skipped = 0;

    for (const v of vehicles) {
      // Check if external_listing exists
      const { count } = await supabase
        .from('external_listings')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', v.id)
        .eq('platform', platform);

      if ((count || 0) > 0) {
        skipped++;
        continue;
      }

      // Create external_listing
      const { error } = await supabase.from('external_listings').insert({
        vehicle_id: v.id,
        organization_id: orgId,
        platform: platform,
        listing_url: v.listing_url,
        listing_status: 'active',
        current_bid: v.high_bid,
        bid_count: v.bid_count || 0,
        end_date: v.auction_end_date,
        metadata: {
          source: 'backfill',
          title: v.listing_title,
          image_url: v.primary_image_url,
          reserve_status: v.reserve_status,
        },
        updated_at: new Date().toISOString(),
      });

      if (!error) {
        created++;
      } else {
        console.log(`  Error: ${error.message}`);
      }
    }

    console.log(`${source.padEnd(25)} Created: ${created} | Skipped: ${skipped}`);
  }

  console.log('\n=== VERIFICATION ===');
  const platforms = ['bat', 'cars_and_bids', 'pcarmarket', 'collecting_cars', 'broad_arrow', 'rmsothebys', 'gooding', 'sbx'];
  for (const p of platforms) {
    const { count } = await supabase.from('external_listings').select('*', { count: 'exact', head: true }).eq('platform', p).eq('listing_status', 'active');
    console.log(`${p.padEnd(20)} Active: ${count || 0}`);
  }
}

backfillExternalListings().catch(console.error);
