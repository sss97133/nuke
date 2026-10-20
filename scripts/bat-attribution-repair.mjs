#!/usr/bin/env node
/**
 * bat-attribution-repair.mjs: repair of the BaT seller-attribution damage on vehicle_events, through the one
 * sanctioned writer, public.correct_vehicle_event_attribution (migration 20261020320000). DRY RUN by default.
 *
 * Damage (before the per-lot fix in extract-bat-core):
 *   job A  wrong_org          the lot's page seller (metadata.seller_username) is not a handle monitored for the
 *                             organization stamped on the row (the old update stamped the dealer on every BaT lot of
 *                             the vehicle).
 *   job B  overwritten_meta   the ownership-classification write replaced the whole metadata: the row has
 *                             ownership_classification and no seller_username and no 'source' key.
 *
 * The corrected value of every row comes from THAT LOT'S OWN auction_events row (matched on source_url), never guessed:
 *   job A  seller_external_identity_id := auction_events.seller_external_identity_id
 *          source_organization_id      := the organization of the bat_seller_monitors handle that equals that lot's
 *                                         seller exactly (handle of the identity, else auction_events.seller_name),
 *                                         else NULL. A handle monitored under two organizations gives NULL.
 *   job B  metadata merge (adds keys, never removes one): seller_username := auction_events.seller_name,
 *          buyer_username := auction_events.winning_bidder (sold lots), lot_number := auction_events.lot_number,
 *          restored_from := 'auction_events'. The same lot-derived organization / identity correction as job A is
 *          added to the row when it differs (turn off with --no-b-attribution). Images (images, image_urls,
 *          image_count) are NOT restored here: they need the saved page html; re-reading the lot through
 *          extract-bat-core (which rewrites the whole event payload from the page) restores them.
 *   A lot with no auction_events row, or with several rows that disagree, is skipped and listed with its reason. Nothing is guessed.
 *   Citation per row: source {type: 'auction_events', ref: 'auction_events <id>, repair 2026-10-20'}.
 *
 * Usage (credentials come from dotenvx, never printed):
 *   dotenvx run -- node scripts/bat-attribution-repair.mjs                   dry run, every job, every monitored org
 *   dotenvx run -- node scripts/bat-attribution-repair.mjs --job A --org <uuid>
 *   dotenvx run -- node scripts/bat-attribution-repair.mjs --live            calls the writer (batches of --batch)
 * Options: --job A|B|both  --org UUID  --limit-orgs N  --batch N (default 100, max 200)  --sleep-ms N (default 1500)
 *          --concurrency N (dry-run reads, default 3)  --no-b-attribution  --force (redo orgs that have a receipt)
 *          --out DIR (default ~/nuke-logs/market-sources-cohorts-20261019/attribution-repair)
 * Receipts (private data stays outside the repo): <out>/{dry|live}-org-<uuid>.json holds the plan, the skipped rows
 * with reasons and, live, each batch's writer result. A live receipt with done:true is skipped on a re-run; the writer
 * is idempotent (a repeated row is a noop), so an interrupted run resumes safely. <out>/{dry|live}-summary-*.json
 * holds the per-job counts.
 *
 * The 2026-10-20 plan listed 850 wrong_org rows and 2,379 overwritten_meta rows (read-only, per organization).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LIVE = flag("--live");
const JOB = (opt("--job", "both") || "both").toUpperCase();
const OUT = opt("--out", path.join(os.homedir(), "nuke-logs/market-sources-cohorts-20261019/attribution-repair"));
const ONE_ORG = opt("--org", null);
const LIMIT_ORGS = Number(opt("--limit-orgs", "0")) || 0;
const BATCH = Math.min(200, Math.max(1, Number(opt("--batch", "100")) || 100));
const SLEEP_MS = Number(opt("--sleep-ms", "1500")) || 0;
const CONCURRENCY = Math.max(1, Number(opt("--concurrency", "3")) || 3);
const B_ATTRIBUTION = !flag("--no-b-attribution");
const FORCE = flag("--force");
const ASSERTED_BY = "bat-attribution-repair 2026-10-20";
const MODE = LIVE ? "live" : "dry";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REASON_A = "lot attribution corrected from the lot's own auction_events row; the per-vehicle update had stamped another seller's organization on it";
export const REASON_B = "lost metadata keys restored from the lot's own auction_events row (the classification write had replaced the whole metadata)";

// ---------------------------------------------------------------- pure planning (no I/O) ----------------------------
const lc = (s) => (s == null ? null : String(s).trim().toLowerCase() || null);
const urlKey = (u) => (u ? String(u).trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase() : null);

/** handle (lowercase) -> Set of organization ids, from bat_seller_monitors. */
export function monitorMap(monitorRows) {
  const m = new Map();
  for (const r of monitorRows) {
    const h = lc(r.seller_username);
    if (!h || !r.organization_id) continue;
    if (!m.has(h)) m.set(h, new Set());
    m.get(h).add(r.organization_id);
  }
  return m;
}

/** The corrected attribution of a lot, from its own auction_events row. */
export function lotAttribution(ae, monitors) {
  const handle = lc(ae.seller_handle) ?? lc(ae.seller_name);
  const orgs = handle ? monitors.get(handle) : null;
  const org = orgs && orgs.size === 1 ? [...orgs][0] : null;
  return { handle, org, identity: ae.seller_external_identity_id ?? null, orgAmbiguous: !!(orgs && orgs.size > 1) };
}

/**
 * One writer row for a damaged event, or a skip. ev: {id, source_organization_id, seller_external_identity_id, damage};
 * aeRows: the auction_events rows matched to the event's source_url.
 */
export function planRow(ev, aeRows, monitors, { bAttribution = true } = {}) {
  if (aeRows.length === 0) return { skip: "no_lot_row" };
  // The same lot can be held twice (a trailing-slash spelling of its URL). Several rows are one witness only when they
  // agree on everything this repair reads from them; otherwise the lot is skipped, never picked from.
  const sig = (a) => JSON.stringify([lc(a.seller_handle) ?? lc(a.seller_name), a.seller_external_identity_id ?? null,
    a.lot_number ?? null, lc(a.winning_bidder), a.outcome ?? null]);
  if (aeRows.length > 1 && new Set(aeRows.map(sig)).size > 1) return { skip: "lot_rows_disagree" };
  const sorted = [...aeRows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const ae = sorted[0];
  const att = lotAttribution(ae, monitors);
  if (!att.handle && !att.identity) return { skip: "lot_row_has_no_seller" };
  const source = { type: "auction_events", ref: `auction_events ${ae.id}, repair 2026-10-20`,
    ...(sorted.length > 1 ? { same_lot_rows: sorted.slice(1).map((a) => a.id) } : {}) };
  const corrections = {};
  const wantAttribution = ev.damage === "wrong_org" || bAttribution;
  let kind = null;
  if (wantAttribution) {
    if ((ev.source_organization_id ?? null) !== att.org) {
      corrections.source_organization_id = { value: att.org, expected: ev.source_organization_id ?? null };
      kind = att.org ? "org_to_other_monitored" : "org_cleared";
    }
    if ((ev.seller_external_identity_id ?? null) !== att.identity) {
      corrections.seller_external_identity_id = { value: att.identity, expected: ev.seller_external_identity_id ?? null };
      kind = kind ?? "identity_only";
    }
  }
  if (ev.damage === "overwritten_meta") {
    const merge = {};
    if (lc(ae.seller_name)) merge.seller_username = String(ae.seller_name).trim();
    if (ae.outcome === "sold" && lc(ae.winning_bidder)) merge.buyer_username = String(ae.winning_bidder).trim();
    if (ae.lot_number != null && String(ae.lot_number).trim()) merge.lot_number = String(ae.lot_number).trim();
    if (Object.keys(merge).length === 0) return { skip: "lot_row_has_no_metadata_keys" };
    merge.restored_from = "auction_events";
    corrections.metadata = { merge, restore: true };
  }
  if (Object.keys(corrections).length === 0) return { skip: "already_correct" };
  return {
    row: { event_id: ev.id, source, reason: ev.damage === "wrong_org" ? REASON_A : REASON_B, corrections },
    kind: ev.damage === "overwritten_meta" ? `meta_restore${kind ? "+" + kind : ""}` : kind,
    orgAmbiguous: att.orgAmbiguous,
  };
}

// ---------------------------------------------------------------- Management API ------------------------------------
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT = "qkgaybvrernstplzjaam";
async function sql(query) {
  const body = JSON.stringify({ query });
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body,
    });
    const text = await r.text();
    if (r.status === 429 || /ThrottlerException/.test(text)) { await sleep(6000 * (attempt + 1)); continue; }
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`non-JSON answer: ${text.slice(0, 200)}`); }
    if (!Array.isArray(j)) throw new Error(`query failed: ${text.slice(0, 400)}`);
    return j;
  }
  throw new Error("rate limited too long");
}
const read = (q) => sql(`begin read only; set local statement_timeout='40s'; ${q}`);
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function loadEvents(org) {
  return read(`
    with h as (select array_agg(lower(seller_username)) handles from bat_seller_monitors where organization_id = '${org}')
    select ve.id, ve.vehicle_id, ve.source_url, ve.source_organization_id, ve.seller_external_identity_id,
           case when ve.metadata ? 'ownership_classification' and not ve.metadata ? 'seller_username' and not ve.metadata ? 'source'
                then 'overwritten_meta' else 'wrong_org' end as damage
    from vehicle_events ve, h
    where ve.source_platform = 'bat' and ve.source_organization_id = '${org}'
      and ( (ve.metadata->>'seller_username' is not null and not (lower(ve.metadata->>'seller_username') = any(h.handles)))
         or (ve.metadata ? 'ownership_classification' and not ve.metadata ? 'seller_username' and not ve.metadata ? 'source') )
    order by ve.id`);
}

async function loadLotRows(urls) {
  const byKey = new Map();
  for (let i = 0; i < urls.length; i += 50) {
    const variants = [...new Set(urls.slice(i, i + 50).flatMap((u) => { const t = u.replace(/\/+$/, ""); return [u, t, t + "/"]; }))];
    const rows = await read(`
      select ae.id, ae.source_url, ae.seller_name, ae.seller_external_identity_id, ei.handle as seller_handle,
             ae.winning_bidder, ae.lot_number, ae.outcome
      from auction_events ae left join external_identities ei on ei.id = ae.seller_external_identity_id
      where ae.source in ('bat','bringatrailer') and ae.source_url in (${variants.map(lit).join(",")})`);
    for (const r of rows) { const k = urlKey(r.source_url); (byKey.get(k) ?? byKey.set(k, []).get(k)).push(r); }
  }
  return byKey;
}

async function callWriter(rows) {
  const tag = `$rep${Math.random().toString(36).slice(2, 10)}$`;
  const json = JSON.stringify(rows);
  if (json.includes(tag)) throw new Error("dollar-quote tag collision");
  const res = await sql(`begin; set local statement_timeout='30s'; select public.correct_vehicle_event_attribution(${tag}${json}${tag}::jsonb, ${lit(ASSERTED_BY)}) as r; commit;`);
  return res[0]?.r ?? res;
}

// ---------------------------------------------------------------- run -----------------------------------------------
function writeJson(file, obj) { fs.writeFileSync(file + ".tmp", JSON.stringify(obj, null, 1)); fs.renameSync(file + ".tmp", file); }
const emptyJob = () => ({ damaged: 0, would_change: 0, kinds: {}, skipped: {}, org_ambiguous: 0 });

async function doOrg(org, monitors) {
  const file = path.join(OUT, `${MODE}-org-${org}.json`);
  if (!FORCE && fs.existsSync(file)) {
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!LIVE || prev.done) return { skipped: true, summary: prev.summary };
  }
  const events = (await loadEvents(org)).filter((e) => (JOB === "BOTH" || (JOB === "A" ? e.damage === "wrong_org" : e.damage === "overwritten_meta")));
  const lots = events.length ? await loadLotRows([...new Set(events.map((e) => e.source_url).filter(Boolean))]) : new Map();
  const summary = { A: emptyJob(), B: emptyJob() };
  const rows = []; const skipped = [];
  for (const ev of events) {
    const j = ev.damage === "wrong_org" ? summary.A : summary.B;
    j.damaged++;
    const p = ev.source_url ? planRow(ev, lots.get(urlKey(ev.source_url)) ?? [], monitors, { bAttribution: B_ATTRIBUTION }) : { skip: "no_source_url" };
    if (p.skip) { j.skipped[p.skip] = (j.skipped[p.skip] ?? 0) + 1; skipped.push({ event_id: ev.id, damage: ev.damage, reason: p.skip }); continue; }
    j.would_change++; j.kinds[p.kind] = (j.kinds[p.kind] ?? 0) + 1; if (p.orgAmbiguous) j.org_ambiguous++;
    rows.push(p.row);
  }
  const receipt = { mode: MODE, organization_id: org, at: new Date().toISOString(), summary, skipped, rows, batches: [], done: false };
  if (LIVE) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const res = await callWriter(rows.slice(i, i + BATCH));
      receipt.batches.push({ from: i, n: Math.min(BATCH, rows.length - i), result: res });
      writeJson(file, receipt);
      await sleep(SLEEP_MS);
    }
    receipt.done = true;
  }
  writeJson(file, receipt);
  return { skipped: false, summary };
}

function addJob(t, s) {
  t.damaged += s.damaged; t.would_change += s.would_change; t.org_ambiguous += s.org_ambiguous;
  for (const [k, v] of Object.entries(s.kinds)) t.kinds[k] = (t.kinds[k] ?? 0) + v;
  for (const [k, v] of Object.entries(s.skipped)) t.skipped[k] = (t.skipped[k] ?? 0) + v;
}

async function main() {
  if (!TOKEN) { console.error("SUPABASE_ACCESS_TOKEN missing (run under dotenvx)"); process.exit(2); }
  if (ONE_ORG && !UUID.test(ONE_ORG)) { console.error("--org must be a uuid"); process.exit(2); }
  if (!["A", "B", "BOTH"].includes(JOB)) { console.error("--job must be A, B or both"); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const monitorRows = await read(`select organization_id, seller_username from bat_seller_monitors where organization_id is not null`);
  const monitors = monitorMap(monitorRows);
  let orgs = [...new Set(monitorRows.map((r) => r.organization_id))].sort();
  if (ONE_ORG) orgs = orgs.filter((o) => o === ONE_ORG);
  if (LIMIT_ORGS) orgs = orgs.slice(0, LIMIT_ORGS);
  console.error(`${MODE} run: ${orgs.length} organizations, job ${JOB}, batch ${BATCH}${LIVE ? "" : " (nothing is written)"}`);

  const total = { orgs: orgs.length, orgs_reused: 0, A: emptyJob(), B: emptyJob() };
  let next = 0;
  async function worker() {
    while (next < orgs.length) {
      const org = orgs[next++];
      const r = await doOrg(org, monitors);
      if (r.skipped) total.orgs_reused++;
      if (r.summary) { addJob(total.A, r.summary.A); addJob(total.B, r.summary.B); }
      console.error(`org ${org}: A ${r.summary?.A.would_change}/${r.summary?.A.damaged}, B ${r.summary?.B.would_change}/${r.summary?.B.damaged}${r.skipped ? " (receipt reused)" : ""}`);
    }
  }
  await Promise.all(Array.from({ length: LIVE ? 1 : CONCURRENCY }, worker));
  const out = { at: new Date().toISOString(), mode: MODE, job: JOB, b_attribution: B_ATTRIBUTION, ...total };
  writeJson(path.join(OUT, `${MODE}-summary-${Date.now()}.json`), out);
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
