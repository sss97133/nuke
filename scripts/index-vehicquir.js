#!/usr/bin/env node

/**
 * Index VehicQuir (or any sitemap-based source) into import_queue.
 *
 * What it does:
 * - Calls the Supabase Edge Function `index-vehicquir`
 * - That function discovers listing URLs via robots.txt + sitemap(s)
 * - Queues listing URLs into `import_queue` (dedupe via listing_url)
 *
 * Usage:
 *   node scripts/index-vehicquir.js
 *   node scripts/index-vehicquir.js https://vehicquir.com
 *   node scripts/index-vehicquir.js https://vehicquir.com --max 5000
 *   node scripts/index-vehicquir.js https://vehicquir.com --sitemap https://vehicquir.com/sitemap.xml
 *
 * Optional:
 *   --org <uuid>      Tag raw_data.organization_id for downstream linking
 *   --include <regex> (repeatable) Include URL regex filter
 *   --exclude <regex> (repeatable) Exclude URL regex filter
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env from common locations (mirrors other scripts in this repo)
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
];
for (const p of possiblePaths) {
  try {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  } catch {
    // ignore
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('Missing Supabase key (service role preferred).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

function readRepeatable(flag) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const baseUrl = args[0] || 'https://vehicquir.com';

  const max = parseInt(readArg('--max') || '', 10);
  const sitemap = readArg('--sitemap');
  const org = readArg('--org');
  const include = readRepeatable('--include');
  const exclude = readRepeatable('--exclude');

  console.log(`Indexing: ${baseUrl}`);

  const { data, error } = await supabase.functions.invoke('index-vehicquir', {
    body: {
      base_url: baseUrl,
      sitemap_url: sitemap || undefined,
      organization_id: org || undefined,
      max_urls: Number.isFinite(max) ? max : undefined,
      include_patterns: include.length ? include : undefined,
      exclude_patterns: exclude.length ? exclude : undefined,
      source_type: 'marketplace',
    },
  });

  if (error) {
    console.error('Edge function error:', JSON.stringify(error, null, 2));
    process.exit(1);
  }
  if (!data?.success) {
    console.error('Index failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('OK');
  console.log(`Base URL: ${data.base_url}`);
  console.log(`Source ID: ${data.source_id}`);
  console.log(`Queued: ${data.queued}`);
  if (Array.isArray(data.queued_sample) && data.queued_sample.length) {
    console.log('Sample queued URLs:');
    data.queued_sample.slice(0, 10).forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

