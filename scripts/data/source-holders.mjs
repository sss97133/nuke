#!/usr/bin/env node
/**
 * scripts/data/source-holders.mjs
 *
 * Who holds the vehicles we have, and whether the Sources board can see them. Read-only: every query runs inside
 * `begin read only` with its own statement_timeout on the Supabase Management API (as q.sh and readme-stats.mjs do).
 * Needs SUPABASE_ACCESS_TOKEN.
 *
 *   dotenvx run -q -- node scripts/data/source-holders.mjs [--min 50] [--json <path>]
 *
 * Three readings, each with its date:
 *   1. Every organization holding --min or more organization_vehicles rows, by business_type, with its
 *      observation_sources row (the board reads only sources), its vehicles, and how many of those vehicles the
 *      organization sold through BaT (a vehicle_events row with this organization as source_organization_id) against
 *      the vehicles it holds on its own site or elsewhere. A dealer whose every vehicle is a BaT lot adds nothing the
 *      BaT row does not already hold: the board must count such lots apart, never twice.
 *   2. BaT seller coverage: of the BaT lots we hold, how many name a seller at all (an organization, an external
 *      identity, or a non-blank seller handle), and how many carry a blank or missing seller.
 *   3. BaT sellers not linked to a dealer source, banded by lots: members and lots per band. These are the cohorts the
 *      board ranks as private sellers; no handle leaves the database.
 *
 * Measured 2026-10-19 (see the exec notes of that day): 232 organizations hold 50+ rows; 37 dealers hold 32,349 rows
 * (28,695 vehicles, 25,206 of them BaT lots the dealer sold); 177 'other' organizations (BaT seller handles) hold
 * 33,333 rows; 54,618 of 285,375 BaT lots carry a seller key.
 */
import { writeFileSync } from 'node:fs';

const PROJECT = 'qkgaybvrernstplzjaam';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('source-holders: SUPABASE_ACCESS_TOKEN is not set');
  process.exit(2);
}
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const MIN = Number(arg('--min', '50'));
const JSON_OUT = arg('--json', null);

async function q(sql, timeout = '45s') {
  const t0 = Date.now();
  const query = `begin read only; set local statement_timeout = '${timeout}'; ${sql}; commit;`;
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let rows = null;
  try { rows = JSON.parse(text); } catch { /* reported below */ }
  if (!res.ok || !Array.isArray(rows)) throw new Error(`query failed (${res.status}): ${text.slice(0, 300)}`);
  console.error(`source-holders: ${((Date.now() - t0) / 1000).toFixed(1)}s  ${sql.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
  return rows;
}

const BAT = `lower(e.source_platform) IN ('bat', 'bringatrailer')`;

// 1. Organizations holding MIN+ rows, with their source row and the BaT split. The per-organization BaT split reads
//    vehicle_events through idx_vehicle_events_source_org (the organization's own BaT lots), never a scan.
const orgs = await q(`
  WITH ov AS (
    SELECT organization_id, count(*) AS rows FROM public.organization_vehicles GROUP BY 1 HAVING count(*) >= ${MIN}
  ), bat AS (
    SELECT e.source_organization_id AS organization_id,
           count(*) AS bat_lots, count(DISTINCT e.vehicle_id) AS bat_vehicles
    FROM public.vehicle_events e
    WHERE e.source_organization_id IN (SELECT organization_id FROM ov) AND ${BAT}
    GROUP BY 1
  ), own AS (
    SELECT v.organization_id, count(DISTINCT v.vehicle_id) AS vehicles,
           count(DISTINCT v.vehicle_id) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM public.vehicle_events e
             WHERE e.vehicle_id = v.vehicle_id AND e.source_organization_id = v.organization_id AND ${BAT})) AS own_vehicles
    FROM public.organization_vehicles v
    WHERE v.organization_id IN (SELECT organization_id FROM ov)
    GROUP BY 1
  )
  SELECT o.id, o.business_name AS name, coalesce(o.business_type, '-') AS business_type, ov.rows, own.vehicles,
         own.own_vehicles, coalesce(bat.bat_lots, 0) AS bat_lots, coalesce(bat.bat_vehicles, 0) AS bat_vehicles,
         (SELECT string_agg(s.slug || ':' || coalesce(s.species::text, '-'), ';') FROM public.observation_sources s
           WHERE s.business_id = o.id) AS source_rows,
         o.website
  FROM ov JOIN public.organizations o ON o.id = ov.organization_id
  LEFT JOIN own USING (organization_id) LEFT JOIN bat USING (organization_id)
  ORDER BY ov.rows DESC`, '55s');

// 2. BaT seller coverage.
const [coverage] = await q(`
  SELECT count(*) AS bat_lots,
         count(*) FILTER (WHERE e.source_organization_id IS NOT NULL) AS with_organization,
         count(*) FILTER (WHERE e.seller_external_identity_id IS NOT NULL) AS with_identity,
         count(*) FILTER (WHERE e.source_organization_id IS NULL AND e.seller_external_identity_id IS NULL
                            AND nullif(trim(e.seller_identifier), '') IS NOT NULL) AS with_handle_only,
         count(*) FILTER (WHERE e.source_organization_id IS NULL AND e.seller_external_identity_id IS NULL
                            AND nullif(trim(e.seller_identifier), '') IS NULL) AS no_seller
  FROM public.vehicle_events e WHERE ${BAT}`);

// 3. Sellers not linked to a dealer source, banded by lots.
const bands = await q(`
  WITH dealer_orgs AS (
    SELECT business_id AS id FROM public.observation_sources WHERE business_id IS NOT NULL AND category::text IN ('dealer', 'shop')
  ), ev AS (
    SELECT coalesce('org:' || e.source_organization_id::text, 'id:' || e.seller_external_identity_id::text,
                    'h:' || lower(nullif(trim(e.seller_identifier), ''))) AS seller_key,
           e.source_organization_id AS org_id
    FROM public.vehicle_events e WHERE ${BAT}
  ), sellers AS (
    SELECT seller_key, count(*) AS lots FROM ev
    WHERE seller_key IS NOT NULL AND (org_id IS NULL OR org_id NOT IN (SELECT id FROM dealer_orgs))
    GROUP BY 1
  )
  SELECT CASE WHEN lots >= 50 THEN '50+' WHEN lots >= 10 THEN '10-49' WHEN lots >= 2 THEN '2-9' ELSE '1' END AS band,
         count(*) AS members, sum(lots) AS lots
  FROM sellers GROUP BY 1
  UNION ALL
  SELECT 'dealer-linked', count(DISTINCT seller_key), count(*) FROM ev WHERE org_id IN (SELECT id FROM dealer_orgs)
  ORDER BY 1`);

const n = (x) => Number(x ?? 0);
const pad = (s, w) => String(s).padEnd(w);
const measuredAt = new Date().toISOString();
console.log(`source-holders, measured ${measuredAt}: organizations holding ${MIN}+ organization_vehicles rows`);
console.log(pad('type', 17) + pad('rows', 8) + pad('vehicles', 10) + pad('own', 8) + pad('bat_lots', 10) + pad('source', 34) + 'name');
for (const o of orgs) {
  console.log(pad(o.business_type, 17) + pad(o.rows, 8) + pad(o.vehicles ?? '-', 10) + pad(o.own_vehicles ?? '-', 8)
    + pad(o.bat_lots, 10) + pad(o.source_rows ?? '-', 34) + o.name);
}
const byType = new Map();
for (const o of orgs) {
  const t = byType.get(o.business_type) ?? { orgs: 0, with_source: 0, rows: 0, vehicles: 0, own: 0, bat_lots: 0 };
  t.orgs += 1; t.with_source += o.source_rows ? 1 : 0; t.rows += n(o.rows); t.vehicles += n(o.vehicles);
  t.own += n(o.own_vehicles); t.bat_lots += n(o.bat_lots);
  byType.set(o.business_type, t);
}
console.log('\nby type: orgs, with a source row, rows, vehicles, own (not sold on BaT by this organization), BaT lots');
for (const [t, v] of [...byType].sort((a, b) => b[1].rows - a[1].rows)) {
  console.log(`${pad(t, 17)}${pad(v.orgs, 6)}${pad(v.with_source, 6)}${pad(v.rows, 9)}${pad(v.vehicles, 9)}${pad(v.own, 8)}${v.bat_lots}`);
}
console.log(`\nBaT seller coverage of ${n(coverage.bat_lots)} lots: organization ${n(coverage.with_organization)}, `
  + `identity ${n(coverage.with_identity)}, handle only ${n(coverage.with_handle_only)}, no seller ${n(coverage.no_seller)}`);
console.log('\nBaT sellers not linked to a dealer source, by lots: band, members, lots');
for (const b of bands) console.log(`${pad(b.band, 15)}${pad(b.members, 9)}${b.lots}`);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ measured_at: measuredAt, min_rows: MIN, organizations: orgs, coverage, bands }, null, 2));
  console.error(`source-holders: wrote ${JSON_OUT}`);
}
