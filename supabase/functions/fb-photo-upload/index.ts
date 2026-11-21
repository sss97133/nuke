/**
 * Store listing photos in the vehicle-photos bucket under <vehicle_id>/fb-marketplace/.
 * Two modes: image_urls (fetched here) and images (base64). Writes no database row.
 * Caller: the service key only. A page cannot call this; a script on the operator's machine does.
 * Recovered from the deployed bundle (version 37); CI deploys this folder.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isServiceCaller, requireWriteAuth, writeAuthResponse } from "../_shared/writeGuard.ts";

// The storage path starts with the vehicle id, so it has to be one.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  // The caller is judged before the method and the body: only the service key passes. This function fetches the
  // URLs it is handed and stores the bytes in the public photo bucket with the service role.
  const denied = await requireWriteAuth(req, { headers: corsHeaders });
  if (denied) return denied;
  if (!(await isServiceCaller(req))) {
    return writeAuthResponse({ status: 403, reason: "service key required" }, corsHeaders);
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
    if (typeof vehicle_id !== "string" || !UUID.test(vehicle_id)) {
      return new Response(
        JSON.stringify({ error: "vehicle_id must be a vehicle id" }),
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
          const resp = await fetch(image_urls[i]); // guardrail-allow: raw-fetch (binary image)
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