import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkVehicles() {
  // Get recently added vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, listing_url, selling_organization_id, owner_id, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log('Recent vehicles:');
  for (const v of vehicles) {
    const url = v.listing_url ? v.listing_url.substring(0, 60) : 'NONE';
    console.log(`  ${v.year} ${v.make} ${v.model}`);
    console.log(`    ID: ${v.id}`);
    console.log(`    URL: ${url}`);
    console.log(`    Org: ${v.selling_organization_id || 'NONE'}`);
    console.log(`    Owner: ${v.owner_id || 'NONE'}`);
    console.log('');
  }

  // Check organization_vehicles for these
  const vehicleIds = vehicles.map(v => v.id);
  const { data: orgLinks } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id, organization_id, relationship_type')
    .in('vehicle_id', vehicleIds);

  console.log('Organization links:', orgLinks?.length || 0);
  if (orgLinks) {
    for (const link of orgLinks) {
      console.log(`  Vehicle ${link.vehicle_id} -> Org ${link.organization_id} (${link.relationship_type})`);
    }
  }

  // Count total vehicles from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', today.toISOString());

  console.log(`\nTotal vehicles added today: ${count}`);
}

checkVehicles().catch(console.error);
