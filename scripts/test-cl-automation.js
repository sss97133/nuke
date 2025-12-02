#!/usr/bin/env node
/**
 * Test the Craigslist automation system
 * 1. Check if queue table exists
 * 2. Insert test URLs
 * 3. Test discovery function
 * 4. Test processing function
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const TEST_URLS = [
  'https://losangeles.craigslist.org/sfv/cto/d/wrightwood-1973-chevy-k5-blazer/7899670753.html',
  'https://losangeles.craigslist.org/sfv/cto/d/canyon-country-79-chevy-ton-dooley-crew/7899491237.html',
  'https://losangeles.craigslist.org/sfv/cto/d/valley-village-1974-chevy-ton-flatbed/7899495280.html'
];

async function main() {
  console.log('🔍 Testing Craigslist Automation System\n');

  // 1. Check if queue table exists
  console.log('1️⃣ Checking if queue table exists...');
  const { data: tables, error: tableError } = await supabase
    .from('craigslist_listing_queue')
    .select('id')
    .limit(1);

  if (tableError) {
    console.error('❌ Queue table does not exist!');
    console.error('   Error:', tableError.message);
    console.log('\n📝 Apply migration: supabase/migrations/20250129_create_cl_listing_queue.sql');
    console.log('   Run: supabase db push\n');
    return;
  }
  console.log('✅ Queue table exists\n');

  // 2. Check current queue status
  console.log('2️⃣ Checking queue status...');
  const { data: queueStats, error: statsError } = await supabase
    .from('craigslist_listing_queue')
    .select('status')
    .then(({ data, error }) => {
      if (error) return { data: null, error };
      const stats = data.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});
      return { data: stats, error: null };
    });

  if (statsError) {
    console.error('❌ Error fetching queue stats:', statsError.message);
  } else {
    console.log('   Queue stats:', queueStats || { pending: 0 });
  }
  console.log('');

  // 3. Insert test URLs
  console.log('3️⃣ Inserting test URLs into queue...');
  for (const url of TEST_URLS) {
    const { error: insertError } = await supabase
      .from('craigslist_listing_queue')
      .insert({
        listing_url: url,
        region: 'losangeles',
        search_term: 'manual_test',
        status: 'pending'
      });

    if (insertError && !insertError.message.includes('duplicate')) {
      console.error(`   ❌ Failed to insert ${url}:`, insertError.message);
    } else {
      console.log(`   ✅ Queued: ${url.split('/').pop()}`);
    }
  }
  console.log('');

  // 4. Test process-cl-queue function
  console.log('4️⃣ Testing process-cl-queue function...');
  console.log('   Calling edge function to process queue...\n');
  
  const processResponse = await fetch(
    `${supabaseUrl}/functions/v1/process-cl-queue`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ batch_size: 3 })
    }
  );

  if (!processResponse.ok) {
    console.error('❌ Function call failed:', processResponse.status, processResponse.statusText);
    const errorText = await processResponse.text();
    console.error('   Error:', errorText.substring(0, 200));
  } else {
    const result = await processResponse.json();
    console.log('✅ Processing complete!');
    console.log('   Stats:', result.stats);
    
    if (result.vehicles && result.vehicles.length > 0) {
      console.log('\n📊 Created vehicles:');
      result.vehicles.forEach(v => {
        console.log(`   - ${v.year} ${v.make} ${v.model} (${v.id})`);
      });
    }
  }
  console.log('');

  // 5. Check final queue status
  console.log('5️⃣ Final queue status...');
  const { data: finalQueue } = await supabase
    .from('craigslist_listing_queue')
    .select('listing_url, status, error_message')
    .eq('search_term', 'manual_test')
    .order('created_at', { ascending: false });

  if (finalQueue) {
    finalQueue.forEach(item => {
      const emoji = item.status === 'complete' ? '✅' : 
                    item.status === 'failed' ? '❌' : 
                    item.status === 'skipped' ? '⏭️' : '⏳';
      console.log(`   ${emoji} ${item.status.toUpperCase()}: ${item.listing_url.split('/').pop()}`);
      if (item.error_message) {
        console.log(`      Error: ${item.error_message.substring(0, 80)}`);
      }
    });
  }
  console.log('');

  console.log('✅ Test complete!\n');
  console.log('📖 For full setup, see: SETUP_CL_SQUAREBODY_SCRAPING.md');
}

main().catch(console.error);

