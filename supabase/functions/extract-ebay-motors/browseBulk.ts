/**
 * Bulk landing from Browse search pages: every open Cars & Trucks listing (category 6001) a queryable record, 200 listings per
 * Browse call, where the sweep's getItem costs 1.5 calls per listing.
 *
 * What a search summary carries (production response read 2026-10-20, 200 + 200 items): itemId, legacyItemId, title, price,
 * currentBidPrice + bidCount (auction formats), buyingOptions, itemCreationDate, itemOriginDate, itemEndDate, condition +
 * conditionId, image + additionalImages (up to 40; s-l225 URLs, served at s-l1600), thumbnailImages, seller {username,
 * feedbackPercentage, feedbackScore}, itemLocation {postalCode masked '914**', country} (no city, no state), categories (the
 * listing's own eBay category path: Model leaf, Make parent, Cars & Trucks, eBay Motors), leafCategoryIds, pickupOptions,
 * itemWebUrl, listingMarketplaceId. It lacks every item specific (VIN, mileage, Model Year, Make, Model, For Sale By) and the
 * description. Those come from the query instead, or not at all:
 *   year         the Model Year aspect filter the page was asked with (a per-year query tells the year of every item it returns)
 *   make, model  the listing's eBay category (Make > Model; 366 of 400 getItem bodies agreed with their Make specific, every
 *                disagreement was an 'Other Makes' or 'Other' category), checked against the title read by the shared title
 *                parser (ingest/vehicleTitle.ts); where the category says 'Other', the title's make (only when it is one of
 *                eBay's own Make values) and model words, each marked as a claim from the title
 *   for sale by  'Private Seller' as the seller declared it, from the For Sale By aspect filter, on vintage years (1991 and
 *                older); a listing met only in its whole-year chunk has no For Sale By claim (Dealer and 'Not Specified'
 *                cannot be asked apart: eBay ignores the filter value 'Not Specified')
 * A disagreement (title year against the filter's year, title make against the category's) leaves the listing unresolved with
 * both claims on it: a blip, never a guess.
 *
 * A pass walks the plan (one chunk per Model Year, a vintage year's Private Seller chunk before it, in the owner's order:
 * 1964-1973, 1974-1991, 1930-1963, older, 1992-2005, newer), newest-listed first, 200 a page, and resumes across runs from
 * system_state 'ebay_browse_bulk'. Listings with no Model Year (147 of 35,625 on 2026-10-20) no filter reaches. Per page: what we hold is read by URL (episodes) and listing id (unresolved observations);
 * a held listing whose price and bid count match is skipped with no write; a changed one is updated (episode price, bid
 * count, the asking-price log for fixed prices; a new observation for a blip); a new one lands through landItem (the deleted
 * member redacted first, ingest, observation, episode, place). A page that lands or changes anything is stored once (gzip in
 * Storage, one listing_page_snapshots row, fetch_method ebay_browse_search_page) and every item it lands names that row.
 * The stored page leaves out each seller object: each item's observation keeps it, where account deletions are honoured.
 *
 * Budget: max_calls Browse calls a run, at most daily_cap a Pacific day (rate_limits ebay-bulk:browse:<date>), never under
 * `floor` left by eBay's own counter; max_land landings and max_updates updates a run; budget_ms of wall time; nothing while
 * the database IO gate (firecrawl_io_gate) is closed. A page cut short by a cap is read again next run.
 */
import { mustWrite, softWrite } from "../_shared/writeResult.ts";
import { vehicleEventWriterFor } from "../_shared/vehicleEventWrite.ts";
const writeVehicleEventByKey = vehicleEventWriterFor("extract-ebay-motors:browse-bulk");
import { normalizeMake } from "../_shared/normalizeVehicle.ts";
import { parseVehicleTitle } from "../ingest/vehicleTitle.ts";
import { aspectFilterFor, type BrowseClient, CATEGORY_CARS_TRUCKS, QuotaExceeded, type SearchPage, type SearchSummary } from "./browseApi.ts";
import { VINTAGE_MAX_YEAR, zip3Of } from "./browseCensus.ts";
import { type IdentityClaim, listingKey, priceOf, tierOfYear } from "./browseMap.ts";
import { emptyReport, landItem, PLATFORM, pool, type Report } from "./browseSweep.ts";
import { auctionLedger, type CallLedger } from "./browseAuctions.ts";
import { deletedLookup, handleHash, handleHashes, type Lookup, tombstoneItem } from "./deletedMembers.ts";

export const STATE_KEY = "ebay_browse_bulk";
export const SOURCE = "ebay-browse-search";          // episode metadata.source until a getItem reads the listing in full
export const METHOD = "ebay_browse_search_v1";
export const FETCH_METHOD = "ebay_browse_search_page";
const PAGE = 200;
const MAX_OFFSET = 10_000;                           // Browse refuses offset + limit beyond 10,000
const RESUME_OVERLAP = 10;                           // a page resumed in a later run starts this many earlier (ended listings shift it)
const BUCKET = "listing-snapshots";
const PRIVATE = "Private Seller";

// ---- identity from a summary (pure) ------------------------------------------------------------------------------------

export interface Chunk { y: string; fsb?: string | null; n: number }
export interface Claim<T> { value: T; basis: string; query?: string }
export interface SummaryIdentity extends IdentityClaim {
  claims: { year?: Claim<number>; make?: Claim<string>; model?: Claim<string>; for_sale_by?: Claim<string> };
  title: { year: number | null; make: string | null; model: string | null };
  category: { make: string | null; model: string | null; leaf_id: string | null };
  conflict: string | null;
}

const mkKey = (s: string | null | undefined) => (normalizeMake(s) ?? s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isOther = (s: string | null | undefined) => !s || /^(other\b|not specified)/i.test(s.trim());

/** The listing's own category path: the Model leaf and its Make parent (Cars & Trucks > Make > Model). */
export function categoryOf(s: SearchSummary): { make: string | null; model: string | null; leaf_id: string | null } {
  const cats = (Array.isArray(s.categories) ? s.categories : []) as { categoryId?: string; categoryName?: string }[];
  const leafId = (Array.isArray(s.leafCategoryIds) ? String(s.leafCategoryIds[0] ?? "") : "") || cats[0]?.categoryId || null;
  const leaf = cats.find((c) => c.categoryId === leafId) ?? null;
  const parent = cats.find((c) => c.categoryId && !["6000", CATEGORY_CARS_TRUCKS, leafId].includes(c.categoryId)) ?? null;
  if (!leaf || leaf.categoryId === "6000" || leaf.categoryId === CATEGORY_CARS_TRUCKS) return { make: null, model: null, leaf_id: leafId };
  if (parent) return { make: isOther(parent.categoryName) ? null : parent.categoryName!.trim(), model: isOther(leaf.categoryName) ? null : leaf.categoryName!.trim(), leaf_id: leafId };
  return { make: isOther(leaf.categoryName) ? null : leaf.categoryName!.trim(), model: null, leaf_id: leafId };   // a make with no model level ('Willys')
}

/**
 * Year, make and model of one summary, each with its basis. `chunk.y` is the Model Year value the page was asked for;
 * `makes` are eBay's own Make values (the pass plan's), the only makes a title may name.
 */
export function summaryIdentity(s: SearchSummary, chunk: Chunk, filter: string, makes: Set<string>): SummaryIdentity {
  const t = parseVehicleTitle(String(s.title ?? ""));
  const cat = categoryOf(s);
  const claims: SummaryIdentity["claims"] = {};
  const conflicts: string[] = [];
  const fy = /^\d{4}$/.test(chunk.y) ? Number(chunk.y) : null;

  let year: number | null = null, yearDisputed = false, makeDisputed = false;
  if (fy !== null) {
    year = fy; claims.year = { value: fy, basis: "ebay Model Year aspect filter", query: filter };
    if (t.year !== null && t.year !== fy) { yearDisputed = true; conflicts.push(`the title says ${t.year}, the Model Year filter returned it under ${fy}`); }
  } else if (t.year !== null) {
    year = t.year; claims.year = { value: t.year, basis: "title (parseVehicleTitle); eBay Model Year not specified" };
  }

  const titleMake = t.make && makes.has(mkKey(t.make)) ? t.make : null;   // a title word that is not one of eBay's makes is not a make
  let make: string | null = null, model: string | null = null;
  if (cat.make) {
    make = cat.make; claims.make = { value: cat.make, basis: "ebay category (Cars & Trucks > Make)" };
    if (titleMake && mkKey(titleMake) !== mkKey(cat.make)) { makeDisputed = true; conflicts.push(`the category says ${cat.make}, the title says ${titleMake}`); }
  } else if (titleMake) {
    make = normalizeMake(titleMake) ?? titleMake; claims.make = { value: make, basis: "title (parseVehicleTitle), one of eBay's Make values" };
  }
  if (cat.model && cat.make) {
    model = cat.model; claims.model = { value: cat.model, basis: "ebay category (Make > Model)" };
  } else if (make && titleMake && mkKey(titleMake) === mkKey(make) && t.model) {
    model = t.model; claims.model = { value: t.model, basis: "title (parseVehicleTitle): the words after the make" };
  }
  if (chunk.fsb) claims.for_sale_by = { value: chunk.fsb, basis: "ebay For Sale By aspect filter", query: filter };

  // a disagreement is kept, not settled: the disputed fields stay unknown on the record, both claims on the observation
  if (yearDisputed) year = null;
  if (makeDisputed) { make = null; model = null; }
  return { year, make, model, claims, title: { year: t.year, make: t.make, model: t.model }, category: cat, conflict: conflicts.length ? conflicts.join("; ") : null };
}

// ---- the plan ----------------------------------------------------------------------------------------------------------

type Dist = NonNullable<SearchPage["aspectDistributions"]>;
const distOf = (d: Dist, re: RegExp) => d.find((x) => re.test((x.localizedAspectName ?? "").trim()));
const valuesOf = (d: Dist, re: RegExp) => {
  const m = new Map<string, number>();
  for (const v of distOf(d, re)?.aspectValueDistributions ?? []) if (v.localizedAspectValue) m.set(v.localizedAspectValue, Number(v.matchCount ?? 0));
  return m;
};
const YEAR_RE = /^(model )?year$/i, FSB_RE = /^for sale by$/i, MAKE_RE = /^make$/i;

/** Owner's order: 1964-1973, 1974-1991, 1930-1963, older, 1992-2005, newer, then a year eBay does not specify. */
export function yearRank(y: string): number {
  if (!/^\d{4}$/.test(y)) return 7;
  const n = Number(y), t = tierOfYear(n);
  return t === 1 ? 1 : t === 2 ? 2 : t === 3 ? 3 : n < 1930 ? 4 : t === 4 ? 5 : 6;
}

export interface Plan {
  year_aspect: string; fsb_aspect: string | null; total: number;
  planned: number;         // listings the year chunks reach (each listing once)
  pages: number;           // search calls a full pass costs (the Private Seller chunks re-read inside their year)
  unreachable: number;     // listings with no Model Year: a 'Not Specified' filter is ignored by eBay, so no chunk reaches them
  makes: string[]; chunks: Chunk[];
}

/**
 * The chunks from eBay's own counts, one per Model Year; a vintage year's Private Seller listings first (the seller-declared
 * For Sale By, exact count per year), then the whole year (its private listings are held by then, so they write nothing).
 * eBay ignores an aspect filter value of 'Not Specified' (read 2026-10-20: For Sale By:{Not Specified} and
 * Model Year:{Not Specified} each returned the whole category, 35,624), so neither is a chunk.
 */
export function buildPlan(total: number, yearAspect: string, years: Map<string, number>, fsbAspect: string | null,
  privateYears: Map<string, number>, makes: string[]): Plan {
  const chunks: Chunk[] = [];
  const ys = [...years.entries()].filter(([y, n]) => n > 0 && /^\d{4}$/.test(y)).sort((a, b) => yearRank(a[0]) - yearRank(b[0]) || a[0].localeCompare(b[0]));
  for (const [y, n] of ys) {
    const p = fsbAspect && Number(y) <= VINTAGE_MAX_YEAR ? privateYears.get(y) ?? 0 : 0;
    if (p > 0) chunks.push({ y, fsb: PRIVATE, n: p });
    chunks.push({ y, n });
  }
  const capped = (c: Chunk) => Math.min(c.n, MAX_OFFSET);
  const unreachable = [...years.entries()].filter(([y]) => !/^\d{4}$/.test(y)).reduce((s, [, n]) => s + n, 0);
  return { year_aspect: yearAspect, fsb_aspect: fsbAspect, total, planned: chunks.filter((c) => !c.fsb).reduce((s, c) => s + capped(c), 0),
    pages: chunks.reduce((s, c) => s + Math.ceil(capped(c) / PAGE), 0), unreachable, makes, chunks };
}

/** A page whose total is far past its chunk's count was not filtered (an ignored value): it is not that chunk's listings. */
export const filterIgnored = (pageTotal: number, c: Chunk) => pageTotal > Math.max(2 * c.n, c.n + 2 * PAGE);

export const chunkFilter = (p: Plan, c: Chunk) =>
  aspectFilterFor(p.year_aspect, [c.y as unknown as number]) + (c.fsb && p.fsb_aspect ? `,${p.fsb_aspect}:{${c.fsb}}` : "");

async function planPass(client: BrowseClient, take: () => Promise<string | null>): Promise<Plan | string> {
  let why = await take(); if (why) return why;
  const top = await client.search({ limit: 1, fieldgroups: "ASPECT_REFINEMENTS" });
  const d = top.aspectDistributions ?? [];
  const yName = distOf(d, YEAR_RE)?.localizedAspectName, fName = distOf(d, FSB_RE)?.localizedAspectName ?? null;
  if (!yName) return "category 6001 refinements list no Model Year aspect";
  let privateYears = new Map<string, number>();
  if (fName && (valuesOf(d, FSB_RE).get(PRIVATE) ?? 0) > 0) {
    why = await take(); if (why) return why;
    const r = await client.search({ limit: 1, fieldgroups: "ASPECT_REFINEMENTS", aspectFilter: `categoryId:${CATEGORY_CARS_TRUCKS},${fName}:{${PRIVATE}}` });
    if (!filterIgnored(r.total, { y: "", n: valuesOf(d, FSB_RE).get(PRIVATE)! })) privateYears = valuesOf(r.aspectDistributions ?? [], YEAR_RE);
  }
  const makes = [...valuesOf(d, MAKE_RE).keys()].filter((m) => !isOther(m));
  return buildPlan(top.total, yName, valuesOf(d, YEAR_RE), fName, privateYears, makes);
}

// ---- state (system_state, the crawlers' key-value store) ------------------------------------------------------------------

export interface PassCounts { pages: number; calls: number; seen: number; current: number; changed: number; updated: number; landed: number; blips: number; rejected: number; skipped: number; stored: number; errors: number }
export interface Pass { id: string; started_at: string; finished_at: string | null; plan: Plan; i: number; offset: number; counts: PassCounts }
export interface BulkState { pass: Pass | null; last_pass?: Omit<Pass, "plan"> & { planned: number; total: number } | null; runs?: number }
const zero = (): PassCounts => ({ pages: 0, calls: 0, seen: 0, current: 0, changed: 0, updated: 0, landed: 0, blips: 0, rejected: 0, skipped: 0, stored: 0, errors: 0 });

export interface StateStore { read(): Promise<BulkState>; write(s: BulkState): Promise<void> }
export function systemStateStore(supabase: any): StateStore {
  return {
    async read() {
      const r = mustWrite("bulk state read", await supabase.from("system_state").select("value").eq("key", STATE_KEY).maybeSingle());
      return (r.data?.value ?? { pass: null }) as BulkState;
    },
    async write(s) {
      mustWrite("bulk state write", await supabase.from("system_state").upsert({ key: STATE_KEY, value: s, updated_at: new Date().toISOString() }, { onConflict: "key" }));
    },
  };
}

// ---- what we hold ------------------------------------------------------------------------------------------------------

/** The seller's own price as we last recorded it (metadata.price_original), for listings eBay converts to USD. */
interface Orig { orig: number | null; origCur: string | null }
export type Held =
  | ({ kind: "episode"; vehicle_id: string; price: number | null; bids: number | null; status: string | null } & Orig)
  | ({ kind: "blip"; price: number | null; observed_at: string; method: string | null } & Orig)
  | { kind: "other"; why: string };
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export const itemUrl = (key: string) => `https://www.ebay.com/itm/${key}`;

/**
 * The seller's own price. A listing in another currency (EBAY_CA, read 2026-10-20) comes back with price.value converted to USD
 * at the day's rate and the seller's amount in convertedFromValue / convertedFromCurrency; its USD value moves with the rate
 * while the seller's price stays put, so the seller's amount is what is compared.
 */
export function originalPrice(s: SearchSummary): { amount: number | null; currency: string | null; converted: boolean } {
  const src = (s.buyingOptions?.includes("AUCTION") && s.currentBidPrice?.value ? s.currentBidPrice : s.price) as
    { value?: string; currency?: string; convertedFromValue?: string; convertedFromCurrency?: string } | undefined;
  const converted = src?.convertedFromValue != null && !!src?.convertedFromCurrency;
  const n = Number(converted ? src!.convertedFromValue : src?.value);
  return { amount: Number.isFinite(n) && n > 0 ? n : null, currency: (converted ? src!.convertedFromCurrency : src?.currency) ?? null, converted };
}

export async function heldListings(supabase: any, keys: string[], sourceId: string): Promise<Map<string, Held>> {
  const held = new Map<string, Held>();
  if (!keys.length) return held;
  const ev = mustWrite("held episodes read", await supabase.from("vehicle_events")
    .select("source_url,vehicle_id,current_price,event_status,bids:metadata->>bid_count,po:metadata->price_original->>amount,pc:metadata->price_original->>currency,ppo:metadata->page->price_original->>amount,ppc:metadata->page->price_original->>currency")
    .in("source_url", keys.map(itemUrl)).eq("source_platform", PLATFORM).eq("event_type", "listing").limit(1000));
  const byKey = new Map<string, any[]>();
  for (const r of ev.data ?? []) {
    const k = String(r.source_url).split("/").pop()!;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  for (const [k, rows] of byKey) {
    const linked = rows.filter((r) => r.vehicle_id);
    const r = linked[0];
    held.set(k, linked.length === 1
      ? { kind: "episode", vehicle_id: r.vehicle_id, price: num(r.current_price), bids: num(r.bids), status: r.event_status ?? null,
          orig: num(r.po ?? r.ppo), origCur: (r.po != null ? r.pc : r.ppc) ?? null }   // an update's record is newer than the landing's
      : { kind: "other", why: `${rows.length} episodes` });
  }
  const rest = keys.filter((k) => !held.has(k));
  if (rest.length) {
    const ob = mustWrite("held observations read", await supabase.from("vehicle_observations")
      .select("source_identifier,vehicle_id,observed_at,extraction_method,amount:extraction_metadata->raw->price->>amount,po:extraction_metadata->raw->price_original->>amount,pc:extraction_metadata->raw->price_original->>currency")
      .eq("source_id", sourceId).eq("kind", "listing").in("source_identifier", rest).limit(1000));
    for (const r of ob.data ?? []) {
      const k = String(r.source_identifier);
      const prior = held.get(k);
      if (r.vehicle_id) { held.set(k, { kind: "other", why: "observation linked to a vehicle without an episode" }); continue; }
      if (prior?.kind === "other") continue;
      if (!prior || (prior.kind === "blip" && String(r.observed_at) > prior.observed_at)) {
        held.set(k, { kind: "blip", price: num(r.amount), observed_at: String(r.observed_at), method: r.extraction_method ?? null, orig: num(r.po), origCur: r.pc ?? null });
      }
    }
  }
  return held;
}

/** Whether the seller's price is the one we hold: the seller's own amount for a converted listing (unknown until recorded). */
export function samePrice(s: SearchSummary, h: { price: number | null } & Orig): boolean {
  const o = originalPrice(s);
  return o.converted ? h.orig != null && h.origCur === o.currency && h.orig === o.amount : h.price === priceOf(s).amount;
}

/**
 * current: held and unchanged (no write). changed: held, and the seller's price or the bid count moved, or a converted listing
 * whose seller's price we have not recorded yet (one update records it), or a blip read some other way (Firecrawl, Wayback,
 * getItem): it is read once from the page, whose year/make/model may resolve it. new: not held.
 */
export function compare(s: SearchSummary, h: Held | undefined): "new" | "current" | "changed" | "skip" {
  if (!h) return "new";
  if (h.kind === "other") return "skip";
  if (h.kind === "blip") return h.method === METHOD && samePrice(s, h) ? "current" : "changed";
  if (h.status === "ended" || h.status === "sold") return "skip";            // an ended episode is not reopened from a summary
  const auction = s.buyingOptions?.includes("AUCTION") ?? false;
  const bidsSame = !auction || (h.bids ?? 0) === Number(s.bidCount ?? 0);
  return samePrice(s, h) && bidsSame ? "current" : "changed";
}

// ---- the stored page -----------------------------------------------------------------------------------------------------

const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource))].map((x) => x.toString(16).padStart(2, "0")).join("");
const gzip = async (text: string) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());

export const pageUrl = (filter: string, offset: number) =>
  `https://api.ebay.com/buy/browse/v1/item_summary/search?${new URLSearchParams({ category_ids: CATEGORY_CARS_TRUCKS, aspect_filter: filter, sort: "newlyListed", limit: String(PAGE), offset: String(offset) })}`;

/** The page as stored: eBay's body with each item's seller object left out (the item's observation keeps it). */
export function storedBody(raw: any, items: SearchSummary[]): string {
  return JSON.stringify({ ...(raw ?? {}), itemSummaries: items.map(({ seller: _s, ...rest }) => rest) });
}

async function storePage(supabase: any, o: { filter: string; offset: number; raw: any; items: SearchSummary[]; fetchedAt: string; passId: string; chunk: Chunk }): Promise<string> {
  const body = storedBody(o.raw, o.items);
  const bytes = new TextEncoder().encode(body);
  const sha = await sha256(bytes);
  const h = await handleHashes(body);                    // what the stored body names (no seller objects: normally none)
  const url = pageUrl(o.filter, o.offset);
  const path = `${PLATFORM}/browse_search/${o.fetchedAt.slice(0, 10)}/${sha}.json.gz`;
  const up = await supabase.storage.from(BUCKET).upload(path, await gzip(body), { contentType: "application/gzip", upsert: true });
  if (up.error) throw new Error(`page storage failed: ${up.error.message}`);
  const ins = await supabase.from("listing_page_snapshots").insert({
    platform: PLATFORM, listing_url: url, fetched_at: o.fetchedAt, fetch_method: FETCH_METHOD, http_status: 200, success: true,
    html: null, html_storage_path: path, html_sha256: sha, content_length: bytes.length,
    metadata: {
      api: "buy/browse/v1/item_summary/search", caller: "extract-ebay-motors bulk", storage_encoding: "gzip", pass_id: o.passId,
      query: { category_ids: CATEGORY_CARS_TRUCKS, aspect_filter: o.filter, sort: "newlyListed", offset: o.offset, limit: PAGE },
      chunk: o.chunk, total: Number(o.raw?.total ?? 0), items: o.items.length, item_keys: o.items.map(listingKey).filter(Boolean),
      seller_fields: "left out of the stored page; each item's observation keeps them (raw.seller), where eBay account deletions are honoured",
      member_handles_sha256: h.member, seller_handles_sha256: h.seller,
    },
  }).select("id").maybeSingle();
  if (ins.data?.id) return ins.data.id;
  if (String(ins.error?.code) !== "23505") throw new Error(`page snapshot row failed: ${ins.error?.message ?? "no id"}`);
  const prior = mustWrite("page snapshot read", await supabase.from("listing_page_snapshots").select("id")
    .eq("platform", PLATFORM).eq("listing_url", url).eq("html_sha256", sha).limit(1).maybeSingle());
  if (!prior.data?.id) throw new Error("page snapshot missing after unique-key conflict");
  return prior.data.id;
}

/** One deleted-member read for the whole page; each item's tombstone is answered from it. */
export async function pageLookup(lookup: Lookup, items: SearchSummary[]): Promise<Lookup> {
  const hashes = new Set((await handleHashes(JSON.stringify(items))).member);
  for (const s of items) if (s.seller?.username) hashes.add(await handleHash(String(s.seller.username)));
  const gone = hashes.size ? await lookup([...hashes]) : new Set<string>();
  return async (hs) => new Set(hs.filter((h) => gone.has(h)));
}

// ---- the run -------------------------------------------------------------------------------------------------------------

export interface BulkOptions {
  maxCalls?: number;       // Browse calls this run (plan + pages)
  dailyCap?: number;       // Browse calls this action may spend in a Pacific day (rate_limits ebay-bulk:browse:<date>)
  floor?: number;          // calls left today (eBay's counter) this run never goes under
  blindCap?: number;       // calls allowed when eBay does not report what is left
  maxLand?: number;        // new listings landed this run
  maxUpdates?: number;     // held listings updated this run (price, bid count)
  budgetMs?: number;       // wall time for the run
  concurrency?: number;    // landings at once
  photos?: number;         // photos per listing sent to ingest (the observation lists all)
  dryRun?: boolean;        // read and classify; no writes, the cursor stays
  restart?: boolean;       // begin a new pass now
  ledger?: CallLedger; store?: StateStore; gate?: () => Promise<{ open: boolean; [k: string]: unknown }>;
  land?: typeof landItem;  // tests pass a recorder; default the sweep's landItem
  now?: () => number;
}

export interface PageRow { chunk: string; offset: number; total: number; items: number; new: number; current: number; changed: number; skip: number;
  landed: number; blips: number; rejected: number; skipped: number; updated: number; stored: boolean; complete: boolean; ignored?: boolean; ms: Record<string, number> }
export interface BulkReport extends Report {
  bulk: { pass_id: string | null; pass_started_at: string | null; chunk: string | null; position: string | null; planned: number | null; ebay_total: number | null;
    pages: PageRow[]; browse_calls: number; landed_new: number; updated: number; pass_done: boolean; pass_counts: PassCounts | null; gate: unknown; ms: number;
    trace_waits: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * The wait Supabase asks for when a function's calls to other functions exceed its per-trace budget
 * (Deno.errors.RateLimitError, "Rate limit exceeded for trace <id>. Retry after <n>ms."). Each landing calls ingest once; on
 * 2026-10-21 00:21Z the budget held 32 such calls a minute, so a run lands about 30, then waits out the window.
 */
export function traceRetryMs(e: unknown): number | null {
  const name = (e as { name?: string })?.name, msg = String((e as Error)?.message ?? e);
  const m = /Retry after (\d+)\s*ms/i.exec(msg);
  if (name === "RateLimitError" || /rate limit exceeded for trace/i.test(msg)) return m ? Number(m[1]) : 60_000;
  return null;
}

export async function ioGate(supabase: any): Promise<{ open: boolean; [k: string]: unknown }> {
  const r = await supabase.rpc("firecrawl_io_gate");
  if (r.error || !r.data) return { open: false, error: r.error?.message ?? "no answer" };
  return r.data;
}

export async function bulk(supabase: any, client: BrowseClient, o: BulkOptions = {}): Promise<BulkReport> {
  const now = o.now ?? Date.now, t0 = now();
  const maxCalls = o.maxCalls ?? 8, floor = o.floor ?? 1000, maxLand = o.maxLand ?? 60, maxUpdates = o.maxUpdates ?? 300;
  const budgetMs = o.budgetMs ?? 100_000, conc = o.concurrency ?? 3;
  const ledger = o.ledger ?? auctionLedger(supabase, o.dailyCap ?? 1200, new Date(now()), "ebay-bulk");
  const store = o.store ?? systemStateStore(supabase);
  const gate = o.gate ?? (() => ioGate(supabase));
  const land = o.land ?? landItem;
  const b: BulkReport["bulk"] = { pass_id: null, pass_started_at: null, chunk: null, position: null, planned: null, ebay_total: null, pages: [],
    browse_calls: 0, landed_new: 0, updated: 0, pass_done: false, pass_counts: null, gate: null, ms: 0, trace_waits: 0 };
  const rep: BulkReport = { ...emptyReport(o.dryRun ? "bulk_dry_run" : "bulk"), bulk: b };
  let c0 = client.calls;
  const browse = () => client.calls - c0;
  const late = () => now() - t0 > budgetMs;
  try {
    const g = await gate();
    b.gate = g;
    if (!g.open) { rep.stopped = "io_gate: the database is busy (firecrawl_io_gate closed); nothing was read or written"; return rep; }
    const q = await client.remainingToday();
    c0 = client.calls;                                    // the rate-limit read is the Analytics API, not Browse
    rep.remaining_before = q?.remaining ?? null;
    const budget = Math.min(maxCalls, q ? q.remaining - floor : (o.blindCap ?? 4));
    if (budget < 1) { rep.stopped = `quota: ${q?.remaining ?? "?"} calls left today, ${floor} kept as the floor`; return rep; }
    const take = async () => browse() >= budget ? `budget: ${browse()} of ${budget} calls this run` : await ledger.take();

    const src = mustWrite("source read", await supabase.from("observation_sources").select("id").eq("slug", PLATFORM).maybeSingle());
    if (!src.data?.id) throw new Error("observation_sources has no ebay_motors row");
    const state = await store.read();
    let pass = state.pass;
    if (!pass || pass.finished_at || o.restart) {
      const plan = await planPass(client, take);
      if (typeof plan === "string") { rep.stopped = `plan: ${plan}`; return rep; }
      if (pass && !o.dryRun) { const { plan: old, ...rest } = pass; state.last_pass = { ...rest, planned: old.planned, total: old.total }; }
      pass = { id: new Date(now()).toISOString(), started_at: new Date(now()).toISOString(), finished_at: null, plan, i: 0, offset: 0, counts: { ...zero(), calls: browse() } };
      if (!o.dryRun) await store.write({ ...state, pass });
    }
    b.pass_id = pass.id; b.pass_started_at = pass.started_at; b.planned = pass.plan.planned; b.ebay_total = pass.plan.total;
    const makes = new Set(pass.plan.makes.map(mkKey));
    const lookup = deletedLookup(supabase);
    let landedRun = 0, updatedRun = 0, errorsBefore = rep.errors.length, resumed = state.pass?.id === pass.id && pass.offset > 0, pauseUntil = 0;
    const runs = (state.runs ?? 0) + 1;                  // runs that read a page, across passes

    while (!rep.stopped) {
      const chunk = pass.plan.chunks[pass.i];
      if (!chunk) { pass.finished_at = new Date(now()).toISOString(); b.pass_done = true; rep.stopped = "pass complete: the next run plans a new pass"; break; }
      if (late()) { rep.stopped = `time: ${budgetMs} ms used`; break; }
      if (landedRun >= maxLand) { rep.stopped = `max_land: ${landedRun} landed this run`; break; }
      if (updatedRun >= maxUpdates) { rep.stopped = `max_updates: ${updatedRun} updated this run`; break; }
      if (b.pages.length) { const g2 = await gate(); if (!g2.open) { b.gate = g2; rep.stopped = "io_gate: the database became busy; the next run continues here"; break; } }
      const why = await take();
      if (why) { rep.stopped = why; break; }
      const filter = chunkFilter(pass.plan, chunk);
      const offset = resumed ? Math.max(0, pass.offset - RESUME_OVERLAP) : pass.offset;
      resumed = false;
      const tf = now();
      const page = await client.search({ aspectFilter: filter, offset, limit: PAGE });
      const fetchedAt = new Date(now()).toISOString();
      const row: PageRow = { chunk: `${chunk.y}${chunk.fsb ? ` / ${chunk.fsb}` : ""}`, offset, total: page.total, items: page.itemSummaries.length,
        new: 0, current: 0, changed: 0, skip: 0, landed: 0, blips: 0, rejected: 0, skipped: 0, updated: 0, stored: false, complete: true, ms: { fetch: now() - tf } };
      b.pages.push(row);
      pass.counts.pages++; pass.counts.calls++;
      if (filterIgnored(page.total, chunk)) {               // eBay answered without the filter: not this chunk's listings
        row.ignored = true; pass.i++; pass.offset = 0;
        rep.errors.push(`chunk ${row.chunk}: eBay returned ${page.total} listings for a chunk of ${chunk.n}, so the filter was not applied; skipped`);
        if (!o.dryRun) await store.write({ ...state, pass, runs });
        continue;
      }

      // 1. the deleted members go first (one read for the page), then what we hold
      const th = now();
      const sums = page.itemSummaries.filter((s) => s.itemId && listingKey(s));
      const pl = await pageLookup(lookup, sums);
      const items = await Promise.all(sums.map(async (s) => (await tombstoneItem(pl, s)).raw as SearchSummary));
      const held = await heldListings(supabase, items.map((s) => listingKey(s)!), src.data.id);
      row.ms.held = now() - th;
      const work: { s: SearchSummary; kind: "new" | "changed"; h?: Held }[] = [];
      for (const s of items) {
        const k = compare(s, held.get(listingKey(s)!));
        if (k === "current") row.current++; else if (k === "skip") row.skip++;
        else { work.push({ s, kind: k, h: held.get(listingKey(s)!) }); if (k === "new") row.new++; else row.changed++; }
      }
      pass.counts.seen += items.length; pass.counts.current += row.current; pass.counts.changed += row.changed;

      if (!o.dryRun && work.length) {
        // 2. the page, stored once; every write below names it
        const ts = now();
        const snapshotId = await storePage(supabase, { filter, offset, raw: page.raw, items, fetchedAt, passId: pass.id, chunk });
        row.stored = true; row.ms.store = now() - ts; pass.counts.stored++;

        // 3. held listings whose price or bids moved: the episode (and the asking-price log for a fixed price); a blip: a new observation
        const tu = now();
        const upd = work.filter((w) => w.kind === "changed" && w.h?.kind === "episode").slice(0, Math.max(0, maxUpdates - updatedRun));
        await pool(upd, 4, async (w) => {
          const h = w.h as Extract<Held, { kind: "episode" }>;
          const key = listingKey(w.s)!, p = priceOf(w.s), o = originalPrice(w.s);
          // the seller's price moved (a converted listing whose seller's price we had not recorded is recorded, not a move)
          const moved = o.converted ? h.orig != null && h.origCur === o.currency && h.orig !== o.amount : p.amount !== h.price;
          const ev = await writeVehicleEventByKey(supabase, {
            vehicle_id: h.vehicle_id, source_platform: PLATFORM, source_listing_id: key, source_url: itemUrl(key), event_type: "listing", updated_at: fetchedAt,
            ...(p.amount != null ? { current_price: p.amount } : {}),   // eBay's USD figure today; the seller's own is price_original
            metadata: { source_observed_at: fetchedAt, last_checked_at: fetchedAt, bid_count: w.s.bidCount ?? null, listing_ends_at: w.s.itemEndDate ?? null,
              price_snapshot_id: snapshotId, price_original: o, ...(moved ? { price_changed_at: fetchedAt, price_before: h.price, price_original_before: h.orig } : {}) },
          }, { preserveEventStatus: true, sourceObservedAt: fetchedAt });
          if (ev.action === "error") { rep.errors.push(`update ${key}: ${ev.error}`.slice(0, 300)); return; }
          updatedRun++;                                    // a skipped write (a newer read is on the episode) still used its turn
          if (ev.action === "skipped") return;
          row.updated++;
          if (p.kind === "buy_it_now" && p.amount != null && moved) {
            softWrite(`price log ${key}`, await supabase.from("vehicle_price_history").insert({
              vehicle_id: h.vehicle_id, price_type: "asking", value: p.amount, source: PLATFORM, as_of: fetchedAt, confidence: 70,
              proof_type: "listing", proof_url: itemUrl(key),
              notes: `ebay item ${key} search page ${snapshotId}` + (o.converted ? `; seller's price ${o.currency} ${o.amount}, value is eBay's USD conversion` : ""),
            }), rep.errors);
          }
        });
        row.ms.update = now() - tu;

        // 4. new listings (and blips whose price moved) through the sweep's landing path
        const tl = now();
        const lands = work.filter((w) => w.kind === "new" || w.h?.kind === "blip");
        const room = Math.max(0, maxLand - landedRun);
        const todo = lands.slice(0, room);
        let done = 0;
        await pool(todo, conc, async (w) => {
          for (let attempt = 0; attempt < 3; attempt++) {
            if (pauseUntil > now()) {                      // the trace budget is spent: wait for its window if this run has the time
              if (pauseUntil - t0 > budgetMs) return;
              await sleep(pauseUntil - now());
            }
            if (late()) return;
            const r = await landOne(w);
            if (r !== "trace") return;
          }
        });
        async function landOne(w: { s: SearchSummary; kind: "new" | "changed"; h?: Held }): Promise<"done" | "trace" | "failed"> {
          const id = summaryIdentity(w.s, chunk, filter, makes);
          const extra = {
            capture: "search_summary", search_page: { snapshot_id: snapshotId, offset, position: items.indexOf(w.s), aspect_filter: filter },
            identity_claims: id.claims, identity_conflict: id.conflict, title_parse: id.title, category: id.category, categories: w.s.categories ?? [],
            condition: w.s.condition ?? null, condition_id: w.s.conditionId ?? null, for_sale_by: id.claims.for_sale_by ?? null,
            zip3: zip3Of(w.s.itemLocation?.postalCode), item_origin_date: w.s.itemOriginDate ?? null, price_original: originalPrice(w.s),
          };
          try {
            const r = await land(supabase, w.s, rep, fetchedAt, {
              snapshotId, source: SOURCE, method: METHOD, identity: id, lookup: pl, extra,
              ...(w.kind === "changed" ? { hashRawData: true } : {}), ...(o.photos != null ? { ingestImageCap: o.photos } : {}),
            });
            done++;
            if (r === "landed") row.landed++; else if (r === "blip") row.blips++; else if (r === "rejected") row.rejected++; else row.skipped++;
            return "done";
          } catch (e) {
            if (e instanceof QuotaExceeded) throw e;
            const wait = traceRetryMs(e);
            if (wait != null) {                            // nothing was written yet (the throttled call is ingest's): try it again later
              pauseUntil = Math.max(pauseUntil, now() + wait + 500);
              b.trace_waits++;
              return "trace";
            }
            row.skipped++; done++;                         // settled with an error: the next pass tries it again; the cursor moves on
            rep.errors.push(`land ${listingKey(w.s)}: ${(e as Error).message}`.slice(0, 300));
            return "failed";
          }
        }
        landedRun += done;
        row.ms.land = now() - tl;
        // complete when every listing settled (landed, or failed with an error); one throttled or not reached is read again next run
        row.complete = done === lands.length && upd.length === work.filter((w) => w.kind === "changed" && w.h?.kind === "episode").length;
        pass.counts.landed += row.landed; pass.counts.blips += row.blips; pass.counts.rejected += row.rejected; pass.counts.skipped += row.skipped; pass.counts.updated += row.updated;
      }
      pass.counts.errors = (pass.counts.errors ?? 0) + rep.errors.length - errorsBefore;
      errorsBefore = rep.errors.length;

      // 5. the cursor: a finished page moves on; a page a cap cut short is read again next run
      if (row.complete) {
        const next = offset + PAGE;
        if (!page.next || next >= page.total || page.itemSummaries.length === 0 || next + PAGE > MAX_OFFSET) { pass.i++; pass.offset = 0; }   // a chunk past 10,000 would be cut here (none was: the largest year held 4,648 on 2026-10-20)
        else pass.offset = next;
      } else pass.offset = offset + RESUME_OVERLAP;      // read from here again (less the overlap): what landed is held now
      b.chunk = `${pass.i + 1}/${pass.plan.chunks.length}`;
      b.position = `${pass.plan.chunks[pass.i]?.y ?? "-"}${pass.plan.chunks[pass.i]?.fsb ? ` / ${pass.plan.chunks[pass.i]!.fsb}` : ""} @ ${pass.offset}`;
      if (!o.dryRun) await store.write({ ...state, pass, runs });
      if (!row.complete) { rep.stopped ??= `cap: page ${row.chunk} @ ${offset} continues next run`; break; }
    }
    if (pass.finished_at && !o.dryRun) await store.write({ ...state, pass, runs });
    b.pass_counts = pass.counts;
  } catch (e) {
    if (e instanceof QuotaExceeded) rep.stopped = `quota: ${e.message}`;
    else { rep.ok = false; rep.errors.push((e as Error).message.slice(0, 400)); }
  }
  b.browse_calls = browse();
  rep.calls = b.browse_calls;
  b.landed_new = b.pages.reduce((s, p) => s + p.landed, 0);
  b.updated = b.pages.reduce((s, p) => s + p.updated, 0);
  b.ms = now() - t0;
  const after = await client.remainingToday().catch(() => null);
  rep.remaining_after = after?.remaining ?? null;
  if (rep.errors.length) rep.ok = false;
  return rep;
}
