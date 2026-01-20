#!/usr/bin/env node

/**
 * Apply due diligence descriptions to organizations missing context.
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
  'Boardwalk',
  'Broad Arrow Auctions',
  'Broad Arrow Private Sales',
  'Mecum',
  'Barrett-Jackson',
  'Bring a Trailer',
  'OTTO Car Club',
  'Worldwide Auctioneers',
  'Velocity Restorations',
];

async function fetchOrgByName(name) {
  const { data } = await supabase
    .from('businesses')
    .select('id, business_name, website, description')
    .ilike('business_name', `%${name}%`)
    .limit(5);
  return data || [];
}

async function applyDescription(org) {
  const { data, error } = await supabase.functions.invoke('generate-org-due-diligence', {
    body: { organizationId: org.id, websiteUrl: org.website || null }
  });

  if (error) {
    console.warn(`⚠️  Due diligence failed for ${org.business_name}: ${error.message}`);
    return;
  }

  const report = data?.report || data?.data?.report || data?.result?.report || data?.report;
  const description = report?.description || null;

  if (!description) {
    console.warn(`⚠️  No description found for ${org.business_name}`);
    return;
  }

  const current = String(org.description || '').trim();
  if (current && current.length >= 80) {
    console.log(`ℹ️  Skipping ${org.business_name} (already has description)`);
    return;
  }

  await supabase
    .from('businesses')
    .update({ description })
    .eq('id', org.id);

  console.log(`✅ Updated description for ${org.business_name}`);
}

async function main() {
  for (const name of TARGET_NAMES) {
    const matches = await fetchOrgByName(name);
    if (!matches.length) {
      console.log(`⚠️  No match for "${name}"`);
      continue;
    }

    for (const org of matches) {
      await applyDescription(org);
    }
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
