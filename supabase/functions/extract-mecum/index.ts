/**
 * EXTRACT MECUM v2.0
 *
 * Two-tier extraction for Mecum auction pages:
 *   1. PREFERRED: Direct HTTP fetch → parse __NEXT_DATA__ JSON (FREE, all fields)
 *   2. FALLBACK: archiveFetch with Firecrawl → parse markdown (JS-rendered content)
 *
 * __NEXT_DATA__ contains structured data:
 *   - pageProps.post.title, color, interior, transmission, vinSerial, hammerPrice
 *   - Taxonomy edges: year, make, model, saleResult, auction, division
 *   - images array with CDN URLs
 *   - lotSeries (engine/highlight features)
 *
 * All pages archived to listing_page_snapshots via archiveFetch.
 * Quality gate prevents garbage data from entering the database.
 *
 * Actions:
 *   POST { "url": "..." }                            — Extract single URL
 *   POST { "action": "batch_from_queue", "limit": 10 }  — Process queue items
 *   POST { "action": "batch_from_targets", "limit": 20 } — Land unlanded sitemap targets, direct fetch only, throttled
 *   POST { "action": "re_enrich", "limit": 50 }     — Re-enrich existing vehicles
 *   POST { "action": "source_result_preview", "snapshot_id": "UUID" }
 *      — Service-only, hash-verified retained-source preview; never writes
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parse as parseHtml } from "https://esm.sh/parse5@7.3.0";
import { archiveFetch, readArchivedPage } from "../_shared/archiveFetch.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { cleanVehicleFields } from "../_shared/pollutionDetector.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { authenticateWriter, requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { postFromFlight } from "./rscPost.ts";
import { patchForLiveRow, writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";

const EXTRACTOR_VERSION = "2.0.0";
const TARGETS_TAG = "mecum-targets:1";
const UPCOMING_TAG = "mecum-upcoming:1";
const REVERIFY_TAG = "mecum-reverify:1";
const REFOLD_TAG = "mecum-refold:1";
const ALGOLIA_APP = "U6CFCQ7V52";
const ALGOLIA_INDEX = "wp_posts_lot";
// The search-only key Mecum's own site ships (also in scripts/mecum-algolia-discovery.mjs); it can read, not write.
const ALGOLIA_SEARCH_KEY = "0291c46cde807bcb428a021a96138fcb";

/** One query against Mecum's public search index; throws on a refusal so a permission check is never read as "no lots". */
async function algolia(params: string): Promise<any> {
  const resp = await fetch(`https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/*/queries`, { // guardrail-allow: raw-fetch (JSON search API, not a page)
    method: "POST",
    headers: { "x-algolia-application-id": ALGOLIA_APP, "x-algolia-api-key": ALGOLIA_SEARCH_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params }] }),
  });
  if (!resp.ok) throw new Error(`algolia ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const body = await resp.json();
  const result = body?.results?.[0];
  if (!result) throw new Error("algolia: no result");
  if (result.message) throw new Error(`algolia: ${result.message}`);
  return result;
}
export const MECUM_SOURCE_RESULT_PARSER_VERSION = "extract-mecum:2.0.0:source_result_candidate_v2";

type MecumTaxonomyClaim = { index: number; name: string | null; slug: string | null; incomplete: boolean };
type MecumTaxonomyEvidence = {
  path: string;
  state: "missing" | "null" | "invalid" | "edges_missing" | "edges_null" | "empty" | "present";
  claims: MecumTaxonomyClaim[];
};
export interface MecumSourceResultCandidate {
  parser: typeof MECUM_SOURCE_RESULT_PARSER_VERSION;
  status: "candidate" | "refused";
  qualified: false;
  publicShareable: false;
  nextDataScriptCount: number;
  reportedAmount: number | null;
  amountPath: "props.pageProps.post.hammerPrice";
  visibility: { price: "hidden" | "not_hidden" | "unknown"; result: "hidden" | "not_hidden" | "unknown" };
  saleResult: "sold" | "not_sold" | "bid_goes_on" | "upcoming" | "unknown" | "conflicting";
  saleResults: MecumTaxonomyEvidence;
  scheduledRunDay: string | null;
  scheduledRunDayBasis: "source_runDates_schedule";
  runDates: MecumTaxonomyEvidence;
  auctionSchedule: { path: string; value: string | null; explicitZone: boolean | null };
  sourceLocators: { uri: string | null; databaseId: number | null; lotNumber: string | null };
  currency: null;
  priceBasis: null;
  saleEventDay: null;
  refusalReasons: string[];
}

/** Private evidence-assay contract, not sale admission or a publication filter.
 * The observed source supplies a nominal hammerPrice field, result taxonomy and
 * scheduled run day. It does not establish currency, fee basis or transfer time.
 * Preserve disagreements/missing claims; never promote a native price or status.
 * Default extraction, fetch and writer behavior below remains unchanged.
 */
export function parseMecumSourceResultCandidate(html: string): MecumSourceResultCandidate {
  const qualificationGaps = ["currency_unestablished", "price_basis_unestablished", "sale_event_clock_unestablished", "parent_custody_not_evaluated"];
  const taxonomy = (key: string, post?: Record<string, any>): MecumTaxonomyEvidence => {
    const path = `props.pageProps.post.${key}`;
    if (!post || !Object.hasOwn(post, key)) return { path, state: "missing", claims: [] };
    const value = post[key];
    if (value === null) return { path, state: "null", claims: [] };
    if (typeof value !== "object" || Array.isArray(value)) return { path, state: "invalid", claims: [] };
    if (!Object.hasOwn(value, "edges")) return { path, state: "edges_missing", claims: [] };
    if (value.edges === null) return { path, state: "edges_null", claims: [] };
    if (!Array.isArray(value.edges)) return { path, state: "invalid", claims: [] };
    const claims = value.edges.map((edge: any, index: number) => {
      const node = edge?.node;
      const name = typeof node?.name === "string" && node.name.trim() ? node.name : null;
      const slug = typeof node?.slug === "string" && node.slug.trim() ? node.slug : null;
      return { index, name, slug, incomplete: name === null || slug === null };
    });
    return { path, state: claims.length ? "present" : "empty", claims };
  };
  const out: MecumSourceResultCandidate = {
    parser: MECUM_SOURCE_RESULT_PARSER_VERSION, status: "refused", qualified: false, publicShareable: false,
    nextDataScriptCount: 0, reportedAmount: null, amountPath: "props.pageProps.post.hammerPrice",
    visibility: { price: "unknown", result: "unknown" },
    saleResult: "unknown", saleResults: taxonomy("saleResults"), scheduledRunDay: null,
    scheduledRunDayBasis: "source_runDates_schedule", runDates: taxonomy("runDates"),
    auctionSchedule: { path: "props.pageProps.post.auctionDayStart", value: null, explicitZone: null },
    sourceLocators: { uri: null, databaseId: null, lotNumber: null },
    currency: null, priceBasis: null, saleEventDay: null,
    refusalReasons: [...qualificationGaps],
  };
  const refuse = (reason: string) => { out.refusalReasons.push(reason); return out; };
  if (typeof html !== "string" || new TextEncoder().encode(html).byteLength > 2097152) return refuse("source_body_invalid_or_over_limit");
  // Parse HTML structure rather than matching tags: comments and template
  // content are not active source containers; quoted '>' and end-tag attributes
  // must follow HTML semantics. No script executes during this parse.
  const scripts: string[] = [];
  const nodes: any[] = [parseHtml(html)];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.tagName === "script" && node.namespaceURI === "http://www.w3.org/1999/xhtml"
      && node.attrs?.some((attr: any) => attr.name === "id" && attr.value === "__NEXT_DATA__")) {
      scripts.push((node.childNodes ?? []).filter((child: any) => child.nodeName === "#text")
        .map((child: any) => child.value).join(""));
    }
    for (let i = (node.childNodes?.length ?? 0) - 1; i >= 0; i--) nodes.push(node.childNodes[i]);
  }
  out.nextDataScriptCount = scripts.length;
  if (scripts.length !== 1) return refuse(scripts.length ? "source_presentations_ambiguous" : "next_data_missing");
  let parsed: any;
  try { parsed = JSON.parse(scripts[0]); } catch { return refuse("next_data_malformed"); }
  const post = parsed?.props?.pageProps?.post;
  if (!post || typeof post !== "object" || Array.isArray(post)) return refuse("source_post_missing_or_invalid");
  out.saleResults = taxonomy("saleResults", post);
  out.runDates = taxonomy("runDates", post);
  out.sourceLocators = {
    uri: typeof post.uri === "string" ? post.uri : null,
    databaseId: Number.isSafeInteger(post.databaseId) ? post.databaseId : null,
    lotNumber: typeof post.lotNumber === "string" ? post.lotNumber : null,
  };
  out.auctionSchedule.value = typeof post.auctionDayStart === "string" ? post.auctionDayStart : null;
  out.auctionSchedule.explicitZone = out.auctionSchedule.value === null ? null
    : /[T ][0-9]{2}:[0-9]{2}.*(?:Z|[+-][0-9]{2}:?[0-9]{2})$/.test(out.auctionSchedule.value);
  const visibility = (value: unknown): "hidden" | "not_hidden" | "unknown" =>
    value === true || value === 1 || value === "1" || value === "true" ? "hidden"
    : value === false || value === 0 || value === "0" || value === "" ? "not_hidden" : "unknown";
  out.visibility = { price: visibility(post.hideHammerPrice), result: visibility(post.hideSaleResult) };
  if (out.visibility.price === "hidden") out.refusalReasons.push("source_price_hidden");
  else if (out.visibility.price === "unknown") out.refusalReasons.push("source_price_visibility_unestablished");
  else if ((typeof post.hammerPrice === "string" && /^[0-9]+$/.test(post.hammerPrice)) || typeof post.hammerPrice === "number") {
    const amount = Number(post.hammerPrice);
    if (Number.isSafeInteger(amount) && amount > 0) out.reportedAmount = amount;
  }
  if (out.reportedAmount === null && !out.refusalReasons.includes("source_price_hidden")) out.refusalReasons.push("source_amount_missing_or_unsupported");
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[ _]+/g, "-");
  const resultValues = out.saleResults.claims.flatMap(c => [c.name, c.slug].filter((v): v is string => v !== null).map(normalize));
  if (out.saleResults.state !== "present" || out.saleResults.claims.some(c => c.incomplete)) out.refusalReasons.push("sale_result_claims_incomplete");
  else if (new Set(resultValues).size !== 1) { out.saleResult = "conflicting"; out.refusalReasons.push("sale_result_claims_conflict"); }
  else {
    const results = { sold: "sold", "not-sold": "not_sold", "bid-goes-on": "bid_goes_on", upcoming: "upcoming" } as const;
    out.saleResult = Object.hasOwn(results, resultValues[0]) ? results[resultValues[0] as keyof typeof results] : "unknown";
    if (out.saleResult === "unknown") out.refusalReasons.push("sale_result_unsupported");
  }
  if (out.visibility.result !== "not_hidden") {
    out.saleResult = "unknown";
    out.refusalReasons.push(out.visibility.result === "hidden" ? "source_result_hidden" : "source_result_visibility_unestablished");
  }
  const validDay = (s: string) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)
    && Number.isFinite(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  // The retained WordPress taxonomy uses midnight name/slug serializations.
  // They label a civil scheduled run day, not midnight in an inferred timezone.
  // Accept only the evidenced forms; arbitrary timestamp prefixes stay unknown.
  const civilDay = (raw: string, field: "name" | "slug") => {
    const syntax = field === "name" ? /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?: 00:00:00)?$/
      : /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-000000)?$/;
    const day = raw.slice(0, 10);
    return syntax.test(raw) && validDay(day) ? day : null;
  };
  const dayValues = out.runDates.claims.flatMap(c => [
    c.name === null ? null : civilDay(c.name, "name"),
    c.slug === null ? null : civilDay(c.slug, "slug"),
  ]);
  if (out.runDates.state !== "present" || out.runDates.claims.some(c => c.incomplete)) out.refusalReasons.push("scheduled_run_claims_incomplete");
  else if (dayValues.some(d => d === null)) out.refusalReasons.push("scheduled_run_day_unsupported");
  else if (new Set(dayValues).size !== 1) out.refusalReasons.push("scheduled_run_days_conflict");
  else out.scheduledRunDay = dayValues[0];
  if (out.refusalReasons.every(r => qualificationGaps.includes(r))) out.status = "candidate";
  if (out.saleResult !== "sold") out.refusalReasons.push("source_result_is_not_confirmed_sold");
  return out;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function okJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Existing extractor's private source reader. Admission/identity correction is
 * deliberately separate: a verified raw capture alone does not bind a vehicle,
 * establish currency/fees or supply a sale/settlement clock.
 */
async function previewMecumSourceResult(req: Request, supabase: any, body: any): Promise<Response> {
  const envelope = { action: "source_result_preview", stage: "private_retained_source_preview",
    writes: 0, model_calls: 0, qualified: false, publicShareable: false };
  const refuse = (reason: string, status = 200) => okJson({ ...envelope, success: false, reason }, status);
  const verdict = await authenticateWriter(req);
  if (!verdict.ok || verdict.caller.kind !== "service_role") return refuse("service_role_required", 403);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof body.snapshot_id !== "string" || !uuid.test(body.snapshot_id)
    || (body.dry_run !== undefined && body.dry_run !== true)
    || Object.keys(body).some(key => !["action", "snapshot_id", "dry_run"].includes(key))) {
    return refuse("provide_one_snapshot_uuid_for_read_only_preview", 400);
  }
  try {
    const id = body.snapshot_id.toLowerCase();
    const { data: snapshot, error } = await supabase.from("listing_page_snapshots")
      .select("id,platform,listing_url,success,http_status,html_sha256,fetched_at,created_at")
      .eq("id", id).maybeSingle();
    if (error) return refuse("source_header_read_failed", 503);
    if (!snapshot) return refuse("source_capture_missing");
    let source: URL;
    try { source = new URL(snapshot.listing_url); } catch { return refuse("source_capture_locator_unsupported"); }
    if (snapshot.id !== id || snapshot.platform !== "mecum" || snapshot.success !== true || snapshot.http_status !== 200) {
      return refuse("source_capture_not_successful_mecum");
    }
    if (!["https:", "http:"].includes(source.protocol) || source.username || source.password || source.port
      || !["mecum.com", "www.mecum.com"].includes(source.hostname)
      || !/^\/lots\/[^/%\s]+\/[^/%\s]+\/?$/.test(source.pathname)) {
      return refuse("source_capture_locator_unsupported");
    }
    if (typeof snapshot.html_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(snapshot.html_sha256)) {
      return refuse("source_hash_unestablished");
    }
    // Exact capture and original URL, with no alias/latest/fetch fallback. Skip
    // unrelated markdown. Raw body, storage path and metadata never enter output.
    const archived = await readArchivedPage(snapshot.listing_url, { platform: "mecum", snapshotId: id, htmlOnly: true });
    if (archived.snapshotId !== id || archived.fetchedAt !== snapshot.fetched_at) return refuse("source_capture_changed_or_unavailable");
    if (typeof archived.html !== "string" || !archived.html) return refuse("source_body_unavailable");
    const bytes = new TextEncoder().encode(archived.html);
    if (bytes.byteLength > 2097152) return refuse("source_body_over_limit");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== snapshot.html_sha256) return refuse("source_hash_conflict");
    return okJson({ ...envelope, success: true,
      snapshot: { id, sourceUrl: snapshot.listing_url, sourceSha256: hash,
        sourceCapturedAt: snapshot.fetched_at, sourceRecordedAt: snapshot.created_at, byteLength: bytes.byteLength },
      parentBinding: "not_evaluated", result: parseMecumSourceResultCandidate(archived.html) });
  } catch {
    return refuse("retained_source_read_failed", 503);
  }
}

interface MecumVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;
  mileage: number | null;
  mileage_source: string | null;
  description: string | null;
  highlights: string | null;
  lot_number: string | null;
  auction_name: string | null;
  auction_date: string | null;
  auction_day_start: string | null; // source auctionDayStart, "YYYY-MM-DD HH:MM:SS" (UTC)
  lot_statuses: string[]; // source lot status slugs, e.g. "no-reserve"
  sale_price: number | null;
  high_estimate: number | null;
  low_estimate: number | null;
  status: string | null;
  image_urls: string[];
  extraction_method: "next_data" | "markdown";
}

// ─── Parse description from blocks (HIGHLIGHTS + EQUIPMENT) ─────────────
// post.content is always empty on Mecum — description lives in Gutenberg blocks

function parseBlocksDescription(blocks: any[]): { description: string | null; engine: string | null } {
  const sections: { heading: string; items: string[] }[] = [];
  let specEngine: string | null = null;

  function stripHtml(s: string): string {
    return String(s)
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Flatten blocks recursively, tracking heading→item context
  function walk(blocks: any[], currentSection: string[] | null): void {
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const name = block.name || "";
      const attrs = block.attributes || {};
      const content = stripHtml(attrs.content || attrs.text || "");

      if (name === "core/heading") {
        if (content) {
          const heading = content.toUpperCase();
          sections.push({ heading, items: [] });
          currentSection = sections[sections.length - 1].items;

          // Detect SPECIFICATIONS ENGINE from label+value pairs
          if (heading === "SPECIFICATIONS") {
            // Engine will appear as a subsequent paragraph
          }
        }
      } else if (name === "core/list-item") {
        if (content && currentSection) {
          currentSection.push(content);
        }
      } else if (name === "core/paragraph" && content) {
        // In SPECIFICATIONS section, label+value pairs come as alternating paragraphs
        // We don't use these for description but note engine
      }

      if (Array.isArray(block.innerBlocks) && block.innerBlocks.length > 0) {
        walk(block.innerBlocks, currentSection);
      }
    }
  }

  walk(blocks, null);

  // Also extract engine from SPECIFICATIONS block label/value pairs
  // Pattern: paragraphs alternate "ENGINE" then "3.0L Inline 6-Cylinder"
  function extractSpecValue(blocks: any[], label: string): string | null {
    let foundLabel = false;
    const flat: string[] = [];
    function walkFlat(bs: any[]) {
      for (const b of bs) {
        if (!b || typeof b !== "object") continue;
        if (b.name === "core/paragraph") {
          const t = stripHtml(b.attributes?.content || "");
          if (t) flat.push(t);
        }
        if (Array.isArray(b.innerBlocks)) walkFlat(b.innerBlocks);
      }
    }
    walkFlat(blocks);
    for (let i = 0; i < flat.length - 1; i++) {
      if (flat[i].toUpperCase() === label.toUpperCase()) {
        return flat[i + 1] || null;
      }
    }
    return null;
  }

  specEngine = extractSpecValue(blocks, "ENGINE");

  const parts: string[] = [];
  const highlights = sections.find((s) => s.heading === "HIGHLIGHTS");
  const equipment = sections.find((s) => s.heading === "EQUIPMENT");

  if (highlights?.items.length) {
    parts.push(highlights.items.map((i) => `• ${i}`).join("\n"));
  }
  if (equipment?.items.length) {
    parts.push("Equipment:\n" + equipment.items.map((i) => `• ${i}`).join("\n"));
  }

  const combined = parts.join("\n\n").trim();
  return {
    description: combined.length > 30 ? combined.slice(0, 5000) : null,
    engine: specEngine,
  };
}

// ─── Title case helper ──────────────────────────────────────────────────

function titleCase(s: string): string {
  const preserveUpper = new Set([
    'BMW', 'AMG', 'GT', 'SS', 'RS', 'GTS', 'GTO', 'GTI', 'GTR',
    'SL', 'SLK', 'SLS', 'CLS', 'CLK', 'SUV', 'TDI', 'TSI',
    'V6', 'V8', 'V10', 'V12', 'I4', 'I6', 'W12', 'HP', 'CI',
    'AWD', 'FWD', 'RWD', '4WD', 'CVT', 'DSG', 'PDK', 'SC', 'SE',
    'LE', 'LT', 'LS', 'LTZ', 'SRT', 'TRD', 'SSR',
    'M3', 'M4', 'M5', 'M6', 'Z3', 'Z4', 'X3', 'X5', 'X6',
    'F1', 'F40', 'F50', 'II', 'III', 'IV', 'VI',
  ]);
  return s
    .split(/\s+/)
    .map(word => {
      const upper = word.toUpperCase();
      if (preserveUpper.has(upper)) return upper;
      if (/^[A-Z]\d+$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// ─── Taxonomy edge helper ───────────────────────────────────────────────

function getEdgeName(obj: any, taxonomyKey: string): string | null {
  const edges = obj?.[taxonomyKey]?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return null;
  return edges[0]?.node?.name ?? null;
}

// ─── Parse __NEXT_DATA__ JSON (preferred, zero-cost) ────────────────────

function parseNextData(html: string, url: string, flightPost: any = null): MecumVehicle | null {
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  let post: any = null;
  if (nextDataMatch?.[1]) {
    try {
      post = JSON.parse(nextDataMatch[1])?.props?.pageProps?.post;
    } catch {
      return null;
    }
  } else {
    // App-router pages (measured 2026-10-15) carry the same lot object in flight chunks; callers read it with
    // postFromFlight (rscPost.ts) and pass it in, which keeps this function free of imports.
    post = flightPost;
  }
  if (!post) return null;

  const vehicle: MecumVehicle = {
    url,
    title: post.title || null,
    year: null,
    make: null,
    model: null,
    vin: post.vinSerial || null,
    engine: post.lotSeries || null, // lotSeries contains engine/features like "348 CI, Air Ride"
    transmission: post.transmission || null,
    exterior_color: post.color || null,
    interior_color: post.interior || null,
    body_style: null,
    mileage: null,
    mileage_source: null,
    description: null,
    highlights: null,
    lot_number: post.lotNumber || null,
    auction_name: null,
    auction_date: null,
    auction_day_start: null,
    lot_statuses: [],
    sale_price: null,
    high_estimate: null,
    low_estimate: null,
    status: null,
    image_urls: [],
    extraction_method: "next_data",
  };

  // Year from taxonomy
  const yearStr = getEdgeName(post, "lotYears");
  if (yearStr) vehicle.year = parseInt(yearStr, 10) || null;

  // Make from taxonomy
  const makeStr = getEdgeName(post, "makes");
  if (makeStr) vehicle.make = makeStr;

  // Model from taxonomy
  const modelStr = getEdgeName(post, "models");
  if (modelStr) vehicle.model = modelStr;

  // Fallback: parse year/make/model from title "1960 Chevrolet Parkwood Wagon"
  if ((!vehicle.year || !vehicle.make) && post.title) {
    const titleMatch = post.title.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
    if (titleMatch) {
      if (!vehicle.year) vehicle.year = parseInt(titleMatch[1], 10);
      if (!vehicle.make) vehicle.make = titleMatch[2];
      if (!vehicle.model) vehicle.model = titleMatch[3];
    }
  }

  // Sale result from taxonomy
  const saleResult = getEdgeName(post, "saleResults");
  if (saleResult) {
    vehicle.status = saleResult.toLowerCase(); // "sold", "not sold", "upcoming"
  }

  // Hammer price
  if (post.hammerPrice) {
    const price = parseInt(String(post.hammerPrice).replace(/[,$ ]/g, ""), 10);
    if (price > 0) vehicle.sale_price = price;
  }

  // Estimates
  if (post.lowEstimate) {
    const low = parseInt(String(post.lowEstimate).replace(/[,$ ]/g, ""), 10);
    if (low > 0) vehicle.low_estimate = low;
  }
  if (post.highEstimate) {
    const high = parseInt(String(post.highEstimate).replace(/[,$ ]/g, ""), 10);
    if (high > 0) vehicle.high_estimate = high;
  }

  // Odometer
  if (post.odometer) {
    const miles = parseInt(String(post.odometer).replace(/[, ]/g, ""), 10);
    if (miles > 0 && miles < 10_000_000) {
      vehicle.mileage = miles;
      vehicle.mileage_source = "odometer_field";
    }
  }

  // Auction info from taxonomy
  const auctionEdges = post?.auctionsTax?.edges;
  if (Array.isArray(auctionEdges) && auctionEdges.length > 0) {
    const auctionNode = auctionEdges[0]?.node;
    vehicle.auction_name = auctionNode?.name || null;
  }

  // Run date
  const runDate = getEdgeName(post, "runDates");
  if (runDate) vehicle.auction_date = runDate;
  if (typeof post.auctionDayStart === "string") vehicle.auction_day_start = post.auctionDayStart;
  const statusEdges = post?.lotStatuses?.edges;
  if (Array.isArray(statusEdges)) {
    vehicle.lot_statuses = statusEdges.map((e: any) => e?.node?.slug).filter((x: unknown) => typeof x === "string");
  }

  // Division as body_style hint
  const division = getEdgeName(post, "divisionsTax");
  if (division && division !== "Collector Cars") {
    vehicle.body_style = division; // e.g., "Motorcycles", "Road Art", etc.
  }

  // Description from blocks (HIGHLIGHTS + EQUIPMENT list items)
  // post.content is always empty on Mecum — description lives in Gutenberg blocks
  if (Array.isArray(post.blocks) && post.blocks.length > 0) {
    const { description: blockDesc, engine: blockEngine } = parseBlocksDescription(post.blocks);
    if (blockDesc) vehicle.description = blockDesc;
    // Use block-parsed engine if lotSeries looks wrong (non-engine text)
    if (blockEngine && (!vehicle.engine || vehicle.engine.length > 60)) {
      vehicle.engine = blockEngine;
    }
  }

  // Fallback: post.content (usually empty but check anyway)
  if (!vehicle.description && post.content) {
    const stripped = String(post.content)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped.length > 30) {
      vehicle.description = stripped.slice(0, 5000);
    }
  }

  // Images
  if (Array.isArray(post.images)) {
    const seen = new Set<string>();
    for (const img of post.images) {
      const imgUrl = img?.url;
      if (!imgUrl || typeof imgUrl !== "string") continue;
      // Deduplicate by base filename
      const key = imgUrl.replace(/\?.*$/, ""); // Strip query params
      if (!seen.has(key)) {
        seen.add(key);
        vehicle.image_urls.push(imgUrl);
      }
    }
  }

  return vehicle;
}

// ─── Parse markdown (fallback when __NEXT_DATA__ not available) ─────────

function parseMarkdown(markdown: string, url: string): MecumVehicle {
  const vehicle: MecumVehicle = {
    url,
    title: null,
    year: null,
    make: null,
    model: null,
    vin: null,
    engine: null,
    transmission: null,
    exterior_color: null,
    interior_color: null,
    body_style: null,
    mileage: null,
    mileage_source: null,
    description: null,
    highlights: null,
    lot_number: null,
    auction_name: null,
    auction_date: null,
    auction_day_start: null,
    lot_statuses: [],
    sale_price: null,
    high_estimate: null,
    low_estimate: null,
    status: null,
    image_urls: [],
    extraction_method: "markdown",
  };

  // Title: "# 1964 Chevrolet Chevelle 300"
  const titleMatch = markdown.match(/^# (\d{4})\s+(.+)$/m);
  if (titleMatch) {
    vehicle.year = parseInt(titleMatch[1], 10);
    vehicle.title = titleMatch[0].replace('# ', '');
    const parts = titleMatch[2].trim().split(/\s+/);
    if (parts.length >= 1) vehicle.make = titleCase(parts[0]);
    if (parts.length >= 2) vehicle.model = titleCase(parts.slice(1).join(' '));
  }

  // Lot info: "Lot F109.8//Friday, January 15th//Kissimmee 2021"
  const lotMatch = markdown.match(/^Lot\s+([\w.]+)\/\/(.+?)\/\/(.+)$/m);
  if (lotMatch) {
    vehicle.lot_number = lotMatch[1];
    vehicle.auction_date = lotMatch[2].trim();
    vehicle.auction_name = lotMatch[3].trim();
  }

  // VIN: "VIN / Serial\n\n1G1AP877XCL133135"
  const vinMatch = markdown.match(/VIN\s*\/\s*Serial\s*\n\n([A-Z0-9]+)/i);
  if (vinMatch) vehicle.vin = vinMatch[1];

  // SPECIFICATIONS block — "ENGINE\n\n**350CI**"
  const specRegex = /^([A-Z][A-Z /]+?)\s*\n\n\*\*(.+?)\*\*/gm;
  const specs: Record<string, string> = {};
  let m;
  while ((m = specRegex.exec(markdown)) !== null) {
    specs[m[1].trim()] = m[2].trim();
  }

  if (specs['ENGINE']) vehicle.engine = specs['ENGINE'];
  if (specs['TRANSMISSION']) vehicle.transmission = titleCase(specs['TRANSMISSION']);
  if (specs['EXTERIOR COLOR']) vehicle.exterior_color = titleCase(specs['EXTERIOR COLOR']);
  if (specs['INTERIOR COLOR']) vehicle.interior_color = titleCase(specs['INTERIOR COLOR']);
  if (specs['BODY STYLE']) vehicle.body_style = titleCase(specs['BODY STYLE']);
  if (specs['MAKE']) vehicle.make = titleCase(specs['MAKE']);
  if (specs['MODEL']) vehicle.model = titleCase(specs['MODEL']);

  // Mileage
  const subtitleMileage = markdown.match(/^[^#\n].+?([\d,]+)\s*(?:actual\s+)?[Mm]iles/m);
  if (subtitleMileage) {
    const miles = parseInt(subtitleMileage[1].replace(/,/g, ''), 10);
    if (miles > 0 && miles < 1_000_000) {
      vehicle.mileage = miles;
      vehicle.mileage_source = "subtitle";
    }
  }
  if (!vehicle.mileage) {
    const highlightsMileage = markdown.match(/^- .*([\d,]+)\s*(?:actual\s+)?[Mm]iles/m);
    if (highlightsMileage) {
      const miles = parseInt(highlightsMileage[1].replace(/,/g, ''), 10);
      if (miles > 0 && miles < 1_000_000) {
        vehicle.mileage = miles;
        vehicle.mileage_source = "highlights";
      }
    }
  }

  // Sold status
  if (/!\[sold\]/i.test(markdown)) {
    vehicle.status = 'sold';
  } else if (/!\[bid goes live\]/i.test(markdown) || /!\[upcoming\]/i.test(markdown)) {
    vehicle.status = 'upcoming';
  }

  // HIGHLIGHTS
  const highlightsMatch = markdown.match(/## HIGHLIGHTS\s*\n\n((?:- .+\n?)+)/);
  if (highlightsMatch) vehicle.highlights = highlightsMatch[1].trim();

  // THE STORY (description)
  const storyMatch = markdown.match(/## THE STORY\s*\n\n([\s\S]+?)(?=\n\nInformation found on the website|$)/);
  if (storyMatch) {
    vehicle.description = storyMatch[1].trim().slice(0, 5000);
  } else if (vehicle.highlights) {
    vehicle.description = vehicle.highlights.slice(0, 5000);
  }

  // Images
  const imageSet = new Set<string>();
  const imgRegex = /https:\/\/(?:images|cdn\d?)\.mecum\.com\/[^)\s"]+\.(?:jpg|jpeg|png|webp)[^)\s"]*/gi;
  let imgM;
  while ((imgM = imgRegex.exec(markdown)) !== null) {
    const imgUrl = imgM[0];
    const key = imgUrl.replace(/\?.*$/, "");
    if (!imageSet.has(key)) {
      imageSet.add(key);
      vehicle.image_urls.push(imgUrl);
    }
  }

  return vehicle;
}

// ─── Fetch + parse (tries __NEXT_DATA__ first, falls back to markdown) ──

async function fetchAndParse(url: string, opts?: { skipFirecrawl?: boolean }): Promise<MecumVehicle> {
  // Step 0: Try archived snapshots first (any age) — "Fetch once, extract forever"
  // Query for the largest direct snapshot (most likely to have __NEXT_DATA__ with post data)
  const supabaseInner = (() => {
    const u = Deno.env.get("SUPABASE_URL") ?? "";
    const k = projectSecretKey() ?? "";
    return createClient(u, k, { auth: { persistSession: false } });
  })();
  const { data: bestSnapshot } = await supabaseInner
    .from("listing_page_snapshots")
    .select("id, html, html_storage_path")
    .eq("listing_url", url)
    .eq("success", true)
    .eq("fetch_method", "direct")
    .order("content_length", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bestSnapshot) {
    let archiveHtml = bestSnapshot.html;
    if (!archiveHtml && bestSnapshot.html_storage_path) {
      try {
        const { data: blob } = await supabaseInner.storage
          .from("listing-snapshots")
          .download(bestSnapshot.html_storage_path);
        if (blob) archiveHtml = await blob.text();
      } catch (_) {}
    }
    if (archiveHtml) {
      const fromArchive = parseNextData(archiveHtml, url, postFromFlight(archiveHtml));
      if (!fromArchive && archiveHtml.includes("404 - PAGE NOT FOUND")) throw new Error("PAGE_NOT_FOUND");
      if (fromArchive && fromArchive.year && fromArchive.make) {
        console.log(`[MECUM] Parsed via archived __NEXT_DATA__ (snapshot ${bestSnapshot.id}): ${fromArchive.year} ${fromArchive.make} ${fromArchive.model}`);
        return fromArchive;
      }
    }
  }

  // Step 1: Try direct HTTP fetch for __NEXT_DATA__ (free, no Firecrawl)
  const directResult = await archiveFetch(url, {
    platform: "mecum",
    useFirecrawl: false,
    callerName: "extract-mecum",
  });

  if (directResult.html) {
    // A 404 is the status code, or a page with no lot in it that shows the 404 template. Live lot pages (measured
    // 2026-10-15, /lots/1181445/) embed that template's text in their payload, so the text alone is not a 404.
    if (directResult.statusCode === 404) throw new Error("PAGE_NOT_FOUND");

    const fromJson = parseNextData(directResult.html, url, postFromFlight(directResult.html));
    if (!fromJson && directResult.html.includes("404 - PAGE NOT FOUND")) throw new Error("PAGE_NOT_FOUND");
    // A lot with no year and make in its title or taxonomy (neon signs, traffic lights, other automobilia) is not a vehicle.
    if (fromJson && !(fromJson.year && fromJson.make) && opts?.skipFirecrawl) throw new Error("NOT_A_VEHICLE");
    if (fromJson && fromJson.year && fromJson.make) {
      console.log(`[MECUM] Parsed via __NEXT_DATA__ (free): ${fromJson.year} ${fromJson.make} ${fromJson.model}`);
      return fromJson;
    }
  }

  // Step 2: Fallback to Firecrawl for JS-rendered content
  if (opts?.skipFirecrawl) {
    throw new Error("SKIP_NO_NEXT_DATA");
  }
  console.log(`[MECUM] __NEXT_DATA__ not found or insufficient, falling back to Firecrawl`);
  const fcResult = await archiveFetch(url, {
    platform: "mecum",
    useFirecrawl: true,
    includeMarkdown: true,
    waitForJs: 5000,
    callerName: "extract-mecum",
    forceRefresh: true, // Don't use the direct-fetch cache we just stored
  });

  if (fcResult.error && !fcResult.html && !fcResult.markdown) {
    throw new Error(`Fetch failed: ${fcResult.error}`);
  }

  // Try __NEXT_DATA__ from Firecrawl HTML too
  if (fcResult.html) {
    const fromJson = parseNextData(fcResult.html, url);
    if (fromJson && fromJson.year && fromJson.make) {
      console.log(`[MECUM] Parsed via __NEXT_DATA__ (Firecrawl HTML): ${fromJson.year} ${fromJson.make} ${fromJson.model}`);
      return fromJson;
    }
  }

  // Final fallback: markdown parsing
  if (fcResult.markdown) {
    if (fcResult.markdown.includes('404 - PAGE NOT FOUND') || fcResult.markdown.includes('no longer available')) {
      throw new Error("PAGE_NOT_FOUND");
    }

    const fromMd = parseMarkdown(fcResult.markdown, url);
    if (fromMd.year || fromMd.make) {
      console.log(`[MECUM] Parsed via markdown fallback: ${fromMd.year} ${fromMd.make} ${fromMd.model}`);
      return fromMd;
    }
  }

  throw new Error("Could not parse vehicle data from page");
}

// ─── Listing episode ────────────────────────────────────────────────────

/** One lot of a sale on Mecum's calendar, from its Algolia roster (enumerate_upcoming). */
interface UpcomingSale {
  sale_key: string; // auction_tax slug, e.g. "kissimmee-2027"; census by_category keys use the same string
  auction_name: string; // "Kissimmee 2027"
  sale_starts_on: string; // YYYY-MM-DD
  sale_ends_on: string;
  run_day: string | null; // YYYY-MM-DD
  lot_number: string | null;
  lot_statuses: string[];
  roster_first_seen_at: string;
}

const saleDay = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

/** The sale a facet value "Name|startEpoch|endEpoch" names. The slug comes from the hit's auction_tax term. */
function parseSaleFacet(value: string, slug: string): { sale_key: string; auction_name: string; sale_starts_on: string; sale_ends_on: string; end_epoch: number } | null {
  const [name, start, end] = value.split("|");
  const startEpoch = Number(start), endEpoch = Number(end);
  if (!name || !slug || !Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) return null;
  return { sale_key: slug, auction_name: name, sale_starts_on: saleDay(startEpoch), sale_ends_on: saleDay(endEpoch), end_epoch: endEpoch };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

async function writeMecumEpisode(supabase: any, vehicleId: string, vehicle: MecumVehicle, sale?: UpcomingSale) {
  const runDay = /^\d{4}-\d{2}-\d{2}$/.test(vehicle.auction_date ?? "") ? vehicle.auction_date! : (sale?.run_day ?? null);
  const hasResult = !!vehicle.status && !["upcoming", "listed"].includes(vehicle.status);
  // No result yet and the run day not past: the lot is upcoming. A past run day with no result stays "listed".
  const eventStatus = hasResult ? vehicle.status! : (runDay && runDay >= todayUtc() ? "upcoming" : (vehicle.status || "listed"));
  const dayStart = vehicle.auction_day_start && !isNaN(Date.parse(vehicle.auction_day_start.replace(" ", "T") + "Z"))
    ? new Date(vehicle.auction_day_start.replace(" ", "T") + "Z").toISOString() : null;
  // Run date is the sale date of an auction lot (ended_at); the result time is not published, so sold_at stays the run day.
  const runDayIso = runDay ? new Date(runDay + "T00:00:00Z").toISOString() : null;
  const lotStatuses = sale?.lot_statuses?.length ? sale.lot_statuses : vehicle.lot_statuses;
  const metadata: Record<string, unknown> = {
    source: "extract-mecum",
    title: vehicle.title,
    auction_date: vehicle.auction_date,
    auction_name: sale?.auction_name ?? vehicle.auction_name,
    auction_session_days: runDay ? [runDay] : [],
    lot_number: vehicle.lot_number ?? sale?.lot_number ?? null,
    currency: "USD",
    estimate_low: vehicle.low_estimate,
    estimate_high: vehicle.high_estimate,
  };
  if (lotStatuses.length) metadata.has_reserve = !lotStatuses.some((x) => /no-?reserve/i.test(x));
  if (sale) {
    Object.assign(metadata, {
      sale_key: sale.sale_key,
      sale_starts_on: sale.sale_starts_on,
      sale_ends_on: sale.sale_ends_on,
      roster_first_seen_at: sale.roster_first_seen_at,
    });
  }
  const listingId = vehicle.lot_number ?? sale?.lot_number ?? vehicle.url.match(/\/lots\/(\d+)/)?.[1] ?? null;
  const row = {
    vehicle_id: vehicleId,
    source_platform: "mecum",
    event_type: "auction",
    source_url: vehicle.url,
    source_listing_id: listingId,
    final_price: vehicle.sale_price,
    event_status: eventStatus,
    ended_at: dayStart ?? runDayIso,
    sold_at: hasResult ? runDayIso : null,
    metadata,
  };

  const { data: lives } = await supabase
    .from("vehicle_events")
    .select("id, metadata, sold_at, ended_at")
    .eq("vehicle_id", vehicleId)
    .eq("source_platform", "mecum")
    .in("source_url", mecumUrlSpellings(vehicle.url))
    .limit(1);
  const live = lives?.[0];
  if (live) {
    // The first roster sighting is kept across re-reads.
    if (live.metadata?.roster_first_seen_at) metadata.roster_first_seen_at = live.metadata.roster_first_seen_at;
    if (!row.final_price) delete (row as Record<string, unknown>).final_price;
    const { patch } = patchForLiveRow(live, row as any);
    delete patch.vehicle_id; delete patch.source_platform; delete patch.source_listing_id; delete patch.source_url;
    const { error } = await supabase.from("vehicle_events").update(patch).eq("id", live.id);
    if (error) console.warn(`[MECUM] event update failed for ${vehicle.url}: ${error.message}`);
    return;
  }
  const res = await writeVehicleEventByKey(supabase, row as any);
  if (res.action === "error" || res.action === "skipped") {
    console.warn(`[MECUM] vehicle_event not written for ${vehicle.url} (${res.action}): ${"error" in res ? res.error : res.reason}`);
  }
}

/** A VIN or serial as the source states it, or null for a placeholder (measured 2026-10-15: "BLLFSALE" is on a Scat Cat and a
 *  Sayers and Scovill hearse, two different vehicles). */
function realVin(vin: string | null): string | null {
  const v = (vin ?? "").trim();
  if (v.length < 5) return null;
  if (/^(bll?f?sale|bill\s*of\s*sale|none|n\/?a|no\s*vin|tbd|unknown|not\s*available|see\s*title)$/i.test(v)) return null;
  return v;
}

// ─── Save vehicle ───────────────────────────────────────────────────────

async function saveVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicle: MecumVehicle,
  forceVehicleId?: string,
  sale?: UpcomingSale,
): Promise<{ vehicleId: string; isNew: boolean; fieldsUpdated: string[]; qualityScore: number }> {
  // Check if vehicle already exists (by URL, queue, or VIN)
  const { data: byUrl } = await supabase
    .from("vehicles")
    .select("id")
    .in("discovery_url", mecumUrlSpellings(vehicle.url)) // existing vehicles store the lot URL in several spellings
    .limit(1)
    .maybeSingle();

  const { data: queueEntry } = await supabase
    .from("import_queue")
    .select("vehicle_id")
    .eq("listing_url", vehicle.url)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();

  let existingId = forceVehicleId || queueEntry?.vehicle_id || byUrl?.id;

  // Also check by VIN if we have one (prevents duplicate key violation)
  if (!existingId && realVin(vehicle.vin)) {
    const { data: byVin } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", realVin(vehicle.vin)!)
      .limit(1)
      .maybeSingle();
    if (byVin?.id) existingId = byVin.id;
  }

  const rawData: Record<string, unknown> = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: realVin(vehicle.vin) ? vehicle.vin : null,
    engine_type: vehicle.engine,
    transmission: vehicle.transmission,
    color: vehicle.exterior_color,
    interior_color: vehicle.interior_color,
    body_style: vehicle.body_style,
    mileage: vehicle.mileage,
    description: vehicle.description,
    // Sale rule (lock 1, 2026-09-27): Mecum's hammer price is the sale only when the result says
    // sold; on a "not sold" / "bid goes on" lot it is the high bid. The status travels with it
    // (nulls are stripped below, so an unknown result writes neither).
    sale_price: vehicle.status === "sold" ? vehicle.sale_price : null,
    high_bid: vehicle.status !== "sold" ? vehicle.sale_price : null,
    sale_status: vehicle.status === "sold" ? "sold" : (vehicle.status === "not sold" ? "not_sold" : null),
    auction_outcome: vehicle.status === "sold" ? "sold" : null,
    sale_date: vehicle.status === "sold" && vehicle.auction_date && /^\d{4}-\d{2}-\d{2}$/.test(vehicle.auction_date) ? vehicle.auction_date : null,
    discovery_url: vehicle.url,
    discovery_source: "mecum",
    listing_source: "mecum",
    source: "mecum",
    extractor_version: EXTRACTOR_VERSION,
  };

  // Clean fields (strip HTML, reject polluted values)
  const cleaned = cleanVehicleFields(rawData, { platform: "mecum" });

  // Quality gate
  const gate = qualityGate(cleaned as Record<string, any>, {
    source: "mecum",
    sourceType: "auction",
  });

  if (gate.action === "reject") {
    console.warn(`[MECUM] Quality gate REJECTED ${vehicle.url}: ${gate.issues.join(", ")}`);
    throw new Error(`Quality gate rejected (score=${gate.score}): ${gate.issues.slice(0, 3).join(", ")}`);
  }

  if (gate.action === "flag_for_review") {
    console.warn(`[MECUM] Quality gate FLAGGED ${vehicle.url} (score=${gate.score}): ${gate.issues.join(", ")}`);
  }

  // Build clean upsert payload (no nulls for updates)
  const cleanData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(gate.cleaned)) {
    if (v !== null && v !== undefined) cleanData[k] = v;
  }

  let vehicleId: string;
  let isNew = false;
  const fieldsUpdated: string[] = [];

  if (existingId) {
    const { data: existing } = await supabase
      .from("vehicles")
      .select("vin,mileage,color,description,transmission,body_style,engine_type,sale_price,interior_color")
      .eq("id", existingId)
      .maybeSingle();

    if (existing) {
      const trackFields = ["vin", "mileage", "color", "description", "transmission", "body_style", "engine_type", "sale_price", "interior_color"];
      for (const f of trackFields) {
        if (!(existing as any)[f] && cleanData[f]) fieldsUpdated.push(f);
      }
    }

    // Strip identity/source fields that should only be set on insert
    const { discovery_url: _du, discovery_source: _ds, source: _src, listing_source: _ls, ...updateData } = cleanData;

    const { error: updateErr } = await supabase.from("vehicles").update(updateData).eq("id", existingId);
    if (updateErr) {
      // VIN unique constraint violation: another vehicle already has this VIN.
      // Retry without VIN to still update other fields.
      if (updateErr.code === "23505" && updateErr.message?.includes("vin")) {
        console.warn(`[MECUM] VIN conflict for ${existingId} (vin=${cleanData.vin}), retrying without VIN`);
        const { vin: _skipVin, ...dataWithoutVin } = updateData;
        const { error: retryErr } = await supabase.from("vehicles").update(dataWithoutVin).eq("id", existingId);
        if (retryErr) {
          console.error(`[MECUM] Retry update failed for ${existingId}: ${retryErr.message}`);
          throw new Error(`Vehicle update failed: ${retryErr.message}`);
        }
      } else {
        console.error(`[MECUM] Vehicle update failed for ${existingId}: ${updateErr.message} (${updateErr.code})`);
        throw new Error(`Vehicle update failed: ${updateErr.message}`);
      }
    }
    vehicleId = existingId;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("vehicles")
      .insert({ ...cleanData, status: "active" })
      .select("id")
      .maybeSingle();

    if (insertErr) throw new Error(`Vehicle insert failed: ${insertErr.message} (${insertErr.code})`);
    vehicleId = inserted.id;
    isNew = true;
  }

  // Fire-and-forget observation write
  {
    const obsFields: Record<string, any> = {};
    const skipKeys = new Set(["discovery_url", "discovery_source", "source", "listing_source", "profile_origin", "status", "is_public", "origin_metadata"]);
    for (const [k, v] of Object.entries(cleanData)) {
      if (v != null && !skipKeys.has(k)) obsFields[k] = v;
    }
    writeObservation(supabase, {
      vehicleId,
      source: { platform: "mecum", url: vehicle.url || "", trustScore: 0.8 },
      fields: obsFields,
      observationKind: vehicle.sale_price ? "sale_result" : "listing",
      extractionMethod: "next_data_json_parse",
    }).catch((e: any) => console.warn(`[MECUM] observationWriter error for ${vehicleId}: ${e?.message}`));
  }

  // Save images (batch insert, skip existing)
  if (vehicle.image_urls.length > 0) {
    const imageLimit = Math.min(vehicle.image_urls.length, 80);
    // One read and one insert for the lot (this was a select and an insert per image: about 150 requests a lot).
    const { data: have } = await supabase.from("vehicle_images").select("image_url").eq("vehicle_id", vehicleId).limit(500);
    const haveUrls = new Set((have ?? []).map((r: { image_url: string }) => r.image_url));
    const fresh = vehicle.image_urls.slice(0, imageLimit)
      .map((imgUrl, idx) => ({ vehicle_id: vehicleId, image_url: imgUrl, source: "external_import", source_url: imgUrl, is_external: true, position: idx }))
      .filter((row) => !haveUrls.has(row.image_url));
    if (fresh.length) {
      const { error: imgErr } = await supabase.from("vehicle_images").insert(fresh);
      if (imgErr) console.warn(`[MECUM] image insert failed for ${vehicleId}: ${imgErr.message}`);
    }
  }

  // The listing episode (vehicle_events is a state table, rows are updated in place; see vehicleEventWrite.ts). An
  // episode already stored under another spelling of the URL is updated, not duplicated.
  await writeMecumEpisode(supabase, vehicleId, vehicle, sale);

  // Create auction event
  const { data: existingEvent } = await supabase
    .from("auction_events")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("source", "mecum")
    .eq("source_url", vehicle.url)
    .limit(1)
    .maybeSingle();

  if (!existingEvent) {
    try {
      await supabase.from("auction_events").insert({
        vehicle_id: vehicleId,
        source: "mecum",
        source_url: vehicle.url,
        outcome: vehicle.status || "listed",
        lot_number: vehicle.lot_number || null,
        sale_price: vehicle.sale_price || null,
      });
    } catch { /* non-fatal */ }
  }

  return { vehicleId, isNew, fieldsUpdated, qualityScore: gate.score };
}

// Existing mecum events spell one lot several ways (measured 2026-10-15: with and without www, with and without the
// trailing slash, and a /sitemap.xml suffix), so a target is landed if any spelling has an event.
function mecumLotKey(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/(sitemap\.xml)?\/?$/, "");
}
function mecumUrlSpellings(url: string): string[] {
  const bare = mecumLotKey(url);
  return [`https://www.${bare}`, `https://www.${bare}/`, `https://${bare}`, `https://${bare}/`, `https://www.${bare}/sitemap.xml`];
}

// ─── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      projectSecretKey() ?? "",
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "extract";
    const url = body.url as string | undefined;

    if (action === "source_result_preview") return await previewMecumSourceResult(req, supabase, body);

    // ── Single URL extraction ─────────────────────────────────────────
    if (action === "extract" && url) {
      if (!url.includes("mecum.com")) {
        return okJson({ success: false, error: "Not a Mecum URL" }, 400);
      }

      console.log(`[MECUM] Extracting: ${url}`);

      try {
        var vehicle = await fetchAndParse(url);
      } catch (e: any) {
        if (e.message === "PAGE_NOT_FOUND") {
          return okJson({ success: false, error: "Page not found (404 or removed)" }, 410);
        }
        throw e;
      }

      if (!vehicle.year && !vehicle.make) {
        return okJson({ success: false, error: "Could not parse vehicle data from page" }, 422);
      }

      console.log(
        `[MECUM] Parsed: ${vehicle.year} ${vehicle.make} ${vehicle.model}, ` +
          `vin=${vehicle.vin}, mileage=${vehicle.mileage}, sale=$${vehicle.sale_price}, ` +
          `${vehicle.image_urls.length} images, method=${vehicle.extraction_method}`,
      );

      const { vehicleId, isNew, fieldsUpdated, qualityScore } = await saveVehicle(supabase, vehicle);

      // Update queue entry if exists
      await supabase
        .from("import_queue")
        .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
        .eq("listing_url", url);

      return okJson({
        success: true,
        vehicle_id: vehicleId,
        is_new: isNew,
        quality_score: qualityScore,
        extraction_method: vehicle.extraction_method,
        fields_updated: fieldsUpdated,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          mileage: vehicle.mileage,
          sale_price: vehicle.sale_price,
          description: vehicle.description ? `${vehicle.description.length} chars` : null,
          images: vehicle.image_urls.length,
          auction: vehicle.auction_name,
          status: vehicle.status,
        },
      });
    }

    // ── Queue re-reads of sales claimed by the orphan backfill ──────────────────────────────────
    // vehicle_events rows with extraction_method orphan-backfill-v1 and event_status sold were written from snapshot run
    // dates (Dec-Feb), not from a read of the lot's result. Each is queued (REVERIFY_TAG, priority 50, after the upcoming
    // roster) so batch_from_targets re-reads the lot page and proves or refuses the sale. Cursor: the last queued event id.
    if (action === "enqueue_reverify") {
      const n = Math.min(Math.max(Math.floor(Number(body.limit)) || 300, 1), 500);
      const { data: last } = await supabase.from("import_queue").select("raw_data").eq("extractor_version", REVERIFY_TAG).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const after = String(body.after_id || last?.raw_data?.event_id || "00000000-0000-0000-0000-000000000000");
      const { data: evs, error: evErr } = await supabase
        .from("vehicle_events")
        .select("id, source_url, final_price, sold_at")
        .eq("source_platform", "mecum")
        .eq("extraction_method", "orphan-backfill-v1")
        .eq("event_status", "sold")
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(n);
      if (evErr) throw evErr;
      let queued = 0, requeued = 0, lastId = after;
      for (const ev of evs ?? []) {
        lastId = ev.id;
        const url = `https://www.${mecumLotKey(ev.source_url)}/`;
        const raw = { event_id: ev.id, claim: { final_price: ev.final_price, sold_at: ev.sold_at } };
        const { data: row } = await supabase.from("import_queue").select("id, status").eq("listing_url", url).maybeSingle();
        if (row) {
          if (row.status === "processing") continue;
          await supabase.from("import_queue").update({ status: "pending", priority: 50, extractor_version: REVERIFY_TAG, locked_by: "extract-mecum:reverify", raw_data: raw, error_message: null }).eq("id", row.id);
          requeued++;
        } else {
          const { error } = await supabase.from("import_queue").insert({ listing_url: url, status: "pending", priority: 50, extractor_version: REVERIFY_TAG, locked_by: "extract-mecum:reverify", raw_data: raw });
          if (!error) queued++;
        }
      }
      return okJson({ success: true, examined: evs?.length ?? 0, queued, requeued, last_event_id: lastId });
    }

    // ── Re-fold retained page snapshots into vehicles (zero requests to Mecum) ──────────────────
    // listing_page_snapshots holds Mecum lot pages from older writers (platform mecum, success). This reads up to `limit`
    // (max 100) of them in id order from the last folded one, skips a lot that already has an event under any URL spelling
    // or an import_queue row, parses the stored page with the same parser the live path uses, and saves it through
    // saveVehicle (vehicle, observation, photos, event). Each snapshot folded gets an import_queue row (REFOLD_TAG,
    // raw_data.snapshot_id), which is also the cursor. Not scheduled; run by hand or by a cron someone adds.
    if (action === "refold_snapshots") {
      const n = Math.min(Math.max(Math.floor(Number(body.limit)) || 50, 1), 100);
      const budgetMs = 100_000;
      const started = Date.now();
      const { data: last } = await supabase.from("import_queue").select("raw_data").eq("extractor_version", REFOLD_TAG).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const after = String(body.after_id || last?.raw_data?.snapshot_id || "00000000-0000-0000-0000-000000000000");
      const { data: snaps, error: sErr } = await supabase
        .from("listing_page_snapshots")
        .select("id, listing_url, html_storage_path")
        .eq("platform", "mecum")
        .eq("success", true)
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(n);
      if (sErr) throw sErr;
      const out = { examined: snaps?.length ?? 0, already_landed: 0, folded: 0, created: 0, updated: 0, not_a_vehicle: 0, unreadable: 0, failed: 0, last_snapshot_id: after, stopped: null as string | null, errors: [] as string[] };
      const urls = (snaps ?? []).map((x: any) => x.listing_url);
      const landedKeys = new Set<string>();
      for (let i = 0; i < urls.length; i += 25) {
        const chunk = urls.slice(i, i + 25);
        const { data: ev, error: eErr } = await supabase.from("vehicle_events").select("source_url").eq("source_platform", "mecum").in("source_url", chunk.flatMap(mecumUrlSpellings));
        if (eErr) throw new Error(`landed lookup failed: ${eErr.message}`);
        for (const r of ev ?? []) landedKeys.add(mecumLotKey(r.source_url));
      }
      for (const snap of snaps ?? []) {
        if (Date.now() - started > budgetMs) { out.stopped = "time_budget"; break; }
        out.last_snapshot_id = snap.id;
        if (landedKeys.has(mecumLotKey(snap.listing_url))) { out.already_landed++; continue; }
        const { data: row, error: claimErr } = await supabase
          .from("import_queue")
          .insert({ listing_url: snap.listing_url, status: "processing", extractor_version: REFOLD_TAG, locked_by: "extract-mecum:refold", raw_data: { snapshot_id: snap.id } })
          .select("id")
          .single();
        if (claimErr || !row) continue; // the URL already has a queue row (another path owns it)
        try {
          let html: string | null = null;
          if (snap.html_storage_path) {
            const { data: blob } = await supabase.storage.from("listing-snapshots").download(snap.html_storage_path);
            if (blob) html = await blob.text();
          }
          if (!html) {
            const { data: inline } = await supabase.from("listing_page_snapshots").select("html").eq("id", snap.id).maybeSingle();
            html = inline?.html ?? null;
          }
          if (!html) { out.unreadable++; await supabase.from("import_queue").update({ status: "failed", error_message: "snapshot body unreadable" }).eq("id", row.id); continue; }
          const vehicle = parseNextData(html, snap.listing_url, postFromFlight(html));
          if (!vehicle) { out.unreadable++; await supabase.from("import_queue").update({ status: "failed", error_message: "snapshot has no lot object" }).eq("id", row.id); continue; }
          if (!(vehicle.year && vehicle.make)) { out.not_a_vehicle++; await supabase.from("import_queue").update({ status: "skipped", error_message: "NOT_A_VEHICLE" }).eq("id", row.id); continue; }
          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);
          await supabase.from("import_queue").update({ status: "complete", vehicle_id: vehicleId, processed_at: new Date().toISOString() }).eq("id", row.id);
          out.folded++;
          if (isNew) out.created++; else out.updated++;
        } catch (err: any) {
          out.failed++;
          if (out.errors.length < 5) out.errors.push(`${snap.listing_url}: ${String(err?.message || err).slice(0, 200)}`);
          await supabase.from("import_queue").update({ status: "failed", error_message: String(err?.message || err).slice(0, 500) }).eq("id", row.id);
        }
      }
      return okJson({ ...out, success: true });
    }

    // ── Enumerate the calendar: upcoming lots from Mecum's public search index ──────────────────
    // Reads the index Mecum's own site search uses (Algolia app U6CFCQ7V52, index wp_posts_lot; the search-only key is the
    // one the site ships and scripts/mecum-algolia-discovery.mjs already carries). Sales are the facet values
    // "Name|startEpoch|endEpoch" of taxonomies.auction_tax.name with end >= now. Each lot becomes an import_queue row
    // tagged UPCOMING_TAG (priority 100, so batch_from_targets lands it before the sitemap walk) carrying its sale.
    // Re-reads are scheduled here: weekly inside 30 days of the run day, daily inside 7, and once the day after.
    // A lot that leaves the roster before its run day gets metadata.withdrawn_at on its event. One source_census row per
    // run records the stated size of every sale, keyed by the same sale_key the events carry.
    if (action === "enumerate_upcoming") {
      const startedAt = new Date();
      const nowEpoch = Math.floor(startedAt.getTime() / 1000);
      const facetRes = await algolia("hitsPerPage=0&facets=" + encodeURIComponent('["taxonomies.auction_tax.name"]') + "&maxValuesPerFacet=1000");
      const facet: Record<string, number> = facetRes.facets?.["taxonomies.auction_tax.name"] ?? {};
      const sales = Object.entries(facet)
        .map(([value, count]) => ({ value, count, end: Number(value.split("|")[2]) }))
        .filter((x) => Number.isFinite(x.end) && x.end >= nowEpoch);
      const census: Record<string, number> = {};
      const salesMeta: Record<string, { name: string; starts_on: string; ends_on: string }> = {};
      const seen = new Set<string>();
      const report: Record<string, { stated: number; read: number; queued: number; requeued: number }> = {};

      for (const sale of sales) {
        const runDays = Object.keys(
          (await algolia(`hitsPerPage=0&filters=${encodeURIComponent(`taxonomies.auction_tax.name:"${sale.value}"`)}&facets=${encodeURIComponent('["taxonomies.run_date.name"]')}`))
            .facets?.["taxonomies.run_date.name"] ?? {},
        );
        let key: string | null = null;
        const stat = { stated: sale.count, read: 0, queued: 0, requeued: 0 };
        for (const day of runDays.length ? runDays : [null]) {
          const filters = `taxonomies.auction_tax.name:"${sale.value}"` + (day ? ` AND taxonomies.run_date.name:"${day}"` : "");
          const res = await algolia(`hitsPerPage=1000&filters=${encodeURIComponent(filters)}&attributesToRetrieve=${encodeURIComponent('["permalink","lot_number_meta","auction_day_start_meta","taxonomies"]')}&attributesToHighlight=[]&attributesToSnippet=[]`);
          if ((res.nbHits ?? 0) > 1000) console.warn(`[MECUM] ${sale.value} ${day}: ${res.nbHits} lots, only 1000 readable`);
          const infos: { url: string; roadArt: boolean; info: UpcomingSale }[] = [];
          for (const hit of res.hits ?? []) {
            const term = hit.taxonomies?.auction_tax?.[0];
            const parsed = term ? parseSaleFacet(sale.value, term.slug) : null;
            if (!parsed || !hit.permalink) continue;
            key = parsed.sale_key;
            salesMeta[key] = { name: parsed.auction_name, starts_on: parsed.sale_starts_on, ends_on: parsed.sale_ends_on };
            const url = `https://www.mecum.com${hit.permalink}`;
            seen.add(url);
            stat.read++;
            infos.push({
              url,
              roadArt: (hit.taxonomies?.division_tax ?? []).some((x: any) => x.name === "Road Art"),
              info: {
                sale_key: parsed.sale_key,
                auction_name: parsed.auction_name,
                sale_starts_on: parsed.sale_starts_on,
                sale_ends_on: parsed.sale_ends_on,
                run_day: hit.taxonomies?.run_date?.[0]?.name ?? day,
                lot_number: hit.lot_number_meta ?? null,
                lot_statuses: (hit.taxonomies?.lot_status ?? []).map((x: any) => x.slug).filter(Boolean),
                roster_first_seen_at: startedAt.toISOString(),
              },
            });
          }
          // locked_by is set on every row this writes: the table's insert trigger posts any pending, unlocked row to
          // continuous-queue-processor (which would run extract-mecum without the free-path limit), and this job lands
          // its own lots. The pool query below reads status, not locked_by.
          for (let i = 0; i < infos.length; i += 100) {
            const chunk = infos.slice(i, i + 100);
            const { data: existing, error: exErr } = await supabase.from("import_queue").select("id, listing_url, status, processed_at, raw_data, locked_by").in("listing_url", chunk.map((c) => c.url));
            if (exErr) throw new Error(`roster lookup failed: ${exErr.message}`);
            const byUrl = new Map((existing ?? []).map((r: any) => [r.listing_url, r]));
            // Road Art is Mecum's automobilia division (signs, pumps, clocks): not vehicles, so not landed or fetched.
            const fresh = chunk.filter((c) => !byUrl.has(c.url)).map((c) => ({
              listing_url: c.url, status: c.roadArt ? "skipped" : "pending", error_message: c.roadArt ? "NOT_A_VEHICLE" : null, priority: 100, extractor_version: UPCOMING_TAG, locked_by: "extract-mecum:upcoming", raw_data: { sale: c.info, road_art: c.roadArt },
            }));
            if (fresh.length) {
              const { error } = await supabase.from("import_queue").insert(fresh);
              if (error) throw new Error(`roster insert failed: ${error.message}`);
              stat.queued += fresh.length;
            }
            for (const c of chunk) {
              const row: any = byUrl.get(c.url);
              if (!row) continue;
              const first = row.raw_data?.sale?.roster_first_seen_at ?? c.info.roster_first_seen_at;
              const daysToRun = c.info.run_day ? (Date.parse(c.info.run_day) - Date.parse(todayUtc())) / 86400000 : 99;
              const ageH = row.processed_at ? (Date.now() - Date.parse(row.processed_at)) / 3600000 : 1e9;
              if (c.roadArt) {
                if (row.status === "pending" || row.status === "failed") await supabase.from("import_queue").update({ status: "skipped", error_message: "NOT_A_VEHICLE", locked_by: "extract-mecum:upcoming", raw_data: { ...(row.raw_data ?? {}), sale: c.info, road_art: true } }).eq("id", row.id);
                continue;
              }
              const due = !row.raw_data?.sale || (daysToRun <= 7 && ageH >= 24) || (daysToRun <= 30 && ageH >= 168);
              const was = row.raw_data?.sale;
              const same = was && row.locked_by === "extract-mecum:upcoming" && row.status !== "skipped"
                && was.sale_key === c.info.sale_key && was.run_day === c.info.run_day && was.lot_number === c.info.lot_number
                && JSON.stringify(was.lot_statuses) === JSON.stringify(c.info.lot_statuses);
              if (same && !due) continue; // nothing to write; one update per lot made the roster read outrun the function limit
              const patch: Record<string, unknown> = { priority: 100, extractor_version: UPCOMING_TAG, locked_by: "extract-mecum:upcoming", raw_data: { ...(row.raw_data ?? {}), sale: { ...c.info, roster_first_seen_at: first } } };
              if (due && row.status !== "processing") { patch.status = "pending"; stat.requeued++; }
              await supabase.from("import_queue").update(patch).eq("id", row.id);
            }
          }
        }
        if (key) { census[key] = sale.count; report[key] = stat; }
      }

      // Withdrawn: queued for a sale in this read, run day not yet past, absent from the roster now.
      let withdrawn = 0;
      const saleKeys = Object.keys(census);
      if (saleKeys.length) {
        const { data: queued } = await supabase.from("import_queue").select("listing_url, vehicle_id, raw_data").eq("extractor_version", UPCOMING_TAG).not("vehicle_id", "is", null).limit(5000);
        for (const r of queued ?? []) {
          const sale = r.raw_data?.sale;
          if (!sale || !saleKeys.includes(sale.sale_key) || seen.has(r.listing_url)) continue;
          if (!sale.run_day || sale.run_day < todayUtc()) continue;
          const { data: ev } = await supabase.from("vehicle_events").select("id, metadata").eq("vehicle_id", r.vehicle_id).eq("source_platform", "mecum").in("source_url", mecumUrlSpellings(r.listing_url)).limit(1);
          if (ev?.[0] && !ev[0].metadata?.withdrawn_at) {
            await supabase.from("vehicle_events").update({ metadata: { ...ev[0].metadata, withdrawn_at: startedAt.toISOString() } }).eq("id", ev[0].id);
            withdrawn++;
          }
        }
      }

      // The day after a run day: read the result once.
      const { data: pastRows } = await supabase.from("import_queue").select("id, raw_data").eq("extractor_version", UPCOMING_TAG).eq("status", "complete").limit(5000);
      let resultsDue = 0;
      for (const r of pastRows ?? []) {
        const sale = r.raw_data?.sale;
        if (sale?.run_day && sale.run_day < todayUtc() && !r.raw_data?.result_read) {
          await supabase.from("import_queue").update({ status: "pending" }).eq("id", r.id);
          resultsDue++;
        }
      }

      let censusWritten = false;
      if (Object.keys(census).length) {
        const { data: src } = await supabase.from("observation_sources").select("id").eq("slug", "mecum").maybeSingle();
        if (src?.id) {
          const { error } = await supabase.from("source_census").insert({
            source_id: src.id,
            universe_total: Object.values(census).reduce((a, b) => a + b, 0),
            universe_active: Object.values(census).reduce((a, b) => a + b, 0),
            census_method: "house_roster_facet",
            census_confidence: 0.9,
            census_at: startedAt.toISOString(),
            census_url: `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`,
            census_notes: `Algolia index ${ALGOLIA_INDEX}, facet taxonomies.auction_tax.name, sales with end >= read time; by_category keys are the auction_tax slug (events' metadata.sale_key).`,
            by_category: census,
            raw_response: { sales: Object.fromEntries(Object.keys(census).map((k) => [k, salesMeta[k]])) },
          });
          censusWritten = !error;
          if (error) console.warn(`[MECUM] census not written: ${error.message}`);
        }
      }
      return okJson({ success: true, sales: report, census, withdrawn, results_due: resultsDue, census_written: censusWritten });
    }

    // ── Land lots: upcoming roster first, then the sitemap targets (free path: direct fetch only, throttled) ──
    // Pool 1 is the import_queue rows tagged UPCOMING_TAG and pending (priority 100). Pool 2 walks source_targets for
    // mecum in id order; a target is skipped if it already has a vehicle_event (under any URL spelling) or an
    // import_queue row. Each target tried gets an import_queue row (TARGETS_TAG, raw_data.target_id), which is also the
    // cursor. Never calls Firecrawl. Stops at `limit` lots, at the time budget, after 3 failures in a row, and at once on a
    // 403/429. delay_ms floors at 2000 (one request per 2 s at most; robots.txt asks for 1).
    if (action === "batch_from_targets") {
      const limit = Math.min(Math.max(Math.floor(Number(body.limit)) || 20, 1), 40);
      const delayMs = Math.max(Math.floor(Number(body.delay_ms)) || 2000, 2000);
      const budgetMs = 100_000;
      const started = Date.now();

      type Work = { url: string; rowId?: string; targetId?: number; sale?: UpcomingSale; reverify?: { event_id: string; claim: Record<string, unknown> } };
      const work: Work[] = [];

      const { data: up } = await supabase
        .from("import_queue")
        .select("id, listing_url, raw_data, extractor_version")
        .in("extractor_version", [UPCOMING_TAG, REVERIFY_TAG, TARGETS_TAG]) // pending TARGETS_TAG rows are re-reads of lots wrongly marked 404
        .eq("status", "pending")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(limit);
      for (const r of up ?? []) work.push({ url: r.listing_url, rowId: r.id, sale: r.raw_data?.sale, reverify: r.extractor_version === REVERIFY_TAG ? r.raw_data : undefined });

      let cursor = 0;
      if (work.length < limit && body.upcoming_only !== true) {
        const { data: last } = await supabase
          .from("import_queue")
          .select("raw_data")
          .eq("extractor_version", TARGETS_TAG)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        cursor = Number(body.after_id) || Number(last?.raw_data?.target_id) || 0;
        const want = limit - work.length;
        const picked: { id: number; listing_url: string }[] = [];
        for (let page = 0; page < 20 && picked.length < want; page++) {
          const { data: targets, error: tErr } = await supabase
            .from("source_targets")
            .select("id, listing_url")
            .eq("source_slug", "mecum")
            .gt("id", cursor)
            .order("id", { ascending: true })
            .limit(200);
          if (tErr) throw tErr;
          if (!targets?.length) break;
          cursor = targets[targets.length - 1].id;
          const urls = targets.map((t: { listing_url: string }) => t.listing_url);
          // 25 targets x 5 spellings keeps each request line near 11 KB; a longer line is refused, and an unread answer must
          // never count as "nothing landed" (the first scheduled runs added second events that way).
          const queuedUrls = new Set<string>();
          const landedKeys = new Set<string>();
          for (let i = 0; i < urls.length; i += 25) {
            const chunk = urls.slice(i, i + 25);
            const [q, e] = await Promise.all([
              supabase.from("import_queue").select("listing_url").in("listing_url", chunk),
              supabase.from("vehicle_events").select("source_url").eq("source_platform", "mecum").in("source_url", chunk.flatMap(mecumUrlSpellings)),
            ]);
            if (q.error || e.error) throw new Error(`landed lookup failed: ${(q.error || e.error)?.message}`);
            for (const r of q.data ?? []) queuedUrls.add(r.listing_url);
            for (const r of e.data ?? []) landedKeys.add(mecumLotKey(r.source_url));
          }
          for (const t of targets) {
            if (!queuedUrls.has(t.listing_url) && !landedKeys.has(mecumLotKey(t.listing_url)) && picked.length < want) picked.push(t);
          }
        }
        for (const t of picked) work.push({ url: t.listing_url, targetId: t.id });
      }

      const results = { picked: work.length, upcoming: 0, reverified: 0, confirmed: 0, landed: 0, created: 0, updated: 0, gone: 0, failed: 0, stopped: null as string | null, errors: [] as string[] };
      let consecutiveFailures = 0;
      for (const w of work) {
        if (Date.now() - started > budgetMs) { results.stopped = "time_budget"; break; }
        let rowId = w.rowId;
        if (rowId) {
          const { data: won } = await supabase.from("import_queue").update({ status: "processing", locked_at: new Date().toISOString() }).eq("id", rowId).eq("status", "pending").select("id");
          if (!won?.length) continue; // another run holds this lot
        } else {
          const { data: row, error: claimErr } = await supabase
            .from("import_queue")
            .insert({ listing_url: w.url, status: "processing", extractor_version: TARGETS_TAG, raw_data: { target_id: w.targetId }, locked_at: new Date().toISOString() })
            .select("id")
            .single();
          if (claimErr || !row) continue; // another run holds this target
          rowId = row.id;
        }
        try {
          const vehicle = await fetchAndParse(w.url, { skipFirecrawl: true });
          if (!vehicle.year && !vehicle.make) throw new Error("Could not parse vehicle data");
          if (w.reverify?.event_id) {
            // Keep the backfill's claim on the event before the page's result replaces its state.
            const { data: ev } = await supabase.from("vehicle_events").select("metadata").eq("id", w.reverify.event_id).maybeSingle();
            if (ev && !ev.metadata?.orphan_claim) {
              await supabase.from("vehicle_events").update({ metadata: { ...(ev.metadata ?? {}), orphan_claim: { event_status: "sold", ...w.reverify.claim } } }).eq("id", w.reverify.event_id);
            }
          }
          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle, undefined, w.sale);
          if (w.reverify?.event_id) {
            const confirmed = vehicle.status === "sold" && !!vehicle.sale_price;
            const { data: ev } = await supabase.from("vehicle_events").select("metadata").eq("id", w.reverify.event_id).maybeSingle();
            await supabase.from("vehicle_events").update({
              metadata: { ...(ev?.metadata ?? {}), sale_reverified: confirmed ? "confirmed" : "refused", reverified_at: new Date().toISOString(), reverified_result: vehicle.status ?? null },
            }).eq("id", w.reverify.event_id);
            results.reverified++;
            if (confirmed) results.confirmed++;
          }
          const done: Record<string, unknown> = { status: "complete", vehicle_id: vehicleId, processed_at: new Date().toISOString(), error_message: null };
          if (w.sale) {
            const resultRead = !!vehicle.status && !["upcoming", "listed"].includes(vehicle.status);
            done.raw_data = { sale: w.sale, ...(resultRead ? { result_read: true } : {}) };
            results.upcoming++;
          }
          await supabase.from("import_queue").update(done).eq("id", rowId);
          results.landed++;
          if (isNew) results.created++; else results.updated++;
          consecutiveFailures = 0;
        } catch (err: any) {
          const msg = String(err?.message || err);
          const gone = msg === "PAGE_NOT_FOUND" || msg === "NOT_A_VEHICLE";
          await supabase.from("import_queue").update({ status: gone ? "skipped" : "failed", error_message: msg.slice(0, 500), processed_at: new Date().toISOString() }).eq("id", rowId);
          if (gone) { results.gone++; consecutiveFailures = 0; }
          else {
            results.failed++;
            consecutiveFailures++;
            if (results.errors.length < 5) results.errors.push(`${w.url}: ${msg.slice(0, 200)}`);
            if (/\b(403|429)\b/.test(msg)) { results.stopped = "blocked_by_source"; break; }
            if (consecutiveFailures >= 3) { results.stopped = "3_failures_in_a_row"; break; }
          }
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return okJson({ ...results, success: true, cursor });
    }

    // ── Batch from queue ──────────────────────────────────────────────
    if (action === "batch_from_queue") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 10,
        50,
      );

      const { data: items, error: claimErr } = await supabase
        .from("import_queue")
        .select("id, listing_url")
        .eq("status", "pending")
        .like("listing_url", "%mecum.com%")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (claimErr) throw claimErr;
      if (!items?.length) {
        return okJson({ success: true, message: "No Mecum items in queue", processed: 0 });
      }

      const ids = items.map((i: { id: string }) => i.id);
      await supabase
        .from("import_queue")
        .update({ status: "processing", locked_at: new Date().toISOString() })
        .in("id", ids);

      const results = {
        total: items.length,
        success: 0,
        failed: 0,
        created: 0,
        updated: 0,
        next_data_used: 0,
        markdown_fallback: 0,
        errors: [] as string[],
      };

      for (const item of items) {
        try {
          const vehicle = await fetchAndParse(item.listing_url);

          if (!vehicle.year && !vehicle.make) {
            await supabase
              .from("import_queue")
              .update({ status: "failed", error_message: "Could not parse vehicle data", attempts: 1 })
              .eq("id", item.id);
            results.failed++;
            continue;
          }

          const { vehicleId, isNew } = await saveVehicle(supabase, vehicle);

          await supabase
            .from("import_queue")
            .update({ status: "complete", vehicle_id: vehicleId, error_message: null })
            .eq("id", item.id);

          results.success++;
          if (isNew) results.created++;
          else results.updated++;
          if (vehicle.extraction_method === "next_data") results.next_data_used++;
          else results.markdown_fallback++;

          // Light delay between requests
          await new Promise((r) => setTimeout(r, 300));
        } catch (err: any) {
          const msg = err.message === "PAGE_NOT_FOUND" ? "Page removed/404" : (err.message || String(err));
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${item.listing_url}: ${msg}`);
          await supabase
            .from("import_queue")
            .update({ status: "failed", error_message: msg.slice(0, 500) })
            .eq("id", item.id);
        }
      }

      return okJson({ success: true, ...results });
    }

    // ── Re-enrich existing vehicles ───────────────────────────────────
    if (action === "re_enrich") {
      const rawLimit = Number(body.limit);
      const limit = Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 15,
        100,
      );
      const concurrency = Math.min(Number(body.concurrency) || 3, 10);

      // Find Mecum candidates via import_queue (avoids full-table-scan timeout on vehicles)
      // Uses import_queue to find pending mecum items that have a vehicle_id already linked,
      // which covers both newly queued items and items reset from 'complete' for backfill.
      const { data: queueItems, error: candErr } = await supabase
        .from("import_queue")
        .select("vehicle_id, listing_url")
        .like("listing_url", "%mecum.com%")
        .in("status", ["pending", "complete"])
        .not("vehicle_id", "is", null)
        .order("processed_at", { ascending: true })
        .limit(limit);

      if (candErr) throw new Error(`Query error: ${candErr.message}`);

      const candidates = (queueItems || [])
        .filter((i: any) => i.listing_url?.includes("mecum.com"))
        .map((i: any) => ({ id: i.vehicle_id as string, discovery_url: i.listing_url as string }));

      if (!candidates?.length) {
        return okJson({ success: true, message: "No Mecum candidates to enrich", processed: 0 });
      }
      if (!candidates?.length) {
        return okJson({ success: true, message: "No Mecum candidates to enrich", processed: 0 });
      }

      const results = {
        total: candidates.length,
        success: 0,
        failed: 0,
        fields_added: 0,
        field_counts: {} as Record<string, number>,
        errors: [] as string[],
      };

      async function processOne(cand: { id: string; discovery_url: string }) {
        try {
          // Skip Firecrawl in re_enrich mode — only process vehicles parseable via free direct fetch
          const vehicle = await fetchAndParse(cand.discovery_url, { skipFirecrawl: true });

          if (!vehicle.year && !vehicle.make) {
            results.failed++;
            return;
          }

          // Pass candidate ID to update the correct vehicle (avoids duplicate URL mismatch)
          const { fieldsUpdated } = await saveVehicle(supabase, vehicle, cand.id);

          results.success++;
          results.fields_added += fieldsUpdated.length;
          for (const f of fieldsUpdated) {
            results.field_counts[f] = (results.field_counts[f] || 0) + 1;
          }
        } catch (err: any) {
          const msg = err.message || String(err);
          // SKIP_NO_NEXT_DATA means this page needs Firecrawl — bump updated_at so it rotates out
          if (msg === "SKIP_NO_NEXT_DATA" || msg === "PAGE_NOT_FOUND") {
            await supabase.from("vehicles").update({ updated_at: new Date().toISOString() }).eq("id", cand.id);
            results.failed++;
            return;
          }
          results.failed++;
          if (results.errors.length < 5) results.errors.push(`${cand.discovery_url}: ${msg.slice(0, 100)}`);
        }
      }

      for (let i = 0; i < candidates.length; i += concurrency) {
        const chunk = candidates.slice(i, i + concurrency);
        await Promise.all(chunk.map(processOne));
      }

      return okJson({ success: true, ...results });
    }

    return okJson(
      { success: false, error: "Provide url or action (extract, batch_from_queue, re_enrich)" },
      400,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (typeof e === "object" && e !== null ? JSON.stringify(e) : String(e));
    console.error("[MECUM] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
