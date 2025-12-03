import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackfillRequest {
  vehicle_id: string;
  image_urls: string[];
  source?: string;
  run_analysis?: boolean;
  listed_date?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: BackfillRequest = await req.json();
    const { vehicle_id, image_urls, source = 'backfill', run_analysis = true, listed_date } = body;

    if (!vehicle_id || !image_urls || image_urls.length === 0) {
      throw new Error('vehicle_id and image_urls required');
    }

    console.log(`Backfilling ${image_urls.length} images for vehicle ${vehicle_id}`);

    // Get vehicle info for context
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('origin_metadata')
      .eq('id', vehicle_id)
      .single();

    // Get admin user ID for attribution
    const adminUserId = '4e6849be-21dc-4dcf-bc0d-f0b2aad4f8c0';

    // Determine image date from listed_date or origin_metadata
    let imageDate = listed_date;
    if (!imageDate && vehicle?.origin_metadata?.listed_date) {
      imageDate = vehicle.origin_metadata.listed_date;
    }
    if (!imageDate) {
      imageDate = new Date().toISOString().split('T')[0];
    }

    const results = {
      uploaded: 0,
      failed: 0,
      skipped: 0,
      analyzed: 0
    };

    for (let i = 0; i < image_urls.length; i++) {
      const imageUrl = image_urls[i];
      
      try {
        // Download image
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          console.log(`Failed to download ${imageUrl}: ${imageResponse.status}`);
          results.failed++;
          continue;
        }

        const imageBlob = await imageResponse.blob();
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        const extension = contentType.includes('png') ? 'png' : 'jpg';
        
        // Generate unique filename
        const filename = `${source}_${Date.now()}_${i}.${extension}`;
        const storagePath = `${vehicle_id}/${filename}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, imageBlob, {
            contentType,
            upsert: false
          });

        if (uploadError) {
          console.log(`Upload failed for ${filename}: ${uploadError.message}`);
          results.failed++;
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);

        // Create database record
        const { data: imageRecord, error: dbError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id,
            user_id: adminUserId,
            image_url: publicUrl,
            storage_path: storagePath,
            source: source,
            is_primary: i === 0,
            taken_at: imageDate,
            metadata: {
              original_url: imageUrl,
              import_source: source,
              import_index: i
            }
          })
          .select('id')
          .single();

        if (dbError) {
          console.log(`DB insert failed: ${dbError.message}`);
          results.failed++;
          continue;
        }

        results.uploaded++;
        console.log(`Uploaded image ${i + 1}/${image_urls.length}: ${filename}`);

        // Run Tier 1 analysis if requested
        if (run_analysis && imageRecord) {
          try {
            const analysisResponse = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-image-tier1`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({
                  image_url: publicUrl,
                  vehicle_id,
                  image_id: imageRecord.id
                })
              }
            );

            if (analysisResponse.ok) {
              results.analyzed++;
            }
          } catch (analysisError) {
            console.log(`Analysis failed for image ${imageRecord.id}: ${analysisError.message}`);
          }
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 500));

      } catch (error) {
        console.log(`Error processing ${imageUrl}: ${error.message}`);
        results.failed++;
      }
    }

    console.log(`Backfill complete: ${results.uploaded} uploaded, ${results.failed} failed, ${results.analyzed} analyzed`);

    return new Response(JSON.stringify({
      success: true,
      vehicle_id,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

