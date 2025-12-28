#!/usr/bin/env node

/**
 * Edge Function Health Check
 * 
 * Tests all edge functions with a basic health check:
 * - Verifies function exists and responds
 * - Checks for basic error handling
 * - Records response time
 * - Categorizes by tier/priority
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Function tiers (from testing strategy)
const TIER_1 = [
  'analyze-image',
  'scrape-vehicle',
  'process-vehicle-import',
  'parse-receipt',
  'extract-title-data',
  'create-checkout',
  'stripe-webhook',
  'auto-analyze-upload',
  'vehicle-expert-agent',
  'search-vehicle-history',
  'decode-vin'
];

const TIER_2 = [
  'process-import-queue',
  'backfill-images',
  'comprehensive-bat-extraction',
  'sync-bat-listing',
  'extract-auction-comments',
  'analyze-auction-comments',
  'batch-analyze-images',
  'process-all-images-cron',
  'tier1-batch-runner',
  'analyze-image-tier1',
  'analyze-image-tier2',
  'analyze-image-contextual'
];

// Test timeout (5 seconds)
const TEST_TIMEOUT = 5000;

// Minimal test payloads by function type
const TEST_PAYLOADS = {
  'analyze-image': { image_url: 'https://example.com/test.jpg', vehicle_id: null },
  'scrape-vehicle': { url: 'https://example.com/vehicle' },
  'process-vehicle-import': { import_id: null },
  'parse-receipt': { receipt_url: 'https://example.com/receipt.jpg' },
  'extract-title-data': { image_url: 'https://example.com/title.jpg' },
  'create-checkout': { amount: 1000, currency: 'usd' },
  'stripe-webhook': { type: 'test', data: {} },
  'auto-analyze-upload': { image_id: null },
  'vehicle-expert-agent': { vehicleId: null },
  'search-vehicle-history': { query: 'test' },
  'decode-vin': { vin: '1HGBH41JXMN109186' },
  'default': {} // Empty payload for unknown functions
};

function getTier(functionName) {
  if (TIER_1.includes(functionName)) return 1;
  if (TIER_2.includes(functionName)) return 2;
  return 3;
}

function getTestPayload(functionName) {
  return TEST_PAYLOADS[functionName] || TEST_PAYLOADS.default;
}

async function testFunction(functionName, verifyJwt = true) {
  const startTime = Date.now();
  const tier = getTier(functionName);
  const payload = getTestPayload(functionName);
  
  const result = {
    name: functionName,
    tier,
    verify_jwt: verifyJwt,
    status: 'unknown',
    response_time_ms: 0,
    http_status: null,
    error: null,
    has_response: false,
    response_type: null
  };

  try {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), TEST_TIMEOUT);
    });

    // Create function invoke promise
    const invokePromise = supabase.functions.invoke(functionName, {
      body: payload,
      timeout: TEST_TIMEOUT
    });

    // Race between timeout and invoke
    const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

    result.response_time_ms = Date.now() - startTime;
    result.has_response = true;

    if (error) {
      result.status = 'error';
      result.error = error.message || String(error);
      
      // Categorize errors
      if (error.message?.includes('Function not found') || error.message?.includes('404')) {
        result.status = 'not_found';
      } else if (error.message?.includes('Timeout')) {
        result.status = 'timeout';
      } else if (error.message?.includes('JWT') || error.message?.includes('auth')) {
        result.status = 'auth_error';
      } else {
        result.status = 'function_error';
      }
    } else {
      // Check if response is valid
      if (data !== null && data !== undefined) {
        result.status = 'success';
        result.response_type = typeof data === 'object' ? 'json' : typeof data;
      } else {
        result.status = 'empty_response';
      }
    }
  } catch (err) {
    result.response_time_ms = Date.now() - startTime;
    result.status = 'exception';
    result.error = err.message || String(err);
    
    if (err.message?.includes('Timeout')) {
      result.status = 'timeout';
    }
  }

  return result;
}

async function getAllFunctions() {
  try {
    // Use MCP tool if available, otherwise we'll need to list from filesystem
    // For now, we'll use a known list or fetch from Supabase API
    // Since we can't directly list functions via Supabase JS client,
    // we'll use the list from the MCP tool result
    
    // Known functions list (from the MCP list_edge_functions result)
    // In production, you'd want to fetch this dynamically
    const knownFunctions = [
      'process-vin', 'search-vehicle-history', 'analyze-vehicle-data',
      'crawl-market-data', 'search-local-garages', 'query-mendable',
      'analyze-inventory-image', 'search-garages', 'analyze-skills',
      'fetch-market-auctions', 'process-vehicle-import', 'seed-certifications',
      'get-mapbox-token', 'calculate-feed-relevance', 'analyze-vehicle-probability',
      'simulate-agent-activities', 'generate-explanation', 'track-content-interaction',
      'analyze-modification-value', 'scrape-vehicle', 'apple-upload',
      'live-admin', 'phone-verify', 'create-setup-session', 'stripe-webhook',
      'parse-receipt', 'process-receipt', 'analyze-image', 'receipt-extract',
      'send-invite-email', 'scrape-listing', 'analyze-vehicle-tags',
      'extract-training-data', 'optimize-rekognition-training', 'receipt-llm-validate',
      'auto-analyze-upload', 'ai-agent-supervisor', 'extract-title-data',
      'openai-proxy', 'research-spec', 'create-checkout', 'image-proxy',
      'auto-quality-inspector',
      'identify-part-at-click', 'scrape-lmc-complete', 'incubate-image',
      'create-vehicle-transaction-checkout', 'generate-transaction-documents',
      'send-transaction-sms', 'create-shipping-listing', 'centraldispatch-oauth-callback',
      'centraldispatch-webhook', 'get-centraldispatch-auth-url', 'fix-price-rls',
      'vehicle-expert-agent', 'extract-receipt-data', 'place-market-order',
      'profile-image-analyst', 'smart-receipt-linker', 'scan-organization-image',
      'generate-work-logs', 'parse-deal-jacket', 'reprocess-image-exif',
      'import-bat-listing', 'sync-bat-listing', 'parse-bat-to-validations',
      'ai-tag-image-angles', 'analyze-work-order-bundle', 'extract-work-order-ocr',
      'analyze-work-photos-with-products', 'link-bat-images', 'detect-spid-sheet',
      'auto-fill-from-spid', 'merge-vehicles', 'estimate-restoration-cost',
      'backfill-expert-data', 'automated-data-repair', 'backfill-bat-vehicles',
      'complete-bat-import', 'process-pdf-receipt', 'detect-build-phases',
      'vehicle-assistant', 'parts-research-engine', 'photo-forensic-analyzer',
      'bulk-forensic-analyzer', 'project-stats', 'backfill-image-angles',
      'get-manual-pages', 'extract-bat-parts-brands', 'generate-vehicle-description',
      'auto-fix-bat-prices', 'parse-reference-document', 'analyze-image-contextual',
      'analyze-image-tier1', 'analyze-image-tier2', 'analyze-image-gap-finder',
      'calculate-profile-completeness', 'set-image-angle', 'analyze-organization-images',
      'detect-sensitive-document', 'auto-tag-objects', 'auto-detect-vehicle-owner',
      'batch-analyze-vehicle', 'intelligent-work-detector', 'detailed-component-extractor',
      'create-api-access-checkout', 'extract-image', 'execute-auto-buy',
      'monitor-price-drops', 'monitor-bat-seller', 'extract-and-route-data',
      'extract-vehicle-data-ai',  'backfill-craigslist-images', 'normalize-craigslist-vehicles',
      'normalize-all-vehicles', 'batch-analyze-images', 'batch-analyze-all-images',
      'process-all-images-cron', 'validate-bat-image', 'research-agent',
      'discover-cl-squarebodies', 'process-cl-queue', 'check-scraper-health',
      'process-backfill-queue', 'scrape-multi-source', 'process-import-queue',
      'backfill-images', 'index-reference-document', 'process-catalog-queue',
      'extract-auction-comments', 'analyze-auction-comments',
      'generate-auction-receipt', 'decode-vin', 'extract-manual-pages',
      'index-reference-pages', 'process-content-extraction', 'service-orchestrator',
      'scrape-lmc-parts', 'analyze-batch-contextual', 'auto-fix-vehicle-profile',
      'decode-vin-and-update', 'recommend-parts-for-vehicle', 'analyze-bundle',
      'detect-before-after', 'index-service-manual',       'generate-wiring-quote', 'query-wiring-needs',
      'tier1-batch-runner', 'search-bat-listings', 'audit-tier1', 'simple-scraper',
      'scrape-vehicle-with-firecrawl', 'mailbox', 'comprehensive-bat-extraction',
      'extract-using-catalog', 'monitor-bhcc-sales',
      'process-import-queue-fast', 'repair-bhcc-vehicles',       'process-inventory-sync-queue', 'backfill-org-primary-images', 'upsert-bat-local-partners',
      'process-classic-seller-queue', 'enqueue-bat-local-partner-inventory', 'backfill-origin-vehicle-images',
      'extract-vin-from-vehicle', 'create-notification', 'backfill-bat-vins',
      'backfill-listing-metadata', 'autonomous-extraction-agent', 'extract-premium-auction',
      'process-bat-extraction-queue',
      'bat-scraper', 'extract-bat-profile-vehicles', 'sync-instagram-organization',
      'detect-vehicles-in-content', 'backfill-instagram-content',
      'extract-organization-from-seller',
      'scrape-organization-site', 'sync-active-auctions',
      'discover-organization-full', 'extract-all-orgs-inventory', 'trickle-backfill-images'
    ];

    return knownFunctions.map(name => ({
      name,
      verify_jwt: TIER_1.includes(name) || TIER_2.includes(name) // Most important functions require JWT
    }));
  } catch (error) {
    console.error('Error fetching functions:', error);
    return [];
  }
}

async function main() {
  console.log('🔍 Edge Function Health Check');
  console.log('='.repeat(70));
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Testing timeout: ${TEST_TIMEOUT}ms`);
  console.log('');

  const functions = await getAllFunctions();
  console.log(`Found ${functions.length} functions to test\n`);

  const results = [];
  const summary = {
    total: functions.length,
    success: 0,
    error: 0,
    timeout: 0,
    not_found: 0,
    auth_error: 0,
    exception: 0,
    by_tier: { 1: 0, 2: 0, 3: 0 }
  };

  // Test functions in batches to avoid overwhelming the system
  const BATCH_SIZE = 5;
  for (let i = 0; i < functions.length; i += BATCH_SIZE) {
    const batch = functions.slice(i, i + BATCH_SIZE);
    console.log(`Testing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(functions.length / BATCH_SIZE)} (${i + 1}-${Math.min(i + BATCH_SIZE, functions.length)})...`);
    
    const batchResults = await Promise.all(
      batch.map(func => testFunction(func.name, func.verify_jwt))
    );
    
    results.push(...batchResults);
    
    // Update summary
    batchResults.forEach(result => {
      summary.by_tier[result.tier]++;
      if (result.status === 'success') summary.success++;
      else if (result.status === 'error' || result.status === 'function_error') summary.error++;
      else if (result.status === 'timeout') summary.timeout++;
      else if (result.status === 'not_found') summary.not_found++;
      else if (result.status === 'auth_error') summary.auth_error++;
      else if (result.status === 'exception') summary.exception++;
    });
    
    // Show progress
    const lastResult = batchResults[batchResults.length - 1];
    const statusIcon = lastResult.status === 'success' ? '✅' : 
                      lastResult.status === 'timeout' ? '⏱️' : 
                      lastResult.status === 'not_found' ? '❌' : '⚠️';
    console.log(`  ${statusIcon} ${lastResult.name}: ${lastResult.status} (${lastResult.response_time_ms}ms)`);
    
    // Small delay between batches
    if (i + BATCH_SIZE < functions.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total functions: ${summary.total}`);
  console.log(`✅ Success: ${summary.success}`);
  console.log(`❌ Errors: ${summary.error}`);
  console.log(`⏱️  Timeouts: ${summary.timeout}`);
  console.log(`🔍 Not found: ${summary.not_found}`);
  console.log(`🔐 Auth errors: ${summary.auth_error}`);
  console.log(`💥 Exceptions: ${summary.exception}`);
  console.log('');
  console.log('By Tier:');
  console.log(`  Tier 1: ${summary.by_tier[1]}`);
  console.log(`  Tier 2: ${summary.by_tier[2]}`);
  console.log(`  Tier 3: ${summary.by_tier[3]}`);

  // Show failures
  const failures = results.filter(r => r.status !== 'success' && r.status !== 'auth_error');
  if (failures.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('⚠️  FAILURES');
    console.log('='.repeat(70));
    failures.slice(0, 20).forEach(result => {
      console.log(`  ${result.name} (Tier ${result.tier}): ${result.status}`);
      if (result.error) console.log(`    Error: ${result.error}`);
    });
    if (failures.length > 20) {
      console.log(`  ... and ${failures.length - 20} more`);
    }
  }

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(__dirname, '../test-results/edge-functions');
  await fs.mkdir(resultsDir, { recursive: true });
  
  const resultsFile = path.join(resultsDir, `health-${timestamp}.json`);
  await fs.writeFile(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary,
    results
  }, null, 2));
  
  console.log(`\n💾 Results saved to: ${resultsFile}`);

  // Exit with error code if there are critical failures
  const criticalFailures = failures.filter(r => r.tier === 1);
  if (criticalFailures.length > 0) {
    console.log(`\n❌ ${criticalFailures.length} Tier 1 functions failed!`);
    process.exit(1);
  }
}

main().catch(console.error);

