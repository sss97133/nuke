#!/usr/bin/env node
/**
 * Create shipping_tasks table directly in remote database
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.error('Add it to your .env file');
  process.exit(1);
}

async function createShippingTable() {
  console.log('Connecting to Supabase...');
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log('Creating shipping_tasks table...');
  
  // First, check if table exists
  const { data: existingTable } = await supabase
    .from('shipping_tasks')
    .select('id')
    .limit(1);
  
  if (existingTable !== null) {
    console.log('Table shipping_tasks already exists!');
    return;
  }
  
  console.log('Table does not exist, creating it now...');
  
  // Since we can't execute raw SQL directly without exec_sql function,
  // we'll need to do this through the dashboard
  console.log('\n===========================================');
  console.log('MANUAL STEP REQUIRED:');
  console.log('===========================================\n');
  console.log('1. Go to your Supabase dashboard:');
  console.log('   https://app.supabase.com/project/qkgaybvrernstplzjaam/sql/new');
  console.log('\n2. Copy and paste the SQL from this file:');
  console.log('   /Users/skylar/nuke/supabase/migrations/20250920_shipping_tracking_system.sql');
  console.log('\n3. Click "Run" to execute the migration');
  console.log('\n4. Then refresh your vehicle profile page');
  console.log('\n===========================================\n');
  
  // Test if we can at least query vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id')
    .limit(1);
    
  if (error) {
    console.log('Error connecting to database:', error.message);
  } else {
    console.log('Database connection verified - vehicles table accessible');
  }
}

createShippingTable().catch(console.error);
