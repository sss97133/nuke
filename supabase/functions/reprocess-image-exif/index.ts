import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import exifr from 'https://esm.sh/exifr@7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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

    console.log(`Reprocessing EXIF for vehicle: ${vehicleId}`);

    // Get all images without taken_at
    const { data: images, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, taken_at, exif_data, created_at')
      .eq('vehicle_id', vehicleId)
      .is('taken_at', null);

    if (fetchError) throw fetchError;

    console.log(`Found ${images?.length || 0} images without taken_at`);

    let fixed = 0;
    let failed = 0;

    for (const image of images || []) {
      try {
        console.log(`Processing: ${image.id}`);

        // Download and extract EXIF
        const response = await fetch(image.image_url);
        const buffer = await response.arrayBuffer();
        
        const exifData = await exifr.parse(buffer, {
          gps: true,
          tiff: true,
          exif: true,
          iptc: false,
          ifd0: true,
          ifd1: false,
          mergeOutput: false
        });

        if (!exifData) {
          console.log(`No EXIF found for ${image.id}, using created_at as fallback`);
          // Use created_at as best guess
          await supabase
            .from('vehicle_images')
            .update({ taken_at: image.created_at })
            .eq('id', image.id);
          failed++;
          continue;
        }

        // Extract and structure EXIF
        const structured = {
          camera: {
            make: exifData.Make || null,
            model: exifData.Model || null,
          },
          location: {
            latitude: exifData.latitude || null,
            longitude: exifData.longitude || null,
          },
          technical: {
            iso: exifData.ISO || null,
            aperture: exifData.FNumber ? `f/${exifData.FNumber}` : null,
            focalLength: exifData.FocalLength ? `${exifData.FocalLength}mm` : null,
            shutterSpeed: exifData.ExposureTime ? `1/${Math.round(1 / exifData.ExposureTime)}` : null,
          },
          DateTimeOriginal: exifData.DateTimeOriginal || exifData.CreateDate || exifData.ModifyDate || null
        };

        const takenAt = structured.DateTimeOriginal || image.created_at;

        // Update database
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({
            exif_data: structured,
            taken_at: takenAt,
            gps_latitude: structured.location.latitude,
            gps_longitude: structured.location.longitude
          })
          .eq('id', image.id);

        if (updateError) throw updateError;

        console.log(`✅ Fixed: ${image.id} - ${takenAt}`);
        fixed++;

      } catch (error) {
        console.error(`Error processing ${image.id}:`, error);
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${images?.length || 0} images`,
        fixed,
        failed 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

