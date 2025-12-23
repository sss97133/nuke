/**
 * Trigger organization site scraping
 * Usage: node scripts/scrape-org-site.js <organization_id> [website]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function scrapeOrgSite(orgId, website) {
  console.log(`🔍 Scraping organization site for org ${orgId}`);
  console.log(`   Website: ${website}`);
  
  try {
    const { data, error } = await supabase.functions.invoke('scrape-organization-site', {
      body: {
        organization_id: orgId,
        website: website,
      }
    });

    if (error) {
      console.error('❌ Error:', error.message);
      if (error.message.includes('Function not found') || error.message.includes('404')) {
        console.error('\n💡 Function not deployed yet. Deploy with:');
        console.error('   supabase functions deploy scrape-organization-site');
      }
      return;
    }

    console.log('\n✅ Result:');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

// Get args
const orgId = process.argv[2] || '1970291b-081c-4550-94e1-633d194a2a99';
const website = process.argv[3] || 'https://2002ad.com';

scrapeOrgSite(orgId, website);

