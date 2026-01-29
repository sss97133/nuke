#!/usr/bin/env node

import * as fs from 'fs';

const orgs = JSON.parse(fs.readFileSync('/tmp/nuke_orgs_audit.json', 'utf8'));
const contributors = JSON.parse(fs.readFileSync('/tmp/nuke_org_contributors.json', 'utf8'));

console.log('\n' + '='.repeat(80));
console.log('NUKE ORGANIZATION PROVENANCE AUDIT');
console.log('='.repeat(80));
console.log(`Database: Nuke Production`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Total Organizations: ${orgs.length}`);
console.log(`Active Contributors: ${contributors.length}`);
console.log('='.repeat(80));

// Build contributor map
const orgContributors = {};
contributors.forEach(c => {
  if (!orgContributors[c.organization_id]) {
    orgContributors[c.organization_id] = [];
  }
  orgContributors[c.organization_id].push(c);
});

console.log(`\nOrganizations with active contributors: ${Object.keys(orgContributors).length}`);
console.log(`Organizations without contributors: ${orgs.length - Object.keys(orgContributors).length}`);

// Categorize by provenance quality
const categories = {
  good_provenance: [],      // has discovered_by AND (source_url OR website)
  has_user_no_url: [],      // has discovered_by but no source_url AND no website
  has_url_no_user: [],      // has (source_url OR website) but no discovered_by
  orphan_garbage: [],       // no discovered_by, no source_url, no website
};

orgs.forEach(org => {
  if (org.discovered_by && (org.source_url || org.website)) {
    categories.good_provenance.push(org);
  } else if (org.discovered_by) {
    categories.has_user_no_url.push(org);
  } else if (org.source_url || org.website) {
    categories.has_url_no_user.push(org);
  } else {
    categories.orphan_garbage.push(org);
  }
});

console.log('\n' + '='.repeat(80));
console.log('PROVENANCE QUALITY BREAKDOWN');
console.log('='.repeat(80));

const provSummary = [
  { category: 'Good Provenance', count: categories.good_provenance.length, desc: 'Has discovered_by + (source_url OR website)' },
  { category: 'Has User, No URL', count: categories.has_user_no_url.length, desc: 'Has discovered_by but no source/website' },
  { category: 'Has URL, No User', count: categories.has_url_no_user.length, desc: 'Has source/website but no discovered_by' },
  { category: 'Orphan Garbage', count: categories.orphan_garbage.length, desc: 'No discovered_by, no source_url, no website' },
];

provSummary.forEach(({ category, count, desc }) => {
  const pct = (count / orgs.length * 100).toFixed(1);
  console.log(`\n${category.toUpperCase()}`);
  console.log(`  Count: ${count} (${pct}%)`);
  console.log(`  Definition: ${desc}`);
});

console.log('\n' + '='.repeat(80));
console.log('DETAILED FINDINGS');
console.log('='.repeat(80));

console.log('\n### 1. GOOD PROVENANCE (1 org, 0.4%)');
console.log('These orgs have proper user attribution AND source URLs:');
categories.good_provenance.forEach(org => {
  console.log(`  - ${org.business_name}`);
  console.log(`    ID: ${org.id}`);
  console.log(`    Discovered by: ${org.discovered_by}`);
  console.log(`    Source: ${org.source_url || 'N/A'}`);
  console.log(`    Website: ${org.website || 'N/A'}`);
  console.log(`    Has contributors: ${orgContributors[org.id] ? 'Yes (' + orgContributors[org.id].length + ')' : 'No'}`);
});

console.log('\n### 2. HAS USER BUT NO URL (6 orgs, 2.7%)');
console.log('These orgs were created by users but lack source_url/website:');
categories.has_user_no_url.forEach(org => {
  console.log(`  - ${org.business_name}`);
  console.log(`    ID: ${org.id}`);
  console.log(`    Discovered by: ${org.discovered_by}`);
  console.log(`    Type: ${org.business_type || 'N/A'}`);
  console.log(`    Created: ${org.created_at?.substring(0,10)}`);
  console.log(`    Has description: ${org.description ? 'Yes' : 'No'}`);
  console.log(`    Has logo: ${org.logo_url ? 'Yes' : 'No'}`);
  console.log(`    Has contributors: ${orgContributors[org.id] ? 'Yes (' + orgContributors[org.id].length + ')' : 'No'}`);
});

console.log('\n### 3. HAS URL BUT NO USER (216 orgs, 96.4%)');
console.log('These orgs have website/source_url but no discovered_by field.');
console.log('This is the LARGEST category - likely system-created orgs from scraping.');
console.log('\nBreakdown by business type:');
const typeBreakdown = {};
categories.has_url_no_user.forEach(org => {
  const type = org.business_type || 'unknown';
  typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
});
Object.entries(typeBreakdown)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    console.log(`  ${type.padEnd(20)}: ${count}`);
  });

console.log('\nExamples of major platforms (first 10):');
categories.has_url_no_user
  .filter(org => org.business_type === 'auction_house' || org.business_type === 'marketplace')
  .slice(0, 10)
  .forEach(org => {
    console.log(`  - ${org.business_name} [${org.business_type}]`);
  });

console.log('\n### 4. ORPHAN GARBAGE (1 org, 0.4%)');
console.log('These orgs have NO provenance at all:');
categories.orphan_garbage.forEach(org => {
  console.log(`  - ${org.business_name || '(unnamed)'}`);
  console.log(`    ID: ${org.id}`);
  console.log(`    Type: ${org.business_type || 'N/A'}`);
  console.log(`    Created: ${org.created_at?.substring(0,10)}`);
  console.log(`    Has description: ${org.description ? 'Yes' : 'No'}`);
  console.log(`    Has logo: ${org.logo_url ? 'Yes' : 'No'}`);
  console.log(`    Has contributors: ${orgContributors[org.id] ? 'Yes (' + orgContributors[org.id].length + ')' : 'No'}`);
  console.log(`    RECOMMENDATION: ${org.description || org.logo_url ? 'ADD PROVENANCE' : 'DELETE'}`);
});

console.log('\n' + '='.repeat(80));
console.log('ORGANIZATION CONTRIBUTORS ANALYSIS');
console.log('='.repeat(80));

console.log(`\nTotal orgs with active contributors: ${Object.keys(orgContributors).length}`);
console.log(`Total orgs without contributors: ${orgs.length - Object.keys(orgContributors).length}`);

console.log('\nOrgs WITH contributors:');
Object.entries(orgContributors).forEach(([orgId, contribs]) => {
  const org = orgs.find(o => o.id === orgId);
  const roles = [...new Set(contribs.map(c => c.role))].join(', ');
  console.log(`  - ${org?.business_name || orgId}`);
  console.log(`    Contributors: ${contribs.length}`);
  console.log(`    Roles: ${roles}`);
});

console.log('\n' + '='.repeat(80));
console.log('RECOMMENDATIONS');
console.log('='.repeat(80));

console.log('\n1. IMMEDIATE CLEANUP:');
console.log(`   - Delete ${categories.orphan_garbage.length} orphan org(s) with no data`);

console.log('\n2. BACKFILL DISCOVERED_BY:');
console.log(`   - 216 orgs have URLs but no discovered_by`);
console.log(`   - These are likely system-created from scrapers/imports`);
console.log(`   - Consider setting discovered_by to a system user ID`);

console.log('\n3. ADD MISSING URLS:');
console.log(`   - 6 orgs have discovered_by but no source_url/website`);
console.log(`   - Review and add URLs if available`);

console.log('\n4. ORG_INTAKE METADATA:');
console.log(`   - 0 orgs have org_intake metadata`);
console.log(`   - Consider implementing metadata tracking for new org creation`);

console.log('\n5. CONTRIBUTOR TRACKING:');
console.log(`   - Only ${Object.keys(orgContributors).length} orgs have active contributors`);
console.log(`   - Consider encouraging more contributor relationships`);

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));

const goodPct = (categories.good_provenance.length / orgs.length * 100).toFixed(1);
const badPct = ((categories.orphan_garbage.length + categories.has_user_no_url.length) / orgs.length * 100).toFixed(1);

console.log(`\n✅ GOOD: ${categories.good_provenance.length} orgs (${goodPct}%) have full provenance`);
console.log(`⚠️  WARNING: ${categories.has_url_no_user.length} orgs (${(categories.has_url_no_user.length/orgs.length*100).toFixed(1)}%) need discovered_by`);
console.log(`❌ BAD: ${categories.orphan_garbage.length + categories.has_user_no_url.length} orgs (${badPct}%) need attention`);

console.log('\nOverall Provenance Health: ' + (goodPct > 50 ? '🟢 GOOD' : goodPct > 20 ? '🟡 FAIR' : '🔴 POOR'));

console.log('\n' + '='.repeat(80));
