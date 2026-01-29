/**
 * INGEST WAYBACK VEHICLE
 *
 * Takes raw Wayback Machine listing data and properly:
 * 1. Validates/extracts vehicle fields with confidence scoring
 * 2. Separates listing content from pollution (ads, nav, etc.)
 * 3. Creates/matches to vehicle profile
 * 4. Creates timeline events for the listing period
 * 5. Stores as observation with provenance
 *
 * This follows the extraction factory pattern with blind validation.
 *
 * Confidence is reduced for:
 * - No VIN (major - 0.3 penalty)
 * - Missing year/make/model (0.2 penalty each)
 * - Price seems unrealistic (0.1 penalty)
 * - Low image count (0.05 penalty)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WaybackListing {
  snapshot_url: string;
  original_url: string;
  snapshot_date: string;  // YYYY-MM-DD
  domain: string;
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  price?: number;
  mileage?: number;
  location?: string;
  description?: string;
  seller_type?: string;
  image_urls: string[];
  raw_text?: string;
}

interface FieldValidation {
  field: string;
  value: any;
  status: 'extracted' | 'not_found' | 'parse_error' | 'validation_fail' | 'low_confidence';
  confidence: number;
  error_code?: string;
  error_details?: string;
}

interface IngestRequest {
  listing: WaybackListing;

  // If known, link to existing vehicle
  vehicle_id?: string;

  // Listing duration estimate (for timeline event)
  listing_duration_days?: number;  // Default: 30 for Craigslist, 7-10 for eBay

  // Skip creating timeline event?
  skip_timeline?: boolean;

  // Just validate, don't persist?
  dry_run?: boolean;
}

interface IngestResult {
  success: boolean;
  observation_id?: string;
  vehicle_id?: string;
  vehicle_created?: boolean;
  timeline_event_id?: string;

  // Validation results
  fields: FieldValidation[];
  overall_confidence: number;
  confidence_factors: Record<string, number>;

  // Warnings
  warnings: string[];

  // If dry_run, what would be created
  would_create?: {
    vehicle?: any;
    observation?: any;
    timeline_event?: any;
  };
}

// VIN validation (basic)
function validateVin(vin: string): { valid: boolean; error?: string } {
  if (!vin) return { valid: false, error: 'VIN_MISSING' };
  if (vin.length !== 17) return { valid: false, error: 'INVALID_VIN_LENGTH' };
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return { valid: false, error: 'INVALID_VIN_CHARS' };
  // Check for obviously invalid VINs
  if (/^(.)\1{16}$/.test(vin)) return { valid: false, error: 'VIN_ALL_SAME_CHAR' };
  return { valid: true };
}

// Estimate listing duration based on source
function estimateListingDuration(domain: string, snapshotDate: string): { startDate: string; endDate: string; durationDays: number } {
  const start = new Date(snapshotDate);
  let durationDays = 30; // default

  if (domain.includes('craigslist')) {
    durationDays = 45;  // Craigslist listings typically last ~45 days
  } else if (domain.includes('ebay')) {
    durationDays = 10;  // eBay auctions typically 7-10 days
  } else if (domain.includes('autotrader')) {
    durationDays = 60;  // AutoTrader listings can last longer
  } else if (domain.includes('hemmings')) {
    durationDays = 90;  // Hemmings listings often stay up longer
  }

  const end = new Date(start);
  end.setDate(end.getDate() + durationDays);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    durationDays
  };
}

// Calculate price realism score
function assessPriceRealism(price: number, year: number | undefined, domain: string): { realistic: boolean; score: number; reason?: string } {
  if (!price || price <= 0) return { realistic: false, score: 0, reason: 'NO_PRICE' };

  // Very low prices might be deposits or errors
  if (price < 100) return { realistic: false, score: 0.3, reason: 'SUSPICIOUSLY_LOW' };

  // Very high prices for old listings might be errors
  if (price > 10000000) return { realistic: false, score: 0.3, reason: 'SUSPICIOUSLY_HIGH' };

  // Contextual checks based on era
  if (year) {
    const snapshotYear = 2008;  // Typical gold rush era
    const vehicleAge = snapshotYear - year;

    // Classic cars (20+ years old) with very low prices in 2005-2010 were common
    if (vehicleAge >= 20 && price < 5000) {
      return { realistic: true, score: 1.0, reason: 'ERA_APPROPRIATE' };
    }

    // Near-new cars shouldn't be dirt cheap
    if (vehicleAge <= 3 && price < 5000) {
      return { realistic: false, score: 0.5, reason: 'TOO_CHEAP_FOR_AGE' };
    }
  }

  return { realistic: true, score: 0.9 };
}

// Extract clean vehicle data, filtering pollution
function validateAndScore(listing: WaybackListing): { fields: FieldValidation[]; overall: number; factors: Record<string, number> } {
  const fields: FieldValidation[] = [];
  const factors: Record<string, number> = {
    base: 0.85,  // Wayback source trust
    vin: 0,
    ymm: 0,
    price: 0,
    images: 0,
    description: 0
  };

  // VIN validation
  if (listing.vin) {
    const vinCheck = validateVin(listing.vin);
    if (vinCheck.valid) {
      fields.push({ field: 'vin', value: listing.vin, status: 'extracted', confidence: 0.95 });
      factors.vin = 0.15;  // VIN is a big confidence boost
    } else {
      fields.push({ field: 'vin', value: listing.vin, status: 'validation_fail', confidence: 0.3, error_code: vinCheck.error });
      factors.vin = -0.1;
    }
  } else {
    fields.push({ field: 'vin', value: null, status: 'not_found', confidence: 0 });
    factors.vin = -0.3;  // No VIN is a major confidence hit
  }

  // Year/Make/Model
  if (listing.year && listing.year >= 1900 && listing.year <= new Date().getFullYear() + 1) {
    fields.push({ field: 'year', value: listing.year, status: 'extracted', confidence: 0.9 });
    factors.ymm += 0.05;
  } else if (listing.year) {
    fields.push({ field: 'year', value: listing.year, status: 'validation_fail', confidence: 0.3, error_code: 'INVALID_YEAR_RANGE' });
    factors.ymm -= 0.1;
  } else {
    fields.push({ field: 'year', value: null, status: 'not_found', confidence: 0 });
    factors.ymm -= 0.15;
  }

  if (listing.make && listing.make.length > 1 && listing.make.length < 50) {
    fields.push({ field: 'make', value: listing.make, status: 'extracted', confidence: 0.85 });
    factors.ymm += 0.05;
  } else {
    fields.push({ field: 'make', value: listing.make || null, status: listing.make ? 'validation_fail' : 'not_found', confidence: 0, error_code: listing.make ? 'INVALID_MAKE_LENGTH' : undefined });
    factors.ymm -= 0.1;
  }

  if (listing.model && listing.model.length > 0 && listing.model.length < 100) {
    fields.push({ field: 'model', value: listing.model, status: 'extracted', confidence: 0.85 });
    factors.ymm += 0.05;
  } else {
    fields.push({ field: 'model', value: listing.model || null, status: listing.model ? 'validation_fail' : 'not_found', confidence: 0 });
    factors.ymm -= 0.1;
  }

  // Price
  if (listing.price) {
    const priceCheck = assessPriceRealism(listing.price, listing.year, listing.domain);
    if (priceCheck.realistic) {
      fields.push({ field: 'price', value: listing.price, status: 'extracted', confidence: priceCheck.score });
      factors.price = 0.05;
    } else {
      fields.push({ field: 'price', value: listing.price, status: 'low_confidence', confidence: priceCheck.score, error_code: priceCheck.reason });
      factors.price = -0.05;
    }
  } else {
    fields.push({ field: 'price', value: null, status: 'not_found', confidence: 0 });
    factors.price = -0.1;  // Price is important for historical value
  }

  // Images
  const validImages = (listing.image_urls || []).filter(url =>
    url &&
    !url.includes('1x1') &&
    !url.includes('pixel') &&
    !url.includes('spacer') &&
    !url.includes('logo') &&
    !url.includes('icon') &&
    (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.gif'))
  );

  if (validImages.length > 0) {
    fields.push({ field: 'images', value: validImages, status: 'extracted', confidence: Math.min(0.9, 0.5 + validImages.length * 0.1) });
    factors.images = Math.min(0.1, validImages.length * 0.02);
  } else {
    fields.push({ field: 'images', value: [], status: 'not_found', confidence: 0 });
    factors.images = -0.05;
  }

  // Description
  if (listing.description && listing.description.length > 50) {
    // Check for pollution (ads, navigation text)
    const pollutionPatterns = [
      /click here/i,
      /sign up/i,
      /advertisement/i,
      /sponsored/i,
      /\bcookie\b/i,
      /privacy policy/i,
      /terms of service/i
    ];

    let pollutionCount = 0;
    for (const pattern of pollutionPatterns) {
      if (pattern.test(listing.description)) pollutionCount++;
    }

    if (pollutionCount === 0) {
      fields.push({ field: 'description', value: listing.description, status: 'extracted', confidence: 0.85 });
      factors.description = 0.05;
    } else if (pollutionCount <= 2) {
      fields.push({ field: 'description', value: listing.description, status: 'low_confidence', confidence: 0.6, error_code: 'POSSIBLE_POLLUTION' });
      factors.description = 0;
    } else {
      fields.push({ field: 'description', value: listing.description, status: 'validation_fail', confidence: 0.3, error_code: 'HIGH_POLLUTION' });
      factors.description = -0.1;
    }
  } else {
    fields.push({ field: 'description', value: listing.description || null, status: listing.description ? 'low_confidence' : 'not_found', confidence: 0.3 });
    factors.description = -0.05;
  }

  // Calculate overall confidence
  let overall = factors.base;
  for (const [key, value] of Object.entries(factors)) {
    if (key !== 'base') overall += value;
  }
  overall = Math.max(0.1, Math.min(1.0, overall));

  return { fields, overall, factors };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: IngestRequest = await req.json();
    const { listing, vehicle_id, listing_duration_days, skip_timeline, dry_run } = body;

    if (!listing || !listing.snapshot_url || !listing.snapshot_date) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required listing data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate and score the listing
    const validation = validateAndScore(listing);
    const warnings: string[] = [];

    // Check for critical issues
    if (validation.overall < 0.3) {
      warnings.push('Very low confidence - manual review recommended');
    }

    if (!listing.vin && !listing.year && !listing.make) {
      warnings.push('Cannot identify vehicle without VIN or year/make/model');
    }

    const result: IngestResult = {
      success: true,
      fields: validation.fields,
      overall_confidence: validation.overall,
      confidence_factors: validation.factors,
      warnings
    };

    // Estimate listing period
    const listingPeriod = estimateListingDuration(listing.domain, listing.snapshot_date);
    if (listing_duration_days) {
      listingPeriod.durationDays = listing_duration_days;
      const end = new Date(listing.snapshot_date);
      end.setDate(end.getDate() + listing_duration_days);
      listingPeriod.endDate = end.toISOString().slice(0, 10);
    }

    // Build what we would create
    const wouldCreate: any = {};

    // Try to match/create vehicle
    let resolvedVehicleId = vehicle_id;
    let vehicleCreated = false;

    if (!resolvedVehicleId && !dry_run) {
      // Try to find existing vehicle
      if (listing.vin) {
        const { data: existingByVin } = await supabase
          .from('vehicles')
          .select('id')
          .eq('vin', listing.vin)
          .limit(1);

        if (existingByVin?.length) {
          resolvedVehicleId = existingByVin[0].id;
        }
      }

      // If no VIN match, try year/make/model (only if highly specific)
      if (!resolvedVehicleId && listing.year && listing.make && listing.model) {
        const { data: existingByYMM } = await supabase
          .from('vehicles')
          .select('id')
          .eq('year', listing.year)
          .ilike('make', listing.make)
          .ilike('model', listing.model)
          .limit(2);

        // Only match if exactly one result (to avoid false matches)
        if (existingByYMM?.length === 1) {
          resolvedVehicleId = existingByYMM[0].id;
          warnings.push('Matched by year/make/model only - verify this is correct vehicle');
        }
      }

      // Create new vehicle if needed and we have minimum data
      if (!resolvedVehicleId && listing.year && listing.make) {
        const vehicleData = {
          year: listing.year,
          make: listing.make,
          model: listing.model || 'Unknown',
          vin: listing.vin || null,
          mileage: listing.mileage || null,
          // Note: source tracking is in vehicle_observations, not vehicles table
          notes: `Discovered via Wayback Machine. Original listing: ${listing.domain} (${listing.snapshot_date}). Asking price: $${listing.price?.toLocaleString() || 'unknown'}.`
        };

        const { data: newVehicle, error: createError } = await supabase
          .from('vehicles')
          .insert(vehicleData)
          .select('id')
          .single();

        if (newVehicle) {
          resolvedVehicleId = newVehicle.id;
          vehicleCreated = true;
        } else if (createError) {
          warnings.push(`Failed to create vehicle: ${createError.message}`);
        }
      }
    }

    if (dry_run && listing.year && listing.make) {
      wouldCreate.vehicle = {
        year: listing.year,
        make: listing.make,
        model: listing.model || 'Unknown',
        vin: listing.vin,
        mileage: listing.mileage
      };
    }

    result.vehicle_id = resolvedVehicleId;
    result.vehicle_created = vehicleCreated;

    // Create observation
    if (!dry_run && resolvedVehicleId) {
      const observationData = {
        source_slug: 'wayback-machine',
        kind: 'listing',
        observed_at: listing.snapshot_date,
        source_url: listing.snapshot_url,
        source_identifier: `wayback-${listing.snapshot_date}-${listing.domain}-${listing.original_url.slice(-50)}`,
        content_text: [listing.title, listing.description].filter(Boolean).join('\n'),
        structured_data: {
          original_url: listing.original_url,
          snapshot_date: listing.snapshot_date,
          domain: listing.domain,
          asking_price: listing.price,
          mileage: listing.mileage,
          location: listing.location,
          seller_type: listing.seller_type,
          image_urls: (listing.image_urls || []).slice(0, 10),
          extraction_confidence: validation.overall,
          listing_duration_estimate: listingPeriod
        },
        vehicle_id: resolvedVehicleId
      };

      const { data: obs } = await supabase
        .from('vehicle_observations')
        .insert({
          vehicle_id: resolvedVehicleId,
          source_id: (await supabase.from('observation_sources').select('id').eq('slug', 'wayback-machine').single()).data?.id,
          kind: 'listing',
          observed_at: listing.snapshot_date,
          source_url: listing.snapshot_url,
          source_identifier: observationData.source_identifier,
          content_text: observationData.content_text,
          structured_data: observationData.structured_data,
          confidence: validation.overall >= 0.7 ? 'high' : validation.overall >= 0.5 ? 'medium' : 'low',
          confidence_score: validation.overall,
          confidence_factors: validation.factors
        })
        .select('id')
        .single();

      if (obs) {
        result.observation_id = obs.id;
      }
    }

    if (dry_run) {
      wouldCreate.observation = {
        source: 'wayback-machine',
        kind: 'listing',
        observed_at: listing.snapshot_date,
        confidence: validation.overall
      };
    }

    // Create timeline event
    if (!dry_run && resolvedVehicleId && !skip_timeline) {
      const timelineData = {
        vehicle_id: resolvedVehicleId,
        event_type: 'other',  // Use 'other' for historical listings
        source: 'wayback',
        title: `Listed on ${listing.domain} for $${listing.price?.toLocaleString() || 'unknown'}`,
        description: `Historical listing discovered via Internet Archive Wayback Machine. This vehicle was listed for sale on ${listing.domain} around ${listing.snapshot_date}. Asking price: $${listing.price?.toLocaleString() || 'unknown'}. ${listing.mileage ? `Mileage at time: ${listing.mileage.toLocaleString()} miles.` : ''}`,
        event_date: listingPeriod.startDate,
        data_source: 'user_input',  // Closest match for archived external data
        source_type: 'user_input',
        confidence_score: Math.round(validation.overall * 100),
        mileage_at_event: listing.mileage || null,
        location_name: listing.location || null,
        metadata: {
          wayback_snapshot_url: listing.snapshot_url,
          original_url: listing.original_url,
          platform: listing.domain,
          asking_price: listing.price,
          listing_duration_estimate_days: listingPeriod.durationDays,
          listing_end_estimate: listingPeriod.endDate,
          snapshot_date: listing.snapshot_date,
          archived_image_urls: (listing.image_urls || []).slice(0, 5),
          extraction_confidence: validation.overall
        }
      };

      const { data: timeline, error: timelineError } = await supabase
        .from('timeline_events')
        .insert(timelineData)
        .select('id')
        .single();

      if (timeline) {
        result.timeline_event_id = timeline.id;
      } else if (timelineError) {
        warnings.push(`Failed to create timeline event: ${timelineError.message}`);
      }
    }

    if (dry_run) {
      wouldCreate.timeline_event = {
        type: 'listing',
        start: listingPeriod.startDate,
        end: listingPeriod.endDate,
        duration_days: listingPeriod.durationDays,
        asking_price: listing.price
      };
      result.would_create = wouldCreate;
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[ingest-wayback-vehicle] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
