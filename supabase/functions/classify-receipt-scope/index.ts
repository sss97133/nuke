/**
 * CLASSIFY-RECEIPT-SCOPE
 *
 * Maps a receipt to an entity scope (NUKE LTD / Viva / personal-1040 / household / vehicle).
 *
 * POST { receipt_id?: string, data_v2?: object, raw_json?: object, vendor_name?, card_last4? }
 *   → { scope_type, scope_id, method, confidence, reasons[] }
 *
 * Rule order (deterministic-first; LLM only as fallback):
 *   1. attribution.primary_entity block already present in raw_json
 *   2. payment_card_attribution lookup by card_last4
 *   3. merchant regex
 *   4. line-item category sweep
 *   5. gpt-4o-mini fallback (temp=0, capped)
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";

const NUKE_LTD_ID = "f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb";
const VIVA_ID = "c433d27e-2159-4f8c-b4ae-32a5e44a77cf";
const PERSONAL_1040 = "skylar-personal-1040";
const HOUSEHOLD = "williams-household";

type Scope = {
  scope_type: string;
  scope_id: string;
  method: string;
  confidence: number;
  reasons: string[];
};

type LineItem = {
  description?: string;
  category?: string;
  sku?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
};

type ReceiptInput = {
  vendor_name?: string;
  merchant_name?: string;
  card_last4?: string;
  line_items?: LineItem[];
  vehicle_hint?: string | null;
  ocr_full_text?: string;
};

function entityToScope(entity: string, vehicleId: string | null): Scope | null {
  switch (entity) {
    case "nuke_ltd":
      return { scope_type: "org", scope_id: NUKE_LTD_ID, method: "attribution_block", confidence: 0.95, reasons: ["raw_json.attribution.primary_entity=nuke_ltd"] };
    case "viva_las_vegas":
    case "acl":
    case "viva":
      return { scope_type: "org", scope_id: VIVA_ID, method: "attribution_block", confidence: 0.95, reasons: [`raw_json.attribution.primary_entity=${entity}`] };
    case "skylar_personal":
      return { scope_type: "personal", scope_id: PERSONAL_1040, method: "attribution_block", confidence: 0.95, reasons: ["raw_json.attribution.primary_entity=skylar_personal"] };
    case "family_household":
    case "household":
      return { scope_type: "personal", scope_id: HOUSEHOLD, method: "attribution_block", confidence: 0.95, reasons: [`raw_json.attribution.primary_entity=${entity}`] };
    case "vehicle":
      if (vehicleId) {
        return { scope_type: "vehicle", scope_id: vehicleId, method: "attribution_block", confidence: 0.95, reasons: ["raw_json.attribution.primary_entity=vehicle"] };
      }
      return null;
    default:
      return null;
  }
}

const MERCHANT_VIVA = /snap[- ]?on|napa|summit racing|speedway|lmc truck|rockauto|advance auto|o'?reilly|autozone|harbor freight|eastwood|mac tools|matco|jegs/i;
const MERCHANT_NUKE = /\baws\b|amazon web services|vercel|openai|anthropic|github|cloudflare|supabase|godaddy|namecheap|figma|notion|linear\.app|fly\.io|render\.com/i;
const MERCHANT_HOUSEHOLD = /target|kroger|walmart|safeway|smith'?s|trader joe|costco|sam'?s club|whole foods|albertsons|aldi|publix|chick-?fil-?a|starbucks|mcdonald|in-?n-?out/i;
const MERCHANT_FUEL = /chevron|shell|exxon|mobil\b|7-?eleven|maverik|arco|sinclair|valero|circle k|sunoco|bp\b|texaco|love'?s/i;

function merchantRegex(vendor: string, hasVehicleHint: boolean): Scope | null {
  const v = (vendor || "").toLowerCase().trim();
  if (!v) return null;
  if (MERCHANT_VIVA.test(v)) {
    if (hasVehicleHint) return null; // let vehicle_hint path resolve
    return { scope_type: "org", scope_id: VIVA_ID, method: "merchant_regex", confidence: 0.8, reasons: [`vendor=${vendor} matches viva auto-parts pattern`] };
  }
  if (MERCHANT_NUKE.test(v)) {
    return { scope_type: "org", scope_id: NUKE_LTD_ID, method: "merchant_regex", confidence: 0.8, reasons: [`vendor=${vendor} matches nuke saas pattern`] };
  }
  if (MERCHANT_HOUSEHOLD.test(v)) {
    return { scope_type: "personal", scope_id: HOUSEHOLD, method: "merchant_regex", confidence: 0.8, reasons: [`vendor=${vendor} matches household retail pattern`] };
  }
  if (MERCHANT_FUEL.test(v)) {
    if (hasVehicleHint) return null;
    return { scope_type: "personal", scope_id: HOUSEHOLD, method: "merchant_regex", confidence: 0.7, reasons: [`vendor=${vendor} fuel without vehicle hint -> household`] };
  }
  return null;
}

function lineItemCategory(items: LineItem[]): Scope | null {
  if (!items || items.length === 0) return null;
  const cats = items.map((i) => (i.category || "").toLowerCase()).filter(Boolean);
  if (cats.some((c) => /auto[_ ]?parts|tools|automotive|hardware/.test(c))) {
    return { scope_type: "org", scope_id: VIVA_ID, method: "line_item", confidence: 0.7, reasons: [`line items include auto/tools categories: ${cats.join(",")}`] };
  }
  if (cats.some((c) => /software|saas|hosting|api|cloud/.test(c))) {
    return { scope_type: "org", scope_id: NUKE_LTD_ID, method: "line_item", confidence: 0.7, reasons: [`line items include saas categories: ${cats.join(",")}`] };
  }
  return null;
}

async function cardLookup(supabaseUrl: string, serviceKey: string, last4: string): Promise<Scope | null> {
  if (!last4) return null;
  const r = await fetch(`${supabaseUrl}/rest/v1/payment_card_attribution?last4=eq.${encodeURIComponent(last4)}&select=default_scope_type,default_scope_id,card_brand,card_holder`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    scope_type: row.default_scope_type,
    scope_id: row.default_scope_id,
    method: "card_lookup",
    confidence: 0.9,
    reasons: [`card *${last4} (${row.card_brand || "?"} / ${row.card_holder || "?"}) → ${row.default_scope_type}/${row.default_scope_id}`],
  };
}

async function llmFallback(input: ReceiptInput): Promise<Scope | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return { scope_type: "personal", scope_id: HOUSEHOLD, method: "llm_fallback", confidence: 0.3, reasons: ["OPENAI_API_KEY missing; defaulted to household"] };
  }
  const vendor = input.vendor_name || input.merchant_name || "";
  const items = (input.line_items || []).slice(0, 8).map((i) => `${i.description || ""}|${i.category || ""}`).join("; ");
  const ocr = (input.ocr_full_text || "").slice(0, 400);
  const prompt = `Classify this receipt into ONE scope. Reply ONLY JSON: {"scope":"nuke_ltd|viva|personal_1040|household|vehicle","reason":"..."}.

Definitions:
- nuke_ltd = the owner's UK software company (SaaS, hosting, API, dev tools)
- viva = the owner's US auto restoration shop (auto parts, tools, vehicle supplies, business expenses for the shop)
- personal_1040 = the owner's personal Schedule C deductible (rare; only if clearly personal-business non-vehicle non-shop)
- household = the owner's family expenses (groceries, kid stuff, restaurants, target, etc.)
- vehicle = identifiable vehicle expense

Vendor: ${vendor}
Card: *${input.card_last4 || "?"}
Line items: ${items}
OCR: ${ocr}`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      return { scope_type: "personal", scope_id: HOUSEHOLD, method: "llm_fallback", confidence: 0.3, reasons: [`gpt-4o-mini error ${res.status}; defaulted to household`] };
    }
    const j = await res.json();
    const txt = j.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(txt);
    const reason = parsed.reason || "llm classification";
    switch (parsed.scope) {
      case "nuke_ltd": return { scope_type: "org", scope_id: NUKE_LTD_ID, method: "llm_fallback", confidence: 0.6, reasons: [`llm: ${reason}`] };
      case "viva": return { scope_type: "org", scope_id: VIVA_ID, method: "llm_fallback", confidence: 0.6, reasons: [`llm: ${reason}`] };
      case "personal_1040": return { scope_type: "personal", scope_id: PERSONAL_1040, method: "llm_fallback", confidence: 0.6, reasons: [`llm: ${reason}`] };
      case "household": return { scope_type: "personal", scope_id: HOUSEHOLD, method: "llm_fallback", confidence: 0.6, reasons: [`llm: ${reason}`] };
      case "vehicle": return { scope_type: "personal", scope_id: HOUSEHOLD, method: "llm_fallback", confidence: 0.4, reasons: [`llm said vehicle but no resolved id; fallback household: ${reason}`] };
      default: return { scope_type: "personal", scope_id: HOUSEHOLD, method: "llm_fallback", confidence: 0.4, reasons: [`llm unknown scope ${parsed.scope}; fallback household`] };
    }
  } catch (e) {
    return { scope_type: "personal", scope_id: HOUSEHOLD, method: "llm_fallback", confidence: 0.3, reasons: [`llm error ${e instanceof Error ? e.message : String(e)}; fallback household`] };
  }
}

async function classify(rawJson: any, dataV2: any, supabaseUrl: string, serviceKey: string, override: ReceiptInput): Promise<Scope> {
  const attribution = rawJson?.attribution;
  const cardProj = rawJson?.card_projection;
  const data = dataV2 || rawJson?.data_v2 || {};
  const vendor = override.vendor_name || data.merchant_name || rawJson?.vendor_name || "";
  const last4 = override.card_last4 || data.card_last4 || rawJson?.card_last4 || "";
  const items: LineItem[] = override.line_items || data.line_items || [];
  const vehicleHint = data.vehicle_hint || rawJson?.vehicle_hint || cardProj?.vehicle_hint || null;
  const ocr = rawJson?.ocr?.full_text || "";

  // 1. Attribution block
  if (attribution?.primary_entity) {
    const s = entityToScope(attribution.primary_entity, vehicleHint);
    if (s) return s;
  }

  // 2. Card lookup
  const cardScope = await cardLookup(supabaseUrl, serviceKey, last4);
  if (cardScope) return cardScope;

  // 3. Merchant regex
  const mScope = merchantRegex(vendor, !!vehicleHint);
  if (mScope) return mScope;

  // 4. Line-item category
  const liScope = lineItemCategory(items);
  if (liScope) return liScope;

  // 5. LLM fallback
  const llm = await llmFallback({ vendor_name: vendor, card_last4: last4, line_items: items, ocr_full_text: ocr });
  if (llm) return llm;

  return { scope_type: "personal", scope_id: HOUSEHOLD, method: "default", confidence: 0.2, reasons: ["no rule matched; defaulted to household"] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "missing SUPABASE_URL / SERVICE_ROLE_KEY" }), { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } });
    }

    const body = await req.json();
    let { receipt_id, data_v2, raw_json, vendor_name, card_last4, line_items } = body || {};

    // Hydrate from receipt_id if provided
    if (receipt_id && !raw_json && !data_v2) {
      const r = await fetch(`${supabaseUrl}/rest/v1/receipts?id=eq.${receipt_id}&select=raw_json,vendor_name,card_last4`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (r.ok) {
        const rows = await r.json();
        if (rows && rows[0]) {
          raw_json = rows[0].raw_json || {};
          vendor_name = vendor_name || rows[0].vendor_name;
          card_last4 = card_last4 || rows[0].card_last4;
        }
      }
    }

    const scope = await classify(raw_json || {}, data_v2 || raw_json?.data_v2 || null, supabaseUrl, serviceKey, {
      vendor_name, card_last4, line_items,
    });

    return new Response(JSON.stringify({ ...scope, classified_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
