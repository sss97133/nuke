/**
 * Mendable sanity check + (optional) ingestion helpers, via Supabase Edge Function proxy.
 *
 * Why this exists:
 * - It's easy to accidentally point at the wrong Mendable project/key.
 * - `getSources` gives a quick "are we talking to the right dataset?" signal (count + date range).
 * - If needed, you can kick off Mendable ingestion via `/v1/ingestData` and poll `/v1/ingestionStatus`.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/mendable-sanity-and-ingest.js
 *
 * Start ingestion (website crawler / sitemap / url / github / youtube / docusaurus):
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/mendable-sanity-and-ingest.js ingest \
 *     --type sitemap \
 *     --url "https://example.com/sitemap.xml"
 *
 * Poll ingestion status:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/mendable-sanity-and-ingest.js status --task_id 1234567890
 */

import dotenv from "dotenv";

dotenv.config();

if (typeof fetch !== "function") {
  console.error("This script requires Node 18+ (global fetch).");
  process.exit(1);
}

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY (or VITE_ equivalents).");
  process.exit(1);
}

async function postSupabaseFunction(functionName, body) {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.details = json;
    err.status = res.status;
    throw err;
  }

  return json;
}

async function callMendableProxy(body) {
  const candidates = ["query-mendable-v2", "query-mendable"];
  let lastErr;
  for (const fn of candidates) {
    try {
      return await postSupabaseFunction(fn, body);
    } catch (err) {
      lastErr = err;
      if (![401, 403, 404].includes(err.status)) throw err;
    }
  }
  throw lastErr || new Error("Unable to call Mendable proxy");
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function sanity() {
  const sourcesResp = await callMendableProxy({ action: "getSources" });
  const list = Array.isArray(sourcesResp?.result) ? sourcesResp.result : [];

  const dates = list
    .map((s) => (typeof s?.date_added === "string" ? new Date(s.date_added) : null))
    .filter((d) => d && !Number.isNaN(d.valueOf()));

  const minDate = dates.length ? new Date(Math.min(...dates.map((d) => d.valueOf()))) : null;
  const maxDate = dates.length ? new Date(Math.max(...dates.map((d) => d.valueOf()))) : null;

  const domainCounts = new Map();
  for (const s of list) {
    const url = s?.source || s?.metadata?.sourceURL || null;
    if (typeof url !== "string") continue;
    const d = domainFromUrl(url);
    if (!d) continue;
    domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
  }

  const topDomains = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log(`Mendable getSources: ${list.length} sources`);
  if (minDate && maxDate) {
    console.log(`date_added range: ${minDate.toISOString()} → ${maxDate.toISOString()}`);
  }
  if (topDomains.length) {
    console.log("\nTop domains:");
    for (const [d, c] of topDomains) console.log(`- ${d}: ${c}`);
  }

  // Print a few samples for quick eyeballing
  if (list.length) {
    console.log("\nSample sources:");
    for (const s of list.slice(0, 5)) {
      console.log(`- ${s?.source || s?.metadata?.sourceURL || JSON.stringify(s)}`);
    }
  }
}

async function ingest(args) {
  const type = args.type;
  const url = args.url;
  const includePaths = args.include_paths ? String(args.include_paths).split(",").filter(Boolean) : undefined;
  const excludePaths = args.exclude_paths ? String(args.exclude_paths).split(",").filter(Boolean) : undefined;

  if (!type || !url) {
    console.error("Usage: node scripts/mendable-sanity-and-ingest.js ingest --type <type> --url <url>");
    console.error("Supported types per docs: website-crawler | docusaurus | github | youtube | url | sitemap");
    process.exit(1);
  }

  const params = {
    type,
    url,
    ...(Array.isArray(includePaths) && includePaths.length ? { include_paths: includePaths } : {}),
    ...(Array.isArray(excludePaths) && excludePaths.length ? { exclude_paths: excludePaths } : {}),
  };

  const resp = await callMendableProxy({ action: "ingestData", params });
  console.log("ingestData: ok");
  console.log(JSON.stringify(resp?.result ?? resp, null, 2));
  const taskId = resp?.result?.task_id ?? resp?.result?.taskId ?? null;
  if (taskId) console.log(`\nNext: node scripts/mendable-sanity-and-ingest.js status --task_id ${taskId}`);
}

async function status(args) {
  const taskId = args.task_id || args.taskId;
  if (!taskId) {
    console.error("Usage: node scripts/mendable-sanity-and-ingest.js status --task_id <id>");
    process.exit(1);
  }

  const resp = await callMendableProxy({ action: "ingestionStatus", params: { task_id: String(taskId) } });
  console.log("ingestionStatus: ok");
  console.log(JSON.stringify(resp?.result ?? resp, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!cmd) return await sanity();
  if (cmd === "ingest") return await ingest(args);
  if (cmd === "status") return await status(args);

  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  if (err.details) console.error("Details:", JSON.stringify(err.details).slice(0, 4000));
  process.exit(1);
});

