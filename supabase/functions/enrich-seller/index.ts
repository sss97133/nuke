/**
 * Seller Enrichment Edge Function
 *
 * For each pipeline_seller with enrichment_status = 'raw' (or a specific seller_id):
 *   1. Ask Perplexity sonar-pro to look up the phone + region → raw intel
 *   2. Ask Claude to classify: business_type, specialties, intel_value
 *   3. Update pipeline_sellers with enriched data
 *
 * Input:  { seller_id?, batch_size?, force? }
 * Output: { success, processed, enriched[], errors[] }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SellerRow {
  id: string;
  phone: string | null;
  email: string | null;
  cl_handle: string | null;
  seller_name: string | null;
  primary_state: string | null;
  primary_region: string | null;
  regions_seen: string[] | null;
  listing_count: number | null;
  makes_seen: string[] | null;
  enrichment_status: string | null;
}

interface EnrichmentResult {
  seller_id: string;
  phone: string | null;
  business_name: string | null;
  website: string | null;
  address: string | null;
  business_type: string | null;
  specialties: string[];
  intel_value: string;
  relationship_notes: string;
  raw_intel: string;
  citations: string[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Perplexity lookup
// ---------------------------------------------------------------------------

async function lookupSellerIntel(
  phone: string,
  state: string | null,
  regions: string[] | null,
  makes: string[] | null,
): Promise<{ content: string; citations: string[] }> {
  const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY')!;
  const locationHint = state ? ` in ${state}` : (regions?.[0] ? ` (Craigslist region: ${regions[0]})` : '');
  const makesHint = makes && makes.length > 0 ? ` They sell classic cars including: ${makes.slice(0, 5).join(', ')}.` : '';

  const query = `Look up the business or person with phone number (${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}${locationHint}.${makesHint} Find: business name, address, website, type of business (dealership, private seller, flipper, restoration shop, etc.), any reviews, and reputation. Focus on automotive dealers and car sellers.`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${perplexityKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [{ role: 'user', content: query }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

// ---------------------------------------------------------------------------
// Claude classification
// ---------------------------------------------------------------------------

async function classifySeller(rawIntel: string, phone: string): Promise<{
  business_name: string | null;
  website: string | null;
  address: string | null;
  business_type: string;
  specialties: string[];
  intel_value: string;
  relationship_notes: string;
}> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

  const prompt = `You are classifying a car seller/dealer for a classic car acquisition database.

Based on this research about phone ${phone}:

---
${rawIntel}
---

Extract and classify in JSON:
{
  "business_name": "exact business name or null if private seller",
  "website": "url or null",
  "address": "street address or null",
  "business_type": one of: "licensed_dealer" | "restoration_shop" | "consignment_dealer" | "wholesaler" | "broker" | "auction_rep" | "estate_liquidator" | "flipper" | "collector_seller" | "unknown",
  "specialties": array from: ["muscle_cars","pony_cars","classic_trucks","european_classics","jdm","american_classics","hot_rods","resto_mods","numbers_matching","project_cars","high_volume","barn_finds"],
  "intel_value": one of: "comp_source" | "wholesale_target" | "restoration_partner" | "watch_only" | "blocklist",
  "relationship_notes": "1-2 sentence summary of who they are and why they matter to a classic car buyer. Be direct and useful."
}

Rules:
- BHPH / bad credit / subprime financing → business_type: "licensed_dealer", intel_value: "watch_only"
- High volume cross-poster with no restoration focus → intel_value: "comp_source"
- Restoration shop or hot rod builder → business_type: "restoration_shop", intel_value: "restoration_partner"
- Wholesaler or trade-only dealer → intel_value: "wholesale_target"
- Known scammer/fraud → intel_value: "blocklist"
- Private collector → business_type: "collector_seller"
- If nothing found → business_type: "unknown", intel_value: "comp_source"

Return ONLY valid JSON, no explanation.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';

  // Strip markdown code fences if present
  const json = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { seller_id, batch_size = 10, force = false } = await req.json().catch(() => ({}));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Fetch sellers to enrich
    let query = supabase
      .from('pipeline_sellers')
      .select('id, phone, email, cl_handle, seller_name, primary_state, primary_region, regions_seen, listing_count, makes_seen, enrichment_status')
      .not('phone', 'is', null);

    if (seller_id) {
      query = query.eq('id', seller_id);
    } else if (!force) {
      query = query.eq('enrichment_status', 'raw');
    }

    query = query.limit(batch_size);

    const { data: sellers, error: fetchError } = await query;
    if (fetchError) throw new Error(`Fetch sellers: ${fetchError.message}`);

    if (!sellers || sellers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No sellers to enrich' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[enrich-seller] Enriching ${sellers.length} sellers`);

    const enriched: EnrichmentResult[] = [];
    const errors: string[] = [];

    for (const seller of sellers as SellerRow[]) {
      try {
        if (!seller.phone) {
          console.log(`[enrich-seller] Skipping ${seller.id} — no phone`);
          continue;
        }

        console.log(`[enrich-seller] Looking up phone ${seller.phone} (${seller.primary_state || seller.primary_region || 'unknown location'})`);

        // Step 1: Perplexity web lookup
        const { content: rawIntel, citations } = await lookupSellerIntel(
          seller.phone,
          seller.primary_state,
          seller.regions_seen,
          seller.makes_seen,
        );

        console.log(`[enrich-seller] Got intel (${rawIntel.length} chars), classifying...`);

        // Step 2: Claude classification
        const classification = await classifySeller(rawIntel, seller.phone);

        const result: EnrichmentResult = {
          seller_id: seller.id,
          phone: seller.phone,
          ...classification,
          raw_intel: rawIntel,
          citations,
          error: null,
        };

        // Step 3: Update pipeline_sellers
        const { error: updateError } = await supabase
          .from('pipeline_sellers')
          .update({
            business_name: classification.business_name,
            website: classification.website,
            intel_value: classification.intel_value,
            business_type: classification.business_type,
            specialties: classification.specialties,
            relationship_notes: classification.relationship_notes,
            enrichment_status: 'enriched',
            last_enriched_at: new Date().toISOString(),
            // seller_name fallback if still null
            ...(classification.business_name && !seller.seller_name
              ? { seller_name: classification.business_name }
              : {}),
          })
          .eq('id', seller.id);

        if (updateError) {
          console.error(`[enrich-seller] Update error for ${seller.id}: ${updateError.message}`);
          result.error = `DB update: ${updateError.message}`;
        }

        enriched.push(result);
        console.log(`[enrich-seller] ✓ ${seller.phone} → ${classification.business_name || 'private seller'} (${classification.business_type})`);

        // Rate limit: don't hammer Perplexity
        await new Promise(r => setTimeout(r, 500));

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[enrich-seller] Error on ${seller.phone}: ${msg}`);
        errors.push(`${seller.phone}: ${msg}`);

        // Mark as partial so we can retry
        await supabase
          .from('pipeline_sellers')
          .update({ enrichment_status: 'partial' })
          .eq('id', seller.id);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: sellers.length,
        enriched: enriched.length,
        errors: errors.length,
        results: enriched.map(r => ({
          phone: r.phone,
          business_name: r.business_name,
          website: r.website,
          business_type: r.business_type,
          specialties: r.specialties,
          intel_value: r.intel_value,
          relationship_notes: r.relationship_notes,
          citations: r.citations.slice(0, 3),
          error: r.error,
        })),
        error_details: errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[enrich-seller] Fatal: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
