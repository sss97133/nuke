/**
 * Trigger organization extraction for a Classic.com vehicle
 * Usage: node scripts/trigger-org-extraction.js <vehicle_id> <seller_url>
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

async function triggerOrgExtraction(vehicleId, sellerUrl, sellerName) {
  console.log(`🔍 Triggering organization extraction for vehicle ${vehicleId}`);
  console.log(`   Seller: ${sellerName}`);
  console.log(`   URL: ${sellerUrl}`);
  
  try {
    const { data, error } = await supabase.functions.invoke('extract-organization-from-seller', {
      body: {
        seller_name: sellerName,
        seller_url: sellerUrl,
        platform: 'classic_com',
        vehicle_id: vehicleId,
      }
    });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log('✅ Result:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

// Get args
const vehicleId = process.argv[2];
const sellerUrl = process.argv[3] || 'https://www.classic.com/s/2002ad-8pJl1On/';
const sellerName = process.argv[4] || '2002AD';

if (!vehicleId) {
  console.error('Usage: node scripts/trigger-org-extraction.js <vehicle_id> [seller_url] [seller_name]');
  console.error('Example: node scripts/trigger-org-extraction.js dccdd531-8d98-470e-bd36-863ce8f77d3d');
  process.exit(1);
}

triggerOrgExtraction(vehicleId, sellerUrl, sellerName);

