// Read-only handlers for the Nuke Asset Advisor surface.
import {
  AGENT_CITATION_RULES,
  citationFromObservation,
  emptyCitation,
  extractEventTime,
  makeEnvelope,
  notRecordedClaim,
  recordedClaim,
  resolveClaimConfidence,
  type AdvisorEnvelope,
  type Claim,
  type Citation,
} from "./evidence.ts";

/** Minimal PostgREST-shaped client used by advisor handlers (avoids pulling supabase-js types into Deno tests). */
// deno-lint-ignore no-explicit-any
export type AdvisorDb = any;

export interface AdvisorDeps {
  sb: () => AdvisorDb;
  callEdgeApi: (
    endpoint: string,
    path?: string,
    method?: "GET" | "POST",
    body?: Record<string, unknown>,
  ) => Promise<unknown>;
}

export interface AdvisorToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: AdvisorEnvelope;
  isError?: boolean;
}

function ok(envelope: AdvisorEnvelope): AdvisorToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
  };
}

function err(msg: string, tool: string): AdvisorToolResult {
  const envelope = makeEnvelope(tool, "vehicle", null, [], { error: msg });
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
    isError: true,
  };
}

function assetType(args: Record<string, unknown>): string {
  const t = typeof args.asset_type === "string" ? args.asset_type : "vehicle";
  return t || "vehicle";
}

function unsupportedAsset(args: Record<string, unknown>, tool: string): AdvisorToolResult | null {
  const t = assetType(args);
  if (t !== "vehicle") {
    return err(
      `asset_type '${t}' is not yet supported on this surface (vehicles only).`,
      tool,
    );
  }
  return null;
}

const IDENTITY_FIELDS = [
  "year",
  "make",
  "model",
  "trim",
  "vin",
  "body_style",
  "exterior_color",
  "interior_color",
  "mileage",
  "engine_type",
  "transmission",
  "drivetrain",
] as const;

const FIELD_ALIASES: Record<string, string[]> = {
  exterior_color: ["color", "exterior_color", "colour"],
  color: ["color", "exterior_color"],
  sale_price: ["sale_price", "final_price", "high_bid"],
  mileage: ["mileage", "odometer"],
};

function fieldKeys(field: string): string[] {
  const f = field.toLowerCase();
  return FIELD_ALIASES[f] ?? [f];
}

async function loadSources(
  sb: AdvisorDb,
  sourceIds: string[],
): Promise<Map<string, { display_name: string; base_trust_score: number | null; slug: string }>> {
  const map = new Map();
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data } = await sb
    .from("observation_sources")
    .select("id, slug, display_name, base_trust_score")
    .in("id", ids);
  for (const s of data || []) {
    map.set(s.id, s);
  }
  return map;
}

async function priceFacts(sb: AdvisorDb, vid: string) {
  const { data } = await sb.rpc("vehicle_price_facts", { p_vehicle_ids: [vid] });
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return {
    kind: r.price_kind,
    amount: r.price_amount,
    as_of: r.price_as_of,
    live: r.price_live,
    outcome: r.outcome,
    sold: r.sold_basis
      ? { amount: r.sold_amount, on: r.sold_on, basis: r.sold_basis, from: r.sold_amount_from }
      : null,
    ask: r.ask_amount != null ? { amount: r.ask_amount, as_of: r.ask_as_of } : null,
    bid: r.bid_amount != null ? { amount: r.bid_amount, on: r.bid_on, from: r.bid_from } : null,
    estimate: r.estimate_amount != null
      ? { amount: r.estimate_amount, confidence: r.estimate_confidence, as_of: r.estimate_as_of }
      : null,
    source_url: r.source_url as string | null,
  };
}

function listingCitation(vehicle: Record<string, unknown>): Citation {
  const platform = vehicle.canonical_platform || vehicle.auction_source;
  const name =
    platform === "bat" || platform === "bringatrailer"
      ? "Bring a Trailer"
      : typeof platform === "string" && platform
      ? String(platform)
      : "listing";
  return emptyCitation({
    source_name: name,
    source_url: (vehicle.listing_url || vehicle.bat_auction_url || null) as string | null,
    observation_id: null,
    event_time: null,
    ingested_at: (vehicle.updated_at || vehicle.created_at || null) as string | null,
    is_superseded: false,
  });
}

export function createAdvisorHandlers(deps: AdvisorDeps): Record<
  string,
  (args: Record<string, unknown>) => Promise<AdvisorToolResult>
> {
  return {
    find_asset: (args) => handleFindAsset(deps, args),
    get_asset: (args) => handleGetAsset(deps, args),
    get_history: (args) => handleGetHistory(deps, args),
    explain_field: (args) => handleExplainField(deps, args),
    value_asset: (args) => handleValueAsset(deps, args),
    get_comps: (args) => handleGetComps(deps, args),
    get_coverage: (args) => handleGetCoverage(deps, args),
  };
}

async function handleFindAsset(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "find_asset");
  if (bad) return bad;
  const queryStr = String(args.query || "").trim();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  if (!queryStr) {
    return ok(makeEnvelope("find_asset", "vehicle", null, [], {
      results: [],
      count: 0,
      note: "Empty query",
    }));
  }

  const sb = deps.sb();
  const selectCols =
    "id, year, make, model, trim, vin, sale_price, mileage, primary_image_url, listing_url, bat_auction_url, nuke_estimate, location, auction_source, canonical_platform, updated_at, created_at";

  // Prefer indexed equality paths. Full-text on VIN/URL tokens times out on the live fleet.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const vinRe = /^[A-HJ-NPR-Z0-9]{11,17}$/i;
  const looksUrl = /^https?:\/\//i.test(queryStr) || /bringatrailer\.com|carsandbids\.com|ebay\.com/i.test(queryStr);

  let data: Record<string, unknown>[] | null = null;
  let error: { message: string } | null = null;

  if (uuidRe.test(queryStr)) {
    const res = await sb.from("vehicles").select(selectCols).eq("id", queryStr).limit(1);
    data = res.data;
    error = res.error;
  } else if (vinRe.test(queryStr.replace(/\s+/g, ""))) {
    const vin = queryStr.replace(/\s+/g, "").toUpperCase();
    const res = await sb.from("vehicles").select(selectCols).eq("vin", vin).limit(limit);
    data = res.data;
    error = res.error;
  } else if (looksUrl) {
    const url = queryStr.trim().replace(/\/$/, "");
    // Two equality-style ilike lookups — avoid .or() with raw URLs (commas/special chars break filters).
    const [a, b] = await Promise.all([
      sb.from("vehicles").select(selectCols).ilike("listing_url", `%${url}%`).limit(limit),
      sb.from("vehicles").select(selectCols).ilike("bat_auction_url", `%${url}%`).limit(limit),
    ]);
    error = a.error || b.error;
    const seen = new Set<string>();
    const merged: Record<string, unknown>[] = [];
    for (const row of [...(a.data || []), ...(b.data || [])]) {
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(row);
      if (merged.length >= limit) break;
    }
    data = merged;
  } else {
    // Year + make/model style queries: filter structured columns first, then light text search.
    const yearMatch = queryStr.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : null;
    const rest = queryStr.replace(/\b(19|20)\d{2}\b/, " ").trim();
    let query = sb.from("vehicles").select(selectCols).limit(limit);
    if (year) query = query.eq("year", year);
    if (rest) {
      const parts = rest.split(/\s+/).filter(Boolean);
      // Use ilike on make/model rather than search_vector for bounded latency.
      if (parts.length >= 2) {
        query = query.ilike("make", `%${parts[0]}%`).ilike("model", `%${parts.slice(1).join(" ")}%`);
      } else if (parts.length === 1) {
        query = query.or(`make.ilike.%${parts[0]}%,model.ilike.%${parts[0]}%`);
      }
    }
    const res = await query;
    data = res.data;
    error = res.error;
  }

  if (error) return err(error.message, "find_asset");

  const results = (data || []).map((v: Record<string, unknown>) => {
    const cit = listingCitation(v);
    const claims: Claim[] = [
      recordedClaim("year", v.year, { citations: [cit], confidence: 0.8, confidence_basis: "source_trust" }),
      recordedClaim("make", v.make, { citations: [cit], confidence: 0.8, confidence_basis: "source_trust" }),
      recordedClaim("model", v.model, { citations: [cit], confidence: 0.8, confidence_basis: "source_trust" }),
      recordedClaim("vin", v.vin, { citations: [cit], confidence: v.vin ? 0.9 : null, confidence_basis: v.vin ? "source_trust" : "none" }),
      recordedClaim("sale_price", v.sale_price, { citations: [cit], confidence: v.sale_price != null ? 0.75 : null, confidence_basis: "source_trust" }),
    ];
    return {
      asset_id: v.id,
      asset_type: "vehicle",
      label: [v.year, v.make, v.model].filter(Boolean).join(" "),
      listing_url: v.listing_url || v.bat_auction_url || null,
      primary_image_url: v.primary_image_url || null,
      claims,
    };
  });

  return ok(makeEnvelope("find_asset", "vehicle", null, [], {
    query: queryStr,
    count: results.length,
    results,
    note: AGENT_CITATION_RULES,
  }));
}

async function handleGetAsset(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_asset");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "get_asset");

  const sb = deps.sb();
  const { data: vehicle, error } = await sb
    .from("vehicles")
    .select(
      "id, vin, year, make, model, trim, series, body_style, engine_type, engine_displacement, " +
        "transmission, drivetrain, color, interior_color, mileage, " +
        "canonical_platform, status, " +
        "nuke_estimate, nuke_estimate_confidence, " +
        "primary_image_url, image_count, observation_count, " +
        "description, location, city, state, country, " +
        "listing_url, bat_auction_url, created_at, updated_at",
    )
    .eq("id", vid)
    .single();
  if (error) return err(error.message, "get_asset");
  if (!vehicle) return err("Asset not found", "get_asset");

  const [price, obsRes] = await Promise.all([
    priceFacts(sb, vid),
    sb
      .from("vehicle_observations")
      .select("id, kind, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at")
      .eq("vehicle_id", vid)
      .eq("is_superseded", false)
      .order("ingested_at", { ascending: false })
      .limit(20),
  ]);

  const obs = obsRes.data || [];
  const sourceMap = await loadSources(sb, obs.map((o: { source_id: string }) => o.source_id));
  type EnrichedObs = Record<string, unknown> & {
    source_name: string | null;
    source_trust: number | null;
    structured_data: Record<string, unknown> | null;
  };
  const enriched: EnrichedObs[] = obs.map((o: Record<string, unknown>) => {
    const src = sourceMap.get(o.source_id as string);
    return {
      ...o,
      source_name: src?.display_name ?? null,
      source_trust: src?.base_trust_score ?? null,
      structured_data: (o.structured_data || null) as Record<string, unknown> | null,
    };
  });

  const listingCit = listingCitation(vehicle as Record<string, unknown>);
  const claims: Claim[] = [];

  const row = vehicle as Record<string, unknown>;
  const colorVal = row.color;
  for (const field of IDENTITY_FIELDS) {
    const value = field === "exterior_color" ? colorVal : row[field];
    const matchingObs = enriched.filter((o: EnrichedObs) => {
      const sd = o.structured_data;
      if (!sd) return false;
      return fieldKeys(field).some((k) => sd[k] != null && sd[k] !== "");
    });
    const citations: Citation[] = matchingObs.length
      ? matchingObs.slice(0, 3).map((o: EnrichedObs) => citationFromObservation(o))
      : value != null && value !== ""
      ? [listingCit]
      : [];
    const best = matchingObs[0];
    const conf = best
      ? resolveClaimConfidence(best.confidence_score as number | null, best.source_trust as number | null)
      : value != null && value !== ""
      ? { confidence: 0.7, confidence_basis: "source_trust" as const }
      : { confidence: null, confidence_basis: "none" as const };

    claims.push(
      recordedClaim(field, value, {
        ...conf,
        citations,
        note: matchingObs.length
          ? undefined
          : value != null && value !== ""
          ? "Value from vehicle record; no matching observation structured_data key found."
          : undefined,
      }),
    );
  }

  // Price / sale as first-class claims with event_time from price facts or events
  if (price?.sold) {
    claims.push(
      recordedClaim("sale_price", price.sold.amount, {
        confidence: 0.95,
        confidence_basis: "claim_score",
        citations: [
          emptyCitation({
            source_name: listingCit.source_name,
            source_url: price.source_url || listingCit.source_url,
            observation_id: null,
            event_time: price.sold.on ? String(price.sold.on) : null,
            ingested_at: null,
            is_superseded: false,
          }),
        ],
        note: `Sale basis: ${price.sold.basis}; amount from ${price.sold.from}`,
      }),
    );
  } else {
    claims.push(
      notRecordedClaim("sale_price", {
        checked_sources: ["vehicle_price_facts", listingCit.source_name || "listing"].filter(Boolean) as string[],
      }),
    );
  }

  if (price?.estimate) {
    const conf = resolveClaimConfidence(price.estimate.confidence, null);
    claims.push(
      recordedClaim("nuke_estimate", price.estimate.amount, {
        confidence: conf.confidence,
        confidence_basis: conf.confidence != null ? "estimate_model" : "none",
        citations: [
          emptyCitation({
            source_name: "Nuke Estimate",
            source_url: null,
            observation_id: null,
            event_time: price.estimate.as_of ? String(price.estimate.as_of) : null,
            ingested_at: price.estimate.as_of ? String(price.estimate.as_of) : null,
            is_superseded: false,
          }),
        ],
      }),
    );
  } else {
    claims.push(notRecordedClaim("nuke_estimate", { checked_sources: ["vehicle_price_facts", "nuke_estimates"] }));
  }

  return ok(
    makeEnvelope("get_asset", "vehicle", vid, claims, {
      status: row.status ?? null,
      location: {
        location: row.location ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        country: row.country ?? null,
      },
      links: {
        listing_url: row.listing_url ?? null,
        bat_auction_url: row.bat_auction_url ?? null,
        primary_image_url: row.primary_image_url ?? null,
        profile_url: `https://nuke.ag/vehicle/${vid}`,
      },
      price,
      observation_count: row.observation_count ?? enriched.length,
      image_count: row.image_count ?? null,
    }),
  );
}

async function handleGetHistory(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_history");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "get_history");
  const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
  const sb = deps.sb();

  const [eventsRes, obsRes] = await Promise.all([
    sb
      .from("vehicle_events")
      .select(
        "id, source_platform, source_url, event_type, event_status, started_at, ended_at, sold_at, final_price, starting_price, bid_count, comment_count, view_count",
      )
      .eq("vehicle_id", vid)
      .order("ended_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    sb
      .from("vehicle_observations")
      .select(
        "id, kind, content_text, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at",
      )
      .eq("vehicle_id", vid)
      .order("ingested_at", { ascending: false })
      .limit(limit),
  ]);
  if (eventsRes.error) return err(eventsRes.error.message, "get_history");
  if (obsRes.error) return err(obsRes.error.message, "get_history");

  const events = eventsRes.data || [];
  const obs = obsRes.data || [];
  const sourceMap = await loadSources(sb, obs.map((o: { source_id: string }) => o.source_id));

  const claims: Claim[] = [];
  const timeline: Array<Record<string, unknown>> = [];

  for (const ev of events) {
    const eventTime = extractEventTime(null, [ev.sold_at, ev.ended_at, ev.started_at]);
    const platform = ev.source_platform === "bat" ? "Bring a Trailer" : ev.source_platform;
    const cit = emptyCitation({
      source_name: platform || null,
      source_url: ev.source_url,
      observation_id: null,
      event_time: eventTime,
      ingested_at: null,
      is_superseded: false,
    });
    const label = `${ev.event_type || "event"}:${ev.event_status || "unknown"}`;
    claims.push(
      recordedClaim(`event.${ev.id}.final_price`, ev.final_price, {
        confidence: ev.final_price != null ? 0.9 : null,
        confidence_basis: ev.final_price != null ? "claim_score" : "none",
        citations: [cit],
        note: label,
      }),
    );
    timeline.push({
      kind: "market_event",
      id: ev.id,
      event_type: ev.event_type,
      event_status: ev.event_status,
      final_price: ev.final_price,
      bid_count: ev.bid_count,
      event_time: eventTime,
      ingested_at: null,
      source_url: ev.source_url,
      source_name: platform,
    });
  }

  for (const o of obs) {
    const src = sourceMap.get(o.source_id);
    const enriched = {
      ...o,
      source_name: src?.display_name ?? null,
      source_trust: src?.base_trust_score ?? null,
      structured_data: (o.structured_data || null) as Record<string, unknown> | null,
    };
    const cit = citationFromObservation(enriched);
    const conf = resolveClaimConfidence(o.confidence_score, src?.base_trust_score ?? null);
    const sd = enriched.structured_data || {};
    const summaryValue =
      o.content_text ||
      sd.sale_price ||
      sd.final_price ||
      sd.high_bid ||
      o.kind;
    claims.push(
      recordedClaim(`observation.${o.id}`, summaryValue, {
        ...conf,
        citations: [cit],
        note: `kind=${o.kind}; observed_at(scrape_or_declared)=${o.observed_at ?? "null"}`,
      }),
    );
    timeline.push({
      kind: "observation",
      id: o.id,
      observation_kind: o.kind,
      value_summary: summaryValue,
      confidence: conf.confidence,
      confidence_basis: conf.confidence_basis,
      event_time: cit.event_time,
      ingested_at: o.ingested_at,
      observed_at: o.observed_at,
      is_superseded: o.is_superseded,
      source_name: cit.source_name,
      source_url: cit.source_url,
    });
  }

  if (!events.length && !obs.length) {
    claims.push(
      notRecordedClaim("history", {
        checked_sources: ["vehicle_events", "vehicle_observations"],
        note: "No events or observations retained for this asset.",
      }),
    );
  }

  return ok(
    makeEnvelope("get_history", "vehicle", vid, claims, {
      timeline,
      event_count: events.length,
      observation_count: obs.length,
      clocks_note:
        "event_time is the real-world sale/auction clock when known. observed_at on observations is often scrape time; ingested_at is when Nuke stored the row.",
    }),
  );
}

async function handleExplainField(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "explain_field");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  const field = String(args.field || "").trim();
  if (!vid || !field) return err("asset_id and field are required", "explain_field");
  const sb = deps.sb();
  const keys = fieldKeys(field);

  // Only select columns that exist on vehicles (aliases like odometer are observation keys, not columns).
  const vehicleColumns = new Set([
    "id", "year", "make", "model", "trim", "vin", "mileage", "color", "interior_color",
    "body_style", "sale_price", "listing_url", "bat_auction_url", "canonical_platform",
    "updated_at", "created_at", "engine_type", "transmission", "drivetrain", "description",
  ]);
  const selectCols = [
    "id",
    ...[...vehicleColumns].filter((c) => c !== "id"),
  ].join(", ");

  const { data: vehicle, error: vErr } = await sb.from("vehicles").select(selectCols).eq("id", vid).maybeSingle();
  if (vErr) return err(vErr.message, "explain_field");
  if (!vehicle) return err("Asset not found", "explain_field");

  const { data: evidence } = await sb
    .from("vehicle_field_evidence")
    .select(
      "id, field_name, value_text, value_number, value_date, value_json, source_type, source_id, confidence_score, extracted_at, flagged_as_incorrect, metadata",
    )
    .eq("vehicle_id", vid)
    .eq("field_name", field)
    .eq("flagged_as_incorrect", false)
    .order("confidence_score", { ascending: false })
    .limit(20);

  const { data: obs } = await sb
    .from("vehicle_observations")
    .select(
      "id, kind, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at",
    )
    .eq("vehicle_id", vid)
    .eq("is_superseded", false)
    .limit(50);

  const sourceMap = await loadSources(
    sb,
    (obs || []).map((o: { source_id: string }) => o.source_id),
  );

  const matchingObs = (obs || []).filter((o: { structured_data: Record<string, unknown> | null }) => {
    const sd = o.structured_data;
    if (!sd || typeof sd !== "object") return false;
    return keys.some((k) => sd[k] != null && sd[k] !== "");
  });

  let projected: unknown = null;
  const attrCandidates = [`vehicle.${field}`, field];
  for (const attr of attrCandidates) {
    const { data, error } = await sb.rpc("project_attribute", {
      p_subject_id: vid,
      p_attribute: attr,
    });
    if (!error && data != null) {
      projected = { attribute: attr, projection: data };
      break;
    }
  }

  const claims: Claim[] = [];
  const row = vehicle as Record<string, unknown>;
  let current: unknown = undefined;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") {
      current = row[k];
      break;
    }
  }
  if (field === "exterior_color" && current === undefined) current = row.color;

  const listingCit = listingCitation(row);
  const checked = ["vehicles", "vehicle_observations", "vehicle_field_evidence", "project_attribute"];

  if (evidence && evidence.length) {
    for (const ev of evidence) {
      const value = ev.value_text ?? ev.value_number ?? ev.value_date ?? ev.value_json;
      const conf = resolveClaimConfidence(
        ev.confidence_score != null ? Number(ev.confidence_score) / 100 : null,
        null,
      );
      claims.push(
        recordedClaim(field, value, {
          ...conf,
          citations: [
            emptyCitation({
              source_name: ev.source_type || "field_evidence",
              source_url: (ev.metadata as { source_url?: string } | null)?.source_url ?? listingCit.source_url,
              observation_id: ev.source_id || ev.id,
              event_time: ev.value_date ? String(ev.value_date) : null,
              ingested_at: ev.extracted_at,
              is_superseded: false,
            }),
          ],
          note: "From vehicle_field_evidence",
        }),
      );
    }
  }

  for (const o of matchingObs.slice(0, 5)) {
    const src = sourceMap.get(o.source_id);
    const enriched = {
      ...o,
      source_name: src?.display_name ?? null,
      source_trust: src?.base_trust_score ?? null,
      structured_data: o.structured_data,
    };
    const sd = o.structured_data || {};
    let value: unknown = null;
    for (const k of keys) {
      if (sd[k] != null && sd[k] !== "") {
        value = sd[k];
        break;
      }
    }
    const conf = resolveClaimConfidence(o.confidence_score, src?.base_trust_score ?? null);
    claims.push(
      recordedClaim(field, value, {
        ...conf,
        citations: [citationFromObservation(enriched)],
        note: `From observation kind=${o.kind}`,
      }),
    );
  }

  if (projected) {
    const p = projected as { attribute: string; projection: Record<string, unknown> };
    const consensus = p.projection?.consensus ?? p.projection;
    claims.push(
      recordedClaim(field, consensus, {
        confidence:
          typeof (consensus as { weighted_confidence?: number })?.weighted_confidence === "number"
            ? (consensus as { weighted_confidence: number }).weighted_confidence
            : null,
        confidence_basis: "consensus",
        citations: [
          emptyCitation({
            source_name: "project_attribute",
            source_url: null,
            observation_id: null,
            event_time: null,
            ingested_at: null,
            is_superseded: false,
          }),
        ],
        note: `Canonical projection for ${p.attribute}`,
      }),
    );
  }

  if (!claims.length) {
    if (current !== undefined) {
      claims.push(
        recordedClaim(field, current, {
          confidence: 0.6,
          confidence_basis: "source_trust",
          citations: [listingCit],
          note: "Denormalized vehicle column only; no observation or field_evidence rows matched.",
        }),
      );
    } else {
      claims.push(notRecordedClaim(field, { checked_sources: checked, citations: [listingCit] }));
    }
  }

  return ok(
    makeEnvelope("explain_field", "vehicle", vid, claims, {
      field,
      current_vehicle_value: current ?? null,
      evidence_count: evidence?.length ?? 0,
      observation_matches: matchingObs.length,
      projection: projected,
      checked_sources: checked,
    }),
  );
}

async function handleValueAsset(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "value_asset");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "value_asset");
  const sb = deps.sb();

  const { data: vehicle } = await sb
    .from("vehicles")
    .select("id, year, make, model, nuke_estimate, nuke_estimate_confidence, listing_url, bat_auction_url, canonical_platform, updated_at, created_at")
    .eq("id", vid)
    .maybeSingle();
  if (!vehicle) return err("Asset not found", "value_asset");

  const { data: estimates } = await sb
    .from("nuke_estimates")
    .select(
      "estimated_value, value_low, value_high, confidence_score, deal_score, heat_score, price_tier, calculated_at, methodology",
    )
    .eq("vehicle_id", vid)
    .order("calculated_at", { ascending: false })
    .limit(1);

  const est = estimates?.[0] ?? null;
  const price = await priceFacts(sb, vid);
  const claims: Claim[] = [];
  const cit = emptyCitation({
    source_name: "Nuke Estimate",
    source_url: null,
    observation_id: null,
    // Model run time is not a market event — keep it on ingested_at only.
    event_time: null,
    ingested_at: est?.calculated_at ?? price?.estimate?.as_of ?? null,
    is_superseded: false,
  });

  if (est?.estimated_value != null || price?.estimate?.amount != null) {
    const amount = est?.estimated_value ?? price?.estimate?.amount;
    const conf = resolveClaimConfidence(
      est?.confidence_score ?? price?.estimate?.confidence ?? null,
      null,
    );
    claims.push(
      recordedClaim("estimated_value", amount, {
        confidence: conf.confidence,
        confidence_basis: "estimate_model",
        citations: [cit],
      }),
    );
    claims.push(
      recordedClaim("value_low", est?.value_low ?? null, {
        confidence: conf.confidence,
        confidence_basis: "estimate_model",
        citations: [cit],
      }),
    );
    claims.push(
      recordedClaim("value_high", est?.value_high ?? null, {
        confidence: conf.confidence,
        confidence_basis: "estimate_model",
        citations: [cit],
      }),
    );
  } else {
    claims.push(
      notRecordedClaim("estimated_value", {
        checked_sources: ["nuke_estimates", "vehicle_price_facts"],
      }),
    );
  }

  if (price?.sold) {
    claims.push(
      recordedClaim("last_sale_price", price.sold.amount, {
        confidence: 0.95,
        confidence_basis: "claim_score",
        citations: [
          emptyCitation({
            source_name: listingCitation(vehicle as Record<string, unknown>).source_name,
            source_url: price.source_url,
            observation_id: null,
            event_time: price.sold.on ? String(price.sold.on) : null,
            ingested_at: null,
            is_superseded: false,
          }),
        ],
        note: "Observed sale — not the model estimate",
      }),
    );
  }

  return ok(
    makeEnvelope("value_asset", "vehicle", vid, claims, {
      estimate: est,
      price,
      identity: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
      },
    }),
  );
}

async function handleGetComps(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_comps");
  if (bad) return bad;
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  const body: Record<string, unknown> = { limit };
  for (const k of ["make", "model", "year", "year_range", "vin"]) {
    if (args[k] !== undefined) body[k] = args[k];
  }
  if (args.asset_id) body.vehicle_id = args.asset_id;

  if (!body.vehicle_id && !body.make && !body.vin) {
    return err("Provide asset_id, or make(+model), or vin", "get_comps");
  }

  // Prefer the SQL RPC directly (same engine as api-v1-comps). Edge proxy can 500 under load.
  let rows: Record<string, unknown>[] = [];
  let raw: Record<string, unknown> = {};
  const sb = deps.sb();

  let make = typeof body.make === "string" ? body.make : null;
  let model = typeof body.model === "string" ? body.model : null;
  let year = body.year != null ? Number(body.year) : null;
  let excludeId: string | null = body.vehicle_id ? String(body.vehicle_id) : null;

  if (body.vehicle_id || body.vin) {
    let vq = sb.from("vehicles").select("id, year, make, model");
    if (body.vehicle_id) vq = vq.eq("id", String(body.vehicle_id));
    else vq = vq.eq("vin", String(body.vin).toUpperCase());
    const { data: vrow } = await vq.maybeSingle();
    if (vrow) {
      make = make || (vrow.make as string);
      model = model || (vrow.model as string);
      year = year ?? (vrow.year as number | null);
      excludeId = (vrow.id as string) || excludeId;
    }
  }

  if (!make) {
    return err("Could not resolve make for comps (provide asset_id or make)", "get_comps");
  }

  const yearRange = body.year_range != null ? Number(body.year_range) : 2;
  const { data: rpcRows, error: rpcErr } = await sb.rpc("get_comps_combined", {
    p_make: make,
    p_model: model,
    p_year_min: year != null ? year - yearRange : null,
    p_year_max: year != null ? year + yearRange : null,
    p_min_price: null,
    p_max_price: null,
    p_exclude_vehicle_id: excludeId,
    p_limit: limit,
  });

  if (rpcErr) {
    // Fallback to edge API once
    try {
      raw = (await deps.callEdgeApi("comps", "", "POST", body)) as Record<string, unknown>;
      rows = Array.isArray(raw.data) ? raw.data as Record<string, unknown>[] : [];
    } catch (e) {
      return err(rpcErr.message || (e instanceof Error ? e.message : String(e)), "get_comps");
    }
  } else {
    rows = (Array.isArray(rpcRows) ? rpcRows : []).map((row: Record<string, unknown>) => ({
      vehicle_id: row.vehicle_id ?? null,
      year: row.yr ?? null,
      make: row.mk ?? null,
      model: row.mdl ?? null,
      trim: row.tr ?? null,
      vin: row.vi ?? null,
      sale_price: row.sale_price,
      mileage: row.miles ?? null,
      color: row.clr ?? null,
      image_url: row.image_url ?? null,
      location: row.loc ?? null,
      listing_url: row.listing_url ?? null,
      platform: row.platform ?? null,
      platform_raw: row.platform ?? null,
      sold_date: row.sold_date ?? null,
      source_type: row.source_type ?? "auction_event",
      similarity_score: row.similarity_score ?? null,
    }));
    raw = { query: { make, model, year, limit }, summary: { via: "get_comps_combined" } };
  }
  const claims: Claim[] = [];
  const comps = rows.slice(0, limit).map((c: Record<string, unknown>, i: number) => {
    const cit = emptyCitation({
      source_name: (c.platform as string) || (c.platform_raw as string) || null,
      source_url: (c.listing_url as string) || null,
      observation_id: null,
      event_time: c.sold_date ? String(c.sold_date) : null,
      ingested_at: null,
      is_superseded: false,
    });
    claims.push(
      recordedClaim(`comp.${i}.sale_price`, c.sale_price, {
        confidence: 0.85,
        confidence_basis: "claim_score",
        citations: [cit],
        note: [c.year, c.make, c.model].filter(Boolean).join(" "),
      }),
    );
    return {
      asset_id: c.vehicle_id ?? null,
      year: c.year,
      make: c.make,
      model: c.model,
      sale_price: c.sale_price,
      mileage: c.mileage,
      sold_date: c.sold_date,
      listing_url: c.listing_url,
      platform: c.platform,
      similarity_score: c.similarity_score,
      citation: cit,
    };
  });

  if (!comps.length) {
    claims.push(
      notRecordedClaim("comps", {
        checked_sources: ["get_comps_combined", "api-v1-comps"],
        note: "No comparable sales returned for this query.",
      }),
    );
  }

  return ok(
    makeEnvelope("get_comps", "vehicle", args.asset_id ? String(args.asset_id) : null, claims, {
      comps,
      summary: raw.summary ?? null,
      query: raw.query ?? body,
      count: comps.length,
    }),
  );
}

async function handleGetCoverage(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_coverage");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "get_coverage");
  const sb = deps.sb();

  const { data: vehicle, error } = await sb
    .from("vehicles")
    .select(
      "id, vin, year, make, model, trim, body_style, color, interior_color, mileage, engine_type, transmission, drivetrain, description, sale_price, listing_url, bat_auction_url, image_count, observation_count, data_quality_score, nuke_estimate, canonical_platform, updated_at, created_at",
    )
    .eq("id", vid)
    .maybeSingle();
  if (error) return err(error.message, "get_coverage");
  if (!vehicle) return err("Asset not found", "get_coverage");

  const [eventsCount, obsCount, imgCount, sourcesRes] = await Promise.all([
    sb.from("vehicle_events").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb.from("vehicle_observations").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb.from("vehicle_images").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb
      .from("vehicle_observations")
      .select("source_id")
      .eq("vehicle_id", vid)
      .eq("is_superseded", false)
      .limit(100),
  ]);

  const sourceMap = await loadSources(
    sb,
    (sourcesRes.data || []).map((o: { source_id: string }) => o.source_id),
  );
  const sourceNames = [...new Set([...sourceMap.values()].map((s) => s.display_name).filter(Boolean))];

  const row = vehicle as Record<string, unknown>;
  const fields: Array<{ field: string; value: unknown }> = [
    { field: "year", value: row.year },
    { field: "make", value: row.make },
    { field: "model", value: row.model },
    { field: "vin", value: row.vin },
    { field: "mileage", value: row.mileage },
    { field: "exterior_color", value: row.color },
    { field: "interior_color", value: row.interior_color },
    { field: "body_style", value: row.body_style },
    { field: "engine_type", value: row.engine_type },
    { field: "transmission", value: row.transmission },
    { field: "drivetrain", value: row.drivetrain },
    { field: "description", value: row.description },
    { field: "sale_price", value: row.sale_price },
    { field: "nuke_estimate", value: row.nuke_estimate },
  ];

  const listingCit = listingCitation(row);
  const claims: Claim[] = fields.map(({ field, value }) =>
    recordedClaim(field, value, {
      confidence: value != null && value !== "" ? 0.7 : null,
      confidence_basis: value != null && value !== "" ? "source_trust" : "none",
      citations: value != null && value !== "" ? [listingCit] : [],
      ...(value == null || value === ""
        ? { note: undefined }
        : {}),
    }),
  );

  // Force not-recorded shape for empties (recordedClaim already does this)
  const recorded = claims.filter((c) => c.value !== "not recorded").length;
  const missing = claims.length - recorded;

  return ok(
    makeEnvelope("get_coverage", "vehicle", vid, claims, {
      summary: {
        fields_checked: claims.length,
        fields_recorded: recorded,
        fields_not_recorded: missing,
        coverage_ratio: claims.length ? recorded / claims.length : 0,
        event_count: eventsCount.count ?? 0,
        observation_count: obsCount.count ?? row.observation_count ?? 0,
        image_count: imgCount.count ?? row.image_count ?? 0,
        data_quality_score: row.data_quality_score ?? null,
        sources: sourceNames,
      },
      checked_sources: ["vehicles", "vehicle_events", "vehicle_observations", "vehicle_images", ...sourceNames],
    }),
  );
}
