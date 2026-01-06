/**
 * Smart Extraction Router
 * Routes extraction requests to the best extractor based on URL patterns
 * Fixes data quality by using comprehensive extractors instead of basic ones
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractionRequest {
  url: string;
  vehicle_id?: string;
  source?: string;
  fallback_basic?: boolean;
}

function determineOptimalExtractor(url: string): {
  functionName: string;
  reason: string;
  expectedDataQuality: 'high' | 'medium' | 'low';
} {
  const urlLower = url.toLowerCase();

  // BaT - Use comprehensive extractor for full specs
  if (urlLower.includes('bringatrailer.com')) {
    return {
      functionName: 'comprehensive-bat-extraction',
      reason: 'BaT listing detected - using comprehensive extractor for VIN/engine/transmission/specs',
      expectedDataQuality: 'high'
    };
  }

  // Cars & Bids - Use premium auction extractor
  if (urlLower.includes('carsandbids.com')) {
    return {
      functionName: 'extract-premium-auction',
      reason: 'Cars & Bids auction detected - using premium auction extractor',
      expectedDataQuality: 'high'
    };
  }

  // Mecum - Use premium auction extractor
  if (urlLower.includes('mecum.com')) {
    return {
      functionName: 'extract-premium-auction',
      reason: 'Mecum auction detected - using premium auction extractor',
      expectedDataQuality: 'high'
    };
  }

  // Barrett-Jackson - Use premium auction extractor
  if (urlLower.includes('barrett-jackson.com')) {
    return {
      functionName: 'extract-premium-auction',
      reason: 'Barrett-Jackson auction detected - using premium auction extractor',
      expectedDataQuality: 'high'
    };
  }

  // Classic.com dealer sites - Use AI extractor for structured data
  if (urlLower.includes('classic.com') ||
      urlLower.includes('classiccars.com') ||
      urlLower.includes('autohunter.com')) {
    return {
      functionName: 'extract-vehicle-data-ai',
      reason: 'Classic car marketplace detected - using AI extractor for structured data',
      expectedDataQuality: 'medium'
    };
  }

  // Known dealer platforms that need AI extraction
  const dealerPlatforms = [
    'classiccars.com',
    'hemmings.com',
    'gatewayclassiccars.com',
    'fastlanecars.com',
    'classics.autotrader.com',
    'classictrader.com'
  ];

  if (dealerPlatforms.some(platform => urlLower.includes(platform))) {
    return {
      functionName: 'extract-vehicle-data-ai',
      reason: 'Known dealer platform detected - using AI extractor for comprehensive data',
      expectedDataQuality: 'medium'
    };
  }

  // Unknown sources - Use AI for best coverage
  return {
    functionName: 'extract-vehicle-data-ai',
    reason: 'Unknown source - using AI extractor for maximum compatibility',
    expectedDataQuality: 'medium'
  };
}

function shouldSkipImageOnlyExtraction(url: string): boolean {
  const urlLower = url.toLowerCase();

  // Skip basic image extraction for auction sites that have comprehensive extractors
  return urlLower.includes('bringatrailer.com') ||
         urlLower.includes('carsandbids.com') ||
         urlLower.includes('mecum.com') ||
         urlLower.includes('barrett-jackson.com');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ExtractionRequest = await req.json();
    const { url, vehicle_id, source, fallback_basic } = body;

    if (!url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'URL is required'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Determine optimal extraction strategy
    const strategy = determineOptimalExtractor(url);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Prepare extraction payload
    const extractionPayload: any = { url };
    if (vehicle_id) extractionPayload.vehicle_id = vehicle_id;
    if (source) extractionPayload.source = source;

    console.log(`🎯 Smart router: ${url} → ${strategy.functionName} (${strategy.reason})`);

    // Call the optimal extractor
    const { data, error } = await supabase.functions.invoke(strategy.functionName, {
      body: extractionPayload
    });

    if (error) {
      // If comprehensive extraction fails and fallback is allowed, try AI extractor
      if (strategy.functionName !== 'extract-vehicle-data-ai' && fallback_basic) {
        console.warn(`⚠️ ${strategy.functionName} failed, falling back to AI extractor: ${error.message}`);

        const fallbackResult = await supabase.functions.invoke('extract-vehicle-data-ai', {
          body: extractionPayload
        });

        if (fallbackResult.error) {
          throw new Error(`Both ${strategy.functionName} and AI extractor failed: ${fallbackResult.error.message}`);
        }

        return new Response(
          JSON.stringify({
            success: true,
            data: fallbackResult.data,
            extraction_method: 'extract-vehicle-data-ai',
            fallback_used: true,
            original_error: error.message,
            data_quality_expected: 'medium'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw error;
    }

    // Success response
    return new Response(
      JSON.stringify({
        success: true,
        data,
        extraction_method: strategy.functionName,
        strategy_reason: strategy.reason,
        data_quality_expected: strategy.expectedDataQuality,
        should_skip_basic_extraction: shouldSkipImageOnlyExtraction(url)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Smart extraction router error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown extraction error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});