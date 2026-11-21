import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405 });
  }

  try {
    const body = await req.json();
    const { vehicle_id, facebook_id, image_urls, images } = body;

    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: "Required: vehicle_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const timestamp = Date.now();
    const results: any[] = [];

    // Mode 1: Server-side fetch from URLs (preferred — avoids CSP issues)
    if (image_urls && Array.isArray(image_urls) && image_urls.length > 0) {
      for (let i = 0; i < image_urls.length; i++) {
        try {
          const resp = await fetch(image_urls[i]);
          if (!resp.ok) {
            results.push({ index: i, success: false, error: `HTTP ${resp.status}` });
            continue;
          }
          const blob = await resp.blob();
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const path = `${vehicle_id}/fb-marketplace/${timestamp}-${i}.jpg`;

          const { error } = await supabase.storage
            .from("vehicle-photos")
            .upload(path, bytes, { contentType: "image/jpeg", upsert: true });

          if (error) {
            results.push({ index: i, success: false, error: error.message });
          } else {
            const { data: urlData } = supabase.storage
              .from("vehicle-photos")
              .getPublicUrl(path);
            results.push({ index: i, success: true, path, public_url: urlData.publicUrl });
          }
        } catch (e: any) {
          results.push({ index: i, success: false, error: e.message });
        }
      }
    }

    // Mode 2: Base64 images (direct upload)
    if (images && Array.isArray(images) && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        try {
          const b64 = images[i];
          const raw = b64.includes(",") ? b64.split(",")[1] : b64;
          const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
          const path = `${vehicle_id}/fb-marketplace/${timestamp}-${results.length + i}.jpg`;

          const { error } = await supabase.storage
            .from("vehicle-photos")
            .upload(path, bytes, { contentType: "image/jpeg", upsert: true });

          if (error) {
            results.push({ index: i, success: false, error: error.message });
          } else {
            const { data: urlData } = supabase.storage
              .from("vehicle-photos")
              .getPublicUrl(path);
            results.push({ index: i, success: true, path, public_url: urlData.publicUrl });
          }
        } catch (e: any) {
          results.push({ index: i, success: false, error: e.message });
        }
      }
    }

    return new Response(
      JSON.stringify({
        vehicle_id,
        uploaded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});