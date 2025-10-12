#!/usr/bin/env node
/**
 * Test shipping_tasks table
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function testShippingTable() {
  console.log('Testing shipping_tasks table...');
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Test query
  const { data, error } = await supabase
    .from('shipping_tasks')
    .select('*')
    .limit(5);
  
  if (error) {
    console.error('Error querying shipping_tasks:', error);
    process.exit(1);
  }
  
  console.log('✅ Table exists and is accessible!');
  console.log(`Found ${data?.length || 0} shipping tasks`);
  
  // Check table structure
  const { data: columns } = await supabase
    .rpc('get_columns', {
      table_name: 'shipping_tasks'
    })
    .limit(1);
    
  if (columns) {
    console.log('Table columns:', columns);
  }
}

testShippingTable().catch(console.error);
