#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
/** One-off, resumable Vicari catalog ingestion. No cron, paid extraction or raw testimony writes.
 * Run under the existing dotenvx environment. Keep manifests/receipts outside the public repository.
 * --manifest /private/path/manifest.json --discover [--max-pages 2000]
 * --manifest /private/path/manifest.json --ingest [--limit 20] [--concurrency 2]
 * --manifest /private/path/manifest.json --retain-local /private/path/capture-receipts.jsonl
 * Discovery retains pages with archiveFetch; lots go only through the deployed ingest function.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { archiveFetch, retainFetchedCapture } from "../../supabase/functions/_shared/archiveFetch.ts";
import { vicariCatalogLinks, vicariListingId, vicariUrl } from "../../supabase/functions/_shared/vicariParser.ts";

const args = Deno.args;
const arg = (name: string) => args[args.indexOf(name) + 1];
const has = (name: string) => args.includes(name);
const integer = (name: string, fallback: number, max: number) => {
  const n = has(name) ? Number(arg(name)) : fallback;
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${name}`);
  return n;
};
if (!has("--manifest") || !arg("--manifest")?.startsWith("/")) throw new Error("--manifest requires an absolute private path");
if (["--discover", "--ingest", "--retain-local"].filter(has).length !== 1) throw new Error("Choose exactly one action");
const manifestPath = arg("--manifest"), receiptsPath = manifestPath + ".receipts.jsonl";
const supaUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (supaUrl !== "https://qkgaybvrernstplzjaam.supabase.co" || !key) throw new Error("Expected Nuke project environment");
const db = createClient(supaUrl, key, { auth: { persistSession: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(120_000) }) } });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const append = (record: unknown) => Deno.writeTextFile(receiptsPath, JSON.stringify(record) + "\n", { append: true, create: true });
type Manifest = { version: 1; source: "vicari"; started_at: string; queue: string[]; visited: Record<string, { snapshot_id: string; lot_count: number }>; lots: string[]; discovery_complete: boolean };
let manifest: Manifest;
try { manifest = JSON.parse(await Deno.readTextFile(manifestPath)); }
catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  manifest = { version: 1, source: "vicari", started_at: new Date().toISOString(),
    queue: ["https://www.vicariauction.com/auction-house/"], visited: {}, lots: [], discovery_complete: false };
}
if (manifest.version !== 1 || manifest.source !== "vicari" || !Array.isArray(manifest.lots)) throw new Error("Invalid manifest");
const save = async () => {
  await Deno.writeTextFile(manifestPath + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
  await Deno.rename(manifestPath + ".tmp", manifestPath);
};
await save();

if (has("--retain-local")) {
  // Only files explicitly recorded by the earlier permitted capture pass, with their original hash and clock.
  const file = arg("--retain-local"), root = file.slice(0, file.lastIndexOf("/"));
  for (const line of (await Deno.readTextFile(file)).trim().split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line), id = vicariListingId(r.url);
    if (!id || !/^captures\/lot-\d+\.html$/.test(r.file) || r.http_status !== 200) throw new Error("Invalid local capture receipt");
    const html = await Deno.readTextFile(`${root}/${r.file}`);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html)))].map(b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== r.sha256) throw new Error("Local capture hash mismatch");
    const retained = await retainFetchedCapture(db, { platform: "vicari", url: r.url, html,
      httpStatus: 200, fetchedAt: r.received_at, metadata: { caller: "vicari-ingest", capture_method: "public_http" } });
    await append({ action: "retain", id, ...retained, recorded_at: new Date().toISOString() });
    if ("reason" in retained) throw new Error(retained.reason);
  }
  console.log(JSON.stringify({ action: "retain", complete: true }));
} else if (has("--discover")) {
  const maxPages = integer("--max-pages", 2000, 5000);
  const lots = new Set(manifest.lots);
  let pages = 0;
  while (manifest.queue.length && pages < maxPages) {
    const url = manifest.queue[0], parsed = new URL(url);
    if (parsed.origin !== "https://www.vicariauction.com" || parsed.pathname !== "/auction-house/") throw new Error("Unexpected catalog target");
    if (manifest.visited[url]) { manifest.queue.shift(); continue; }
    const capture = await archiveFetch(url, { platform: "vicari", callerName: "vicari-catalog-discovery",
      useFirecrawl: false, firecrawlOnBlock: false, directFetchOptions: { publicOnly: true, timeout: 20_000 } });
    if (capture.error || capture.archiveError || !capture.snapshotId || !capture.html) throw new Error(`Catalog capture unavailable: ${url}`);
    const links = vicariCatalogLinks(capture.html, url);
    for (const lot of links.lots) lots.add(lot);
    manifest.visited[url] = { snapshot_id: capture.snapshotId, lot_count: links.lots.length };
    manifest.queue.shift();
    for (const next of links.catalogs) if (!manifest.visited[next] && !manifest.queue.includes(next)) manifest.queue.push(next);
    manifest.lots = [...lots]; manifest.discovery_complete = manifest.queue.length === 0;
    await save(); pages++;
    if (pages % 10 === 0) console.log(JSON.stringify({ pages: Object.keys(manifest.visited).length, lots: lots.size, pending_pages: manifest.queue.length }));
    await pause(500);
  }
  console.log(JSON.stringify({ action: "discover", complete: manifest.discovery_complete, pages: Object.keys(manifest.visited).length,
    lots: manifest.lots.length, pending_pages: manifest.queue.length }));
} else {
  const limit = integer("--limit", 20, 50_000), concurrency = integer("--concurrency", 2, 4);
  const done = new Set<string>();
  try {
    for (const line of (await Deno.readTextFile(receiptsPath)).trim().split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.action === "ingest" && r.verified === true) done.add(r.url);
    }
  } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  const pending = manifest.lots.filter(url => !done.has(url)).slice(0, limit);
  let index = 0, completed = 0, stopped = false;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!stopped && index < pending.length) {
      const url = pending[index++];
      if (!vicariListingId(url)) throw new Error("Invalid lot target");
      const result = await db.functions.invoke("ingest", { body: { url } });
      const receipt = result.data?.vicari_receipt;
      const verified = !result.error && ["created", "matched", "unresolved"].includes(result.data?.status)
        && typeof receipt?.observation_id === "string" && typeof receipt?.snapshot_id === "string";
      await append({ action: "ingest", url, recorded_at: new Date().toISOString(), verified, result: result.data,
        error: result.error ? String(result.error.message) : null });
      if (!verified) { stopped = true; break; }
      completed++;
      console.log(JSON.stringify({ completed, attempted_limit: pending.length, source_id: receipt.source_id,
        vehicle_id: result.data.vehicle_id, images: receipt.images, unresolved: receipt.unresolved }));
      await pause(250);
    }
  }));
  console.log(JSON.stringify({ action: "ingest", completed, already_verified: done.size, enumerated_lots: manifest.lots.length,
    remaining: manifest.lots.length - done.size - completed, discovery_complete: manifest.discovery_complete, stopped }));
  if (stopped) Deno.exit(1);
}
