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

    // Get all images for the vehicle
    const { data: allImages, error: fetchError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, taken_at, exif_data, created_at, filename')
      .eq('vehicle_id', vehicleId);
    
    if (fetchError) throw fetchError;
    
    // Filter to find images with missing or minimal EXIF data
    const images = (allImages || []).filter(img => {
      // Include if exif_data is null or empty
      if (!img.exif_data || img.exif_data === '{}' || Object.keys(img.exif_data).length === 0) return true;
      
      const exif = img.exif_data;
      
      // Check if it has meaningful EXIF data
      const hasCamera = exif.camera && (exif.camera.make || exif.camera.model);
      const hasLocation = exif.location && (exif.location.latitude || exif.location.longitude);
      const hasTechnical = exif.technical && (exif.technical.iso || exif.technical.aperture);
      
      // Skip if it's just metadata about broken URLs or downloads (not real EXIF)
      const isMetadataOnly = exif.fixed || exif.broken_url || exif.downloaded_at || exif.original_source;
      
      // Include if it doesn't have camera, location, or technical data (and isn't just metadata)
      return !hasCamera && !hasLocation && !hasTechnical && !isMetadataOnly;
    });

    console.log(`Found ${images?.length || 0} images with missing or minimal EXIF data`);

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
          mergeOutput: false,
          pick: [
            'DateTimeOriginal', 'DateTime', 'CreateDate', 'ModifyDate',
            'GPSLatitude', 'GPSLongitude', 'latitude', 'longitude',
            'GPSLatitudeRef', 'GPSLongitudeRef',
            'Make', 'Model', 'ImageWidth', 'ImageHeight',
            'ISO', 'FNumber', 'ExposureTime', 'FocalLength'
          ]
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

        // Extract and structure EXIF (matching frontend format)
        const structured: any = {
          DateTimeOriginal: exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate || exifData.ModifyDate || null
        };
        
        // Camera info
        if (exifData.Make || exifData.Model) {
          structured.camera = {
            make: exifData.Make || null,
            model: exifData.Model || null,
          };
        }
        
        // Location/GPS
        let lat = exifData.latitude || exifData.GPSLatitude;
        let lon = exifData.longitude || exifData.GPSLongitude;
        
        // Handle GPS reference directions
        if (exifData.GPSLatitudeRef === 'S' && lat > 0) lat = -lat;
        if (exifData.GPSLongitudeRef === 'W' && lon > 0) lon = -lon;
        
        if (lat && lon && typeof lat === 'number' && typeof lon === 'number' &&
            lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          structured.location = {
            latitude: lat,
            longitude: lon,
          };
        }
        
        // Technical settings
        const technical: any = {};
        if (exifData.ISO) technical.iso = exifData.ISO;
        if (exifData.FNumber) technical.aperture = `f/${exifData.FNumber}`;
        if (exifData.ExposureTime) {
          technical.shutterSpeed = exifData.ExposureTime < 1 
            ? `1/${Math.round(1/exifData.ExposureTime)}` 
            : `${exifData.ExposureTime}s`;
        }
        if (exifData.FocalLength) technical.focalLength = `${exifData.FocalLength}mm`;
        
        if (Object.keys(technical).length > 0) {
          structured.technical = technical;
        }
        
        // Dimensions
        if (exifData.ImageWidth && exifData.ImageHeight) {
          structured.dimensions = {
            width: exifData.ImageWidth,
            height: exifData.ImageHeight
          };
        }
        
        // Preserve existing metadata if it exists (like original_source, etc.)
        if (image.exif_data && typeof image.exif_data === 'object') {
          const existing = image.exif_data as any;
          
          // Check if this is from an external source
          if (existing.original_source || existing.downloaded_at || existing.original_bat_url || existing.source) {
            const hasRealExif = structured.camera || structured.location || structured.technical;
            
            structured.exif_status = hasRealExif ? 'partial' : 'stripped';
            structured.source = existing.source || {
              type: 'external',
              name: existing.original_source || 'unknown',
              original_url: existing.original_bat_url || existing.original_url || null,
              downloaded_at: existing.downloaded_at || null
            };
            
            // Preserve old format for backwards compatibility
            if (existing.original_source) structured.original_source = existing.original_source;
            if (existing.downloaded_at) structured.downloaded_at = existing.downloaded_at;
            if (existing.original_bat_url) structured.original_bat_url = existing.original_bat_url;
          } else {
            // User-uploaded image - mark EXIF status
            structured.exif_status = (structured.camera || structured.location || structured.technical) ? 'complete' : 'minimal';
          }
        } else {
          // New extraction - mark status
          structured.exif_status = (structured.camera || structured.location || structured.technical) ? 'complete' : 'minimal';
        }

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

