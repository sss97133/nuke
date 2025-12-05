/**
 * Link Viva, Ernie's, and Taylor to the 1974 Bronco
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VEHICLE_ID = 'eea40748-cdc1-4ae9-ade1-4431d14a7726';

const ORGS = [
  {
    id: 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
    name: 'Viva! Las Vegas Autos',
    relationship: 'work_location'
  },
  {
    id: 'e796ca48-f3af-41b5-be13-5335bb422b41',
    name: 'Ernies Upholstery',
    relationship: 'service_provider' // 'upholstery' not in allowed list
  },
  {
    id: '66352790-b70e-4de8-bfb1-006b91fa556f',
    name: 'Taylor Customs',
    relationship: 'service_provider' // 'painter' not in allowed list
  }
];

async function linkOrganizations() {
  console.log(`🔗 Linking organizations to vehicle ${VEHICLE_ID}\n`);

  for (const org of ORGS) {
    // Check if already linked
    const { data: existing } = await supabase
      .from('organization_vehicles')
      .select('id')
      .eq('organization_id', org.id)
      .eq('vehicle_id', VEHICLE_ID)
      .eq('relationship_type', org.relationship)
      .maybeSingle();

    if (existing) {
      console.log(`  ⏭  Already linked: ${org.name} (${org.relationship})`);
      continue;
    }

    // Create link
    const { error } = await supabase
      .from('organization_vehicles')
      .insert({
        organization_id: org.id,
        vehicle_id: VEHICLE_ID,
        relationship_type: org.relationship,
        status: 'active',
        auto_tagged: false,
        notes: 'Manually linked - vehicle worked on at this organization'
      });

    if (error) {
      console.error(`  ❌ Error linking ${org.name}:`, error.message);
    } else {
      console.log(`  ✅ Linked: ${org.name} (${org.relationship})`);
    }
  }

  console.log('\n✅ Done!\n');
}

linkOrganizations().catch(console.error);

