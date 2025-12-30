#!/usr/bin/env node
/**
 * Merge two Broad Arrow organization profiles into one
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ID1 = 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a'; // Broad Arrow Auctions (keep this one)
const ID2 = '6088c2bf-393b-4483-9891-ff226da5e11b'; // Other one (merge into ID1)

async function mergeOrganizations() {
  console.log('🔗 Merging Broad Arrow organizations...\n');
  
  // Get both organizations
  const { data: org1, error: err1 } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', ID1)
    .single();
    
  const { data: org2, error: err2 } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', ID2)
    .single();

  if (err1 || !org1) {
    console.error('❌ Error fetching org1:', err1);
    return;
  }
  
  if (err2 || !org2) {
    console.error('❌ Error fetching org2:', err2);
    return;
  }

  console.log(`Org 1: ${org1.business_name} (${ID1})`);
  console.log(`Org 2: ${org2.business_name} (${ID2})\n`);

  // Use the merge function if available, otherwise manual merge
  try {
    // Try to use the auto-merge function
    const { data, error } = await supabase.functions.invoke('auto-merge-duplicate-orgs', {
      body: { organizationId: ID2 }
    });

    if (!error && data?.merged) {
      console.log('✅ Merged using auto-merge function');
      return;
    }
  } catch (e) {
    console.log('⚠️  Auto-merge function not available, doing manual merge...');
  }

  // Manual merge: move all data from ID2 to ID1
  console.log('\n📦 Moving vehicles from org2 to org1...');
  const { error: vehicleError } = await supabase
    .from('organization_vehicles')
    .update({ organization_id: ID1 })
    .eq('organization_id', ID2);

  if (vehicleError) {
    console.error('❌ Error moving vehicles:', vehicleError);
  } else {
    console.log('✅ Vehicles moved');
  }

  console.log('\n📦 Moving images from org2 to org1...');
  const { error: imageError } = await supabase
    .from('organization_images')
    .update({ organization_id: ID1 })
    .eq('organization_id', ID2);

  if (imageError) {
    console.error('❌ Error moving images:', imageError);
  } else {
    console.log('✅ Images moved');
  }

  console.log('\n📦 Moving timeline events from org2 to org1...');
  const { error: timelineError } = await supabase
    .from('business_timeline_events')
    .update({ business_id: ID1 })
    .eq('business_id', ID2);

  if (timelineError) {
    console.error('❌ Error moving timeline events:', timelineError);
  } else {
    console.log('✅ Timeline events moved');
  }

  // Update org2 to point to org1 or mark as merged
  console.log('\n📝 Updating org2 to mark as merged...');
  const { error: updateError } = await supabase
    .from('businesses')
    .update({
      business_name: `${org2.business_name} (merged into ${org1.business_name})`,
      is_public: false,
      status: 'merged'
    })
    .eq('id', ID2);

  if (updateError) {
    console.error('❌ Error updating org2:', updateError);
  } else {
    console.log('✅ Org2 marked as merged');
  }

  console.log('\n✅ Merge complete!');
  console.log(`   Target org: ${ID1} (${org1.business_name})`);
  console.log(`   Merged org: ${ID2} (${org2.business_name})`);
}

mergeOrganizations().catch(console.error);

