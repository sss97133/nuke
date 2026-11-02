#!/usr/bin/env -S deno run --cached-only --node-modules-dir=none --allow-env --allow-read --allow-write --allow-run --allow-sys --allow-net
/** Public Gateway acquisition using the installed browser. Default stages privately;
 * --land retains captures and calls existing ingest. No user browser profile, cookies,
 * login, proxy, renderer subscription or model inference is used. */
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { retainFetchedCapture } from "../supabase/functions/_shared/archiveFetch.ts";
import { gatewayInventoryUrls, parseGatewayListing } from "../supabase/functions/_shared/gatewayParser.ts";
import { intakeThrottle } from "../supabase/functions/poll-listing-feeds/ledger.ts";
import { projectSecretKey } from "../supabase/functions/_shared/supabaseKeys.ts";

const args = Deno.args;
const option = (name: string) => { const n = args.indexOf(name); return n >= 0 ? args[n + 1] : undefined; };
const replayDir = option("--replay-dir");
const staged = replayDir ? JSON.parse(await Deno.readTextFile(`${resolve(replayDir)}/receipt.json`)) : null;
const land = args.includes("--land");
if (replayDir && !land) throw Error("--replay-dir requires --land");
const stateFile = option("--state-file");
if (land && !stateFile) throw Error("--land requires a private --state-file for cadence and target rotation");
let state: any = { targets: {} };
const requested = Number(option("--limit") ?? 20);
if (!Number.isInteger(requested) || requested < 1 || requested > 20) throw Error("--limit must be 1..20");
const project = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
if (project !== "https://qkgaybvrernstplzjaam.supabase.co") throw Error("Expected existing Nuke project");
Deno.env.set("SUPABASE_URL", project);
const key = projectSecretKey();
if (!key) throw Error("Existing service key required; never pass credentials through browser context");
const db = createClient(project, key, { auth: { persistSession: false, autoRefreshToken: false } });
const feedId = "c68aa94a-68aa-475b-847d-4b0672e7beee";
const [feedRead, controlRead] = await Promise.all([
  db.from("listing_feeds").select("id,source_slug,enabled,feed_url,poll_interval_minutes,last_polled_at").eq("id", feedId).single(),
  db.from("platform_config").select("config_value").eq("config_key", "source_intake").maybeSingle(),
]);
if (feedRead.error || controlRead.error) throw Error("Intake controls unavailable");
const feed = feedRead.data, control = intakeThrottle(controlRead.data?.config_value ?? {});
const source = control.sources.gateway_classics;
if (!feed.enabled || feed.source_slug !== "gateway_classics" || !control.enabled || !control.max_feeds || !control.max_ingests
  || source?.enabled === false || source?.max_ingests === 0) throw Error("Gateway intake is held; no browser started");
const limit = Math.min(requested, control.max_ingests, source?.max_ingests ?? 20);
const directory = resolve(option("--receipt-dir") ?? await Deno.makeTempDir({ prefix: "nuke-gateway-" }));
const repo = resolve(dirname(new URL(import.meta.url).pathname), "..");
if (directory === repo || directory.startsWith(repo + "/") || (stateFile && (resolve(stateFile) === repo || resolve(stateFile).startsWith(repo + "/")))) throw Error("Raw source receipts must stay outside the public checkout");
await Deno.mkdir(directory, { recursive: true, mode: 0o700 });
const { chromium } = createRequire(new URL("../package.json", import.meta.url))("playwright");
const browserEnv = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].flatMap(name => Deno.env.get(name) ? [[name, Deno.env.get(name)!]] : []));
let browser: any = null;
let producerLock: Deno.FsFile | null = null;
const runId = staged?.run_id ?? crypto.randomUUID();
let runOwned = false;
const receipt: Record<string, any> = { run_id: runId, started_at: staged?.started_at ?? new Date().toISOString(), mode: land ? "land" : "stage_only", feed_id: feedId,
  source: "gateway_classics", limit, source_population: null, pages: [], outcomes: [], model_calls: 0 };
const persist = async (status = "running") => {
  if (!land || (status === "failed" && !runOwned)) return;
  const metadata = { profile: "public_gateway_browser_v1", feed_id: feedId, pages: receipt.pages.map((p: any) => ({
    url: p.url, inventory: p.inventory, observed_at: p.observed_at, http_status: p.http_status, capture: p.capture })), outcomes: receipt.outcomes };
  const saved = await db.from("extraction_runs").upsert({ id: runId, source: "gateway-browser", started_at: receipt.started_at,
    status, completed_at: status === "running" ? null : new Date().toISOString(), metadata }).select("id");
  if (saved.error || saved.data?.length !== 1 || saved.data[0].id !== runId) throw Error("Browser progress not acknowledged");
  runOwned = true;
};
try {
  if (land && stateFile) {
    producerLock = await Deno.open(stateFile + ".lock", { create: true, read: true, write: true, mode: 0o600 });
    if (!producerLock.tryLockSync(true)) throw Error("Gateway browser collector already running");
    const existing = await db.from("extraction_runs").select("id,source,status,metadata").eq("id", runId).maybeSingle();
    if (existing.error || (existing.data && (existing.data.source !== "gateway-browser" || existing.data.metadata?.profile !== "public_gateway_browser_v1"))) throw Error("Browser run namespace unavailable");
    if (existing.data?.status === "completed") { console.log(JSON.stringify({ status: "already_completed", run_id: runId, writes: 0 })); Deno.exit(0); }
    // Read cadence under the process lock, so another invocation cannot use stale state.
    try { state = JSON.parse(await Deno.readTextFile(stateFile)); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
    if (!state.targets || typeof state.targets !== "object") throw Error("Invalid Gateway scheduling state");
    if (state.last_run_at && state.last_run_id !== staged?.run_id && Date.now() - Date.parse(state.last_run_at) < feed.poll_interval_minutes * 60_000) {
      console.log(JSON.stringify({ status: "not_due" })); Deno.exit(0);
    }
    const capability = await db.functions.invoke("ingest", { method: "GET" });
    if (capability.error || capability.data?.capabilities?.gateway_browser_native !== true) throw Error("Native Gateway intake is not deployed; no landing started");
  }
  if (staged && (staged.feed_id !== feedId || staged.source !== "gateway_classics" || !/^[0-9a-f-]{36}$/.test(runId))) throw Error("Staged source identity invalid");
  browser = replayDir ? null : await chromium.launch({ headless: true, env: browserEnv });
  await persist();
  const context = browser ? await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }) : null;
  const page = context ? await context.newPage() : null;
  const lastNavigation = { url: "", status: 0 };
  page?.on("response", (response: any) => {
    if (response.request().isNavigationRequest() && response.frame() === page?.mainFrame()) Object.assign(lastNavigation, { url: response.url(), status: response.status() });
  });
  // Ordinary unsigned public session warmup was part of the working collector.
  if (page) {
    await page.goto("https://gatewayclassiccars.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4000);
  }
  const capture = async (url: string, inventory: boolean): Promise<any> => {
    let html: string, observedAt: string;
    if (staged) {
      const saved = staged.pages?.find((p: any) => p.url === url && p.inventory === inventory);
      if (!saved || saved.http_status !== 200 || !/^inventory\.html$|^listing-\d+\.html$/.test(saved.file ?? "")
        || Date.parse(saved.observed_at) < Date.now() - feed.poll_interval_minutes * 60_000) throw Error("Staged browser visit is missing, invalid or stale");
      html = await Deno.readTextFile(`${resolve(replayDir!)}/${saved.file}`); observedAt = saved.observed_at;
    } else {
      Object.assign(lastNavigation, { url: "", status: 0 });
      await page!.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page!.waitForFunction((kind: string) => (Array.from((globalThis as any).document.querySelectorAll('script[type="application/ld+json"]')) as any[])
        .some(node => node.textContent?.includes(kind)), inventory ? "Gateway Classic Cars Inventory" : "vehicleModelDate", { timeout: 25_000 });
      html = await page!.content(); observedAt = new Date().toISOString();
      if (lastNavigation.status !== 200 || page!.url().replace(/\/$/, "") !== url.replace(/\/$/, "")) throw Error("Browser did not receive a successful public source document");
    }
    const stem = inventory ? "inventory" : `listing-${receipt.pages.length}`;
    await Deno.writeTextFile(`${directory}/${stem}.html`, html, { mode: 0o600 });
    const row: Record<string, any> = { url, inventory, observed_at: observedAt, http_status: 200, bytes: new TextEncoder().encode(html).byteLength, file: `${stem}.html` };
    if (land) {
      const ack = await retainFetchedCapture(db, { platform: "gateway_classics", url, html, httpStatus: 200, fetchedAt: observedAt,
        metadata: { browser_rendered_dom: true, acquisition: "public_browser", caller: "gateway-browser-capture" } });
      if (!("snapshot_id" in ack)) throw Error(`Capture not acknowledged: ${ack.reason}`);
      row.capture = ack;
    }
    receipt.pages.push(row);
    await persist();
    await Deno.writeTextFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
    const parsed = inventory ? { urls: gatewayInventoryUrls(html) } : parseGatewayListing(html, url);
    row.parsed = parsed;
    return parsed;
  };
  const inventory = await capture(feed.feed_url, true);
  receipt.discovered_items = inventory.urls.length;
  // The cursor is an operational scheduling cache, never source testimony.
  const positions = new Map(inventory.urls.map((url: string, n: number) => [url, n]));
  const eligible = staged ? inventory.urls.filter((url: string) => staged.pages.some((p: any) => !p.inventory && p.url === url)) : inventory.urls;
  const urls: string[] = [...eligible].sort((a, b) =>
    (Date.parse(state.targets?.[a]?.attempted_at ?? "") || 0) - (Date.parse(state.targets?.[b]?.attempted_at ?? "") || 0)
    || Number(positions.get(a)) - Number(positions.get(b))).slice(0, limit);
  if (land) { state.last_run_at = receipt.started_at; state.last_run_id = runId; }
  for (const url of urls) {
    if (page) await page.waitForTimeout(2000);
    if (land) state.targets[url] = { attempted_at: new Date().toISOString() };
    try {
      const parsed = await capture(url, false);
      if (land) {
        const response = await db.functions.invoke("ingest", { body: { url, ...parsed, enrich: false } });
        if (response.error || !response.data?.gateway_receipt?.observation_id || !response.data?.vehicle_id) throw Error("Gateway canonical intake not acknowledged");
        receipt.outcomes.push({ url, status: response.data.status, vehicle_id: response.data.vehicle_id, ...response.data.gateway_receipt });
      }
    } catch (error) { receipt.outcomes.push({ url, status: "failed", error: String(error) }); }
    await Deno.writeTextFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
    if (land && stateFile) await Deno.writeTextFile(stateFile, JSON.stringify(state) + "\n", { mode: 0o600 });
  }
  receipt.completed_at = new Date().toISOString();
  receipt.status = receipt.outcomes.some((v: any) => v.status === "failed") ? "partial" : "completed";
  await persist(receipt.status === "completed" ? "completed" : "failed");
  if (land && receipt.status === "completed") {
    const progress = await db.functions.invoke("poll-listing-feeds", { body: { feed_id: feedId, batch_size: 1, force: true } });
    receipt.feed_progress = progress.error ? { status: "unavailable" } : progress.data;
  }
} catch (error) {
  receipt.status = "failed"; receipt.error = String(error);
  await persist("failed");
  throw error;
} finally {
  if (browser) await browser.close();
  if (producerLock) producerLock.close();
  await Deno.writeTextFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({ status: receipt.status, mode: receipt.mode, directory, captured: receipt.pages.length, outcomes: receipt.outcomes.length, model_calls: 0 }));
if (receipt.status !== "completed") Deno.exit(1);
