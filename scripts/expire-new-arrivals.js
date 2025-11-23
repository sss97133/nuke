#!/usr/bin/env node

/**
 * Auto-expire "new_arrival" status after 3 days
 * Changes listing_status from 'new_arrival' to 'for_sale' for old inventory
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local
config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function expireNewArrivals() {
  console.log('🕐 Expiring new arrivals older than 3 days...\n');

  try {
    // Call the database function
    const { data, error } = await supabase.rpc('auto_expire_new_arrivals');

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    const expiredCount = data || 0;
    
    if (expiredCount > 0) {
      console.log(`✅ Expired ${expiredCount} "new_arrival" vehicles`);
      console.log(`   Changed status: new_arrival → for_sale`);
    } else {
      console.log('✅ No new arrivals to expire (all within 3 days)');
    }

  } catch (err) {
    console.error('❌ Exception:', err);
  }
}

// Run the expiration
expireNewArrivals().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

