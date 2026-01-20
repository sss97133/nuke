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

// Only link when explicitly configured
const TARGET_ORG_ID = process.env.TARGET_ORG_ID || '';

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

    if (!TARGET_ORG_ID) {
      console.warn('TARGET_ORG_ID not set. Skipping link operation.');
      return;
    }

    const { data: linkData, error: linkError } = await supabase
      .from('organization_vehicles')
      .insert({
        organization_id: TARGET_ORG_ID,
        vehicle_id: vehicle.id,
        relationship_type: 'in_stock',
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

  console.log(`\nLinked ${linked} vehicles to org ${TARGET_ORG_ID || '(unset)'}`);
}

linkVehicles().catch(console.error);
