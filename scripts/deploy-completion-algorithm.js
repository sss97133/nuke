#!/usr/bin/env node
/**
 * Deploy Algorithmic Completion Calculator to Production
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

async function executeSQL(sql) {
  // Try to execute via edge function or direct query
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  
  if (error && error.code === '42883') {
    // exec_sql doesn't exist, that's ok - migration needs manual execution
    return { needsManual: true };
  }
  
  return { data, error };
}

async function main() {
  console.log('🚀 Deploying Algorithmic Completion Calculator\n');
  
  const sqlPath = path.join(__dirname, '../supabase/migrations/20251018_algorithmic_completion.sql');
  const fullSQL = fs.readFileSync(sqlPath, 'utf8');
  
  // Split into statements
  const statements = fullSQL
    .split(/;[\s\n]+(?=CREATE|DROP|COMMENT|ALTER)/g)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'))
    .map(s => s.endsWith(';') ? s : s + ';');
  
  console.log(`Found ${statements.length} SQL statements to execute\n`);
  
  let executed = 0;
  let failed = 0;
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 60).replace(/\n/g, ' ');
    
    console.log(`\n[${i + 1}/${statements.length}] ${preview}...`);
    
    const result = await executeSQL(stmt);
    
    if (result.needsManual) {
      console.log('⚠️  Needs manual execution in Supabase Dashboard');
      break;
    } else if (result.error) {
      console.log(`  ❌ Error: ${result.error.message}`);
      failed++;
    } else {
      console.log(`  ✅ Success`);
      executed++;
    }
  }
  
  if (executed > 0) {
    console.log(`\n✅ Deployed ${executed} statements successfully!`);
    
    // Test the function
    console.log('\n🧪 Testing function...\n');
    
    const { data: testVehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .limit(1);
    
    if (testVehicles && testVehicles.length > 0) {
      const testVehicle = testVehicles[0];
      const { data, error } = await supabase.rpc('calculate_vehicle_completion_algorithmic', {
        p_vehicle_id: testVehicle.id
      });
      
      if (error) {
        console.log('❌ Function test failed:', error.message);
      } else {
        console.log('✅ Function working!');
        console.log(`   Test vehicle: ${testVehicle.year} ${testVehicle.make} ${testVehicle.model}`);
        console.log(`   Result:`, JSON.stringify(data, null, 2));
      }
    }
  } else {
    console.log('\n⚠️  Migration requires manual execution\n');
    console.log('Please run in Supabase Dashboard > SQL Editor:');
    console.log(`${supabaseUrl.replace('https://', 'https://supabase.com/dashboard/project/')}/sql/new\n`);
    console.log('Copy/paste from: supabase/migrations/20251018_algorithmic_completion.sql');
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

