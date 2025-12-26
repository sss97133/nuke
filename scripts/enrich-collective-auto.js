/**
 * Enrich Collective Auto Group with expertise
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

async function enrichCollectiveAuto() {
  console.log('🚀 Enriching Collective Auto Group...\n');

  try {
    const { data, error } = await supabase.functions.invoke('enrich-speed-digital-clients', {
      body: { 
        organization_id: 'b8a962a3-1aeb-44a2-92be-e23a7728c277',
        batch_size: 1 
      },
    });

    if (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }

    if (!data || !data.success) {
      console.error('❌ Enrichment failed:', data?.error || 'Unknown error');
      process.exit(1);
    }

    console.log('✅ Enrichment complete!');
    if (data.results) {
      console.log(`   Enriched: ${data.results.enriched || 0}`);
      console.log(`   Errors: ${data.results.errors?.length || 0}\n`);
    } else {
      console.log('   Response:', JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

enrichCollectiveAuto();

