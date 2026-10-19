#!/usr/bin/env tsx
/**
 * Import permitted browser captures through the existing canonical Facebook writer.
 * No source fetching, cookies, private endpoints, inference, direct DB writes or alerts.
 *
 * Installed loader: node --import tsx scripts/fb-import-urls.ts --capture <file> [--land]
 * Default: validate and stage. --land: send the immutable prepared pass, retain per-item receipts.
 * A new source visit needs a new capture_id/observed_at. A retry reuses the same prepared file.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateCapture } from "../supabase/functions/extract-facebook-marketplace/capture.ts";

export function parseCardLine(line: string) {
  const id = line.match(/facebook\.com\/marketplace\/item\/(\d+)/)?.[1];
  if (!id) return null;
  let text = line.replace(/^\s*(?:\d+\s+)?link\s+/, "");
  text = text.replace(/^Value:\s*facebook\.com\/marketplace\/item\/\d+\/?\s*,?\s*/, "")
    .replace(/,?\s*Value:\s*facebook\.com\/marketplace\/item\/\d+\/?\s*$/, "")
    .replace(/,?\s*listing\s+\d+\s*$/, "").trim();
  const priceMatch = text.match(/(?:^|,\s*)\$([\d,]+)(?=,|$)/);
  const title = priceMatch ? text.slice(0, priceMatch.index).replace(/,\s*$/, "").trim() : text;
  const price = priceMatch ? Number(priceMatch[1].replaceAll(",", "")) : null;
  const remainder = priceMatch ? text.slice(priceMatch.index! + priceMatch[0].length).replace(/^,\s*/, "") : "";
  const location = remainder.replace(/^reduced from \$[\d,]+,\s*/, "").trim() || null;
  const year = title.match(/^(19\d{2}|20\d{2})\s+/)?.[1];
  // Priority orders processing only. Unknown/newer years and non-car vehicle cards stay captured.
  return { facebook_id: id, url: `https://www.facebook.com/marketplace/item/${id}/`, title,
    ...(price !== null ? { price } : {}), ...(location ? { location } : {}),
    ...(year ? { parsed_year: Number(year) } : {}), content_text: line,
    status: "active", agent_context: { agent_id: "fb-browser-capture", session_type: "browser_search_card" } };
}

export function prepareCapture(input: any) {
  if (input.mode === "browser_capture") {
    validateCapture(input.capture, input.batch);
    return input;
  }
  const { card_lines, source: _source, ...scope } = input;
  if (!Array.isArray(card_lines)) throw new Error("browser card_lines or a prepared browser_capture packet required");
  const batch = []; const ids = new Set(); let duplicates = 0; let parseFailures = 0;
  for (const line of card_lines) {
    const item = typeof line === "string" ? parseCardLine(line) : null;
    if (!item) { parseFailures++; continue; }
    if (ids.has(item.facebook_id)) { duplicates++; continue; }
    ids.add(item.facebook_id); batch.push(item);
  }
  const priority = (year?: number) => Number(year != null && year >= 1960 && year <= 1990);
  batch.sort((a, b) => priority(b.parsed_year) - priority(a.parsed_year));
  const capture = { ...scope, capture_id: scope.capture_id ?? randomUUID(), access_state: scope.access_state ?? "available" };
  validateCapture(capture, batch);
  return { mode: "browser_capture", capture, batch, local_parse: { input_cards: card_lines.length, duplicates, parse_failures: parseFailures } };
}

export async function main(args = process.argv.slice(2)) {
  const index = args.indexOf("--capture");
  if (index < 0 || !args[index + 1]) throw new Error("use --capture <permitted-browser-capture.json>; URL scraping is retired");
  const file = path.resolve(args[index + 1]);
  const preparedFile = file.endsWith(".prepared.json") ? file : `${file}.prepared.json`;
  // Resume always uses the originally prepared UUID and testimony, never recaptures or silently changes a pass.
  const input = JSON.parse(fs.readFileSync(fs.existsSync(preparedFile) ? preparedFile : file, "utf8"));
  const prepared = prepareCapture(input);
  if (!fs.existsSync(preparedFile)) fs.writeFileSync(preparedFile, JSON.stringify(prepared, null, 2), { mode: 0o600, flag: "wx" });
  if (!args.includes("--land")) {
    console.log(JSON.stringify({ stage: "local", capture_id: prepared.capture.capture_id, cards: prepared.batch.length,
      observed_at: prepared.capture.observed_at, parse: prepared.local_parse ?? null, prepared_file: preparedFile })); return;
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("existing Supabase URL/service key required; no anonymous landing");
  if (new URL(supabaseUrl).hostname !== "qkgaybvrernstplzjaam.supabase.co") throw new Error("unexpected Nuke destination");
  const response = await fetch(`${supabaseUrl}/functions/v1/extract-facebook-marketplace`, {
    method: "POST", headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify(prepared), signal: AbortSignal.timeout(120_000),
  });
  const receipt = await response.json();
  const receiptFile = `${preparedFile}.receipts.jsonl`;
  fs.appendFileSync(receiptFile, JSON.stringify({ attempted_at: new Date().toISOString(), http_status: response.status, receipt }) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ stage: response.ok && receipt.success ? "landed" : "partial_or_failed",
    http_status: response.status, capture_id: prepared.capture.capture_id, counts: receipt.counts ?? null,
    error: receipt.error ?? null, receipt_file: receiptFile }));
  if (!response.ok || !receipt.success) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
}
