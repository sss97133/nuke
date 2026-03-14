/**
 * Link Document Entities — Auto-create vehicles, orgs, contacts, deals, and observations
 *
 * Called after successful OCR extraction by document-ocr-worker.
 * Creates all entities mentioned in a document and generates observations.
 *
 * POST /functions/v1/link-document-entities
 * {
 *   queue_id: string,
 *   deal_document_id: string,
 *   document_type: string,
 *   extraction_data: { extracted_data: {...}, confidences: {...} },
 *   storage_path: string
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

// ─── VEHICLE RESOLUTION ────────────────────────────────────────────────────
// Reuses autoLinkVehicle logic from deal-jacket-pipeline

async function resolveVehicle(data: any): Promise<{ vehicleId: string | null; created: boolean; confidence: number }> {
  const vin = (data.vin || "").replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
  const year = data.year ? Number(data.year) : null;
  const make = (data.make || "").trim();
  const model = (data.model || "").trim();

  // 1. VIN match (highest confidence)
  if (vin && vin.length >= 11) {
    const { data: vinMatch } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", vin)
      .is("deleted_at", null)
      .limit(1);

    if (vinMatch?.length) {
      return { vehicleId: vinMatch[0].id, created: false, confidence: 0.99 };
    }
  }

  // 2. Year+make+model unique match
  if (year && make) {
    let query = supabase.from("vehicles").select("id").is("deleted_at", null);
    query = query.eq("year", year).ilike("make", make);
    if (model) query = query.ilike("model", model);
    const { data: matches } = await query.limit(5);

    if (matches?.length === 1) {
      return { vehicleId: matches[0].id, created: false, confidence: 0.60 };
    }
  }

  // 3. Create new vehicle if enough data
  if (make && year) {
    const { data: newVehicle } = await supabase
      .from("vehicles")
      .insert({
        year: year || null,
        make,
        model: model || null,
        vin: vin.length >= 11 ? vin : null,
        color: data.color || data.exterior_color || null,
        source: "deal_jacket_ocr",
        sale_price: data.sale_price || null,
      })
      .select("id")
      .single();

    if (newVehicle) {
      return { vehicleId: newVehicle.id, created: true, confidence: 0.80 };
    }
  }

  return { vehicleId: null, created: false, confidence: 0 };
}

async function enrichVehicle(vehicleId: string, data: any, docType: string) {
  const updates: Record<string, any> = {};

  const vin = (data.vin || "").replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
  if (vin.length >= 11) {
    updates.vin = vin;
    updates.vin_source = "deal_jacket_ocr";
  }

  const mileage = data.odometer || data.mileage || data.odometer_reading;
  if (mileage) updates.mileage = Number(mileage);
  if (data.color) updates.color = data.color;
  if (data.sale_price) updates.sale_price = Number(data.sale_price);

  // Store extraction source in origin_metadata
  const { data: existing } = await supabase
    .from("vehicles")
    .select("origin_metadata")
    .eq("id", vehicleId)
    .single();

  const meta = existing?.origin_metadata || {};
  if (!meta.deal_jacket_ocr) meta.deal_jacket_ocr = {};
  meta.deal_jacket_ocr[docType] = {
    extracted_at: new Date().toISOString(),
    ...(data.sale_price && { sale_price: data.sale_price }),
    ...(data.buyer_name && { buyer_name: data.buyer_name }),
    ...(data.seller_name && { seller_name: data.seller_name }),
    ...(data.stock_number && { stock_number: data.stock_number }),
  };
  updates.origin_metadata = meta;

  if (Object.keys(updates).length > 1) { // > 1 because origin_metadata is always set
    await supabase.from("vehicles").update(updates).eq("id", vehicleId);
  }
}

// ─── ORGANIZATION RESOLUTION ───────────────────────────────────────────────
// Reuses pattern from extract-organization-from-seller

async function resolveOrganization(name: string, context: string): Promise<string | null> {
  if (!name || name.length < 2) return null;

  const normalizedName = name.trim();

  // Search existing orgs by name (fuzzy)
  const { data: existing } = await supabase
    .from("organizations")
    .select("id, name")
    .or(`name.ilike.%${normalizedName.replace(/[%_]/g, '')}%`)
    .limit(5);

  if (existing?.length === 1) {
    return existing[0].id;
  }

  // Exact match check
  if (existing?.length) {
    const exact = existing.find((o: any) =>
      o.name.toLowerCase() === normalizedName.toLowerCase()
    );
    if (exact) return exact.id;
  }

  // Infer entity type from context
  let entityType = "dealer";
  if (context.includes("auction")) entityType = "auction_house";
  else if (context.includes("vendor") || context.includes("shop") || context.includes("repair")) entityType = "shop";
  else if (context.includes("carrier") || context.includes("transport")) entityType = "transport";

  // Create new organization
  const { data: newOrg } = await supabase
    .from("organizations")
    .insert({
      name: normalizedName,
      entity_type: entityType,
      source: "deal_jacket_ocr",
      metadata: {
        discovered_from: "document_ocr",
        context,
        discovered_at: new Date().toISOString(),
      },
    })
    .select("id")
    .single();

  if (newOrg) {
    // Trigger auto-merge (fire and forget)
    supabase.functions.invoke("auto-merge-duplicate-orgs", {
      body: { organizationId: newOrg.id },
    }).catch(() => {});
  }

  return newOrg?.id || null;
}

// ─── CONTACT RESOLUTION ────────────────────────────────────────────────────

async function resolveContact(fullName: string, role: string, orgId?: string | null): Promise<string | null> {
  if (!fullName || fullName.length < 2) return null;

  const normalizedName = fullName.trim();

  // Search existing contacts
  let query = supabase.from("deal_contacts").select("id, full_name").ilike("full_name", normalizedName);
  if (orgId) query = query.eq("organization_id", orgId);
  const { data: existing } = await query.limit(3);

  if (existing?.length) {
    const exact = existing.find((c: any) =>
      c.full_name.toLowerCase() === normalizedName.toLowerCase()
    );
    if (exact) return exact.id;
  }

  // Create new contact
  const { data: newContact } = await supabase
    .from("deal_contacts")
    .insert({
      full_name: normalizedName,
      role: [role],
      company: orgId ? null : normalizedName, // If we don't know the org, use name as company
      organization_id: orgId || null,
    })
    .select("id")
    .single();

  return newContact?.id || null;
}

// ─── DEAL GROUPING ─────────────────────────────────────────────────────────

async function resolveDeal(vehicleId: string | null, data: any): Promise<string | null> {
  if (!vehicleId) return null;

  // First check if deal_document already has a deal_id
  // Then check for existing deals by vehicle
  const { data: existingDeals } = await supabase
    .from("deal_jackets")
    .select("id, vehicle_id")
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingDeals?.length) {
    return existingDeals[0].id;
  }

  // Check deal_vehicle_details for a vehicle_detail_id
  const { data: vehicleDetails } = await supabase
    .from("deal_vehicle_details")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .limit(1);

  if (!vehicleDetails?.length) return null;

  // Only create a deal if we have enough data (stock number or sale info)
  if (!data.stock_number && !data.sale_price && !data.sold_date) return null;

  return null; // Don't auto-create deals — let existing deals link naturally
}

// ─── OBSERVATION GENERATION ────────────────────────────────────────────────

const DOC_TYPE_TO_OBSERVATION_KINDS: Record<string, string[]> = {
  title: ["provenance", "ownership"],
  bill_of_sale: ["ownership", "provenance"],
  buyers_order: ["ownership", "provenance"],
  cost_sheet: ["provenance", "specification"],
  repair_order: ["work_record"],
  odometer_disclosure: ["specification"],
  deal_jacket: ["provenance", "specification"],
  receipt: ["work_record"],
  auction_slip: ["provenance"],
  smog_certificate: ["specification"],
  registration: ["ownership"],
  insurance_card: ["ownership"],
  shipping_bill: ["provenance"],
  consignment_agreement: ["provenance", "ownership"],
  lien_release: ["ownership"],
};

async function generateObservations(
  vehicleId: string | null,
  docType: string,
  data: any,
  storagePath: string
): Promise<string[]> {
  if (!vehicleId) return [];

  const kinds = DOC_TYPE_TO_OBSERVATION_KINDS[docType] || ["provenance"];
  const observationIds: string[] = [];
  const baseUrl = Deno.env.get("SUPABASE_URL")!;

  for (const kind of kinds) {
    // Build structured data based on kind
    let structuredData: Record<string, unknown> = {
      document_type: docType,
      storage_path: storagePath,
    };
    let contentText = "";

    switch (kind) {
      case "provenance":
        structuredData = {
          ...structuredData,
          seller_name: data.seller_name || data.seller_entity || data.consignor_name,
          buyer_name: data.buyer_name || data.consignee_name,
          sale_date: data.sale_date || data.sold_date || data.agreement_date,
          sale_price: data.sale_price,
          stock_number: data.stock_number,
          auction_house: data.auction_house,
        };
        contentText = `${docType}: ${data.seller_name || data.seller_entity || ""} → ${data.buyer_name || ""} ${data.sale_date || data.sold_date || ""}`.trim();
        break;

      case "ownership":
        structuredData = {
          ...structuredData,
          owner_names: data.owner_names,
          buyer_name: data.buyer_name || data.insured_name || data.registered_owner,
          seller_name: data.seller_name,
          transfer_date: data.sale_date || data.issue_date || data.registration_date,
        };
        contentText = `${docType}: Owner ${data.owner_names?.[0] || data.buyer_name || data.registered_owner || "unknown"}`.trim();
        break;

      case "work_record":
        structuredData = {
          ...structuredData,
          vendor_name: data.vendor_name || data.customer_name,
          ro_number: data.ro_number || data.receipt_number,
          date: data.date_in || data.date || data.receipt_date,
          total_amount: data.total_amount || data.total,
          labor_items: data.labor_items,
          parts: data.parts,
          line_items: data.line_items,
        };
        contentText = `${docType}: ${data.vendor_name || ""} $${data.total_amount || data.total || 0} ${data.date_in || data.date || ""}`.trim();
        break;

      case "specification":
        structuredData = {
          ...structuredData,
          odometer: data.odometer || data.odometer_reading || data.mileage,
          odometer_status: data.odometer_status,
          color: data.color,
          trim: data.trim,
          body_style: data.body_style,
        };
        contentText = `${docType}: ${data.odometer || data.mileage || "unknown"} miles, ${data.color || ""}`.trim();
        break;
    }

    // Call ingest-observation
    try {
      const resp = await fetch(`${baseUrl}/functions/v1/ingest-observation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_slug: "deal-jacket-ocr",
          kind,
          observed_at: data.sale_date || data.sold_date || data.issue_date || data.date_in || data.date || new Date().toISOString(),
          source_url: `storage://${storagePath}`,
          source_identifier: `ocr-${docType}-${storagePath.split("/").pop()}`,
          content_text: contentText.substring(0, 500),
          structured_data: structuredData,
          vehicle_id: vehicleId,
          vehicle_hints: {
            vin: data.vin,
            year: data.year,
            make: data.make,
            model: data.model,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      const result = await resp.json();
      if (result.observation_id) {
        observationIds.push(result.observation_id);
      }
    } catch (e) {
      console.warn(`Failed to create ${kind} observation:`, (e as Error).message);
    }
  }

  return observationIds;
}

// ─── ORGANIZATION BEHAVIOR SIGNALS ─────────────────────────────────────────

const DOC_TYPE_TO_SIGNAL: Record<string, { signal_type: string; signal_category: string }> = {
  deal_jacket: { signal_type: "vehicle_sale", signal_category: "transaction" },
  bill_of_sale: { signal_type: "vehicle_sale", signal_category: "transaction" },
  buyers_order: { signal_type: "vehicle_sale", signal_category: "transaction" },
  cost_sheet: { signal_type: "vehicle_sale", signal_category: "transaction" },
  repair_order: { signal_type: "work_performed", signal_category: "service" },
  receipt: { signal_type: "work_performed", signal_category: "service" },
  auction_slip: { signal_type: "auction_hosted", signal_category: "transaction" },
  consignment_agreement: { signal_type: "consignment_received", signal_category: "transaction" },
  shipping_bill: { signal_type: "transport_completed", signal_category: "service" },
};

async function emitBehaviorSignals(orgIds: string[], docType: string, data: any, vehicleId: string | null) {
  const signalDef = DOC_TYPE_TO_SIGNAL[docType];
  if (!signalDef || !orgIds.length) return;

  for (const orgId of orgIds) {
    try {
      await supabase.from("organization_behavior_signals").insert({
        organization_id: orgId,
        signal_type: signalDef.signal_type,
        signal_category: signalDef.signal_category,
        signal_data: {
          document_type: docType,
          vehicle_id: vehicleId,
          sale_price: data.sale_price,
          date: data.sale_date || data.sold_date || data.date,
          source: "deal_jacket_ocr",
        },
        confidence: 0.75,
        source_type: "document_ocr",
        source_ref: `ocr:${docType}`,
      });
    } catch (e) {
      console.warn(`Behavior signal failed for org ${orgId}:`, (e as Error).message);
    }
  }

  // Trigger score recomputation (fire and forget)
  for (const orgId of orgIds) {
    supabase.rpc("compute_org_behavior_scores", { p_organization_id: orgId }).catch(() => {});
    supabase.rpc("compute_org_investability_score", { p_organization_id: orgId }).catch(() => {});
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
    const {
      queue_id,
      deal_document_id,
      document_type,
      extraction_data,
      storage_path,
    } = body;

    if (!extraction_data?.extracted_data) {
      return json({ error: "Missing extraction_data.extracted_data" }, 400);
    }

    const data = extraction_data.extracted_data;
    const organizationIds: string[] = [];
    const contactIds: string[] = [];

    // ── 1. Vehicle Resolution ──
    const vehicleResult = await resolveVehicle(data);
    const vehicleId = vehicleResult.vehicleId;

    if (vehicleId && !vehicleResult.created) {
      await enrichVehicle(vehicleId, data, document_type);
    }

    // Link deal_documents.vehicle_id if we have a vehicle_detail match
    if (vehicleId && deal_document_id) {
      // deal_documents.vehicle_id references deal_vehicle_details, not vehicles
      // Check if there's a deal_vehicle_details row for this vehicle
      const { data: vd } = await supabase
        .from("deal_vehicle_details")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .limit(1);

      if (vd?.length) {
        await supabase.from("deal_documents")
          .update({ vehicle_id: vd[0].id })
          .eq("id", deal_document_id);
      }
    }

    // ── 2. Organization Resolution ──
    const orgNames: { name: string; context: string }[] = [];

    if (data.seller_name || data.seller_entity) {
      orgNames.push({ name: data.seller_name || data.seller_entity, context: "seller" });
    }
    if (data.buyer_name && document_type !== "bill_of_sale") {
      // For bills of sale, buyer is often an individual, not an org
      // Only add as org if it looks like a business name
      const name = data.buyer_name;
      if (/\b(inc|llc|ltd|corp|co\.|auto|motors|dealer|sales|group|enterprises)\b/i.test(name)) {
        orgNames.push({ name, context: "buyer" });
      }
    }
    if (data.auction_house) {
      orgNames.push({ name: data.auction_house, context: "auction" });
    }
    if (data.vendor_name) {
      orgNames.push({ name: data.vendor_name, context: "vendor/shop" });
    }
    if (data.carrier_name) {
      orgNames.push({ name: data.carrier_name, context: "carrier/transport" });
    }
    if (data.consignor_name) {
      orgNames.push({ name: data.consignor_name, context: "consignor" });
    }
    if (data.consignee_name) {
      orgNames.push({ name: data.consignee_name, context: "consignee" });
    }
    if (data.insurer_name) {
      orgNames.push({ name: data.insurer_name, context: "insurer" });
    }
    if (data.lienholder_name) {
      orgNames.push({ name: data.lienholder_name, context: "lienholder" });
    }
    if (data.station_name) {
      orgNames.push({ name: data.station_name, context: "shop/smog" });
    }

    // Resolve vendor names from reconditioning line items
    const reconItems = data.reconditioning_items || data.reconditioning_costs || [];
    for (const item of reconItems) {
      if (item.vendor_name && typeof item.vendor_name === "string" && item.vendor_name.length > 2) {
        orgNames.push({ name: item.vendor_name, context: "vendor/shop" });
      }
    }

    // Deduplicate by name
    const seenOrgNames = new Set<string>();
    for (const { name, context } of orgNames) {
      const normalized = name.toLowerCase().trim();
      if (seenOrgNames.has(normalized)) continue;
      seenOrgNames.add(normalized);

      const orgId = await resolveOrganization(name, context);
      if (orgId) organizationIds.push(orgId);
    }

    // ── 3. Contact Resolution ──
    const contactNames: { name: string; role: string; orgId?: string | null }[] = [];

    if (data.buyer_name) {
      contactNames.push({ name: data.buyer_name, role: "buyer" });
    }
    if (data.seller_name && !/\b(inc|llc|ltd|corp|co\.|auto|motors|dealer)\b/i.test(data.seller_name)) {
      // Only add as contact if it doesn't look like a business
      contactNames.push({ name: data.seller_name, role: "seller" });
    }
    if (data.salesperson) {
      contactNames.push({
        name: data.salesperson,
        role: "salesperson",
        orgId: organizationIds[0] || null,
      });
    }
    if (data.customer_name) {
      contactNames.push({ name: data.customer_name, role: "customer" });
    }
    if (data.technician) {
      contactNames.push({ name: data.technician, role: "technician", orgId: organizationIds[0] || null });
    }
    if (data.service_advisor) {
      contactNames.push({ name: data.service_advisor, role: "service_advisor", orgId: organizationIds[0] || null });
    }

    // Deduplicate by name
    const seenContactNames = new Set<string>();
    for (const { name, role, orgId } of contactNames) {
      const normalized = name.toLowerCase().trim();
      if (seenContactNames.has(normalized)) continue;
      seenContactNames.add(normalized);

      const contactId = await resolveContact(name, role, orgId);
      if (contactId) contactIds.push(contactId);
    }

    // ── 4. Deal Grouping ──
    const dealId = await resolveDeal(vehicleId, data);

    // Link document to deal if found
    if (dealId && deal_document_id) {
      await supabase.from("deal_documents")
        .update({ deal_id: dealId })
        .eq("id", deal_document_id);
    }

    // ── 5. Observation Generation ──
    let observationIds: string[] = [];

    if (vehicleId) {
      observationIds = await generateObservations(vehicleId, document_type, data, storage_path);
    }

    // ── 6. Organization Behavior Signals ──
    await emitBehaviorSignals(organizationIds, document_type, data, vehicleId);

    return json({
      success: true,
      vehicle_id: vehicleId,
      vehicle_created: vehicleResult.created,
      vehicle_confidence: vehicleResult.confidence,
      deal_id: dealId,
      organization_ids: organizationIds,
      contact_ids: contactIds,
      observation_ids: observationIds,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    console.error("Entity linking error:", err);
    return json({ error: (err as Error).message, duration_ms: Date.now() - startTime }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
