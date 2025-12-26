/**
 * Run Speed Digital Client Discovery
 * 
 * Invokes the discover-speed-digital-clients Edge Function
 * to scrape Speed Digital's work page and create all client organizations
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runDiscovery() {
  console.log('🚀 Starting Speed Digital Client Discovery...\n');

  try {
    const { data, error } = await supabase.functions.invoke('discover-speed-digital-clients', {
      body: {},
    });

    if (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }

    if (!data || !data.success) {
      console.error('❌ Discovery failed:', data?.error || 'Unknown error');
      process.exit(1);
    }

    console.log('\n✅ DISCOVERY COMPLETE!\n');
    console.log('📊 Results:');
    console.log(`   Speed Digital Org ID: ${data.speed_digital_org_id}`);
    console.log(`   Clients Discovered: ${data.clients_discovered}`);
    console.log(`   Clients Resolved: ${data.clients_resolved}`);
    console.log(`   Created: ${data.results.created}`);
    console.log(`   Existing: ${data.results.existing}`);
    console.log(`   Linked: ${data.results.linked}`);
    console.log(`   Errors: ${data.results.errors.length}`);

    if (data.results.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      data.results.errors.forEach(err => console.log(`   - ${err}`));
    }

    console.log('\n📋 Client URLs:');
    data.clients.forEach(client => {
      const status = client.resolved ? '✅' : '⚠️';
      console.log(`   ${status} ${client.name}: ${client.website_url || '(unresolved)'}`);
    });

    console.log('\n🎯 Next Steps:');
    console.log('   1. Review created organizations in Supabase Dashboard');
    console.log('   2. Run thorough-site-mapper on one client to create template');
    console.log('   3. Batch ingest all clients using the template');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

runDiscovery();

