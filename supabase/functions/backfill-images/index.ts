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
  // Resume large galleries without relying on uploaded-count (which is affected by skips/failures).
  start_index?: number;
  // Optional: chunking / chaining for large galleries (dealer sites like L'Art).
  continue?: boolean;
  chain_depth?: number;
  sleep_ms?: number;
  max_runtime_ms?: number;
}

const CRAIGSLIST_HIRES_SIZE = '1200x900';

function isProbablyThumbnail(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    // BaT: only accept actual listing uploads; site chrome lives in /wp-content/themes/... etc.
    (lower.includes('bringatrailer.com') && !lower.includes('/wp-content/uploads/')) ||
    lower.includes('94x63') ||
    lower.includes('thumbnail') ||
    lower.includes('thumb/') ||
    lower.includes('_50x50') ||
    lower.includes('50x50c') ||
    lower.endsWith('.svg')
  );
}

function isKnownNoiseUrl(url: string): boolean {
  const s = String(url || '').toLowerCase().trim();
  if (!s) return true;

  // Hard block: analytics pixels / trackers masquerading as images
  if (s.startsWith('https://www.facebook.com/tr') || s.startsWith('http://www.facebook.com/tr')) return true;
  if (s.includes('facebook.com/tr?') || (s.includes('facebook.com/tr') && s.includes('noscript=1'))) return true;

  // BaT site chrome / icons / UI assets
  if (s.includes('bringatrailer.com/wp-content/themes/bringatrailer/assets/img/')) return true;
  if (s.includes('bringatrailer.com/wp-content/themes/bringatrailer/assets/img/countries/')) return true;
  if (s.includes('bringatrailer.com/wp-content/themes/bringatrailer/assets/img/listings/')) return true;
  if (s.includes('bringatrailer.com/wp-content/themes/bringatrailer/assets/img/social-')) return true;
  if (s.includes('bringatrailer.com/wp-content/themes/bringatrailer/assets/img/partial-load')) return true;

  // BaT editorial/promotional content that leaks into scraping results
  if (s.includes('dec-merch-site-post-')) return true;
  if (s.includes('weekly-weird-wonderful')) return true;
  if (s.includes('qotw-winner-template')) return true;
  if (/\/web-\d{3,}-/i.test(s)) return true;
  if (s.includes('site-post-')) return true;
  if (s.includes('thumbnail-template')) return true;
  if (s.includes('mile-marker')) return true;
  if (s.includes('podcast')) return true;
  if (s.includes('merch')) return true;
  if (s.includes('countries/')) return true;
  if (s.includes('themes/')) return true;
  if (s.includes('assets/img/')) return true;

  // Block geo-location service flag images (THE AMERICAN FLAG ISSUE!)
  if (s.includes('hello.zonos.com/images/flags/')) return true;
  if (s.includes('/flags/') && s.includes('.png')) return true;
  if (s.includes('flags/us.png') || s.includes('flags/US.png')) return true;

  return false;
}

function isTinyBatTransform(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/bringatrailer\.com$/i.test(u.hostname)) return false;
    if (!u.pathname.toLowerCase().startsWith('/wp-content/uploads/')) return false;
    const fit = u.searchParams.get('fit');
    const resize = u.searchParams.get('resize');
    if (fit) {
      const v = fit.replace(/\s+/g, '').toLowerCase();
      if (v === '144,96') return true;
    }
    if (resize) {
      const v = resize.replace(/\s+/g, '').toLowerCase();
      if (v === '235,159') return true;
    }
    return false;
  } catch {
    return false;
  }
}

function batCanonicalUploadKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/bringatrailer\.com$/i.test(u.hostname)) return null;
    const path = u.pathname.toLowerCase();
    if (!path.startsWith('/wp-content/uploads/')) return null;
    return `${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

function normalizeSourceUrl(raw: string): string {
  let imageUrl = raw
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();

  // Prefer https (Cloudinary commonly returns http on older sites).
  if (imageUrl.startsWith('http://res.cloudinary.com/')) {
    imageUrl = 'https://' + imageUrl.slice('http://'.length);
  }

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
  // Prefer Cloudinary originals when we only have transformed thumbs.
  // Example:
  //   .../image/upload/c_fill,g_center,h_467,w_624/v172.../file.jpg
  // ->.../image/upload/v172.../file.jpg
  if (imageUrl.includes('res.cloudinary.com') && imageUrl.includes('/image/upload/')) {
    // Remove transform segment between /upload/ and /v####... if present.
    const m = imageUrl.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)([^/]+\/)?(v\d+\/.+)$/i);
    if (m && m[1] && m[3]) {
      const candidate = `${m[1]}${m[3]}`;
      if (candidate !== imageUrl) return [candidate, imageUrl];
    }
  }

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

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  // Digest must be computed over a concrete ArrayBuffer (avoid ArrayBufferLike/SharedArrayBuffer typing issues)
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: BackfillRequest = await req.json();
    const {
      vehicle_id,
      image_urls,
      source = 'backfill',
      run_analysis = true,
      listed_date,
      // IMPORTANT:
      // - max_images <= 0 means "no cap" (process until runtime limit, then optionally chain)
      // - callers that want bounded work can still pass max_images explicitly
      max_images = 0,
      start_index = 0,
      continue: shouldContinue = false,
      chain_depth = 0,
      sleep_ms = 200,
      max_runtime_ms = 25000,
    } = body;

    if (!vehicle_id || !image_urls || image_urls.length === 0) {
      throw new Error('vehicle_id and image_urls required');
    }

    console.log(`Backfilling ${image_urls.length} images for vehicle ${vehicle_id} (start_index=${start_index}, max_images=${max_images}, continue=${shouldContinue}, chain_depth=${chain_depth})`);

    // Get vehicle info for context
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('origin_metadata')
      .eq('id', vehicle_id)
      .single();

    // NOTE: vehicle_images has an attribution CHECK constraint + FK to auth.users.
    // Edge Functions frequently have no auth user context; rather than hardcoding a user_id that might not exist,
    // rely on a whitelisted `source` and leave user_id null.
    const ALLOWED_SOURCES = new Set(['bat_import', 'external_import', 'organization_import']);
    const effectiveSource = ALLOWED_SOURCES.has(source) ? source : 'external_import';

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

    // Dedupe: skip images already linked by source_url OR file_hash for this vehicle
    // Also check storage_path to catch legacy import_queue_* images that may be duplicates
    const { data: existingRows } = await supabase
      .from('vehicle_images')
      .select('id, source_url, file_hash, storage_path, image_url, is_primary, position')
      .eq('vehicle_id', vehicle_id)
      .limit(5000);
    const existingBySourceUrl = new Map<string, any>();
    const existingFileHashes = new Set<string>();
    const existingImageUrls = new Set<string>();
    const legacyImportQueuePaths = new Set<string>();
    
    for (const r of (existingRows || []) as any[]) {
      const u = String(r?.source_url || '');
      if (u && !existingBySourceUrl.has(u)) {
        existingBySourceUrl.set(u, r);
      }

      const fh = String(r?.file_hash || '').trim();
      if (fh) existingFileHashes.add(fh);
      
      const imgUrl = String(r?.image_url || '').trim();
      if (imgUrl) existingImageUrls.add(imgUrl);
      
      // Track legacy import_queue_* paths for cleanup
      const storagePath = String(r?.storage_path || '');
      if (storagePath.includes('import_queue_') && !storagePath.includes('/organization_import/') && !storagePath.includes('/external_import/')) {
        legacyImportQueuePaths.add(r.id);
      }
    }
    const existingSourceUrls = new Set(Array.from(existingBySourceUrl.keys()));
    const hasPrimaryAlready = (existingRows || []).some((r: any) => r?.is_primary === true);

    const normalizedInput = image_urls
      .map((u) => normalizeSourceUrl(String(u)))
      .filter((u) => u && u.startsWith('http'))
      .filter((u) => !isKnownNoiseUrl(u))
      .filter((u) => !isProbablyThumbnail(u));

    // BaT: keep tiny resize/fit variants ONLY if we also saw the same underlying upload path
    // somewhere else in the batch. This preserves fast-loading thumbs for real listing photos,
    // while dropping sidebar/editorial cross-listing thumbs.
    const batUploadKeyCounts = new Map<string, number>();
    for (const u of normalizedInput) {
      const key = batCanonicalUploadKey(u);
      if (!key) continue;
      batUploadKeyCounts.set(key, (batUploadKeyCounts.get(key) || 0) + 1);
    }
    const filteredInput = normalizedInput.filter((u) => {
      if (!isTinyBatTransform(u)) return true;
      const key = batCanonicalUploadKey(u);
      if (!key) return true;
      return (batUploadKeyCounts.get(key) || 0) > 1;
    });

    // Keep input order but remove exact duplicates
    const uniqueUrls: string[] = [];
    const seen = new Set<string>();
    for (const u of filteredInput) {
      if (seen.has(u)) continue;
      seen.add(u);
      uniqueUrls.push(u);
    }

    const startedAt = Date.now();
    const maxToUploadThisCall = (typeof max_images === 'number' && Number.isFinite(max_images) && max_images > 0)
      ? Math.floor(max_images)
      : Number.POSITIVE_INFINITY;

    // Track actual progress through the list independent of uploaded/skipped/failed.
    let processed = 0;

    for (let i = Math.max(0, Math.min(start_index, uniqueUrls.length)); i < uniqueUrls.length && results.uploaded < maxToUploadThisCall; i++) {
      if (Date.now() - startedAt > max_runtime_ms) {
        console.log(`⏱️  Stopping early due to max_runtime_ms=${max_runtime_ms}`);
        break;
      }
      const rawUrl = uniqueUrls[i];
      processed++;
      
      // Check if we already have this image by source_url
      if (existingSourceUrls.has(rawUrl)) {
        // Self-heal ordering: older backfills didn't set position. If we have a row with NULL position,
        // set it using the gallery index so profiles become stable without requiring re-upload.
        try {
          const existing = existingBySourceUrl.get(rawUrl);
          if (existing?.id && (existing?.position === null || existing?.position === undefined)) {
            await supabase
              .from('vehicle_images')
              .update({ position: i })
              .eq('id', existing.id)
              .catch(() => null);
          }
        } catch {
          // ignore
        }
        results.skipped++;
        continue;
      }
      
      // Check if image_url already exists (catches duplicates from different sources)
      const normalizedUrl = normalizeSourceUrl(rawUrl);
      if (existingImageUrls.has(normalizedUrl)) {
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
        
        // Add Referer for specific sites (hotlink protection bypass)
        if (rawUrl.includes('craigslist')) {
          headers['Referer'] = 'https://craigslist.org/';
        } else if (rawUrl.includes('bringatrailer')) {
          headers['Referer'] = 'https://bringatrailer.com/';
        } else if (rawUrl.includes('mecum.com') || rawUrl.includes('images.mecum.com')) {
          headers['Referer'] = 'https://www.mecum.com/';
        } else if (rawUrl.includes('barrett-jackson')) {
          headers['Referer'] = 'https://www.barrett-jackson.com/';
        } else if (rawUrl.includes('rmsothebys')) {
          headers['Referer'] = 'https://rmsothebys.com/';
        } else if (rawUrl.includes('bonhams')) {
          headers['Referer'] = 'https://www.bonhams.com/';
        }
        
        const candidates = candidateUrlsForSourceUrl(rawUrl);
        console.log(`Downloading image ${i + 1}/${uniqueUrls.length}: ${rawUrl.substring(0, 80)}...`);
        let imageResponse: Response | null = null;
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
            imageResponse = last;
          }
        } catch (fetchError: any) {
          if (fetchError.name === 'AbortError') console.log(`Timeout fetching ${rawUrl}`);
          else console.log(`Fetch error for ${rawUrl}: ${fetchError.message || fetchError}`);
          results.errors.push(`fetch_error: ${rawUrl} :: ${fetchError?.name || 'Error'} :: ${fetchError?.message || String(fetchError)}`);
          results.failed++;
          continue;
        }

        if (!imageResponse) {
          results.errors.push(`download_failed: ${rawUrl} :: no_response`);
          results.failed++;
          continue;
        }
        
        if (!imageResponse.ok) {
          console.log(`Failed to download ${rawUrl}: ${imageResponse.status} ${imageResponse.statusText}`);
          results.errors.push(`download_failed: ${rawUrl} :: ${imageResponse.status} ${imageResponse.statusText}`);
          try {
            const errorText = await imageResponse.text();
            if (errorText && errorText.length < 500) {
              console.log(`Error response: ${errorText}`);
              results.errors.push(`download_body: ${rawUrl} :: ${errorText}`);
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
          results.errors.push(`not_image: ${rawUrl} :: ${contentType}`);
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
          results.errors.push(`convert_error: ${rawUrl} :: ${conversionError?.message || String(conversionError)}`);
          results.failed++;
          continue;
        }
        
        // Verify it's actually an image
        if (imageBytes.length === 0) {
          console.log(`Empty bytes for ${rawUrl}`);
          results.errors.push(`empty_bytes: ${rawUrl}`);
          results.failed++;
          continue;
        }
        
        // Check size (should be > 0 and < 50MB)
        if (imageBytes.length > 52428800) {
          console.log(`Image too large: ${(imageBytes.length / 1024 / 1024).toFixed(1)}MB for ${rawUrl}`);
          results.errors.push(`too_large: ${rawUrl} :: ${(imageBytes.length / 1024 / 1024).toFixed(1)}MB`);
          results.failed++;
          continue;
        }

        // Identity hash (exact image match even if names/URLs differ)
        let fileHash: string | null = null;
        try {
          fileHash = await sha256HexBytes(imageBytes);
        } catch {
          fileHash = null;
        }

        // If we already imported an identical image for this vehicle, skip creating a duplicate row.
        // This catches duplicates even if source_url differs (e.g., import_queue_* vs organization_import/)
        if (fileHash && existingFileHashes.has(fileHash)) {
          console.log(`Skipping duplicate image by file_hash: ${rawUrl.substring(0, 80)}...`);
          results.skipped++;
          continue;
        }
        
        console.log(`Image size: ${(imageBytes.length / 1024).toFixed(1)}KB, type: ${contentType}`);
        
        const extension = contentType.includes('png') ? 'png' : 'jpg';

        // Deterministic storage path prevents re-upload storms during re-runs.
        const urlHash = await sha1Hex(`${rawUrl}|${extension}`);
        const filename = `${effectiveSource}_${urlHash}.${extension}`;
        const storagePath = `${vehicle_id}/${effectiveSource}/${filename}`;
        
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
            // Do NOT early-continue: we still want to ensure a vehicle_images row exists.
          } else {
          const errorMsg = `Upload failed for ${filename}: ${uploadError.message || JSON.stringify(uploadError)}`;
          console.log(`❌ ${errorMsg}`);
          results.errors.push(errorMsg);
          results.failed++;
          continue;
          }
        }
        
        if (!uploadError) {
          console.log(`✅ Uploaded ${filename} (${(imageBytes.length / 1024).toFixed(1)}KB)`);
        } else {
          console.log(`↩️  Storage object already exists for ${filename}; ensuring DB linkage`);
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);

        // Validate that the uploaded image is actually accessible to prevent blank squares
        if (!uploadError) {
          try {
            const testResponse = await fetch(publicUrl, { method: 'HEAD' });
            if (!testResponse.ok) {
              console.error(`❌ Uploaded file not accessible: ${publicUrl} (${testResponse.status})`);
              results.errors.push(`upload_not_accessible: ${rawUrl} :: ${testResponse.status}`);
              results.failed++;
              continue;
            }
          } catch (accessError) {
            console.error(`❌ Error testing uploaded file accessibility: ${accessError}`);
            results.errors.push(`upload_test_failed: ${rawUrl} :: ${accessError}`);
            results.failed++;
            continue;
          }
        }

        // Create database record (even if storage object already existed).
        // If a previous run uploaded to storage but DB insert failed, this is the recovery path.
        const { data: imageRecord, error: dbError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id,
            user_id: null,
            image_url: publicUrl,
            storage_path: storagePath,
            file_hash: fileHash,
            file_size: imageBytes.length,
            mime_type: contentType,
            filename,
            source: effectiveSource,
            source_url: rawUrl,
            // Imported images should be visible by default (fixes: BaT galleries stuck in pending).
            approval_status: 'auto_approved',
            is_approved: true,
            redaction_level: 'none',
            // Preserve gallery order deterministically (fixes: profiles showing BaT galleries reversed/random).
            // We use the source list index so repeated runs keep a stable ordering.
            position: i,
            display_order: i,
            // Only set primary if there isn't one already (prevents later chunks from overwriting primary).
            is_primary: !hasPrimaryAlready && results.uploaded === 0,
            taken_at: imageDate,
            // `vehicle_images` does NOT have a generic `metadata` column in production.
            // Store import provenance in `exif_data` (jsonb) and `source_url` (text).
            exif_data: {
              original_url: rawUrl,
              import_source: source,
              effective_source: effectiveSource,
              import_index: i,
              imported_at: new Date().toISOString()
            }
          })
          .select('id')
          .single();

        if (dbError) {
          console.log(`DB insert failed: ${dbError.message}`);
          results.errors.push(`db_insert_failed: ${rawUrl} :: ${dbError.message}`);
          results.failed++;
          continue;
        }

        results.uploaded++;
        console.log(`Uploaded image ${i + 1}/${image_urls.length}: ${filename}`);
        
        // Cleanup: After successful upload, mark legacy import_queue_* images as duplicates
        // This prevents the gallery from showing both the old import_queue_* and new organization_import/ images
        if (fileHash && results.uploaded > 0) {
          try {
            // Find legacy import_queue images for this vehicle that might be duplicates
            const { data: legacyImages } = await supabase
              .from('vehicle_images')
              .select('id, file_hash, storage_path')
              .eq('vehicle_id', vehicle_id)
              .like('storage_path', '%/import_queue_%')
              .not('storage_path', 'like', '%/organization_import/%')
              .not('storage_path', 'like', '%/external_import/%')
              .eq('is_duplicate', false)
              .limit(50);
            
            for (const legacy of (legacyImages || []) as any[]) {
              const legacyHash = String(legacy?.file_hash || '').trim();
              const legacyPath = String(legacy?.storage_path || '');
              
              // If legacy image has same hash, mark as duplicate
              if (legacyHash && legacyHash === fileHash) {
                await supabase
                  .from('vehicle_images')
                  .update({ is_duplicate: true })
                  .eq('id', legacy.id)
                  .catch(() => null);
                console.log(`Marked legacy import_queue image as duplicate (same hash): ${legacyPath}`);
              }
            }
          } catch (cleanupErr) {
            // Non-blocking cleanup
            console.log(`Cleanup warning: ${(cleanupErr as any)?.message || String(cleanupErr)}`);
          }
        }

        // UPDATE: Ensure vehicle has primary_image_url set (robust fallback)
        // After first successful image upload, ensure vehicle.primary_image_url is set
        if (results.uploaded === 1 && imageRecord?.id) {
          try {
            const { data: vehicleCheck } = await supabase
              .from('vehicles')
              .select('primary_image_url, image_url')
              .eq('id', vehicle_id)
              .maybeSingle();

            // If vehicle has no primary image, set it from this upload
            if (!vehicleCheck?.primary_image_url) {
              await supabase
                .from('vehicles')
                .update({
                  primary_image_url: publicUrl,
                  image_url: publicUrl,
                  updated_at: new Date().toISOString()
                })
                .eq('id', vehicle_id);
              console.log(`✅ Set vehicle primary_image_url to first uploaded image`);
            }
          } catch (updateErr) {
            // Non-fatal - log but continue
            console.log(`⚠️  Failed to update vehicle primary_image_url: ${(updateErr as any)?.message || String(updateErr)}`);
          }
        }

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
                  user_id: null
                })
              }
            );

            if (analysisResponse.ok) {
              results.analyzed++;
            }
          } catch (analysisError) {
            console.log(`Analysis failed for image ${imageRecord.id}: ${(analysisError as any)?.message || String(analysisError)}`);
          }
        }

        // Rate limit
        if (sleep_ms > 0) {
          await new Promise(r => setTimeout(r, sleep_ms));
        }

      } catch (error) {
        console.log(`Error processing ${rawUrl}: ${(error as any)?.message || String(error)}`);
        results.failed++;
      }
    }

    console.log(`Backfill complete: ${results.uploaded} uploaded, ${results.failed} failed, ${results.analyzed} analyzed`);
    
    if (results.errors.length > 0) {
      console.log(`Errors encountered: ${results.errors.slice(0, 5).join('; ')}`);
    }

    // If requested, chain another backfill call to continue processing remaining images.
    // This is critical for dealer galleries with > max_images or when max_runtime_ms is hit.
    if (shouldContinue && chain_depth < 80) {
      try {
        const nextIndex = Math.max(0, Math.min(start_index, uniqueUrls.length)) + processed;
        if (nextIndex < uniqueUrls.length) {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill-images`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({
              vehicle_id,
              image_urls: uniqueUrls, // same canonical ordered list
              source,
              run_analysis,
              listed_date: imageDate,
              max_images,
              start_index: nextIndex,
              continue: true,
              chain_depth: chain_depth + 1,
              sleep_ms,
              max_runtime_ms,
            } satisfies BackfillRequest)
          }).catch(() => {});
        }
      } catch {
        // non-blocking
      }
    }

    return new Response(JSON.stringify({
      success: true,
      vehicle_id,
      ...results,
      start_index,
      next_index: Math.max(0, Math.min(start_index, uniqueUrls.length)) + processed,
      total_candidates: uniqueUrls.length,
      error_summary: results.errors.length > 0 ? results.errors.slice(0, 10) : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Backfill error:', error);
    const err = error as any;
    return new Response(JSON.stringify({
      success: false,
      error: err?.message || String(err)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

