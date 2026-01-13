/**
 * Get all Instagram profiles from external_identities table
 * 
 * Usage:
 *   node scripts/get-instagram-profiles.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function getInstagramProfiles() {
  const { data, error } = await supabase
    .from('external_identities')
    .select('*')
    .eq('platform', 'instagram')
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching Instagram profiles:', error);
    process.exit(1);
  }

  console.log(`Found ${data.length} Instagram profile(s):\n`);
  
  data.forEach((profile, index) => {
    console.log(`${index + 1}. @${profile.handle}`);
    console.log(`   Profile URL: ${profile.profile_url || 'N/A'}`);
    console.log(`   Display Name: ${profile.display_name || 'N/A'}`);
    console.log(`   Claimed: ${profile.claimed_by_user_id ? 'Yes' : 'No'}`);
    if (profile.claimed_by_user_id) {
      console.log(`   Claimed By: ${profile.claimed_by_user_id}`);
      console.log(`   Claim Confidence: ${profile.claim_confidence}%`);
    }
    if (profile.metadata?.instagram_account_id) {
      console.log(`   Instagram Account ID: ${profile.metadata.instagram_account_id}`);
    }
    console.log(`   First Seen: ${profile.first_seen_at || 'N/A'}`);
    console.log(`   Last Seen: ${profile.last_seen_at || 'N/A'}`);
    console.log('');
  });

  return data;
}

getInstagramProfiles().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
