/**
 * Upload FB images — accepts encoded URLs, downloads server-side, stores in Supabase.
 * Two modes:
 *   1. encoded_urls: [{ host, path, params_b64 }] — server fetches + stores
 *   2. base64 images: [{ base64, index }] — direct upload
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function downloadAndStore(imageUrl: string, vehicleId: string, index: number) {
  const resp = await fetch(imageUrl, {
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
  
  // Create vehicle_images record
  await supabase.from("vehicle_images").insert({
    vehicle_id: vehicleId,
    image_url: publicUrl,
    storage_path: storagePath,
    source: "fb-saved-chrome",
    is_external: false,
    is_primary: index === 0,
    mime_type: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
    file_size: buffer.length,
  });
  
  // Set primary_image_url if first
  if (index === 0) {
    await supabase.from("vehicles")
      .update({ primary_image_url: publicUrl })
      .eq("id", vehicleId)
      .is("primary_image_url", null);
  }
  
  return { index, ok: true, size: buffer.length, url: publicUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  
  try {
    const body = await req.json();
    const { vehicle_id, encoded_urls, images } = body;
    
    if (!vehicle_id) return json({ error: "vehicle_id required" }, 400);
    
    const results = [];
    
    // Mode 1: Encoded URLs — reconstruct and fetch server-side
    if (encoded_urls?.length) {
      for (let i = 0; i < encoded_urls.length; i++) {
        const { host, path, params } = encoded_urls[i];
        try {
          const search = atob(params);
          const fullUrl = `https://${host}${path}${search}`;
          const result = await downloadAndStore(fullUrl, vehicle_id, i);
          results.push(result);
        } catch(e) {
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
          await supabase.from("vehicle_images").insert({
            vehicle_id, image_url: pubData?.publicUrl, storage_path: storagePath,
            source: "fb-saved-chrome", is_external: false, is_primary: index === 0,
            mime_type: "image/jpeg", file_size: buffer.length,
          });
          if (index === 0) {
            await supabase.from("vehicles").update({ primary_image_url: pubData?.publicUrl })
              .eq("id", vehicle_id).is("primary_image_url", null);
          }
          results.push({ index, ok: true, size: buffer.length, url: pubData?.publicUrl });
        } catch(e) {
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
  } catch(e) {
    return json({ error: e.message }, 500);
  }
});
