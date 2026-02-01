/**
 * Extraction Quality Inspector
 * Analyzes extraction results to validate data quality improvements
 * Compares before/after extraction quality and provides detailed reports
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InspectionRequest {
  inspection_type?: 'sample_extraction' | 'data_quality_audit' | 'image_pollution_check' | 'extraction_comparison';
  sample_size?: number;
  source_filter?: string; // Filter by source (BaT, C&B, etc.)
  test_url?: string; // Single URL to test
  compare_extractors?: boolean; // Compare old vs new extractors
}

interface QualityMetrics {
  total_vehicles: number;
  vin_coverage: number;
  engine_coverage: number;
  transmission_coverage: number;
  mileage_coverage: number;
  description_coverage: number;
  average_images_per_vehicle: number;
  estimated_image_pollution_rate: number;
  data_completeness_score: number; // 0-1
  extraction_accuracy_score: number; // 0-1
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: InspectionRequest = await req.json().catch(() => ({}));
    const {
      inspection_type = 'data_quality_audit',
      sample_size = 50,
      source_filter,
      test_url,
      compare_extractors = false
    } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    console.log(`🔍 Running inspection: ${inspection_type} (sample size: ${sample_size})`);

    let inspectionResult;

    switch (inspection_type) {
      case 'sample_extraction':
        inspectionResult = await runSampleExtraction(supabase, test_url, compare_extractors);
        break;

      case 'data_quality_audit':
        inspectionResult = await runDataQualityAudit(supabase, sample_size, source_filter);
        break;

      case 'image_pollution_check':
        inspectionResult = await runImagePollutionCheck(supabase, sample_size, source_filter);
        break;

      case 'extraction_comparison':
        inspectionResult = await runExtractionComparison(supabase, test_url);
        break;

      default:
        throw new Error(`Unknown inspection type: ${inspection_type}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        inspection_type,
        timestamp: new Date().toISOString(),
        ...inspectionResult
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Inspection error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown inspection error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function runSampleExtraction(supabase: any, testUrl?: string, compareExtractors = false) {
  const url = testUrl || 'https://bringatrailer.com/listing/1985-bmw-m635csi-60/';

  console.log(`🧪 Testing extraction on: ${url}`);

  const results: any = {
    test_url: url,
    extraction_results: {},
    recommendations: []
  };

  try {
    // Test smart router
    console.log('Testing smart-extraction-router...');
    const routerStart = Date.now();
    const { data: routerData, error: routerError } = await supabase.functions.invoke('smart-extraction-router', {
      body: { url, fallback_basic: true }
    });
    const routerTime = Date.now() - routerStart;

    results.extraction_results.smart_router = {
      success: !routerError && routerData?.success,
      error: routerError?.message || (routerData?.success === false ? routerData.error : null),
      response_time_ms: routerTime,
      extraction_method: routerData?.extraction_method,
      data_quality_expected: routerData?.data_quality_expected,
      extracted_fields: routerData?.data ? Object.keys(routerData.data).length : 0
    };

    if (compareExtractors && url.includes('bringatrailer.com')) {
      // ⚠️ DEPRECATED: import-bat-listing is deprecated and returns 410 Gone
      // Skipping comparison with deprecated function
      // Approved workflow is extract-premium-auction + extract-auction-comments
      // See: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
      console.log('⚠️ Skipping comparison - import-bat-listing is deprecated');
      results.extraction_results.old_extractor = {
        success: false,
        error: 'DEPRECATED: import-bat-listing is deprecated',
        response_time_ms: 0,
        extracted_fields: 0,
        note: 'Use extract-premium-auction + extract-auction-comments instead'
      };
    }

    // Analyze extraction quality
    if (routerData?.data) {
      const { data: validationData } = await supabase.functions.invoke('extraction-quality-validator', {
        body: {
          vehicle_data: routerData.data,
          source_type: 'auction',
          validate_images: false // Skip image validation for speed
        }
      });

      if (validationData) {
        results.quality_validation = {
          is_valid: validationData.validation?.is_valid,
          quality_score: validationData.validation?.quality_score,
          completeness_score: validationData.validation?.completeness_score,
          missing_fields: validationData.validation?.missing_fields || [],
          warnings: validationData.validation?.accuracy_warnings || [],
          recommendations: validationData.validation?.recommendations || []
        };
      }
    }

  } catch (error: any) {
    results.error = error.message;
  }

  return results;
}

async function runDataQualityAudit(supabase: any, sampleSize: number, sourceFilter?: string) {
  console.log(`📊 Running data quality audit (sample size: ${sampleSize})`);

  // Build query for sample vehicles
  let query = supabase
    .from('vehicles')
    .select('id, make, model, year, vin, mileage, description, bat_auction_url, source, created_at')
    .not('bat_auction_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(sampleSize);

  if (sourceFilter) {
    if (sourceFilter.toLowerCase() === 'bat') {
      query = query.ilike('bat_auction_url', '%bringatrailer.com%');
    } else {
      query = query.eq('source', sourceFilter);
    }
  }

  const { data: vehicles, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch vehicles: ${error.message}`);
  }

  console.log(`📋 Analyzing ${vehicles.length} vehicles...`);

  // Calculate quality metrics
  const metrics: QualityMetrics = {
    total_vehicles: vehicles.length,
    vin_coverage: vehicles.filter(v => v.vin && v.vin.length === 17).length / vehicles.length,
    engine_coverage: 0, // Would need to add engine field check
    transmission_coverage: 0, // Would need to add transmission field check
    mileage_coverage: vehicles.filter(v => v.mileage && v.mileage > 0).length / vehicles.length,
    description_coverage: vehicles.filter(v => v.description && v.description.length > 100).length / vehicles.length,
    average_images_per_vehicle: 0, // Would need to calculate from vehicle_images
    estimated_image_pollution_rate: 0, // Would need AI analysis
    data_completeness_score: 0,
    extraction_accuracy_score: 0
  };

  // Calculate overall completeness score
  metrics.data_completeness_score = (
    metrics.vin_coverage * 0.3 +
    metrics.mileage_coverage * 0.25 +
    metrics.description_coverage * 0.25 +
    (vehicles.filter(v => v.make && v.model && v.year).length / vehicles.length) * 0.2
  );

  // Get image statistics for sample
  const vehicleIds = vehicles.slice(0, 10).map(v => v.id); // Sample 10 for image analysis
  const { data: imageStats } = await supabase
    .from('vehicle_images')
    .select('vehicle_id, image_url')
    .in('vehicle_id', vehicleIds);

  if (imageStats && imageStats.length > 0) {
    const imagesByVehicle = vehicleIds.map(id =>
      imageStats.filter(img => img.vehicle_id === id).length
    );
    metrics.average_images_per_vehicle = imagesByVehicle.reduce((a, b) => a + b, 0) / imagesByVehicle.length;
  }

  // Categorize vehicles by data quality
  const qualityCategories = {
    excellent: vehicles.filter(v =>
      v.vin && v.vin.length === 17 &&
      v.mileage && v.mileage > 0 &&
      v.description && v.description.length > 200 &&
      v.make && v.model && v.year
    ).length,
    good: vehicles.filter(v =>
      v.make && v.model && v.year &&
      (v.vin || v.mileage || (v.description && v.description.length > 100))
    ).length,
    poor: vehicles.filter(v =>
      !v.vin && !v.mileage && (!v.description || v.description.length < 50)
    ).length
  };

  // Source breakdown
  const sourceBreakdown: { [key: string]: number } = {};
  vehicles.forEach(v => {
    const source = v.source || 'unknown';
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
  });

  return {
    sample_info: {
      total_vehicles: vehicles.length,
      source_filter: sourceFilter,
      date_range: {
        newest: vehicles[0]?.created_at,
        oldest: vehicles[vehicles.length - 1]?.created_at
      }
    },
    quality_metrics: metrics,
    quality_categories: qualityCategories,
    source_breakdown: sourceBreakdown,
    sample_vehicles: vehicles.slice(0, 5).map(v => ({
      id: v.id,
      identity: `${v.year} ${v.make} ${v.model}`,
      vin: v.vin ? `${v.vin.substring(0, 8)}...` : null,
      has_mileage: !!v.mileage,
      description_length: v.description?.length || 0,
      source: v.source
    })),
    recommendations: generateQualityRecommendations(metrics, qualityCategories)
  };
}

async function runImagePollutionCheck(supabase: any, sampleSize: number, sourceFilter?: string) {
  console.log(`🖼️ Running image pollution check (sample size: ${sampleSize})`);

  // Get sample vehicles with images
  let query = supabase
    .from('vehicles')
    .select('id, make, model, year, source')
    .not('bat_auction_url', 'is', null)
    .limit(sampleSize);

  if (sourceFilter) {
    query = query.eq('source', sourceFilter);
  }

  const { data: vehicles, error: vehiclesError } = await query;
  if (vehiclesError) throw new Error(`Failed to fetch vehicles: ${vehiclesError.message}`);

  // Get images for these vehicles
  const vehicleIds = vehicles.map(v => v.id);
  const { data: images, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('vehicle_id, image_url, position')
    .in('vehicle_id', vehicleIds)
    .limit(sampleSize * 5); // Max 5 images per vehicle for analysis

  if (imagesError) throw new Error(`Failed to fetch images: ${imagesError.message}`);

  console.log(`🔍 Analyzing ${images.length} images for pollution...`);

  // Quick URL-based pollution detection
  let urlPollutionCount = 0;
  let validImages = 0;

  images.forEach(img => {
    const url = img.image_url.toLowerCase();
    const isNoise = (
      url.includes('logo') || url.includes('header') || url.includes('footer') ||
      url.includes('nav') || url.includes('menu') || url.includes('social') ||
      url.includes('avatar') || url.includes('profile') || url.includes('user') ||
      /-\d{1,2}x\d{1,2}\./.test(url) || url.includes('icon') ||
      url.includes('placeholder') || url.includes('default.')
    );

    if (isNoise) {
      urlPollutionCount++;
    } else {
      validImages++;
    }
  });

  const pollutionRate = urlPollutionCount / images.length;

  // Sample a few images for AI validation (if budget allows)
  const aiValidationSample = Math.min(5, validImages);
  let aiPollutionCount = 0;

  // Note: Skipping actual AI validation due to OpenAI quota, but structure is ready

  return {
    sample_info: {
      vehicles_analyzed: vehicles.length,
      images_analyzed: images.length,
      avg_images_per_vehicle: images.length / vehicles.length
    },
    pollution_analysis: {
      url_based_pollution: {
        total_images: images.length,
        polluted_images: urlPollutionCount,
        clean_images: validImages,
        pollution_rate: pollutionRate
      },
      ai_validation: {
        sample_size: aiValidationSample,
        note: 'AI validation skipped due to API quota limits'
      }
    },
    pollution_patterns: {
      common_noise_types: [
        'Navigation elements',
        'User profile images',
        'Social media icons',
        'Site logos/branding',
        'UI components'
      ]
    },
    recommendations: [
      pollutionRate > 0.3 ? 'High pollution rate detected - apply enhanced filtering' : 'Pollution rate acceptable',
      'Consider running AI validation on high-value vehicles',
      'Implement real-time pollution filtering during extraction'
    ]
  };
}

async function runExtractionComparison(supabase: any, testUrl?: string) {
  const url = testUrl || 'https://bringatrailer.com/listing/1985-bmw-m635csi-60/';

  console.log(`⚖️ Comparing extraction methods for: ${url}`);

  const results = {
    test_url: url,
    comparison: {
      smart_router: null as any,
      old_method: null as any,
      improvement_analysis: null as any
    }
  };

  // Test smart router (new method)
  try {
    const smartStart = Date.now();
    const { data: smartData, error: smartError } = await supabase.functions.invoke('smart-extraction-router', {
      body: { url }
    });
    const smartTime = Date.now() - smartStart;

    results.comparison.smart_router = {
      success: !smartError && smartData?.success,
      response_time_ms: smartTime,
      extraction_method: smartData?.extraction_method,
      fields_extracted: smartData?.data ? Object.keys(smartData.data).length : 0,
      has_vin: !!smartData?.data?.vin,
      has_engine: !!smartData?.data?.engine,
      has_transmission: !!smartData?.data?.transmission,
      error: smartError?.message
    };
  } catch (error: any) {
    results.comparison.smart_router = { error: error.message };
  }

  // ⚠️ DEPRECATED: import-bat-listing is deprecated - skip comparison
  // Approved workflow is extract-premium-auction + extract-auction-comments
  // See: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
  if (url.includes('bringatrailer.com')) {
    results.comparison.old_method = {
      success: false,
      error: 'DEPRECATED: import-bat-listing is deprecated',
      response_time_ms: 0,
      note: 'Use extract-premium-auction + extract-auction-comments instead'
    };
    
    // NOTE: Old method invocation removed to prevent accidental use of deprecated functions.
  }

  // Analyze improvements
  if (results.comparison.smart_router && results.comparison.old_method) {
    const smart = results.comparison.smart_router;
    const old = results.comparison.old_method;

    results.comparison.improvement_analysis = {
      field_extraction_improvement: smart.fields_extracted - old.fields_extracted,
      new_capabilities: [
        smart.has_vin && !old.has_vin ? 'VIN extraction' : null,
        smart.has_engine && !old.has_engine ? 'Engine specs' : null,
        smart.has_transmission && !old.has_transmission ? 'Transmission data' : null
      ].filter(Boolean),
      reliability_improvement: smart.success && !old.success ? 'More reliable extraction' : null,
      performance_change: smart.response_time_ms - old.response_time_ms
    };
  }

  return results;
}

function generateQualityRecommendations(metrics: QualityMetrics, categories: any): string[] {
  const recommendations = [];

  if (metrics.vin_coverage < 0.8) {
    recommendations.push('VIN coverage below 80% - run backfill script or improve VIN extraction');
  }

  if (metrics.mileage_coverage < 0.6) {
    recommendations.push('Mileage coverage below 60% - check mileage extraction patterns');
  }

  if (metrics.description_coverage < 0.5) {
    recommendations.push('Description coverage below 50% - improve description extraction or filtering');
  }

  if (categories.poor > categories.excellent) {
    recommendations.push('More poor quality than excellent - focus on data quality improvements');
  }

  if (metrics.data_completeness_score < 0.7) {
    recommendations.push('Overall data completeness below 70% - consider using comprehensive extractors');
  }

  return recommendations;
}