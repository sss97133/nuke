#!/usr/bin/env npx tsx
/**
 * Add columns using Supabase client (no raw SQL)
 */
import { createClient } from '@supabase/supabase-js';

async function addColumnsViaSupabase() {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log('🔗 Checking if columns exist...');

  // Check if contact_info column exists by trying to query it
  const { error: checkError } = await supabase
    .from('marketplace_listings')
    .select('contact_info')
    .limit(1);

  if (checkError && checkError.message.includes('does not exist')) {
    console.log('❌ Columns missing - they need to be added via SQL');
    console.log('\n📋 Run this SQL in Supabase Dashboard:');
    console.log('👉 https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql\n');
    console.log(`
ALTER TABLE marketplace_listings
ADD COLUMN IF NOT EXISTS contact_info JSONB,
ADD COLUMN IF NOT EXISTS seller_profile_url TEXT,
ADD COLUMN IF NOT EXISTS comments JSONB;

CREATE INDEX IF NOT EXISTS idx_marketplace_contact_info
ON marketplace_listings USING GIN (contact_info)
WHERE contact_info IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_comments
ON marketplace_listings USING GIN (comments)
WHERE comments IS NOT NULL;
    `);
    process.exit(1);
  }

  if (checkError) {
    console.error('❌ Error checking columns:', checkError);
    process.exit(1);
  }

  console.log('✅ Columns already exist!');
}

addColumnsViaSupabase();
