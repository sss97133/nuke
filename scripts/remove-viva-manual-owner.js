#!/usr/bin/env node
/**
 * Remove manual false ownership claim for Viva on your truck
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('🔍 Checking manual ownership claims...\n');
  
  // Find the manual owner relationship
  const { data: manualOwner } = await supabase
    .from('organization_vehicles')
    .select(`
      id,
      relationship_type,
      auto_tagged,
      created_at,
      linked_by_user_id,
      businesses!inner(business_name)
    `)
    .eq('vehicle_id', '5a1deb95-4b67-4cc3-9575-23bb5b180693')
    .eq('relationship_type', 'owner')
    .eq('auto_tagged', false);  // Manual only
  
  if (!manualOwner || manualOwner.length === 0) {
    console.log('✅ No manual false ownership claims found!');
    return;
  }
  
  console.log('Found manual ownership claims:');
  manualOwner.forEach(rel => {
    console.log(`  - ${rel.businesses.business_name}`);
    console.log(`    Created: ${new Date(rel.created_at).toLocaleString()}`);
    console.log(`    Linked by: ${rel.linked_by_user_id}`);
  });
  
  console.log('\n❓ Remove these manual ownership claims? (y/n)');
  
  // Auto-confirm in non-interactive mode
  const remove = true;  // Set to false to prompt
  
  if (remove) {
    console.log('\n🗑️ Removing manual false ownership claims...');
    
    const { data: deleted, error: deleteError } = await supabase
      .from('organization_vehicles')
      .delete()
      .eq('vehicle_id', '5a1deb95-4b67-4cc3-9575-23bb5b180693')
      .eq('relationship_type', 'owner')
      .eq('auto_tagged', false)
      .select('id');
    
    if (deleteError) throw deleteError;
    
    console.log(`   ✅ Removed ${deleted?.length || 0} false ownership claims\n`);
    
    // Verify
    const { data: remaining } = await supabase
      .from('organization_vehicles')
      .select('relationship_type, businesses!inner(business_name)')
      .eq('vehicle_id', '5a1deb95-4b67-4cc3-9575-23bb5b180693');
    
    console.log('✅ Current relationships for your truck:');
    remaining?.forEach(rel => {
      console.log(`   - ${rel.businesses.business_name}: ${rel.relationship_type}`);
    });
  }
}

main().catch(console.error);

