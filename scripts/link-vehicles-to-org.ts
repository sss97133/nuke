/**
 * Link unassociated vehicles to an organization
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TARGET_ORG_ID = process.env.TARGET_ORG_ID || '20e1d1e0-06b5-43b9-a994-7b5b9accb405';

async function linkVehicles() {
  // Get vehicles added today that don't have org links
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .gte('created_at', today.toISOString())
    .is('selling_organization_id', null)
    .is('owner_id', null);

  if (error) {
    console.error('Error fetching vehicles:', error.message);
    return;
  }

  console.log(`Found ${vehicles?.length || 0} vehicles to link`);

  let linked = 0;
  for (const vehicle of vehicles || []) {
    // Check if already linked
    const { data: existing } = await supabase
      .from('organization_vehicles')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .eq('organization_id', TARGET_ORG_ID)
      .limit(1);

    if (existing?.length) {
      continue;
    }

    const { data: linkData, error: linkError } = await supabase
      .from('organization_vehicles')
      .insert({
        organization_id: TARGET_ORG_ID,
        vehicle_id: vehicle.id,
        relationship_type: 'work_location',
        auto_tagged: true,
        status: 'active',
      })
      .select();

    if (linkError) {
      console.log(`  Error linking ${vehicle.id}: ${linkError.message}`);
    } else {
      linked++;
      console.log(`  Linked: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    }
  }

  console.log(`\nLinked ${linked} vehicles to org ${TARGET_ORG_ID}`);
}

linkVehicles().catch(console.error);
