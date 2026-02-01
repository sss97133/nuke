/**
 * Diagnose Vehicle Profile Data Quality
 * 
 * Checks what data is stored for a vehicle and identifies gaps/poor quality fields
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
    const { vehicleId } = await req.json();

    if (!vehicleId) {
      return new Response(
        JSON.stringify({ error: 'vehicleId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get vehicle data
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) {
      throw new Error(`Failed to fetch vehicle: ${vehicleError.message}`);
    }

    // Analyze data quality
    const analysis = {
      vehicle_id: vehicleId,
      core_fields: {
        year: { value: vehicle.year, status: vehicle.year ? 'present' : 'missing', quality: vehicle.year && vehicle.year >= 1885 && vehicle.year <= new Date().getFullYear() + 1 ? 'good' : 'bad' },
        make: { value: vehicle.make, status: vehicle.make ? 'present' : 'missing', quality: vehicle.make && vehicle.make.length > 0 && vehicle.make.length < 50 ? 'good' : 'bad' },
        model: { value: vehicle.model, status: vehicle.model ? 'present' : 'missing', quality: vehicle.model && vehicle.model.length > 0 && vehicle.model.length < 100 ? 'good' : 'bad' },
        vin: { value: vehicle.vin, status: vehicle.vin ? 'present' : 'missing', quality: vehicle.vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vehicle.vin) ? 'good' : 'bad' },
        color: { value: vehicle.color, status: vehicle.color ? 'present' : 'missing', quality: vehicle.color && vehicle.color.length < 50 ? 'good' : 'bad' },
        mileage: { value: vehicle.mileage, status: vehicle.mileage ? 'present' : 'missing', quality: vehicle.mileage && vehicle.mileage > 0 && vehicle.mileage < 10000000 ? 'good' : 'bad' },
        transmission: { value: vehicle.transmission, status: vehicle.transmission ? 'present' : 'missing', quality: vehicle.transmission && vehicle.transmission.length < 50 ? 'good' : 'bad' },
        engine: { value: vehicle.engine, status: vehicle.engine ? 'present' : 'missing', quality: vehicle.engine && vehicle.engine.length < 100 ? 'good' : 'bad' },
        description: { value: vehicle.description, status: vehicle.description ? 'present' : 'missing', quality: vehicle.description && vehicle.description.length > 20 && vehicle.description.length < 5000 ? 'good' : 'bad' },
      },
      financial_fields: {
        asking_price: { value: vehicle.asking_price, status: vehicle.asking_price ? 'present' : 'missing' },
        purchase_price: { value: vehicle.purchase_price, status: vehicle.purchase_price ? 'present' : 'missing' },
        sale_price: { value: vehicle.sale_price, status: vehicle.sale_price ? 'present' : 'missing' },
        msrp: { value: vehicle.msrp, status: vehicle.msrp ? 'present' : 'missing' },
        current_value: { value: vehicle.current_value, status: vehicle.current_value ? 'present' : 'missing' },
      },
      spec_fields: {
        fuel_type: { value: vehicle.fuel_type, status: vehicle.fuel_type ? 'present' : 'missing' },
        drivetrain: { value: vehicle.drivetrain, status: vehicle.drivetrain ? 'present' : 'missing' },
        body_style: { value: vehicle.body_style, status: vehicle.body_style ? 'present' : 'missing' },
        doors: { value: vehicle.doors, status: vehicle.doors ? 'present' : 'missing' },
        seats: { value: vehicle.seats, status: vehicle.seats ? 'present' : 'missing' },
        engine_size: { value: vehicle.engine_size, status: vehicle.engine_size ? 'present' : 'missing' },
        horsepower: { value: vehicle.horsepower, status: vehicle.horsepower ? 'present' : 'missing' },
        torque: { value: vehicle.torque, status: vehicle.torque ? 'present' : 'missing' },
      },
      origin_data: {
        profile_origin: vehicle.profile_origin,
        discovery_url: vehicle.discovery_url,
        bat_auction_url: vehicle.bat_auction_url,
        origin_metadata: vehicle.origin_metadata ? 'present' : 'missing',
      },
      related_data: {
        image_count: 0,
        timeline_event_count: 0,
        comment_count: 0,
        document_count: 0,
        external_listing_count: 0,
      },
      data_quality_score: 0,
      issues: [] as string[],
      recommendations: [] as string[],
    };

    // Check related data
    const [imagesResult, eventsResult, commentsResult, docsResult, listingsResult] = await Promise.all([
      supabase.from('vehicle_images').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('timeline_events').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('vehicle_comments').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('vehicle_documents').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
      supabase.from('external_listings').select('id', { count: 'exact' }).eq('vehicle_id', vehicleId),
    ]);

    analysis.related_data.image_count = imagesResult.count || 0;
    analysis.related_data.timeline_event_count = eventsResult.count || 0;
    analysis.related_data.comment_count = commentsResult.count || 0;
    analysis.related_data.document_count = docsResult.count || 0;
    analysis.related_data.external_listing_count = listingsResult.count || 0;

    // Calculate quality score
    const coreFields = Object.values(analysis.core_fields);
    const presentCoreFields = coreFields.filter(f => f.status === 'present').length;
    const goodQualityFields = coreFields.filter(f => f.quality === 'good').length;
    analysis.data_quality_score = Math.round((goodQualityFields / coreFields.length) * 100);

    // Identify issues
    if (!vehicle.year) analysis.issues.push('Missing year');
    if (!vehicle.make) analysis.issues.push('Missing make');
    if (!vehicle.model) analysis.issues.push('Missing model');
    if (!vehicle.vin) analysis.issues.push('Missing VIN');
    if (!vehicle.color) analysis.issues.push('Missing color');
    if (!vehicle.mileage) analysis.issues.push('Missing mileage');
    if (!vehicle.transmission) analysis.issues.push('Missing transmission');
    if (!vehicle.description || vehicle.description.length < 20) analysis.issues.push('Missing or too-short description');
    if (analysis.related_data.image_count === 0) analysis.issues.push('No images');
    if (analysis.related_data.timeline_event_count === 0) analysis.issues.push('No timeline events');
    if (vehicle.discovery_url && !vehicle.origin_metadata) analysis.issues.push('Has discovery_url but missing origin_metadata');

    // Check for contaminated data
    const contaminatedFields: string[] = [];
    Object.entries(analysis.core_fields).forEach(([key, field]) => {
      if (field.value && typeof field.value === 'string') {
        const val = field.value as string;
        // Check for BaT contamination
        if (val.includes('Bring a Trailer') || val.includes('Lot #') || val.includes('sold for $')) {
          contaminatedFields.push(key);
        }
        // Check for CSS/JS contamination
        if (val.includes('{') || val.includes('}') || val.includes(';') || val.includes('/*')) {
          contaminatedFields.push(key);
        }
        // Check for listing title contamination
        if (val.includes(' - $') || (val.includes('(') && val.match(/\$[\d,]+/))) {
          contaminatedFields.push(key);
        }
      }
    });

    if (contaminatedFields.length > 0) {
      analysis.issues.push(`Contaminated fields: ${contaminatedFields.join(', ')}`);
    }

    // Generate recommendations
    if (vehicle.discovery_url && !vehicle.origin_metadata) {
      analysis.recommendations.push('Re-scrape discovery_url to extract origin_metadata');
    }
    if (analysis.related_data.image_count === 0 && vehicle.discovery_url) {
      analysis.recommendations.push('Backfill images from discovery_url');
    }
    if (presentCoreFields < 5) {
      analysis.recommendations.push('Vehicle has minimal data - consider re-extraction from source');
    }
    if (contaminatedFields.length > 0) {
      analysis.recommendations.push('Clean contaminated fields using sanitizeInlineValue patterns');
    }
    if (!vehicle.description || vehicle.description.length < 50) {
      analysis.recommendations.push('Extract description from discovery_url or origin_metadata');
    }

    return new Response(
      JSON.stringify(analysis, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Diagnosis error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

