#!/usr/bin/env node

/**
 * Analyze Unused Edge Functions
 * 
 * Identifies functions that are:
 * 1. Not called from frontend
 * 2. Not called from other functions
 * 3. Not scheduled/cron jobs
 * 4. Clearly experimental/one-off
 * 5. Deprecated or replaced
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Functions called from frontend (from grep results)
const FRONTEND_FUNCTIONS = new Set([
  'analyze-image',
  'simple-scraper',
  'vehicle-expert-agent',
  'complete-bat-import',
  'extract-and-route-data',
  'unified-scraper-orchestrator',
  'scrape-ksl-listings',
  'generate-vehicle-description',
  'extract-using-catalog',
  'backfill-profile-stats',
  'detect-sensitive-document',
  'scrape-bat-member',
  'ai-agent-supervisor',
  'split-vehicle-from-source',
  'analyze-and-source-pending',
  'validate-bat-image',
  'process-content-extraction',
  'index-reference-document',
  'index-service-manual',
  'scrape-vehicle',
  'backfill-images',
  'process-receipt',
  'extract-pdf-text',
  'auto-analyze-upload',
  'analyze-batch-contextual',
  'smart-receipt-linker',
  'encrypt-stripe-key',
  'parse-dealer-spreadsheet',
  'dealer-ai-assistant',
  'reprocess-image-exif',
  'auto-fix-bat-prices',
  'parse-reference-document',
  'extract-bat-parts-brands',
  'sync-bat-listing',
  'setup-payment-method',
  'place-bid-with-deposit',
  'query-wiring-needs',
  'analyze-vehicle-tags',
  'ask-vehicle-question',
  'extract-vehicle-data-ai',
  'analyze-component-states',
  'resolve-loose-ends',
  'generate-work-logs',
  'auto-fix-vehicle-profile',
  'process-url-drop',
  'image-ai-chat',
  'update-org-from-website',
  'process-cl-queue'
]);

// Functions scheduled as cron jobs
const SCHEDULED_FUNCTIONS = new Set([
  'process-all-images-cron',
  'autonomous-extraction-agent',
  'scheduled-bat-scrape',
  'import-bat-data'
]);

// Functions that are clearly experimental/one-off/test
const EXPERIMENTAL_PATTERNS = [
  /^test-/,
  /^quick-/,
  /-test$/,
  /^experimental-/,
  /^demo-/,
  /^trial-/,
  /^sandbox-/,
  /^playground-/
];

// Functions that are clearly deprecated or replaced
const DEPRECATED_FUNCTIONS = new Set([
  // Add known deprecated functions here
]);

// Functions that are clearly one-off scrapers for specific sites
const ONE_OFF_SCRAPERS = [
  'scrape-lmc-truck',
  'scrape-lmc-complete',
  'parse-lmc-complete-catalog',
  'scrape-prowire-catalog',
  'scrape-motec-catalog',
  'scrape-holley-product',
  'holley-discover-urls',
  'scrape-sbxcars',
  'discover-sbxcars-listings',
  'monitor-sbxcars-listings',
  'scrape-collective-auto-sold',
  'discover-speed-digital-clients',
  'discover-speed-digital-clients-v2',
  'enrich-speed-digital-clients',
  'discover-classic-sellers',
  'index-2002ad-parts',
  'index-lartdelautomobile',
  'index-classic-com-dealer',
  'catalog-dealer-site-structure',
  'scrape-all-craigslist-squarebodies',
  'scrape-all-craigslist-2000-and-older',
  'discover-cl-squarebodies',
  'scrape-craigslist-search',
  'import-classiccars-listing',
  'import-classic-auction',
  'sync-cars-and-bids-listing'
];

// Functions that are clearly admin/maintenance one-offs
const ADMIN_ONE_OFFS = [
  'fix-price-rls',
  'cleanup-bat-image-contamination',
  'bat-make-profiles-correct-runner',
  'bat-dom-map-health-runner',
  'retry-image-backfill',
  'admin-backfill-bat-missing-images',
  'admin-backfill-origin-images',
  'sync-service-key-to-db',
  'activate-pending-vehicles',
  're-extract-pending-vehicles',
  'normalize-org-vehicle-relationships',
  'auth-site-mapper',
  'auto-site-mapper',
  'inspect-scrape-coverage',
  'check-scraper-health',
  'system-stats',
  'project-stats',
  'go-grinder',
  'micro-scrape-bandaid',
  'test-bat-firecrawl',
  'test-gemini',
  'quick-endpoint'
];

// Functions that are clearly training/research/experimental
const RESEARCH_FUNCTIONS = [
  'extract-training-data',
  'optimize-rekognition-training',
  'tool-benchmark-validator',
  'ai-proofread-pending',
  'simulate-agent-activities',
  'generate-explanation',
  'track-content-interaction',
  'analyze-vehicle-probability',
  'calculate-feed-relevance',
  'analyze-modification-value',
  'research-spec',
  'research-agent'
];

// Functions that might be called from other functions (need to check)
const POTENTIALLY_INTERNAL = [
  'process-import-queue',
  'process-backfill-queue',
  'process-cl-queue',
  'process-catalog-queue',
  'process-inventory-sync-queue',
  'process-classic-seller-queue',
  'process-bat-extraction-queue',
  'tier1-batch-runner',
  'batch-analyze-images',
  'batch-analyze-all-images',
  'analyze-image-tier1',
  'analyze-image-tier2',
  'analyze-image-contextual',
  'analyze-image-gap-finder',
  'comprehensive-bat-extraction',
  'extract-premium-auction',
  'extract-auction-comments',
  'analyze-auction-comments',
  'generate-auction-receipt',
  'decode-vin-and-update',
  'extract-vin-from-vehicle',
  'backfill-bat-vins',
  'backfill-listing-metadata',
  'backfill-image-angles',
  'backfill-origin-vehicle-images',
  'backfill-craigslist-images',
  'backfill-bat-vehicles',
  'backfill-expert-data',
  'backfill-org-primary-images',
  'backfill-instagram-content',
  'trickle-backfill-images',
  'normalize-craigslist-vehicles',
  'normalize-all-vehicles',
  'extract-bat-profile-vehicles',
  'extract-organization-from-seller',
  'extract-manual-pages',
  'extract-receipt-data',
  'extract-image',
  'extract-title-data',
  'extract-work-order-ocr',
  'extract-using-catalog',
  'extract-and-route-data',
  'extract-vehicle-data-ai',
  'extract-all-orgs-inventory',
  'decode-vin',
  'parse-receipt',
  'parse-pdf-receipt',
  'parse-deal-jacket',
  'parse-bat-to-validations',
  'parse-reference-document',
  'parse-lmc-complete-catalog',
  'receipt-extract',
  'receipt-llm-validate',
  'process-receipt',
  'process-pdf-receipt',
  'process-vehicle-import',
  'process-content-extraction',
  'process-all-images-cron',
  'link-bat-images',
  'merge-vehicles',
  'auto-fix-bat-prices',
  'auto-fix-vehicle-profile',
  'auto-fill-from-spid',
  'auto-tag-objects',
  'auto-detect-vehicle-owner',
  'auto-analyze-upload',
  'auto-quality-inspector',
  'automated-data-repair',
  'detect-spid-sheet',
  'detect-build-phases',
  'detect-before-after',
  'detect-sensitive-document',
  'detect-vehicles-in-content',
  'ai-tag-image-angles',
  'calculate-profile-completeness',
  'set-image-angle',
  'reprocess-image-exif',
  'analyze-organization-images',
  'scan-organization-image',
  'analyze-work-order-bundle',
  'analyze-work-photos-with-products',
  'analyze-bundle',
  'analyze-inventory-image',
  'analyze-skills',
  'analyze-vehicle-data',
  'analyze-vehicle-tags',
  'analyze-vehicle-probability',
  'analyze-modification-value',
  'analyze-batch-contextual',
  'batch-analyze-vehicle',
  'intelligent-work-detector',
  'detailed-component-extractor',
  'photo-forensic-analyzer',
  'bulk-forensic-analyzer',
  'smart-receipt-linker',
  'generate-work-logs',
  'generate-vehicle-description',
  'generate-wiring-quote',
  'generate-auction-receipt',
  'generate-explanation',
  'generate-transaction-documents',
  'estimate-restoration-cost',
  'recommend-parts-for-vehicle',
  'parts-research-engine',
  'vehicle-assistant',
  'vehicle-expert-agent',
  'query-wiring-needs',
  'query-mendable',
  'search-vehicle-history',
  'search-bat-listings',
  'search-local-garages',
  'search-garages',
  'crawl-market-data',
  'fetch-market-auctions',
  'monitor-bat-seller',
  'monitor-price-drops',
  'monitor-bhcc-sales',
  'monitor-sbxcars-listings',
  'execute-auto-buy',
  'place-market-order',
  'create-checkout',
  'create-vehicle-transaction-checkout',
  'create-api-access-checkout',
  'create-notification',
  'create-setup-session',
  'create-shipping-listing',
  'send-transaction-sms',
  'send-invite-email',
  'stripe-webhook',
  'centraldispatch-oauth-callback',
  'centraldispatch-webhook',
  'get-centraldispatch-auth-url',
  'get-mapbox-token',
  'get-manual-pages',
  'index-service-manual',
  'index-reference-document',
  'index-reference-pages',
  'index-classic-com-dealer',
  'index-lartdelautomobile',
  'index-2002ad-parts',
  'scrape-multi-source',
  'scrape-vehicle',
  'scrape-vehicle-with-firecrawl',
  'scrape-listing',
  'scrape-organization-site',
  'scrape-lmc-truck',
  'scrape-lmc-complete',
  'scrape-lmc-parts',
  'scrape-prowire-catalog',
  'scrape-motec-catalog',
  'scrape-holley-product',
  'scrape-sbxcars',
  'scrape-all-craigslist-squarebodies',
  'scrape-all-craigslist-2000-and-older',
  'scrape-craigslist-search',
  'scrape-collective-auto-sold',
  'scrape-ksl-listings',
  'import-bat-listing',
  'import-classiccars-listing',
  'import-classic-auction',
  'sync-bat-listing',
  'sync-active-auctions',
  'sync-cars-and-bids-listing',
  'sync-instagram-organization',
  'complete-bat-import',
  'comprehensive-bat-extraction',
  'extract-premium-auction',
  'extract-auction-comments',
  'analyze-auction-comments',
  'upsert-bat-local-partners',
  'enqueue-bat-local-partner-inventory',
  'repair-bhcc-vehicles',
  'discover-organization-full',
  'discover-speed-digital-clients',
  'discover-speed-digital-clients-v2',
  'discover-classic-sellers',
  'discover-cl-squarebodies',
  'discover-sbxcars-listings',
  'enrich-speed-digital-clients',
  'catalog-dealer-site-structure',
  'holley-discover-urls',
  'service-orchestrator',
  'unified-scraper-orchestrator',
  'autonomous-extraction-agent',
  'ai-agent-supervisor',
  'scheduled-bat-scrape',
  'process-all-images-cron',
  'tier1-batch-runner',
  'audit-tier1',
  'check-scraper-health',
  'system-stats',
  'project-stats',
  'go-grinder',
  'micro-scrape-bandaid',
  'test-bat-firecrawl',
  'test-gemini',
  'quick-endpoint',
  'mailbox',
  'live-admin',
  'phone-verify',
  'apple-upload',
  'image-proxy',
  'openai-proxy',
  'incubate-image',
  'identify-part-at-click',
  'profile-image-analyst',
  'seed-certifications',
  'process-vin',
  'decode-vin',
  'decode-vin-and-update',
  'extract-vin-from-vehicle',
  'backfill-bat-vins',
  'backfill-listing-metadata',
  'backfill-image-angles',
  'backfill-origin-vehicle-images',
  'backfill-craigslist-images',
  'backfill-bat-vehicles',
  'backfill-expert-data',
  'backfill-org-primary-images',
  'backfill-instagram-content',
  'trickle-backfill-images',
  'retry-image-backfill',
  'admin-backfill-bat-missing-images',
  'admin-backfill-origin-images',
  'normalize-craigslist-vehicles',
  'normalize-all-vehicles',
  'normalize-org-vehicle-relationships',
  'extract-bat-profile-vehicles',
  'extract-organization-from-seller',
  'extract-manual-pages',
  'extract-receipt-data',
  'extract-image',
  'extract-title-data',
  'extract-work-order-ocr',
  'extract-using-catalog',
  'extract-and-route-data',
  'extract-vehicle-data-ai',
  'extract-all-orgs-inventory',
  'extract-bat-parts-brands',
  'extract-training-data',
  'extract-pdf-text',
  'decode-vin',
  'parse-receipt',
  'process-pdf-receipt',
  'parse-deal-jacket',
  'parse-bat-to-validations',
  'parse-reference-document',
  'parse-lmc-complete-catalog',
  'parse-dealer-spreadsheet',
  'receipt-extract',
  'receipt-llm-validate',
  'process-receipt',
  'process-pdf-receipt',
  'process-vehicle-import',
  'process-content-extraction',
  'process-all-images-cron',
  'process-import-queue',
  'process-backfill-queue',
  'process-cl-queue',
  'process-catalog-queue',
  'process-inventory-sync-queue',
  'process-classic-seller-queue',
  'process-bat-extraction-queue',
  'process-import-queue-fast',
  'link-bat-images',
  'merge-vehicles',
  'auto-fix-bat-prices',
  'auto-fix-vehicle-profile',
  'auto-fill-from-spid',
  'auto-tag-objects',
  'auto-detect-vehicle-owner',
  'auto-analyze-upload',
  'auto-quality-inspector',
  'automated-data-repair',
  'detect-spid-sheet',
  'detect-build-phases',
  'detect-before-after',
  'detect-sensitive-document',
  'detect-vehicles-in-content',
  'ai-tag-image-angles',
  'calculate-profile-completeness',
  'set-image-angle',
  'reprocess-image-exif',
  'analyze-organization-images',
  'scan-organization-image',
  'analyze-work-order-bundle',
  'analyze-work-photos-with-products',
  'analyze-bundle',
  'analyze-inventory-image',
  'analyze-skills',
  'analyze-vehicle-data',
  'analyze-vehicle-tags',
  'analyze-vehicle-probability',
  'analyze-modification-value',
  'analyze-batch-contextual',
  'batch-analyze-vehicle',
  'batch-analyze-images',
  'batch-analyze-all-images',
  'intelligent-work-detector',
  'detailed-component-extractor',
  'photo-forensic-analyzer',
  'bulk-forensic-analyzer',
  'smart-receipt-linker',
  'generate-work-logs',
  'generate-vehicle-description',
  'generate-wiring-quote',
  'generate-auction-receipt',
  'generate-explanation',
  'generate-transaction-documents',
  'estimate-restoration-cost',
  'recommend-parts-for-vehicle',
  'parts-research-engine',
  'vehicle-assistant',
  'vehicle-expert-agent',
  'query-wiring-needs',
  'query-mendable',
  'search-vehicle-history',
  'search-bat-listings',
  'search-local-garages',
  'search-garages',
  'crawl-market-data',
  'fetch-market-auctions',
  'monitor-bat-seller',
  'monitor-price-drops',
  'monitor-bhcc-sales',
  'monitor-sbxcars-listings',
  'execute-auto-buy',
  'place-market-order',
  'create-checkout',
  'create-vehicle-transaction-checkout',
  'create-api-access-checkout',
  'create-notification',
  'create-setup-session',
  'create-shipping-listing',
  'send-transaction-sms',
  'send-invite-email',
  'stripe-webhook',
  'centraldispatch-oauth-callback',
  'centraldispatch-webhook',
  'get-centraldispatch-auth-url',
  'get-mapbox-token',
  'get-manual-pages',
  'index-service-manual',
  'index-reference-document',
  'index-reference-pages',
  'index-classic-com-dealer',
  'index-lartdelautomobile',
  'index-2002ad-parts',
  'scrape-multi-source',
  'scrape-vehicle',
  'scrape-vehicle-with-firecrawl',
  'scrape-listing',
  'scrape-organization-site',
  'scrape-lmc-truck',
  'scrape-lmc-complete',
  'scrape-lmc-parts',
  'scrape-prowire-catalog',
  'scrape-motec-catalog',
  'scrape-holley-product',
  'scrape-sbxcars',
  'scrape-all-craigslist-squarebodies',
  'scrape-all-craigslist-2000-and-older',
  'scrape-craigslist-search',
  'scrape-collective-auto-sold',
  'scrape-ksl-listings',
  'import-bat-listing',
  'import-classiccars-listing',
  'import-classic-auction',
  'sync-bat-listing',
  'sync-active-auctions',
  'sync-cars-and-bids-listing',
  'sync-instagram-organization',
  'complete-bat-import',
  'comprehensive-bat-extraction',
  'extract-premium-auction',
  'extract-auction-comments',
  'analyze-auction-comments',
  'upsert-bat-local-partners',
  'enqueue-bat-local-partner-inventory',
  'repair-bhcc-vehicles',
  'discover-organization-full',
  'discover-speed-digital-clients',
  'discover-speed-digital-clients-v2',
  'discover-classic-sellers',
  'discover-cl-squarebodies',
  'discover-sbxcars-listings',
  'enrich-speed-digital-clients',
  'catalog-dealer-site-structure',
  'holley-discover-urls',
  'service-orchestrator',
  'unified-scraper-orchestrator',
  'autonomous-extraction-agent',
  'ai-agent-supervisor',
  'scheduled-bat-scrape',
  'process-all-images-cron',
  'tier1-batch-runner',
  'audit-tier1',
  'check-scraper-health',
  'system-stats',
  'project-stats',
  'go-grinder',
  'micro-scrape-bandaid',
  'test-bat-firecrawl',
  'test-gemini',
  'quick-endpoint',
  'mailbox',
  'live-admin',
  'phone-verify',
  'apple-upload',
  'image-proxy',
  'openai-proxy',
  'incubate-image',
  'identify-part-at-click',
  'profile-image-analyst',
  'seed-certifications',
  'process-vin'
];

function isExperimental(name) {
  return EXPERIMENTAL_PATTERNS.some(pattern => pattern.test(name));
}

function categorizeFunction(name) {
  if (FRONTEND_FUNCTIONS.has(name)) {
    return 'frontend';
  }
  if (SCHEDULED_FUNCTIONS.has(name)) {
    return 'scheduled';
  }
  if (isExperimental(name)) {
    return 'experimental';
  }
  if (DEPRECATED_FUNCTIONS.has(name)) {
    return 'deprecated';
  }
  if (ONE_OFF_SCRAPERS.includes(name)) {
    return 'one_off_scraper';
  }
  if (ADMIN_ONE_OFFS.includes(name)) {
    return 'admin_one_off';
  }
  if (RESEARCH_FUNCTIONS.includes(name)) {
    return 'research';
  }
  // Check if it's likely an internal/processing function
  if (name.startsWith('process-') || 
      name.startsWith('batch-') || 
      name.startsWith('backfill-') ||
      name.startsWith('normalize-') ||
      name.startsWith('extract-') ||
      name.startsWith('parse-') ||
      name.startsWith('analyze-') ||
      name.startsWith('generate-') ||
      name.startsWith('sync-') ||
      name.startsWith('import-') ||
      name.startsWith('index-') ||
      name.startsWith('scrape-') ||
      name.startsWith('monitor-') ||
      name.startsWith('discover-') ||
      name.startsWith('auto-') ||
      name.startsWith('detect-') ||
      name.startsWith('link-') ||
      name.startsWith('merge-') ||
      name.startsWith('calculate-') ||
      name.startsWith('set-') ||
      name.startsWith('reprocess-') ||
      name.startsWith('scan-') ||
      name.startsWith('intelligent-') ||
      name.startsWith('detailed-') ||
      name.startsWith('photo-') ||
      name.startsWith('bulk-') ||
      name.startsWith('smart-') ||
      name.startsWith('estimate-') ||
      name.startsWith('recommend-') ||
      name.startsWith('parts-') ||
      name.startsWith('vehicle-') ||
      name.startsWith('query-') ||
      name.startsWith('search-') ||
      name.startsWith('crawl-') ||
      name.startsWith('fetch-') ||
      name.startsWith('execute-') ||
      name.startsWith('place-') ||
      name.startsWith('create-') ||
      name.startsWith('send-') ||
      name.startsWith('get-') ||
      name.startsWith('upsert-') ||
      name.startsWith('enqueue-') ||
      name.startsWith('repair-') ||
      name.startsWith('enrich-') ||
      name.startsWith('catalog-') ||
      name.startsWith('service-') ||
      name.startsWith('unified-') ||
      name.startsWith('autonomous-') ||
      name.startsWith('ai-') ||
      name.startsWith('scheduled-') ||
      name.startsWith('tier1-') ||
      name.startsWith('audit-') ||
      name.startsWith('check-') ||
      name.startsWith('system-') ||
      name.startsWith('project-') ||
      name.startsWith('go-') ||
      name.startsWith('micro-') ||
      name.startsWith('test-') ||
      name.startsWith('quick-') ||
      name.startsWith('mailbox') ||
      name.startsWith('live-') ||
      name.startsWith('phone-') ||
      name.startsWith('apple-') ||
      name.startsWith('image-') ||
      name.startsWith('openai-') ||
      name.startsWith('incubate-') ||
      name.startsWith('identify-') ||
      name.startsWith('profile-') ||
      name.startsWith('seed-') ||
      name.startsWith('decode-') ||
      name.startsWith('centraldispatch-') ||
      name.startsWith('stripe-') ||
      name.startsWith('trickle-') ||
      name.startsWith('retry-') ||
      name.startsWith('admin-') ||
      name.startsWith('holley-')) {
    return 'internal';
  }
  return 'unknown';
}

async function getAllFunctions() {
  try {
    // Get from MCP or use known list
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
      'send-invite-email', 'scrape-listing', 'quick-endpoint', 'analyze-vehicle-tags',
      'extract-training-data', 'optimize-rekognition-training', 'receipt-llm-validate',
      'auto-analyze-upload', 'ai-agent-supervisor', 'extract-title-data',
      'openai-proxy', 'research-spec', 'create-checkout', 'image-proxy',
      'scrape-lmc-truck', 'parse-lmc-complete-catalog', 'auto-quality-inspector',
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
      'create-api-access-checkout', 'test-gemini', 'extract-image',
      'execute-auto-buy', 'monitor-price-drops', 'monitor-bat-seller',
      'extract-and-route-data', 'extract-vehicle-data-ai', 'scrape-craigslist-search',
      'scrape-all-craigslist-squarebodies', 'import-classiccars-listing',
      'backfill-craigslist-images', 'normalize-craigslist-vehicles', 'normalize-all-vehicles',
      'batch-analyze-images', 'batch-analyze-all-images', 'process-all-images-cron',
      'validate-bat-image', 'research-agent', 'discover-cl-squarebodies',
      'process-cl-queue', 'check-scraper-health', 'process-backfill-queue',
      'scrape-multi-source', 'process-import-queue', 'backfill-images',
      'index-reference-document', 'process-catalog-queue', 'system-stats',
      'extract-auction-comments', 'analyze-auction-comments', 'generate-auction-receipt',
      'decode-vin', 'extract-manual-pages', 'index-reference-pages',
      'process-content-extraction', 'service-orchestrator', 'scrape-lmc-parts',
      'analyze-batch-contextual', 'auto-fix-vehicle-profile', 'decode-vin-and-update',
      'recommend-parts-for-vehicle', 'analyze-bundle', 'detect-before-after',
      'index-service-manual', 'scrape-prowire-catalog', 'scrape-motec-catalog',
      'generate-wiring-quote', 'query-wiring-needs', 'tier1-batch-runner',
      'search-bat-listings', 'audit-tier1', 'simple-scraper',
      'scrape-vehicle-with-firecrawl', 'mailbox', 'comprehensive-bat-extraction',
      'retry-image-backfill', 'ai-proofread-pending', 'index-classic-com-dealer',
      'catalog-dealer-site-structure', 'extract-using-catalog', 'holley-discover-urls',
      'scrape-holley-product', 'index-lartdelautomobile', 'monitor-bhcc-sales',
      'process-import-queue-fast', 'repair-bhcc-vehicles', 'discover-classic-sellers',
      'process-inventory-sync-queue', 'backfill-org-primary-images', 'upsert-bat-local-partners',
      'process-classic-seller-queue', 'enqueue-bat-local-partner-inventory', 'admin-backfill-origin-images',
      'go-grinder', 'import-classic-auction', 'backfill-origin-vehicle-images',
      'extract-vin-from-vehicle', 'create-notification', 'backfill-bat-vins',
      'backfill-listing-metadata', 'admin-backfill-bat-missing-images', 'normalize-org-vehicle-relationships',
      'bat-dom-map-health-runner', 'auth-site-mapper', 'auto-site-mapper',
      'autonomous-extraction-agent', 'tool-benchmark-validator', 'extract-premium-auction',
      'cleanup-bat-image-contamination', 'bat-make-profiles-correct-runner', 'process-bat-extraction-queue',
      'sync-service-key-to-db', 'bat-scraper', 'activate-pending-vehicles',
      're-extract-pending-vehicles', 'extract-bat-profile-vehicles', 'sync-instagram-organization',
      'detect-vehicles-in-content', 'backfill-instagram-content', 'test-bat-firecrawl',
      'micro-scrape-bandaid', 'scrape-all-craigslist-2000-and-older', 'extract-organization-from-seller',
      'scrape-organization-site', 'index-2002ad-parts', 'scrape-sbxcars',
      'discover-sbxcars-listings', 'monitor-sbxcars-listings', 'inspect-scrape-coverage',
      'discover-speed-digital-clients', 'sync-cars-and-bids-listing', 'enrich-speed-digital-clients',
      'discover-speed-digital-clients-v2', 'scrape-collective-auto-sold', 'sync-active-auctions',
      'discover-organization-full', 'extract-all-orgs-inventory', 'trickle-backfill-images'
    ];
    
    return knownFunctions;
  } catch (error) {
    console.error('Error fetching functions:', error);
    return [];
  }
}

async function main() {
  console.log('🔍 Analyzing Edge Functions for Cleanup');
  console.log('='.repeat(70));
  
  const functions = await getAllFunctions();
  console.log(`Found ${functions.length} functions to analyze\n`);
  
  const categorized = {
    frontend: [],
    scheduled: [],
    internal: [],
    one_off_scraper: [],
    admin_one_off: [],
    research: [],
    experimental: [],
    deprecated: [],
    unknown: []
  };
  
  functions.forEach(name => {
    const category = categorizeFunction(name);
    categorized[category].push(name);
  });
  
  // Identify candidates for deletion
  const candidatesForDeletion = [
    ...categorized.experimental,
    ...categorized.research.filter(f => !FRONTEND_FUNCTIONS.has(f)),
    ...categorized.admin_one_off.filter(f => !FRONTEND_FUNCTIONS.has(f) && !SCHEDULED_FUNCTIONS.has(f)),
    ...categorized.one_off_scraper.filter(f => !FRONTEND_FUNCTIONS.has(f)),
    ...categorized.unknown.filter(f => !isExperimental(f))
  ];
  
  console.log('📊 CATEGORIZATION');
  console.log('='.repeat(70));
  console.log(`Frontend-called: ${categorized.frontend.length}`);
  console.log(`Scheduled/Cron: ${categorized.scheduled.length}`);
  console.log(`Internal/Processing: ${categorized.internal.length}`);
  console.log(`One-off Scrapers: ${categorized.one_off_scraper.length}`);
  console.log(`Admin One-offs: ${categorized.admin_one_off.length}`);
  console.log(`Research/Experimental: ${categorized.research.length}`);
  console.log(`Experimental (by name): ${categorized.experimental.length}`);
  console.log(`Unknown: ${categorized.unknown.length}`);
  console.log(`\n🎯 CANDIDATES FOR DELETION: ${candidatesForDeletion.length}`);
  
  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    total_functions: functions.length,
    categorization: categorized,
    candidates_for_deletion: candidatesForDeletion,
    keep_functions: {
      frontend: categorized.frontend,
      scheduled: categorized.scheduled,
      internal_keep: categorized.internal.filter(f => 
        !candidatesForDeletion.includes(f)
      )
    }
  };
  
  const reportDir = path.join(__dirname, '../test-results/edge-functions');
  await fs.mkdir(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, 'cleanup-analysis.json');
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  
  console.log(`\n💾 Full report saved to: ${reportFile}`);
  
  // Show top candidates
  console.log('\n' + '='.repeat(70));
  console.log('🗑️  TOP CANDIDATES FOR DELETION');
  console.log('='.repeat(70));
  candidatesForDeletion.slice(0, 30).forEach((name, i) => {
    const cat = categorizeFunction(name);
    console.log(`${i + 1}. ${name} (${cat})`);
  });
  if (candidatesForDeletion.length > 30) {
    console.log(`\n... and ${candidatesForDeletion.length - 30} more`);
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ KEEP THESE (Frontend/Scheduled)');
  console.log('='.repeat(70));
  const keep = [...categorized.frontend, ...categorized.scheduled];
  keep.slice(0, 20).forEach(name => console.log(`  ✓ ${name}`));
  if (keep.length > 20) {
    console.log(`  ... and ${keep.length - 20} more`);
  }
}

main().catch(console.error);


