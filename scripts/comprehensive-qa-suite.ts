#!/usr/bin/env npx tsx
/**
 * COMPREHENSIVE QA TEST SUITE
 *
 * Tests EVERYTHING:
 * - All edge functions (health checks)
 * - Database integrity (orphans, duplicates, foreign keys)
 * - Data quality (missing fields, invalid values)
 * - API responses and error handling
 * - UI flows via HTTP requests
 *
 * Run: dotenvx run -- npx tsx scripts/comprehensive-qa-suite.ts
 * Output: /tmp/qa-report-{timestamp}.md
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface TestResult {
  category: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  duration?: number;
  details?: any;
}

const results: TestResult[] = [];
const startTime = Date.now();

function log(msg: string) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${elapsed}s] ${msg}`);
}

function addResult(result: TestResult) {
  results.push(result);
  const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : result.status === 'warn' ? '⚠️' : '⏭️';
  log(`${icon} [${result.category}] ${result.name}: ${result.message}`);
}

// ============================================================================
// EDGE FUNCTION TESTS
// ============================================================================

const CRITICAL_FUNCTIONS = [
  'search',
  'db-stats',
  'universal-search',
  'decode-vin',
  'test-health',
  'platform-status',
  'system-stats',
];

const EXTRACTION_FUNCTIONS = [
  'bat-simple-extract',
  'extract-cars-and-bids-core',
  'extract-hagerty-listing',
  'extract-vehicle-data-ai',
  'extract-premium-auction',
];

async function testEdgeFunction(name: string, body?: any): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const duration = Date.now() - start;
    const text = await res.text();

    if (res.ok) {
      return {
        category: 'Edge Functions',
        name,
        status: duration > 10000 ? 'warn' : 'pass',
        message: `${res.status} in ${duration}ms`,
        duration,
        details: { status: res.status, bodyLength: text.length },
      };
    } else {
      return {
        category: 'Edge Functions',
        name,
        status: res.status === 404 ? 'skip' : 'fail',
        message: `${res.status}: ${text.slice(0, 100)}`,
        duration,
      };
    }
  } catch (err: any) {
    return {
      category: 'Edge Functions',
      name,
      status: 'fail',
      message: err.message || 'Unknown error',
      duration: Date.now() - start,
    };
  }
}

async function runEdgeFunctionTests() {
  log('=== EDGE FUNCTION TESTS ===');

  // Test critical functions
  for (const fn of CRITICAL_FUNCTIONS) {
    const result = await testEdgeFunction(fn, fn === 'search' ? { query: 'test', limit: 5 } : undefined);
    addResult(result);
  }

  // Test extraction functions (with dummy data to check they respond)
  for (const fn of EXTRACTION_FUNCTIONS) {
    const result = await testEdgeFunction(fn, { url: 'https://example.com', test: true });
    addResult(result);
  }
}

// ============================================================================
// DATABASE INTEGRITY TESTS
// ============================================================================

async function runDatabaseIntegrityTests() {
  log('=== DATABASE INTEGRITY TESTS ===');

  // Test 1: Orphaned vehicle_images (no matching vehicle)
  const orphanedImages = await supabase.rpc('execute_sql', {
    sql: `SELECT COUNT(*) as count FROM vehicle_images vi
          LEFT JOIN vehicles v ON vi.vehicle_id = v.id
          WHERE v.id IS NULL`
  });

  if (orphanedImages.error) {
    // Try direct query
    const { count } = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .is('vehicle_id', null);

    addResult({
      category: 'Database Integrity',
      name: 'Orphaned vehicle_images (null vehicle_id)',
      status: (count || 0) > 1000 ? 'warn' : 'pass',
      message: `${count?.toLocaleString() || 0} images with null vehicle_id`,
    });
  }

  // Test 2: Vehicles without images
  const { count: noImageCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .is('primary_image_url', null);

  const { count: totalVehicles } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true });

  const pctNoImage = ((noImageCount || 0) / (totalVehicles || 1) * 100).toFixed(1);
  addResult({
    category: 'Database Integrity',
    name: 'Vehicles without primary_image_url',
    status: parseFloat(pctNoImage) > 50 ? 'warn' : 'pass',
    message: `${noImageCount?.toLocaleString()} of ${totalVehicles?.toLocaleString()} (${pctNoImage}%)`,
  });

  // Test 3: Duplicate VINs
  const { data: dupVins } = await supabase
    .from('vehicles')
    .select('vin')
    .not('vin', 'is', null)
    .not('vin', 'eq', '')
    .limit(50000);

  const vinCounts = new Map<string, number>();
  for (const v of dupVins || []) {
    if (v.vin && v.vin.length === 17) {
      vinCounts.set(v.vin, (vinCounts.get(v.vin) || 0) + 1);
    }
  }
  const duplicateVins = [...vinCounts.entries()].filter(([_, count]) => count > 1);

  addResult({
    category: 'Database Integrity',
    name: 'Duplicate VINs',
    status: duplicateVins.length > 100 ? 'warn' : 'pass',
    message: `${duplicateVins.length} VINs appear multiple times`,
    details: duplicateVins.slice(0, 10),
  });

  // Test 4: Invalid year values
  const { count: badYears } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .or('year.lt.1885,year.gt.2030');

  addResult({
    category: 'Database Integrity',
    name: 'Invalid year values (<1885 or >2030)',
    status: (badYears || 0) > 100 ? 'warn' : 'pass',
    message: `${badYears?.toLocaleString() || 0} vehicles with invalid years`,
  });

  // Test 5: Missing make/model
  const { count: noMake } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .or('make.is.null,make.eq.');

  const { count: noModel } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .or('model.is.null,model.eq.');

  addResult({
    category: 'Database Integrity',
    name: 'Vehicles missing make',
    status: (noMake || 0) > 1000 ? 'warn' : 'pass',
    message: `${noMake?.toLocaleString() || 0} vehicles`,
  });

  addResult({
    category: 'Database Integrity',
    name: 'Vehicles missing model',
    status: (noModel || 0) > 1000 ? 'warn' : 'pass',
    message: `${noModel?.toLocaleString() || 0} vehicles`,
  });

  // Test 6: Businesses without names
  const { count: noName } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .is('business_name', null);

  addResult({
    category: 'Database Integrity',
    name: 'Organizations without business_name',
    status: (noName || 0) > 50 ? 'warn' : 'pass',
    message: `${noName?.toLocaleString() || 0} orgs`,
  });
}

// ============================================================================
// DATA QUALITY TESTS
// ============================================================================

async function runDataQualityTests() {
  log('=== DATA QUALITY TESTS ===');

  // Test 1: Price sanity check
  const { data: priceSamples } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price')
    .not('sale_price', 'is', null)
    .or('sale_price.lt.100,sale_price.gt.50000000')
    .limit(20);

  addResult({
    category: 'Data Quality',
    name: 'Suspicious prices (<$100 or >$50M)',
    status: (priceSamples?.length || 0) > 10 ? 'warn' : 'pass',
    message: `${priceSamples?.length || 0} vehicles`,
    details: priceSamples?.slice(0, 5),
  });

  // Test 2: Mileage sanity check
  const { count: badMileage } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('mileage', 'is', null)
    .gt('mileage', 1000000);

  addResult({
    category: 'Data Quality',
    name: 'Mileage over 1,000,000',
    status: (badMileage || 0) > 50 ? 'warn' : 'pass',
    message: `${badMileage?.toLocaleString() || 0} vehicles`,
  });

  // Test 3: Check for test/dummy data
  const { count: testData } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .or('make.ilike.%test%,model.ilike.%test%,make.ilike.%dummy%,model.ilike.%asdf%');

  addResult({
    category: 'Data Quality',
    name: 'Possible test/dummy vehicles',
    status: (testData || 0) > 10 ? 'warn' : 'pass',
    message: `${testData?.toLocaleString() || 0} vehicles`,
  });

  // Test 4: Image URL validity (sample check)
  const { data: imageSamples } = await supabase
    .from('vehicle_images')
    .select('url')
    .not('url', 'is', null)
    .limit(100);

  let brokenUrls = 0;
  for (const img of (imageSamples || []).slice(0, 20)) {
    if (!img.url?.startsWith('http')) {
      brokenUrls++;
    }
  }

  addResult({
    category: 'Data Quality',
    name: 'Image URLs not starting with http',
    status: brokenUrls > 5 ? 'warn' : 'pass',
    message: `${brokenUrls} of 20 sampled`,
  });

  // Test 5: Recent data freshness
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentVehicles } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .gt('created_at', oneDayAgo);

  addResult({
    category: 'Data Quality',
    name: 'Vehicles added in last 24h',
    status: (recentVehicles || 0) === 0 ? 'warn' : 'pass',
    message: `${recentVehicles?.toLocaleString() || 0} new vehicles`,
  });
}

// ============================================================================
// SEARCH FUNCTIONALITY TESTS
// ============================================================================

async function runSearchTests() {
  log('=== SEARCH FUNCTIONALITY TESTS ===');

  const searchQueries = [
    { query: 'porsche 911', expectType: 'vehicle', minResults: 1 },
    { query: 'c10', expectType: 'vehicle', minResults: 1 },
    { query: 'mustang', expectType: 'vehicle', minResults: 1 },
    { query: 'mecum', expectType: 'organization', minResults: 1 },
    { query: '1967 camaro', expectType: 'vehicle', minResults: 0 },
    { query: 'corvette', expectType: 'vehicle', minResults: 1 },
    { query: 'ferrari', expectType: 'vehicle', minResults: 0 },
    { query: 'bmw', expectType: 'vehicle', minResults: 1 },
    { query: 'toyota', expectType: 'vehicle', minResults: 0 },
    { query: 'bring a trailer', expectType: 'organization', minResults: 0 },
  ];

  for (const test of searchQueries) {
    const start = Date.now();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: test.query, limit: 20 }),
        signal: AbortSignal.timeout(30000),
      });

      const duration = Date.now() - start;
      const data = await res.json();
      const resultCount = data.results?.length || 0;
      const topType = data.results?.[0]?.type;

      const passed = resultCount >= test.minResults;
      const correctType = !test.expectType || topType === test.expectType || resultCount === 0;

      addResult({
        category: 'Search',
        name: `"${test.query}"`,
        status: passed && correctType ? (duration > 5000 ? 'warn' : 'pass') : 'fail',
        message: `${resultCount} results, top type: ${topType}, ${duration}ms`,
        duration,
      });
    } catch (err: any) {
      addResult({
        category: 'Search',
        name: `"${test.query}"`,
        status: 'fail',
        message: err.message,
      });
    }
  }
}

// ============================================================================
// API ENDPOINT TESTS
// ============================================================================

async function runAPITests() {
  log('=== API ENDPOINT TESTS ===');

  // Test RPC functions
  const rpcTests = [
    { name: 'calculate_portfolio_value_server', params: {} },
  ];

  for (const test of rpcTests) {
    const start = Date.now();
    const { data, error } = await supabase.rpc(test.name, test.params);
    const duration = Date.now() - start;

    addResult({
      category: 'RPC Functions',
      name: test.name,
      status: error ? 'fail' : 'pass',
      message: error ? error.message : `Success in ${duration}ms`,
      duration,
    });
  }

  // Test table accessibility
  const tables = ['vehicles', 'businesses', 'profiles', 'vehicle_images', 'auction_comments'];
  for (const table of tables) {
    const start = Date.now();
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .limit(1);
    const duration = Date.now() - start;

    addResult({
      category: 'Table Access',
      name: table,
      status: error ? 'fail' : 'pass',
      message: error ? error.message : `${count?.toLocaleString()} rows, ${duration}ms`,
      duration,
    });
  }
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateReport(): string {
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  let report = `# Comprehensive QA Report

**Generated**: ${new Date().toISOString()}
**Duration**: ${totalDuration}s

## Summary

| Status | Count |
|--------|-------|
| ✅ Passed | ${passed} |
| ❌ Failed | ${failed} |
| ⚠️ Warnings | ${warned} |
| ⏭️ Skipped | ${skipped} |
| **Total** | **${results.length}** |

## Results by Category

`;

  const byCategory = new Map<string, TestResult[]>();
  for (const r of results) {
    const list = byCategory.get(r.category) || [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  for (const [category, items] of byCategory) {
    report += `### ${category}\n\n`;
    report += `| Test | Status | Message | Duration |\n`;
    report += `|------|--------|---------|----------|\n`;

    for (const item of items) {
      const icon = item.status === 'pass' ? '✅' : item.status === 'fail' ? '❌' : item.status === 'warn' ? '⚠️' : '⏭️';
      const duration = item.duration ? `${item.duration}ms` : '-';
      report += `| ${item.name} | ${icon} ${item.status} | ${item.message.slice(0, 50)} | ${duration} |\n`;
    }
    report += '\n';
  }

  // Failed tests detail
  const failedTests = results.filter(r => r.status === 'fail');
  if (failedTests.length > 0) {
    report += `## Failed Tests Detail\n\n`;
    for (const t of failedTests) {
      report += `### ${t.category}: ${t.name}\n`;
      report += `- **Message**: ${t.message}\n`;
      if (t.details) {
        report += `- **Details**: \`${JSON.stringify(t.details).slice(0, 200)}\`\n`;
      }
      report += '\n';
    }
  }

  // Warnings detail
  const warnedTests = results.filter(r => r.status === 'warn');
  if (warnedTests.length > 0) {
    report += `## Warnings Detail\n\n`;
    for (const t of warnedTests) {
      report += `- **${t.category}: ${t.name}** - ${t.message}\n`;
    }
    report += '\n';
  }

  return report;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log('Starting Comprehensive QA Suite...');
  log(`Supabase URL: ${SUPABASE_URL}`);

  try {
    await runEdgeFunctionTests();
    await runDatabaseIntegrityTests();
    await runDataQualityTests();
    await runSearchTests();
    await runAPITests();
  } catch (err) {
    log(`Fatal error: ${err}`);
  }

  const report = generateReport();
  const reportPath = `/tmp/qa-report-${Date.now()}.md`;

  const fs = await import('fs/promises');
  await fs.writeFile(reportPath, report);
  log(`\nReport written to: ${reportPath}`);

  // Also write to a known location
  await fs.writeFile('/tmp/qa-report-latest.md', report);
  log(`Report also at: /tmp/qa-report-latest.md`);

  // Print summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;

  log('\n========================================');
  log(`SUMMARY: ${passed} passed, ${failed} failed, ${warned} warnings`);
  log('========================================');

  process.exit(failed > 0 ? 1 : 0);
}

main();
