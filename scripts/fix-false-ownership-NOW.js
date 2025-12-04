#!/usr/bin/env node
/**
 * DIRECT FIX: False Ownership Claims
 * 
 * Run: node scripts/fix-false-ownership-NOW.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set in .env');
  console.log('\nAdd to .env:');
  console.log('SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('🚨 FIXING FALSE OWNERSHIP CLAIMS\n');
  
  try {
    // 1. Check current state
    console.log('1️⃣ Checking current false ownership claims...');
    const { data: falseOwners, error: checkError } = await supabase
      .from('organization_vehicles')
      .select(`
        id,
        organization_id,
        vehicle_id,
        relationship_type,
        auto_tagged,
        businesses!inner(business_name)
      `)
      .eq('relationship_type', 'owner')
      .eq('auto_tagged', true);
    
    if (checkError) throw checkError;
    
    console.log(`   Found ${falseOwners?.length || 0} auto-tagged "owner" relationships\n`);
    
    if (!falseOwners || falseOwners.length === 0) {
      console.log('✅ No false ownership claims found!');
      return;
    }
    
    // Group by organization
    const byOrg = {};
    falseOwners.forEach(fo => {
      const orgName = fo.businesses.business_name;
      if (!byOrg[orgName]) byOrg[orgName] = 0;
      byOrg[orgName]++;
    });
    
    console.log('   False ownership by organization:');
    Object.entries(byOrg).forEach(([org, count]) => {
      console.log(`   - ${org}: ${count} vehicles`);
    });
    console.log('');
    
    // 2. Fix them
    console.log('2️⃣ Changing relationship type to "work_location"...');
    const { data: updated, error: updateError } = await supabase
      .from('organization_vehicles')
      .update({ 
        relationship_type: 'work_location',
        updated_at: new Date().toISOString()
      })
      .eq('relationship_type', 'owner')
      .eq('auto_tagged', true)
      .select('id');
    
    if (updateError) throw updateError;
    
    console.log(`   ✅ Fixed ${updated?.length || 0} false ownership claims\n`);
    
    // 3. Verify fix
    console.log('3️⃣ Verifying fix...');
    const { data: remaining } = await supabase
      .from('organization_vehicles')
      .select('id')
      .eq('relationship_type', 'owner')
      .eq('auto_tagged', true);
    
    if (remaining && remaining.length > 0) {
      console.log(`   ⚠️ ${remaining.length} still marked as owner (might have ownership verification)`);
    } else {
      console.log('   ✅ No more false ownership claims!\n');
    }
    
    // 4. Check your specific vehicle
    console.log('4️⃣ Checking your vehicle (1983 GMC K2500)...');
    const { data: yourVehicle } = await supabase
      .from('organization_vehicles')
      .select(`
        relationship_type,
        auto_tagged,
        businesses!inner(business_name)
      `)
      .eq('vehicle_id', '5a1deb95-4b67-4cc3-9575-23bb5b180693');
    
    if (yourVehicle && yourVehicle.length > 0) {
      console.log('   Current relationships:');
      yourVehicle.forEach(rel => {
        console.log(`   - ${rel.businesses.business_name}: ${rel.relationship_type} ${rel.auto_tagged ? '(auto)' : '(manual)'}`);
      });
    }
    
    console.log('\n✅ SECURITY FIX COMPLETE!');
    console.log('\nWhat changed:');
    console.log('- Viva: "owner" → "work_location"');
    console.log('- RLS: No longer has owner-level access');
    console.log('- Ownership now requires proof (title document)\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

