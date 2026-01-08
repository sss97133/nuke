import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STORAGE_BUCKET = "vehicle-data";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { vehicle_id, batch_size = 5, delay_ms = 1000, limit = 1000 } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Query external images that haven't been downloaded yet
    let query = supabase
      .from("vehicle_images")
      .select("id, vehicle_id, image_url, position")
      .eq("is_external", true)
      .is("storage_path", null)
      .order("position", { ascending: true })
      .limit(limit);

    if (vehicle_id) {
      query = query.eq("vehicle_id", vehicle_id);
    }

    const { data: externalImages, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch external images: ${fetchError.message}`);
    }

    if (!externalImages || externalImages.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No external images found to download",
          downloaded: 0,
          errors: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(
      `📥 Found ${externalImages.length} external images to download. Processing in batches of ${batch_size} with ${delay_ms}ms delays...`
    );

    let downloaded = 0;
    const errors: string[] = [];
    const vehicleIds = new Set<string>();

    // Process in batches with delays
    for (let i = 0; i < externalImages.length; i += batch_size) {
      const batch = externalImages.slice(i, i + batch_size);
      const batchNum = Math.floor(i / batch_size) + 1;
      const totalBatches = Math.ceil(externalImages.length / batch_size);

      console.log(
        `📥 Processing batch ${batchNum}/${totalBatches} (${batch.length} images)...`
      );

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (img: any) => {
          try {
            const imageUrl = img.image_url;
            if (!imageUrl || !imageUrl.startsWith("http")) {
              return { success: false, error: "Invalid URL" };
            }

            // Download image with proper headers to bypass some hotlink protection
            const headers: HeadersInit = {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
            };
            
            // Add referrer for Cars & Bids and other auction sites
            if (imageUrl.includes('carsandbids.com')) {
              headers['Referer'] = 'https://carsandbids.com/';
            } else if (imageUrl.includes('bringatrailer.com')) {
              headers['Referer'] = 'https://bringatrailer.com/';
            } else if (imageUrl.includes('media.carsandbids.com')) {
              headers['Referer'] = 'https://carsandbids.com/';
            }
            
            const imageResponse = await fetch(imageUrl, {
              headers,
              signal: AbortSignal.timeout(30000), // 30 second timeout
            });

            if (!imageResponse.ok) {
              return {
                success: false,
                error: `HTTP ${imageResponse.status}`,
              };
            }

            const imageBlob = await imageResponse.blob();
            const arrayBuffer = await imageBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Determine file extension
            const contentType =
              imageResponse.headers.get("content-type") || "image/jpeg";
            const ext = contentType.includes("png")
              ? "png"
              : contentType.includes("webp")
              ? "webp"
              : "jpg";

            // Generate storage path
            const fileName = `${Date.now()}_${img.id}.${ext}`;
            const storagePath = `vehicles/${img.vehicle_id}/images/external_import/${fileName}`;

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
              .from(STORAGE_BUCKET)
              .upload(storagePath, uint8Array, {
                contentType: contentType,
                cacheControl: "3600",
                upsert: false,
              });

            if (uploadError) {
              return { success: false, error: uploadError.message };
            }

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
              .from(STORAGE_BUCKET)
              .getPublicUrl(storagePath);

            // Update vehicle_images record with storage path and remove is_external flag
            const { error: updateError } = await supabase
              .from("vehicle_images")
              .update({
                image_url: publicUrl,
                storage_path: storagePath,
                is_external: false,
                updated_at: new Date().toISOString(),
              })
              .eq("id", img.id);

            if (updateError) {
              return { success: false, error: updateError.message };
            }

            vehicleIds.add(img.vehicle_id);
            return { success: true };
          } catch (e: any) {
            return { success: false, error: e?.message || String(e) };
          }
        })
      );

      // Count successes and errors
      let batchDownloaded = 0;
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value.success) {
          batchDownloaded++;
          downloaded++;
        } else {
          const errorMsg =
            result.status === "rejected"
              ? result.reason?.message || "Unknown error"
              : result.value.error || "Unknown error";
          errors.push(`Image ${batch[batchResults.indexOf(result)]?.id}: ${errorMsg}`);
        }
      }

      console.log(
        `✅ Batch ${batchNum}/${totalBatches} complete: ${batchDownloaded}/${batch.length} downloaded`
      );

      // Delay between batches (except for the last batch)
      if (i + batch_size < externalImages.length) {
        await new Promise((resolve) => setTimeout(resolve, delay_ms));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Downloaded ${downloaded}/${externalImages.length} images`,
        downloaded,
        total: externalImages.length,
        vehicles_affected: Array.from(vehicleIds),
        errors: errors.slice(0, 50), // Limit errors in response
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Download error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

