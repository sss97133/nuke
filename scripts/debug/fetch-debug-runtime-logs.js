#!/usr/bin/env node
/**
 * Fetch recent production-safe debug logs written to public.debug_runtime_logs.
 *
 * Usage:
 *   node scripts/debug/fetch-debug-runtime-logs.js [limit]
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const limit = Number(process.argv[2] || 200);
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

const { data, error } = await supabase
  .from('debug_runtime_logs')
  .select('created_at, source, run_id, hypothesis_id, location, message, data')
  .order('created_at', { ascending: false })
  .limit(limit);

if (error) {
  console.error('Failed to fetch logs:', error.message);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));


