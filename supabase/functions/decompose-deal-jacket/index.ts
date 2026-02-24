/**
 * DECOMPOSE DEAL JACKET
 *
 * Takes forensic extraction data from a deal jacket and fans it out into
 * granular observations on the vehicle timeline:
 *   - specification (vehicle identity snapshot)
 *   - ownership × 2 (acquisition in + sale out)
 *   - sale_result (complete transaction financials)
 *   - work_record × N (each recon line item)
 *   - provenance (the document itself)
 *
 * Also creates timeline events (purchase + sale) and enriches the vehicle row.
 *
 * Called by link-document-entities when document_type === 'deal_jacket'.
 *
 * POST /functions/v1/decompose-deal-jacket
 * {
 *   extraction_data: { extracted_data: {...}, confidences: {...} },
 *   vehicle_id: string,
 *   storage_path: string,
 *   queue_id?: string
 * }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ─── FORMAT NORMALIZATION ──────────────────────────────────────────────────
// Handle both forensic (nested) and standard OCR (flat) extraction formats.

interface NormalizedDeal {
  stock_number: string | null;
  deal_number: string | null;
  sold_date: string | null;
  acquisition_date: string | null;
  // Vehicle
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  series: string | null;
  vin: string | null;
  odometer: number | null;
  color: string | null;
  engine: string | null;
  // Acquisition
  consignor_name: string | null;
  consignor_address: string | null;
  acquisition_type: string | null; // 'consignment' | 'purchase'
  purchase_cost: number | null;
  // Sale
  buyer_name: string | null;
  buyer_address: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  sale_price: number | null;
  salesperson: string | null;
  // Fees
  document_fee: number | null;
  handling_fee: number | null;
  title_fee: number | null;
  permit_fee: number | null;
  smog_fee: number | null;
  tax: number | null;
  total_proceeds: number | null;
  total_cost: number | null;
  gross_profit: number | null;
  consignment_rate: number | null;
  // Recon
  recon_items: { description: string; amount: number; vendor_name: string | null }[];
}

function normalizeExtraction(raw: any): NormalizedDeal {
  // Detect forensic format by presence of nested sections
  const isForensic = !!(raw.deal_header || raw.acquisition || raw.reconditioning?.line_items);

  if (isForensic) {
    return normalizeForensic(raw);
  }
  return normalizeStandard(raw);
}

function normalizeForensic(raw: any): NormalizedDeal {
  const h = raw.deal_header || {};
  const v = raw.vehicle || {};
  const a = raw.acquisition || {};
  const s = raw.sale || {};
  const p = raw.profit || {};
  const r = raw.reconditioning || {};

  // Infer acquisition type from field presence
  const hasConsignment = !!(h.consignment_date || h.consignor_name ||
    (h.seller_entity && /consign/i.test(JSON.stringify(raw))));

  return {
    stock_number: h.stock_number || null,
    deal_number: h.deal_number || null,
    sold_date: h.sold_date || s.sold_date || null,
    acquisition_date: h.consignment_date || a.acquisition_date || null,
    year: v.year ? Number(v.year) : null,
    make: v.make || null,
    model: v.model || null,
    trim: v.trim || null,
    series: v.series || null,
    vin: v.vin || null,
    odometer: v.odometer ? Number(v.odometer) : null,
    color: v.color || null,
    engine: v.engine || null,
    consignor_name: h.seller_entity || h.consignor_name || null,
    consignor_address: h.seller_address || null,
    acquisition_type: hasConsignment ? "consignment" : "purchase",
    purchase_cost: a.purchase_cost ? Number(a.purchase_cost) : (a.total_pre_recon ? Number(a.total_pre_recon) : null),
    buyer_name: h.buyer_name || s.buyer_name || null,
    buyer_address: [h.buyer_address, h.buyer_city, h.buyer_state, h.buyer_zip].filter(Boolean).join(", ") || null,
    buyer_phone: h.buyer_phone || null,
    buyer_email: h.buyer_email || null,
    sale_price: s.sale_price ? Number(s.sale_price) : null,
    salesperson: h.salesperson || h.assigned_from || null,
    document_fee: s.document_fee ? Number(s.document_fee) : null,
    handling_fee: s.dealer_handling_fee ? Number(s.dealer_handling_fee) : null,
    title_fee: null,
    permit_fee: null,
    smog_fee: s.smog_fee ? Number(s.smog_fee) : null,
    tax: s.sales_tax_amount ? Number(s.sales_tax_amount) : null,
    total_proceeds: s.total_gross_sale_proceeds ? Number(s.total_gross_sale_proceeds) : null,
    total_cost: p.total_cost ? Number(p.total_cost) : null,
    gross_profit: p.final_gross_profit ?? p.reported_profit ?? p.gross_before_adjustments ?? null,
    consignment_rate: null,
    recon_items: (r.line_items || []).map((item: any) => ({
      description: item.description || "",
      amount: item.amount ? Number(item.amount) : 0,
      vendor_name: item.vendor_name || null,
    })),
  };
}

function normalizeStandard(raw: any): NormalizedDeal {
  return {
    stock_number: raw.stock_number || null,
    deal_number: raw.deal_number || null,
    sold_date: raw.sold_date || raw.sale_date || null,
    acquisition_date: raw.acquired_date || raw.acquisition_date || null,
    year: raw.year ? Number(raw.year) : null,
    make: raw.make || null,
    model: raw.model || null,
    trim: raw.trim || null,
    series: raw.series || null,
    vin: raw.vin || null,
    odometer: (raw.odometer || raw.mileage || raw.odometer_reading) ? Number(raw.odometer || raw.mileage || raw.odometer_reading) : null,
    color: raw.color || raw.exterior_color || null,
    engine: raw.engine || null,
    consignor_name: raw.seller_entity || raw.seller_name || raw.consignor_name || raw.acquired_from || null,
    consignor_address: raw.seller_address || null,
    acquisition_type: raw.consignor_name ? "consignment" : "purchase",
    purchase_cost: raw.purchase_cost ? Number(raw.purchase_cost) : (raw.initial_cost ? Number(raw.initial_cost) : null),
    buyer_name: raw.buyer_name || raw.sold_to || null,
    buyer_address: raw.buyer_address || null,
    buyer_phone: raw.buyer_phone || null,
    buyer_email: raw.buyer_email || null,
    sale_price: raw.sale_price ? Number(raw.sale_price) : null,
    salesperson: raw.salesperson || null,
    document_fee: raw.document_fee || raw.doc_fee || null,
    handling_fee: raw.handling_fee || null,
    title_fee: raw.title_fee || null,
    permit_fee: raw.permit_fee || null,
    smog_fee: raw.smog_fee || null,
    tax: raw.tax_amount || raw.sales_tax || null,
    total_proceeds: raw.total_price || null,
    total_cost: raw.total_cost ? Number(raw.total_cost) : null,
    gross_profit: raw.gross_profit ? Number(raw.gross_profit) : null,
    consignment_rate: raw.consignment_rate || null,
    recon_items: (raw.reconditioning_items || raw.reconditioning_costs || []).map((item: any) => ({
      description: item.description || item.item || "",
      amount: item.amount ? Number(item.amount) : (item.cost ? Number(item.cost) : 0),
      vendor_name: item.vendor_name || null,
    })),
  };
}

// ─── RECON CATEGORY INFERENCE ──────────────────────────────────────────────

function inferReconCategory(description: string): string {
  const d = description.toLowerCase();
  if (/parts?\s|parts?\s\d/.test(d)) return "parts";
  if (/labor|shop\s/.test(d)) return "labor";
  if (/transport|shipping|carrier/.test(d)) return "transport";
  if (/detail|dry.?ice|wash|clean/.test(d)) return "detail";
  if (/listing|bail|advertis|feature/.test(d)) return "listing";
  if (/commission|%|acl|wynne|split/.test(d)) return "commission";
  if (/fuel|gas/.test(d)) return "fuel";
  if (/doc|mail|title|smog|permit/.test(d)) return "documentation";
  return "other";
}

// ─── OBSERVATION EMITTER ───────────────────────────────────────────────────

async function emitObservation(params: {
  kind: string;
  contentText: string;
  structuredData: Record<string, unknown>;
  vehicleId: string;
  observedAt: string;
  storagePath: string;
  sourceIdentifier: string;
  vehicleHints?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const resp = await fetch(`${BASE_URL}/functions/v1/ingest-observation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_slug: "deal-jacket-ocr",
        kind: params.kind,
        observed_at: params.observedAt,
        source_url: `storage://${params.storagePath}`,
        source_identifier: params.sourceIdentifier,
        content_text: params.contentText.substring(0, 500),
        structured_data: params.structuredData,
        vehicle_id: params.vehicleId,
        vehicle_hints: params.vehicleHints,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const result = await resp.json();
    if (result.observation_id) return result.observation_id;
    if (result.duplicate) return result.observation_id; // deduped, still return id
    console.warn(`Observation ${params.kind} not created:`, result);
    return null;
  } catch (e) {
    console.warn(`Failed to emit ${params.kind} observation:`, (e as Error).message);
    return null;
  }
}

// ─── MAIN DECOMPOSITION ───────────────────────────────────────────────────

async function decompose(
  deal: NormalizedDeal,
  vehicleId: string,
  storagePath: string,
): Promise<{ observation_ids: string[]; timeline_event_ids: string[] }> {
  const observationIds: string[] = [];
  const timelineEventIds: string[] = [];

  // Do not create timeline events or observations from test/sample deal jackets
  const isTestPath = (storagePath || "").toLowerCase().includes("/test/");
  if (isTestPath) {
    console.warn(`Skipping timeline/observations for test deal jacket: ${storagePath}`);
    return { observation_ids: [], timeline_event_ids: [] };
  }

  const observedAt = deal.sold_date || deal.acquisition_date || new Date().toISOString();
  const fileSlug = storagePath.split("/").pop() || "unknown";
  const vehicleHints = {
    vin: deal.vin,
    year: deal.year,
    make: deal.make,
    model: deal.model,
  };

  // 1. Specification observation
  const specId = await emitObservation({
    kind: "specification",
    contentText: `${deal.year} ${deal.make} ${deal.model || ""} ${deal.trim || ""} — VIN: ${deal.vin || "unknown"}, ${deal.odometer || "unknown"} mi, ${deal.color || ""}`.trim(),
    structuredData: {
      document_type: "deal_jacket",
      storage_path: storagePath,
      year: deal.year,
      make: deal.make,
      model: deal.model,
      vin: deal.vin,
      color: deal.color,
      odometer: deal.odometer,
      trim: deal.trim,
      series: deal.series,
      engine: deal.engine,
    },
    vehicleId,
    observedAt,
    storagePath,
    sourceIdentifier: `dj-spec-${fileSlug}`,
    vehicleHints,
  });
  if (specId) observationIds.push(specId);

  // 2. Ownership IN (acquisition/consignment)
  if (deal.consignor_name || deal.purchase_cost) {
    const acqId = await emitObservation({
      kind: "ownership",
      contentText: `Acquired from ${deal.consignor_name || "unknown"} via ${deal.acquisition_type || "purchase"} for $${deal.purchase_cost?.toLocaleString() || "unknown"}`,
      structuredData: {
        document_type: "deal_jacket",
        storage_path: storagePath,
        direction: "in",
        owner_name: deal.consignor_name,
        owner_address: deal.consignor_address,
        acquisition_date: deal.acquisition_date,
        acquisition_type: deal.acquisition_type,
        purchase_cost: deal.purchase_cost,
      },
      vehicleId,
      observedAt: deal.acquisition_date || observedAt,
      storagePath,
      sourceIdentifier: `dj-own-in-${fileSlug}`,
      vehicleHints,
    });
    if (acqId) observationIds.push(acqId);
  }

  // 3. Ownership OUT (sale/transfer)
  if (deal.buyer_name || deal.sale_price) {
    const saleOwnId = await emitObservation({
      kind: "ownership",
      contentText: `Sold to ${deal.buyer_name || "unknown"} for $${deal.sale_price?.toLocaleString() || "unknown"}`,
      structuredData: {
        document_type: "deal_jacket",
        storage_path: storagePath,
        direction: "out",
        owner_name: deal.buyer_name,
        owner_address: deal.buyer_address,
        owner_phone: deal.buyer_phone,
        owner_email: deal.buyer_email,
        sold_date: deal.sold_date,
        sale_price: deal.sale_price,
      },
      vehicleId,
      observedAt: deal.sold_date || observedAt,
      storagePath,
      sourceIdentifier: `dj-own-out-${fileSlug}`,
      vehicleHints,
    });
    if (saleOwnId) observationIds.push(saleOwnId);
  }

  // 4. Sale result (complete transaction)
  if (deal.sale_price) {
    const saleResultId = await emitObservation({
      kind: "sale_result",
      contentText: `Sale: $${deal.sale_price.toLocaleString()} — cost $${deal.total_cost?.toLocaleString() || "?"}, profit $${deal.gross_profit?.toLocaleString() || "?"}`,
      structuredData: {
        document_type: "deal_jacket",
        storage_path: storagePath,
        sale_price: deal.sale_price,
        document_fee: deal.document_fee,
        handling_fee: deal.handling_fee,
        title_fee: deal.title_fee,
        permit_fee: deal.permit_fee,
        smog_fee: deal.smog_fee,
        tax: deal.tax,
        total_proceeds: deal.total_proceeds,
        total_cost: deal.total_cost,
        gross_profit: deal.gross_profit,
        consignment_rate: deal.consignment_rate,
        stock_number: deal.stock_number,
        deal_number: deal.deal_number,
        salesperson: deal.salesperson,
      },
      vehicleId,
      observedAt: deal.sold_date || observedAt,
      storagePath,
      sourceIdentifier: `dj-sale-${fileSlug}`,
      vehicleHints,
    });
    if (saleResultId) observationIds.push(saleResultId);
  }

  // 5. Work records (each recon line item)
  for (let i = 0; i < deal.recon_items.length; i++) {
    const item = deal.recon_items[i];
    if (!item.description && !item.amount) continue;

    const category = inferReconCategory(item.description);
    const workId = await emitObservation({
      kind: "work_record",
      contentText: `Recon: ${item.description} — $${item.amount.toLocaleString()} ${item.vendor_name ? `(${item.vendor_name})` : ""}`.trim(),
      structuredData: {
        document_type: "deal_jacket",
        storage_path: storagePath,
        description: item.description,
        amount: item.amount,
        vendor_name: item.vendor_name,
        category,
        line_number: i + 1,
        stock_number: deal.stock_number,
      },
      vehicleId,
      observedAt,
      storagePath,
      sourceIdentifier: `dj-recon-${i + 1}-${fileSlug}`,
      vehicleHints,
    });
    if (workId) observationIds.push(workId);
  }

  // 6. Provenance (the document itself)
  const provId = await emitObservation({
    kind: "provenance",
    contentText: `Deal jacket: stock #${deal.stock_number || "?"}, deal #${deal.deal_number || "?"}, sold ${deal.sold_date || "?"}`,
    structuredData: {
      document_type: "deal_jacket",
      storage_path: storagePath,
      stock_number: deal.stock_number,
      deal_number: deal.deal_number,
      sold_date: deal.sold_date,
      acquisition_date: deal.acquisition_date,
      consignor_name: deal.consignor_name,
      buyer_name: deal.buyer_name,
      sale_price: deal.sale_price,
      total_cost: deal.total_cost,
      recon_line_count: deal.recon_items.length,
    },
    vehicleId,
    observedAt,
    storagePath,
    sourceIdentifier: `dj-prov-${fileSlug}`,
    vehicleHints,
  });
  if (provId) observationIds.push(provId);

  // ── Timeline Events ──

  // Purchase event
  if (deal.acquisition_date || deal.purchase_cost) {
    const purchaseEvent = await createTimelineEvent({
      vehicleId,
      eventType: "purchase",
      title: `Acquired from ${deal.consignor_name || "unknown"} via ${deal.acquisition_type || "purchase"}`,
      description: `Vehicle acquired${deal.consignor_name ? ` from ${deal.consignor_name}` : ""}${deal.purchase_cost ? ` for $${deal.purchase_cost.toLocaleString()}` : ""}. Stock #${deal.stock_number || "?"}`,
      eventDate: deal.acquisition_date || deal.sold_date,
      costAmount: deal.purchase_cost,
      mileage: deal.odometer,
      metadata: {
        source: "deal_jacket_decomposition",
        consignor_name: deal.consignor_name,
        acquisition_type: deal.acquisition_type,
        stock_number: deal.stock_number,
        storage_path: storagePath,
      },
    });
    if (purchaseEvent) timelineEventIds.push(purchaseEvent);
  }

  // Sale event
  if (deal.sold_date || deal.sale_price) {
    const saleEvent = await createTimelineEvent({
      vehicleId,
      eventType: "sale",
      title: `Sold to ${deal.buyer_name || "unknown"} for $${deal.sale_price?.toLocaleString() || "?"}`,
      description: `Vehicle sold${deal.buyer_name ? ` to ${deal.buyer_name}` : ""}${deal.sale_price ? ` for $${deal.sale_price.toLocaleString()}` : ""}. Gross profit: $${deal.gross_profit?.toLocaleString() || "?"}`,
      eventDate: deal.sold_date,
      costAmount: deal.sale_price,
      mileage: deal.odometer,
      metadata: {
        source: "deal_jacket_decomposition",
        buyer_name: deal.buyer_name,
        sale_price: deal.sale_price,
        gross_profit: deal.gross_profit,
        stock_number: deal.stock_number,
        storage_path: storagePath,
      },
    });
    if (saleEvent) timelineEventIds.push(saleEvent);
  }

  // ── Vehicle Enrichment ──
  await enrichVehicleFromDeal(vehicleId, deal);

  return { observation_ids: observationIds, timeline_event_ids: timelineEventIds };
}

// ─── TIMELINE EVENT CREATION ───────────────────────────────────────────────

async function createTimelineEvent(params: {
  vehicleId: string;
  eventType: string;
  title: string;
  description: string;
  eventDate: string | null;
  costAmount: number | null;
  mileage: number | null;
  metadata: Record<string, unknown>;
}): Promise<string | null> {
  if (!params.eventDate) return null;

  try {
    const { data, error } = await supabase
      .from("timeline_events")
      .insert({
        vehicle_id: params.vehicleId,
        event_type: params.eventType,
        source: "deal_jacket",
        title: params.title.substring(0, 255),
        description: params.description,
        event_date: params.eventDate,
        source_type: "dealer_record",
        confidence_score: 80,
        cost_amount: params.costAmount,
        mileage_at_event: params.mileage,
        metadata: params.metadata,
      })
      .select("id")
      .single();

    if (error) {
      console.warn(`Timeline event ${params.eventType} failed:`, error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.warn(`Timeline event ${params.eventType} error:`, (e as Error).message);
    return null;
  }
}

// ─── VEHICLE ENRICHMENT ────────────────────────────────────────────────────

async function enrichVehicleFromDeal(vehicleId: string, deal: NormalizedDeal) {
  const updates: Record<string, any> = {};

  const vin = (deal.vin || "").replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
  if (vin.length >= 11) {
    updates.vin = vin;
    updates.vin_source = "deal_jacket_ocr";
  }
  if (deal.odometer) updates.mileage = deal.odometer;
  if (deal.color) updates.color = deal.color;
  if (deal.sale_price) updates.sale_price = deal.sale_price;

  // Update origin_metadata with decomposition flag
  const { data: existing } = await supabase
    .from("vehicles")
    .select("origin_metadata")
    .eq("id", vehicleId)
    .single();

  const meta = existing?.origin_metadata || {};
  meta.deal_jacket_decomposed = {
    decomposed_at: new Date().toISOString(),
    stock_number: deal.stock_number,
    deal_number: deal.deal_number,
    sold_date: deal.sold_date,
    sale_price: deal.sale_price,
    purchase_cost: deal.purchase_cost,
    gross_profit: deal.gross_profit,
    recon_line_count: deal.recon_items.length,
    total_recon: deal.recon_items.reduce((sum, item) => sum + item.amount, 0),
  };
  updates.origin_metadata = meta;

  if (Object.keys(updates).length > 0) {
    await supabase.from("vehicles").update(updates).eq("id", vehicleId);
  }
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { extraction_data, vehicle_id, storage_path, queue_id } = body;

    if (!extraction_data?.extracted_data) {
      return json({ error: "Missing extraction_data.extracted_data" }, 400);
    }
    if (!vehicle_id) {
      return json({ error: "Missing vehicle_id" }, 400);
    }

    const raw = extraction_data.extracted_data;
    const deal = normalizeExtraction(raw);
    const result = await decompose(deal, vehicle_id, storage_path || "");

    return json({
      success: true,
      vehicle_id,
      observation_ids: result.observation_ids,
      timeline_event_ids: result.timeline_event_ids,
      observations_created: result.observation_ids.length,
      timeline_events_created: result.timeline_event_ids.length,
      recon_items_found: deal.recon_items.length,
      normalized_deal: {
        stock_number: deal.stock_number,
        sold_date: deal.sold_date,
        sale_price: deal.sale_price,
        purchase_cost: deal.purchase_cost,
        gross_profit: deal.gross_profit,
      },
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error("Decompose error:", err);
    return json({ error: (err as Error).message, duration_ms: Date.now() - startTime }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
