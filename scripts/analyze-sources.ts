/**
 * Analyze sources and organizations in the database
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function analyzeSources() {
  console.log('='.repeat(60));
  console.log('SOURCE & ORGANIZATION ANALYSIS');
  console.log('='.repeat(60));

  // Get scrape sources
  const { data: scrapeSources, error: scrapeErr } = await supabase
    .from('scrape_sources')
    .select('id, name, url, source_type, is_active')
    .order('name');

  if (scrapeErr) {
    console.error('Error fetching scrape_sources:', scrapeErr.message);
  } else {
    console.log(`\nTotal scrape_sources: ${scrapeSources?.length || 0}`);
  }

  // Get source intelligence
  const { data: sourceIntel, error: intelErr } = await supabase
    .from('source_intelligence')
    .select('id, source_id, source_purpose, data_quality_tier, recommended_extraction_method, vehicle_specialties')
    .order('extraction_priority', { ascending: false });

  if (intelErr) {
    console.error('Error fetching source_intelligence:', intelErr.message);
  } else {
    console.log(`Total source_intelligence entries: ${sourceIntel?.length || 0}`);

    // Group by extraction method
    const byMethod: Record<string, number> = {};
    for (const s of sourceIntel || []) {
      const method = s.recommended_extraction_method || 'unknown';
      byMethod[method] = (byMethod[method] || 0) + 1;
    }

    console.log('\nSource intelligence by extraction method:');
    for (const [method, count] of Object.entries(byMethod)) {
      console.log(`  ${method}: ${count}`);
    }
  }

  // Get organizations (businesses)
  const { data: orgs, error: orgsErr } = await supabase
    .from('businesses')
    .select('id, business_name, website, business_type, metadata')
    .order('business_name')
    .limit(500);

  if (orgsErr) {
    console.error('Error fetching orgs:', orgsErr.message);
    return;
  }

  console.log(`\nTotal organizations: ${orgs?.length || 0}`);

  // Group by type
  const byType: Record<string, number> = {};
  const withWebsites: any[] = [];
  for (const o of orgs || []) {
    const type = o.business_type || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
    if (o.website) {
      withWebsites.push(o);
    }
  }

  console.log('\nOrganizations by type:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log(`\nOrganizations with websites: ${withWebsites.length}`);

  // Check how many orgs have vehicles linked
  const { data: orgVehicleCounts } = await supabase
    .from('organization_vehicles')
    .select('organization_id')
    .eq('status', 'active');

  const orgsWithVehicles = new Set((orgVehicleCounts || []).map(ov => ov.organization_id));
  console.log(`Organizations with linked vehicles: ${orgsWithVehicles.size}`);

  // Sample organizations with websites for extraction
  console.log('\n' + '='.repeat(60));
  console.log('SAMPLE ORGANIZATIONS WITH WEBSITES (for extraction)');
  console.log('='.repeat(60));

  const dealers = withWebsites.filter(o =>
    o.business_type === 'dealership' ||
    o.business_type === 'dealer' ||
    o.business_type === 'classic_car_dealer'
  ).slice(0, 20);

  for (const d of dealers) {
    const hasVehicles = orgsWithVehicles.has(d.id);
    console.log(`\n${d.business_name}`);
    console.log(`  ID: ${d.id}`);
    console.log(`  URL: ${d.website}`);
    console.log(`  Type: ${d.business_type}`);
    console.log(`  Has vehicles: ${hasVehicles ? 'YES' : 'NO'}`);
  }

  // Check for BaT sellers that are also organizations
  console.log('\n' + '='.repeat(60));
  console.log('ORGANIZATIONS FROM BAT (sellers)');
  console.log('='.repeat(60));

  const batOrgs = (orgs || []).filter(o =>
    (o.metadata && JSON.stringify(o.metadata).includes('bringatrailer')) ||
    (o.website && o.website.includes('bringatrailer'))
  ).slice(0, 10);

  console.log(`Found ${batOrgs.length} organizations with BaT links`);
  for (const b of batOrgs) {
    console.log(`\n${b.business_name}`);
    console.log(`  ID: ${b.id}`);
    console.log(`  Website: ${b.website || 'NONE'}`);
    console.log(`  Type: ${b.business_type}`);
  }

  // Summary stats
  console.log('\n' + '='.repeat(60));
  console.log('EXTRACTION OPPORTUNITIES');
  console.log('='.repeat(60));

  const extractable = withWebsites.filter(o => !orgsWithVehicles.has(o.id));
  console.log(`Organizations with websites but NO vehicles: ${extractable.length}`);
  console.log('These are prime candidates for extraction.');

  console.log('\nSample (first 10):');
  for (const e of extractable.slice(0, 10)) {
    console.log(`  - ${e.business_name}: ${e.website}`);
  }
}

analyzeSources().catch(console.error);
