/**
 * Acquire Vehicle Edge Function
 *
 * Manages the acquisition workflow for vehicles in the acquisition_pipeline table.
 * Advances vehicles through stages and records details at each step.
 *
 * Actions:
 *   contact             - Move a target to contacted stage
 *   schedule_inspection - Move to inspecting stage
 *   make_offer          - Record an offer
 *   accept_deal         - Deal accepted, under contract
 *   mark_acquired       - Vehicle acquired
 *   deliver_to_shop     - Vehicle delivered to partner shop
 *   complete_validation - Validation/inspection complete
 *   list_for_sale       - Ready to list for resale
 *   record_sale         - Vehicle sold
 *   dashboard           - Get summary of all active deals
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, pipeline_id, ...params } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (!action) {
      return jsonResponse({ error: 'Missing required field: action' }, 400);
    }

    // -----------------------------------------------------------------------
    // Dashboard: summary of all active deals
    // -----------------------------------------------------------------------
    if (action === 'dashboard') {
      return await handleDashboard(supabase);
    }

    // All other actions require a pipeline_id
    if (!pipeline_id) {
      return jsonResponse({ error: 'Missing required field: pipeline_id' }, 400);
    }

    // Fetch the current pipeline entry
    const { data: entry, error: fetchError } = await supabase
      .from('acquisition_pipeline')
      .select('*')
      .eq('id', pipeline_id)
      .single();

    if (fetchError || !entry) {
      return jsonResponse(
        { error: `Pipeline entry not found: ${fetchError?.message || 'no matching id'}` },
        404,
      );
    }

    const vehicle = `${entry.year || '?'} ${entry.make || '?'} ${entry.model || '?'}`;
    console.log(`[acquire-vehicle] action=${action} pipeline=${pipeline_id} vehicle=${vehicle} current_stage=${entry.stage}`);

    // -----------------------------------------------------------------------
    // Route to action handler
    // -----------------------------------------------------------------------
    switch (action) {
      case 'contact':
        return await handleContact(supabase, entry, params);
      case 'schedule_inspection':
        return await handleScheduleInspection(supabase, entry, params);
      case 'make_offer':
        return await handleMakeOffer(supabase, entry, params);
      case 'accept_deal':
        return await handleAcceptDeal(supabase, entry, params);
      case 'mark_acquired':
        return await handleMarkAcquired(supabase, entry, params);
      case 'deliver_to_shop':
        return await handleDeliverToShop(supabase, entry, params);
      case 'complete_validation':
        return await handleCompleteValidation(supabase, entry, params);
      case 'list_for_sale':
        return await handleListForSale(supabase, entry, params);
      case 'record_sale':
        return await handleRecordSale(supabase, entry, params);
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[acquire-vehicle] Error: ${message}`);
    return jsonResponse({ error: message }, 500);
  }
});

// ==========================================================================
// Action Handlers
// ==========================================================================

/**
 * contact - Move a target to contacted stage
 */
async function handleContact(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { contact_method, contact_notes } = params;

  if (!contact_method) {
    return jsonResponse({ error: 'Missing required field: contact_method' }, 400);
  }

  const updatedNotes = appendNotes(
    entry.notes as string | null,
    `[Contacted] Method: ${contact_method}${contact_notes ? ` — ${contact_notes}` : ''}`,
  );

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update({
      stage: 'contacted',
      seller_contact: contact_method,
      notes: updatedNotes,
      stage_updated_at: new Date().toISOString(),
    })
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'contacted'`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'contacted',
    vehicle: formatVehicle(entry),
    data,
  });
}

/**
 * schedule_inspection - Move to inspecting
 */
async function handleScheduleInspection(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { shop_name, inspection_date, estimated_cost } = params;

  if (!shop_name) {
    return jsonResponse({ error: 'Missing required field: shop_name' }, 400);
  }

  // Look up partner shop by name if provided
  let partner_shop_id: string | null = null;
  if (shop_name) {
    const { data: shop } = await supabase
      .from('partner_shops')
      .select('id')
      .ilike('name', shop_name)
      .maybeSingle();

    if (shop) {
      partner_shop_id = shop.id;
    }
  }

  const noteLines = [`[Inspection Scheduled] Shop: ${shop_name}`];
  if (inspection_date) noteLines.push(`Date: ${inspection_date}`);
  if (estimated_cost) noteLines.push(`Est. cost: $${estimated_cost}`);

  const updatedNotes = appendNotes(entry.notes as string | null, noteLines.join(', '));

  const updatePayload: Record<string, unknown> = {
    stage: 'inspecting',
    notes: updatedNotes,
    stage_updated_at: new Date().toISOString(),
  };
  if (partner_shop_id) updatePayload.partner_shop_id = partner_shop_id;

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update(updatePayload)
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'inspecting' at shop '${shop_name}'`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'inspecting',
    vehicle: formatVehicle(entry),
    partner_shop_id,
    data,
  });
}

/**
 * make_offer - Make an offer
 */
async function handleMakeOffer(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { offer_amount, offer_notes } = params;

  if (!offer_amount) {
    return jsonResponse({ error: 'Missing required field: offer_amount' }, 400);
  }

  const updatedNotes = appendNotes(
    entry.notes as string | null,
    `[Offer Made] $${Number(offer_amount).toLocaleString()}${offer_notes ? ` — ${offer_notes}` : ''}`,
  );

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update({
      stage: 'offer_made',
      offer_amount,
      offer_date: new Date().toISOString(),
      notes: updatedNotes,
      stage_updated_at: new Date().toISOString(),
    })
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'offer_made' — $${offer_amount}`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'offer_made',
    vehicle: formatVehicle(entry),
    offer_amount,
    data,
  });
}

/**
 * accept_deal - Deal accepted, under contract
 */
async function handleAcceptDeal(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { purchase_price, title_status, notes: dealNotes } = params;

  if (!purchase_price) {
    return jsonResponse({ error: 'Missing required field: purchase_price' }, 400);
  }

  const updatedNotes = appendNotes(
    entry.notes as string | null,
    `[Deal Accepted] Purchase: $${Number(purchase_price).toLocaleString()}` +
      (title_status ? `, Title: ${title_status}` : '') +
      (dealNotes ? ` — ${dealNotes}` : ''),
  );

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update({
      stage: 'under_contract',
      purchase_price,
      purchase_date: new Date().toISOString(),
      title_status: title_status || null,
      notes: updatedNotes,
      stage_updated_at: new Date().toISOString(),
    })
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'under_contract' — $${purchase_price}`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'under_contract',
    vehicle: formatVehicle(entry),
    purchase_price,
    data,
  });
}

/**
 * mark_acquired - Vehicle acquired
 */
async function handleMarkAcquired(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { total_cost, notes: acquireNotes } = params;

  // total_investment is a generated column (purchase_price + reconditioning_cost + repair_estimate),
  // so we do not write to it directly. If total_cost is provided and differs from purchase_price,
  // we record the extra in reconditioning_cost so the generated total_investment stays accurate.
  const updatePayload: Record<string, unknown> = {
    stage: 'acquired',
    stage_updated_at: new Date().toISOString(),
  };

  if (total_cost != null) {
    const currentPurchase = Number(entry.purchase_price) || 0;
    const currentRepair = Number(entry.repair_estimate) || 0;
    const currentRecon = Number(entry.reconditioning_cost) || 0;
    const overage = Number(total_cost) - currentPurchase - currentRepair - currentRecon;
    if (overage > 0) {
      updatePayload.reconditioning_cost = currentRecon + overage;
    }
  }

  const updatedNotes = appendNotes(
    entry.notes as string | null,
    `[Acquired]${total_cost ? ` Total cost: $${Number(total_cost).toLocaleString()}` : ''}` +
      (acquireNotes ? ` — ${acquireNotes}` : ''),
  );
  updatePayload.notes = updatedNotes;

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update(updatePayload)
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'acquired'`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'acquired',
    vehicle: formatVehicle(entry),
    total_investment: data.total_investment,
    data,
  });
}

/**
 * deliver_to_shop - Vehicle delivered to partner shop
 */
async function handleDeliverToShop(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { shop_name, notes: shopNotes } = params;

  if (!shop_name) {
    return jsonResponse({ error: 'Missing required field: shop_name' }, 400);
  }

  // Look up partner shop by name
  let partner_shop_id: string | null = entry.partner_shop_id as string | null;
  const { data: shop } = await supabase
    .from('partner_shops')
    .select('id')
    .ilike('name', shop_name)
    .maybeSingle();

  if (shop) {
    partner_shop_id = shop.id;
  }

  const updatedNotes = appendNotes(
    entry.notes as string | null,
    `[Delivered to Shop] ${shop_name}${shopNotes ? ` — ${shopNotes}` : ''}`,
  );

  const updatePayload: Record<string, unknown> = {
    stage: 'at_shop',
    shop_arrival_date: new Date().toISOString(),
    notes: updatedNotes,
    stage_updated_at: new Date().toISOString(),
  };
  if (partner_shop_id) updatePayload.partner_shop_id = partner_shop_id;

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update(updatePayload)
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'at_shop' — ${shop_name}`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'at_shop',
    vehicle: formatVehicle(entry),
    partner_shop_id,
    data,
  });
}

/**
 * complete_validation - Validation/inspection complete
 */
async function handleCompleteValidation(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const {
    inspection_report,
    repair_estimate,
    numbers_matching,
    authentication_result,
  } = params;

  const updatePayload: Record<string, unknown> = {
    stage: 'validated',
    stage_updated_at: new Date().toISOString(),
  };

  if (inspection_report !== undefined) updatePayload.inspection_report = inspection_report;
  if (repair_estimate !== undefined) updatePayload.repair_estimate = repair_estimate;
  if (numbers_matching !== undefined) updatePayload.numbers_matching_verified = numbers_matching;
  if (authentication_result !== undefined) updatePayload.authentication_result = authentication_result;

  const noteLines = ['[Validation Complete]'];
  if (numbers_matching !== undefined) noteLines.push(`Numbers matching: ${numbers_matching ? 'YES' : 'NO'}`);
  if (repair_estimate !== undefined) noteLines.push(`Repair est: $${Number(repair_estimate).toLocaleString()}`);

  const updatedNotes = appendNotes(entry.notes as string | null, noteLines.join(', '));
  updatePayload.notes = updatedNotes;

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update(updatePayload)
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'validated'`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'validated',
    vehicle: formatVehicle(entry),
    numbers_matching,
    repair_estimate,
    data,
  });
}

/**
 * list_for_sale - Ready to list
 */
async function handleListForSale(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { listing_platform, listing_price, listing_url } = params;

  if (!listing_platform) {
    return jsonResponse({ error: 'Missing required field: listing_platform' }, 400);
  }

  const updatedNotes = appendNotes(
    entry.notes as string | null,
    `[Listed] Platform: ${listing_platform}` +
      (listing_price ? `, Ask: $${Number(listing_price).toLocaleString()}` : '') +
      (listing_url ? `, URL: ${listing_url}` : ''),
  );

  const updatePayload: Record<string, unknown> = {
    stage: 'listed',
    listing_platform,
    listing_date: new Date().toISOString(),
    notes: updatedNotes,
    stage_updated_at: new Date().toISOString(),
  };
  if (listing_url) updatePayload.listing_url_resale = listing_url;

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update(updatePayload)
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'listed' on ${listing_platform}`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'listed',
    vehicle: formatVehicle(entry),
    listing_platform,
    data,
  });
}

/**
 * record_sale - Vehicle sold
 */
async function handleRecordSale(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  const { sale_price, buyer_info } = params;

  if (!sale_price) {
    return jsonResponse({ error: 'Missing required field: sale_price' }, 400);
  }

  // gross_profit is a generated column: sale_price - purchase_price - reconditioning_cost - repair_estimate
  // It will be computed automatically once sale_price is set.

  const updatedNotes = appendNotes(
    entry.notes as string | null,
    `[Sold] $${Number(sale_price).toLocaleString()}` +
      (buyer_info ? ` — Buyer: ${typeof buyer_info === 'object' ? JSON.stringify(buyer_info) : buyer_info}` : ''),
  );

  const updatePayload: Record<string, unknown> = {
    stage: 'sold',
    sale_price,
    sale_date: new Date().toISOString(),
    notes: updatedNotes,
    stage_updated_at: new Date().toISOString(),
  };
  if (buyer_info !== undefined) updatePayload.buyer_info = buyer_info;

  const { data, error } = await supabase
    .from('acquisition_pipeline')
    .update(updatePayload)
    .eq('id', entry.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update: ${error.message}`);

  console.log(`[acquire-vehicle] Moved ${entry.id} to 'sold' — $${sale_price}, gross_profit=${data.gross_profit}`);
  return jsonResponse({
    success: true,
    pipeline_id: entry.id,
    stage: 'sold',
    vehicle: formatVehicle(entry),
    sale_price,
    gross_profit: data.gross_profit,
    data,
  });
}

/**
 * dashboard - Get summary of all active deals (not discovered or market_proofed)
 */
async function handleDashboard(supabase: ReturnType<typeof createClient>) {
  // Active stages: everything past market_proofed
  const excludedStages = ['discovered', 'market_proofed'];

  const { data: deals, error } = await supabase
    .from('acquisition_pipeline')
    .select(
      'id, year, make, model, stage, asking_price, offer_amount, purchase_price, ' +
      'total_investment, sale_price, gross_profit, listing_platform, partner_shop_id, ' +
      'seller_contact, title_status, stage_updated_at, priority, deal_score, notes',
    )
    .not('stage', 'in', `(${excludedStages.join(',')})`)
    .order('stage_updated_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch active deals: ${error.message}`);

  // Group by stage
  const byStage: Record<string, Array<Record<string, unknown>>> = {};
  for (const deal of deals || []) {
    const stage = deal.stage as string;
    if (!byStage[stage]) byStage[stage] = [];
    byStage[stage].push({
      id: deal.id,
      vehicle: `${deal.year || '?'} ${deal.make || '?'} ${deal.model || '?'}`,
      stage: deal.stage,
      asking_price: deal.asking_price,
      offer_amount: deal.offer_amount,
      purchase_price: deal.purchase_price,
      total_investment: deal.total_investment,
      sale_price: deal.sale_price,
      gross_profit: deal.gross_profit,
      listing_platform: deal.listing_platform,
      priority: deal.priority,
      deal_score: deal.deal_score,
      stage_updated_at: deal.stage_updated_at,
    });
  }

  // Stage summary counts
  const stageSummary = Object.entries(byStage).map(([stage, items]) => ({
    stage,
    count: items.length,
    total_invested: items.reduce((s, d) => s + (Number(d.total_investment) || 0), 0),
  }));

  const totalActive = (deals || []).length;
  const totalInvested = (deals || []).reduce((s, d) => s + (Number(d.total_investment) || 0), 0);
  const totalGrossProfit = (deals || [])
    .filter((d) => d.stage === 'sold')
    .reduce((s, d) => s + (Number(d.gross_profit) || 0), 0);

  console.log(`[acquire-vehicle] Dashboard: ${totalActive} active deals across ${stageSummary.length} stages`);

  return jsonResponse({
    active_deals: totalActive,
    total_invested: totalInvested,
    total_gross_profit: totalGrossProfit,
    stage_summary: stageSummary,
    deals_by_stage: byStage,
    generated_at: new Date().toISOString(),
  });
}

// ==========================================================================
// Utilities
// ==========================================================================

function appendNotes(existing: string | null, addition: string): string {
  const timestamp = new Date().toISOString().slice(0, 10);
  const line = `[${timestamp}] ${addition}`;
  return existing ? `${existing}\n${line}` : line;
}

function formatVehicle(entry: Record<string, unknown>): string {
  return `${entry.year || '?'} ${entry.make || '?'} ${entry.model || '?'}`;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
