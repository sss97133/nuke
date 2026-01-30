#!/usr/bin/env npx tsx
/**
 * Creates the extraction_comparisons table via Supabase
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('Creating extraction_comparisons table...');

  // Try to query the table first to see if it exists
  const { data, error: checkError } = await supabase
    .from('extraction_comparisons')
    .select('id')
    .limit(1);

  if (!checkError) {
    console.log('✓ Table already exists');
    return;
  }

  if (checkError.code === '42P01') {
    // Table doesn't exist - need to create via SQL
    console.log('Table does not exist. Creating via RPC...');

    // Try creating via rpc if available
    const { error: rpcError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS extraction_comparisons (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          url TEXT NOT NULL,
          domain TEXT NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          free_success BOOLEAN DEFAULT FALSE,
          free_quality NUMERIC(4,3),
          free_fields TEXT[],
          free_time_ms INTEGER,
          free_methods_attempted TEXT[],
          paid_success BOOLEAN DEFAULT FALSE,
          paid_quality NUMERIC(4,3),
          paid_fields TEXT[],
          paid_cost NUMERIC(10,4) DEFAULT 0,
          paid_time_ms INTEGER,
          paid_methods_attempted TEXT[],
          quality_delta NUMERIC(4,3),
          additional_fields TEXT[],
          cost_per_field NUMERIC(10,4),
          best_method TEXT,
          best_quality NUMERIC(4,3),
          recommendation TEXT,
          difficulty TEXT,
          full_result JSONB
        );
      `
    });

    if (rpcError) {
      console.log('RPC not available, table needs manual creation.');
      console.log('Run this SQL in Supabase Dashboard > SQL Editor:');
      console.log(`
CREATE TABLE extraction_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  free_success BOOLEAN DEFAULT FALSE,
  free_quality NUMERIC(4,3),
  free_fields TEXT[],
  free_time_ms INTEGER,
  free_methods_attempted TEXT[],
  paid_success BOOLEAN DEFAULT FALSE,
  paid_quality NUMERIC(4,3),
  paid_fields TEXT[],
  paid_cost NUMERIC(10,4) DEFAULT 0,
  paid_time_ms INTEGER,
  paid_methods_attempted TEXT[],
  quality_delta NUMERIC(4,3),
  additional_fields TEXT[],
  cost_per_field NUMERIC(10,4),
  best_method TEXT,
  best_quality NUMERIC(4,3),
  recommendation TEXT,
  difficulty TEXT,
  full_result JSONB
);

ALTER TABLE extraction_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON extraction_comparisons FOR ALL TO service_role USING (true);
CREATE POLICY "anon_read" ON extraction_comparisons FOR SELECT TO anon USING (true);
      `);
    } else {
      console.log('✓ Table created via RPC');
    }
  } else {
    console.error('Unexpected error:', checkError);
  }
}

main().catch(console.error);
