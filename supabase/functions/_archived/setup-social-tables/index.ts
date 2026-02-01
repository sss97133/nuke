/**
 * Setup Social Tables
 *
 * One-time setup function to create tables for the social monitoring system.
 * Run once after deployment.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create tables using raw SQL via rpc
    const tables = [];

    // Check if social_posts has engagement_metrics
    try {
      const { error } = await supabase
        .from('social_posts')
        .select('engagement_metrics')
        .limit(1);

      if (error && error.message.includes('does not exist')) {
        // Column doesn't exist, but we can't alter via RPC easily
        tables.push('social_posts.engagement_metrics needs to be added manually');
      }
    } catch (e) {
      tables.push('social_posts check failed');
    }

    // Test inserts to see which tables exist
    const testUserId = '00000000-0000-0000-0000-000000000000';

    // Test social_opportunities
    const { error: oppError } = await supabase
      .from('social_opportunities')
      .select('id')
      .limit(1);

    if (oppError) {
      tables.push({ table: 'social_opportunities', exists: false, error: oppError.message });
    } else {
      tables.push({ table: 'social_opportunities', exists: true });
    }

    // Test social_alerts
    const { error: alertError } = await supabase
      .from('social_alerts')
      .select('id')
      .limit(1);

    if (alertError) {
      tables.push({ table: 'social_alerts', exists: false, error: alertError.message });
    } else {
      tables.push({ table: 'social_alerts', exists: true });
    }

    // Test social_posts
    const { error: postsError } = await supabase
      .from('social_posts')
      .select('id')
      .limit(1);

    if (postsError) {
      tables.push({ table: 'social_posts', exists: false, error: postsError.message });
    } else {
      tables.push({ table: 'social_posts', exists: true });
    }

    // Test external_identities (should exist)
    const { error: identError } = await supabase
      .from('external_identities')
      .select('id')
      .limit(1);

    if (identError) {
      tables.push({ table: 'external_identities', exists: false, error: identError.message });
    } else {
      tables.push({ table: 'external_identities', exists: true });
    }

    return new Response(
      JSON.stringify({
        message: 'Table check complete',
        tables,
        sql_to_run: `
-- Run this in Supabase SQL Editor if tables don't exist:

CREATE TABLE IF NOT EXISTS social_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'x',
  opportunity_type TEXT NOT NULL,
  tweet_id TEXT,
  content TEXT NOT NULL,
  source_account TEXT,
  engagement_metrics JSONB DEFAULT '{}',
  relevance_score REAL DEFAULT 0.5,
  suggested_action TEXT,
  urgency TEXT DEFAULT 'soon',
  status TEXT DEFAULT 'new',
  acted_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'x',
  alert_type TEXT NOT NULL,
  tweet_id TEXT,
  message TEXT NOT NULL,
  engagement_snapshot JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add engagement_metrics to social_posts if it doesn't exist
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS engagement_metrics JSONB DEFAULT '{}';
        `
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[setup-social-tables] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
