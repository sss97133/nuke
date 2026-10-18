// Operator driver for ingest-observation's vehicle_title_facets_v1 selector over the classic cohorts.
// It reads candidate vehicles, applies the same literal-title witness the server uses, and asks the server
// to derive a claim only where one is possible. It never writes a value itself and never touches vehicles.
//
//   cd ~/nuke && dotenvx run -q -- deno run --allow-net --allow-env --allow-read --allow-write \
//     ~/.worktrees/<task>/scripts/title-facet-claims.ts [--dry-run] [--cohort mustang] [--limit 500]
//
// A receipt (per-cohort counts, refusals and errors) is written under ~/nuke-logs/title-facets/.
import { titleFacetWitness, TITLE_FACET_MODE, type TitleFacetKey } from "../supabase/functions/ingest-observation/titleFacets.ts";

type Cohort = { name: string; make: string; model: string; years: [number, number] };
const COHORTS: Cohort[] = [
  { name: "911", make: "Porsche", model: "911", years: [1964, 1998] },
  { name: "mustang", make: "Ford", model: "mustang", years: [1964, 1973] },
  { name: "bronco", make: "Ford", model: "bronco", years: [1966, 1996] },
  { name: "corvette", make: "Chevrolet", model: "corvette", years: [1953, 1996] },
  { name: "land-cruiser", make: "Toyota", model: "land cruiser", years: [1951, 2007] },
  { name: "chevrolet-c10", make: "Chevrolet", model: "c10", years: [1960, 1987] },
  { name: "chevrolet-k10", make: "Chevrolet", model: "k10", years: [1960, 1987] },
  { name: "chevrolet-pickup", make: "Chevrolet", model: "pickup", years: [1947, 1998] },
  { name: "gmc-sierra", make: "GMC", model: "sierra", years: [1967, 1998] },
  { name: "gmc-pickup", make: "GMC", model: "pickup", years: [1947, 1998] },
];
const KEYS: TitleFacetKey[] = ["trim", "body_style"];

const args = Deno.args;
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = flag("dry-run");
const only = option("cohort");
const fromCohort = option("from-cohort");
const fill = !flag("no-fill");
const limit = Number(option("limit") ?? Infinity);
const concurrency = Math.max(1, Math.min(8, Number(option("concurrency") ?? 4)));

const base = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!base || !key) throw new Error("SUPABASE_URL and a service key are required (run under dotenvx from ~/nuke)");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

type Vehicle = { id: string; year: number | null; make: string | null; model: string | null; listing_title: string | null; trim: string | null;
  body_style: string | null; canonical_body_style: string | null; listing_url: string | null; discovery_url: string | null };

// record_facet_evidence accepts only these listing sources; any other source keeps its observation claim and no column fill.
const LISTING_SOURCES: Array<[RegExp, string]> = [
  [/(^|\.)bringatrailer\.com$/, "bat_listing"], [/(^|\.)carsandbids\.com$/, "cars_and_bids_listing"],
  [/(^|\.)mecum\.com$/, "mecum_listing"], [/(^|\.)barrett-jackson\.com$/, "barrett-jackson_listing"],
  [/(^|\.)rmsothebys\.com$/, "rm_sothebys_listing"], [/(^|\.)bonhams\.com$/, "bonhams_listing"],
  [/(^|\.)gooding(co)?\.com$/, "gooding_listing"], [/(^|\.)pcarmarket\.com$/, "pcarmarket_listing"],
  [/(^|\.)facebook\.com$/, "facebook_marketplace_listing"], [/(^|\.)craigslist\.org$/, "craigslist_listing"],
];
function listingSource(v: Vehicle): string | null {
  for (const url of [v.listing_url, v.discovery_url]) {
    try {
      const host = new URL(url ?? "").hostname.toLowerCase();
      const hit = LISTING_SOURCES.find(([re]) => re.test(host));
      if (hit) return hit[1];
    } catch { /* not a URL */ }
  }
  return null;
}

// Each column fill fires the vehicles row triggers, so a call stays small; a timeout rolls the whole call back and is
// retried as two halves.
type FillResult = { evidence_accepted: number; evidence_pending: number; filled: number };
async function recordFacetEvidence(proposals: unknown[]): Promise<FillResult> {
  const total: FillResult = { evidence_accepted: 0, evidence_pending: 0, filled: 0 };
  const add = (r: FillResult) => { total.evidence_accepted += r.evidence_accepted; total.evidence_pending += r.evidence_pending; total.filled += r.filled; };
  for (let i = 0; i < proposals.length; i += 50) add(await fillChunk(proposals.slice(i, i + 50)));
  return total;
}
async function fillChunk(proposals: unknown[]): Promise<FillResult> {
  const res = await fetch(`${base}/rest/v1/rpc/record_facet_evidence`, { method: "POST", headers, body: JSON.stringify({ p_proposals: proposals }) });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body as FillResult;
  if (body?.code === "57014" && proposals.length > 5) {
    const half = Math.ceil(proposals.length / 2);
    const a = await fillChunk(proposals.slice(0, half)), b = await fillChunk(proposals.slice(half));
    return { evidence_accepted: a.evidence_accepted + b.evidence_accepted, evidence_pending: a.evidence_pending + b.evidence_pending, filled: a.filled + b.filled };
  }
  throw new Error(`record_facet_evidence ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
}

// One make-year at a time so the read stays on idx_vehicles_make_year instead of walking the primary key.
async function page(c: Cohort, year: number, after: string | null): Promise<Vehicle[]> {
  const q = new URLSearchParams({
    select: "id,year,make,model,listing_title,trim,body_style,canonical_body_style,listing_url,discovery_url",
    make: `eq.${c.make}`, year: `eq.${year}`, model: `ilike.*${c.model}*`, is_public: "eq.true", deleted_at: "is.null",
    listing_title: "not.is.null", order: "id.asc", limit: "500",
    ...(after ? { id: `gt.${after}` } : {}),
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/rest/v1/vehicles?${q}`, { headers });
    if (res.ok) return await res.json();
    if (attempt === 2) throw new Error(`candidate read ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  return [];
}

async function claim(vehicleId: string, property: TitleFacetKey) {
  let last = { status: 0, body: {} as any };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/functions/v1/ingest-observation`, {
      method: "POST", headers, body: JSON.stringify({ mode: TITLE_FACET_MODE, vehicle_id: vehicleId, property_key: property }),
    });
    last = { status: res.status, body: await res.json().catch(() => ({})) };
    if (![502, 503, 504].includes(res.status)) return last;
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
  }
  return last;
}

const empty = (v: string | null) => v === null || v.trim() === "";
const receipt: Record<string, Record<string, number>> = {};
const errors: Array<{ vehicle_id: string; key: string; status: number; body: unknown }> = [];
let sent = 0;

const startAt = fromCohort ? COHORTS.findIndex(c => c.name === fromCohort) : 0;
if (startAt < 0) throw new Error(`unknown cohort ${fromCohort}`);
for (const c of COHORTS.slice(startAt).filter(c => !only || c.name === only)) {
  const tally = receipt[c.name] = { candidates: 0, missing_trim: 0, missing_body: 0, witnessed_trim: 0, witnessed_body: 0, written: 0, duplicate: 0, refused: 0, error: 0,
    proposed: 0, evidence_accepted: 0, evidence_pending: 0, filled: 0, no_listing_source: 0 };
  for (let year = c.years[0]; year <= c.years[1] && sent < limit; year++) {
  let after: string | null = null;
  while (sent < limit) {
    const rows = await page(c, year, after);
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    await new Promise(r => setTimeout(r, 250));
    type Job = { id: string; key: TitleFacetKey; value: string; source: string | null };
    const jobs: Job[] = [];
    for (const v of rows) {
      tally.candidates++;
      const identity = { year: v.year, make: v.make, model: v.model };
      const source = listingSource(v);
      if (empty(v.trim)) {
        tally.missing_trim++;
        const value = titleFacetWitness("trim", v.listing_title, identity);
        if (value) { tally.witnessed_trim++; jobs.push({ id: v.id, key: "trim", value, source }); }
      }
      if (empty(v.body_style) && empty(v.canonical_body_style)) {
        tally.missing_body++;
        const value = titleFacetWitness("body_style", v.listing_title, identity);
        if (value) { tally.witnessed_body++; jobs.push({ id: v.id, key: "body_style", value, source }); }
      }
    }
    if (dryRun) continue;
    const logged: Job[] = [];
    for (let i = 0; i < jobs.length && sent < limit; i += concurrency) {
      const batch = jobs.slice(i, i + concurrency);
      sent += batch.length;
      const results = await Promise.all(batch.map(j => claim(j.id, j.key).then(r => ({ j, r }))));
      for (const { j, r } of results) {
        if (r.status === 200 && r.body?.duplicate) { tally.duplicate++; logged.push(j); }
        else if (r.status === 200 && r.body?.success) { tally.written++; logged.push(j); }
        else if (r.status === 422) tally.refused++;
        else { tally.error++; if (errors.length < 50) errors.push({ vehicle_id: j.id, key: j.key, status: r.status, body: r.body }); }
      }
      if (tally.error > 25) throw new Error(`stopping: ${tally.error} errors in ${c.name}; first: ${JSON.stringify(errors[0])}`);
    }
    // The column is filled only by its registered writer, and only for an interpretation the log now holds.
    const proposals = logged.filter(j => j.source).map(j => ({ vehicle_id: j.id, field: j.key, value: j.value, source_type: j.source }));
    tally.no_listing_source += logged.length - proposals.length;
    if (fill && proposals.length > 0) {
      const out = await recordFacetEvidence(proposals);
      tally.proposed += proposals.length;
      tally.evidence_accepted += out.evidence_accepted; tally.evidence_pending += out.evidence_pending; tally.filled += out.filled;
    }
  }
  }
  console.log(c.name, JSON.stringify(tally));
}

const dir = `${Deno.env.get("HOME")}/nuke-logs/title-facets`;
await Deno.mkdir(dir, { recursive: true });
const path = `${dir}/${new Date().toISOString().replace(/[:.]/g, "-")}${dryRun ? "-dry" : ""}.json`;
await Deno.writeTextFile(path, JSON.stringify({ mode: TITLE_FACET_MODE, dry_run: dryRun, measured_at: new Date().toISOString(), cohorts: receipt, errors }, null, 2));
console.log("receipt", path);
