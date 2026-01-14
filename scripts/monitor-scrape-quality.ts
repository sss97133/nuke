#!/usr/bin/env node
/**
 * Monitor Scrape Quality (DB-driven)
 *
 * Goal:
 * - Detect "bad scrape jobs" across many small dealer sites by comparing what we *knew* at queue time
 *   (`import_queue.listing_*` + `import_queue.raw_data`) to what we actually persisted to `vehicles`.
 * - Aggregate health per domain (and per scrape_source) and write JSON + Markdown artifacts.
 *
 * Typical usage:
 * - Last 24h:
 *     npx tsx scripts/monitor-scrape-quality.ts --since-hours 24
 * - Focus on a known-bad vehicle:
 *     npx tsx scripts/monitor-scrape-quality.ts --vehicle-id 08cd310f-ed34-4a17-98cf-bb0541c3b38c
 * - CI mode (fail if any "bad" items found):
 *     npx tsx scripts/monitor-scrape-quality.ts --since-hours 24 --fail-on-any-bad
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, any>;

type Args = {
  sinceHours: number;
  limit: number;
  outputDir: string;
  writeFiles: boolean;
  queueId: string | null;
  vehicleId: string | null;
  listingUrl: string | null;
  domain: string | null;
  minDomainSamples: number;
  maxDomainBadRate: number | null;
  maxOverallBadRate: number | null;
  failOnAnyBad: boolean;
  verbose: boolean;
};

type ImportQueueRow = {
  id: string;
  source_id: string | null;
  listing_url: string;
  listing_title: string | null;
  listing_price: number | string | null;
  listing_year: number | null;
  listing_make: string | null;
  listing_model: string | null;
  thumbnail_url: string | null;
  raw_data: any;
  status: string;
  error_message: string | null;
  vehicle_id: string | null;
  created_at: string;
  processed_at: string | null;
  updated_at: string;
};

type VehicleRow = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  asking_price: number | string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  city: string | null;
  state: string | null;
  description: string | null;
  listing_url: string | null;
  discovery_url: string | null;
  primary_image_url: string | null;
  image_url: string | null;
  source: string | null;
  entry_type: string | null;
  profile_origin: string | null;
  import_queue_id: string | null;
  origin_metadata: any;
  created_at: string;
  updated_at: string;
};

type ScrapeSourceRow = {
  id: string;
  name: string | null;
  url: string | null;
  source_type: string | null;
  inventory_url: string | null;
  requires_firecrawl: boolean | null;
  is_active: boolean | null;
  last_scraped_at: string | null;
  last_successful_scrape: string | null;
  scrape_frequency_hours: number | null;
};

type IssueCode =
  | "vehicle_missing_row"
  | "vehicle_missing_listing_url"
  | "vehicle_listing_url_mismatch"
  | "dropped_year"
  | "dropped_make"
  | "dropped_model"
  | "dropped_price"
  | "dropped_mileage"
  | "dropped_location"
  | "dropped_description"
  | "suspect_primary_image";

type ItemAnalysis = {
  severity: "ok" | "warn" | "bad";
  queue_id: string;
  vehicle_id: string | null;
  listing_url: string;
  domain: string | null;
  processed_at: string | null;
  source_id: string | null;
  source_name: string | null;

  expected: {
    year: number | null;
    make: string | null;
    model: string | null;
    price: number | null;
    mileage: number | null;
    location: string | null;
    description_snippet: string | null;
  };
  actual: {
    year: number | null;
    make: string | null;
    model: string | null;
    asking_price: number | null;
    price: number | null;
    mileage: number | null;
    location: string | null;
    description_len: number | null;
    listing_url: string | null;
    discovery_url: string | null;
    primary_image_url: string | null;
  };

  issues: IssueCode[];
  remediation: string[];
};

function parseArgs(argv: string[]): Args {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  const out: Args = {
    sinceHours: 24,
    limit: 1000,
    outputDir: path.join(repoRoot, "reports", "scrape-quality"),
    writeFiles: true,
    queueId: null,
    vehicleId: null,
    listingUrl: null,
    domain: null,
    minDomainSamples: 5,
    maxDomainBadRate: null,
    maxOverallBadRate: null,
    failOnAnyBad: false,
    verbose: false,
  };

  const readVal = (i: number) => (i + 1 < argv.length ? String(argv[i + 1]) : "");

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--since-hours") out.sinceHours = Number(readVal(i));
    else if (a.startsWith("--since-hours=")) out.sinceHours = Number(a.split("=")[1]);
    else if (a === "--limit") out.limit = Number(readVal(i));
    else if (a.startsWith("--limit=")) out.limit = Number(a.split("=")[1]);
    else if (a === "--output-dir") out.outputDir = readVal(i);
    else if (a.startsWith("--output-dir=")) out.outputDir = a.split("=")[1] || out.outputDir;
    else if (a === "--no-write") out.writeFiles = false;
    else if (a === "--queue-id") out.queueId = readVal(i) || null;
    else if (a.startsWith("--queue-id=")) out.queueId = a.split("=")[1] || null;
    else if (a === "--vehicle-id") out.vehicleId = readVal(i) || null;
    else if (a.startsWith("--vehicle-id=")) out.vehicleId = a.split("=")[1] || null;
    else if (a === "--listing-url") out.listingUrl = readVal(i) || null;
    else if (a.startsWith("--listing-url=")) out.listingUrl = a.split("=")[1] || null;
    else if (a === "--domain") out.domain = readVal(i) || null;
    else if (a.startsWith("--domain=")) out.domain = a.split("=")[1] || null;
    else if (a === "--min-domain-samples") out.minDomainSamples = Number(readVal(i));
    else if (a.startsWith("--min-domain-samples=")) out.minDomainSamples = Number(a.split("=")[1]);
    else if (a === "--max-domain-bad-rate") out.maxDomainBadRate = Number(readVal(i));
    else if (a.startsWith("--max-domain-bad-rate=")) out.maxDomainBadRate = Number(a.split("=")[1]);
    else if (a === "--max-overall-bad-rate") out.maxOverallBadRate = Number(readVal(i));
    else if (a.startsWith("--max-overall-bad-rate=")) out.maxOverallBadRate = Number(a.split("=")[1]);
    else if (a === "--fail-on-any-bad") out.failOnAnyBad = true;
    else if (a === "--verbose") out.verbose = true;
  }

  if (!Number.isFinite(out.sinceHours) || out.sinceHours <= 0) out.sinceHours = 24;
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 1000;
  if (!Number.isFinite(out.minDomainSamples) || out.minDomainSamples < 0) out.minDomainSamples = 5;

  if (out.maxDomainBadRate !== null) {
    if (!Number.isFinite(out.maxDomainBadRate) || out.maxDomainBadRate < 0 || out.maxDomainBadRate > 1) {
      out.maxDomainBadRate = null;
    }
  }
  if (out.maxOverallBadRate !== null) {
    if (!Number.isFinite(out.maxOverallBadRate) || out.maxOverallBadRate < 0 || out.maxOverallBadRate > 1) {
      out.maxOverallBadRate = null;
    }
  }

  return out;
}

function toStringOrNull(v: any): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}

function toNumberOrNull(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    // Strip currency/commas
    const cleaned = s.replace(/[^0-9.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function normalizeUrlForCompare(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
    const pathname = (u.pathname || "/").replace(/\/+$/, "");
    // For our monitoring purposes we ignore query/hash and treat path case-insensitively.
    return `${u.protocol}//${host}${pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

function coalesceListingUrl(item: ImportQueueRow, vehicle: VehicleRow | null): string {
  const candidates = [
    toStringOrNull(item.listing_url),
    toStringOrNull(vehicle?.listing_url),
    toStringOrNull(vehicle?.discovery_url),
  ].filter(Boolean) as string[];
  return candidates[0] || "";
}

function isProbablyPlaceholderImage(url: string | null): boolean {
  if (!url) return false;
  const s = url.toLowerCase();
  // Generic
  if (s.includes("logo") || s.includes("icon") || s.includes("placeholder")) return true;
  // DealerCarSearch-specific noise we've observed in origin_metadata.image_urls
  if (s.includes("bringtrailer.png")) return true;
  if (s.includes("newarrivalphoto")) return true;
  if (s.includes("indoorlot.jpg")) return true;
  if (s.includes("carfax_no.svg")) return true;
  return false;
}

function issueRemediation(issue: IssueCode): string[] {
  switch (issue) {
    case "vehicle_missing_row":
      return [
        "Vehicle row missing for a completed queue item: inspect `process-import-queue` logs and ensure `import_queue.vehicle_id` is set on success.",
      ];
    case "vehicle_missing_listing_url":
    case "vehicle_listing_url_mismatch":
      return [
        "Persist canonical listing link: set `vehicles.listing_url = import_queue.listing_url` (and keep `vehicles.discovery_url` as a display-safe canonical).",
      ];
    case "dropped_year":
    case "dropped_make":
    case "dropped_model":
      return [
        "Fallback to queue hints: if per-listing scrape is missing Y/M/M, use `import_queue.listing_year/make/model` (or `raw_data`) instead of saving empty values.",
      ];
    case "dropped_price":
      return [
        "Fallback to inventory grid: if `scrape-vehicle` fails to return price, use `import_queue.listing_price` / `raw_data.price` for `vehicles.asking_price`.",
      ];
    case "dropped_mileage":
      return [
        "Fallback to inventory grid: if `scrape-vehicle` fails to return mileage, use `raw_data.mileage` to populate `vehicles.mileage` (with provenance).",
      ];
    case "dropped_location":
      return [
        "Fallback to inventory grid: if `scrape-vehicle` fails to return location, use `raw_data.location` (and/or split into city/state) to populate `vehicles.location`.",
      ];
    case "dropped_description":
      return [
        "Fallback to inventory grid: if full description isn't available, at least persist `raw_data.description_snippet` so the profile isn't empty.",
      ];
    case "suspect_primary_image":
      return [
        "Primary image looks like a placeholder/logo: expand URL-based filtering (e.g., DealerCarSearch bringtrailer/newarrival/indoorlot) before choosing `primary_image_url`.",
      ];
    default:
      return [];
  }
}

async function fetchImportQueue(
  supabase: ReturnType<typeof createClient>,
  args: Args
): Promise<ImportQueueRow[]> {
  const sinceIso = new Date(Date.now() - args.sinceHours * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  const out: ImportQueueRow[] = [];

  let offset = 0;
  while (out.length < args.limit) {
    let q = supabase
      .from("import_queue")
      .select(
        "id, source_id, listing_url, listing_title, listing_price, listing_year, listing_make, listing_model, thumbnail_url, raw_data, status, error_message, vehicle_id, created_at, processed_at, updated_at"
      );

    // Narrow queries when a specific target is provided (ignore since-hours + status gating).
    if (args.queueId) {
      q = q.eq("id", args.queueId);
    } else if (args.vehicleId) {
      q = q.eq("vehicle_id", args.vehicleId);
    } else if (args.listingUrl) {
      q = q.ilike("listing_url", `%${args.listingUrl}%`);
    } else {
      q = q.eq("status", "complete").gte("processed_at", sinceIso);
    }

    q = q.order("processed_at", { ascending: false }).order("id", { ascending: false });
    q = q.range(offset, offset + pageSize - 1);

    const { data, error } = await q;
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as ImportQueueRow[];
    out.push(...rows);

    if (rows.length < pageSize) break;
    offset += pageSize;
    if (offset > 5_000_000) break;
  }

  // Domain filter (best-effort; we do it post-fetch to avoid brittle ilike patterns)
  const filtered = args.domain
    ? out.filter((r) => normalizeDomain(r.listing_url) === args.domain!.toLowerCase().replace(/^www\./, ""))
    : out;

  return filtered.slice(0, args.limit);
}

async function fetchVehiclesById(
  supabase: ReturnType<typeof createClient>,
  vehicleIds: string[]
): Promise<Map<string, VehicleRow>> {
  const map = new Map<string, VehicleRow>();
  const chunkSize = 250;

  for (let i = 0; i < vehicleIds.length; i += chunkSize) {
    const chunk = vehicleIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("vehicles")
      .select(
        "id, year, make, model, vin, asking_price, price, mileage, location, city, state, description, listing_url, discovery_url, primary_image_url, image_url, source, entry_type, profile_origin, import_queue_id, origin_metadata, created_at, updated_at"
      )
      .in("id", chunk);
    if (error) throw error;
    for (const v of (Array.isArray(data) ? data : []) as VehicleRow[]) {
      map.set(v.id, v);
    }
  }

  return map;
}

async function fetchScrapeSourcesById(
  supabase: ReturnType<typeof createClient>,
  sourceIds: string[]
): Promise<Map<string, ScrapeSourceRow>> {
  const map = new Map<string, ScrapeSourceRow>();
  if (sourceIds.length === 0) return map;

  const chunkSize = 250;
  for (let i = 0; i < sourceIds.length; i += chunkSize) {
    const chunk = sourceIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("scrape_sources")
      .select(
        "id, name, url, source_type, inventory_url, requires_firecrawl, is_active, last_scraped_at, last_successful_scrape, scrape_frequency_hours"
      )
      .in("id", chunk);
    if (error) throw error;
    for (const s of (Array.isArray(data) ? data : []) as ScrapeSourceRow[]) {
      map.set(s.id, s);
    }
  }

  return map;
}

function analyzeItem(item: ImportQueueRow, vehicle: VehicleRow | null, source: ScrapeSourceRow | null): ItemAnalysis {
  const raw = (item.raw_data && typeof item.raw_data === "object") ? item.raw_data : {};

  const expectedYear = (typeof raw.year === "number" ? raw.year : item.listing_year) ?? null;
  const expectedMake = toStringOrNull(raw.make) ?? toStringOrNull(item.listing_make) ?? null;
  const expectedModel = toStringOrNull(raw.model) ?? toStringOrNull(item.listing_model) ?? null;

  const expectedPrice =
    (() => {
      const rawPrice = toNumberOrNull(raw.asking_price) ?? toNumberOrNull(raw.price);
      const qPrice = toNumberOrNull(item.listing_price);
      const best = rawPrice ?? qPrice;
      return best !== null && best > 0 ? best : null;
    })();

  const expectedMileage =
    (() => {
      const m = toNumberOrNull(raw.mileage);
      return m !== null && m > 0 ? m : null;
    })();

  const expectedLocation = toStringOrNull(raw.location) ?? null;
  const expectedDescSnippet = toStringOrNull(raw.description_snippet) ?? toStringOrNull(raw.description) ?? null;

  const listingUrl = coalesceListingUrl(item, vehicle);
  const domain = normalizeDomain(listingUrl);
  const isBat = domain === "bringatrailer.com";

  const actualAsking = toNumberOrNull(vehicle?.asking_price);
  const actualPrice = toNumberOrNull(vehicle?.price);
  const actualMileage = vehicle?.mileage ?? null;
  const actualDescLen = vehicle?.description ? vehicle.description.length : 0;
  const actualLocation =
    toStringOrNull(vehicle?.location) ??
    (() => {
      const city = toStringOrNull(vehicle?.city);
      const state = toStringOrNull(vehicle?.state);
      if (city && state) return `${city}, ${state}`;
      return city || state || null;
    })();

  const issues: IssueCode[] = [];

  if (!vehicle) {
    issues.push("vehicle_missing_row");
  } else {
    // Link persistence
    const vehicleListingUrlNorm = normalizeUrlForCompare(vehicle.listing_url);
    const queueListingUrlNorm = normalizeUrlForCompare(item.listing_url);
    if (!vehicleListingUrlNorm) {
      issues.push("vehicle_missing_listing_url");
    } else if (queueListingUrlNorm && vehicleListingUrlNorm !== queueListingUrlNorm) {
      issues.push("vehicle_listing_url_mismatch");
    }

    // Field drops vs queue/raw expectations
    if (expectedYear && !vehicle.year) issues.push("dropped_year");
    if (expectedMake && (!vehicle.make || !vehicle.make.trim())) issues.push("dropped_make");
    if (expectedModel && (!vehicle.model || !vehicle.model.trim())) issues.push("dropped_model");

    if (!isBat && expectedPrice !== null) {
      const bestActualPrice = actualAsking ?? actualPrice;
      if (!bestActualPrice || bestActualPrice <= 0) issues.push("dropped_price");
    }

    if (expectedMileage !== null) {
      if (!actualMileage || actualMileage <= 0) issues.push("dropped_mileage");
    }

    if (expectedLocation) {
      if (!actualLocation) issues.push("dropped_location");
    }

    if (expectedDescSnippet && expectedDescSnippet.length >= 30) {
      if (!vehicle.description || actualDescLen < 30) issues.push("dropped_description");
    }

    // Image quality (warning-level)
    const primary = toStringOrNull(vehicle.primary_image_url) ?? toStringOrNull(vehicle.image_url);
    if (primary && isProbablyPlaceholderImage(primary)) {
      issues.push("suspect_primary_image");
    } else if (!primary) {
      // If we had image URLs at queue time, missing primary is suspicious.
      const hadImages =
        (Array.isArray(raw.image_urls) && raw.image_urls.length > 0) ||
        (Array.isArray(raw.images) && raw.images.length > 0) ||
        (typeof item.thumbnail_url === "string" && item.thumbnail_url.startsWith("http"));
      if (hadImages) issues.push("suspect_primary_image");
    }
  }

  const remediation = Array.from(new Set(issues.flatMap(issueRemediation)));

  const severity: ItemAnalysis["severity"] =
    issues.some((c) =>
      c === "vehicle_missing_row" ||
      c === "vehicle_missing_listing_url" ||
      c === "vehicle_listing_url_mismatch" ||
      c.startsWith("dropped_")
    )
      ? "bad"
      : issues.length > 0
        ? "warn"
        : "ok";

  return {
    severity,
    queue_id: item.id,
    vehicle_id: item.vehicle_id,
    listing_url: item.listing_url,
    domain,
    processed_at: item.processed_at,
    source_id: item.source_id,
    source_name: source?.name ?? null,
    expected: {
      year: expectedYear,
      make: expectedMake,
      model: expectedModel,
      price: expectedPrice,
      mileage: expectedMileage,
      location: expectedLocation,
      description_snippet: expectedDescSnippet ? expectedDescSnippet.slice(0, 200) : null,
    },
    actual: {
      year: vehicle?.year ?? null,
      make: vehicle?.make ?? null,
      model: vehicle?.model ?? null,
      asking_price: actualAsking,
      price: actualPrice,
      mileage: actualMileage,
      location: actualLocation,
      description_len: vehicle ? actualDescLen : null,
      listing_url: vehicle?.listing_url ?? null,
      discovery_url: vehicle?.discovery_url ?? null,
      primary_image_url: vehicle?.primary_image_url ?? vehicle?.image_url ?? null,
    },
    issues,
    remediation,
  };
}

function buildMarkdownReport(params: {
  generatedAt: string;
  args: Args;
  summary: any;
  domainRows: any[];
  worst: ItemAnalysis[];
  all: ItemAnalysis[];
}): string {
  const { generatedAt, args, summary, domainRows, worst, all } = params;
  const lines: string[] = [];

  lines.push("## Scrape Quality Report");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");

  lines.push("### Scope");
  lines.push("");
  lines.push(`- since_hours: ${args.sinceHours}`);
  lines.push(`- limit: ${args.limit}`);
  if (args.queueId) lines.push(`- queue_id: \`${args.queueId}\``);
  if (args.vehicleId) lines.push(`- vehicle_id: \`${args.vehicleId}\``);
  if (args.listingUrl) lines.push(`- listing_url filter: \`${args.listingUrl}\``);
  if (args.domain) lines.push(`- domain filter: \`${args.domain}\``);
  lines.push("");

  lines.push("### Summary");
  lines.push("");
  lines.push(`- total_queue_items: ${summary.total}`);
  lines.push(`- bad: ${summary.bad} (${(summary.bad_rate * 100).toFixed(1)}%)`);
  lines.push(`- warn: ${summary.warn} (${(summary.warn_rate * 100).toFixed(1)}%)`);
  lines.push("");

  lines.push("### Per-domain health (top 20 by bad rate, min samples applied)");
  lines.push("");
  lines.push("| domain | total | bad | bad_rate | warnings | top_issues |");
  lines.push("|---|---:|---:|---:|---:|---|");
  for (const d of domainRows.slice(0, 20)) {
    const topIssues = Object.entries(d.issue_counts as Record<string, number>)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 3)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `| ${d.domain} | ${d.total} | ${d.bad} | ${(d.bad_rate * 100).toFixed(1)}% | ${d.warn} | ${topIssues || ""} |`
    );
  }
  lines.push("");

  lines.push("### Worst offenders (top 25)");
  lines.push("");
  for (const it of worst.slice(0, 25)) {
    const issueList = it.issues.length ? it.issues.join(", ") : "none";
    lines.push(`- **${it.domain || "unknown"}** \`${it.listing_url}\``);
    lines.push(`  - queue_id: \`${it.queue_id}\`${it.vehicle_id ? ` vehicle_id: \`${it.vehicle_id}\`` : ""}`);
    lines.push(`  - issues: ${issueList}`);
    if (it.remediation.length > 0) {
      lines.push(`  - remediation: ${it.remediation.join(" / ")}`);
    }
  }
  lines.push("");

  // Helpful callout for the specific example in the conversation (if present)
  const knownBad = all.find((x) => x.vehicle_id === "08cd310f-ed34-4a17-98cf-bb0541c3b38c");
  if (knownBad) {
    lines.push("### Known example");
    lines.push("");
    lines.push(`- vehicle_id \`08cd310f-ed34-4a17-98cf-bb0541c3b38c\` was flagged as **${knownBad.severity}**`);
    lines.push(`  - issues: ${knownBad.issues.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);

  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim() ||
    "https://qkgaybvrernstplzjaam.supabase.co";
  const serviceKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

  if (!serviceKey) {
    console.error("ERROR: Missing SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY).");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const items = await fetchImportQueue(supabase, args);
  const vehicleIds = Array.from(new Set(items.map((i) => i.vehicle_id).filter(Boolean) as string[]));
  const sourceIds = Array.from(new Set(items.map((i) => i.source_id).filter(Boolean) as string[]));

  const [vehicleMap, sourceMap] = await Promise.all([
    fetchVehiclesById(supabase, vehicleIds),
    fetchScrapeSourcesById(supabase, sourceIds),
  ]);

  const analyses: ItemAnalysis[] = items.map((it) => {
    const vehicle = it.vehicle_id ? vehicleMap.get(it.vehicle_id) || null : null;
    const source = it.source_id ? sourceMap.get(it.source_id) || null : null;
    return analyzeItem(it, vehicle, source);
  });

  const total = analyses.length;
  const bad = analyses.filter((a) => a.severity === "bad").length;
  const warn = analyses.filter((a) => a.severity === "warn").length;
  const summary = {
    total,
    bad,
    warn,
    bad_rate: total ? bad / total : 0,
    warn_rate: total ? warn / total : 0,
  };

  // Domain aggregation
  const byDomain = new Map<
    string,
    { domain: string; total: number; bad: number; warn: number; issue_counts: Record<string, number> }
  >();

  for (const a of analyses) {
    const d = a.domain || "unknown";
    const bucket = byDomain.get(d) || { domain: d, total: 0, bad: 0, warn: 0, issue_counts: {} };
    bucket.total += 1;
    if (a.severity === "bad") bucket.bad += 1;
    if (a.severity === "warn") bucket.warn += 1;
    for (const issue of a.issues) {
      bucket.issue_counts[issue] = (bucket.issue_counts[issue] || 0) + 1;
    }
    byDomain.set(d, bucket);
  }

  const domainRows = Array.from(byDomain.values()).map((d) => ({
    ...d,
    bad_rate: d.total ? d.bad / d.total : 0,
    warn_rate: d.total ? d.warn / d.total : 0,
  }));

  // Only show statistically meaningful rows in the "top domains" list (but keep unknown)
  const domainRowsForRanking = domainRows
    .filter((d) => d.domain === "unknown" || d.total >= args.minDomainSamples)
    .sort((a, b) => b.bad_rate - a.bad_rate || b.total - a.total || a.domain.localeCompare(b.domain));

  const worst = analyses
    .slice()
    .sort((a, b) => b.issues.length - a.issues.length || a.severity.localeCompare(b.severity))
    .filter((a) => a.severity !== "ok");

  const generatedAt = new Date().toISOString();
  const report = {
    generated_at: generatedAt,
    scope: {
      since_hours: args.sinceHours,
      limit: args.limit,
      queue_id: args.queueId,
      vehicle_id: args.vehicleId,
      listing_url_filter: args.listingUrl,
      domain_filter: args.domain,
    },
    summary,
    domains: domainRowsForRanking,
    worst_offenders: worst.slice(0, 200),
    items: args.verbose ? analyses : undefined,
  };

  const md = buildMarkdownReport({
    generatedAt,
    args,
    summary,
    domainRows: domainRowsForRanking,
    worst,
    all: analyses,
  });

  if (args.writeFiles) {
    fs.mkdirSync(args.outputDir, { recursive: true });
    const jsonPath = path.join(args.outputDir, "scrape-quality-report.json");
    const mdPath = path.join(args.outputDir, "SCRAPE_QUALITY_REPORT.md");
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, md);
    console.log(`Wrote ${path.relative(process.cwd(), jsonPath)}`);
    console.log(`Wrote ${path.relative(process.cwd(), mdPath)}`);
  }

  console.log(`\nScrape quality: total=${total} bad=${bad} warn=${warn}`);

  // Fail conditions (CI-friendly)
  const failingDomains =
    args.maxDomainBadRate !== null
      ? domainRowsForRanking.filter(
          (d) => d.domain !== "unknown" && d.total >= args.minDomainSamples && d.bad_rate > (args.maxDomainBadRate as number)
        )
      : [];
  const overallFail =
    args.maxOverallBadRate !== null && summary.total > 0 ? summary.bad_rate > (args.maxOverallBadRate as number) : false;

  if (args.failOnAnyBad && bad > 0) {
    console.error(`FAIL: found ${bad} bad scrape outcomes`);
    process.exit(2);
  }
  if (overallFail) {
    console.error(`FAIL: overall bad_rate ${(summary.bad_rate * 100).toFixed(1)}% exceeds max ${(args.maxOverallBadRate! * 100).toFixed(1)}%`);
    process.exit(2);
  }
  if (failingDomains.length > 0) {
    console.error(
      `FAIL: ${failingDomains.length} domains exceed max_domain_bad_rate ${(args.maxDomainBadRate! * 100).toFixed(1)}% (min_samples=${args.minDomainSamples})`
    );
    for (const d of failingDomains.slice(0, 10)) {
      console.error(`  - ${d.domain}: bad_rate ${(d.bad_rate * 100).toFixed(1)}% (bad=${d.bad}/${d.total})`);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("ERROR:", err?.message || String(err));
  process.exit(1);
});

