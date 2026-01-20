#!/usr/bin/env node

/**
 * Enrich organization profiles from their websites.
 * Triggers update-org-from-website for a curated list of org names.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TARGET_NAMES = [
  'Motoexotica',
  'Fantasy Junction',
  'TBTFW',
  'Worldwide Auctioneers',
  'Boardwalk',
  'Velocity Restorations',
  'Broad Arrow Auctions',
  'Broad Arrow Private Sales',
  'Mecum',
  'Barrett-Jackson',
  'Bring a Trailer',
  'OTTO Car Club',
];

async function findOrgByName(name) {
  const { data } = await supabase
    .from('businesses')
    .select('id, business_name, website, description, logo_url')
    .ilike('business_name', `%${name}%`)
    .limit(5);
  return data || [];
}

async function enrichOrg(org) {
  console.log(`🔍 Enriching ${org.business_name} (${org.id})`);
  const { data, error } = await supabase.functions.invoke('update-org-from-website', {
    body: {
      organizationId: org.id,
      websiteUrl: org.website || null,
    }
  });

  if (error) {
    console.warn(`  ⚠️ Failed: ${error.message}`);
    return;
  }
  console.log(`  ✅ Triggered update`);
}

async function main() {
  for (const name of TARGET_NAMES) {
    const matches = await findOrgByName(name);
    if (!matches.length) {
      console.log(`⚠️  No match for "${name}"`);
      continue;
    }

    for (const org of matches) {
      await enrichOrg(org);
    }
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
