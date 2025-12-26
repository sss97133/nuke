/**
 * Add Collective Auto Group to Speed Digital clients
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addCollectiveAuto() {
  console.log('🚀 Adding Collective Auto Group...\n');

  try {
    // Check if exists
    const { data: existing } = await supabase
      .from('businesses')
      .select('id, business_name, website, metadata')
      .eq('website', 'https://www.collectiveauto.com')
      .maybeSingle();

    let orgId;

    if (existing) {
      orgId = existing.id;
      console.log(`✅ Collective Auto Group already exists: ${orgId}`);
      
      // Update metadata
      await supabase
        .from('businesses')
        .update({
          metadata: {
            ...existing.metadata,
            speed_digital_client: true,
            discovered_from: 'manual',
            discovered_at: new Date().toISOString(),
          },
        })
        .eq('id', orgId);
      
      console.log('✅ Updated metadata');
    } else {
      // Create new
      const { data: newOrg, error } = await supabase
        .from('businesses')
        .insert({
          business_name: 'Collective Auto Group',
          business_type: 'dealership',
          website: 'https://www.collectiveauto.com',
          metadata: {
            speed_digital_client: true,
            discovered_from: 'manual',
            discovered_at: new Date().toISOString(),
          },
        })
        .select('id')
        .single();

      if (error) {
        console.error('❌ Error:', error);
        process.exit(1);
      }

      orgId = newOrg.id;
      console.log(`✅ Created Collective Auto Group: ${orgId}`);
    }

    // Link to Speed Digital
    const { data: sdOrg } = await supabase
      .from('businesses')
      .select('id')
      .eq('website', 'https://www.speeddigital.com')
      .single();

    if (sdOrg) {
      await supabase
        .from('businesses')
        .update({
          metadata: {
            speed_digital_service_provider_id: sdOrg.id,
          },
        })
        .eq('id', orgId);
      
      console.log('✅ Linked to Speed Digital');
    }

    console.log('\n🎉 Complete!');
    console.log(`   Organization ID: ${orgId}`);
    console.log(`   Website: https://www.collectiveauto.com`);
    console.log('\n📋 Next: Run enrichment to extract expertise');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

addCollectiveAuto();

