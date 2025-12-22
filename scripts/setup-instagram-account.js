/**
 * Quick setup script to manually configure Instagram account ID
 * 
 * Usage:
 *   node scripts/setup-instagram-account.js <instagram_handle> <instagram_account_id>
 * 
 * Example:
 *   node scripts/setup-instagram-account.js lartdelautomobile 17841405309211834
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const [handle, accountId, orgId] = process.argv.slice(2);

if (!handle || !accountId) {
  console.error('❌ Usage: node scripts/setup-instagram-account.js <handle> <account_id> [organization_id]');
  console.error('Example: node scripts/setup-instagram-account.js lartdelautomobile 17841405309211834');
  process.exit(1);
}

async function setup() {
  try {
    console.log(`🔧 Setting up Instagram account: ${handle}`);
    console.log(`   Account ID: ${accountId}`);
    if (orgId) console.log(`   Organization ID: ${orgId}`);
    console.log('');

    // Upsert external identity
    const { data: identity, error: identityError } = await supabase
      .from('external_identities')
      .upsert({
        platform: 'instagram',
        handle: handle.toLowerCase(),
        profile_url: `https://www.instagram.com/${handle}/`,
        display_name: handle,
        metadata: {
          instagram_account_id: accountId,
          organization_id: orgId || null
        }
      }, {
        onConflict: 'platform,handle'
      })
      .select('id')
      .single();

    if (identityError) {
      throw identityError;
    }

    console.log('✅ External identity created/updated');
    console.log(`   ID: ${identity.id}`);
    console.log('');

    if (orgId) {
      console.log('✅ Ready to sync! Run:');
      console.log('');
      console.log(`curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-instagram-organization" \\`);
      console.log(`  -H "Authorization: Bearer YOUR_ANON_KEY" \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"organization_id":"${orgId}","instagram_handle":"${handle}","limit":5}'`);
    } else {
      console.log('✅ Account configured!');
      console.log('   Add organization_id to link to an organization');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setup();

