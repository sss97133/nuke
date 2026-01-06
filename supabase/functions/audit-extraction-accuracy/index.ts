/**
 * Audit Extraction Accuracy
 * Compares source page content with extracted database profiles side-by-side
 * for accuracy validation - the only true test of extraction quality
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuditRequest {
  audit_type: 'single_vehicle' | 'batch_sample' | 'source_validation';
  vehicle_id?: string;
  source_url?: string;
  sample_size?: number;
  source_filter?: string; // 'bat', 'mecum', etc.
}

interface AccuracyResult {
  vehicle_id: string;
  source_url: string;
  identity_match: boolean;
  vin_match: boolean;
  engine_match: boolean;
  transmission_match: boolean;
  mileage_match: boolean;
  price_match: boolean;
  description_accuracy: number; // 0-1
  overall_accuracy: number; // 0-1
  discrepancies: string[];
  source_data: any;
  profile_data: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: AuditRequest = await req.json();
    const { audit_type, vehicle_id, source_url, sample_size = 10, source_filter } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    console.log(`🔍 Starting ${audit_type} accuracy audit...`);

    let results;

    switch (audit_type) {
      case 'single_vehicle':
        if (!vehicle_id && !source_url) {
          throw new Error('vehicle_id or source_url required for single vehicle audit');
        }
        results = await auditSingleVehicle(supabase, vehicle_id, source_url);
        break;

      case 'batch_sample':
        results = await auditBatchSample(supabase, sample_size, source_filter);
        break;

      case 'source_validation':
        if (!source_url) {
          throw new Error('source_url required for source validation');
        }
        results = await validateSourceExtraction(supabase, source_url);
        break;

      default:
        throw new Error(`Unknown audit_type: ${audit_type}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        audit_type,
        timestamp: new Date().toISOString(),
        ...results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Accuracy audit error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown audit error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function auditSingleVehicle(
  supabase: any,
  vehicleId?: string,
  sourceUrl?: string
): Promise<any> {

  let vehicle;

  if (vehicleId) {
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();
    vehicle = data;
  } else if (sourceUrl) {
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('source_url', sourceUrl)
      .single();
    vehicle = data;
  }

  if (!vehicle) {
    throw new Error('Vehicle not found');
  }

  const accuracy = await compareSourceWithProfile(supabase, vehicle);

  return {
    vehicle: {
      id: vehicle.id,
      identity: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      source_url: vehicle.source_url
    },
    accuracy_result: accuracy,
    summary: {
      overall_accuracy: accuracy.overall_accuracy,
      major_discrepancies: accuracy.discrepancies.filter(d => d.includes('CRITICAL')).length,
      minor_discrepancies: accuracy.discrepancies.length
    }
  };
}

async function auditBatchSample(
  supabase: any,
  sampleSize: number,
  sourceFilter?: string
): Promise<any> {

  let query = supabase
    .from('vehicles')
    .select('*')
    .not('source_url', 'is', null);

  if (sourceFilter) {
    if (sourceFilter.toLowerCase() === 'bat') {
      query = query.like('source_url', '%bringatrailer.com%');
    } else {
      query = query.like('source_url', `%${sourceFilter}%`);
    }
  }

  const { data: vehicles } = await query
    .order('created_at', { ascending: false })
    .limit(sampleSize);

  if (!vehicles || vehicles.length === 0) {
    throw new Error('No vehicles found for batch audit');
  }

  const accuracyResults = [];
  let totalAccuracy = 0;

  for (const vehicle of vehicles) {
    try {
      console.log(`🔍 Auditing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

      const accuracy = await compareSourceWithProfile(supabase, vehicle);
      accuracyResults.push({
        vehicle_id: vehicle.id,
        identity: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        source_url: vehicle.source_url,
        accuracy: accuracy.overall_accuracy,
        major_issues: accuracy.discrepancies.filter(d => d.includes('CRITICAL')).length
      });

      totalAccuracy += accuracy.overall_accuracy;

      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.warn(`⚠️ Failed to audit ${vehicle.id}:`, err.message);
      accuracyResults.push({
        vehicle_id: vehicle.id,
        identity: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        source_url: vehicle.source_url,
        accuracy: 0,
        error: err.message
      });
    }
  }

  const averageAccuracy = totalAccuracy / vehicles.length;
  const highAccuracy = accuracyResults.filter(r => r.accuracy > 0.8).length;
  const majorIssues = accuracyResults.reduce((sum, r) => sum + (r.major_issues || 0), 0);

  return {
    batch_summary: {
      total_audited: vehicles.length,
      average_accuracy: averageAccuracy,
      high_accuracy_count: highAccuracy,
      high_accuracy_rate: highAccuracy / vehicles.length,
      total_major_issues: majorIssues,
      source_filter: sourceFilter || 'all'
    },
    individual_results: accuracyResults,
    recommendations: generateBatchRecommendations(averageAccuracy, majorIssues, vehicles.length)
  };
}

async function validateSourceExtraction(supabase: any, sourceUrl: string): Promise<any> {
  console.log(`🔍 Testing extraction accuracy for: ${sourceUrl}`);

  // Extract fresh data from source
  const { data: freshExtraction, error: extractError } = await supabase.functions.invoke('smart-extraction-router', {
    body: {
      url: sourceUrl,
      test_mode: true
    }
  });

  if (extractError) {
    throw new Error(`Failed to extract from source: ${extractError.message}`);
  }

  // Check if we already have this vehicle in database
  const { data: existingVehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('source_url', sourceUrl)
    .single();

  let comparisonResult;

  if (existingVehicle) {
    // Compare fresh extraction with existing profile
    comparisonResult = await compareExtractionResults(freshExtraction.data, existingVehicle);
    comparisonResult.comparison_type = 'fresh_vs_existing';
  } else {
    // Just validate the fresh extraction quality
    comparisonResult = await validateExtractionQuality(freshExtraction.data, sourceUrl);
    comparisonResult.comparison_type = 'fresh_validation';
  }

  return {
    source_url: sourceUrl,
    fresh_extraction: freshExtraction.data,
    existing_profile: existingVehicle || null,
    validation_result: comparisonResult
  };
}

async function compareSourceWithProfile(supabase: any, vehicle: any): Promise<AccuracyResult> {

  // Re-extract from source for comparison
  const { data: sourceExtraction, error: extractError } = await supabase.functions.invoke('smart-extraction-router', {
    body: {
      url: vehicle.source_url,
      test_mode: true
    }
  });

  if (extractError) {
    console.warn(`⚠️ Failed to re-extract from source: ${extractError.message}`);
    return {
      vehicle_id: vehicle.id,
      source_url: vehicle.source_url,
      identity_match: false,
      vin_match: false,
      engine_match: false,
      transmission_match: false,
      mileage_match: false,
      price_match: false,
      description_accuracy: 0,
      overall_accuracy: 0,
      discrepancies: [`CRITICAL: Could not re-extract from source - ${extractError.message}`],
      source_data: null,
      profile_data: vehicle
    };
  }

  const sourceData = sourceExtraction.data;
  const discrepancies: string[] = [];

  // Compare identity (year, make, model)
  const identityMatch = (
    normalizeString(sourceData.year) === normalizeString(vehicle.year) &&
    normalizeString(sourceData.make) === normalizeString(vehicle.make) &&
    normalizeString(sourceData.model) === normalizeString(vehicle.model)
  );

  if (!identityMatch) {
    discrepancies.push(`CRITICAL: Identity mismatch - Source: ${sourceData.year} ${sourceData.make} ${sourceData.model}, Profile: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  }

  // Compare VIN
  const vinMatch = compareField(sourceData.vin, vehicle.vin);
  if (!vinMatch && sourceData.vin && vehicle.vin) {
    discrepancies.push(`VIN mismatch - Source: ${sourceData.vin}, Profile: ${vehicle.vin}`);
  }

  // Compare engine
  const engineMatch = compareField(sourceData.engine, vehicle.engine, true);
  if (!engineMatch && sourceData.engine && vehicle.engine) {
    discrepancies.push(`Engine mismatch - Source: ${sourceData.engine}, Profile: ${vehicle.engine}`);
  }

  // Compare transmission
  const transmissionMatch = compareField(sourceData.transmission, vehicle.transmission, true);
  if (!transmissionMatch && sourceData.transmission && vehicle.transmission) {
    discrepancies.push(`Transmission mismatch - Source: ${sourceData.transmission}, Profile: ${vehicle.transmission}`);
  }

  // Compare mileage
  const mileageMatch = compareMileage(sourceData.mileage, vehicle.mileage);
  if (!mileageMatch && sourceData.mileage && vehicle.mileage) {
    discrepancies.push(`Mileage mismatch - Source: ${sourceData.mileage}, Profile: ${vehicle.mileage}`);
  }

  // Compare price
  const priceMatch = comparePrice(sourceData.asking_price || sourceData.sale_price, vehicle.asking_price || vehicle.sale_price);
  if (!priceMatch && (sourceData.asking_price || sourceData.sale_price) && (vehicle.asking_price || vehicle.sale_price)) {
    discrepancies.push(`Price mismatch - Source: ${sourceData.asking_price || sourceData.sale_price}, Profile: ${vehicle.asking_price || vehicle.sale_price}`);
  }

  // Description similarity (basic check)
  const descriptionAccuracy = compareDescriptions(sourceData.description, vehicle.description);

  // Calculate overall accuracy
  const checks = [identityMatch, vinMatch, engineMatch, transmissionMatch, mileageMatch, priceMatch];
  const validChecks = checks.filter(check => check !== null);
  const passedChecks = validChecks.filter(check => check === true);
  const overallAccuracy = validChecks.length > 0 ? (passedChecks.length / validChecks.length) : 0;

  return {
    vehicle_id: vehicle.id,
    source_url: vehicle.source_url,
    identity_match: identityMatch,
    vin_match: vinMatch,
    engine_match: engineMatch,
    transmission_match: transmissionMatch,
    mileage_match: mileageMatch,
    price_match: priceMatch,
    description_accuracy: descriptionAccuracy,
    overall_accuracy: overallAccuracy,
    discrepancies,
    source_data: sourceData,
    profile_data: vehicle
  };
}

function compareField(sourceValue: any, profileValue: any, fuzzy = false): boolean {
  if (!sourceValue && !profileValue) return true;
  if (!sourceValue || !profileValue) return null; // One missing, not a mismatch

  const source = normalizeString(sourceValue);
  const profile = normalizeString(profileValue);

  if (fuzzy) {
    // For engine/transmission, allow partial matches
    return source.includes(profile) || profile.includes(source) ||
           calculateSimilarity(source, profile) > 0.7;
  }

  return source === profile;
}

function compareMileage(sourceMiles: any, profileMiles: any): boolean {
  if (!sourceMiles && !profileMiles) return true;
  if (!sourceMiles || !profileMiles) return null;

  const sourceNum = Number(sourceMiles);
  const profileNum = Number(profileMiles);

  // Allow 10% variance for mileage (sometimes rounded)
  const variance = Math.abs(sourceNum - profileNum) / Math.max(sourceNum, profileNum);
  return variance < 0.1;
}

function comparePrice(sourcePrice: any, profilePrice: any): boolean {
  if (!sourcePrice && !profilePrice) return true;
  if (!sourcePrice || !profilePrice) return null;

  const sourceNum = Number(sourcePrice);
  const profileNum = Number(profilePrice);

  // Allow 5% variance for prices
  const variance = Math.abs(sourceNum - profileNum) / Math.max(sourceNum, profileNum);
  return variance < 0.05;
}

function compareDescriptions(sourceDesc: string, profileDesc: string): number {
  if (!sourceDesc && !profileDesc) return 1.0;
  if (!sourceDesc || !profileDesc) return 0.5;

  return calculateSimilarity(normalizeString(sourceDesc), normalizeString(profileDesc));
}

function normalizeString(str: any): string {
  if (!str) return '';
  return String(str).toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.split(/\s+/);
  const words2 = str2.split(/\s+/);

  const commonWords = words1.filter(word => words2.includes(word));
  const totalWords = Math.max(words1.length, words2.length);

  return totalWords > 0 ? commonWords.length / totalWords : 0;
}

function compareExtractionResults(freshData: any, existingProfile: any): any {
  // Compare fresh extraction with existing profile
  const discrepancies = [];

  if (freshData.vin !== existingProfile.vin) {
    discrepancies.push(`VIN changed: ${existingProfile.vin} → ${freshData.vin}`);
  }

  if (freshData.mileage !== existingProfile.mileage) {
    discrepancies.push(`Mileage changed: ${existingProfile.mileage} → ${freshData.mileage}`);
  }

  return {
    discrepancies,
    data_stability: discrepancies.length === 0,
    major_changes: discrepancies.filter(d => d.includes('VIN') || d.includes('Identity')).length
  };
}

function validateExtractionQuality(extractedData: any, sourceUrl: string): any {
  const issues = [];

  if (!extractedData.year || !extractedData.make || !extractedData.model) {
    issues.push('CRITICAL: Missing basic vehicle identity');
  }

  if (sourceUrl.includes('bringatrailer.com') && !extractedData.vin) {
    issues.push('VIN missing from BaT source (usually available)');
  }

  return {
    quality_score: issues.length === 0 ? 1.0 : Math.max(0, 1 - issues.length * 0.2),
    issues,
    extracted_fields: Object.keys(extractedData).filter(key => extractedData[key] !== null)
  };
}

function generateBatchRecommendations(avgAccuracy: number, majorIssues: number, totalVehicles: number): string[] {
  const recommendations = [];

  if (avgAccuracy < 0.7) {
    recommendations.push('CRITICAL: Average accuracy below 70% - investigate extraction logic');
  }

  if (majorIssues > totalVehicles * 0.1) {
    recommendations.push('High rate of major discrepancies - check source format changes');
  }

  if (avgAccuracy > 0.9) {
    recommendations.push('Excellent accuracy - consider reducing audit frequency for this source');
  }

  return recommendations;
}