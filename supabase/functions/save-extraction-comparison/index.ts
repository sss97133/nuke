/**
 * Save Extraction Comparison
 *
 * Accepts comparison data and saves to extraction_comparisons table.
 * Creates table if it doesn't exist.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Create table SQL
const CREATE_TABLE_SQL = `
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
  full_result JSONB,
  UNIQUE(url, timestamp)
);
`;

let tableCreated = false;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Handle create-table action
    const url = new URL(req.url);
    if (url.searchParams.get('action') === 'create-table') {
      // Use pg to create table
      const pgUrl = Deno.env.get('SUPABASE_DB_URL');
      if (pgUrl) {
        // Can't use pg directly in edge functions, return SQL for manual execution
        return new Response(
          JSON.stringify({ sql: CREATE_TABLE_SQL, message: 'Run this SQL in Supabase Dashboard' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const body = await req.json();

    // Handle batch insert
    if (Array.isArray(body.comparisons)) {
      const records = body.comparisons.map((c: any) => ({
        url: c.url,
        domain: c.domain,
        timestamp: c.timestamp,
        free_success: c.naive_success,
        free_quality: c.naive_score / 100,
        free_time_ms: c.results?.find((r: any) => r.method === 'naive_fetch')?.timing_ms || 0,
        free_methods_attempted: ['naive_fetch'],
        paid_success: c.playwright_success,
        paid_quality: c.playwright_score / 100,
        paid_time_ms: c.results?.find((r: any) => r.method === 'playwright')?.timing_ms || 0,
        paid_methods_attempted: ['playwright'],
        quality_delta: c.score_delta / 100,
        best_method: c.playwright_score >= c.naive_score ? 'playwright' : 'naive_fetch',
        best_quality: Math.max(c.naive_score, c.playwright_score) / 100,
        difficulty: c.difficulty,
        full_result: c,
      }));

      const { data, error } = await supabase
        .from('extraction_comparisons')
        .upsert(records, { onConflict: 'url,timestamp' })
        .select();

      if (error) {
        // Table might not exist, try to create it
        if (error.code === '42P01') {
          return new Response(
            JSON.stringify({ error: 'Table does not exist. Run migration first.', code: error.code }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        throw error;
      }

      return new Response(
        JSON.stringify({ success: true, saved: data?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle single insert
    const c = body;
    const record = {
      url: c.url,
      domain: c.domain,
      timestamp: c.timestamp,
      free_success: c.naive_success,
      free_quality: c.naive_score / 100,
      free_time_ms: c.results?.find((r: any) => r.method === 'naive_fetch')?.timing_ms || 0,
      free_methods_attempted: ['naive_fetch'],
      paid_success: c.playwright_success,
      paid_quality: c.playwright_score / 100,
      paid_time_ms: c.results?.find((r: any) => r.method === 'playwright')?.timing_ms || 0,
      paid_methods_attempted: ['playwright'],
      quality_delta: c.score_delta / 100,
      best_method: c.playwright_score >= c.naive_score ? 'playwright' : 'naive_fetch',
      best_quality: Math.max(c.naive_score, c.playwright_score) / 100,
      difficulty: c.difficulty,
      full_result: c,
    };

    const { data, error } = await supabase
      .from('extraction_comparisons')
      .upsert(record, { onConflict: 'url,timestamp' })
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, id: data?.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
