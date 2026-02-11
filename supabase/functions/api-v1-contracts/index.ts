/**
 * API v1 - Contracts Endpoint
 *
 * Agent-ready RESTful API for browsing, analyzing, and subscribing to
 * investment contracts. Designed for AI agents acting on behalf of
 * legal entities (accredited investors, funds, individuals).
 *
 * Endpoints:
 *   GET  /api-v1-contracts              List/search contracts
 *   GET  /api-v1-contracts/:id          Get contract details + assets
 *   GET  /api-v1-contracts/:id/assets   Get enriched asset breakdown
 *   POST /api-v1-contracts/:id/subscribe  Subscribe (invest) on behalf of entity
 *   GET  /api-v1-contracts/:id/position  Get caller's position in contract
 *
 * Auth: Bearer JWT, Service Role Key, or API Key (X-API-Key header)
 * Access tiers:
 *   - public:      contract summary, type, AUM, return, status
 *   - authenticated: + full asset list, allocation weights
 *   - accredited:   + valuations, VINs, transaction history, grain data
 *   - curator:      + investor positions, subscription flow
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { userId, isServiceRole, error: authError } = await authenticateRequest(req, supabase);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Path: /api-v1-contracts or /api-v1-contracts/:id or /api-v1-contracts/:id/assets etc
    const funcName = "api-v1-contracts";
    const funcIdx = pathParts.indexOf(funcName);
    const contractId = funcIdx >= 0 ? pathParts[funcIdx + 1] : undefined;
    const subResource = funcIdx >= 0 ? pathParts[funcIdx + 2] : undefined;

    // ─── GET: List contracts ───────────────────────────────────
    if (req.method === "GET" && !contractId) {
      return await listContracts(url, supabase, userId);
    }

    // ─── GET: Single contract detail ──────────────────────────
    if (req.method === "GET" && contractId && !subResource) {
      return await getContract(contractId, supabase, userId, isServiceRole);
    }

    // ─── GET: Contract assets (enriched) ──────────────────────
    if (req.method === "GET" && contractId && subResource === "assets") {
      return await getContractAssets(contractId, supabase, userId, isServiceRole);
    }

    // ─── GET: Caller's position ───────────────────────────────
    if (req.method === "GET" && contractId && subResource === "position") {
      if (!userId || isServiceRole) return json({ error: "Auth required for position lookup" }, 401);
      return await getPosition(contractId, userId, supabase);
    }

    // ─── POST: Subscribe (invest) ─────────────────────────────
    if (req.method === "POST" && contractId && subResource === "subscribe") {
      if (!userId || isServiceRole) return json({ error: "Auth required to subscribe" }, 401);
      const body = await req.json();
      return await subscribe(contractId, userId, body, supabase);
    }

    return json({ error: "Not found" }, 404);
  } catch (e: any) {
    console.error("api-v1-contracts error:", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// LIST CONTRACTS — agent-friendly search with structured filters
// ═══════════════════════════════════════════════════════════════
async function listContracts(url: URL, supabase: any, userId: string | null) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
  const offset = (page - 1) * limit;

  // Structured filters for agent use
  const contractType = url.searchParams.get("type"); // etf, bond_fund, equity_fund, hybrid, etc.
  const status = url.searchParams.get("status") || "active,approved";
  const minAum = url.searchParams.get("min_aum_cents");
  const maxMinInvestment = url.searchParams.get("max_min_investment_cents");
  const regulatory = url.searchParams.get("regulatory"); // reg_d, reg_a, reg_cf, public
  const riskLevel = url.searchParams.get("risk_level"); // conservative, moderate, aggressive, speculative
  const search = url.searchParams.get("q");
  const sortBy = url.searchParams.get("sort") || "total_assets_under_management_cents";
  const sortOrder = url.searchParams.get("order") === "asc" ? true : false;
  const curatorId = url.searchParams.get("curator_id");
  const tag = url.searchParams.get("tag");

  let query = supabase
    .from("custom_investment_contracts")
    .select(
      `id, contract_name, contract_symbol, contract_description, contract_type,
       curator_name, curator_id,
       legal_entity_type, jurisdiction, regulatory_status,
       minimum_investment_cents, maximum_investment_cents,
       share_structure, current_nav_cents,
       management_fee_pct, performance_fee_pct, transaction_fee_pct,
       liquidity_type, lockup_period_days,
       risk_level, target_returns_pct,
       transparency_level,
       status,
       total_assets_under_management_cents, total_investors,
       total_return_pct, annualized_return_pct,
       tags, launch_date, inception_date,
       created_at, updated_at`,
      { count: "estimated" }
    );

  // Status filter (default: active + approved only)
  const statuses = status.split(",").map((s: string) => s.trim()).filter(Boolean);
  if (statuses.length === 1) {
    query = query.eq("status", statuses[0]);
  } else if (statuses.length > 1) {
    query = query.in("status", statuses);
  }

  if (contractType) query = query.eq("contract_type", contractType);
  if (regulatory) query = query.eq("regulatory_status", regulatory);
  if (riskLevel) query = query.eq("risk_level", riskLevel);
  if (curatorId) query = query.eq("curator_id", curatorId);
  if (minAum) query = query.gte("total_assets_under_management_cents", parseInt(minAum));
  if (maxMinInvestment) query = query.lte("minimum_investment_cents", parseInt(maxMinInvestment));
  if (tag) query = query.contains("tags", [tag]);

  if (search) {
    query = query.or(
      `contract_name.ilike.%${search}%,contract_symbol.ilike.%${search}%,contract_description.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query
    .order(sortBy, { ascending: sortOrder })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  return json({
    data: data || [],
    pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) },
    filters_applied: {
      type: contractType, status: statuses, regulatory, risk_level: riskLevel,
      min_aum_cents: minAum, max_min_investment_cents: maxMinInvestment,
      search, tag, curator_id: curatorId,
    },
    _meta: {
      description: "Investment contracts available for subscription. Each contract is a curated basket of vehicles, bonds, equity stakes, and/or organizations.",
      agent_hint: "Use 'type' filter to narrow by strategy. Use 'risk_level' for risk preference. Use 'max_min_investment_cents' to filter by budget. GET /:id for full details. POST /:id/subscribe to invest.",
      available_filters: {
        type: ["etf", "bond_fund", "equity_fund", "hybrid", "project_fund", "organization_fund", "custom"],
        status: ["active", "approved", "draft", "closed"],
        regulatory: ["private_placement", "reg_d", "reg_a", "reg_cf", "public"],
        risk_level: ["conservative", "moderate", "aggressive", "speculative"],
        sort: ["total_assets_under_management_cents", "total_return_pct", "annualized_return_pct", "minimum_investment_cents", "created_at"],
      },
      financial_context: {
        thesis: "Collector vehicles as alternative assets hedge against inflation. Tangible assets with provenance, scarcity, and cultural significance appreciate independently of equity/bond markets.",
        correlation: "Low correlation to S&P 500 (historically 0.05-0.15). Collector car indices have outperformed inflation by 2-4% annually over 20-year periods.",
        risk_factors: ["Illiquidity", "Storage/insurance costs", "Condition sensitivity", "Market sentiment cycles", "Authentication risk"],
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// GET CONTRACT — full detail with access-tier gating
// ═══════════════════════════════════════════════════════════════
async function getContract(contractId: string, supabase: any, userId: string | null, isServiceRole?: boolean) {
  const { data: contract, error } = await supabase
    .from("custom_investment_contracts")
    .select("*")
    .eq("id", contractId)
    .single();

  if (error || !contract) return json({ error: "Contract not found" }, 404);

  // Public contracts: anyone can see summary
  // Draft contracts: only curator
  if (contract.status === "draft" && contract.curator_id !== userId && !isServiceRole) {
    return json({ error: "Contract not published" }, 403);
  }

  const isCurator = userId === contract.curator_id || isServiceRole;

  // Get asset count and type breakdown
  const { data: assets } = await supabase
    .from("contract_assets")
    .select("asset_type, allocation_pct, current_value_cents")
    .eq("contract_id", contractId);

  const assetBreakdown: Record<string, { count: number; total_value_cents: number; allocation_pct: number }> = {};
  for (const a of assets || []) {
    if (!assetBreakdown[a.asset_type]) assetBreakdown[a.asset_type] = { count: 0, total_value_cents: 0, allocation_pct: 0 };
    assetBreakdown[a.asset_type].count++;
    assetBreakdown[a.asset_type].total_value_cents += a.current_value_cents || 0;
    assetBreakdown[a.asset_type].allocation_pct += a.allocation_pct || 0;
  }

  // Latest performance
  const { data: latestPerf } = await supabase
    .from("contract_performance")
    .select("*")
    .eq("contract_id", contractId)
    .order("performance_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const result: any = {
    contract,
    asset_summary: {
      total_assets: (assets || []).length,
      breakdown: assetBreakdown,
    },
    performance: latestPerf || null,
    access_level: isCurator ? "curator" : userId ? "authenticated" : "public",
    _meta: {
      agent_hint: isCurator
        ? "You are the curator. GET /:id/assets for full enriched asset list. You can view investor positions."
        : userId
        ? "You are authenticated. GET /:id/assets for holdings. POST /:id/subscribe to invest. GET /:id/position for your position."
        : "Authenticate to see full holdings and subscribe.",
      regulatory_context: getRegulatoryContext(contract.regulatory_status),
      entity_context: getEntityContext(contract.legal_entity_type),
    },
  };

  // Curator-only: investor summary
  if (isCurator) {
    const { data: investors } = await supabase
      .from("contract_investors")
      .select("id, shares_owned, total_invested_cents, status, created_at")
      .eq("contract_id", contractId);

    result.investor_summary = {
      total_investors: (investors || []).length,
      active_investors: (investors || []).filter((i: any) => i.status === "active").length,
      total_shares_outstanding: (investors || []).reduce((s: number, i: any) => s + (i.shares_owned || 0), 0),
      total_invested_cents: (investors || []).reduce((s: number, i: any) => s + (i.total_invested_cents || 0), 0),
    };
  }

  return json(result);
}

// ═══════════════════════════════════════════════════════════════
// GET ASSETS — enriched asset details with type-specific data
// ═══════════════════════════════════════════════════════════════
async function getContractAssets(contractId: string, supabase: any, userId: string | null, isServiceRole?: boolean) {
  // Verify contract exists and check access
  const { data: contract } = await supabase
    .from("custom_investment_contracts")
    .select("id, curator_id, status, transparency_level, regulatory_status")
    .eq("id", contractId)
    .single();

  if (!contract) return json({ error: "Contract not found" }, 404);
  if (contract.status === "draft" && contract.curator_id !== userId && !isServiceRole) {
    return json({ error: "Contract not published" }, 403);
  }

  const isCurator = userId === contract.curator_id || isServiceRole;
  const isAccredited = isCurator || isServiceRole; // TODO: check accreditation status from user profile

  // Get raw assets
  const { data: rawAssets } = await supabase
    .from("contract_assets")
    .select("*")
    .eq("contract_id", contractId)
    .order("allocation_pct", { ascending: false });

  if (!rawAssets || rawAssets.length === 0) return json({ assets: [], _meta: { total: 0 } });

  // Batch-enrich by type
  const byType: Record<string, string[]> = {};
  for (const a of rawAssets) {
    if (!byType[a.asset_type]) byType[a.asset_type] = [];
    byType[a.asset_type].push(a.asset_id);
  }

  const detailsMap: Record<string, any> = {};
  const fetches: Promise<void>[] = [];

  if (byType.vehicle?.length) {
    // Accredited: full details. Public: summary only
    const vehicleSelect = isAccredited
      ? "id, year, make, model, vin, mileage, color, location, city, state, country, purchase_price_cents, current_value, primary_image_url, image_count, receipt_count"
      : "id, year, make, model, color, city, state, primary_image_url";

    fetches.push(
      supabase.from("vehicles").select(vehicleSelect).in("id", byType.vehicle)
        .then(({ data }: any) => {
          (data || []).forEach((v: any) => {
            // Mask VIN for non-curators
            if (v.vin && !isCurator) v.vin = v.vin.slice(0, 3) + "***" + v.vin.slice(-4);
            detailsMap[v.id] = v;
          });
        })
    );
  }

  if (byType.organization?.length) {
    fetches.push(
      supabase.from("businesses").select("id, business_name, business_type, city, state, country, employee_count, reputation_score")
        .in("id", byType.organization)
        .then(({ data }: any) => { (data || []).forEach((o: any) => { detailsMap[o.id] = o; }); })
    );
  }

  if (byType.bond?.length) {
    fetches.push(
      supabase.from("vehicle_bonds")
        .select("id, principal_amount_cents, interest_rate_pct, term_months, status, maturity_date, issuer_name, issuer_type, coupon_rate_pct, payments_on_time, collateral_description")
        .in("id", byType.bond)
        .then(({ data }: any) => { (data || []).forEach((b: any) => { detailsMap[b.id] = b; }); })
    );
  }

  if (byType.stake?.length) {
    fetches.push(
      supabase.from("vehicle_funding_rounds")
        .select("id, target_amount_cents, raised_amount_cents, profit_share_pct, status, equity_pct, target_sale_price_cents, expected_profit_cents, vehicle_id")
        .in("id", byType.stake)
        .then(({ data }: any) => { (data || []).forEach((s: any) => { detailsMap[s.id] = s; }); })
    );
  }

  await Promise.all(fetches);

  const enrichedAssets = rawAssets.map((asset: any) => ({
    ...asset,
    details: detailsMap[asset.asset_id] || null,
    display_name: getAssetDisplayName(asset, detailsMap[asset.asset_id]),
  }));

  return json({
    assets: enrichedAssets,
    access_level: isCurator ? "curator" : isAccredited ? "accredited" : userId ? "authenticated" : "public",
    _meta: {
      total: enrichedAssets.length,
      types: Object.entries(byType).map(([type, ids]) => ({ type, count: ids.length })),
      agent_hint: "Each asset has 'details' with type-specific enrichment. 'display_name' is human-readable. Vehicles include primary_image_url for visual context.",
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// GET POSITION — caller's investment in this contract
// ═══════════════════════════════════════════════════════════════
async function getPosition(contractId: string, userId: string, supabase: any) {
  const { data: position } = await supabase
    .from("contract_investors")
    .select("*")
    .eq("contract_id", contractId)
    .eq("investor_id", userId)
    .maybeSingle();

  if (!position) {
    return json({
      invested: false,
      _meta: { agent_hint: "No position in this contract. POST /:id/subscribe to invest." },
    });
  }

  // Recent transactions
  const { data: txns } = await supabase
    .from("contract_transactions")
    .select("*")
    .eq("contract_id", contractId)
    .eq("investor_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  return json({
    invested: true,
    position,
    recent_transactions: txns || [],
    _meta: {
      agent_hint: "Position shows shares_owned, unrealized_gain_loss_cents, and total_invested_cents. Check lockup_expires_at before attempting redemption.",
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIBE — invest in a contract on behalf of authenticated user
// ═══════════════════════════════════════════════════════════════
async function subscribe(contractId: string, userId: string, body: any, supabase: any) {
  const { amount_cents, notes } = body;

  if (!amount_cents || amount_cents <= 0) {
    return json({ error: "amount_cents is required and must be positive" }, 400);
  }

  // Load contract
  const { data: contract } = await supabase
    .from("custom_investment_contracts")
    .select("*")
    .eq("id", contractId)
    .single();

  if (!contract) return json({ error: "Contract not found" }, 404);

  // Validate contract is accepting subscriptions
  if (!["active", "approved"].includes(contract.status)) {
    return json({
      error: "Contract is not accepting subscriptions",
      contract_status: contract.status,
      _meta: { agent_hint: "Only 'active' or 'approved' contracts accept subscriptions." },
    }, 400);
  }

  // Check minimum investment
  if (amount_cents < contract.minimum_investment_cents) {
    return json({
      error: `Minimum investment is ${contract.minimum_investment_cents} cents ($${(contract.minimum_investment_cents / 100).toLocaleString()})`,
      minimum_investment_cents: contract.minimum_investment_cents,
      requested_cents: amount_cents,
    }, 400);
  }

  // Check maximum
  if (contract.maximum_investment_cents && amount_cents > contract.maximum_investment_cents) {
    return json({
      error: `Maximum investment is ${contract.maximum_investment_cents} cents`,
      maximum_investment_cents: contract.maximum_investment_cents,
    }, 400);
  }

  // TODO: Check accreditation for reg_d contracts
  // For now, flag it but proceed (paper trading / intent recording)
  const regulatoryWarning = contract.regulatory_status === "reg_d"
    ? "This is a Reg D offering. Full subscription requires accredited investor verification."
    : null;

  // Calculate shares based on current NAV
  const navPerShare = contract.current_nav_cents || contract.initial_share_price_cents || 10000; // Default $100/share
  const sharesAmount = amount_cents / navPerShare;

  // Calculate fees
  const transactionFeeCents = Math.round(amount_cents * (contract.transaction_fee_pct / 100));
  const netAmountCents = amount_cents - transactionFeeCents;

  // Create transaction record
  const { data: txn, error: txnError } = await supabase
    .from("contract_transactions")
    .insert({
      contract_id: contractId,
      investor_id: userId,
      transaction_type: "subscription",
      shares_amount: sharesAmount,
      cash_amount_cents: amount_cents,
      nav_per_share_cents: navPerShare,
      transaction_fee_cents: transactionFeeCents,
      total_fees_cents: transactionFeeCents,
      status: regulatoryWarning ? "pending" : "completed",
      notes: notes || null,
    })
    .select()
    .single();

  if (txnError) throw txnError;

  // Upsert investor position
  const { data: existingPos } = await supabase
    .from("contract_investors")
    .select("id, shares_owned, total_invested_cents")
    .eq("contract_id", contractId)
    .eq("investor_id", userId)
    .maybeSingle();

  if (existingPos) {
    await supabase
      .from("contract_investors")
      .update({
        shares_owned: (existingPos.shares_owned || 0) + sharesAmount,
        total_invested_cents: (existingPos.total_invested_cents || 0) + netAmountCents,
        last_investment_date: new Date().toISOString(),
        current_nav_cents: navPerShare,
      })
      .eq("id", existingPos.id);
  } else {
    await supabase
      .from("contract_investors")
      .insert({
        contract_id: contractId,
        investor_id: userId,
        shares_owned: sharesAmount,
        total_invested_cents: netAmountCents,
        entry_nav_cents: navPerShare,
        current_nav_cents: navPerShare,
        average_entry_price_cents: navPerShare,
        lockup_expires_at: contract.lockup_period_days
          ? new Date(Date.now() + contract.lockup_period_days * 86400000).toISOString()
          : null,
      });
  }

  // Update contract totals
  await supabase.rpc("update_contract_totals", { p_contract_id: contractId }).catch(() => {
    // RPC may not exist yet — non-critical
  });

  return json({
    success: true,
    transaction: txn,
    subscription: {
      shares_acquired: sharesAmount,
      nav_per_share_cents: navPerShare,
      amount_invested_cents: amount_cents,
      transaction_fee_cents: transactionFeeCents,
      net_investment_cents: netAmountCents,
    },
    regulatory_warning: regulatoryWarning,
    _meta: {
      agent_hint: regulatoryWarning
        ? "Transaction is PENDING accredited investor verification. Status will update once verified."
        : "Subscription completed. GET /:id/position to check your holdings.",
    },
  }, 201);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getAssetDisplayName(asset: any, details: any): string {
  if (!details) return `${asset.asset_type.toUpperCase()} #${asset.asset_id.slice(-8)}`;
  switch (asset.asset_type) {
    case "vehicle": return `${details.year} ${details.make} ${details.model}`;
    case "organization": return details.business_name || `Org #${asset.asset_id.slice(-8)}`;
    case "bond": return details.issuer_name ? `${details.issuer_name} Bond` : `Bond #${asset.asset_id.slice(-8)}`;
    case "stake": return `Equity Stake #${asset.asset_id.slice(-8)}`;
    default: return `${asset.asset_type} #${asset.asset_id.slice(-8)}`;
  }
}

function getRegulatoryContext(status: string): any {
  const contexts: Record<string, any> = {
    reg_d: {
      name: "SEC Regulation D",
      description: "Private placement exemption from SEC registration. Allows companies to raise capital without a public offering.",
      investor_requirements: "Must be an accredited investor: net worth > $1M (excluding primary residence) OR annual income > $200K ($300K joint) for past 2 years.",
      filing: "Form D filed with SEC within 15 days of first sale.",
      restrictions: "Securities are restricted — cannot be freely resold for 6-12 months. No general solicitation (Rule 506(b)) or general solicitation allowed with verification (Rule 506(c)).",
      rules: ["Rule 504 (up to $10M)", "Rule 506(b) (unlimited, 35 non-accredited)", "Rule 506(c) (unlimited, accredited only, general solicitation OK)"],
    },
    reg_a: {
      name: "SEC Regulation A (Mini-IPO)",
      description: "Allows smaller companies to raise up to $75M from public investors with simplified SEC filing.",
      investor_requirements: "Open to non-accredited investors. Tier 2 ($20-75M) limits non-accredited to 10% of income or net worth.",
      filing: "Offering Circular filed with and qualified by SEC.",
    },
    reg_cf: {
      name: "SEC Regulation Crowdfunding",
      description: "Allows raising up to $5M through SEC-registered funding portals.",
      investor_requirements: "Open to all investors. Annual investment limits based on income/net worth.",
      filing: "Form C filed with SEC via funding portal.",
    },
    private_placement: {
      name: "Private Placement",
      description: "Private offering of securities not registered with any regulatory body.",
      investor_requirements: "Varies by jurisdiction. Typically limited to qualified or sophisticated investors.",
    },
    public: {
      name: "Public Offering",
      description: "Fully registered securities available to all investors.",
      investor_requirements: "Open to all investors.",
    },
  };
  return contexts[status] || { name: status, description: "Regulatory status details not available." };
}

function getEntityContext(entityType: string): any {
  const contexts: Record<string, any> = {
    limited_partnership: {
      name: "Limited Partnership (LP)",
      description: "Partnership with general partner(s) managing the fund and limited partners as passive investors. LPs have limited liability.",
      tax_treatment: "Pass-through — income/losses flow to partners' individual returns. No entity-level tax.",
      governance: "General partner has management authority. Limited partners vote on major decisions (dissolution, GP removal).",
    },
    llc: {
      name: "Limited Liability Company (LLC)",
      description: "Flexible entity with limited liability for all members. Operating agreement governs management.",
      tax_treatment: "Default pass-through (can elect corporate taxation). Flexible profit/loss allocation.",
      governance: "Member-managed or manager-managed per operating agreement.",
    },
    trust: {
      name: "Trust",
      description: "Legal arrangement where trustee holds assets for beneficiaries. Used for estate planning and asset protection.",
      tax_treatment: "Grantor trust: transparent for tax. Non-grantor: taxed at compressed rates.",
    },
    spv: {
      name: "Special Purpose Vehicle (SPV)",
      description: "Single-purpose entity created specifically for this investment. Isolates assets and liabilities from parent.",
      tax_treatment: "Depends on SPV structure (typically LLC or LP with pass-through treatment).",
      governance: "Managed by sponsor with investor rights per operating documents.",
    },
    corporation: {
      name: "Corporation",
      description: "Separate legal entity with shareholders. Subject to corporate governance requirements.",
      tax_treatment: "C-Corp: double taxation (corporate + dividend). S-Corp: pass-through (restrictions apply).",
    },
  };
  return contexts[entityType] || { name: entityType, description: "Entity details not available." };
}

async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; isServiceRole?: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceRoleKey && token === serviceRoleKey) {
      return { userId: "service-role", isServiceRole: true };
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) return { userId: user.id };
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith("nk_live_") ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);

    const { data: keyData } = await supabase
      .from("api_keys")
      .select("user_id, scopes, is_active, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyData) {
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        return { userId: null, error: "API key expired" };
      }
      return { userId: keyData.user_id };
    }
  }

  // Allow unauthenticated read access (public contracts)
  return { userId: null };
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
