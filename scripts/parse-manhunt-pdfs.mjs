/**
 * Parse Manhunt PDFs — Free Local Text Extraction
 *
 * Downloads PDFs from Supabase Storage, extracts text with pdf-parse,
 * chunks by page, inserts into service_manual_chunks. Zero API cost.
 *
 * Usage:
 *   dotenvx run -- node scripts/parse-manhunt-pdfs.mjs [options]
 *
 *   --limit <N>       Process N documents (default: all)
 *   --doc-id <uuid>   Process a specific document
 *   --dry-run         Show what would be processed
 *   --force           Re-parse already-parsed documents
 *   --verbose         Show detailed output
 */

import { createClient } from "@supabase/supabase-js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── CLI ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx === -1 ? undefined : args[idx + 1];
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const limit = parseInt(getArg("limit") || "0", 10);
const specificDocId = getArg("doc-id");
const dryRun = hasFlag("dry-run");
const force = hasFlag("force");
const verbose = hasFlag("verbose");

function log(...a) { console.log("[parse]", ...a); }
function vlog(...a) { if (verbose) console.log("  [v]", ...a); }

// ─── Find unparsed manhunt documents ───────────────────────────────
async function getDocsToParse() {
  let query = supabase
    .from("library_documents")
    .select("id, library_id, title, file_url, file_size_bytes, document_type, tags")
    .contains("tags", ["manhunt"])
    .gt("file_size_bytes", 10000) // Skip metadata-only records
    .order("file_size_bytes", { ascending: true }); // Small first = fast wins

  if (specificDocId) {
    query = supabase
      .from("library_documents")
      .select("id, library_id, title, file_url, file_size_bytes, document_type, tags")
      .eq("id", specificDocId);
  }

  const { data: docs, error } = await query;
  if (error) { console.error("Query error:", error.message); process.exit(1); }

  // Deduplicate by file_url — same PDF linked to multiple libraries
  const seenUrls = new Map();
  const deduped = [];
  for (const d of docs) {
    if (seenUrls.has(d.file_url)) {
      // Track sibling doc IDs so we can copy chunks later
      seenUrls.get(d.file_url).siblings.push(d.id);
    } else {
      const entry = { ...d, siblings: [] };
      seenUrls.set(d.file_url, entry);
      deduped.push(entry);
    }
  }
  const dupeCount = docs.length - deduped.length;
  if (dupeCount > 0) log(`Deduped: ${dupeCount} duplicate PDFs (same file, different libraries)`);

  if (!force) {
    // Exclude docs that already have chunks
    const allIds = deduped.map(d => d.id);
    const { data: parsed } = await supabase
      .from("service_manual_chunks")
      .select("document_id")
      .in("document_id", allIds);
    const parsedSet = new Set((parsed || []).map(p => p.document_id));
    const unparsed = deduped.filter(d => !parsedSet.has(d.id));
    log(`${deduped.length} unique PDFs, ${parsedSet.size} already parsed, ${unparsed.length} to parse`);
    return limit > 0 ? unparsed.slice(0, limit) : unparsed;
  }

  log(`${deduped.length} unique PDFs (force mode)`);
  return limit > 0 ? deduped.slice(0, limit) : deduped;
}

// ─── Download PDF from storage URL ─────────────────────────────────
async function downloadPdf(fileUrl) {
  // Extract storage path from public URL
  const match = fileUrl.match(/\/storage\/v1\/object\/public\/reference-docs\/(.+)/);
  if (match) {
    const path = decodeURIComponent(match[1]);
    vlog(`Storage download: ${path}`);
    const { data, error } = await supabase.storage
      .from("reference-docs")
      .download(path);
    if (error) {
      log(`  Storage error: ${error.message}`);
      return null;
    }
    return Buffer.from(await data.arrayBuffer());
  }

  // Fallback: direct URL fetch
  vlog(`Direct download: ${fileUrl}`);
  try {
    const resp = await fetch(fileUrl);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    log(`  Download error: ${err.message}`);
    return null;
  }
}

// ─── Detect section boundaries from text ───────────────────────────
function detectSection(pageText) {
  // Common section headers in service manuals
  const patterns = [
    /^(SECTION|CHAPTER|PART)\s+[\dIVXA-Z]+[:\s-]+(.+)/im,
    /^(ENGINE|TRANSMISSION|BRAKES|STEERING|SUSPENSION|ELECTRICAL|BODY|FRAME|EXHAUST|COOLING|FUEL|CLUTCH|AXLE|DRIVETRAIN|WHEELS|TIRES|SPECIFICATIONS|MAINTENANCE|LUBRICATION|GENERAL|INTRODUCTION|INDEX|CONTENTS)/im,
    /^(\d+[\.\-]\d*)\s+([A-Z][A-Z\s&]+)/m,
  ];
  for (const pat of patterns) {
    const m = pageText.match(pat);
    if (m) return m[0].trim().slice(0, 100);
  }
  return null;
}

function classifyContent(text) {
  const lower = text.toLowerCase();
  if (/torque|specification|capacity|dimension|weight|pressure|clearance|gap/i.test(lower))
    return "specification";
  if (/diagram|wiring|schematic|circuit/i.test(lower))
    return "diagram";
  if (/remove|install|replace|adjust|inspect|disassemble|reassemble|procedure/i.test(lower))
    return "procedure";
  if (/table|chart|schedule|interval/i.test(lower))
    return "chart";
  return "reference";
}

// ─── Parse a single PDF ───────────────────────────────────────────
async function parsePdf(doc) {
  const sizeMB = ((doc.file_size_bytes || 0) / 1024 / 1024).toFixed(1);
  log(`\n── ${doc.title} (${sizeMB} MB) ──`);

  // Download
  const buffer = await downloadPdf(doc.file_url);
  if (!buffer) {
    log("  Failed to download, skipping");
    return 0;
  }
  vlog(`  Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Parse PDF with pdfjs-dist
  try {
    const uint8 = new Uint8Array(buffer);
    const pdfDoc = await getDocument({ data: uint8, useSystemFonts: true }).promise;
    const numPages = pdfDoc.numPages;

    // Extract text from each page
    const pages = [];
    let totalChars = 0;
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(" ");
      pages.push(text);
      totalChars += text.length;
    }

    log(`  ${numPages} pages, ${totalChars} chars total`);

    if (pages.length === 0) {
      log("  No text extracted (scanned PDF?), skipping");
      return 0;
    }

    // Insert chunks
    let chunksCreated = 0;
    let currentSection = doc.document_type === "brochure" ? "Brochure" : "General";
    const batchSize = 50;
    let batch = [];

    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i].trim();
      if (!pageText || pageText.length < 20) continue; // Skip blank pages

      // Detect section changes
      const newSection = detectSection(pageText);
      if (newSection) currentSection = newSection;

      batch.push({
        document_id: doc.id,
        page_number: i + 1,
        section_name: currentSection,
        content: pageText.slice(0, 50000), // Cap at 50K chars per page
        content_type: classifyContent(pageText),
        metadata: {
          char_count: pageText.length,
          source: "manhunt-local-parse",
        },
      });

      if (batch.length >= batchSize) {
        const { error } = await supabase
          .from("service_manual_chunks")
          .insert(batch);
        if (error) {
          log(`  Insert error: ${error.message}`);
        } else {
          chunksCreated += batch.length;
        }
        batch = [];
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      const { error } = await supabase
        .from("service_manual_chunks")
        .insert(batch);
      if (error) {
        log(`  Insert error: ${error.message}`);
      } else {
        chunksCreated += batch.length;
      }
    }

    log(`  Created ${chunksCreated} chunks across ${pages.length} pages`);

    // Copy chunks to sibling documents (same PDF, different libraries)
    if (doc.siblings && doc.siblings.length > 0 && chunksCreated > 0) {
      for (const sibId of doc.siblings) {
        // Fetch the chunks we just created and duplicate for sibling
        const { data: srcChunks } = await supabase
          .from("service_manual_chunks")
          .select("page_number, section_name, content, content_type, metadata")
          .eq("document_id", doc.id);
        if (srcChunks && srcChunks.length > 0) {
          const sibChunks = srcChunks.map(c => ({ ...c, document_id: sibId }));
          // Insert in batches
          for (let i = 0; i < sibChunks.length; i += 50) {
            await supabase.from("service_manual_chunks").insert(sibChunks.slice(i, i + 50));
          }
          vlog(`  Copied ${sibChunks.length} chunks to sibling ${sibId.slice(0, 8)}...`);
        }
      }
    }

    return chunksCreated;

  } catch (err) {
    log(`  Parse error: ${err.message}`);
    return 0;
  }
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  log("Manhunt PDF Parser — free local text extraction");
  log(`Dry run: ${dryRun} | Force: ${force} | Limit: ${limit || "all"}`);

  const docs = await getDocsToParse();
  if (docs.length === 0) {
    log("Nothing to parse.");
    return;
  }

  if (dryRun) {
    log("\nWould parse:");
    for (const d of docs) {
      const sizeMB = ((d.file_size_bytes || 0) / 1024 / 1024).toFixed(1);
      log(`  ${d.document_type}: ${d.title} (${sizeMB} MB)`);
    }
    return;
  }

  let totalChunks = 0;
  let docsProcessed = 0;
  let docsFailed = 0;

  for (const doc of docs) {
    const chunks = await parsePdf(doc);
    if (chunks > 0) {
      docsProcessed++;
      totalChunks += chunks;
    } else {
      docsFailed++;
    }
  }

  log(`\n── Summary ──`);
  log(`  Processed: ${docsProcessed} docs`);
  log(`  Failed: ${docsFailed} docs`);
  log(`  Chunks created: ${totalChunks}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
