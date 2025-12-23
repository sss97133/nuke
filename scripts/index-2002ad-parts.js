/**
 * Index 2002AD parts catalog
 * Usage: node scripts/index-2002ad-parts.js [organization_id] [start_category_id]
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

async function indexParts(orgId, startCategoryId = 0) {
  console.log(`🔍 Indexing 2002AD parts for organization ${orgId}`);
  if (startCategoryId > 0) {
    console.log(`   Starting from category ${startCategoryId}`);
  }
  
  try {
    const { data, error } = await supabase.functions.invoke('index-2002ad-parts', {
      body: {
        organization_id: orgId,
        start_category_id: startCategoryId,
      }
    });

    if (error) {
      console.error('❌ Error:', error.message);
      return;
    }

    console.log('\n✅ Result:');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

// Get args
const orgId = process.argv[2] || '1970291b-081c-4550-94e1-633d194a2a99'; // 2002AD org ID
const startCategoryId = parseInt(process.argv[3] || '0');

indexParts(orgId, startCategoryId);

