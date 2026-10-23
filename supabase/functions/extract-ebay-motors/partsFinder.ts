/**
 * Parts finder (owner, 2026-10-20): a vehicle and a list of part queries -> per part, a ranked shortlist of eBay
 * listings eBay itself matches to the vehicle. POST extract-ebay-motors {action: "parts", vehicle_id, parts: [...]}.
 *
 *   Fitment. The vehicle's year, make, model (with series), trim and engine are mapped onto the fitment fields the
 *   part's category lists (Taxonomy get_compatibility_properties), each value chosen from eBay's own value list
 *   (get_compatibility_property_values): an exact match, else the only eBay value containing ours. A value that does
 *   not map is left out and said so; an engine recorded as a swap is never sent (eBay's tables describe factory
 *   engines). Nothing is guessed: no spelling is typed in, no alias table.
 *   Search. Browse item_summary/search with category_ids, compatibility_filter, fixed-price listings that deliver to
 *   the US; eBay answers EXACT or POSSIBLE per listing. Without an established fitment the listings are "unknown fit".
 *   Ranking. partsRank.ts: fit, usable condition, delivered price, condition, seller feedback. Never commission.
 *   Freshness. Nothing is cached but the taxonomy (reference lists, one hour). Every listing carries its observed_at;
 *   the approval Sign refuses a listing read more than two hours earlier.
 *   Quota. Browse allows 5,000 calls a day for the whole app and the listing sweep spends about 4,500. The finder
 *   spends at most DAILY_CAP of them (rate_limits key ebay-parts:browse:<Pacific date>, counted before each call) and
 *   none while eBay reports EBAY_FLOOR or fewer left (the sweep's revisit reserve, browseSweep.ts reserveCalls). It
 *   refuses in words, never silently. Taxonomy calls are a separate eBay quota and are not counted against Browse.
 *   Hand-off. Results carry the plain item URL (with eBay's fits= when given). Affiliate parameters, when the owner
 *   sets them, are added in one place on the page (nuke_frontend/src/pages/jobs/ebayLink.ts); none here.
 * Nothing is written to the vehicle or the job here: approval is the Sign approve_job_part_listing.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { appToken, ebayApiBase } from "../_shared/ebayAuth.ts";
import { authenticateWriter } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { BrowseClient, QuotaExceeded } from "./browseApi.ts";
import { normalizeSummary, rankListings, type PartListing, type RankedListing } from "./partsRank.ts";

const SCOPE = "https://api.ebay.com/oauth/api_scope";
/** eBay Motors US category tree (Taxonomy get_default_category_tree_id for EBAY_MOTORS_US, read 2026-10-20). */
export const MOTORS_TREE = "100";
/** Car & Truck Parts & Accessories: supports fitment (measured 2026-10-19 with Year/Make/Model). */
export const CAR_TRUCK_PARTS = "6030";
const FIT_ORDER = ["Year", "Make", "Model", "Trim", "Engine"] as const;

const envInt = (name: string, dflt: number, lo: number, hi: number) => {
  const n = Number(Deno.env.get(name));
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : dflt;
};
export const BUDGET = {
  dailyCap: envInt("EBAY_PARTS_DAILY_CAP", 300, 0, 500),     // Browse calls a day for the finder, all users
  ebayFloor: envInt("EBAY_PARTS_EBAY_FLOOR", 400, 100, 5000), // never spend while eBay reports this many or fewer left
  perUserHour: 60,                                             // Browse calls an hour for one signed-in user
  maxParts: 8, callsPerPart: 2, shortlist: 5, readPerSearch: 50, taxonomyPerRequest: 80,
};
export const FRESH_SECONDS = 2 * 60 * 60;

// ---- eBay client: Taxonomy (own quota) and Browse search (counted) ---------------------------------------------

export class EbayRefused extends Error { constructor(public status: number, m: string) { super(m); this.name = "EbayRefused"; } }

export class PartsClient {
  browseCalls = 0;
  taxonomyCalls = 0;
  constructor(private fetchFn: typeof fetch = fetch, private token: () => Promise<string | null> = () => appToken(SCOPE)) {}

  private async get(path: string, qs: string, kind: "browse" | "taxonomy", headers: Record<string, string> = {}): Promise<any> {
    const token = await this.token();
    if (!token) throw new EbayRefused(401, "no eBay application token (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing or refused)");
    if (kind === "browse") this.browseCalls++; else this.taxonomyCalls++;
    const r = await this.fetchFn(`${ebayApiBase()}${path}?${qs}`, { // guardrail-allow: raw-fetch (eBay JSON API, bearer token)
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_MOTORS_US", Accept: "application/json", ...headers },
    });
    if (r.status === 429) throw new QuotaExceeded(`eBay answered 429 on ${path}`);
    const text = await r.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (r.status === 204) return {};
    if (!r.ok) {
      const e = body?.errors?.[0];
      if (e?.errorId === 2001 || e?.errorId === 2003) throw new QuotaExceeded(`eBay error ${e.errorId}: ${e.message ?? ""}`);
      throw new EbayRefused(r.status, `${e?.message ?? text}`.slice(0, 300));
    }
    return body ?? {};
  }

  taxonomy(op: string, params: Record<string, string>) {
    return this.get(`/commerce/taxonomy/v1/category_tree/${MOTORS_TREE}/${op}`, enc(params), "taxonomy");
  }

  search(p: { q: string; categoryId: string; compat: Record<string, string> | null; zip: string | null; limit: number }) {
    const params: Record<string, string> = { q: p.q, category_ids: p.categoryId, limit: String(p.limit),
      filter: "buyingOptions:{FIXED_PRICE},deliveryCountry:US" };
    if (p.compat && Object.keys(p.compat).length) {
      params.compatibility_filter = Object.entries(p.compat).map(([k, v]) => `${k}:${v}`).join(";");
    }
    const headers: Record<string, string> = p.zip ? { "X-EBAY-C-ENDUSERCTX": `contextualLocation=${encodeURIComponent(`country=US,zip=${p.zip}`)}` } : {};
    return this.get("/buy/browse/v1/item_summary/search", enc(params), "browse", headers);
  }
}
/** Query string with %20 for spaces (eBay reads a literal +). */
const enc = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

// ---- Taxonomy reference reads (cached one hour per worker) -----------------------------------------------------

const TAXONOMY_TTL_MS = 60 * 60 * 1000;
const taxCache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(k: string, f: () => Promise<T>): Promise<T> {
  const hit = taxCache.get(k);
  if (hit && Date.now() - hit.at < TAXONOMY_TTL_MS) return hit.v as T;
  const v = await f();
  taxCache.set(k, { at: Date.now(), v });
  return v;
}
export const clearTaxonomyCache = () => taxCache.clear();

export interface Category { id: string; name: string; basis: "suggested" | "car_truck_parts_fallback"; note?: string }

/** eBay's suggested leaf category for the query under Car & Truck Parts & Accessories, else 6030. */
export async function categoryFor(c: PartsClient, q: string): Promise<Category> {
  const fallback = (note: string): Category => ({ id: CAR_TRUCK_PARTS, name: "Car & Truck Parts & Accessories", basis: "car_truck_parts_fallback", note });
  try {
    const j = await cached(`sugg:${q.toLowerCase()}`, () => c.taxonomy("get_category_suggestions", { q }));
    for (const s of (j as any)?.categorySuggestions ?? []) {
      const anc = (s.categoryTreeNodeAncestors ?? []).map((a: any) => String(a.categoryId));
      if (anc.includes(CAR_TRUCK_PARTS) && s.category?.categoryId) return { id: String(s.category.categoryId), name: String(s.category.categoryName ?? ""), basis: "suggested" };
    }
    return fallback("eBay suggested no car and truck parts category for this query");
  } catch (e) {
    if (e instanceof QuotaExceeded) throw e;
    return fallback(`category suggestion failed: ${(e as Error).message}`);
  }
}

/** The category's fitment field names; [] when it has none or eBay could not be read (a failure is not cached). */
export async function fitmentProperties(c: PartsClient, categoryId: string): Promise<string[]> {
  try {
    return await cached(`props:${categoryId}`, async () => {
      const j = await c.taxonomy("get_compatibility_properties", { category_id: categoryId });
      return ((j?.compatibilityProperties ?? []) as any[]).map((p) => String(p.name)).filter(Boolean);
    });
  } catch (e) {
    if (e instanceof QuotaExceeded) throw e;
    return [];
  }
}

async function fitmentValues(c: PartsClient, categoryId: string, property: string, filter: Record<string, string>): Promise<string[]> {
  const f = Object.entries(filter).map(([k, v]) => `${k}:${v}`).join(",");
  return await cached(`vals:${categoryId}:${property}:${f}`, async () => {
    const params: Record<string, string> = { category_id: categoryId, compatibility_property: property };
    if (f) params.filter = f;
    const j = await c.taxonomy("get_compatibility_property_values", params);
    return ((j?.compatibilityPropertyValues ?? []) as any[]).map((v) => String(v.value ?? "")).filter(Boolean);
  });
}

// ---- Vehicle -> fitment values ----------------------------------------------------------------------------------

export interface VehicleFacts {
  year: number | null; make: string | null; model: string | null; series?: string | null; trim?: string | null;
  engine_size?: string | null; engine_type?: string | null; engine_displacement?: string | null;
}
export interface FitStep { property: string; ours: string | null; ebay: string | null; basis: string; candidates?: string[] }
export interface Fitment { established: boolean; applied: Record<string, string>; steps: FitStep[]; note: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);
const containsAll = (value: string, ours: string) => { const v = tokens(value); return tokens(ours).every((t) => v.includes(t)); };
/** A value eBay would read wrongly inside its own filter syntax. */
const unsafe = (v: string) => /[;:,{}|]/.test(v);

/** Exact (normalized) match, else the only eBay value containing every word of ours. */
export function pick(values: string[], candidates: string[]): { value: string; ours: string; basis: string } | { value: null; candidates: string[] } {
  const usable = values.filter((v) => !unsafe(v));
  for (const ours of candidates) {
    const hit = usable.find((v) => norm(v) === norm(ours));
    if (hit) return { value: hit, ours, basis: "exact" };
  }
  for (const ours of candidates) {
    const hits = usable.filter((v) => containsAll(v, ours));
    if (hits.length === 1) return { value: hits[0], ours, basis: `the only eBay value containing "${ours}"` };
    if (hits.length > 1) return { value: null, candidates: hits.slice(0, 8) };
  }
  return { value: null, candidates: [] };
}

const liters = (s: string) => { const m = s.match(/(\d{1,2}\.\d)\s*l\b/i); return m ? Number(m[1]) : null; };
const cubicInches = (s: string) => { const m = s.match(/\b(\d{3})\s*(?:ci\b|cid\b|cu\.?\s*in)/i); return m ? Number(m[1]) : null; };
const cylinders = (s: string) => {
  const m = s.match(/\b([vlih])\s?-?(\d{1,2})\b/i);
  if (!m) return null;
  const k = m[1].toLowerCase();
  return `${k === "v" ? "v" : k === "h" ? "h" : "l"}${m[2]}`;   // l and i are both inline
};

/** eBay's engine value for ours: same displacement (and cubic inches and layout when stated), only when it is the only one. */
export function pickEngine(values: string[], ours: string): { value: string; basis: string } | { value: null; candidates: string[]; reason: string } {
  const l = liters(ours), ci = cubicInches(ours), cyl = cylinders(ours);
  if (l === null && ci === null) return { value: null, candidates: [], reason: "no displacement in the recorded engine" };
  const hits = values.filter((v) => !unsafe(v)).filter((v) =>
    (l === null || (liters(v) !== null && Math.abs(liters(v)! - l) < 0.05)) &&
    (ci === null || cubicInches(v) === ci) &&
    (cyl === null || cylinders(v) === null || cylinders(v) === cyl));
  if (hits.length === 1) return { value: hits[0], basis: `the only eBay engine with ${[l !== null ? `${l}L` : null, ci !== null ? `${ci} cu in` : null, cyl].filter(Boolean).join(", ")}` };
  return hits.length > 1 ? { value: null, candidates: hits.slice(0, 8), reason: `${hits.length} eBay engines share that displacement` }
    : { value: null, candidates: values.slice(0, 8), reason: `not among eBay's ${values.length} engines for this vehicle` };
}

/** Walk the category's fitment fields in eBay's order, each value read from eBay's list for the values chosen so far. */
export async function resolveFitment(c: PartsClient, categoryId: string, props: string[], v: VehicleFacts): Promise<Fitment> {
  const applied: Record<string, string> = {};
  const steps: FitStep[] = [];
  const has = (p: string) => props.includes(p);
  const stop = (note: string): Fitment => ({ established: false, applied, steps, note });
  if (!has("Year") || !has("Make") || !has("Model")) return stop(`category ${categoryId} lists no Year/Make/Model fitment`);
  for (const property of FIT_ORDER.filter(has)) {
    let values: string[];
    try { values = await fitmentValues(c, categoryId, property, applied); }
    catch (e) {
      if (e instanceof QuotaExceeded) throw e;
      steps.push({ property, ours: null, ebay: null, basis: `eBay's ${property} list could not be read: ${(e as Error).message}` });
      if (property === "Year" || property === "Make" || property === "Model") return stop(`eBay's ${property} list could not be read`);
      continue;
    }
    if (property === "Year") {
      const ours = v.year ? String(v.year) : null;
      const hit = ours ? values.find((x) => x === ours) : undefined;
      steps.push({ property, ours, ebay: hit ?? null, basis: hit ? "exact" : ours ? `eBay lists no year ${ours} here` : "no year recorded" });
      if (!hit) return stop(ours ? `eBay's fitment list has no year ${ours}` : "the vehicle has no recorded year");
      applied.Year = hit;
    } else if (property === "Make" || property === "Model") {
      const cands = property === "Make" ? [v.make] : [v.series && v.model ? `${v.series} ${v.model}` : null, v.model, v.series && v.model ? `${v.model} ${v.series}` : null];
      const list = cands.filter((x): x is string => !!x && !!x.trim());
      if (!list.length) { steps.push({ property, ours: null, ebay: null, basis: `no ${property.toLowerCase()} recorded` }); return stop(`the vehicle has no recorded ${property.toLowerCase()}`); }
      const r = pick(values, list);
      if (r.value === null) {
        steps.push({ property, ours: list.join(" / "), ebay: null, basis: r.candidates.length ? "several eBay values match; none chosen" : `not among eBay's ${values.length} values`, candidates: r.candidates });
        return stop(`eBay's ${property} list has no single value for "${list[0]}"`);
      }
      steps.push({ property, ours: r.ours, ebay: r.value, basis: r.basis });
      applied[property] = r.value;
    } else if (property === "Trim") {
      if (!v.trim) { steps.push({ property, ours: null, ebay: null, basis: "no trim recorded; fit is checked without it" }); continue; }
      const r = pick(values, [v.trim]);
      if (r.value === null) { steps.push({ property, ours: v.trim, ebay: null, basis: r.candidates.length ? "several eBay trims match; trim not sent" : "not among eBay's trims; trim not sent", candidates: r.candidates.length ? r.candidates : values.slice(0, 8) }); continue; }
      steps.push({ property, ours: r.ours, ebay: r.value, basis: r.basis });
      applied.Trim = r.value;
    } else if (property === "Engine") {
      const ours = [v.engine_size, v.engine_displacement, v.engine_type].find((x) => !!x && /\d/.test(x)) ?? null;
      if (/\bswap(ped)?\b/i.test(v.engine_type ?? "") || /\bswap(ped)?\b/i.test(v.engine_size ?? "")) {
        steps.push({ property, ours: v.engine_type ?? ours, ebay: null, basis: "recorded as an engine swap; eBay's fitment describes factory engines, so engine is not sent and engine-specific parts are unknown fit for the installed engine", candidates: values.slice(0, 8) });
        continue;
      }
      if (!ours) { steps.push({ property, ours: null, ebay: null, basis: "no engine recorded; fit is checked without it" }); continue; }
      const r = pickEngine(values, ours);
      if (r.value === null) { steps.push({ property, ours, ebay: null, basis: `${r.reason}; engine not sent`, candidates: r.candidates }); continue; }
      steps.push({ property, ours, ebay: r.value, basis: r.basis });
      applied.Engine = r.value;
    }
  }
  const unsent = steps.filter((s) => s.ebay === null).map((s) => s.property);
  return { established: true, applied, steps,
    note: `eBay checks fit on ${Object.keys(applied).join(", ")}${unsent.length ? `; not checked: ${unsent.join(", ")}` : ""}` };
}

// ---- Quota ------------------------------------------------------------------------------------------------------

export interface QuotaLedger {
  /** Browse calls the finder spent today, or null when the ledger cannot be read (then nothing is spent). */
  usedToday(): Promise<number | null>;
  /** Count one Browse call before making it; false when it would pass a cap (the call is then not made). */
  take(): Promise<{ ok: boolean; reason?: string }>;
}

/** The Pacific calendar day eBay's daily Browse quota runs on (it reset at 07:00Z on 2026-10-21, midnight PDT). */
export function quotaDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** rate_limits counters (rate_limit_increment): one for the app's day, one per user per hour. Fails closed. */
export function rateLimitLedger(supabase: any, userId: string | null, now = new Date()): QuotaLedger {
  const dayKey = `ebay-parts:browse:${quotaDay(now)}`;
  const hour = Math.floor(now.getTime() / 3_600_000);
  const userKey = userId ? `ebay-parts:user:${userId}:${hour}` : null;
  const inc = async (key: string, start: Date, expires: Date): Promise<number | null> => {
    const { data, error } = await supabase.rpc("rate_limit_increment", { p_key: key, p_window_start: start.toISOString(), p_expires_at: expires.toISOString() });
    return error || typeof data !== "number" ? null : data;
  };
  return {
    async usedToday() {
      const { data, error } = await supabase.from("rate_limits").select("count").eq("key", dayKey).maybeSingle();
      if (error) return null;
      return Number(data?.count ?? 0);
    },
    async take() {
      const day = await inc(dayKey, now, new Date(now.getTime() + 26 * 3_600_000));
      if (day === null) return { ok: false, reason: "The parts finder's call ledger could not be written, so no eBay call was made." };
      if (day > BUDGET.dailyCap) return { ok: false, reason: `Not enough quota today: the parts finder's ${BUDGET.dailyCap} eBay searches for today are used. They reset at midnight Pacific.` };
      if (userKey) {
        const u = await inc(userKey, new Date(hour * 3_600_000), new Date((hour + 1) * 3_600_000));
        if (u === null) return { ok: false, reason: "The parts finder's call ledger could not be written, so no eBay call was made." };
        if (u > BUDGET.perUserHour) return { ok: false, reason: `You have used ${BUDGET.perUserHour} eBay searches this hour. Try again next hour.` };
      }
      return { ok: true };
    },
  };
}

// ---- The finder -------------------------------------------------------------------------------------------------

export interface PartQuery { query: string; part_number?: string | null; work_order_part_id?: string | null }
export interface PartResult {
  query: string; part_number: string | null; work_order_part_id: string | null;
  status: "searched" | "not_searched"; reason?: string;
  category?: Category; fitment?: Fitment; search?: { q: string; with_fitment: boolean; fallback?: string };
  ebay_total: number | null; read: number; exact_read: number; possible_read: number; unknown_read: number;
  shortlist: RankedListing[]; observed_at: string | null; browse_calls: number;
}
export interface FinderDeps { client: PartsClient; ledger: QuotaLedger; ebayRemaining: number | null; now?: () => Date }

const notSearched = (p: PartQuery, reason: string): PartResult => ({ query: p.query, part_number: p.part_number ?? null,
  work_order_part_id: p.work_order_part_id ?? null, status: "not_searched", reason, ebay_total: null, read: 0, exact_read: 0,
  possible_read: 0, unknown_read: 0, shortlist: [], observed_at: null, browse_calls: 0 });

class Stop extends Error {}

export async function findParts(d: FinderDeps, vehicle: VehicleFacts, parts: PartQuery[], opts: { zip?: string | null; shortlist?: number } = {}) {
  const now = d.now ?? (() => new Date());
  const floor = BUDGET.ebayFloor;
  const refuse = (reason: string) => ({ refused: reason, parts: parts.map((p) => notSearched(p, reason)) });
  if (d.ebayRemaining !== null && d.ebayRemaining <= floor) {
    return refuse(`Not enough eBay quota today: eBay reports ${d.ebayRemaining} searches left for the whole app and ${floor} are held for the listing sweep's revisits. The quota resets at midnight Pacific.`);
  }
  const used = await d.ledger.usedToday();
  if (used === null) return refuse("The parts finder's call ledger could not be read, so no eBay call was made.");
  if (used >= BUDGET.dailyCap) return refuse(`Not enough quota today: the parts finder's ${BUDGET.dailyCap} eBay searches for today are used. They reset at midnight Pacific.`);

  let stopped: string | null = null;
  const spend = async () => {
    if (stopped) throw new Stop(stopped);
    if (d.ebayRemaining !== null && d.ebayRemaining - d.client.browseCalls <= floor) {
      stopped = `Not enough eBay quota today: ${floor} of eBay's remaining searches are held for the listing sweep's revisits.`;
      throw new Stop(stopped);
    }
    const t = await d.ledger.take();
    if (!t.ok) { stopped = t.reason ?? "Not enough quota today."; throw new Stop(stopped); }
  };

  const out: PartResult[] = [];
  for (const p of parts) {
    if (stopped) { out.push(notSearched(p, stopped)); continue; }
    if (d.client.taxonomyCalls > BUDGET.taxonomyPerRequest) { out.push(notSearched(p, "this request read eBay's category lists too many times; search fewer parts at once")); continue; }
    const before = d.client.browseCalls;
    const r: PartResult = { ...notSearched(p, ""), status: "searched" };
    delete r.reason;
    try {
      let category = await categoryFor(d.client, p.query);
      let props = await fitmentProperties(d.client, category.id);
      if (!props.includes("Year") && category.id !== CAR_TRUCK_PARTS) {
        category = { id: CAR_TRUCK_PARTS, name: "Car & Truck Parts & Accessories", basis: "car_truck_parts_fallback",
          note: `eBay's suggested category ${category.id} (${category.name}) does not support fitment` };
        props = await fitmentProperties(d.client, category.id);
      }
      r.category = category;
      const fit = await resolveFitment(d.client, category.id, props, vehicle);
      r.fitment = fit;
      const q = (p.part_number ?? "").trim() || p.query;
      const run = async (catId: string, compat: Record<string, string> | null) => {
        await spend();
        const j = await d.client.search({ q, categoryId: catId, compat, zip: opts.zip ?? null, limit: BUDGET.readPerSearch });
        return { j, at: now().toISOString() };
      };
      let res: { j: any; at: string };
      let withFit = fit.established;
      try {
        res = await run(category.id, withFit ? fit.applied : null);
      } catch (e) {
        if (!(e instanceof EbayRefused) || !/supports fitment/i.test(e.message) || category.id === CAR_TRUCK_PARTS) throw e;
        r.category = { id: CAR_TRUCK_PARTS, name: "Car & Truck Parts & Accessories", basis: "car_truck_parts_fallback", note: `eBay refused fitment in category ${category.id}: ${e.message}` };
        res = await run(CAR_TRUCK_PARTS, withFit ? fit.applied : null);
      }
      r.search = { q, with_fitment: withFit };
      if (withFit && Number(res.j?.total ?? 0) === 0 && p.part_number) {
        // A part number eBay's fitment tables do not carry: the same number without fitment, every listing unknown fit.
        res = await run(r.category!.id, null);
        withFit = false;
        r.search = { q, with_fitment: false, fallback: "no listing under the vehicle's fitment carries this part number; shown without fitment" };
      }
      const listings = ((res.j?.itemSummaries ?? []) as any[])
        .map((s) => normalizeSummary(s, { observedAt: res.at, fitChecked: withFit, query: p.query, partNumber: p.part_number ?? null, vehicleYear: vehicle.year }))
        .filter((x): x is PartListing => !!x);
      r.ebay_total = Number.isFinite(Number(res.j?.total)) ? Number(res.j.total) : null;
      r.read = listings.length;
      r.exact_read = listings.filter((l) => l.fit === "exact").length;
      r.possible_read = listings.filter((l) => l.fit === "possible").length;
      r.unknown_read = listings.filter((l) => l.fit === "unknown").length;
      r.shortlist = rankListings(listings, opts.shortlist ?? BUDGET.shortlist);
      r.observed_at = res.at;
    } catch (e) {
      if (e instanceof Stop) { Object.assign(r, notSearched(p, (e as Error).message), { category: r.category, fitment: r.fitment }); }
      else if (e instanceof QuotaExceeded) { stopped = `Not enough eBay quota today: eBay refused the search (${(e as Error).message}).`; Object.assign(r, notSearched(p, stopped)); }
      else { Object.assign(r, notSearched(p, `eBay search failed: ${(e as Error).message}`), { category: r.category, fitment: r.fitment }); }
    }
    r.browse_calls = d.client.browseCalls - before;
    out.push(r);
  }
  return { refused: null as string | null, parts: out };
}

// ---- HTTP -------------------------------------------------------------------------------------------------------

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInput(body: any): { vehicleId: string; parts: PartQuery[]; zip: string | null } | { error: string } {
  if (!UUID.test(String(body?.vehicle_id ?? ""))) return { error: "vehicle_id (uuid) is required" };
  const raw = Array.isArray(body?.parts) ? body.parts : [];
  const parts: PartQuery[] = [];
  for (const x of raw) {
    const query = String(typeof x === "string" ? x : x?.query ?? "").replace(/\s+/g, " ").trim();
    const pn = typeof x === "object" && x?.part_number ? String(x.part_number).replace(/\s+/g, " ").trim() : null;
    const wop = typeof x === "object" && x?.work_order_part_id && UUID.test(String(x.work_order_part_id)) ? String(x.work_order_part_id) : null;
    if (!query || query.length > 120 || (pn && pn.length > 60)) return { error: "each part needs a query of 1-120 characters (and a part number of at most 60)" };
    parts.push({ query, part_number: pn || null, work_order_part_id: wop });
  }
  if (parts.length < 1 || parts.length > BUDGET.maxParts) return { error: `send 1 to ${BUDGET.maxParts} parts` };
  const zip = body?.delivery_postal_code ? String(body.delivery_postal_code).trim() : null;
  if (zip && !/^\d{5}$/.test(zip)) return { error: "delivery_postal_code must be a 5-digit US ZIP" };
  return { vehicleId: String(body.vehicle_id), parts, zip };
}

export async function handleParts(req: Request, body: any): Promise<Response> {
  const t0 = Date.now();
  const who = await authenticateWriter(req);
  if (!who.ok || (who.caller.kind !== "user" && who.caller.kind !== "service_role")) {
    return json({ ok: false, error: "Sign in to search eBay for parts." }, 401);
  }
  const input = parseInput(body);
  if ("error" in input) return json({ ok: false, error: input.error }, 400);
  if (!Deno.env.get("EBAY_CLIENT_ID") || !Deno.env.get("EBAY_CLIENT_SECRET")) {
    return json({ ok: false, error: "eBay keys are not set; nothing was called" }, 503);
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, projectSecretKey()!);
  const userId = who.caller.kind === "user" ? who.caller.userId : null;
  const { data: v, error } = await supabase.from("vehicles")
    .select("id,year,make,model,series,trim,engine_size,engine_type,engine_displacement,is_public").eq("id", input.vehicleId).maybeSingle();
  if (error) return json({ ok: false, error: `vehicle read failed: ${error.message}` }, 500);
  let allowed = !!v && (v.is_public === true || !userId);
  if (v && !allowed && userId) {
    const acc = await supabase.rpc("vehicle_user_has_access", { p_vehicle_id: v.id, p_user_id: userId });
    allowed = acc.data === true;
  }
  if (!v || !allowed) return json({ ok: false, error: "Vehicle unavailable" }, 404);
  if (!v.year || !v.make || !v.model) {
    return json({ ok: false, error: "Fitment needs the vehicle's year, make and model; this vehicle is missing one.", vehicle_id: v.id }, 422);
  }

  let ebayRemaining: number | null = null, resetsAt: string | null = null;
  try {
    const q = await new BrowseClient().remainingToday();   // Developer Analytics API: not a Browse call
    ebayRemaining = q?.remaining ?? null; resetsAt = q?.resetAt ?? null;
  } catch (e) {
    if (!(e instanceof QuotaExceeded)) throw e;
    ebayRemaining = 0;
  }
  const client = new PartsClient();
  const ledger = rateLimitLedger(supabase, userId);
  const r = await findParts({ client, ledger, ebayRemaining }, v, input.parts, { zip: input.zip });
  const usedAfter = await ledger.usedToday();
  return json({
    ok: r.refused === null,
    refused: r.refused,
    vehicle: { id: v.id, year: v.year, make: v.make, model: v.model, series: v.series ?? null, trim: v.trim ?? null,
      engine: v.engine_type ?? v.engine_size ?? null },
    parts: r.parts,
    calls: { browse: client.browseCalls, taxonomy: client.taxonomyCalls },
    quota: { daily_cap: BUDGET.dailyCap, used_today: usedAfter, ebay_remaining_before: ebayRemaining, ebay_floor: BUDGET.ebayFloor, resets_at: resetsAt },
    ranking: { order: ["fit (exact, possible, unknown)", "usable condition", "delivered price (price + cheapest stated shipping)", "condition", "seller feedback"],
      never: ["commission", "promotion or paid placement", "eBay's result order"] },
    fresh_for_seconds: FRESH_SECONDS,
    basis: "eBay Browse search of fixed-price listings delivering to the US; fit is eBay's compatibility verdict for the values listed in each part's fitment; prices are at observed_at, not current, and nothing is ordered",
    elapsed_ms: Date.now() - t0,
  }, r.refused ? 429 : 200);
}
