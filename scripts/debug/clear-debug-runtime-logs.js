#!/usr/bin/env node
/**
 * Clear production-safe debug logs written to public.debug_runtime_logs.
 *
 * Usage:
 *   node scripts/debug/clear-debug-runtime-logs.js
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

// Delete everything (service role only table)
const { error } = await supabase.from('debug_runtime_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
if (error) {
  console.error('Failed to clear logs:', error.message);
  process.exit(1);
}

console.log('Cleared debug_runtime_logs');


