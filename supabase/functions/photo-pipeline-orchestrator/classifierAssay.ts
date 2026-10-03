import { authenticateWriter } from "../_shared/writeGuard.ts";
import { classifyImage } from "./classifier.ts";
import { corsHeaders } from "../_shared/cors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const listingUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["bringatrailer.com", "www.bringatrailer.com"].includes(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/listing\/[^/]+\/?$/.test(url.pathname)
      ? url.href.replace(/\/$/, "") : null;
  } catch { return null; }
};
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body,
  { status, headers: { ...corsHeaders, "Cache-Control": "no-store" } });

/** A service-only, one-image provider qualification. No processing or evidence writes. */
export async function runClassifierAssay(req: Request, input: unknown, supabase: any): Promise<Response> {
  const auth = await authenticateWriter(req);
  if (!auth.ok) return reply({ success: false, error: "unauthorized" }, auth.status);
  if (auth.caller.kind !== "service_role") return reply({ success: false, error: "service_role_required" }, 403);
  if (req.method !== "POST" || !input || typeof input !== "object" || Array.isArray(input)) {
    return reply({ success: false, error: "classifier_assay_input_invalid" }, 400);
  }
  const body = input as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "action,image_id" || body.action !== "classifier_assay" ||
    typeof body.image_id !== "string" || !UUID.test(body.image_id)) {
    return reply({ success: false, error: "classifier_assay_input_invalid" }, 400);
  }
  try {
    // The primary-key equality bounds the computed predicate to one canonical row.
    const { data: image, error: imageError } = await supabase.from("vehicle_images")
      .select("id,vehicle_id,image_url,source,is_external,is_sensitive,is_approved,approval_status,verification_status,redaction_level,is_document,is_duplicate,is_superseded,exif_data,vehicle_image_gallery_eligible")
      .eq("id", body.image_id).eq("vehicle_image_gallery_eligible", true)
      .abortSignal(AbortSignal.timeout(3000)).maybeSingle();
    if (imageError) return reply({ success: false, error: "classifier_assay_source_read_failed" }, 503);
    if (!image || image.id !== body.image_id || !UUID.test(image.vehicle_id ?? "") ||
      image.vehicle_image_gallery_eligible !== true || image.source !== "bat_import" || image.is_external !== true ||
      image.is_sensitive === true || image.is_document === true || image.is_duplicate === true || image.is_superseded === true ||
      image.is_approved !== true || !["approved", "auto_approved"].includes(image.approval_status) ||
      image.verification_status !== "approved" || image.redaction_level !== "none") {
      return reply({ success: false, error: "classifier_assay_source_ineligible" }, 403);
    }
    let url: URL;
    try { url = new URL(image.image_url); } catch { return reply({ success: false, error: "classifier_assay_source_ineligible" }, 403); }
    if (url.protocol !== "https:" || !["bringatrailer.com", "www.bringatrailer.com"].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash || !url.pathname.startsWith("/wp-content/uploads/")) {
      return reply({ success: false, error: "classifier_assay_source_ineligible" }, 403);
    }
    const exif = image.exif_data ?? {};
    const provenance = [exif.discovery_url, exif.source_url,
      ...(Array.isArray(exif.listing_urls) ? exif.listing_urls.slice(0, 16) : [])]
      .map(listingUrl).filter((v): v is string => !!v);
    const listings = [...new Set(provenance.flatMap(v => [v, `${v}/`]))];
    if (!listings.length) return reply({ success: false, error: "classifier_assay_provenance_missing" }, 403);
    const { data: vehicle, error: vehicleError } = await supabase.from("vehicles").select("id,is_public")
      .eq("id", image.vehicle_id).eq("is_public", true).abortSignal(AbortSignal.timeout(3000)).maybeSingle();
    if (vehicleError) return reply({ success: false, error: "classifier_assay_vehicle_read_failed" }, 503);
    if (!vehicle || vehicle.id !== image.vehicle_id || vehicle.is_public !== true) {
      return reply({ success: false, error: "classifier_assay_vehicle_private" }, 403);
    }
    const { data: event, error: eventError } = await supabase.from("auction_events").select("id,vehicle_id,source,source_url")
      .eq("vehicle_id", image.vehicle_id).eq("source", "bat").in("source_url", listings).limit(1)
      .abortSignal(AbortSignal.timeout(3000)).maybeSingle();
    if (eventError) return reply({ success: false, error: "classifier_assay_event_read_failed" }, 503);
    if (!event || !UUID.test(event.id ?? "") || event.vehicle_id !== image.vehicle_id || event.source !== "bat" ||
      !provenance.includes(listingUrl(event.source_url) ?? "")) {
      return reply({ success: false, error: "classifier_assay_provenance_mismatch" }, 403);
    }
    // Keep the actual production model and key precedence; never try another key/model on failure.
    const result = await classifyImage(image.image_url,
      Deno.env.get("GOOGLE_AI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ??
      Deno.env.get("GOOGLE_API_KEY") ?? Deno.env.get("free_api_key"));
    const ok = result.classifier_ok === true;
    return reply({ success: ok, mode: "classifier_assay", image_id: image.id, vehicle_id: image.vehicle_id,
      auction_event_id: event.id, image_url: image.image_url, source_url: event.source_url,
      classification: ok ? result : null, classifier_receipt: result.classifier_receipt ?? null,
      classifier_ok: ok, db_writes: 0, downstream_calls: 0, state_persisted: false }, ok ? 200 : 502);
  } catch {
    return reply({ success: false, error: "classifier_assay_operation_failed", db_writes: 0, downstream_calls: 0 }, 503);
  }
}
