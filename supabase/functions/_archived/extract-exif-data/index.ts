import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ExifReader from 'https://esm.sh/exifreader@4.14.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExifResult {
  image_id: string;
  success: boolean;
  device_fingerprint?: string;
  camera_make?: string;
  camera_model?: string;
  software?: string;
  datetime_original?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  error?: string;
}

/**
 * EXIF Extraction Edge Function
 *
 * Extracts EXIF metadata from vehicle images for physical possession verification.
 *
 * Usage:
 *   POST /extract-exif-data
 *
 *   Body options:
 *   - { "image_ids": ["uuid1", "uuid2"] }  - Process specific images
 *   - { "batch_size": 50 }                  - Process pending images in batch
 *   - { "vehicle_id": "uuid" }              - Process all images for a vehicle
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { image_ids, batch_size = 50, vehicle_id } = body;

    console.log('[EXIF Extractor] Starting extraction', { image_ids, batch_size, vehicle_id });

    // Get images to process
    let images: any[] = [];

    if (image_ids && image_ids.length > 0) {
      // Process specific images
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, vehicle_id, user_id, storage_path')
        .in('id', image_ids);

      if (error) throw error;
      images = data || [];
    } else if (vehicle_id) {
      // Process all images for a vehicle
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, vehicle_id, user_id, storage_path')
        .eq('vehicle_id', vehicle_id)
        .is('exif_data', null)
        .limit(batch_size);

      if (error) throw error;
      images = data || [];
    } else {
      // Process pending images (marked by trigger)
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('id, image_url, vehicle_id, user_id, storage_path')
        .eq('ai_processing_status', 'pending_exif')
        .limit(batch_size);

      if (error) throw error;
      images = data || [];
    }

    console.log(`[EXIF Extractor] Found ${images.length} images to process`);

    if (images.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No images to process', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process images in parallel (with concurrency limit)
    const results: ExifResult[] = [];
    const concurrency = 5;

    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(img => extractExifFromImage(supabase, img))
      );
      results.push(...batchResults);
    }

    // Summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const withLocation = successful.filter(r => r.latitude && r.longitude);
    const withDevice = successful.filter(r => r.device_fingerprint);

    console.log(`[EXIF Extractor] Complete: ${successful.length} success, ${failed.length} failed`);
    console.log(`[EXIF Extractor] ${withLocation.length} have GPS, ${withDevice.length} have device fingerprint`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: images.length,
        successful: successful.length,
        failed: failed.length,
        with_location: withLocation.length,
        with_device_fingerprint: withDevice.length,
        results: results.map(r => ({
          image_id: r.image_id,
          success: r.success,
          has_location: !!(r.latitude && r.longitude),
          has_device: !!r.device_fingerprint,
          error: r.error
        }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[EXIF Extractor] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function extractExifFromImage(supabase: any, image: any): Promise<ExifResult> {
  const result: ExifResult = {
    image_id: image.id,
    success: false
  };

  try {
    // Get image URL (prefer storage_path for Supabase storage, fallback to image_url)
    let imageUrl = image.image_url;

    if (image.storage_path && !imageUrl.startsWith('http')) {
      // It's a storage path, get public URL
      const { data } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(image.storage_path);
      imageUrl = data?.publicUrl || image.image_url;
    }

    if (!imageUrl) {
      result.error = 'No image URL available';
      await markImageProcessed(supabase, image.id, null, 'no_url');
      return result;
    }

    console.log(`[EXIF] Processing ${image.id}: ${imageUrl.substring(0, 80)}...`);

    // Fetch image bytes
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Nuke-EXIF-Extractor/1.0'
      }
    });

    if (!response.ok) {
      result.error = `Failed to fetch image: ${response.status}`;
      await markImageProcessed(supabase, image.id, null, 'fetch_failed');
      return result;
    }

    const arrayBuffer = await response.arrayBuffer();

    // Extract EXIF
    let tags: any;
    try {
      tags = ExifReader.load(arrayBuffer, { expanded: true });
    } catch (exifError: any) {
      // No EXIF data in image (common for screenshots, web images)
      result.error = 'No EXIF data found';
      await markImageProcessed(supabase, image.id, { no_exif: true }, 'no_exif');
      result.success = true; // Not a failure, just no data
      return result;
    }

    // Extract relevant fields
    const exif = tags.exif || {};
    const gps = tags.gps || {};
    const ifd0 = tags.ifd0 || {};

    // Camera info
    result.camera_make = ifd0.Make?.description || exif.Make?.description;
    result.camera_model = ifd0.Model?.description || exif.Model?.description;
    result.software = ifd0.Software?.description || exif.Software?.description;

    // Date/time
    const dateTimeOriginal = exif.DateTimeOriginal?.description;
    if (dateTimeOriginal) {
      // EXIF format: "2024:01:15 14:30:00" -> ISO format
      result.datetime_original = parseExifDate(dateTimeOriginal);
    }

    // GPS coordinates
    if (gps.Latitude !== undefined && gps.Longitude !== undefined) {
      result.latitude = gps.Latitude;
      result.longitude = gps.Longitude;
      result.altitude = gps.Altitude;
    }

    // Generate device fingerprint
    result.device_fingerprint = generateDeviceFingerprint(result.camera_make, result.camera_model, result.software);

    // Build EXIF data object
    const exifData = {
      make: result.camera_make,
      model: result.camera_model,
      software: result.software,
      datetime_original: result.datetime_original,
      latitude: result.latitude,
      longitude: result.longitude,
      altitude: result.altitude,
      device_fingerprint: result.device_fingerprint,
      extracted_at: new Date().toISOString()
    };

    // Update vehicle_images
    await supabase
      .from('vehicle_images')
      .update({
        exif_data: exifData,
        device_fingerprint: result.device_fingerprint,
        latitude: result.latitude,
        longitude: result.longitude,
        taken_at: result.datetime_original,
        ai_processing_status: 'exif_extracted',
        location_confidence: result.latitude ? 1.0 : null
      })
      .eq('id', image.id);

    // Create device_attributions record
    if (result.device_fingerprint || result.latitude) {
      await supabase
        .from('device_attributions')
        .upsert({
          image_id: image.id,
          device_fingerprint: result.device_fingerprint || 'unknown',
          camera_make: result.camera_make,
          camera_model: result.camera_model,
          software: result.software,
          latitude: result.latitude,
          longitude: result.longitude,
          altitude: result.altitude,
          datetime_original: result.datetime_original,
          extraction_method: 'exif',
          raw_exif: tags,
          uploaded_by_user_id: image.user_id,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'image_id'
        });
    }

    result.success = true;
    console.log(`[EXIF] Success for ${image.id}: device=${result.device_fingerprint}, gps=${!!result.latitude}`);

    return result;
  } catch (error: any) {
    console.error(`[EXIF] Error processing ${image.id}:`, error);
    result.error = error.message;
    await markImageProcessed(supabase, image.id, null, 'error');
    return result;
  }
}

function generateDeviceFingerprint(make?: string, model?: string, software?: string): string | undefined {
  if (!make && !model) return undefined;

  // Create a consistent fingerprint from device info
  const parts = [
    (make || '').toLowerCase().trim(),
    (model || '').toLowerCase().trim(),
    // Include software for iPhone vs Android differentiation
    (software || '').toLowerCase().split(' ')[0] // Just first word
  ].filter(Boolean);

  if (parts.length === 0) return undefined;

  // Simple hash
  const str = parts.join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return `${parts[0]}_${parts[1] || 'unknown'}_${Math.abs(hash).toString(16)}`;
}

function parseExifDate(exifDate: string): string | undefined {
  if (!exifDate) return undefined;

  try {
    // EXIF format: "2024:01:15 14:30:00"
    const [datePart, timePart] = exifDate.split(' ');
    const [year, month, day] = datePart.split(':');
    const isoDate = `${year}-${month}-${day}T${timePart || '00:00:00'}Z`;

    // Validate
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return undefined;

    return date.toISOString();
  } catch {
    return undefined;
  }
}

async function markImageProcessed(supabase: any, imageId: string, exifData: any, status: string) {
  await supabase
    .from('vehicle_images')
    .update({
      exif_data: exifData,
      ai_processing_status: status
    })
    .eq('id', imageId);
}
