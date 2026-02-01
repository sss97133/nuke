#!/usr/bin/env npx tsx
/**
 * DATABASE DEEP AUDIT
 *
 * Comprehensive analysis of all database tables, relationships, and data quality.
 * Generates a detailed report of the entire schema and data health.
 *
 * Run: dotenvx run -- npx tsx scripts/database-deep-audit.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const startTime = Date.now();
const findings: string[] = [];

function log(msg: string) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${elapsed}s] ${msg}`);
}

function addFinding(category: string, severity: 'info' | 'warn' | 'error', message: string) {
  const icon = severity === 'error' ? '🔴' : severity === 'warn' ? '🟡' : '🟢';
  findings.push(`${icon} **${category}**: ${message}`);
  log(`${icon} [${category}] ${message}`);
}

// ============================================================================
// SCHEMA ANALYSIS
// ============================================================================

async function analyzeSchema() {
  log('=== SCHEMA ANALYSIS ===');

  // Get all tables with sizes
  const { data: tables, error } = await supabase
    .from('information_schema.tables' as any)
    .select('table_name')
    .eq('table_schema', 'public')
    .eq('table_type', 'BASE TABLE');

  // Fallback: just query each known major table
  const majorTables = [
    'vehicles', 'vehicle_images', 'vehicle_status_metadata', 'vehicle_mailboxes',
    'vehicle_documents', 'vehicle_reference_links', 'vehicle_observations',
    'auction_comments', 'auction_events', 'bat_bids', 'bat_listings', 'bat_user_profiles',
    'businesses', 'profiles', 'external_identities',
    'timeline_events', 'system_logs', 'import_queue',
  ];

  const tableStats: { name: string; count: number; hasOrphans: boolean }[] = [];

  for (const tableName of majorTables) {
    try {
      const { count, error } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });

      if (!error && count !== null) {
        tableStats.push({ name: tableName, count, hasOrphans: false });
        addFinding('Schema', 'info', `${tableName}: ${count.toLocaleString()} rows`);
      }
    } catch (e) {
      // Table might not exist or no access
    }
  }

  return tableStats;
}

// ============================================================================
// VEHICLE DATA ANALYSIS
// ============================================================================

async function analyzeVehicles() {
  log('=== VEHICLE DATA ANALYSIS ===');

  // Total count
  const { count: total } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  addFinding('Vehicles', 'info', `Total: ${total?.toLocaleString()}`);

  // By decade
  const { data: decadeData } = await supabase
    .from('vehicles')
    .select('year')
    .not('year', 'is', null)
    .limit(50000);

  const decades = new Map<string, number>();
  for (const v of decadeData || []) {
    if (v.year && v.year >= 1900 && v.year <= 2030) {
      const decade = `${Math.floor(v.year / 10) * 10}s`;
      decades.set(decade, (decades.get(decade) || 0) + 1);
    }
  }

  const sortedDecades = [...decades.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  addFinding('Vehicles', 'info', `Top decades: ${sortedDecades.map(([d, c]) => `${d}(${c})`).join(', ')}`);

  // By make
  const { data: makeData } = await supabase
    .from('vehicles')
    .select('make')
    .not('make', 'is', null)
    .limit(50000);

  const makes = new Map<string, number>();
  for (const v of makeData || []) {
    if (v.make) {
      const make = v.make.toLowerCase().trim();
      makes.set(make, (makes.get(make) || 0) + 1);
    }
  }

  const sortedMakes = [...makes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  addFinding('Vehicles', 'info', `Top makes: ${sortedMakes.map(([m, c]) => `${m}(${c})`).join(', ')}`);

  // Price distribution
  const { data: priceData } = await supabase
    .from('vehicles')
    .select('sale_price')
    .not('sale_price', 'is', null)
    .gt('sale_price', 0)
    .limit(50000);

  if (priceData && priceData.length > 0) {
    const prices = priceData.map(v => v.sale_price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const max = prices[prices.length - 1];
    const min = prices[0];

    addFinding('Vehicles', 'info', `Prices - Median: $${median.toLocaleString()}, Avg: $${Math.round(avg).toLocaleString()}, Range: $${min.toLocaleString()}-$${max.toLocaleString()}`);
  }

  // Data completeness
  const fields = ['year', 'make', 'model', 'vin', 'sale_price', 'mileage', 'primary_image_url', 'description'];
  for (const field of fields) {
    const { count: hasField } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .not(field, 'is', null);

    const pct = ((hasField || 0) / (total || 1) * 100).toFixed(1);
    const severity = parseFloat(pct) < 50 ? 'warn' : 'info';
    addFinding('Vehicle Completeness', severity, `${field}: ${pct}% populated`);
  }
}

// ============================================================================
// IMAGE ANALYSIS
// ============================================================================

async function analyzeImages() {
  log('=== IMAGE ANALYSIS ===');

  const { count: totalImages } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true });
  addFinding('Images', 'info', `Total vehicle_images: ${totalImages?.toLocaleString()}`);

  // Images per vehicle
  const { count: vehiclesWithImages } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .not('primary_image_url', 'is', null);

  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  const pct = ((vehiclesWithImages || 0) / (totalVehicles || 1) * 100).toFixed(1);
  addFinding('Images', pct < '50' ? 'warn' : 'info', `${pct}% of vehicles have primary_image_url`);

  // Check for broken URL patterns
  const { data: urlSamples } = await supabase
    .from('vehicle_images')
    .select('url')
    .limit(1000);

  const urlPatterns = new Map<string, number>();
  for (const img of urlSamples || []) {
    if (img.url) {
      try {
        const u = new URL(img.url);
        urlPatterns.set(u.hostname, (urlPatterns.get(u.hostname) || 0) + 1);
      } catch {
        urlPatterns.set('INVALID', (urlPatterns.get('INVALID') || 0) + 1);
      }
    }
  }

  const topHosts = [...urlPatterns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  addFinding('Images', 'info', `Top image hosts: ${topHosts.map(([h, c]) => `${h}(${c})`).join(', ')}`);
}

// ============================================================================
// ORGANIZATION ANALYSIS
// ============================================================================

async function analyzeOrganizations() {
  log('=== ORGANIZATION ANALYSIS ===');

  const { count: total } = await supabase.from('businesses').select('*', { count: 'exact', head: true });
  addFinding('Organizations', 'info', `Total: ${total?.toLocaleString()}`);

  // Public vs private
  const { count: publicOrgs } = await supabase.from('businesses').select('*', { count: 'exact', head: true }).eq('is_public', true);
  addFinding('Organizations', 'info', `Public: ${publicOrgs?.toLocaleString()}, Private: ${((total || 0) - (publicOrgs || 0)).toLocaleString()}`);

  // With websites
  const { count: withWebsite } = await supabase
    .from('businesses')
    .select('*', { count: 'exact', head: true })
    .not('website', 'is', null);

  addFinding('Organizations', 'info', `With website: ${withWebsite?.toLocaleString()}`);

  // Check for duplicates by name
  const { data: orgNames } = await supabase
    .from('businesses')
    .select('business_name')
    .not('business_name', 'is', null)
    .limit(10000);

  const nameCounts = new Map<string, number>();
  for (const o of orgNames || []) {
    if (o.business_name) {
      const name = o.business_name.toLowerCase().trim();
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
  }

  const duplicateNames = [...nameCounts.entries()].filter(([_, c]) => c > 1);
  if (duplicateNames.length > 0) {
    addFinding('Organizations', 'warn', `${duplicateNames.length} potentially duplicate org names`);
    addFinding('Organizations', 'info', `Examples: ${duplicateNames.slice(0, 5).map(([n, c]) => `"${n}"(${c})`).join(', ')}`);
  }
}

// ============================================================================
// USER ANALYSIS
// ============================================================================

async function analyzeUsers() {
  log('=== USER ANALYSIS ===');

  const { count: totalProfiles } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
  addFinding('Users', 'info', `Total profiles: ${totalProfiles?.toLocaleString()}`);

  const { count: externalIds } = await supabase.from('external_identities').select('*', { count: 'exact', head: true });
  addFinding('Users', 'info', `External identities: ${externalIds?.toLocaleString()}`);

  const { count: batProfiles } = await supabase.from('bat_user_profiles').select('*', { count: 'exact', head: true });
  addFinding('Users', 'info', `BaT user profiles: ${batProfiles?.toLocaleString()}`);
}

// ============================================================================
// AUCTION DATA ANALYSIS
// ============================================================================

async function analyzeAuctions() {
  log('=== AUCTION DATA ANALYSIS ===');

  const { count: comments } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true });
  addFinding('Auctions', 'info', `Auction comments: ${comments?.toLocaleString()}`);

  const { count: bids } = await supabase.from('bat_bids').select('*', { count: 'exact', head: true });
  addFinding('Auctions', 'info', `BaT bids: ${bids?.toLocaleString()}`);

  const { count: listings } = await supabase.from('bat_listings').select('*', { count: 'exact', head: true });
  addFinding('Auctions', 'info', `BaT listings: ${listings?.toLocaleString()}`);

  // Comments per vehicle
  if (comments && listings) {
    const avgComments = (comments / listings).toFixed(1);
    addFinding('Auctions', 'info', `Avg comments per BaT listing: ${avgComments}`);
  }
}

// ============================================================================
// QUEUE ANALYSIS
// ============================================================================

async function analyzeQueues() {
  log('=== QUEUE ANALYSIS ===');

  // Import queue
  const { count: pendingImports } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const { count: failedImports } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed');

  addFinding('Queues', pendingImports && pendingImports > 1000 ? 'warn' : 'info', `Import queue - Pending: ${pendingImports?.toLocaleString()}, Failed: ${failedImports?.toLocaleString()}`);

  // User profile queue
  const { count: profileQueue } = await supabase
    .from('user_profile_queue')
    .select('*', { count: 'exact', head: true });

  addFinding('Queues', 'info', `User profile queue: ${profileQueue?.toLocaleString()}`);
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

async function generateReport() {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  let report = `# Database Deep Audit Report

**Generated**: ${new Date().toISOString()}
**Duration**: ${duration}s

## Findings

`;

  for (const finding of findings) {
    report += `${finding}\n`;
  }

  return report;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log('Starting Database Deep Audit...');

  await analyzeSchema();
  await analyzeVehicles();
  await analyzeImages();
  await analyzeOrganizations();
  await analyzeUsers();
  await analyzeAuctions();
  await analyzeQueues();

  const report = await generateReport();

  const fs = await import('fs/promises');
  await fs.writeFile('/tmp/db-audit-latest.md', report);
  log(`\nReport written to: /tmp/db-audit-latest.md`);

  console.log('\n' + report);
}

main();
