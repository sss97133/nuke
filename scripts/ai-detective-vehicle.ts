#!/usr/bin/env node
/**
 * AI Detective — Vehicle Evidence Seeder
 *
 * Gathers known evidence URLs for a vehicle and queues them for
 * content extraction, so timeline events can be derived from sources.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

type Options = {
  vehicleId: string | null;
  userId: string | null;
  dryRun: boolean;
  processQueue: boolean;
  maxUrls: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
    path.resolve(__dirname, '../.env')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
    } catch {
      // ignore
    }
  }
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    vehicleId: null,
    userId: null,
    dryRun: false,
    processQueue: false,
    maxUrls: 150
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vehicle-id' && argv[i + 1]) opts.vehicleId = argv[++i];
    if (a === '--user-id' && argv[i + 1]) opts.userId = argv[++i];
    if (a === '--dry-run') opts.dryRun = true;
    if (a === '--process') opts.processQueue = true;
    if (a === '--max-urls' && argv[i + 1]) opts.maxUrls = Math.max(1, Number(argv[++i]));
  }

  return opts;
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/[),.;]+$/, '');
}

function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s"')\]]+/gi) || [];
  return matches.map(normalizeUrl);
}

function classifyUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube_video';
  if (lower.endsWith('.pdf') || lower.includes('.pdf?') || lower.includes('.pdf#')) return 'document_url';
  if (lower.match(/\.(png|jpg|jpeg|gif|webp)(\?|#|$)/)) return 'image_url';
  return 'listing_url';
}

function collectUrls(value: any, output: Set<string>, depth = 0): void {
  if (depth > 3 || !value) return;
  if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, output, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectUrls(v, output, depth + 1);
    return;
  }
  if (typeof value === 'string') {
    for (const url of extractUrls(value)) output.add(url);
  }
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.vehicleId) {
    console.error('Usage: tsx scripts/ai-detective-vehicle.ts --vehicle-id <uuid> [--user-id <uuid>] [--dry-run] [--process] [--max-urls 150]');
    process.exit(1);
  }

  const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || null;
  const INVOKE_KEY =
    SERVICE_ROLE ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    null;

  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for DB reads');
  if (!INVOKE_KEY) throw new Error('Missing Supabase key to invoke Edge Functions');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, user_id, uploaded_by, discovery_url, listing_url, platform_url, bat_auction_url, import_metadata, origin_metadata')
    .eq('id', opts.vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    throw new Error(`Vehicle not found: ${vehicleError?.message || opts.vehicleId}`);
  }

  const userId = opts.userId || vehicle.user_id || vehicle.uploaded_by || null;
  if (!userId) {
    throw new Error('No user_id available. Provide --user-id to seed the extraction queue.');
  }

  const urls = new Set<string>();
  collectUrls(vehicle.discovery_url, urls);
  collectUrls(vehicle.listing_url, urls);
  collectUrls(vehicle.platform_url, urls);
  collectUrls(vehicle.bat_auction_url, urls);
  collectUrls(vehicle.import_metadata, urls);
  collectUrls(vehicle.origin_metadata, urls);

  const { data: externalListings } = await supabase
    .from('external_listings')
    .select('listing_url, metadata')
    .eq('vehicle_id', vehicle.id)
    .limit(200);
  for (const row of externalListings || []) {
    collectUrls(row?.listing_url, urls);
    collectUrls(row?.metadata, urls);
  }

  const { data: providerListings } = await supabase
    .from('provider_listings')
    .select('listing_url, raw_data')
    .eq('vehicle_id', vehicle.id)
    .limit(200);
  for (const row of providerListings || []) {
    collectUrls(row?.listing_url, urls);
    collectUrls(row?.raw_data, urls);
  }

  const { data: documents } = await supabase
    .from('vehicle_documents')
    .select('file_url, pii_redacted_url, title, description')
    .eq('vehicle_id', vehicle.id)
    .limit(200);
  for (const row of documents || []) {
    collectUrls(row?.file_url, urls);
    collectUrls(row?.pii_redacted_url, urls);
    collectUrls(row?.title, urls);
    collectUrls(row?.description, urls);
  }

  const urlList = Array.from(urls).filter((u) => u.startsWith('http')).slice(0, opts.maxUrls);
  if (urlList.length === 0) {
    console.log('No evidence URLs found for this vehicle.');
    return;
  }

  const rows = urlList.map((url) => ({
    vehicle_id: vehicle.id,
    user_id: userId,
    content_type: classifyUrl(url),
    raw_content: url,
    context: 'ai_detective_seed',
    confidence_score: 0.85,
    detection_method: 'ai_detective'
  }));

  console.log(`AI detective seed: ${rows.length} URL(s) queued for vehicle ${vehicle.id}`);
  if (opts.dryRun) {
    console.log(rows.map((r) => `${r.content_type} → ${r.raw_content}`).join('\n'));
    return;
  }

  const chunkSize = 50;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('content_extraction_queue').insert(chunk);
    if (error) {
      throw new Error(`Failed to insert content_extraction_queue rows: ${error.message}`);
    }
  }

  if (opts.processQueue) {
    const invokeClient = createClient(SUPABASE_URL, INVOKE_KEY);
    const { error } = await invokeClient.functions.invoke('process-content-extraction', {
      body: {}
    });
    if (error) {
      throw new Error(`process-content-extraction failed: ${error.message}`);
    }
    console.log('Triggered process-content-extraction.');
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
