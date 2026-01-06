/**
 * Extraction Quality Validator
 * Validates extracted vehicle data for completeness, accuracy, and consistency
 * before importing to the main database
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidationRequest {
  vehicle_data: any;
  source_url?: string;
  source_type?: 'auction' | 'dealer' | 'marketplace' | 'unknown';
  validate_images?: boolean;
  require_minimum_data?: boolean;
}

interface ValidationResult {
  is_valid: boolean;
  quality_score: number; // 0-1
  completeness_score: number; // 0-1
  accuracy_warnings: string[];
  missing_fields: string[];
  data_issues: string[];
  image_validation?: {
    total_images: number;
    valid_images: number;
    invalid_images: number;
    pollution_removed: number;
  };
  recommendations: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ValidationRequest = await req.json();
    const { vehicle_data, source_url, source_type, validate_images, require_minimum_data } = body;

    if (!vehicle_data) {
      return new Response(
        JSON.stringify({ error: 'vehicle_data is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    console.log(`🔍 Validating ${source_type || 'unknown'} vehicle data from ${source_url || 'unknown source'}`);

    // Run validation checks
    const validation = await validateVehicleData(
      vehicle_data,
      source_url,
      source_type,
      validate_images,
      require_minimum_data,
      supabase
    );

    return new Response(
      JSON.stringify({
        success: true,
        validation,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Validation error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown validation error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function validateVehicleData(
  data: any,
  sourceUrl?: string,
  sourceType?: string,
  validateImages = false,
  requireMinimumData = true,
  supabase?: any
): Promise<ValidationResult> {

  const warnings: string[] = [];
  const missingFields: string[] = [];
  const dataIssues: string[] = [];
  const recommendations: string[] = [];

  // Core identity validation
  const identity = validateVehicleIdentity(data, warnings, missingFields, dataIssues);

  // Technical specs validation
  const specs = validateTechnicalSpecs(data, warnings, missingFields, sourceType);

  // Auction-specific validation
  const auction = sourceType === 'auction'
    ? validateAuctionData(data, warnings, missingFields)
    : { score: 1.0 };

  // VIN validation
  const vin = validateVIN(data.vin, warnings, dataIssues);

  // Price validation
  const price = validatePricing(data, sourceType, warnings, dataIssues);

  // Image validation (if requested)
  let imageValidation;
  if (validateImages && data.images && Array.isArray(data.images) && supabase) {
    imageValidation = await validateVehicleImages(
      data.images,
      `${data.year} ${data.make} ${data.model}`,
      supabase
    );
  }

  // Calculate scores
  const identityScore = identity.score;
  const specsScore = specs.score;
  const auctionScore = auction.score;
  const vinScore = vin.score;
  const priceScore = price.score;

  // Weighted completeness score
  let completenessScore: number;
  if (sourceType === 'auction') {
    // Auctions should have comprehensive data
    completenessScore = (
      identityScore * 0.25 +    // Year/Make/Model essential
      specsScore * 0.30 +       // Engine/transmission/specs important
      auctionScore * 0.25 +     // Auction data critical
      vinScore * 0.20           // VIN very important for auctions
    );
  } else {
    // Dealers/marketplaces have different priorities
    completenessScore = (
      identityScore * 0.30 +    // Identity most important
      specsScore * 0.20 +       // Specs nice to have
      priceScore * 0.25 +       // Price important for dealers
      vinScore * 0.25           // VIN important
    );
  }

  // Overall quality score (completeness + accuracy)
  const accuracyPenalty = Math.min(warnings.length * 0.1, 0.3); // Max 30% penalty for warnings
  const qualityScore = Math.max(completenessScore - accuracyPenalty, 0);

  // Generate recommendations
  generateRecommendations(
    data,
    sourceType,
    missingFields,
    warnings,
    imageValidation,
    recommendations
  );

  // Determine if data meets minimum quality threshold
  const minQualityThreshold = requireMinimumData
    ? (sourceType === 'auction' ? 0.7 : 0.5)  // Higher standards for auctions
    : 0.3; // Very permissive if not required

  const isValid = qualityScore >= minQualityThreshold &&
                  identity.hasBasicInfo &&
                  dataIssues.length === 0; // No critical data issues

  return {
    is_valid: isValid,
    quality_score: qualityScore,
    completeness_score: completenessScore,
    accuracy_warnings: warnings,
    missing_fields: missingFields,
    data_issues: dataIssues,
    image_validation: imageValidation,
    recommendations
  };
}

function validateVehicleIdentity(data: any, warnings: string[], missingFields: string[], dataIssues: string[]) {
  let score = 0;
  let hasBasicInfo = true;

  // Year validation
  if (data.year) {
    const year = Number(data.year);
    if (year >= 1885 && year <= new Date().getFullYear() + 1) {
      score += 0.33;
    } else {
      dataIssues.push(`Invalid year: ${year} (must be 1885-${new Date().getFullYear() + 1})`);
      hasBasicInfo = false;
    }
  } else {
    missingFields.push('year');
    hasBasicInfo = false;
  }

  // Make validation
  if (data.make && String(data.make).trim().length > 0) {
    const make = String(data.make).trim().toLowerCase();
    const validMakes = [
      'chevrolet', 'ford', 'gmc', 'dodge', 'toyota', 'honda', 'bmw', 'mercedes-benz',
      'audi', 'porsche', 'jaguar', 'ferrari', 'lamborghini', 'aston martin', 'bentley'
      // Add more as needed
    ];

    if (validMakes.some(valid => make.includes(valid) || valid.includes(make))) {
      score += 0.33;
    } else if (make.length > 1) {
      score += 0.25; // Partial credit for unknown but plausible make
      warnings.push(`Unknown vehicle make: ${data.make}`);
    }
  } else {
    missingFields.push('make');
    hasBasicInfo = false;
  }

  // Model validation
  if (data.model && String(data.model).trim().length > 0) {
    const model = String(data.model).trim();
    if (model.length >= 2) {
      score += 0.34;
    } else {
      warnings.push(`Very short model name: ${model}`);
      score += 0.15;
    }
  } else {
    missingFields.push('model');
    hasBasicInfo = false;
  }

  return { score, hasBasicInfo };
}

function validateTechnicalSpecs(data: any, warnings: string[], missingFields: string[], sourceType?: string) {
  let score = 0;
  const maxFields = sourceType === 'auction' ? 7 : 4; // Higher expectations for auctions

  // VIN
  if (data.vin) score += 1.0 / maxFields;
  else if (sourceType === 'auction') missingFields.push('vin');

  // Engine
  if (data.engine && String(data.engine).length > 5) score += 1.0 / maxFields;
  else if (sourceType === 'auction') missingFields.push('engine');

  // Transmission
  if (data.transmission) score += 1.0 / maxFields;
  else if (sourceType === 'auction') missingFields.push('transmission');

  // Mileage
  if (data.mileage !== null && data.mileage !== undefined) {
    const miles = Number(data.mileage);
    if (miles >= 0 && miles < 10000000) {
      score += 1.0 / maxFields;
    } else {
      warnings.push(`Suspicious mileage: ${miles}`);
    }
  }

  if (sourceType === 'auction') {
    // Additional auction fields
    if (data.color || data.exterior_color) score += 1.0 / maxFields;
    if (data.interior_color) score += 1.0 / maxFields;
    if (data.modifications && Array.isArray(data.modifications)) score += 1.0 / maxFields;
  }

  return { score };
}

function validateAuctionData(data: any, warnings: string[], missingFields: string[]) {
  let score = 0;
  const fields = ['auction_end_date', 'bid_count', 'view_count', 'seller'];
  let validFields = 0;

  fields.forEach(field => {
    if (data[field] !== null && data[field] !== undefined) {
      validFields++;
    } else {
      missingFields.push(field);
    }
  });

  score = validFields / fields.length;

  // Validate auction-specific logic
  if (data.sale_price && data.reserve_not_met) {
    warnings.push('Vehicle has sale_price but reserve_not_met is true');
  }

  return { score };
}

function validateVIN(vin: any, warnings: string[], dataIssues: string[]) {
  let score = 0;

  if (vin) {
    const vinStr = String(vin).toUpperCase().trim();

    if (vinStr.length === 17) {
      score += 0.5;

      // Check for invalid characters
      if (!/[IOQ]/.test(vinStr)) {
        score += 0.3;

        // Basic VIN checksum validation could go here
        score += 0.2;
      } else {
        dataIssues.push(`VIN contains invalid characters (I, O, or Q): ${vinStr}`);
      }
    } else {
      dataIssues.push(`VIN wrong length (${vinStr.length}, expected 17): ${vinStr}`);
    }
  }

  return { score };
}

function validatePricing(data: any, sourceType?: string, warnings: string[] = [], dataIssues: string[] = []) {
  let score = 0;

  const priceFields = ['asking_price', 'sale_price', 'high_bid', 'current_bid'];
  const validPrices = priceFields.filter(field => {
    const value = data[field];
    return value !== null && value !== undefined && Number(value) > 0;
  });

  if (validPrices.length > 0) {
    score = 1.0;

    // Check for unrealistic prices
    validPrices.forEach(field => {
      const price = Number(data[field]);
      if (price > 10000000) {
        warnings.push(`Very high price in ${field}: $${price.toLocaleString()}`);
      } else if (price < 100) {
        warnings.push(`Very low price in ${field}: $${price}`);
      }
    });
  } else if (sourceType === 'dealer') {
    // Dealers should have asking_price
    score = 0;
  }

  return { score };
}

async function validateVehicleImages(
  imageUrls: string[],
  expectedVehicle: string,
  supabase: any
): Promise<any> {
  if (!imageUrls || imageUrls.length === 0) {
    return {
      total_images: 0,
      valid_images: 0,
      invalid_images: 0,
      pollution_removed: 0
    };
  }

  let validImages = 0;
  let invalidImages = 0;

  // Sample validation (validate first 5 images to avoid too many API calls)
  const samplesToValidate = Math.min(imageUrls.length, 5);

  for (let i = 0; i < samplesToValidate; i++) {
    try {
      const { data: validation } = await supabase.functions.invoke('validate-vehicle-image', {
        body: {
          image_url: imageUrls[i],
          expected_vehicle: expectedVehicle,
          check_relevance: true
        }
      });

      if (validation?.data?.is_vehicle_image && validation?.data?.shows_expected_vehicle) {
        validImages++;
      } else {
        invalidImages++;
      }
    } catch {
      invalidImages++; // Count validation failures as invalid
    }
  }

  // Estimate pollution for all images based on sample
  const pollutionRate = samplesToValidate > 0 ? invalidImages / samplesToValidate : 0;
  const estimatedPollution = Math.round(imageUrls.length * pollutionRate);

  return {
    total_images: imageUrls.length,
    valid_images: Math.round(imageUrls.length * (1 - pollutionRate)),
    invalid_images: estimatedPollution,
    pollution_removed: estimatedPollution,
    sample_size: samplesToValidate
  };
}

function generateRecommendations(
  data: any,
  sourceType?: string,
  missingFields: string[] = [],
  warnings: string[] = [],
  imageValidation?: any,
  recommendations: string[] = []
) {

  if (missingFields.includes('vin') && sourceType === 'auction') {
    recommendations.push('Re-extract using comprehensive-bat-extraction for VIN data');
  }

  if (missingFields.includes('engine') || missingFields.includes('transmission')) {
    recommendations.push('Use AI extraction for detailed technical specifications');
  }

  if (imageValidation && imageValidation.pollution_removed > 0) {
    recommendations.push(`Remove ${imageValidation.pollution_removed} polluted images from gallery`);
  }

  if (!data.description || data.description.length < 100) {
    recommendations.push('Extract detailed description from source page');
  }

  if (warnings.length > 3) {
    recommendations.push('Review data accuracy - multiple validation warnings detected');
  }
}