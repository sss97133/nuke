#!/usr/bin/env node
/**
 * SNAPSHOT-TO-MARKDOWN BRIDGE
 *
 * Reads HTML from Supabase Storage (html_storage_path) and converts to
 * clean markdown for LLM extraction. All 391K snapshots have html=NULL
 * inline — this script bridges that gap.
 *
 * Usage:
 *   dotenvx run -- node scripts/snapshot-to-markdown.mjs [options]
 *
 * Options:
 *   --platform <name>   Process only this platform (default: all, priority order)
 *   --batch <n>         Batch size (default: 50)
 *   --max <n>           Max snapshots to process (default: 10000)
 *   --dry-run           Query counts but don't process
 *   --stats             Show markdown coverage stats and exit
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// CLI args
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : args[i + 1] || def; };
const hasFlag = (name) => args.includes(`--${name}`);

const PLATFORM = getArg("platform", "all");
const BATCH_SIZE = parseInt(getArg("batch", "50"), 10);
const MAX_TOTAL = parseInt(getArg("max", "10000"), 10);
const DRY_RUN = hasFlag("dry-run");
const STATS_ONLY = hasFlag("stats");

// Priority order: worst extraction rates first
const PLATFORMS = ["barrett-jackson", "mecum", "bonhams", "bat", "carsandbids", "craigslist", "gooding", "rmsothebys", "collectingcars", "ecr", "jamesedition"];

// ─── HTML to Markdown Conversion ────────────────────────────────────────

function htmlToMarkdown(html) {
  if (!html || html.length < 100) return null;

  let text = html;

  // Remove script, style, nav, footer, header tags and their content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "");

  // Convert headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");

  // Convert dt/dd pairs (critical for C&B-style semantic data)
  text = text.replace(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi, "**$1:** $2\n");

  // Convert list items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  // Convert table rows
  text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (match, content) => {
    const cells = [];
    content.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, (_, cell) => cells.push(cell.trim()));
    return cells.length ? "| " + cells.join(" | ") + " |\n" : "";
  });

  // Convert links (preserve href for reference URLs)
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Convert strong/bold
  text = text.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**");

  // Convert emphasis
  text = text.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  // Convert line breaks and paragraphs
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  text = text.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "\n$1\n");

  // Extract JSON-LD (important for structured data)
  const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  let jsonLdSection = "";
  if (jsonLdMatches) {
    for (const match of jsonLdMatches) {
      const content = match.replace(/<script[^>]*>/, "").replace(/<\/script>/, "").trim();
      if (content.length > 10 && content.length < 5000) {
        jsonLdSection += "\n\n## Structured Data (JSON-LD)\n```json\n" + content + "\n```\n";
      }
    }
  }

  // Extract __NEXT_DATA__ if present (Mecum, BJ)
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  let nextDataSection = "";
  if (nextDataMatch?.[1] && nextDataMatch[1].length < 50000) {
    try {
      const nd = JSON.parse(nextDataMatch[1]);
      // Extract just the pageProps (the useful part)
      const pageProps = nd?.props?.pageProps;
      if (pageProps) {
        const trimmed = JSON.stringify(pageProps, null, 2).slice(0, 10000);
        nextDataSection = "\n\n## Page Data (Next.js)\n```json\n" + trimmed + "\n```\n";
      }
    } catch { /* ignore parse errors */ }
  }

  // Extract RSC data chunks (Barrett-Jackson React Server Components)
  const rscMatches = html.match(/self\.__next_f\.push\(\[[\d,]*"([^"]{50,})"\]\)/g);
  let rscSection = "";
  if (rscMatches && rscMatches.length > 0) {
    const rscData = rscMatches.map(m => {
      const match = m.match(/self\.__next_f\.push\(\[[\d,]*"(.+)"\]\)/);
      return match?.[1] || "";
    }).filter(s => s.length > 50).join("\n");
    if (rscData.length > 100) {
      rscSection = "\n\n## RSC Data\n" + rscData.slice(0, 10000) + "\n";
    }
  }

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Clean up whitespace
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.trim();

  // Append structured data sections
  text += jsonLdSection + nextDataSection + rscSection;

  // Truncate to 20K chars (LLM sweet spot)
  if (text.length > 20000) {
    text = text.slice(0, 20000) + "\n\n[truncated at 20K chars]";
  }

  return text.length > 100 ? text : null;
}

// ─── Download HTML from Storage ─────────────────────────────────────────

async function downloadHtml(storagePath) {
  try {
    const { data, error } = await supabase.storage
      .from("listing-snapshots")
      .download(storagePath);
    if (error || !data) return null;
    return await data.text();
  } catch {
    return null;
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────

async function showStats() {
  const { data } = await supabase.rpc("execute_sql", {
    query: `SELECT platform,
      count(*) as total,
      count(*) FILTER (WHERE markdown IS NOT NULL AND markdown != '') as has_markdown,
      count(*) FILTER (WHERE html_storage_path IS NOT NULL) as has_storage
    FROM listing_page_snapshots WHERE success = true
    GROUP BY platform ORDER BY total DESC`
  });

  // Fallback: direct query
  const { data: stats } = await supabase
    .from("listing_page_snapshots")
    .select("platform", { count: "exact", head: true });

  console.log("\n=== Snapshot Markdown Coverage ===\n");

  // Use simple counts per platform
  for (const plat of PLATFORMS) {
    const { count: total } = await supabase
      .from("listing_page_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("platform", plat)
      .eq("success", true);

    const { count: hasMd } = await supabase
      .from("listing_page_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("platform", plat)
      .eq("success", true)
      .not("markdown", "is", null);

    const pct = total > 0 ? ((hasMd / total) * 100).toFixed(1) : "0.0";
    console.log(`  ${plat.padEnd(20)} ${String(hasMd).padStart(7)} / ${String(total).padStart(7)} (${pct}%)`);
  }
  console.log();
}

// ─── Process a Platform ─────────────────────────────────────────────────

async function processPlatform(platform, maxToProcess) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Platform: ${platform}`);
  console.log("─".repeat(60));

  let processed = 0;
  let converted = 0;
  let failed = 0;
  let empty = 0;
  let offset = 0;

  while (processed < maxToProcess) {
    const batchLimit = Math.min(BATCH_SIZE, maxToProcess - processed);

    // Fetch snapshots needing markdown
    const { data: snapshots, error } = await supabase
      .from("listing_page_snapshots")
      .select("id, platform, html_storage_path, content_length")
      .eq("platform", platform)
      .eq("success", true)
      .is("markdown", null)
      .not("html_storage_path", "is", null)
      .order("content_length", { ascending: false }) // Largest first (most content)
      .range(offset, offset + batchLimit - 1);

    if (error) {
      console.error(`  Query error: ${error.message}`);
      break;
    }

    if (!snapshots || snapshots.length === 0) {
      console.log(`  → No more snapshots needing markdown for ${platform}`);
      break;
    }

    // Process batch
    let batchConverted = 0;
    const updates = [];

    for (const snap of snapshots) {
      processed++;

      if (DRY_RUN) continue;

      // Download HTML from storage
      const html = await downloadHtml(snap.html_storage_path);
      if (!html || html.length < 200) {
        empty++;
        continue;
      }

      // Convert to markdown
      const markdown = htmlToMarkdown(html);
      if (!markdown) {
        failed++;
        continue;
      }

      updates.push({ id: snap.id, markdown });
      batchConverted++;
    }

    // Batch update markdown column
    if (updates.length > 0) {
      for (const upd of updates) {
        const { error: updErr } = await supabase
          .from("listing_page_snapshots")
          .update({ markdown: upd.markdown })
          .eq("id", upd.id);

        if (updErr) {
          console.error(`  Update error for ${upd.id}: ${updErr.message}`);
          failed++;
          batchConverted--;
        }
      }
      converted += batchConverted;
    }

    const elapsed = `${processed}/${maxToProcess}`;
    console.log(
      `  Batch: processed=${snapshots.length} converted=${batchConverted} ` +
      `empty=${empty} failed=${failed} total=${elapsed}`
    );

    // Don't advance offset — we're filtering by markdown IS NULL,
    // so processed items drop out of the result set
    // Small delay between batches
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n  DONE: ${platform} — ${converted} converted, ${failed} failed, ${empty} empty\n`);
  return { platform, converted, failed, empty };
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`Snapshot-to-Markdown Bridge — ${new Date().toISOString()}`);
  console.log(`Platform: ${PLATFORM}, Batch: ${BATCH_SIZE}, Max: ${MAX_TOTAL}`);

  if (STATS_ONLY) {
    await showStats();
    return;
  }

  const platforms = PLATFORM === "all" ? PLATFORMS : [PLATFORM];
  const results = [];
  let remaining = MAX_TOTAL;

  for (const plat of platforms) {
    if (remaining <= 0) break;
    const result = await processPlatform(plat, remaining);
    results.push(result);
    remaining -= result.converted;
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.platform}: ${r.converted} converted, ${r.failed} failed, ${r.empty} empty`);
  }
  console.log(`\nTotal: ${results.reduce((s, r) => s + r.converted, 0)} snapshots converted to markdown`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
