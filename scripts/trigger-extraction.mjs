#!/usr/bin/env node
/**
 * Trigger extract-all-orgs-inventory Edge Function
 * Uses Supabase client to invoke the function
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env files
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  console.error('Get it from: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api');
  console.error('');
  console.error('Then either:');
  console.error('  1. Set as env var: export SUPABASE_SERVICE_ROLE_KEY="your-key"');
  console.error('  2. Add to .env file: SUPABASE_SERVICE_ROLE_KEY=your-key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const limit = parseInt(process.argv[2] || '10', 10);
const offset = parseInt(process.argv[3] || '0', 10);

console.log('🚀 Invoking extract-all-orgs-inventory');
console.log(`   Limit: ${limit}`);
console.log(`   Offset: ${offset}`);
console.log('');

try {
  const { data, error } = await supabase.functions.invoke('extract-all-orgs-inventory', {
    body: {
      limit,
      offset,
      min_vehicle_threshold: 1,
      dry_run: false,
    },
  });

  if (error) {
    console.error('❌ Error:', error.message);
    if (error.context) {
      console.error('Context:', JSON.stringify(error.context, null, 2));
    }
    // Try to get more details
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit,
          offset,
          min_vehicle_threshold: 1,
          dry_run: false,
        }),
      });
      const text = await response.text();
      console.error('Response status:', response.status);
      console.error('Response body:', text);
    } catch (e) {
      console.error('Could not fetch details:', e.message);
    }
    process.exit(1);
  }

  console.log('✅ Success!');
  console.log('');
  console.log(JSON.stringify(data, null, 2));

  if (data.has_more) {
    console.log('');
    console.log('Next batch:');
    console.log(`  node scripts/trigger-extraction.mjs ${limit} ${data.next_offset}`);
  }
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}

