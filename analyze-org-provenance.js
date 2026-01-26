#!/usr/bin/env node

import * as fs from 'fs';

const orgs = JSON.parse(fs.readFileSync('/tmp/nuke_orgs_audit.json', 'utf8'));

console.log('\n' + '='.repeat(80));
console.log('ORGANIZATION PROVENANCE AUDIT REPORT');
console.log('='.repeat(80));
console.log(`Total public organizations: ${orgs.length}`);
console.log(`Audit timestamp: ${new Date().toISOString()}\n`);

// Overall provenance health
const stats = {
  total: orgs.length,
  has_discovered_by: orgs.filter(o => o.discovered_by).length,
  has_source_url: orgs.filter(o => o.source_url).length,
  has_website: orgs.filter(o => o.website).length,
  has_intake_metadata: orgs.filter(o => o.metadata?.org_intake).length,
  has_description: orgs.filter(o => o.description).length,
  has_logo: orgs.filter(o => o.logo_url).length,
};

console.log('=== Overall Provenance Health ===');
console.log(`Total orgs:              ${stats.total}`);
console.log(`Has discovered_by:       ${stats.has_discovered_by} (${(stats.has_discovered_by/stats.total*100).toFixed(1)}%)`);
console.log(`Has source_url:          ${stats.has_source_url} (${(stats.has_source_url/stats.total*100).toFixed(1)}%)`);
console.log(`Has website:             ${stats.has_website} (${(stats.has_website/stats.total*100).toFixed(1)}%)`);
console.log(`Has org_intake metadata: ${stats.has_intake_metadata} (${(stats.has_intake_metadata/stats.total*100).toFixed(1)}%)`);
console.log(`Has description:         ${stats.has_description} (${(stats.has_description/stats.total*100).toFixed(1)}%)`);
console.log(`Has logo:                ${stats.has_logo} (${(stats.has_logo/stats.total*100).toFixed(1)}%)`);

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

console.log('\n=== Provenance Quality Breakdown ===');
Object.entries(categories).forEach(([category, items]) => {
  console.log(`${category.padEnd(20)}: ${items.length.toString().padStart(3)} (${(items.length/stats.total*100).toFixed(1)}%)`);
  if (items.length > 0 && items.length <= 10) {
    items.forEach(org => {
      console.log(`  - ${org.business_name || '(unnamed)'} [${org.id}]`);
    });
  } else if (items.length > 0) {
    // Show first 5 examples
    items.slice(0, 5).forEach(org => {
      console.log(`  - ${org.business_name || '(unnamed)'} [${org.id}]`);
    });
    console.log(`  ... and ${items.length - 5} more`);
  }
});

// Deep dive on orphan garbage
console.log('\n=== Orphan Garbage Analysis (No Provenance) ===');
console.log(`Total orphans: ${categories.orphan_garbage.length}`);

const orphansWithData = categories.orphan_garbage.filter(o => o.description || o.logo_url);
const orphansEmpty = categories.orphan_garbage.filter(o => !o.description && !o.logo_url);

console.log(`Orphans with some data (description OR logo): ${orphansWithData.length}`);
console.log(`Orphans completely empty:                      ${orphansEmpty.length}`);

console.log('\n--- Orphan Garbage Examples (Most Recent 20) ---');
categories.orphan_garbage.slice(0, 20).forEach((org, i) => {
  const hasData = org.description ? 'D' : '-';
  const hasLogo = org.logo_url ? 'L' : '-';
  const flags = `[${hasData}${hasLogo}]`;
  console.log(`${(i+1).toString().padStart(2)}. ${flags} ${org.business_name || '(unnamed)'.padEnd(30)} | Type: ${org.business_type || 'N/A'} | Created: ${org.created_at?.substring(0,10)}`);
});

// Check org_intake metadata patterns
console.log('\n=== Org Intake Metadata Patterns ===');
const intakeMethods = {};
orgs.forEach(org => {
  const method = org.metadata?.org_intake?.method;
  if (method) {
    intakeMethods[method] = (intakeMethods[method] || 0) + 1;
  }
});

Object.entries(intakeMethods)
  .sort((a, b) => b[1] - a[1])
  .forEach(([method, count]) => {
    console.log(`${method.padEnd(30)}: ${count}`);
  });

// Summary and recommendations
console.log('\n=== Summary ===');
const goodPct = (categories.good_provenance.length / stats.total * 100).toFixed(1);
const orphanPct = (categories.orphan_garbage.length / stats.total * 100).toFixed(1);

console.log(`✅ Good provenance: ${categories.good_provenance.length} orgs (${goodPct}%)`);
console.log(`⚠️  Orphan garbage: ${categories.orphan_garbage.length} orgs (${orphanPct}%)`);

if (categories.orphan_garbage.length > 0) {
  console.log('\n🗑️  GARBAGE CLEANUP CANDIDATES:');
  console.log(`   - ${orphansEmpty.length} orgs are completely empty (no description, no logo)`);
  console.log(`   - These should likely be deleted or flagged for review`);
  console.log(`   - ${orphansWithData.length} orphans have some data but no provenance`);
  console.log(`   - These need user/source attribution added`);
}

console.log('\n' + '='.repeat(80));
