import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SOURCE_TO_ORG: Record<string, string> = {
  'Bring a Trailer': 'bd035ea4-75f0-4b17-ad02-aee06283343f',
  'Cars & Bids': '822cae29-f80e-4859-9c48-a1485a543152',
  'PCarMarket': 'f7c80592-6725-448d-9b32-2abf3e011cf8',
  'Collecting Cars': '0d435048-f2c5-47ba-bba0-4c18c6d58686',
  'Broad Arrow Auctions': 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a',
  'RM Sothebys': '5761f2bf-d37f-4b24-aa38-0d8c95ea2ae1',
  'Gooding & Company': '98a2e93e-b814-4fda-b48a-0bb5440b7d00',
  'SBX Cars': '37b84b5e-ee28-410a-bea5-8d4851e39525',
};

async function linkVehiclesToOrgs() {
  console.log('=== LINKING AUCTION VEHICLES TO ORGANIZATIONS ===\n');

  for (const [source, orgId] of Object.entries(SOURCE_TO_ORG)) {
    // Get vehicles from this source
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('auction_source', source);

    if (!vehicles || vehicles.length === 0) {
      console.log(`${source}: No vehicles`);
      continue;
    }

    let created = 0;
    let skipped = 0;

    for (const v of vehicles) {
      // Check if link exists
      const { count } = await supabase
        .from('organization_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', v.id)
        .eq('organization_id', orgId);

      if ((count || 0) > 0) {
        skipped++;
        continue;
      }

      // Create link
      const { error } = await supabase.from('organization_vehicles').insert({
        vehicle_id: v.id,
        organization_id: orgId,
        relationship_type: 'consigner',
        status: 'active',
      });

      if (!error) {
        created++;
      }
    }

    console.log(`${source.padEnd(25)} Created: ${created} | Skipped: ${skipped}`);
  }

  // Verify
  console.log('\n=== VERIFICATION ===');
  for (const [source, orgId] of Object.entries(SOURCE_TO_ORG)) {
    const { count } = await supabase
      .from('organization_vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    console.log(`${source.padEnd(25)} Org vehicles: ${count || 0}`);
  }
}

linkVehiclesToOrgs().catch(console.error);
