// receipt-photo-ocr: the photo pipeline's document route (see core.ts for what it does and why).
// Called by photo-pipeline-orchestrator for every frame classified receipt_document, and by
// scripts/photo-pipeline/reroute-document-frames.mjs for the frames that failed while this function did not exist.
// POST { image_id, image_url?, vehicle_id?, user_id?, document_type_hint? } with the service key or the owner's session.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { type CapturePageRow, type Deps, handle, type LandDocumentResult, type LandEnvelope } from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = projectSecretKey() ?? "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function callFn(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${name} returned ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const deps: Deps = {
  frame: async (imageId) => {
    const { data, error } = await supabase.from("vehicle_images").select("id, user_id, vehicle_id, image_url, thumbnail_url, file_name, taken_at").eq("id", imageId).maybeSingle();
    if (error) throw new Error(`vehicle_images read failed: ${error.message}`);
    return data;
  },
  existingPage: async (imageId) => {
    const { data, error } = await supabase.from("capture_document_pages").select("doc_type, extraction, class_conf, doc_date, run_id").eq("image_id", imageId).is("revoked_at", null).maybeSingle();
    if (error) throw new Error(`capture_document_pages read failed: ${error.message}`);
    return data;
  },
  classify: async (url) => {
    const r = await callFn("document-ocr-worker", { mode: "classify", storage_path: url });
    return { document_type: String(r.document_type ?? "other"), confidence: Number(r.confidence ?? 0) };
  },
  extract: (url, docType) => callFn("document-ocr-worker", { mode: "extract", storage_path: url, document_type_hint: docType }),
  fetchBytes: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`frame fetch failed: ${r.status}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get("content-type") ?? "" };
  },
  upload: async (path, bytes, contentType) => {
    const { error } = await supabase.storage.from("user-documents").upload(path, bytes, { contentType, upsert: true });
    return { error: error ? error.message : null };
  },
  upsertPage: async (row: CapturePageRow) => {
    const { error } = await supabase.from("capture_document_pages").upsert(row, { onConflict: "image_id" });
    return { error: error ? error.message : null };
  },
  land: async (owner, vehicle, run, docs: LandEnvelope) => {
    const { data, error } = await supabase.rpc("land_document_pages", { p_owner: owner, p_vehicle: vehicle, p_run: run, p_docs: docs });
    if (error) return { landed: 0, duplicates: 0, errors: 1, documents: [{ error: error.message }] } as LandDocumentResult;
    return data as LandDocumentResult;
  },
  bridge: async (receiptId) => {
    await callFn("ingest-receipts-as-observations", { receipt_id: receiptId, batch_size: 1, dry_run: false });
  },
  env: (n) => Deno.env.get(n),
  now: () => new Date(),
  runId: () => crypto.randomUUID(),
  sha256: sha256Hex,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const result = await handle(body, deps);
    return new Response(JSON.stringify({ ...result, duration_ms: Date.now() - started }), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[receipt-photo-ocr]", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message, page: false, landed: false, line_items_count: 0, parts_found: 0 }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
