#!/usr/bin/env node

/**
 * Apply basic meta/og descriptions from website HTML when due diligence fails.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TARGET_ORGS = [
  { name: 'TBTFW', website: 'https://tbtfw.com' },
  { name: 'Boardwalk', website: 'https://www.boardwalkauto.com' },
];

function extractMeta(html, regexes) {
  for (const re of regexes) {
    const m = html.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

async function updateOrgDescription(orgId, description) {
  await supabase
    .from('businesses')
    .update({ description })
    .eq('id', orgId);
}

async function main() {
  for (const target of TARGET_ORGS) {
    const { data: orgs } = await supabase
      .from('businesses')
      .select('id, business_name, website, description')
      .ilike('business_name', `%${target.name}%`)
      .limit(5);

    if (!orgs || orgs.length === 0) {
      console.warn(`⚠️  No match for ${target.name}`);
      continue;
    }

    for (const org of orgs) {
      const website = org.website || target.website;
      if (!website) {
        console.warn(`⚠️  Missing website for ${org.business_name}`);
        continue;
      }

      if (org.description && String(org.description).trim().length >= 80) {
        console.log(`ℹ️  Skipping ${org.business_name} (already has description)`);
        continue;
      }

      try {
        const res = await fetch(website, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        });
        if (!res.ok) {
          console.warn(`⚠️  Failed to fetch ${website}: ${res.status}`);
          continue;
        }
        const html = await res.text();
        const description =
          extractMeta(html, [
            /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
            /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
          ]);

        if (!description) {
          console.warn(`⚠️  No meta description for ${org.business_name}`);
          continue;
        }

        await updateOrgDescription(org.id, description.slice(0, 500));
        console.log(`✅ Updated description for ${org.business_name}`);
      } catch (err) {
        console.warn(`⚠️  Error fetching ${website}: ${err.message || err}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
