// load_archive_comments.ts — auction_comments for BaT lots whose page is saved locally, through the reader's own
// row builder (extract-bat-core v4.1 writes the same rows from the same code), upserted the way the reader does:
// POST auction_comments, on_conflict=vehicle_id,content_hash, resolution=ignore-duplicates. Nothing is fetched
// from BaT; nothing is written as SQL.
//
//   dotenvx run -q -- deno run -A scripts/bat-corrections/load_archive_comments.ts <vehicles.tsv> <log.jsonl> [--write] [--limit N] [--skip K]
//
// <vehicles.tsv>: vehicle_id \t lot url, one per line (the cohort export). Dry run by default: builds every row,
// runs the integrity checks, writes nothing. --write upserts. Every lot logs one JSON line: slug, vehicle_id,
// rows built, text-less, bids, late (post-close) comments, archive events/bids for the slug (scripts/data archive
// export), rows in the DB after the write, ms. A REST probe every 25 lots; > 3 s pauses 120 s; 5 strikes stop the run.
import { readCommentsJson, summarizeAuction, buildAuctionCommentRows, linkAuctionCommentIdentities } from "../../supabase/functions/_shared/batAuctionRecord.ts";

const [tsvPath, logPath, ...flags] = Deno.args;
if (!tsvPath || !logPath) { console.error("usage: load_archive_comments.ts <vehicles.tsv> <log.jsonl> [--write] [--limit N] [--skip K]"); Deno.exit(2); }
const WRITE = flags.includes("--write");
const LIMIT = Number(flags[flags.indexOf("--limit") + 1] || 0) || Infinity;
const SKIP = Number(flags[flags.indexOf("--skip") + 1] || 0) || 0;
const HTML_DIR = Deno.env.get("BAT_HTML_DIR") || "/Users/skylar/nuke/scripts/data/bat-lots/html";
const ARCHIVE_COUNTS = Deno.env.get("BAT_ARCHIVE_COUNTS") || "";
const SUPA = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!SUPA || !KEY) { console.error("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run under dotenvx)"); Deno.exit(2); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const archive: Record<string, { n_events: number; n_bids: number; first_at: string; last_at: string }> = {};
if (ARCHIVE_COUNTS) for (const r of JSON.parse(await Deno.readTextFile(ARCHIVE_COUNTS))) archive[r.slug] = r;

const slugOf = (url: string) => url.replace(/\/+$/, "").split("/listing/")[1] ?? "";
const normUrl = (url: string) => `https://bringatrailer.com/listing/${slugOf(url)}/`;

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPA}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> || {}) } });
}
async function probeSeconds(): Promise<number> {
  const t0 = performance.now();
  await rest("vehicles?select=id&limit=1");
  return (performance.now() - t0) / 1000;
}
async function countComments(vehicleId: string): Promise<number> {
  const r = await rest(`auction_comments?vehicle_id=eq.${vehicleId}&select=id`, { method: "HEAD", headers: { Prefer: "count=exact" } });
  return Number(r.headers.get("content-range")?.split("/")[1] ?? -1);
}
async function existingBatCommentIds(vehicleId: string): Promise<Set<number>> {
  const r = await rest(`auction_comments?vehicle_id=eq.${vehicleId}&bat_comment_id=not.is.null&select=bat_comment_id&limit=5000`);
  const j = await r.json().catch(() => []);
  return new Set((Array.isArray(j) ? j : []).map((x: any) => Number(x.bat_comment_id)).filter(Number.isFinite));
}
async function auctionEventId(vehicleId: string, sourceUrl: string): Promise<string | null> {
  const r = await rest(`auction_events?vehicle_id=eq.${vehicleId}&source_url=eq.${encodeURIComponent(sourceUrl)}&select=id&limit=1`);
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j[0]?.id ? String(j[0].id) : null;
}

const lines = (await Deno.readTextFile(tsvPath)).split("\n").filter(Boolean).slice(SKIP);
const done = new Set<string>();
try { for (const l of (await Deno.readTextFile(logPath)).split("\n")) { if (!l) continue; const d = JSON.parse(l); if (d.written_ok) done.add(d.vehicle_id); } } catch { /* fresh log */ }
const log = await Deno.open(logPath, { append: true, create: true });
const enc = new TextEncoder();
let n = 0, strikes = 0, totals = { lots: 0, rows: 0, textless: 0, bids: 0, written: 0, no_html: 0, count_mismatch: 0, bid_mismatch: 0, late_comments: 0 };

for (const line of lines) {
  if (n >= LIMIT) break;
  const [vehicleId, url] = line.split("\t");
  if (!vehicleId || !url || done.has(vehicleId)) continue;
  n++;
  if (n % 25 === 1) {
    const t = await probeSeconds();
    if (t > 3) { strikes++; console.error(`${new Date().toISOString()} probe ${t.toFixed(2)}s > 3 s (strike ${strikes}); pausing 120 s`); await new Promise((r) => setTimeout(r, 120_000)); if (strikes >= 5) { console.error("STOPPING: prod stayed slow"); break; } }
  }
  const slug = slugOf(url);
  const t0 = performance.now();
  const rec: Record<string, unknown> = { slug, vehicle_id: vehicleId, write: WRITE };
  let path = `${HTML_DIR}/${slug}.html.gz`;
  let gz: Uint8Array | null = null;
  try { gz = await Deno.readFile(path); } catch { rec.no_html = true; totals.no_html++; await log.write(enc.encode(JSON.stringify(rec) + "\n")); continue; }
  const html = await new Response(new Blob([gz as unknown as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  const raw: any[] = readCommentsJson(html) ?? [];
  const auction = summarizeAuction(html);
  const listingUrlNorm = normUrl(url);
  const endAt = auction.recordAt ? new Date(auction.recordAt) : null;
  const eventId = WRITE ? await auctionEventId(vehicleId, listingUrlNorm) : null;
  const rows = await buildAuctionCommentRows({ rawComments: raw, listingUrlNorm, vehicleId, auctionEventId: eventId, endAt });
  // a BaT thread stays open after the close — comments arrive weeks or years later (23 of the 200 pilot lots,
  // 41 rows; e.g. 1966-mercedes-benz-230sl-4 closed 2017-09-28, commented 2019-10-09). They are interactions at
  // their exact moments and are written; the count is logged so a lot's late tail is visible.
  const late = endAt ? rows.filter((r) => Date.parse(r.posted_at) > endAt.getTime() + 7 * 86_400_000).length : 0;
  if (late) { rec.late_comments = late; totals.late_comments += late; }
  const textless = rows.filter((r) => !r.comment_text).length, bids = rows.filter((r) => r.comment_type === "bid").length;
  Object.assign(rec, { raw_comments: raw.length, rows: rows.length, textless, bids, seq_max: rows.length ? Math.max(...rows.map((r) => r.sequence_number)) : 0, record_parsed: auction.parsed, end_at: endAt?.toISOString() ?? null, auction_event_id: eventId });
  const a = archive[slug];
  if (a) { rec.archive_events = a.n_events; rec.archive_bids = a.n_bids; if (a.n_bids !== bids) { rec.bid_mismatch = true; totals.bid_mismatch++; } }
  totals.lots++; totals.rows += rows.length; totals.textless += textless; totals.bids += bids;
  if (WRITE && rows.length) {
    const before = await countComments(vehicleId);
    // a BaT comment the vehicle already holds (by BaT's own comment id) is never written again, whatever its
    // position in today's JSON — content_hash carries the sequence number, which shifts as a thread grows
    const have = await existingBatCommentIds(vehicleId);
    const fresh = have.size ? rows.filter((r) => r.bat_comment_id == null || !have.has(r.bat_comment_id)) : rows;
    if (fresh.length !== rows.length) rec.already_present = rows.length - fresh.length;
    let err: string | null = null;
    try {
      const linked = await linkAuctionCommentIdentities(fresh, {
        async find(handles) {
          // PostgREST quoted IN values preserve punctuation and exact case in public handles.
          const values = handles.map((h) => `"${h.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
          const params = new URLSearchParams({ select: "id,handle", platform: "eq.bat", handle: `in.(${values})` });
          const r = await rest(`external_identities?${params}`);
          if (!r.ok) throw new Error(`Identity lookup: ${r.status} ${(await r.text()).slice(0, 300)}`);
          return await r.json();
        },
        async insertMissing(identities) {
          const r = await rest("external_identities?on_conflict=platform,handle", {
            method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(identities),
          });
          if (!r.ok) throw new Error(`Identity insert: ${r.status} ${(await r.text()).slice(0, 300)}`);
        },
      });
      rec.identities_linked = linked.filter((r) => r.external_identity_id).length;
      for (let i = 0; i < linked.length && !err; i += 200) {
        const r = await rest("auction_comments?on_conflict=vehicle_id,content_hash", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(linked.slice(i, i + 200)) });
        if (!r.ok) err = `${r.status} ${(await r.text()).slice(0, 300)}`;
      }
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    const after = await countComments(vehicleId);
    Object.assign(rec, { db_before: before, db_after: after, write_error: err });
    if (!err && after === before + fresh.length) { rec.written_ok = true; totals.written += fresh.length; }
    else { rec.count_mismatch = true; totals.count_mismatch++; }
    if (err && /5[0-9]{2}|57014|55P03|42501|23514/.test(err)) { console.error(`STOPPING on write error for ${slug}: ${err}`); await log.write(enc.encode(JSON.stringify({ ...rec, ms: Math.round(performance.now() - t0) }) + "\n")); break; }
  }
  rec.ms = Math.round(performance.now() - t0);
  await log.write(enc.encode(JSON.stringify(rec) + "\n"));
}
console.log(JSON.stringify({ ...totals, write: WRITE }));
