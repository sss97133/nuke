#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log('🚀 Running page indexing...\n');
  
  const { data, error } = await supabase.functions.invoke('index-reference-pages', {
    body: { limit: 20 }
  });
  
  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }
  
  console.log('\n✅ Result:');
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);



