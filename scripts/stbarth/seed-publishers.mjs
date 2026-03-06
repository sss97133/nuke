#!/usr/bin/env node
/**
 * Seed St Barth publishers into the organizations table.
 *
 * Upserts 17 Issuu publishers, storing issuu_publisher_slug in metadata JSONB.
 * Prints a mapping of publisher_slug -> organization_id when complete.
 *
 * Usage:
 *   cd /Users/skylar/nuke && dotenvx run -- node scripts/stbarth/seed-publishers.mjs
 */

import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

// DNS fix: bypass broken macOS system resolver
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
    if (options && options.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

// ─── Publisher definitions ──────────────────────────────────────────────────

const PUBLISHERS = {
  vkreativ:              { name: 'V Kreativ Media',            entity_type: 'media',       website: 'https://issuu.com/vkreativ' },
  lacure:                { name: 'La Cure Villas',             entity_type: 'real_estate',  website: 'https://issuu.com/lacure' },
  mrandmrsmedia:         { name: 'Mr and Mrs Media',           entity_type: 'media',       website: 'https://issuu.com/mrandmrsmedia' },
  xtofsxm:               { name: 'XTOF SXM',                  entity_type: 'media',       website: 'https://issuu.com/xtofsxm' },
  pololifestyles:        { name: 'Polo Lifestyles',            entity_type: 'media',       website: 'https://issuu.com/pololifestyles' },
  spacestbarth:          { name: 'Space SBH Gallery',          entity_type: 'gallery',     website: 'https://issuu.com/spacestbarth' },
  rpmedia:               { name: 'RP Media Group',             entity_type: 'media',       website: 'https://issuu.com/rpmedia' },
  'thesign-textiles':    { name: 'The Sign Textiles',          entity_type: 'fashion',     website: 'https://issuu.com/thesign-textiles' },
  ericsbh:               { name: 'Eric SBH',                   entity_type: 'media',       website: 'https://issuu.com/ericsbh' },
  'shop-alexis7':        { name: 'Shop Alexis 7',              entity_type: 'fashion',     website: 'https://issuu.com/shop-alexis7' },
  coldwellbankerstbarth: { name: 'Coldwell Banker St Barth',   entity_type: 'real_estate',  website: 'https://issuu.com/coldwellbankerstbarth' },
  sibarthrealestate:     { name: 'Sibarth Real Estate',        entity_type: 'real_estate',  website: 'https://issuu.com/sibarthrealestate' },
  polamagazine:          { name: 'Pola Magazine',              entity_type: 'media',       website: 'https://issuu.com/polamagazine' },
  wimco:                 { name: 'WIMCO Villas',               entity_type: 'real_estate',  website: 'https://issuu.com/wimco' },
  spiritofstbarth:       { name: 'Spirit of St Barth',         entity_type: 'media',       website: 'https://issuu.com/spiritofstbarth' },
  stbarthsartprints:     { name: 'St Barths Art Prints',       entity_type: 'gallery',     website: 'https://issuu.com/stbarthsartprints' },
  patidestbarth2:        { name: 'Pati de Saint Barth',        entity_type: 'fashion',     website: 'https://issuu.com/patidestbarth2' },
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding ${Object.keys(PUBLISHERS).length} St Barth publishers into organizations...\n`);

  const rows = Object.entries(PUBLISHERS).map(([slug, pub]) => ({
    slug,
    business_name: pub.name,
    entity_type: pub.entity_type,
    website: pub.website,
    metadata: { issuu_publisher_slug: slug },
    country: 'FR',
    state: 'Saint-Barthelemy',
    is_public: true,
    status: 'active',
    discovered_via: 'issuu_import',
  }));

  // Upsert in a single batch on slug (unique constraint: uq_organizations_slug)
  const { data, error } = await supabase
    .from('organizations')
    .upsert(rows, { onConflict: 'slug', ignoreDuplicates: false })
    .select('id, slug, business_name, entity_type');

  if (error) {
    console.error('Upsert error:', error.message);
    process.exit(1);
  }

  // Print mapping
  console.log('publisher_slug -> organization_id:\n');
  const mapping = {};
  for (const row of data) {
    mapping[row.slug] = row.id;
    console.log(`  ${row.slug.padEnd(25)} -> ${row.id}  (${row.entity_type})`);
  }

  console.log(`\nDone: ${data.length} publishers upserted.`);

  // Verify count
  const { count } = await supabase
    .from('organizations')
    .select('*', { count: 'exact', head: true })
    .in('slug', Object.keys(PUBLISHERS));

  console.log(`Verification: ${count} organizations with matching slugs in DB.`);

  return mapping;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
