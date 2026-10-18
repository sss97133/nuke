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
const limit = Number(option("limit") ?? Infinity);
const concurrency = Math.max(1, Math.min(8, Number(option("concurrency") ?? 4)));

const base = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!base || !key) throw new Error("SUPABASE_URL and a service key are required (run under dotenvx from ~/nuke)");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

type Vehicle = { id: string; year: number | null; make: string | null; model: string | null; listing_title: string | null; trim: string | null; body_style: string | null; canonical_body_style: string | null };

// One make-year at a time so the read stays on idx_vehicles_make_year instead of walking the primary key.
async function page(c: Cohort, year: number, after: string | null): Promise<Vehicle[]> {
  const q = new URLSearchParams({
    select: "id,year,make,model,listing_title,trim,body_style,canonical_body_style",
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
  const res = await fetch(`${base}/functions/v1/ingest-observation`, {
    method: "POST", headers, body: JSON.stringify({ mode: TITLE_FACET_MODE, vehicle_id: vehicleId, property_key: property }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const empty = (v: string | null) => v === null || v.trim() === "";
const receipt: Record<string, Record<string, number>> = {};
const errors: Array<{ vehicle_id: string; key: string; status: number; body: unknown }> = [];
let sent = 0;

for (const c of COHORTS.filter(c => !only || c.name === only)) {
  const tally = receipt[c.name] = { candidates: 0, missing_trim: 0, missing_body: 0, witnessed_trim: 0, witnessed_body: 0, written: 0, duplicate: 0, refused: 0, error: 0 };
  for (let year = c.years[0]; year <= c.years[1] && sent < limit; year++) {
  let after: string | null = null;
  while (sent < limit) {
    const rows = await page(c, year, after);
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    await new Promise(r => setTimeout(r, 250));
    const jobs: Array<{ id: string; key: TitleFacetKey }> = [];
    for (const v of rows) {
      tally.candidates++;
      const identity = { year: v.year, make: v.make, model: v.model };
      if (empty(v.trim)) {
        tally.missing_trim++;
        if (titleFacetWitness("trim", v.listing_title, identity)) { tally.witnessed_trim++; jobs.push({ id: v.id, key: "trim" }); }
      }
      if (empty(v.body_style) && empty(v.canonical_body_style)) {
        tally.missing_body++;
        if (titleFacetWitness("body_style", v.listing_title, identity)) { tally.witnessed_body++; jobs.push({ id: v.id, key: "body_style" }); }
      }
    }
    if (dryRun) continue;
    for (let i = 0; i < jobs.length && sent < limit; i += concurrency) {
      const batch = jobs.slice(i, i + concurrency);
      sent += batch.length;
      const results = await Promise.all(batch.map(j => claim(j.id, j.key).then(r => ({ j, r }))));
      for (const { j, r } of results) {
        if (r.status === 200 && r.body?.duplicate) tally.duplicate++;
        else if (r.status === 200 && r.body?.success) tally.written++;
        else if (r.status === 422) tally.refused++;
        else { tally.error++; if (errors.length < 50) errors.push({ vehicle_id: j.id, key: j.key, status: r.status, body: r.body }); }
      }
      if (tally.error > 25) throw new Error(`stopping: ${tally.error} errors in ${c.name}; first: ${JSON.stringify(errors[0])}`);
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
