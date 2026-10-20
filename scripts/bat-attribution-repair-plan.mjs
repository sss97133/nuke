#!/usr/bin/env node
/**
 * bat-attribution-repair-plan.mjs: READ-ONLY plan for the BaT seller-attribution damage.
 *
 * Context: before the per-lot fix in extract-bat-core, reading a monitored dealer's lot stamped the dealer
 * (source_organization_id, seller_external_identity_id) on EVERY BaT lot of the vehicle, and the ownership
 * classification write replaced the whole event metadata. This script lists the exact vehicle_events ids
 * that carry each kind of damage, so the repair can be run by whichever writer is chosen.
 *
 * It writes NOTHING to the database. No sanctioned writer sets source_organization_id or metadata on
 * vehicle_events (supersede_vehicle_event_episode accepts only sold_at, ended_at, source_url, source_platform
 * and event_status; correct_vehicle_event_link moves or archives). Until the owner picks a writer, this is the plan.
 *
 * Lists (per organization, one JSONL file each, resumable: an organization with a receipt is skipped):
 *   wrong_org           the event's page seller (metadata.seller_username) is not a handle monitored for the
 *                       organization stamped on it. Repair: clear source_organization_id and
 *                       seller_external_identity_id, or set them to the lot's real seller identity.
 *   overwritten_meta    the event has ownership_classification but no seller_username and no 'source' key:
 *                       the metadata was replaced. Repair: restore from the newest HTTP 200 listing_page_snapshots
 *                       row for the lot URL (snapshot_id listed), by re-running extract-bat-core on that URL.
 *
 * Usage:
 *   dotenvx run -- node scripts/bat-attribution-repair-plan.mjs [--out DIR] [--org UUID] [--limit-orgs N]
 * Default DIR: ~/nuke-logs/market-sources-cohorts-20261019/attribution-repair
 * Private data (handles, urls) stays in DIR, outside the repo.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt("--out", path.join(os.homedir(), "nuke-logs/market-sources-cohorts-20261019/attribution-repair"));
const ONE_ORG = opt("--org", null);
const LIMIT_ORGS = Number(opt("--limit-orgs", "0")) || 0;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT = "qkgaybvrernstplzjaam";
if (!TOKEN) { console.error("SUPABASE_ACCESS_TOKEN missing (run under dotenvx)"); process.exit(2); }
if (ONE_ORG && !/^[0-9a-f-]{36}$/i.test(ONE_ORG)) { console.error("--org must be a uuid"); process.exit(2); }

async function q(sql) {
  const body = JSON.stringify({ query: `begin read only; set local statement_timeout='40s'; ${sql}` });
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body,
    });
    const text = await r.text();
    if (r.status === 429 || /ThrottlerException/.test(text)) { await new Promise((s) => setTimeout(s, 8000 * (attempt + 1))); continue; }
    const j = JSON.parse(text);
    if (!Array.isArray(j)) throw new Error(`query failed: ${text.slice(0, 300)}`);
    return j;
  }
  throw new Error("rate limited too long");
}

fs.mkdirSync(OUT, { recursive: true });
let orgs = (await q(`select distinct organization_id from bat_seller_monitors where organization_id is not null order by 1`))
  .map((r) => r.organization_id);
if (ONE_ORG) orgs = orgs.filter((o) => o === ONE_ORG);
if (LIMIT_ORGS) orgs = orgs.slice(0, LIMIT_ORGS);

const totals = { orgs_done: 0, orgs_skipped: 0, wrong_org: 0, overwritten_meta: 0, overwritten_with_snapshot: 0 };
for (const org of orgs) {
  const file = path.join(OUT, `org-${org}.jsonl`);
  if (fs.existsSync(file)) { totals.orgs_skipped++; continue; }
  const rows = await q(`
    with h as (select array_agg(lower(seller_username)) handles from bat_seller_monitors where organization_id = '${org}')
    select ve.id, ve.vehicle_id, ve.source_url, ve.seller_external_identity_id,
           case when ve.metadata ? 'ownership_classification' and not ve.metadata ? 'seller_username' and not ve.metadata ? 'source'
                then 'overwritten_meta' else 'wrong_org' end as damage,
           lower(ve.metadata->>'seller_username') as page_seller
    from vehicle_events ve, h
    where ve.source_platform = 'bat' and ve.source_organization_id = '${org}'
      and ( (ve.metadata->>'seller_username' is not null and not (lower(ve.metadata->>'seller_username') = any(h.handles)))
         or (ve.metadata ? 'ownership_classification' and not ve.metadata ? 'seller_username' and not ve.metadata ? 'source') )`);
  const need = rows.filter((r) => r.damage === "overwritten_meta" && r.source_url);
  const snaps = new Map();
  for (let i = 0; i < need.length; i += 50) {
    const urls = need.slice(i, i + 50).flatMap((r) => { const u = r.source_url.replace(/\/+$/, ""); return [u, u + "/"]; });
    const lit = urls.map((u) => `'${u.replace(/'/g, "''")}'`).join(",");
    const s = await q(`select distinct on (listing_url) listing_url, id, fetched_at from listing_page_snapshots
      where listing_url in (${lit}) and success and http_status = 200 order by listing_url, fetched_at desc`);
    for (const x of s) snaps.set(x.listing_url.replace(/\/+$/, ""), x);
  }
  const lines = rows.map((r) => {
    const sn = r.damage === "overwritten_meta" ? snaps.get((r.source_url || "").replace(/\/+$/, "")) : null;
    return JSON.stringify({ organization_id: org, event_id: r.id, vehicle_id: r.vehicle_id, damage: r.damage,
      source_url: r.source_url, page_seller: r.page_seller, stamped_seller_external_identity_id: r.seller_external_identity_id,
      snapshot_id: sn?.id ?? null, snapshot_fetched_at: sn?.fetched_at ?? null });
  });
  fs.writeFileSync(file + ".tmp", lines.join("\n") + (lines.length ? "\n" : ""));
  fs.renameSync(file + ".tmp", file);
  totals.orgs_done++;
  totals.wrong_org += rows.filter((r) => r.damage === "wrong_org").length;
  totals.overwritten_meta += need.length;
  totals.overwritten_with_snapshot += need.filter((r) => snaps.has(r.source_url.replace(/\/+$/, ""))).length;
  console.error(`org ${org}: wrong_org ${rows.filter((r) => r.damage === "wrong_org").length}, overwritten ${need.length}`);
}
const summary = { at: new Date().toISOString(), mode: "read-only plan, nothing written to the database", ...totals };
fs.writeFileSync(path.join(OUT, `summary-${Date.now()}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
