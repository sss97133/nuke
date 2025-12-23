/**
 * Link 2002AD's external platform identities to their organization
 * Usage: node scripts/link-2002ad-external-identities.js
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

const ORGANIZATION_ID = '1970291b-081c-4550-94e1-633d194a2a99';

// Known external identities for 2002AD
const EXTERNAL_IDENTITIES = [
  {
    platform: 'classic_com',
    handle: '2002AD',
    profile_url: 'https://www.classic.com/s/2002ad-8pJl1On/',
    display_name: '2002AD',
  },
  // Add more as discovered
];

async function linkExternalIdentities() {
  console.log(`🔗 Linking external identities for organization ${ORGANIZATION_ID}\n`);

  for (const identity of EXTERNAL_IDENTITIES) {
    try {
      console.log(`Processing ${identity.platform}: ${identity.handle}`);
      
      // Check if identity already exists
      const { data: existing } = await supabase
        .from('external_identities')
        .select('id, metadata')
        .eq('platform', identity.platform)
        .eq('handle', identity.handle)
        .maybeSingle();

      if (existing) {
        // Update existing identity to link to organization
        const { error: updateError } = await supabase
          .from('external_identities')
          .update({
            metadata: {
              ...(existing.metadata || {}),
              organization_id: ORGANIZATION_ID,
              linked_at: new Date().toISOString(),
            }
          })
          .eq('id', existing.id);

        if (updateError) {
          console.error(`  ❌ Failed to update: ${updateError.message}`);
        } else {
          console.log(`  ✅ Updated existing identity: ${existing.id}`);
        }
      } else {
        // Create new identity
        const { data: newIdentity, error: createError } = await supabase
          .from('external_identities')
          .insert({
            platform: identity.platform,
            handle: identity.handle,
            profile_url: identity.profile_url,
            display_name: identity.display_name,
            metadata: {
              organization_id: ORGANIZATION_ID,
              linked_at: new Date().toISOString(),
            }
          })
          .select('id')
          .single();

        if (createError) {
          console.error(`  ❌ Failed to create: ${createError.message}`);
        } else {
          console.log(`  ✅ Created new identity: ${newIdentity.id}`);
        }
      }
    } catch (err) {
      console.error(`  ❌ Error processing ${identity.platform}:`, err.message);
    }
  }

  console.log(`\n✅ Done! Now triggering extraction from external platforms...\n`);

  // Trigger extraction from Classic.com
  try {
    const { data, error } = await supabase.functions.invoke('import-classic-auction', {
      body: {
        url: 'https://www.classic.com/s/2002ad-8pJl1On/',
        organization_id: ORGANIZATION_ID,
      }
    });

    if (error) {
      console.error('❌ Failed to trigger Classic.com extraction:', error.message);
    } else {
      console.log('✅ Triggered Classic.com profile extraction');
      console.log('   Result:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('❌ Exception triggering Classic.com extraction:', err.message);
  }
}

linkExternalIdentities();

