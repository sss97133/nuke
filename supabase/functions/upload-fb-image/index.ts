/**
 * Upload FB images — accepts encoded URLs, downloads server-side, stores in Supabase.
 * Two modes:
 *   1. encoded_urls: [{ host, path, params_b64 }] — server fetches + stores
 *   2. base64 images: [{ base64, index }] — direct upload
 * Caller: the service key only. It adds vehicle_images rows and can set a vehicle's first photo.
 * Recovered from the deployed bundle (version 36); CI deploys this folder.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isServiceCaller, requireWriteAuth, writeAuthResponse } from "../_shared/writeGuard.ts";
import { softWrite } from "../_shared/writeResult.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// The storage path and the vehicle_images row start from the vehicle id, so it has to be one.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// One photo's outcome: stored (ok, with a warning when the vehicle's first-photo update failed), skipped or failed.
type PhotoResult = { index: number; ok?: boolean; size?: number; url?: string; skip?: string; error?: string; warning?: string };

async function downloadAndStore(imageUrl: string, vehicleId: string, index: number): Promise<PhotoResult> {
  const resp = await fetch(imageUrl, { // guardrail-allow: raw-fetch (binary image)
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return { index, error: `HTTP ${resp.status}` };
  
  const buffer = new Uint8Array(await resp.arrayBuffer());
  if (buffer.length < 5000) return { index, skip: "too small" };
  
  const ext = resp.headers.get("content-type")?.includes("png") ? "png" : "jpg";
  const storagePath = `${vehicleId}/fb-marketplace/${Date.now()}-${index}.${ext}`;
  
  const { error: uploadErr } = await supabase.storage
    .from("vehicle-photos")
    .upload(storagePath, buffer, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`, upsert: false });
  
  if (uploadErr) return { index, error: uploadErr.message };
  
  const { data: pubData } = supabase.storage.from("vehicle-photos").getPublicUrl(storagePath);
  const publicUrl = pubData?.publicUrl;
  
  // Create vehicle_images record. A failed row is this photo's failure: the answer says so and names the stored file.
  const rowErr = softWrite("vehicle_images insert", await supabase.from("vehicle_images").insert({
    vehicle_id: vehicleId,
    image_url: publicUrl,
    storage_path: storagePath,
    source: "fb-saved-chrome",
    is_external: false,
    is_primary: index === 0,
    mime_type: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
    file_size: buffer.length,
  }));
  if (rowErr) return { index, error: `${rowErr}; the file is stored at ${storagePath}` };

  // Set primary_image_url if first. A failure here leaves the photo in place and is reported beside it.
  let warning: string | null = null;
  if (index === 0) {
    warning = softWrite("vehicles primary_image_url update", await supabase.from("vehicles")
      .update({ primary_image_url: publicUrl })
      .eq("id", vehicleId)
      .is("primary_image_url", null));
  }

  return { index, ok: true, size: buffer.length, url: publicUrl, warning: warning ?? undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // The caller is judged before the body: only the service key passes. This function fetches the URLs it is
  // handed, stores the bytes in the public photo bucket and writes vehicle_images rows with the service role.
  const denied = await requireWriteAuth(req, { headers: corsHeaders });
  if (denied) return denied;
  if (!(await isServiceCaller(req))) {
    return writeAuthResponse({ status: 403, reason: "service key required" }, corsHeaders);
  }
  
  try {
    const body = await req.json();
    const { vehicle_id, encoded_urls, images } = body;
    
    if (!vehicle_id) return json({ error: "vehicle_id required" }, 400);
    if (typeof vehicle_id !== "string" || !UUID.test(vehicle_id)) {
      return json({ error: "vehicle_id must be a vehicle id" }, 400);
    }
    
    const results: PhotoResult[] = [];
    
    // Mode 1: Encoded URLs — reconstruct and fetch server-side
    if (encoded_urls?.length) {
      for (let i = 0; i < encoded_urls.length; i++) {
        const { host, path, params } = encoded_urls[i];
        try {
          const search = atob(params);
          const fullUrl = `https://${host}${path}${search}`;
          const result = await downloadAndStore(fullUrl, vehicle_id, i);
          results.push(result);
        } catch (e: any) {
          results.push({ index: i, error: e.message });
        }
      }
    }
    
    // Mode 2: Base64 images — direct upload
    if (images?.length) {
      for (const img of images) {
        const { base64, index = 0 } = img;
        if (!base64) continue;
        try {
          const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          if (buffer.length < 5000) { results.push({ index, skip: "too small" }); continue; }
          
          const storagePath = `${vehicle_id}/fb-marketplace/${Date.now()}-${index}.jpg`;
          const { error: uploadErr } = await supabase.storage
            .from("vehicle-photos")
            .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });
          
          if (uploadErr) { results.push({ index, error: uploadErr.message }); continue; }
          
          const { data: pubData } = supabase.storage.from("vehicle-photos").getPublicUrl(storagePath);
          const rowErr = softWrite("vehicle_images insert", await supabase.from("vehicle_images").insert({
            vehicle_id, image_url: pubData?.publicUrl, storage_path: storagePath,
            source: "fb-saved-chrome", is_external: false, is_primary: index === 0,
            mime_type: "image/jpeg", file_size: buffer.length,
          }));
          if (rowErr) { results.push({ index, error: `${rowErr}; the file is stored at ${storagePath}` }); continue; }
          let warning: string | null = null;
          if (index === 0) {
            warning = softWrite("vehicles primary_image_url update", await supabase.from("vehicles")
              .update({ primary_image_url: pubData?.publicUrl })
              .eq("id", vehicle_id).is("primary_image_url", null));
          }
          results.push({ index, ok: true, size: buffer.length, url: pubData?.publicUrl, warning: warning ?? undefined });
        } catch (e: any) {
          results.push({ index, error: e.message });
        }
      }
    }
    
    return json({
      uploaded: results.filter(r => r.ok).length,
      skipped: results.filter(r => r.skip).length,
      failed: results.filter(r => r.error).length,
      total: results.length,
      results
    });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
