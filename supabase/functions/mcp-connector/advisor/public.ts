// Nuke Asset Advisor — the public (no-credential / non-admin) scope.
//
// The advisor's handlers read through the service client, which sees every row. A caller who is not the service
// key or an active admin gets the same handlers through this scope instead:
//   1. publicOnlyClient: every read of `vehicles` carries is_public = true (the rule vehicles_public_select gives a
//      logged-out visitor), and every read of `vehicle_observations` drops the private extraction methods and
//      non-public kinds (owner_statement_private_read & co., observation_is_public). Writes and RPCs outside the
//      advisor's read list are refused, so a public call cannot write a row (no coverage log, no import queue).
//   2. listingSourceRefusal: Bring a Trailer listings only. Cars & Bids and Mecum are refused for every caller
//      (their answers are wrong today: a JS-shell C&B page and an 88 s Mecum read); any other host is refused
//      for a public caller, so a public call fetches only bringatrailer.com.
//   3. publicAnswer: internal flag names, method strings, counters and table names are mapped to plain language
//      or dropped from the answer.
// Photo analysis (paid vision compute) is never run for a public call (evaluate_listing checks deps.publicOnly).

// deno-lint-ignore-file no-explicit-any

/** Observation methods that only their speaker may read (the RESTRICTIVE *_private_read policies). */
export const PRIVATE_EXTRACTION_METHODS = [
  "owner_statement_v1",
  "owner_statement_org_link_v1",
  "garage_owner_correction_v1",
  "vehicle_statement_v1",
  "work_order_payment_witness_sign_v1",
] as const;

/** Observation kinds a logged-out visitor may read on a public vehicle (observation_is_public). */
export const PUBLIC_OBSERVATION_KINDS = [
  "listing",
  "sale_result",
  "comment",
  "bid",
  "specification",
  "condition",
  "media",
  "splice",
] as const;

// Mirrors public.observation_is_public(kind, data): money, billing and personal-name keys keep an observation private.
const PRIVATE_DATA_KEYS = new RegExp(
  '"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url' +
    "|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd" +
    "|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due" +
    "|order_number|order_contents|order|client|correct_owner|prior_owner_id" +
    "|correct_owner_discovered_person_id|customer_name|client_name|email|phone" +
    "|total_?paid|balance_?remaining|full_?name|first_?name|last_?name" +
    "|given_?name|family_?name|legal_?name|buyer_?name|seller_?name" +
    '|owner_?name|person_?name|technician_?name|participant_?name|contact_?name)"\\s*:',
  "i",
);

/** True when a logged-out visitor may read this observation of a public vehicle. */
export function observationIsPublic(o: {
  kind?: unknown;
  structured_data?: unknown;
  extraction_method?: unknown;
}): boolean {
  const method = o.extraction_method == null ? null : String(o.extraction_method);
  if (method && (PRIVATE_EXTRACTION_METHODS as readonly string[]).includes(method)) return false;
  const kind = String(o.kind ?? "");
  if (!(PUBLIC_OBSERVATION_KINDS as readonly string[]).includes(kind)) return false;
  const text = o.structured_data == null ? "" : JSON.stringify(o.structured_data);
  if (PRIVATE_DATA_KEYS.test(text)) return false;
  if ((kind === "condition" || kind === "media") && /(invoice|receipt|\$\s?[0-9])/i.test(text)) return false;
  return true;
}

/** RPCs a public call may run: reads only. log_listing_coverage (a write + import_queue enqueue) is not here. */
export const PUBLIC_READ_RPCS = new Set([
  "get_comps_combined",
  "vehicle_price_facts",
  "all_in_buyer_cost_for_vehicles",
]);

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/**
 * The service client narrowed to what a logged-out visitor may read. `vehicles` reads get is_public = true;
 * `vehicle_observations` reads drop private methods and kinds; writes throw; RPCs off the read list answer an error.
 */
export function publicOnlyClient(client: any): any {
  return {
    from(table: string) {
      const builder = client.from(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
            return () => {
              throw new Error(`public advisor scope is read-only: ${prop} on ${table} refused`);
            };
          }
          const v = (target as any)[prop];
          if (prop === "select" && typeof v === "function") {
            return (...args: unknown[]) => {
              let q = v.apply(target, args);
              if (table === "vehicles") q = q.eq("is_public", true);
              if (table === "vehicle_observations") {
                q = q
                  .in("kind", [...PUBLIC_OBSERVATION_KINDS])
                  .or(`extraction_method.is.null,extraction_method.not.in.(${PRIVATE_EXTRACTION_METHODS.join(",")})`);
              }
              return q;
            };
          }
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
    rpc(name: string, args?: Record<string, unknown>) {
      if (!PUBLIC_READ_RPCS.has(name)) {
        return Promise.resolve({ data: null, error: { message: `rpc ${name} is not available to a public call` } });
      }
      return client.rpc(name, args);
    },
  };
}

// ── Listing sources ──────────────────────────────────────────────────────────

export const SUPPORTED_SOURCES_NOTE =
  "Nuke's listing advisor reads Bring a Trailer listings only for now. Paste a https://bringatrailer.com/listing/… URL.";

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True for a Bring a Trailer listing page (https://bringatrailer.com/listing/<slug>). */
export function isBatListingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return u.protocol === "https:" && host === "bringatrailer.com" && /^\/listing\/[^/]+/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Why this listing URL is refused, or null to go ahead. Cars & Bids and Mecum are refused for every caller; a public
 * caller may evaluate a Bring a Trailer listing page only.
 */
export function listingSourceRefusal(url: string, publicOnly: boolean): { source: string; message: string } | null {
  const host = hostOf(url);
  if (host && (host === "carsandbids.com" || host.endsWith(".carsandbids.com"))) {
    return { source: "Cars & Bids", message: `Cars & Bids listings aren't supported yet. ${SUPPORTED_SOURCES_NOTE}` };
  }
  if (host && (host === "mecum.com" || host.endsWith(".mecum.com"))) {
    return { source: "Mecum", message: `Mecum listings aren't supported yet. ${SUPPORTED_SOURCES_NOTE}` };
  }
  if (publicOnly && !isBatListingUrl(url)) {
    return { source: host ?? "unknown", message: `That listing source isn't supported yet. ${SUPPORTED_SOURCES_NOTE}` };
  }
  return null;
}

// ── Public answer ────────────────────────────────────────────────────────────

/** Internal flag → what a reader should be told (null: nothing worth saying). */
export const PUBLIC_FLAG_TEXT: Record<string, string | null> = {
  shared_value_asset_valuation: null,
  subject_sale_excluded_from_own_valuation: "This car's own sale is not used to value it.",
  no_stored_estimate_used_comps: "Value comes from comparable sales.",
  comps_time_channel_mileage_adjusted: "Comparable sales are adjusted for date, venue and mileage.",
  blended_own_prior_sale_time_adjusted: "Value blends comparable sales with this car's earlier sale, adjusted for date.",
  recent_12m_sales_override_disagreeing_estimate: "Value range comes from the last 12 months of similar sales.",
  recent_same_asset_sale_dominates: "This car's recent sale weighs heavily in its value.",
  comps_lookup_failed: "Comparable sales could not be read, so no value is given.",
  filled_range_from_sold_comps: "Value range comes from comparable sales.",
  no_estimate_insufficient_evidence: "Not enough evidence for a value.",
  used_median_of_confirmed_sales: "Value is the median of confirmed sales.",
  stored_estimate_above_comp_band: "An older estimate was above recent sales and was not used.",
  stored_estimate_disagrees_with_comps: "An older estimate disagreed with recent sales and was not used.",
  stored_estimate_matched_max_comp: "An older estimate matched only the highest sale and was not used.",
  stored_estimate_outside_comp_range: "An older estimate was outside recent sales and was not used.",
  stored_estimate_replaced_by_comps_disagreement: "An older estimate disagreed with recent sales and was replaced.",
  stored_estimate_stale_replaced_by_comps: "An out-of-date estimate was replaced by recent sales.",
  valuation_over_3x_off_recent_sale: "The value is far from this car's recent sale; treat it with caution.",
  sold_unverified: "The sale is not confirmed.",
  thin_comp_set: "Few comparable sales; treat the value with caution.",
  estimate_older_than_180d: "The value is more than 180 days old.",
  body_conversion: "The body appears converted from another style.",
  "993_body_conversion": "The body appears converted from another style.",
  project: "Listed as a project car.",
  restomod: "Listed as a restomod.",
};

const FLAG_ID = /^[a-z0-9]+(?:_[a-z0-9]+)+(?::[a-z0-9_ -]+)?$|^[a-z0-9_]+:[a-z0-9_ -]+$/;

function flagText(flag: string): string | null {
  if (Object.hasOwn(PUBLIC_FLAG_TEXT, flag)) return PUBLIC_FLAG_TEXT[flag];
  if (flag.startsWith("parts_suspect")) return "The listing may be for parts rather than a complete car.";
  return null;
}

/** A flag list in plain language: known flags mapped, unknown internal ids dropped, readable sentences kept. */
export function publicFlags(list: unknown[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    const text = FLAG_ID.test(s) ? flagText(s) : s;
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** Keys that describe how the answer was computed, not the car: dropped from a public answer. */
const DROPPED_KEYS = new Set([
  "excluded_comps",
  "excluded",
  "comps_lookup",
  "lookup",
  "adjustments",
  "estimate_source",
  "stored_estimate",
  "stored_estimate_stale",
  "recent_sales_override",
  "query",
  "stored_source",
  "match_method",
  "similarity_score",
  "hammer_conversions",
  "methodology",
]);

const SOURCE_NAMES: Record<string, string> = {
  vehicle_price_facts: "Nuke sale records",
  nuke_estimates: "Nuke estimates",
  get_comps_combined: "comparable sales",
  "vehicles.is_for_sale": "Nuke listings",
  vehicle_events: "Nuke sale records",
  vehicle_observations: "Nuke observations",
  vehicle_field_evidence: "Nuke observations",
  platform_fee_schedule: "the platform's published buyer-fee schedule",
};

function publicSourceName(s: string): string {
  if (Object.hasOwn(SOURCE_NAMES, s)) return SOURCE_NAMES[s];
  return /^[a-z0-9_]+(\.[a-z0-9_]+)?$/.test(s) && s.includes("_") ? "Nuke records" : s;
}

const VALUE_BASIS = /value_asset \([^)]*\)(?: for matched asset [0-9a-f-]+)?/gi;

function publicBasis(basis: string): string {
  return basis.replace(VALUE_BASIS, "Nuke's value for this car from comparable sales");
}

function scrub(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    if (key === "flags" || key === "red_flags") return publicFlags(value);
    if (key === "checked_sources") {
      return [...new Set(value.map((v) => publicSourceName(String(v))))];
    }
    return value.map((v) => scrub(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROPPED_KEYS.has(k)) continue;
      if (k === "basis" && typeof v === "string") {
        out[k] = publicBasis(v);
        continue;
      }
      if (k === "markdown_summary" && typeof v === "string") {
        out[k] = publicMarkdown(v);
        continue;
      }
      if (k === "note" && typeof v === "string") {
        out[k] = publicBasis(v).replace(/\s*amount from [a-z0-9_.]+/gi, "").replace(/;\s*$/, "");
        continue;
      }
      if (k === "source_name" && typeof v === "string") {
        out[k] = Object.hasOwn(SOURCE_NAMES, v) ? SOURCE_NAMES[v] : v;
        continue;
      }
      out[k] = scrub(v, k);
    }
    return out;
  }
  return value;
}

/** The markdown summary with internal flag lines mapped or dropped and the internal basis line rewritten. */
export function publicMarkdown(md: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of md.split("\n")) {
    const basis = line.match(/^- Basis: (.*)$/);
    if (basis) {
      out.push(`- Basis: ${publicBasis(basis[1])}`);
      continue;
    }
    const bullet = line.match(/^- ([a-z0-9_:]+)$/);
    if (bullet && FLAG_ID.test(bullet[1])) {
      const text = flagText(bullet[1]);
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(`- ${text}`);
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export interface PublicToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: any;
  isError?: boolean;
}

/** The answer a public caller receives: the same envelope with internals mapped or dropped. */
export function publicAnswer<T extends PublicToolResult>(result: T): T {
  const sc = scrub(result.structuredContent) as Record<string, unknown>;
  const md = typeof sc?.markdown_summary === "string" ? sc.markdown_summary as string : null;
  const content: Array<{ type: "text"; text: string }> = md
    ? [{ type: "text", text: md }, { type: "text", text: JSON.stringify(sc, null, 2) }]
    : [{ type: "text", text: JSON.stringify(sc, null, 2) }];
  return { ...result, content, structuredContent: sc };
}
