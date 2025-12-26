/**
 * Enrich Remaining Speed Digital Clients
 * Processes only clients missing description/specializations/services
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

async function enrichRemaining() {
  console.log('🚀 Enriching Remaining Speed Digital Clients...\n');

  // Get clients missing data
  const { data: clients, error } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .eq('metadata->>speed_digital_client', 'true')
    .or('description.is.null,specializations.is.null,services_offered.is.null');

  if (error) {
    console.error('❌ Error fetching clients:', error);
    process.exit(1);
  }

  if (!clients || clients.length === 0) {
    console.log('✅ All clients already enriched!');
    return;
  }

  console.log(`📋 Found ${clients.length} clients needing enrichment:\n`);
  clients.forEach(c => console.log(`   - ${c.business_name} (${c.website})`));
  console.log('');

  let totalEnriched = 0;

  // Process one at a time to avoid timeouts
  for (const client of clients) {
    try {
      console.log(`🔍 Processing ${client.business_name}...`);
      
      const { data, error: invokeError } = await supabase.functions.invoke('enrich-speed-digital-clients', {
        body: { organization_id: client.id, batch_size: 1 },
      });

      if (invokeError) {
        console.error(`   ❌ Error: ${invokeError.message}`);
        continue;
      }

      if (data && data.success) {
        totalEnriched += data.results.enriched;
        console.log(`   ✅ Enriched: ${data.results.enriched}`);
        if (data.results.errors.length > 0) {
          console.log(`   ⚠️  Errors: ${data.results.errors.join(', ')}`);
        }
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`   ❌ Fatal error for ${client.business_name}:`, error.message);
    }

    console.log('');
  }

  console.log(`\n🎉 Complete! Total enriched: ${totalEnriched} clients`);
}

enrichRemaining();

