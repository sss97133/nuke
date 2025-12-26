/**
 * Enrich Speed Digital Clients with Expertise
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

async function enrichClients() {
  console.log('🚀 Enriching Speed Digital Clients with Expertise...\n');

  try {
    // Process in batches of 5
    let totalEnriched = 0;
    let batch = 1;

    while (true) {
      console.log(`📦 Processing batch ${batch}...\n`);
      
      const { data, error } = await supabase.functions.invoke('enrich-speed-digital-clients', {
        body: { batch_size: 5 },
      });

      if (error) {
        console.error('❌ Error:', error);
        break;
      }

      if (!data || !data.success) {
        console.error('❌ Enrichment failed:', data?.error || 'Unknown error');
        break;
      }

      totalEnriched += data.results.enriched;
      console.log(`✅ Batch ${batch} complete:`);
      console.log(`   Enriched: ${data.results.enriched}`);
      console.log(`   Errors: ${data.results.errors.length}\n`);

      if (data.results.processed < 5) {
        // Last batch
        break;
      }

      batch++;
      await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit between batches
    }

    console.log(`\n🎉 Complete! Total enriched: ${totalEnriched} clients`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

enrichClients();

