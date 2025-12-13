/**
 * LOCAL Scott Drake Mustang PDF indexer (NO Gemini required)
 *
 * Why:
 * - Supabase Edge Function `index-reference-document` requires GOOGLE_AI_API_KEY/GEMINI_API_KEY.
 * - If those secrets are not set, this script can still seed parts by parsing PDF text locally
 *   and inserting into `catalog_parts` using SUPABASE_SERVICE_ROLE_KEY.
 *
 * What it extracts (best-effort):
 * - Ford-style part numbers like C5ZZ-6523200-A (and spaced variants)
 * - Name/description from the same line
 * - Price if present ($xx.xx)
 * - Page number stored in application_data.page
 *
 * Usage:
 *   node scripts/index-scott-drake-pdf-local.js "https://performancev8.com/PDFs/ScottDrakeCatalog_mustang.pdf"
 *
 * Options:
 *   --max-pages 9999
 *   --start 1
 *   --end 9999
 *   --commit-batch 500
 *   --truncate (delete existing parts for this catalog source before insert)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qkgaybvrernstplzjaam.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is required");
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    pdfUrl: null,
    start: 1,
    end: null,
    maxPages: null,
    commitBatch: 500,
    truncate: false,
    cacheFile: "tmp/scott-drake-mustang-pdf-parts.json",
    useCache: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith("--") && !out.pdfUrl) {
      out.pdfUrl = a;
      continue;
    }
    if (a === "--start") out.start = Number(argv[++i] || "1");
    else if (a === "--end") out.end = Number(argv[++i] || "0") || null;
    else if (a === "--max-pages") out.maxPages = Number(argv[++i] || "0") || null;
    else if (a === "--commit-batch") out.commitBatch = Number(argv[++i] || "500");
    else if (a === "--truncate") out.truncate = true;
    else if (a === "--cache-file") out.cacheFile = argv[++i] || out.cacheFile;
    else if (a === "--no-cache") out.useCache = false;
  }
  return out;
}

function normalizePdfUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.startsWith("chrome-extension://")) {
    const idx = s.indexOf("/https://");
    if (idx !== -1) s = s.substring(idx + 1);
  }
  try {
    const u = new URL(s);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return s;
  }
}

function groupTextIntoLines(items) {
  // Group by approximate y coordinate.
  const byY = new Map();
  for (const item of items) {
    const t = item.str;
    if (!t || !String(t).trim()) continue;
    const y = item.transform?.[5] ?? 0;
    const x = item.transform?.[4] ?? 0;
    const key = Math.round(y * 2) / 2; // 0.5 precision
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push({ x, t: String(t) });
  }

  const ys = Array.from(byY.keys()).sort((a, b) => b - a); // top to bottom
  const lines = [];
  for (const y of ys) {
    const row = byY.get(y).sort((a, b) => a.x - b.x);
    const text = row
      .map((r) => r.t)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push(text);
  }
  return lines;
}

function normalizeFordPartNumber(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase().trim();
  // Normalize spaced variants: C5ZZ 6523200 A -> C5ZZ-6523200-A
  const spaced = s.match(/\b([A-Z]\d[A-Z]{2})\s+(\d{4,7})\s+([A-Z0-9]{1,2})\b/);
  if (spaced) return `${spaced[1]}-${spaced[2]}-${spaced[3]}`;
  const dashed = s.match(/\b([A-Z]\d[A-Z]{2}-\d{4,7}-[A-Z0-9]{1,2})\b/);
  if (dashed) return dashed[1];
  return null;
}

function extractFromLine(line) {
  const part = normalizeFordPartNumber(line);
  if (!part) return null;

  const priceMatch = line.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/);
  const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) : null;

  // Remove part number and price from the name line heuristically.
  let name = line.replace(part, "").replace(/\$\s*[0-9][0-9,]*(?:\.[0-9]{2})?/, "").trim();
  name = name.replace(/\s{2,}/g, " ").trim();
  if (!name || name.length < 3) name = part;

  return { part_number: part, name, price };
}

async function fetchPdfBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download PDF: ${resp.status} ${resp.statusText}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function ensureCatalogSource(supabase, pdfUrl) {
  const { data: existing, error: e1 } = await supabase.from("catalog_sources").select("id").eq("base_url", pdfUrl).maybeSingle();
  if (e1) throw e1;
  if (existing?.id) return existing.id;

  const { data: created, error: e2 } = await supabase
    .from("catalog_sources")
    .insert({
      name: "ScottDrakeCatalog_mustang.pdf",
      provider: "Scott Drake",
      base_url: pdfUrl,
    })
    .select("id")
    .single();
  if (e2) throw e2;
  return created.id;
}

async function maybeTruncateCatalogParts(supabase, catalogId) {
  const { error } = await supabase.from("catalog_parts").delete().eq("catalog_id", catalogId);
  if (error) throw error;
}

async function withRetry(fn, { tries = 5, baseDelayMs = 750 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retryable = msg.toLowerCase().includes("fetch failed") || msg.toLowerCase().includes("etimedout") || msg.toLowerCase().includes("econnreset");
      if (!retryable || attempt === tries) throw e;
      const delay = baseDelayMs * attempt;
      console.warn(`Retryable error (${attempt}/${tries}): ${msg}. Waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv);
  const pdfUrl = normalizePdfUrl(args.pdfUrl);
  if (!pdfUrl) {
    console.error("Usage: node scripts/index-scott-drake-pdf-local.js <pdf_url>");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Ensure cache directory exists if using cache
  let cachePath = null;
  if (args.useCache && args.cacheFile) {
    cachePath = args.cacheFile;
    const dir = cachePath.includes("/") ? cachePath.split("/").slice(0, -1).join("/") : ".";
    if (dir) {
      const fs = await import("node:fs");
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const start = Math.max(1, args.start || 1);

  const catalogId = await withRetry(() => ensureCatalogSource(supabase, pdfUrl));
  console.log(`Catalog source: ${catalogId}`);

  if (args.truncate) {
    console.log("Truncating existing catalog_parts for this catalog...");
    await withRetry(() => maybeTruncateCatalogParts(supabase, catalogId), { tries: 5 });
  }

  const fs = await import("node:fs");
  let extractedParts = [];
  let scannedMeta = null;

  if (args.useCache && cachePath && fs.existsSync(cachePath)) {
    console.log(`Loading cached extraction: ${cachePath}`);
    const raw = fs.readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    extractedParts = Array.isArray(parsed.parts) ? parsed.parts : [];
    scannedMeta = parsed.meta || null;
  } else {
    console.log("Downloading PDF...");
    const pdfBuffer = await fetchPdfBuffer(pdfUrl);
    console.log(`PDF size: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    console.log("Loading PDF...");
    const pdfData = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const totalPages = pdf.numPages;
    console.log(`Pages: ${totalPages}`);

    const end = Math.min(args.end || totalPages, totalPages);
    const maxPages = args.maxPages ? Math.min(args.maxPages, end - start + 1) : null;
    const finalEnd = maxPages ? Math.min(end, start + maxPages - 1) : end;

    console.log(`Extracting pages ${start}-${finalEnd}...`);

    const seen = new Set();
    for (let pageNum = start; pageNum <= finalEnd; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const lines = groupTextIntoLines(textContent.items || []);

      for (const line of lines) {
        const item = extractFromLine(line);
        if (!item) continue;
        const key = item.part_number;
        if (seen.has(key)) continue;
        seen.add(key);

        extractedParts.push({
          part_number: item.part_number,
          name: item.name,
          price_current: item.price,
          currency: "USD",
          manufacturer: "Scott Drake",
          category: "mustang",
          fits_models: ["Mustang"],
          supplier_url: pdfUrl,
          application_data: {
            supplier: "Scott Drake",
            source: "pdf_local_parse",
            pdf_url: pdfUrl,
            page: pageNum,
            raw_line: line.substring(0, 500),
          },
        });
      }

      if (pageNum % 25 === 0) {
        console.log(`  scanned page ${pageNum}/${finalEnd} (unique parts so far: ${extractedParts.length})`);
        if (args.useCache && cachePath) {
          fs.writeFileSync(
            cachePath,
            JSON.stringify({ meta: { pdfUrl, start, end: finalEnd, totalPages }, parts: extractedParts }),
          );
        }
      }
    }

    if (args.useCache && cachePath) {
      fs.writeFileSync(cachePath, JSON.stringify({ meta: { pdfUrl, start, end: finalEnd, totalPages }, parts: extractedParts }));
      console.log(`Saved cache: ${cachePath}`);
    }
  }

  console.log(`Extracted unique parts: ${extractedParts.length}`);
  if (extractedParts.length === 0) {
    console.log("No parts found with the current regex. The PDF may require a different extraction approach.");
    process.exit(0);
  }

  // Fetch existing part_numbers for this catalog to avoid duplicates on re-run.
  // If we truncated, we know it's empty, skip the query (reduces network + avoids fetch flakiness).
  const existingSet = new Set();
  if (!args.truncate) {
    for (let i = 0; i < extractedParts.length; i += 1000) {
      const chunk = extractedParts.slice(i, i + 1000).map((p) => p.part_number);
      const { data, error } = await withRetry(() =>
        supabase.from("catalog_parts").select("part_number").eq("catalog_id", catalogId).in("part_number", chunk),
      );
      if (error) throw error;
      for (const row of data || []) existingSet.add(row.part_number);
    }
  }

  const toInsert = extractedParts.filter((p) => !existingSet.has(p.part_number)).map((p) => ({ catalog_id: catalogId, ...p }));

  console.log(`Inserting new parts: ${toInsert.length} (skipping existing: ${existingSet.size})`);

  let inserted = 0;
  const commitBatch = Math.max(1, args.commitBatch || 500);
  for (let i = 0; i < toInsert.length; i += commitBatch) {
    const batch = toInsert.slice(i, i + commitBatch);
    const { error } = await withRetry(() => supabase.from("catalog_parts").insert(batch), { tries: 6 });
    if (error) throw error;
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${toInsert.length}`);
  }

  console.log("Done.");
  console.log(`Catalog: ${catalogId}`);
  console.log(`Inserted: ${inserted}`);
}

main().catch((e) => {
  console.error(e);
  if (e?.cause) console.error("cause:", e.cause);
  process.exit(1);
});


