/**
 * Apply Analysis Queue Migration via Supabase Client
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

async function executeSQL(sql) {
  // Supabase doesn't have direct SQL execution via client
  // We need to use RPC or break it into smaller operations
  // For now, we'll use the REST API directly
  
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql })
  }).catch(() => null);
  
  if (!response || !response.ok) {
    // Try alternative: use pg REST API
    return { error: 'RPC not available - need to run in Supabase Dashboard' };
  }
  
  return await response.json();
}

async function applyMigration() {
  console.log('🔧 Applying Analysis Queue Migration via Supabase Client...\n');
  
  // Read the consolidated SQL file
  const sqlPath = join(projectRoot, 'scripts/apply-migration-direct.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  
  // Split into logical blocks (table, functions, triggers)
  const blocks = sql.split('-- =====================================================');
  
  console.log(`📝 Found ${blocks.length} migration blocks\n`);
  
  // Try to create table first using a simple insert test
  console.log('📊 Step 1: Creating analysis_queue table...');
  try {
    // Test if table exists by trying to query it
    const { error: testError } = await supabase
      .from('analysis_queue')
      .select('id')
      .limit(1);
    
    if (testError && testError.code === '42P01') {
      console.log('  ⚠️  Table does not exist - need to create via SQL');
      console.log('  📋 Please run: scripts/apply-migration-direct.sql in Supabase Dashboard');
    } else if (testError) {
      console.log(`  ⚠️  Error: ${testError.message}`);
    } else {
      console.log('  ✅ Table already exists!');
    }
  } catch (err) {
    console.log(`  ⚠️  ${err.message}`);
  }
  
  // Test queue_analysis function
  console.log('\n📊 Step 2: Testing queue_analysis function...');
  try {
    const { data: testVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .limit(1)
      .single();
    
    if (testVehicle) {
      const { data: queueId, error: queueError } = await supabase.rpc('queue_analysis', {
        p_vehicle_id: testVehicle.id,
        p_priority: 10, // Low priority test
        p_triggered_by: 'test'
      });
      
      if (queueError) {
        if (queueError.code === '42883') {
          console.log('  ⚠️  Function does not exist - need to create via SQL');
        } else {
          console.log(`  ⚠️  Error: ${queueError.message}`);
        }
      } else {
        console.log(`  ✅ Function exists! Test queue ID: ${queueId}`);
        
        // Clean up test entry
        await supabase
          .from('analysis_queue')
          .delete()
          .eq('id', queueId);
      }
    }
  } catch (err) {
    console.log(`  ⚠️  ${err.message}`);
  }
  
  console.log('\n📋 Migration Status:');
  console.log('  ⚠️  Direct SQL execution not available via client');
  console.log('  📝 Please run the migration manually:');
  console.log(`     1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new`);
  console.log(`     2. Open: scripts/apply-migration-direct.sql`);
  console.log(`     3. Copy and paste the entire file`);
  console.log(`     4. Click "Run"`);
  console.log(`     5. Verify with: SELECT COUNT(*) FROM analysis_queue;`);
}

applyMigration();

