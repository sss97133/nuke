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
      analyzed: 0,
      errors: [] as string[]
    };

    for (let i = 0; i < image_urls.length; i++) {
      let imageUrl = image_urls[i];
      
      // Clean HTML entities from URL
      imageUrl = imageUrl
        .replace(/&#038;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
      
      // Remove resize parameters for BaT
      if (imageUrl.includes('bringatrailer.com')) {
        imageUrl = imageUrl
          .replace(/[?&]w=\d+/g, '')
          .replace(/[?&]resize=[^&]*/g, '')
          .replace(/[?&]fit=[^&]*/g, '')
          .replace(/[?&]$/, '');
        if (imageUrl.includes('-scaled.')) {
          imageUrl = imageUrl.replace('-scaled.', '.');
        }
      }
      
      try {
        // Download image with proper headers (especially for Craigslist and BaT)
        const headers: HeadersInit = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        };
        
        // Add Referer for specific sites
        if (imageUrl.includes('craigslist')) {
          headers['Referer'] = 'https://craigslist.org/';
        } else if (imageUrl.includes('bringatrailer')) {
          headers['Referer'] = 'https://bringatrailer.com/';
        }
        
        console.log(`Downloading image ${i + 1}/${image_urls.length}: ${imageUrl.substring(0, 80)}...`);
        let imageResponse: Response;
        try {
          // Add timeout (30 seconds)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          
          imageResponse = await fetch(imageUrl, { 
            headers,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
        } catch (fetchError: any) {
          if (fetchError.name === 'AbortError') {
            console.log(`Timeout fetching ${imageUrl}`);
          } else {
            console.log(`Fetch error for ${imageUrl}: ${fetchError.message || fetchError}`);
          }
          results.failed++;
          continue;
        }
        
        if (!imageResponse.ok) {
          console.log(`Failed to download ${imageUrl}: ${imageResponse.status} ${imageResponse.statusText}`);
          try {
            const errorText = await imageResponse.text();
            if (errorText && errorText.length < 500) {
              console.log(`Error response: ${errorText}`);
            }
          } catch (e) {
            // Ignore error reading response
          }
          results.failed++;
          continue;
        }

        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) {
          console.log(`Not an image: ${contentType} for ${imageUrl}`);
          results.failed++;
          continue;
        }
        
        // Convert response to Uint8Array (same approach as backfill-craigslist-images)
        let imageBytes: Uint8Array;
        try {
          // Use blob first, then arrayBuffer (same as backfill-craigslist-images)
          const imageBlob = await imageResponse.blob();
          const arrayBuffer = await imageBlob.arrayBuffer();
          imageBytes = new Uint8Array(arrayBuffer);
        } catch (conversionError: any) {
          console.log(`Conversion error for ${imageUrl}: ${conversionError.message || conversionError}`);
          results.failed++;
          continue;
        }
        
        // Verify it's actually an image
        if (imageBytes.length === 0) {
          console.log(`Empty bytes for ${imageUrl}`);
          results.failed++;
          continue;
        }
        
        // Check size (should be > 0 and < 50MB)
        if (imageBytes.length > 52428800) {
          console.log(`Image too large: ${(imageBytes.length / 1024 / 1024).toFixed(1)}MB for ${imageUrl}`);
          results.failed++;
          continue;
        }
        
        console.log(`Image size: ${(imageBytes.length / 1024).toFixed(1)}KB, type: ${contentType}`);
        
        const extension = contentType.includes('png') ? 'png' : 'jpg';
        
        // Generate unique filename
        const filename = `${source}_${Date.now()}_${i}.${extension}`;
        const storagePath = `${vehicle_id}/${filename}`;
        
        console.log(`Uploading to storage: ${storagePath}`);
        
        // Upload to storage using Uint8Array (same as backfill-craigslist-images)
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, imageBytes, {
            contentType: `image/${extension}`,
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          const errorMsg = `Upload failed for ${filename}: ${uploadError.message || JSON.stringify(uploadError)}`;
          console.log(`❌ ${errorMsg}`);
          results.errors.push(errorMsg);
          results.failed++;
          continue;
        }
        
        console.log(`✅ Uploaded ${filename} (${(imageBytes.length / 1024).toFixed(1)}KB)`);

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
    
    if (results.errors.length > 0) {
      console.log(`Errors encountered: ${results.errors.slice(0, 5).join('; ')}`);
    }

    return new Response(JSON.stringify({
      success: true,
      vehicle_id,
      ...results,
      error_summary: results.errors.length > 0 ? results.errors.slice(0, 10) : undefined
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

