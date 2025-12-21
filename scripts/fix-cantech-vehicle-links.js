/**
 * Fix Cantech Automotive Vehicle Links
 * 
 * Updates relationship_type to 'seller' for better inventory display
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const CANTECH_ORG_ID = 'db6585be-dfab-4f07-ac73-11d18586d4f6';

async function fixLinks() {
  console.log('🔧 Fixing Cantech Automotive vehicle links...\n');

  // Get all linked vehicles
  const { data: links } = await supabase
    .from('organization_vehicles')
    .select('id, vehicle_id, relationship_type, status, vehicles!inner(year, make, model)')
    .eq('organization_id', CANTECH_ORG_ID);

  if (!links || links.length === 0) {
    console.log('No vehicles linked');
    return;
  }

  console.log(`Found ${links.length} linked vehicles\n`);

  // Update 'consigner' to 'seller' for dealer inventory
  const toUpdate = links.filter(l => 
    l.relationship_type === 'consigner' && l.status === 'active'
  );

  if (toUpdate.length > 0) {
    console.log(`Updating ${toUpdate.length} vehicles from 'consigner' to 'seller'...`);
    
    for (const link of toUpdate) {
      const v = link.vehicles;
      console.log(`  - ${v.year} ${v.make} ${v.model}`);
      
      const { error } = await supabase
        .from('organization_vehicles')
        .update({
          relationship_type: 'seller',
          updated_at: new Date().toISOString(),
        })
        .eq('id', link.id);

      if (error) {
        console.error(`    ❌ Error: ${error.message}`);
      } else {
        console.log(`    ✅ Updated`);
      }
    }
  } else {
    console.log('✅ All vehicles already have correct relationship_type');
  }

  console.log('\n✅ Done!');
}

fixLinks().catch(console.error);

