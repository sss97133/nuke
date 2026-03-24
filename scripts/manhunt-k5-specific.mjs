#!/usr/bin/env node
/**
 * K5 Blazer Specific Documentation Manhunt
 *
 * Targeted searches for 1977 K5 Blazer documentation:
 *   - Archive.org: shop manuals, wiring diagrams, parts catalogs
 *   - NHTSA VPIC: VIN decode for factory build sheet
 *   - Motec documentation: M130/M150/PDM30 manuals
 *
 * Usage:
 *   dotenvx run -- node scripts/manhunt-k5-specific.mjs              # dry run
 *   dotenvx run -- node scripts/manhunt-k5-specific.mjs --download   # download + store
 *   dotenvx run -- node scripts/manhunt-k5-specific.mjs --vin-only   # just decode VIN
 */

import { createClient } from "@supabase/supabase-js";

const VEHICLE_ID = "e04bf9c5-b488-433b-be9a-3d307861d90b";
const VIN = "CKL187F114094"; // 1977 K5 Blazer partial VIN (pre-17 digit era)
const LIBRARY_ID = "41dfebfe-efb2-43a8-abc6-2be66cf8e43a"; // 1977 Chevrolet Blazer reference library
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const args = process.argv.slice(2);
const DOWNLOAD = args.includes("--download");
const VIN_ONLY = args.includes("--vin-only");
const DELAY_MS = 1500; // Rate limit for Archive.org

// ── Archive.org Search Queries ───────────────────────────────────────────
const ARCHIVE_QUERIES = [
  { query: 'chevrolet truck shop manual 1977', tag: "shop_manual" },
  { query: 'chevrolet truck service manual 1973 1987', tag: "service_manual" },
  { query: 'chevrolet blazer wiring diagram', tag: "wiring_diagram" },
  { query: 'GM light duty truck parts catalog 1977', tag: "parts_catalog" },
  { query: 'chevrolet blazer owners manual 1977', tag: "owners_manual" },
  { query: 'chevy truck body repair manual', tag: "body_manual" },
  { query: 'chevrolet truck electrical manual', tag: "electrical_manual" },
  { query: 'LS swap wiring guide', tag: "ls_swap" },
  { query: 'motec M130 ECU manual', tag: "motec_m130" },
  { query: 'motec PDM power distribution module', tag: "motec_pdm30" },
  { query: 'dakota digital VHX gauge installation', tag: "dakota_digital" },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchArchiveOrg(query) {
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=mediatype&fl[]=format&fl[]=description&fl[]=year&fl[]=creator&rows=20&output=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.response?.docs || []).filter(d =>
      d.mediatype === "texts" || d.format?.some?.(f => /pdf/i.test(f))
    );
  } catch (err) {
    console.error(`  Search failed: ${err.message}`);
    return [];
  }
}

async function getArchiveMetadata(identifier) {
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function decodeVIN() {
  console.log("\n" + "─".repeat(70));
  console.log("VIN DECODE via NHTSA VPIC");
  console.log("─".repeat(70));
  console.log(`  VIN: ${VIN} (pre-1981 format)`);

  // NHTSA VPIC may not support pre-1981 VINs fully, but let's try
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${VIN}?format=json&modelyear=1977`);
    if (!res.ok) {
      console.log("  NHTSA API returned error — pre-1981 VINs have limited decode support");
      return null;
    }
    const data = await res.json();
    const results = (data.Results || []).filter(r => r.Value && r.Value.trim() !== "" && r.Value !== "Not Applicable");

    if (results.length === 0) {
      console.log("  No decode results (expected for pre-1981 VIN)");
      return null;
    }

    console.log("\n  Decoded fields:");
    const decoded = {};
    for (const r of results) {
      decoded[r.Variable] = r.Value;
      console.log(`    ${r.Variable}: ${r.Value}`);
    }
    return decoded;
  } catch (err) {
    console.error(`  VIN decode failed: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("K5 Blazer Documentation Manhunt");
  console.log(`Mode: ${DOWNLOAD ? "SEARCH + DOWNLOAD" : "SEARCH ONLY"}`);
  console.log("=".repeat(70));

  // VIN decode
  const vinData = await decodeVIN();

  if (VIN_ONLY) {
    console.log("\n--vin-only flag set, skipping document search.");
    return;
  }

  // Search Archive.org
  console.log("\n" + "─".repeat(70));
  console.log("ARCHIVE.ORG SEARCHES");
  console.log("─".repeat(70));

  const allResults = [];

  for (const { query, tag } of ARCHIVE_QUERIES) {
    console.log(`\n  [${tag}] "${query}"`);
    const results = await searchArchiveOrg(query);
    console.log(`    Found: ${results.length} results`);

    for (const r of results.slice(0, 5)) {
      console.log(`    • ${r.identifier} — ${(r.title || "").slice(0, 80)}`);
      allResults.push({ ...r, tag, query });
    }

    await sleep(DELAY_MS);
  }

  // Deduplicate by identifier
  const seen = new Set();
  const unique = [];
  for (const r of allResults) {
    if (!seen.has(r.identifier)) {
      seen.add(r.identifier);
      unique.push(r);
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`UNIQUE RESULTS: ${unique.length}`);
  console.log("─".repeat(70));

  // Score relevance
  const scored = unique.map(r => {
    let score = 0;
    const text = `${r.title || ""} ${r.description || ""}`.toLowerCase();
    if (/1977|1973.*1987|73.*87/.test(text)) score += 3;
    if (/blazer|k5|k-5/.test(text)) score += 5;
    if (/chevrolet|chevy|gm/.test(text)) score += 2;
    if (/shop manual|service manual|repair manual/.test(text)) score += 4;
    if (/wiring|electrical/.test(text)) score += 3;
    if (/parts catalog|parts book/.test(text)) score += 3;
    if (/motec|m130|m150|pdm/.test(text)) score += 5;
    if (/squarebody/.test(text)) score += 4;
    return { ...r, relevance_score: score };
  }).sort((a, b) => b.relevance_score - a.relevance_score);

  for (const r of scored.slice(0, 20)) {
    console.log(`  [${r.relevance_score}] ${r.identifier} — ${(r.title || "").slice(0, 70)}`);
  }

  if (!DOWNLOAD) {
    console.log("\nSearch only — use --download to fetch and store documents.");
    return;
  }

  // Download top results
  console.log(`\n${"─".repeat(70)}`);
  console.log("DOWNLOADING TOP RESULTS");
  console.log("─".repeat(70));

  let downloadCount = 0;
  const MAX_DOWNLOADS = 10;

  for (const r of scored) {
    if (downloadCount >= MAX_DOWNLOADS) break;
    if (r.relevance_score < 3) break; // Skip low relevance

    console.log(`\n  Fetching metadata for: ${r.identifier}`);
    const meta = await getArchiveMetadata(r.identifier);
    await sleep(DELAY_MS);

    if (!meta?.files) {
      console.log("    No files found");
      continue;
    }

    // Find PDF files
    const pdfs = meta.files.filter(f => f.name?.endsWith(".pdf") && f.size < 100_000_000);
    if (pdfs.length === 0) {
      console.log("    No PDFs found (or too large)");
      continue;
    }

    const pdf = pdfs[0];
    const downloadUrl = `https://archive.org/download/${r.identifier}/${pdf.name}`;
    const fileSize = parseInt(pdf.size || 0);

    console.log(`    PDF: ${pdf.name} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

    if (fileSize > 50_000_000) {
      console.log("    Skipping — exceeds 50MB Supabase upload limit");
      continue;
    }

    // Download
    try {
      console.log(`    Downloading...`);
      const dlRes = await fetch(downloadUrl);
      if (!dlRes.ok) {
        console.log(`    Download failed: ${dlRes.status}`);
        continue;
      }

      const buffer = Buffer.from(await dlRes.arrayBuffer());
      const storagePath = `manhunt/k5-blazer/${r.identifier}/${pdf.name}`;

      // Upload to Supabase Storage
      const { error: uploadErr } = await sb.storage
        .from("reference-docs")
        .upload(storagePath, buffer, { contentType: "application/pdf", upsert: true });

      if (uploadErr) {
        console.log(`    Upload failed: ${uploadErr.message}`);
        continue;
      }

      console.log(`    Stored: ${storagePath}`);

      // Create library_documents record
      const { error: docErr } = await sb.from("library_documents").insert({
        library_id: LIBRARY_ID,
        title: r.title || r.identifier,
        document_type: r.tag,
        storage_path: storagePath,
        source_url: `https://archive.org/details/${r.identifier}`,
        file_size_bytes: fileSize,
        file_format: "pdf",
        metadata: {
          archive_org_id: r.identifier,
          search_tag: r.tag,
          relevance_score: r.relevance_score,
          creator: meta.metadata?.creator,
          year: meta.metadata?.year || meta.metadata?.date,
          vin_data: vinData,
        },
      });

      if (docErr) {
        console.log(`    DB insert failed: ${docErr.message}`);
      } else {
        console.log(`    Document record created`);
        downloadCount++;
      }
    } catch (err) {
      console.log(`    Error: ${err.message}`);
    }

    await sleep(DELAY_MS * 3);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Downloaded and stored: ${downloadCount} documents`);
  console.log("=".repeat(70));
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
