/**
 * Service Manual Manhunt v1.0
 *
 * Systematically discovers and downloads factory documentation from free public sources:
 *   - Archive.org (service manuals, shop manuals, brochures, parts catalogs)
 *   - Ford Heritage Vault (factory originals for Ford/Lincoln/Mercury)
 *   - NHTSA TSB API (Technical Service Bulletins)
 *
 * Usage:
 *   dotenvx run -- node scripts/manhunt-service-manuals.mjs [options]
 *
 *   --top <N>         Search top N empty libraries by vehicle count (default: 50)
 *   --make <make>     Filter to a specific make
 *   --year <year>     Filter to a specific year
 *   --source <src>    Source to search: archive_org (default), ford_heritage, nhtsa_tsb
 *   --download        Download PDFs to Supabase Storage
 *   --dry-run         Show what would be searched
 *   --force           Re-search even if previously searched
 *   --verbose         Show detailed output
 */

import { createClient } from "@supabase/supabase-js";

// ─── Config ────────────────────────────────────────────────────────
const SYSTEM_USER_ID = "0b9f107a-d124-49de-9ded-94698f63c1c4";
const STORAGE_BUCKET = "reference-docs";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file (Supabase upload limit)
const SEARCH_DELAY_MS = 1000;
const METADATA_DELAY_MS = 5000;
const DOWNLOAD_DELAY_MS = 10000;
const MAX_SEARCHES_PER_RUN = 100;
const MAX_DOWNLOADS_PER_RUN = 20;
const RE_SEARCH_DAYS = 30;

// Known real vehicle makes for filtering junk reference_libraries
const VALID_MAKES = new Set([
  "Chevrolet", "Ford", "Dodge", "Plymouth", "Pontiac", "Buick", "Cadillac",
  "Oldsmobile", "GMC", "Lincoln", "Mercury", "Chrysler", "AMC", "Jeep",
  "Toyota", "Honda", "Nissan", "Datsun", "Mazda", "Subaru", "Mitsubishi",
  "BMW", "Mercedes-Benz", "Mercedes", "Porsche", "Audi", "Volkswagen", "VW",
  "Jaguar", "Land Rover", "Rolls-Royce", "Bentley", "Aston Martin",
  "Ferrari", "Lamborghini", "Maserati", "Alfa Romeo", "Fiat", "Lancia",
  "Volvo", "Saab", "Triumph", "MG", "Austin-Healey", "Lotus",
  "Shelby", "De Tomaso", "DeLorean", "Studebaker", "Packard", "Nash",
  "Hudson", "Kaiser", "Willys", "International", "International Harvester",
  "Checker", "Excalibur", "Avanti", "Tucker", "Cord", "Duesenberg", "Auburn",
  "Hummer", "Saturn", "Geo", "Eagle", "Isuzu", "Suzuki", "Hyundai", "Kia",
  "Lexus", "Infiniti", "Acura", "Tesla", "Rivian", "Lucid",
]);

// ─── CLI Arg Parsing ───────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const topN = parseInt(getArg("top") || "50", 10);
const filterMake = getArg("make");
const filterYear = getArg("year") ? parseInt(getArg("year"), 10) : null;
const source = getArg("source") || "archive_org";
const doDownload = hasFlag("download");
const dryRun = hasFlag("dry-run");
const force = hasFlag("force");
const verbose = hasFlag("verbose");

if (!["archive_org", "ford_heritage", "nhtsa_tsb"].includes(source)) {
  console.error(`Unknown source: ${source}. Use: archive_org, ford_heritage, nhtsa_tsb`);
  process.exit(1);
}

// ─── Supabase Client ───────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Helpers ───────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(...args) {
  console.log(`[manhunt]`, ...args);
}

function vlog(...args) {
  if (verbose) console.log(`  [v]`, ...args);
}

function normalizeModel(model) {
  if (!model) return null;
  // Strip junk: FB Marketplace descriptions that leaked into model field
  if (model.length > 40) return null;
  if (model.includes("$") || model.includes("(")) return null;
  // Clean up common patterns
  return model
    .replace(/\s+/g, " ")
    .replace(/[~"]/g, "")
    .trim();
}

function normalizeMake(make) {
  if (!make) return null;
  const m = make.trim();
  // Normalize common variants
  const aliases = {
    Gmc: "GMC",
    "Mercedes-benz": "Mercedes-Benz",
    Vw: "Volkswagen",
    Chevy: "Chevrolet",
  };
  return aliases[m] || m;
}

// ─── Priority Queue Builder ────────────────────────────────────────
async function buildPriorityQueue() {
  log(`Building priority queue (top ${topN}, source: ${source})`);
  if (filterMake) log(`  Filtered to make: ${filterMake}`);
  if (filterYear) log(`  Filtered to year: ${filterYear}`);

  // Get libraries with actual vehicle counts via join
  // reference_libraries.vehicle_count is often 0 even when links exist
  let query = supabase
    .from("reference_libraries")
    .select("id, year, make, model, document_count")
    .eq("document_count", 0)
    .gte("year", 1900)
    .lte("year", 2030)
    .order("year", { ascending: true })
    .limit(5000);

  if (filterMake) {
    query = query.ilike("make", filterMake);
  }
  if (filterYear) {
    query = query.eq("year", filterYear);
  }

  const { data: libraries, error } = await query;
  if (error) {
    console.error("Failed to fetch libraries:", error.message);
    process.exit(1);
  }

  // Filter to real vehicles with valid makes
  const cleaned = libraries
    .map((lib) => ({
      ...lib,
      make: normalizeMake(lib.make),
      model: normalizeModel(lib.model),
    }))
    .filter((lib) => {
      if (!lib.make) return false;
      // If a specific make was requested, don't filter by known makes
      if (filterMake) return true;
      return VALID_MAKES.has(lib.make);
    })
    .filter((lib) => lib.model); // Must have a model

  // For ford_heritage, filter to Ford/Lincoln/Mercury only
  const sourceFiltered =
    source === "ford_heritage"
      ? cleaned.filter((lib) =>
          ["Ford", "Lincoln", "Mercury"].includes(lib.make)
        )
      : cleaned;

  // If not forcing, exclude already-searched libraries for this source
  let queue = sourceFiltered;
  if (!force && queue.length > 0) {
    const libraryIds = queue.map((l) => l.id);
    // Check in batches to avoid URL length limits
    const searched = new Set();
    for (let i = 0; i < libraryIds.length; i += 200) {
      const batch = libraryIds.slice(i, i + 200);
      const { data: existing } = await supabase
        .from("manhunt_searches")
        .select("library_id")
        .eq("source", source)
        .in("library_id", batch)
        .in("status", ["found", "downloaded", "indexed", "not_found", "skipped"]);
      if (existing) existing.forEach((e) => searched.add(e.library_id));
    }
    if (searched.size > 0) {
      vlog(`Skipping ${searched.size} already-searched libraries`);
      queue = queue.filter((l) => !searched.has(l.id));
    }
  }

  // Sort: prioritize 1950-1990 era (best Archive.org coverage), then by year
  queue.sort((a, b) => {
    const aInSweet = a.year >= 1950 && a.year <= 1990 ? 0 : 1;
    const bInSweet = b.year >= 1950 && b.year <= 1990 ? 0 : 1;
    if (aInSweet !== bInSweet) return aInSweet - bInSweet;
    return a.year - b.year;
  });

  // Take top N
  const result = queue.slice(0, topN);
  log(`Queue: ${result.length} libraries to search (from ${cleaned.length} eligible)`);
  return result;
}

// ─── Archive.org Search ────────────────────────────────────────────
const ARCHIVE_SEARCH_URL =
  "https://archive.org/advancedsearch.php";

function buildArchiveQueries(year, make, model) {
  // Archive.org search strategy: year-specific queries return almost nothing.
  // Broad make+doctype searches work, then we score/filter by year in results.
  // We run both broad and narrow queries for best coverage.
  const queries = [
    // Broad: will match year in title/description via scoring
    `${make} service manual mediatype:texts`,
    `${make} shop manual mediatype:texts`,
    `${make} repair manual mediatype:texts`,
    `${make} owner manual mediatype:texts`,
    `${make} parts catalog mediatype:texts`,
    `${make} brochure mediatype:texts`,
  ];
  return queries;
}

function scoreArchiveResult(item, year, make, model) {
  let score = 0;
  const title = (item.title || "").toLowerCase();
  const rawDesc = item.description;
  const desc = (Array.isArray(rawDesc) ? rawDesc.join(" ") : String(rawDesc || "")).toLowerCase();
  const subject = Array.isArray(item.subject)
    ? item.subject.join(" ").toLowerCase()
    : (item.subject || "").toLowerCase();
  const combined = `${title} ${desc} ${subject}`;
  const yearStr = String(year);
  const makeLower = make.toLowerCase();
  const modelLower = model ? model.toLowerCase().split(" ")[0] : ""; // First word of model

  // Year match — REQUIRED for relevance. Without a year match, max score stays below 60.
  let yearMatched = false;
  if (combined.includes(yearStr)) {
    score += 30;
    yearMatched = true;
  } else {
    // Check for year ranges like "1967-1972" or "1970-1987"
    const yearRanges = [...combined.matchAll(/\b(19\d{2})\s*[-–]\s*(19\d{2})\b/g)];
    for (const m of yearRanges) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      if (year >= start && year <= end) {
        score += 25;
        yearMatched = true;
        break;
      }
    }
  }
  // Without year match, cap at low score (make + doctype alone shouldn't qualify)
  if (!yearMatched) score -= 10;

  // Make match — prioritize title matches over description
  if (title.includes(makeLower)) {
    score += 25;
  } else if (combined.includes(makeLower)) {
    score += 10; // Weaker signal if only in description/subject
  }
  // Also check common aliases
  const aliases = { chevrolet: "chevy", gmc: "gm", "mercedes-benz": "mercedes" };
  if (aliases[makeLower] && title.includes(aliases[makeLower])) score += 15;

  // Model match (first word only to avoid junk model names)
  if (modelLower && modelLower.length > 2 && combined.includes(modelLower)) score += 15;

  // Document type scoring
  if (/service manual|shop manual|repair manual/i.test(combined)) score += 20;
  if (/owner'?s?\s*manual/i.test(combined)) score += 15;
  if (/parts\s*(catalog|book|manual|list)/i.test(combined)) score += 15;
  if (/brochure/i.test(combined)) score += 10;
  if (/wiring|electrical/i.test(combined)) score += 10;
  if (/dealer|sales/i.test(combined)) score += 5;

  // Downloads as quality signal
  const downloads = parseInt(item.downloads || "0", 10);
  if (downloads > 1000) score += 10;
  else if (downloads > 100) score += 5;
  else if (downloads > 10) score += 2;

  // Penalties
  if (/toy|model kit|die.?cast|hot wheels/i.test(combined)) score -= 50;
  if (/video|movie|film|audio|song/i.test(combined)) score -= 30;
  if (/bomb service|ordnance|military/i.test(combined) && !/truck|jeep|willys/i.test(combined)) score -= 20;
  if (/cia reading room/i.test(combined)) score -= 50;
  if (/zoology|biology|botany|geology|archaeology/i.test(combined)) score -= 50;
  if (/civil war|world war|encyclopedia/i.test(combined)) score -= 30;

  return score;
}

function classifyDocType(item) {
  const combined = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  if (/service manual|shop manual|repair manual/i.test(combined))
    return "service_manual";
  if (/owner'?s?\s*manual/i.test(combined)) return "owners_manual";
  if (/parts\s*(catalog|book|manual|list)/i.test(combined))
    return "parts_catalog";
  if (/brochure|dealer|sales/i.test(combined)) return "brochure";
  if (/wiring|electrical/i.test(combined)) return "service_manual";
  return "spec_sheet";
}

// Cache broad searches per make — avoid re-querying Archive.org for same make
const makeSearchCache = new Map(); // make → Map<query, docs[]>

async function fetchArchiveResults(query) {
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "50");
  url.searchParams.set("fl[]", "identifier,title,description,subject,mediatype,downloads,format,date");
  url.searchParams.set("sort[]", "downloads desc");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const resp = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data?.response?.docs || [];
  } catch (err) {
    vlog(`  Search error: ${err.message}`);
    return [];
  }
}

async function searchArchiveOrg(year, make, model) {
  const queries = buildArchiveQueries(year, make, model);
  const allResults = [];
  const seenIds = new Set();

  // Initialize cache for this make if needed
  if (!makeSearchCache.has(make)) {
    makeSearchCache.set(make, new Map());
  }
  const cache = makeSearchCache.get(make);

  for (const q of queries) {
    let docs;
    if (cache.has(q)) {
      docs = cache.get(q);
      vlog(`Search (cached): ${q} → ${docs.length} results`);
    } else {
      vlog(`Search: ${q}`);
      try {
        docs = await fetchArchiveResults(q);
        cache.set(q, docs);
        vlog(`  Found ${docs.length} results`);
      } catch (err) {
        vlog(`  Error: ${err.message}`);
        docs = [];
      }
      await sleep(SEARCH_DELAY_MS);
    }

    for (const doc of docs) {
      if (seenIds.has(doc.identifier)) continue;
      seenIds.add(doc.identifier);
      // Only texts/documents
      if (doc.mediatype && !["texts", "collection"].includes(doc.mediatype))
        continue;
      const score = scoreArchiveResult(doc, year, make, model);
      if (score >= 40) {
        allResults.push({ ...doc, _score: score, _query: q });
      }
    }
  }

  // Sort by score descending
  allResults.sort((a, b) => b._score - a._score);
  return allResults;
}

async function getArchiveMetadata(identifier) {
  const url = `https://archive.org/metadata/${identifier}`;
  vlog(`Metadata: ${identifier}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data;
  } catch (err) {
    vlog(`  Metadata error: ${err.message}`);
    return null;
  }
}

function findPdfsInMetadata(metadata) {
  if (!metadata?.files) return [];
  const pdfs = metadata.files
    .filter((f) => f.name && f.name.toLowerCase().endsWith(".pdf"))
    .filter((f) => {
      const size = parseInt(f.size || "0", 10);
      return size > 10000 && size < MAX_FILE_SIZE; // 10KB min, 100MB max
    })
    .map((f) => ({ ...f, _size: parseInt(f.size || "0", 10) }));

  // Prefer PDFs in a reasonable size range (1-50MB = likely real manuals)
  // Sort: "goldilocks" sizes first, then by size descending
  pdfs.sort((a, b) => {
    const aGood = a._size > 1_000_000 && a._size < 50_000_000;
    const bGood = b._size > 1_000_000 && b._size < 50_000_000;
    if (aGood && !bGood) return -1;
    if (!aGood && bGood) return 1;
    return b._size - a._size;
  });
  return pdfs;
}

async function downloadFromArchive(identifier, filename) {
  const url = `https://archive.org/download/${identifier}/${encodeURIComponent(filename)}`;
  log(`  Downloading: ${url}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.status === 401 || resp.status === 403) {
      vlog(`  Borrowable/restricted item (${resp.status}), skipping`);
      return null;
    }
    if (!resp.ok) {
      log(`  Download failed: HTTP ${resp.status}`);
      return null;
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    log(`  Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
    return buffer;
  } catch (err) {
    log(`  Download error: ${err.message}`);
    return null;
  }
}

async function uploadToStorage(buffer, storagePath, mimeType) {
  log(`  Uploading ${(buffer.length / 1024 / 1024).toFixed(1)} MB to ${storagePath}...`);
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType || "application/pdf",
        upsert: true,
      });
    if (error) {
      log(`  Upload error: ${error.message}`);
      return null;
    }
    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    log(`  Upload complete: ${publicUrl.slice(0, 80)}...`);
    return publicUrl;
  } catch (err) {
    log(`  Upload exception: ${err.message}`);
    return null;
  }
}

// ─── NHTSA Search (Complaints + Recalls) ───────────────────────────
// TSB endpoint requires auth, but complaints and recalls are free
async function searchNhtsaTsb(year, make, model) {
  // Extract base model name (first word, e.g., "Corvette" from "Corvette Coupe 4-Speed")
  const baseModel = model ? model.split(/\s+/)[0] : "";
  const results = [];

  // Complaints
  const complaintsUrl = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(baseModel)}&modelYear=${year}`;
  vlog(`NHTSA complaints: ${complaintsUrl}`);
  try {
    const resp = await fetch(complaintsUrl);
    if (resp.ok) {
      const data = await resp.json();
      const complaints = data?.results || [];
      vlog(`  ${complaints.length} complaints`);
      for (const c of complaints) {
        results.push({
          type: "complaint",
          nhtsaCampaignNumber: c.odiNumber || c.id,
          component: c.components || c.component,
          summary: c.summary,
          _score: 80,
        });
      }
    }
  } catch (err) {
    vlog(`  Complaints error: ${err.message}`);
  }
  await sleep(SEARCH_DELAY_MS);

  // Recalls
  const recallsUrl = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(baseModel)}&modelYear=${year}`;
  vlog(`NHTSA recalls: ${recallsUrl}`);
  try {
    const resp = await fetch(recallsUrl);
    if (resp.ok) {
      const data = await resp.json();
      const recalls = data?.results || [];
      vlog(`  ${recalls.length} recalls`);
      for (const r of recalls) {
        results.push({
          type: "recall",
          nhtsaCampaignNumber: r.NHTSACampaignNumber,
          component: r.Component,
          summary: r.Summary,
          _score: 90,
        });
      }
    }
  } catch (err) {
    vlog(`  Recalls error: ${err.message}`);
  }

  return results;
}

// ─── Ford Heritage Vault Search ────────────────────────────────────
async function searchFordHeritage(year, make, model) {
  // Ford Heritage Vault catalog: heritage.ford.com
  // Structured catalog — attempt to find documents via their search/browse
  const searchUrl = `https://heritage.ford.com/api/search?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model || "")}`;
  vlog(`Ford Heritage: ${searchUrl}`);
  try {
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      // Try the browse page approach
      vlog(`  API returned ${resp.status}, trying browse page...`);
      return await searchFordHeritageBrowse(year, make, model);
    }
    const data = await resp.json();
    return data?.documents || data?.results || [];
  } catch (err) {
    vlog(`  Error: ${err.message}`);
    return await searchFordHeritageBrowse(year, make, model);
  }
}

async function searchFordHeritageBrowse(year, make, model) {
  // Fallback: try Archive.org for Ford Heritage content
  // Many Ford Heritage PDFs are mirrored on Archive.org
  const q = `"ford heritage" "${year}" "${make}" "${model || ""}" (manual OR brochure)`;
  const url = new URL(ARCHIVE_SEARCH_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "10");
  url.searchParams.set(
    "fl[]",
    "identifier,title,description,subject,mediatype,downloads,format"
  );
  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) return [];
    const data = await resp.json();
    const docs = (data?.response?.docs || []).filter(
      (d) => d.mediatype === "texts"
    );
    return docs.map((d) => ({
      ...d,
      _source: "ford_heritage_mirror",
      _score: scoreArchiveResult(d, year, make, model),
    }));
  } catch {
    return [];
  }
}

// ─── Record Search Results ─────────────────────────────────────────
async function recordSearch(libraryId, year, make, model, searchQuery, results, status, docsCreated = 0) {
  const { error } = await supabase.from("manhunt_searches").upsert(
    {
      library_id: libraryId,
      year,
      make,
      model,
      source,
      search_query: searchQuery,
      search_url:
        source === "archive_org"
          ? `https://archive.org/search?query=${encodeURIComponent(searchQuery)}`
          : null,
      results_found: results.length,
      results_relevant: results.filter((r) => (r._score || 0) >= 60).length,
      documents_created: docsCreated,
      status,
      raw_results:
        results.length > 0
          ? results.slice(0, 10).map((r) => ({
              identifier: r.identifier,
              title: r.title,
              score: r._score,
              downloads: r.downloads,
            }))
          : null,
      searched_at: new Date().toISOString(),
      next_search_after: new Date(
        Date.now() + RE_SEARCH_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
    },
    { onConflict: "library_id,source,search_query" }
  );
  if (error) vlog(`  Record error: ${error.message || JSON.stringify(error)}`);
}

async function createLibraryDocument(libraryId, item, fileUrl, fileSize, docType) {
  const { data, error } = await supabase.from("library_documents").insert({
    library_id: libraryId,
    document_type: docType,
    title: item.title || `${item.identifier}`,
    description: item.description
      ? String(item.description).slice(0, 500)
      : null,
    file_url: fileUrl,
    file_size_bytes: fileSize,
    mime_type: "application/pdf",
    uploaded_by: SYSTEM_USER_ID,
    uploader_type: "user",
    is_factory_original: docType === "service_manual" || docType === "owners_manual",
    tags: [source, "manhunt", docType],
    year_published: null, // Could parse from metadata
  }).select("id").single();

  if (error) {
    log(`  Doc insert error: ${error.message}`);
    return null;
  }

  // Update library document_count (trigger should handle this, but let's be safe)
  // The trg_update_library_doc_stats trigger handles this automatically
  return data?.id;
}

// ─── Main: Archive.org Manhunt ─────────────────────────────────────
async function runArchiveOrgManhunt(queue) {
  let searchCount = 0;
  let downloadCount = 0;
  let totalDocsCreated = 0;

  for (const lib of queue) {
    if (searchCount >= MAX_SEARCHES_PER_RUN) {
      log(`Hit search limit (${MAX_SEARCHES_PER_RUN}). Stopping.`);
      break;
    }

    log(
      `\n── ${lib.year} ${lib.make} ${lib.model} ──────────────────────`
    );

    const results = await searchArchiveOrg(lib.year, lib.make, lib.model);
    searchCount++;
    const relevant = results.filter((r) => r._score >= 60);

    log(
      `  ${results.length} results, ${relevant.length} relevant (score >= 60)`
    );

    if (results.length === 0) {
      await recordSearch(
        lib.id, lib.year, lib.make, lib.model,
        `${lib.year} ${lib.make} ${lib.model}`,
        [], "not_found"
      );
      continue;
    }

    // Show top results
    for (const r of results.slice(0, 5)) {
      const docType = classifyDocType(r);
      log(
        `  [${r._score}] ${docType}: ${r.title} (${r.downloads || 0} downloads)`
      );
    }

    if (dryRun) {
      await recordSearch(
        lib.id, lib.year, lib.make, lib.model,
        `${lib.year} ${lib.make} ${lib.model}`,
        results, results.length > 0 ? "found" : "not_found"
      );
      continue;
    }

    // Download relevant items
    let docsCreated = 0;
    for (const item of relevant) {
      if (downloadCount >= MAX_DOWNLOADS_PER_RUN) {
        log(`  Hit download limit (${MAX_DOWNLOADS_PER_RUN}). Skipping remaining.`);
        break;
      }

      if (!doDownload) {
        // Just record the find without downloading
        continue;
      }

      // Get metadata to find PDFs
      await sleep(METADATA_DELAY_MS);
      const metadata = await getArchiveMetadata(item.identifier);
      if (!metadata) continue;

      // Skip borrowable/restricted items (require Archive.org login)
      const access = metadata?.metadata?.access_restricted_item;
      if (access === "true" || access === true) {
        vlog(`  Restricted/borrowable item: ${item.identifier}, skipping`);
        continue;
      }

      const pdfs = findPdfsInMetadata(metadata);
      if (pdfs.length === 0) {
        vlog(`  No PDFs found in ${item.identifier}`);
        continue;
      }

      // Download the largest PDF (usually the full manual)
      const pdf = pdfs[0];
      await sleep(DOWNLOAD_DELAY_MS);
      const buffer = await downloadFromArchive(item.identifier, pdf.name);
      if (!buffer) continue;

      downloadCount++;

      // Upload to Supabase Storage
      const storagePath = `manhunt/${source}/${lib.year}/${lib.make}/${item.identifier}/${pdf.name}`;
      const fileUrl = await uploadToStorage(buffer, storagePath, "application/pdf");
      if (!fileUrl) continue;

      // Create library_documents record
      const docType = classifyDocType(item);
      const docId = await createLibraryDocument(
        lib.id, item, fileUrl, buffer.length, docType
      );
      if (docId) {
        docsCreated++;
        totalDocsCreated++;
        log(`  Created document: ${docType} (${docId})`);
      }
    }

    // Record the search
    const status = docsCreated > 0
      ? "downloaded"
      : relevant.length > 0
        ? "found"
        : "not_found";
    await recordSearch(
      lib.id, lib.year, lib.make, lib.model,
      `${lib.year} ${lib.make} ${lib.model}`,
      results, status, docsCreated
    );
  }

  return { searchCount, downloadCount, totalDocsCreated };
}

// ─── Main: NHTSA TSB Manhunt ───────────────────────────────────────
async function runNhtsaTsbManhunt(queue) {
  let searchCount = 0;
  let totalDocsCreated = 0;

  for (const lib of queue) {
    if (searchCount >= MAX_SEARCHES_PER_RUN) break;

    log(`\n── ${lib.year} ${lib.make} ${lib.model} ──────────────────────`);

    const tsbs = await searchNhtsaTsb(lib.year, lib.make, lib.model);
    searchCount++;

    log(`  ${tsbs.length} TSBs found`);

    if (tsbs.length === 0) {
      await recordSearch(
        lib.id, lib.year, lib.make, lib.model,
        `NHTSA TSB: ${lib.year} ${lib.make} ${lib.model}`,
        [], "not_found"
      );
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    // Show top results
    for (const tsb of tsbs.slice(0, 5)) {
      log(
        `  TSB #${tsb.nhtsaCampaignNumber || tsb.tsbId || "?"}: ${tsb.summary || tsb.component || "No summary"}`
      );
    }

    if (dryRun) {
      await recordSearch(
        lib.id, lib.year, lib.make, lib.model,
        `NHTSA TSB: ${lib.year} ${lib.make} ${lib.model}`,
        tsbs.map((t) => ({ ...t, _score: 80 })),
        "found"
      );
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    // Store complaints/recalls as library documents (metadata records)
    let docsCreated = 0;
    for (const item of tsbs) {
      const prefix = item.type === "recall" ? "Recall" : "Complaint";
      const itemTitle = `${prefix} ${item.nhtsaCampaignNumber || ""}: ${(item.component || "").slice(0, 100)}`;
      const { error } = await supabase.from("library_documents").insert({
        library_id: lib.id,
        document_type: "spec_sheet",
        title: itemTitle.slice(0, 255),
        description: (item.summary || "").slice(0, 500),
        file_url: `https://www.nhtsa.gov/vehicle/${lib.year}/${encodeURIComponent(lib.make)}/${encodeURIComponent(lib.model || "")}`,
        file_size_bytes: 0,
        mime_type: "text/plain",
        uploaded_by: SYSTEM_USER_ID,
        uploader_type: "user",
        is_factory_original: true,
        tags: ["nhtsa_tsb", "manhunt", item.type],
      });
      if (!error) docsCreated++;
    }

    totalDocsCreated += docsCreated;

    // document_count updated by trg_update_library_doc_stats trigger

    await recordSearch(
      lib.id, lib.year, lib.make, lib.model,
      `NHTSA TSB: ${lib.year} ${lib.make} ${lib.model}`,
      tsbs.map((t) => ({ ...t, _score: 80 })),
      docsCreated > 0 ? "downloaded" : "found",
      docsCreated
    );

    await sleep(SEARCH_DELAY_MS);
  }

  return { searchCount, downloadCount: 0, totalDocsCreated };
}

// ─── Main: Ford Heritage Manhunt ───────────────────────────────────
async function runFordHeritageManhunt(queue) {
  let searchCount = 0;
  let downloadCount = 0;
  let totalDocsCreated = 0;

  for (const lib of queue) {
    if (searchCount >= MAX_SEARCHES_PER_RUN) break;

    log(`\n── ${lib.year} ${lib.make} ${lib.model} ──────────────────────`);

    const results = await searchFordHeritage(lib.year, lib.make, lib.model);
    searchCount++;

    log(`  ${results.length} results`);

    if (results.length === 0) {
      await recordSearch(
        lib.id, lib.year, lib.make, lib.model,
        `Ford Heritage: ${lib.year} ${lib.make} ${lib.model}`,
        [], "not_found"
      );
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    for (const r of results.slice(0, 5)) {
      log(`  [${r._score || "?"}] ${r.title || r.identifier || "unknown"}`);
    }

    if (dryRun) {
      await recordSearch(
        lib.id, lib.year, lib.make, lib.model,
        `Ford Heritage: ${lib.year} ${lib.make} ${lib.model}`,
        results, "found"
      );
      await sleep(SEARCH_DELAY_MS);
      continue;
    }

    // If results came from Archive.org mirror, handle like archive_org
    const relevant = results.filter((r) => (r._score || 0) >= 60);
    let docsCreated = 0;

    for (const item of relevant) {
      if (downloadCount >= MAX_DOWNLOADS_PER_RUN) break;
      if (!doDownload) continue;
      if (!item.identifier) continue; // Skip non-Archive.org results

      await sleep(METADATA_DELAY_MS);
      const metadata = await getArchiveMetadata(item.identifier);
      if (!metadata) continue;

      const pdfs = findPdfsInMetadata(metadata);
      if (pdfs.length === 0) continue;

      await sleep(DOWNLOAD_DELAY_MS);
      const pdf = pdfs[0];
      const buffer = await downloadFromArchive(item.identifier, pdf.name);
      if (!buffer) continue;

      downloadCount++;

      const storagePath = `manhunt/ford_heritage/${lib.year}/${lib.make}/${item.identifier}/${pdf.name}`;
      const fileUrl = await uploadToStorage(buffer, storagePath, "application/pdf");
      if (!fileUrl) continue;

      const docType = classifyDocType(item);
      const docId = await createLibraryDocument(
        lib.id, item, fileUrl, buffer.length, docType
      );
      if (docId) {
        docsCreated++;
        totalDocsCreated++;
        log(`  Created document: ${docType} (${docId})`);
      }
    }

    const status =
      docsCreated > 0
        ? "downloaded"
        : relevant.length > 0
          ? "found"
          : "not_found";
    await recordSearch(
      lib.id, lib.year, lib.make, lib.model,
      `Ford Heritage: ${lib.year} ${lib.make} ${lib.model}`,
      results, status, docsCreated
    );

    await sleep(SEARCH_DELAY_MS);
  }

  return { searchCount, downloadCount, totalDocsCreated };
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  log(`Service Manual Manhunt v1.0`);
  log(`Source: ${source} | Top: ${topN} | Download: ${doDownload} | Dry run: ${dryRun}`);
  log("");

  const queue = await buildPriorityQueue();
  if (queue.length === 0) {
    log("No libraries to search. Try --force to re-search.");
    return;
  }

  if (dryRun) {
    log("\n── DRY RUN: Libraries to search ──────────────────────");
    for (const lib of queue) {
      log(`  ${lib.year} ${lib.make} ${lib.model}`);
    }
    log("");
  }

  let stats;
  switch (source) {
    case "archive_org":
      stats = await runArchiveOrgManhunt(queue);
      break;
    case "ford_heritage":
      stats = await runFordHeritageManhunt(queue);
      break;
    case "nhtsa_tsb":
      stats = await runNhtsaTsbManhunt(queue);
      break;
  }

  log(`\n── Summary ──────────────────────────────────────────`);
  log(`  Searches: ${stats.searchCount}`);
  log(`  Downloads: ${stats.downloadCount}`);
  log(`  Documents created: ${stats.totalDocsCreated}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
