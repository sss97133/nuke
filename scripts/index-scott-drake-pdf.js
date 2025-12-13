/**
 * Index Scott Drake Mustang PDF into catalog_parts via edge function index-reference-document.
 *
 * This script is built for "starting point" PDFs (even older catalogs).
 * It:
 * - normalizes chrome-extension://.../https://... links into a real https URL
 * - calls index-reference-document in structure mode to get total pages
 * - batches extract_parts requests across the full page range
 *
 * Required env:
 * - SUPABASE_URL (or VITE_SUPABASE_URL)
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/index-scott-drake-pdf.js "https://performancev8.com/PDFs/ScottDrakeCatalog_mustang.pdf"
 *
 * Options:
 *   --batch-size 50
 *   --start 1
 *   --end 9999
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://qkgaybvrernstplzjaam.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = {
    pdfUrl: null,
    batchSize: 50,
    start: 1,
    end: null,
    delayMs: 1000,
  };

  // first non-flag arg is URL
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (!a.startsWith("--") && !out.pdfUrl) {
      out.pdfUrl = a;
      continue;
    }
    if (a === "--batch-size") out.batchSize = Number(argv[++i] || "50");
    else if (a === "--start") out.start = Number(argv[++i] || "1");
    else if (a === "--end") out.end = Number(argv[++i] || "0") || null;
    else if (a === "--delay-ms") out.delayMs = Number(argv[++i] || "1000");
  }

  return out;
}

function normalizePdfUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();

  // Convert chrome-extension://<id>/<actual-url> into <actual-url>
  // Example:
  // chrome-extension://efaid.../https://performancev8.com/PDFs/ScottDrakeCatalog_mustang.pdf?... -> https://performancev8.com/PDFs/ScottDrakeCatalog_mustang.pdf
  const chromePrefix = "chrome-extension://";
  if (s.startsWith(chromePrefix)) {
    const idx = s.indexOf("/https://");
    if (idx !== -1) {
      s = s.substring(idx + 1); // keep https://...
    }
  }

  // Strip query params + fragments
  try {
    const u = new URL(s);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return s;
  }
}

async function invokeIndexReferenceDocument(body) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/index-reference-document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`index-reference-document failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  if (data?.error) {
    throw new Error(`index-reference-document error: ${data.error}`);
  }
  return data;
}

async function main() {
  const args = parseArgs(process.argv);
  const pdfUrl = normalizePdfUrl(args.pdfUrl);

  if (!pdfUrl) {
    console.error("Usage: node scripts/index-scott-drake-pdf.js <pdf_url> [--batch-size 50] [--start 1] [--end N]");
    process.exit(1);
  }

  console.log(`PDF: ${pdfUrl}`);
  console.log("Step 1: structure analysis...");
  const structure = await invokeIndexReferenceDocument({
    pdf_url: pdfUrl,
    mode: "structure",
  });

  const totalPages = Number(structure?.result?.total_pages || 0);
  if (!totalPages) {
    console.log("Warning: total_pages not returned; defaulting to end = 50 unless --end provided.");
  }

  const start = Math.max(1, args.start || 1);
  const end = args.end || totalPages || 50;
  const batchSize = Math.max(1, args.batchSize || 50);

  console.log(`Catalog ID: ${structure?.catalogId || "(unknown)"}`);
  console.log(`Pages: ${start}-${end} (batch size ${batchSize})`);
  console.log("Step 2: extract_parts batches...");

  let totalExtracted = 0;
  for (let p = start; p <= end; p += batchSize) {
    const batchStart = p;
    const batchEnd = Math.min(end, p + batchSize - 1);
    console.log(`Extracting pages ${batchStart}-${batchEnd}...`);

    const res = await invokeIndexReferenceDocument({
      pdf_url: pdfUrl,
      mode: "extract_parts",
      page_start: batchStart,
      page_end: batchEnd,
    });

    const partsInBatch = Number(res?.result?.parts?.length || 0);
    totalExtracted += partsInBatch;
    console.log(`  extracted=${partsInBatch} (running total=${totalExtracted})`);

    if (batchEnd < end && args.delayMs > 0) await sleep(args.delayMs);
  }

  console.log("Done.");
  console.log(`Total extracted (reported by batches): ${totalExtracted}`);
  console.log(`Source catalogId: ${structure?.catalogId || "(unknown)"}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});


