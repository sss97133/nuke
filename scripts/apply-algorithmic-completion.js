#!/usr/bin/env node
/**
 * Apply algorithmic completion calculator to database
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🚀 Applying Algorithmic Completion Calculator\n');
  
  const sqlPath = path.join(__dirname, '../supabase/migrations/20251018_algorithmic_completion.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('📝 SQL Migration File Loaded\n');
  console.log('⚠️  Note: This migration must be run manually in Supabase Dashboard > SQL Editor\n');
  console.log('Navigate to:');
  console.log(`${supabaseUrl.replace('https://', 'https://supabase.com/dashboard/project/')}/sql/new\n`);
  console.log('Then paste and execute the SQL from:');
  console.log(`supabase/migrations/20251018_algorithmic_completion.sql\n`);
  console.log('────────────────────────────────────────────────────────\n');
  
  // Test if function exists by trying to call it
  const { data: testVehicles } = await supabase
    .from('vehicles')
    .select('id')
    .limit(1);
  
  if (testVehicles && testVehicles.length > 0) {
    console.log('🧪 Testing if function already exists...\n');
    
    const { data, error } = await supabase.rpc('calculate_vehicle_completion_algorithmic', {
      p_vehicle_id: testVehicles[0].id
    });
    
    if (error) {
      console.log('❌ Function not yet deployed');
      console.log('   Error:', error.message);
      console.log('\n📋 Please run the migration manually as described above.\n');
    } else {
      console.log('✅ Function already deployed!');
      console.log('   Test result:', data);
      console.log('\n🎉 Algorithmic completion calculator is ready!\n');
      
      // Show example usage
      console.log('Example usage:');
      console.log('```sql');
      console.log('SELECT calculate_vehicle_completion_algorithmic(\'vehicle-uuid-here\');');
      console.log('```\n');
    }
  }
}

main().catch(console.error);

