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
  max_images?: number;
}

const CRAIGSLIST_HIRES_SIZE = '1200x900';

function isProbablyThumbnail(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('94x63') ||
    lower.includes('thumbnail') ||
    lower.includes('thumb/') ||
    lower.includes('_50x50') ||
    lower.includes('50x50c') ||
    lower.endsWith('.svg')
  );
}

function normalizeSourceUrl(raw: string): string {
  let imageUrl = raw
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();

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

  return imageUrl;
}

function candidateUrlsForSourceUrl(imageUrl: string): string[] {
  // Prefer higher-res on Craigslist when possible, but keep fallback to original.
  // Example: ..._600x450.jpg -> ..._1200x900.jpg
  if (imageUrl.includes('images.craigslist.org') && /_\d+x\d+\.(jpg|jpeg|png|webp)(\?|$)/i.test(imageUrl)) {
    const hi = imageUrl.replace(/_(\d+)x(\d+)\.(jpg|jpeg|png|webp)(\?|$)/i, `_${CRAIGSLIST_HIRES_SIZE}.$3$4`);
    if (hi !== imageUrl) return [hi, imageUrl];
  }
  return [imageUrl];
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
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
    const { vehicle_id, image_urls, source = 'backfill', run_analysis = true, listed_date, max_images = 50 } = body;

    if (!vehicle_id || !image_urls || image_urls.length === 0) {
      throw new Error('vehicle_id and image_urls required');
    }

    console.log(`Backfilling ${image_urls.length} images for vehicle ${vehicle_id} (max_images=${max_images})`);

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

    // Dedupe: skip images already linked by source_url for this vehicle
    const { data: existingRows } = await supabase
      .from('vehicle_images')
      .select('source_url')
      .eq('vehicle_id', vehicle_id)
      .not('source_url', 'is', null)
      .limit(5000);
    const existingSourceUrls = new Set((existingRows || []).map((r: any) => String(r.source_url)));

    const normalizedInput = image_urls
      .map((u) => normalizeSourceUrl(String(u)))
      .filter((u) => u && u.startsWith('http'))
      .filter((u) => !isProbablyThumbnail(u));

    // Keep input order but remove exact duplicates
    const uniqueUrls: string[] = [];
    const seen = new Set<string>();
    for (const u of normalizedInput) {
      if (seen.has(u)) continue;
      seen.add(u);
      uniqueUrls.push(u);
    }

    for (let i = 0; i < uniqueUrls.length && results.uploaded < max_images; i++) {
      const rawUrl = uniqueUrls[i];
      if (existingSourceUrls.has(rawUrl)) {
        results.skipped++;
        continue;
      }
      
      try {
        // Download image with proper headers (especially for Craigslist and BaT)
        const headers: HeadersInit = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        };
        
        // Add Referer for specific sites
        if (rawUrl.includes('craigslist')) {
          headers['Referer'] = 'https://craigslist.org/';
        } else if (rawUrl.includes('bringatrailer')) {
          headers['Referer'] = 'https://bringatrailer.com/';
        }
        
        const candidates = candidateUrlsForSourceUrl(rawUrl);
        console.log(`Downloading image ${i + 1}/${uniqueUrls.length}: ${rawUrl.substring(0, 80)}...`);
        let imageResponse: Response;
        try {
          // Add timeout (30 seconds)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);

          // Try higher-res variant first where applicable, fallback to original.
          let ok = false;
          let last: Response | null = null;
          for (const candidateUrl of candidates) {
            const resp = await fetch(candidateUrl, { headers, signal: controller.signal });
            last = resp;
            if (resp.ok) {
              imageResponse = resp;
              ok = true;
              // If we successfully fetched a different URL than rawUrl, use it as provenance too.
              // Keep `rawUrl` as `source_url` so reruns dedupe consistently.
              break;
            }
          }
          clearTimeout(timeoutId);
          if (!ok) {
            imageResponse = last as Response;
          }
        } catch (fetchError: any) {
          if (fetchError.name === 'AbortError') console.log(`Timeout fetching ${rawUrl}`);
          else console.log(`Fetch error for ${rawUrl}: ${fetchError.message || fetchError}`);
          results.failed++;
          continue;
        }
        
        if (!imageResponse.ok) {
          console.log(`Failed to download ${rawUrl}: ${imageResponse.status} ${imageResponse.statusText}`);
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
          console.log(`Not an image: ${contentType} for ${rawUrl}`);
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
          console.log(`Conversion error for ${rawUrl}: ${conversionError.message || conversionError}`);
          results.failed++;
          continue;
        }
        
        // Verify it's actually an image
        if (imageBytes.length === 0) {
          console.log(`Empty bytes for ${rawUrl}`);
          results.failed++;
          continue;
        }
        
        // Check size (should be > 0 and < 50MB)
        if (imageBytes.length > 52428800) {
          console.log(`Image too large: ${(imageBytes.length / 1024 / 1024).toFixed(1)}MB for ${rawUrl}`);
          results.failed++;
          continue;
        }
        
        console.log(`Image size: ${(imageBytes.length / 1024).toFixed(1)}KB, type: ${contentType}`);
        
        const extension = contentType.includes('png') ? 'png' : 'jpg';

        // Deterministic storage path prevents re-upload storms during re-runs.
        const urlHash = await sha1Hex(`${rawUrl}|${extension}`);
        const filename = `${source}_${urlHash}.${extension}`;
        const storagePath = `${vehicle_id}/${source}/${filename}`;
        
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
          // If the object already exists, we can reuse the public URL and just ensure DB linkage.
          const msg = String((uploadError as any).message || '');
          if (msg.toLowerCase().includes('already exists')) {
            results.skipped++;
          } else {
          const errorMsg = `Upload failed for ${filename}: ${uploadError.message || JSON.stringify(uploadError)}`;
          console.log(`❌ ${errorMsg}`);
          results.errors.push(errorMsg);
          results.failed++;
          continue;
          }
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
            source_url: rawUrl,
            is_primary: i === 0,
            taken_at: imageDate,
            // `vehicle_images` does NOT have a generic `metadata` column in production.
            // Store import provenance in `exif_data` (jsonb) and `source_url` (text).
            exif_data: {
              original_url: rawUrl,
              import_source: source,
              import_index: i,
              imported_at: new Date().toISOString()
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

        // Run vision analysis if requested
        if (run_analysis && imageRecord) {
          try {
            const analysisResponse = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-image`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({
                  image_url: publicUrl,
                  vehicle_id,
                  image_id: imageRecord.id,
                  user_id: adminUserId
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
        console.log(`Error processing ${rawUrl}: ${error.message}`);
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

