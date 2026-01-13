import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const allowedCategories = new Set([
  "audio",
  "brakes",
  "consumables",
  "cooling",
  "electrical",
  "engine",
  "exhaust",
  "exterior",
  "fee",
  "fuel_system",
  "hardware",
  "hvac",
  "interior",
  "labor",
  "lighting",
  "maintenance",
  "paint",
  "safety",
  "shipping",
  "storage",
  "suspension",
  "tax",
  "tools",
  "transmission",
]);

const autoCategory = (desc?: string): string | null => {
  const d = (desc || "").toLowerCase();
  if (/labor|install|installation|service|hour|hrs\b/.test(d)) return "labor";
  if (/engine|motor|intake|radiator|coolant|filter|spark/.test(d)) return "engine";
  if (/brake|pad|rotor|caliper|master/.test(d)) return "brakes";
  if (/suspension|shock|spring|coilover|strut/.test(d)) return "suspension";
  if (/transmission|clutch|gear|drivetrain/.test(d)) return "transmission";
  if (/tire|wheel|rim/.test(d)) return "tools";
  if (/body|panel|fender|hood|bumper|paint|wrap/.test(d)) return "paint";
  if (/interior|seat|trim|dash|carpet|stereo/.test(d)) return "interior";
  if (/electrical|wiring|harness|battery|alternator/.test(d)) return "electrical";
  if (/fuel|gas|tank|pump|injector/.test(d)) return "fuel_system";
  if (/exhaust|muffler|pipe|header/.test(d)) return "exhaust";
  if (/cooling|radiator|thermostat|water\s*pump/.test(d)) return "cooling";
  if (/hvac|heating|air\s*conditioning|\bac\b|climate/.test(d)) return "hvac";
  if (/light|bulb|led|halogen/.test(d)) return "lighting";
  if (/audio|speaker|radio|head\s*unit/.test(d)) return "audio";
  if (/safety|airbag|seatbelt|sensor/.test(d)) return "safety";
  if (/maintenance|oil|fluid/.test(d)) return "maintenance";
  if (/tax\b|taxes\b/.test(d)) return "tax";
  if (/fee\b|fees\b|charge\b|charges\b/.test(d)) return "fee";
  if (/shipping|freight|delivery/.test(d)) return "shipping";
  if (/storage\b/.test(d)) return "storage";
  return null;
};

const normalizeCategory = (raw: unknown, desc?: string): string | null => {
  const r = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (r && allowedCategories.has(r)) return r;
  const inferred = autoCategory(desc);
  if (inferred && allowedCategories.has(inferred)) return inferred;
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    const vehicleId = String(body.vehicleId || body.vehicle_id || "").trim();
    const limitRaw = Number(body.limit ?? body.batch_size ?? 5);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 5, 15));
    const dryRun = body.dry_run === true;
    const retryFailed = body.retry_failed === true;

    if (!isUuid(vehicleId)) {
      return new Response(JSON.stringify({ success: false, error: "vehicleId must be a UUID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    // Use service key for DB writes, but the request JWT for auth.getUser.
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const authedUserId = !userErr ? userRes?.user?.id || null : null;
    if (!authedUserId) {
      return new Response(JSON.stringify({ success: false, error: "Unable to resolve authenticated user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ownership gate
    const { data: vehicle, error: vehicleErr } = await supabase
      .from("vehicles")
      .select("id,user_id,owner_id,uploaded_by")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vehicleErr) throw vehicleErr;
    if (!vehicle) {
      return new Response(JSON.stringify({ success: false, error: "Vehicle not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const owners = [vehicle.user_id, vehicle.owner_id, vehicle.uploaded_by].filter((x) => typeof x === "string") as string[];
    if (!owners.includes(authedUserId)) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load vehicle documents (cap to avoid runaway)
    const { data: docs, error: docsErr } = await supabase
      .from("vehicle_documents")
      .select("id,file_url,file_type,title,created_at")
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (docsErr) throw docsErr;
    const docList: any[] = Array.isArray(docs) ? docs : [];

    // Load existing receipts for these docs
    const { data: existingReceipts, error: receiptsErr } = await supabase
      .from("receipts")
      .select("id,source_document_id,processing_status")
      .eq("source_document_table", "vehicle_documents")
      .eq("scope_type", "vehicle")
      .eq("scope_id", vehicleId)
      .limit(2000);
    if (receiptsErr) throw receiptsErr;
    const receiptRows: any[] = Array.isArray(existingReceipts) ? existingReceipts : [];
    const receiptByDocId = new Map<string, any>();
    for (const r of receiptRows) {
      if (r?.source_document_id) receiptByDocId.set(String(r.source_document_id), r);
    }

    const remainingDocs = docList.filter((d) => {
      const rec = receiptByDocId.get(String(d?.id || ""));
      if (!rec) return true;
      if (retryFailed && String(rec.processing_status || "").toLowerCase() === "failed") return true;
      return false;
    });

    const batchDocs = remainingDocs.slice(0, limit);
    const results: any[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const doc of batchDocs) {
      const documentId = String(doc.id || "");
      const fileUrl = typeof doc.file_url === "string" ? doc.file_url : "";
      const mimeType = typeof doc.file_type === "string" && doc.file_type ? doc.file_type : "application/octet-stream";

      if (!documentId || !fileUrl) {
        failed++;
        results.push({ document_id: documentId || null, status: "failed", error: "Missing document id or file_url" });
        continue;
      }

      if (dryRun) {
        results.push({ document_id: documentId, status: "dry_run" });
        continue;
      }

      let parsed: any = null;
      let extractError: string | null = null;
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/receipt-extract`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ url: fileUrl, mimeType }),
        });
        const text = await resp.text();
        if (!resp.ok) throw new Error(`receipt-extract HTTP ${resp.status}: ${text}`);
        parsed = text ? JSON.parse(text) : null;
        if (parsed && typeof parsed === "object" && parsed.error) throw new Error(String(parsed.error));
      } catch (e: any) {
        extractError = e?.message || String(e);
      }

      // Create or update receipt row (so we don't retry forever)
      const receiptPayload: Record<string, unknown> = {
        user_id: authedUserId,
        file_url: fileUrl,
        file_name: typeof doc.title === "string" ? doc.title : null,
        file_type: mimeType,
        scope_type: "vehicle",
        scope_id: vehicleId,
        vehicle_id: vehicleId,
        source_document_table: "vehicle_documents",
        source_document_id: documentId,
        created_by: authedUserId,
        status: "processed",
        // Align with DB functions (e.g. compute_vehicle_value) which treat 'parsed' as a valid parsed receipt state
        processing_status: extractError ? "failed" : "parsed",
        vendor_name: parsed?.vendor_name || null,
        receipt_date: parsed?.receipt_date || null,
        transaction_date: parsed?.receipt_date || null,
        currency: parsed?.currency || "USD",
        subtotal: parsed?.subtotal ?? null,
        tax: parsed?.tax ?? null,
        total: parsed?.total ?? null,
        tax_amount: parsed?.tax ?? null,
        total_amount: parsed?.total ?? null,
        invoice_number: parsed?.invoice_number || null,
        purchase_order: parsed?.purchase_order || null,
        raw_json: parsed?.raw_json || parsed || null,
        extraction_errors: extractError ? [extractError] : null,
      };

      const existing = receiptByDocId.get(documentId);
      let receiptId: string | null = null;
      try {
        if (existing?.id) {
          const { data: upd, error: updErr } = await supabase
            .from("receipts")
            .update({ ...receiptPayload, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
            .select("id")
            .single();
          if (updErr) throw updErr;
          receiptId = String(upd.id);

          if (retryFailed) {
            // Clear old items to avoid duplication
            await supabase.from("receipt_items").delete().eq("receipt_id", receiptId);
          }
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("receipts")
            .insert(receiptPayload)
            .select("id")
            .single();
          if (insErr) throw insErr;
          receiptId = String(ins.id);
          receiptByDocId.set(documentId, { id: receiptId, source_document_id: documentId, processing_status: receiptPayload.processing_status });
        }
      } catch (e: any) {
        failed++;
        results.push({ document_id: documentId, status: "failed", stage: "receipt_write", error: e?.message || String(e) });
        continue;
      }

      // Insert receipt items (best-effort)
      let itemCount = 0;
      if (!extractError && receiptId && Array.isArray(parsed?.items) && parsed.items.length > 0) {
        const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : null;
        const rows = parsed.items.map((it: any) => {
          const desc = String(it?.description || "").trim() || "Line item";
          const qty = typeof it?.quantity === "number" ? it.quantity : null;
          const unit = typeof it?.unit_price === "number" ? it.unit_price : null;
          const explicitTotal = typeof it?.total_price === "number" ? it.total_price : null;
          const computedTotal = qty !== null && unit !== null ? qty * unit : null;
          const lineTotal = explicitTotal ?? computedTotal ?? 0;
          return {
            receipt_id: receiptId,
            vehicle_id: vehicleId,
            description: desc,
            part_number: it?.part_number ? String(it.part_number) : null,
            sku: it?.vendor_sku ? String(it.vendor_sku) : null,
            category: normalizeCategory(it?.category, desc),
            quantity: qty,
            unit_price: unit,
            line_total: lineTotal,
            extracted_by_ai: true,
            confidence_score: confidence,
          };
        });

        const { error: itemsErr } = await supabase.from("receipt_items").insert(rows as any);
        if (itemsErr) {
          failed++;
          results.push({ document_id: documentId, receipt_id: receiptId, status: "failed", stage: "items_write", error: itemsErr.message });
          continue;
        }
        itemCount = rows.length;
      }

      // Update vehicle_documents with quick ledger summary
      try {
        await supabase
          .from("vehicle_documents")
          .update({
            vendor_name: parsed?.vendor_name || null,
            amount: typeof parsed?.total === "number" ? parsed.total : null,
            currency: parsed?.currency || "USD",
            updated_at: new Date().toISOString(),
          })
          .eq("id", documentId);
      } catch {
        // ignore
      }

      succeeded++;
      results.push({
        document_id: documentId,
        receipt_id: receiptId,
        status: extractError ? "failed" : "processed",
        items: itemCount,
        error: extractError,
      });
      if (extractError) failed++;
    }

    return new Response(
      JSON.stringify(
        {
          success: true,
          vehicle_id: vehicleId,
          total_docs: docList.length,
          existing_receipts: receiptRows.length,
          processed_in_batch: batchDocs.length,
          succeeded,
          failed,
          remaining: Math.max(0, remainingDocs.length - batchDocs.length),
          duration_ms: Date.now() - startedAt,
          results,
        },
        null,
        2,
      ),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

