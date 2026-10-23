/**
 * paperwork-intake — the phone's Paperwork scan mode lands pages on the documents path.
 *
 * One call = one scanned page. The function (service role) does what the phone cannot: the
 * deal-documents bucket and document_ocr_queue accept writes from the service role only.
 *   1. upload the image to deal-documents at documents/YYYY/MM/DD/paperwork_… (private bucket)
 *   2. insert a pending document_ocr_queue row → document-ocr-worker classifies/extracts/links it
 *   3. insert paperwork_page_evidence: scan time, on-device OCR text, the date HINT, and the label-card
 *      batch as soft cited evidence. The worker stays authoritative for document type and date.
 * Never writes vehicle_images or capture sets. Idempotent on client_page_id (the phone retries).
 * Callers: an active admin (the bucket is admin-read) or the service key.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { authenticateWriter, requireAdminOrService, requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { BUCKET, decodeBase64, evidenceRow, MAX_BYTES, queueRow, storagePath, validate } from "./contract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const notAdmin = await requireAdminOrService(req, { headers: corsHeaders });
  if (notAdmin) return notAdmin;

  const verdict = await authenticateWriter(req);
  const userId = verdict.ok && verdict.caller.kind === "user" ? verdict.caller.userId : null;

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  const v = validate(body);
  if (!v.ok) return json(400, { error: v.error });
  const page = v.page;

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", projectSecretKey() ?? "");

  // Retry of a page already landed: answer with what exists.
  const { data: existing, error: readErr } = await supabase
    .from("paperwork_page_evidence")
    .select("storage_path, document_ocr_queue_id")
    .eq("client_page_id", page.client_page_id)
    .maybeSingle();
  if (readErr) return json(500, { error: `evidence read: ${readErr.message}` });
  if (existing) return json(200, { ok: true, duplicate: true, ...existing });

  let bytes: Uint8Array;
  try { bytes = decodeBase64(page.image_base64); } catch { return json(400, { error: "image_base64 is not base64" }); }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return json(413, { error: "image size out of range" });

  const path = storagePath(page, new Date());
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: page.content_type, upsert: true });
  if (up.error) return json(502, { error: `storage: ${up.error.message}` });

  const { data: q, error: qErr } = await supabase.from("document_ocr_queue").insert(queueRow(path)).select("id").single();
  if (qErr || !q) return json(500, { error: `queue: ${qErr?.message ?? "no row"}` });

  const { error: eErr } = await supabase.from("paperwork_page_evidence").insert(evidenceRow(page, path, q.id, userId));
  if (eErr) {
    // Unique violation = a concurrent retry won; drop our duplicate queue row so the worker reads the page once.
    await supabase.from("document_ocr_queue").delete().eq("id", q.id);
    if (eErr.code === "23505") return json(200, { ok: true, duplicate: true });
    return json(500, { error: `evidence: ${eErr.message}` });
  }
  return json(200, { ok: true, storage_path: path, document_ocr_queue_id: q.id });
});
