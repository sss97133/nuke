#!/usr/bin/env node

/**
 * Index L'Art de L'Automobile
 * Queues all "for sale" + "sold" vehicles into import_queue and upserts the dealer into businesses.
 *
 * Usage:
 *   node scripts/index-lartdelautomobile.js
 *   node scripts/index-lartdelautomobile.js https://www.lartdelautomobile.com/
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from common locations
let envConfig = {};
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
];

for (const envPath of possiblePaths) {
  try {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (!result.error) envConfig = result.parsed || {};
      break;
    }
  } catch {
    // ignore
  }
}

const SUPABASE_URL =
  envConfig.VITE_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://qkgaybvrernstplzjaam.supabase.co';

const SUPABASE_KEY =
  envConfig.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  envConfig.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  envConfig.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  envConfig.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('Missing Supabase key (service role preferred).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = args[0] || 'https://www.lartdelautomobile.com/';

  console.log('Indexing dealer site:', baseUrl);

  const { data, error } = await supabase.functions.invoke('index-lartdelautomobile', {
    body: {
      base_url: baseUrl,
      max_listings_per_section: 500,
      max_pages_per_section: 10,
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
  console.log(`Organization: ${data.organization_name} (${data.organization_id})`);
  console.log(`Inventory URL: ${data.inventory_url}`);
  console.log(`Sold URL: ${data.sold_url}`);
  console.log(`Queued (inventory): ${data.inventory?.queued || 0} (dupes: ${data.inventory?.duplicates || 0}, pages: ${data.inventory?.pages || 0})`);
  console.log(`Queued (sold): ${data.sold?.queued || 0} (dupes: ${data.sold?.duplicates || 0}, pages: ${data.sold?.pages || 0})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


