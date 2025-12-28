/**
 * Enrich Organizations with Due Diligence Reports
 * 
 * Runs comprehensive LLM-based due diligence on organizations that are missing
 * descriptions or have generic "other" business types.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function enrichOrganizations() {
  console.log('🔍 Finding organizations needing due diligence reports...\n');

  // Find orgs missing descriptions or with "other" type
  const { data: orgs, error } = await supabase
    .from('businesses')
    .select('id, business_name, description, business_type, website, metadata')
    .eq('is_public', true)
    .or('description.is.null,business_type.eq.other')
    .not('website', 'is', null)
    .limit(100); // Process in batches

  if (error) {
    console.error('❌ Error fetching organizations:', error);
    return;
  }

  if (!orgs || orgs.length === 0) {
    console.log('✅ No organizations need enrichment');
    return;
  }

  console.log(`📊 Found ${orgs.length} organizations needing enrichment\n`);

  let enriched = 0;
  let errors = 0;
  let skipped = 0;

  for (const org of orgs) {
    // Check if already has due diligence report
    if (org.metadata?.due_diligence_report?.description && !org.metadata?.due_diligence_report?.description.includes('meta')) {
      console.log(`⏭️  Skipping ${org.business_name} (already has due diligence report)`);
      skipped++;
      continue;
    }

    console.log(`\n🔍 Processing: ${org.business_name}`);
    console.log(`   Website: ${org.website}`);
    console.log(`   Current type: ${org.business_type || 'null'}`);
    console.log(`   Has description: ${!!org.description}`);

    try {
      const { data, error: ddError } = await supabase.functions.invoke('generate-org-due-diligence', {
        body: {
          organizationId: org.id,
          websiteUrl: org.website,
          forceRegenerate: false
        }
      });

      if (ddError) {
        console.error(`   ❌ Error: ${ddError.message}`);
        if (data?.error) {
          const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
          console.error(`   Details: ${errorMsg.substring(0, 200)}`);
        }
        errors++;
        continue;
      }

      // Check for error in response body
      if (data?.error) {
        const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        console.error(`   ❌ Error: ${errorMsg.substring(0, 200)}`);
        errors++;
        continue;
      }

      if (data?.success || data?.report) {
        console.log(`   ✅ Due diligence report generated`);
        console.log(`   📝 Description: ${data.report?.description?.substring(0, 100)}...`);
        console.log(`   🏢 Business model: ${data.report?.business_model || 'N/A'}`);
        console.log(`   📊 Confidence: ${(data.report?.confidence_score * 100).toFixed(0)}%`);
        enriched++;
      } else {
        console.warn(`   ⚠️  Unexpected response:`, data);
        errors++;
      }

      // Rate limiting - wait 2 seconds between requests to avoid API limits
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      console.error(`   ❌ Exception: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n\n📊 Summary:`);
  console.log(`   ✅ Enriched: ${enriched}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   📈 Total processed: ${orgs.length}`);
}

// Run the enrichment
enrichOrganizations()
  .then(() => {
    console.log('\n✅ Enrichment complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  });

