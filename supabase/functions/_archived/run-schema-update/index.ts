/**
 * Run Schema Update
 * Applies the market intelligence schema improvements
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // Use postgres connection directly
    const { Client } = await import("https://deno.land/x/postgres@v0.17.0/mod.ts");

    const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DATABASE_URL") ?? "";

    if (!dbUrl) {
      // Fallback: try to construct from SUPABASE_URL
      const projectRef = supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
      if (!projectRef) throw new Error("Cannot determine database URL");

      // For now, just create tables via REST API with supabase-js
      const supabase = createClient(supabaseUrl, serviceKey, {
        db: { schema: 'public' }
      });

      // Check if tables exist
      const { data: tables } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .in('table_name', ['ownership_history', 'service_records', 'vehicle_history_reports', 'price_comparables', 'market_segment_stats']);

      const existingTables = new Set((tables || []).map((t: any) => t.table_name));

      return new Response(JSON.stringify({
        success: true,
        message: "Schema check complete",
        existing_tables: Array.from(existingTables),
        note: "Direct DDL execution requires database connection string. Tables should be created via Supabase dashboard or migration."
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const client = new Client(dbUrl);
    await client.connect();

    const results: string[] = [];

    // Create ownership_history table
    await client.queryObject(`
      CREATE TABLE IF NOT EXISTS ownership_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        owner_number INTEGER,
        acquired_date DATE,
        sold_date DATE,
        location TEXT,
        purchase_price NUMERIC,
        sale_price NUMERIC,
        ownership_type TEXT,
        notes TEXT,
        source TEXT,
        confidence_score NUMERIC DEFAULT 0.5,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push("ownership_history created");

    // Create service_records table
    await client.queryObject(`
      CREATE TABLE IF NOT EXISTS service_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        service_date DATE,
        mileage INTEGER,
        shop_name TEXT,
        shop_location TEXT,
        work_performed TEXT,
        cost NUMERIC,
        parts_replaced TEXT[],
        service_type TEXT,
        documentation_available BOOLEAN DEFAULT FALSE,
        source TEXT,
        confidence_score NUMERIC DEFAULT 0.5,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push("service_records created");

    // Create vehicle_history_reports table
    await client.queryObject(`
      CREATE TABLE IF NOT EXISTS vehicle_history_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        vin TEXT,
        report_provider TEXT,
        report_date DATE,
        title_history JSONB,
        accident_history JSONB,
        odometer_readings JSONB,
        ownership_count INTEGER,
        last_reported_mileage INTEGER,
        branded_title BOOLEAN DEFAULT FALSE,
        brand_type TEXT,
        raw_report JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push("vehicle_history_reports created");

    // Create price_comparables table
    await client.queryObject(`
      CREATE TABLE IF NOT EXISTS price_comparables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
        comparable_vehicle_id UUID REFERENCES vehicles(id),
        similarity_score NUMERIC,
        similarity_factors JSONB,
        price_delta NUMERIC,
        price_delta_percent NUMERIC,
        sale_date_delta INTEGER,
        condition_delta TEXT,
        calculated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push("price_comparables created");

    // Create market_segment_stats table
    await client.queryObject(`
      CREATE TABLE IF NOT EXISTS market_segment_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        segment_key TEXT UNIQUE,
        make TEXT,
        model TEXT,
        year_start INTEGER,
        year_end INTEGER,
        avg_sale_price NUMERIC,
        median_sale_price NUMERIC,
        min_sale_price NUMERIC,
        max_sale_price NUMERIC,
        price_std_dev NUMERIC,
        total_sales INTEGER,
        sales_last_30_days INTEGER,
        sales_last_90_days INTEGER,
        sales_last_year INTEGER,
        price_trend_30d NUMERIC,
        price_trend_90d NUMERIC,
        price_trend_1y NUMERIC,
        avg_sentiment_score NUMERIC,
        common_themes TEXT[],
        common_concerns TEXT[],
        data_quality_score NUMERIC,
        sample_size INTEGER,
        last_calculated TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push("market_segment_stats created");

    // Add columns to comment_discoveries
    await client.queryObject(`
      ALTER TABLE comment_discoveries
        ADD COLUMN IF NOT EXISTS data_quality_score NUMERIC,
        ADD COLUMN IF NOT EXISTS missing_data_flags TEXT[],
        ADD COLUMN IF NOT EXISTS recommended_sources TEXT[]
    `);
    results.push("comment_discoveries columns added");

    await client.end();

    return new Response(JSON.stringify({
      success: true,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
