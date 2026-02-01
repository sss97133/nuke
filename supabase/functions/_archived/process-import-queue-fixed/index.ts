/**
 * PROCESS IMPORT QUEUE - FIXED VERSION
 *
 * This is a simplified, working version of process-import-queue that fixes the boot error.
 * Removes problematic dependencies and focuses on core functionality.
 *
 * Boot error fixes:
 * - Removed complex DOM parsing dependencies that cause import issues
 * - Simplified to use basic HTTP fetch instead of heavy DOM manipulation
 * - Added proper error handling for missing dependencies
 * - Uses unified orchestrator patterns for better reliability
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessRequest {
  batch_size?: number;
  priority_only?: boolean;
  source_id?: string;
  fast_mode?: boolean;
  max_images_immediate?: number;
  skip_image_upload?: boolean;
}

interface ImportQueueItem {
  id: string;
  listing_url: string;
  source_id?: string;
  listing_title?: string;
  listing_price?: number;
  listing_year?: number;
  listing_make?: string;
  listing_model?: string;
  thumbnail_url?: string;
  raw_data?: any;
}

// Simple URL validation without complex parsing
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
}

// Extract basic listing info without heavy DOM parsing
function extractBasicListingInfo(html: string, url: string): any {
  const data: any = { url };

  try {
    // Simple regex-based extraction (safer than DOM parsing)
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) {
      data.title = titleMatch[1].trim().slice(0, 200);
    }

    // Look for price patterns
    const priceMatch = html.match(/\$[\d,]+/);
    if (priceMatch) {
      const priceStr = priceMatch[0].replace(/[$,]/g, '');
      const price = parseInt(priceStr);
      if (!isNaN(price) && price > 0 && price < 10000000) {
        data.price = price;
      }
    }

    // Look for year patterns
    const yearMatch = html.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[0]);
      if (year >= 1900 && year <= new Date().getFullYear() + 1) {
        data.year = year;
      }
    }

    return data;
  } catch (error) {
    console.warn('Failed to extract listing info:', error);
    return data;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🔄 Process Import Queue (Fixed) starting...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: ProcessRequest = await req.json().catch(() => ({}));
    const {
      batch_size = 20, // Reduced for stability
      priority_only = false,
      source_id,
      fast_mode = true, // Default to fast mode to avoid heavy operations
      skip_image_upload = true, // Skip images by default to avoid dependencies
    } = body;

    console.log(`Processing batch: size=${batch_size}, priority_only=${priority_only}, fast_mode=${fast_mode}`);

    // Claim work atomically using the RPC function
    const workerId = `process-import-queue-fixed:${crypto.randomUUID?.() || Date.now()}`;
    const { data: queueItems, error: queueError } = await supabase.rpc('claim_import_queue_batch', {
      p_batch_size: batch_size,
      p_max_attempts: 3,
      p_priority_only: priority_only,
      p_source_id: source_id || null,
      p_worker_id: workerId,
      p_lock_ttl_seconds: 600
    });

    if (queueError) {
      console.error('❌ Failed to claim import queue batch:', queueError);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to claim batch: ${queueError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('✅ No items to process');
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          message: 'No items in queue'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Processing ${queueItems.length} items`);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const results = [];

    for (const item of queueItems as ImportQueueItem[]) {
      try {
        console.log(`🔍 Processing: ${item.listing_url}`);

        if (!isValidUrl(item.listing_url)) {
          throw new Error('Invalid URL format');
        }

        // Fetch the listing page with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const response = await fetch(item.listing_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();
        const listingData = extractBasicListingInfo(html, item.listing_url);

        // Create vehicle record
        const { data: vehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert({
            listing_url: item.listing_url,
            source_id: item.source_id,
            title: listingData.title || item.listing_title,
            price: listingData.price || item.listing_price,
            year: listingData.year || item.listing_year,
            make: item.listing_make,
            model: item.listing_model,
            listing_source: new URL(item.listing_url).hostname,
            raw_data: { ...listingData, import_queue_id: item.id },
            data_source: 'import_queue_fixed',
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (vehicleError) {
          throw new Error(`Failed to create vehicle: ${vehicleError.message}`);
        }

        // Mark as complete
        await supabase
          .from('import_queue')
          .update({
            status: 'complete',
            vehicle_id: vehicle.id,
            processed_at: new Date().toISOString(),
            error_message: null
          })
          .eq('id', item.id);

        console.log(`✅ Created vehicle ${vehicle.id} for ${item.listing_url}`);
        succeeded++;
        results.push({ id: item.id, status: 'success', vehicle_id: vehicle.id });

      } catch (error: any) {
        console.error(`❌ Failed to process ${item.listing_url}:`, error.message);

        // Mark as failed
        await supabase
          .from('import_queue')
          .update({
            status: 'failed',
            error_message: error.message,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id);

        failed++;
        results.push({ id: item.id, status: 'failed', error: error.message });
      }

      processed++;
    }

    console.log(`🎯 Batch complete: ${succeeded} succeeded, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        succeeded,
        failed,
        worker_id: workerId,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Process Import Queue error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});