/**
 * Analyze Image Bundle - Supabase Edge Function
 * 
 * Safely analyzes image bundles without failing:
 * - Gets bundle context from database
 * - Calls generate-work-logs with proper error handling
 * - Returns status and results
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface AnalyzeBundleRequest {
  vehicleId: string;
  bundleDate: string; // YYYY-MM-DD
  deviceFingerprint: string;
  organizationId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { vehicleId, bundleDate, deviceFingerprint, organizationId }: AnalyzeBundleRequest = await req.json();

    if (!vehicleId || !bundleDate || !deviceFingerprint || !organizationId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required parameters: vehicleId, bundleDate, deviceFingerprint, organizationId' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing bundle: ${bundleDate} for vehicle ${vehicleId}`);

    // 1. Get bundle context using database function
    const { data: context, error: contextError } = await supabase
      .rpc('get_bundle_context', {
        p_vehicle_id: vehicleId,
        p_bundle_date: bundleDate,
        p_device_fingerprint: deviceFingerprint
      });

    if (contextError) {
      console.error('Error getting bundle context:', contextError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to get bundle context',
          details: contextError.message 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!context || !context.bundle || !context.bundle.image_ids || context.bundle.image_ids.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No images found in bundle',
          bundleDate,
          deviceFingerprint
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Bundle has ${context.bundle.image_ids.length} images`);

    // 2. Limit to 10 images to avoid timeout
    const imageIds = context.bundle.image_ids.slice(0, 10);

    // 3. Call generate-work-logs function via HTTP
    try {
      const generateWorkLogsUrl = `${supabaseUrl}/functions/v1/generate-work-logs`;
      console.log(`Calling generate-work-logs with ${imageIds.length} images`);
      
      const generateWorkLogsResponse = await fetch(generateWorkLogsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey
        },
        body: JSON.stringify({
          vehicleId,
          organizationId,
          imageIds,
          eventDate: bundleDate
        })
      });

      if (!generateWorkLogsResponse.ok) {
        const errorText = await generateWorkLogsResponse.text();
        console.error('generate-work-logs failed:', errorText);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Failed to analyze bundle',
            details: errorText,
            status: generateWorkLogsResponse.status
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const workLogResult = await generateWorkLogsResponse.json();
      
      if (!workLogResult || !workLogResult.success) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: workLogResult?.error || 'Analysis failed',
            workLogResult
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 4. Return success
      return new Response(
        JSON.stringify({
          success: true,
          eventId: workLogResult.eventId,
          bundle: {
            date: bundleDate,
            imageCount: context.bundle.image_ids.length,
            imagesAnalyzed: imageIds.length
          },
          result: {
            partsCount: workLogResult.partsCount || 0,
            laborTasksCount: workLogResult.laborTasksCount || 0
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (fetchError: any) {
      console.error('Error calling generate-work-logs:', fetchError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to call generate-work-logs',
          details: fetchError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


  } catch (error: any) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Unexpected error',
        details: error.message,
        stack: error.stack
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

