#!/usr/bin/env node
/**
 * build-dossier.mjs — local renderer for the sellable Build-History + Proof-of-Ownership dossier.
 *
 * The dossier DATA (nuke.dossier/v1) is assembled server-side by the canonical builder
 * (`supabase/functions/_shared/dossier.ts`) and served at:
 *     GET /functions/v1/api-v1-vehicle-history/{vin|uuid}?view=dossier&labor_rate=N
 * This CLI fetches that JSON (authenticating with the service-role key) and renders the
 * printable HTML document. There is ONE implementation of the dossier shape — this script
 * owns presentation only, so the CLI and the API/MCP can never drift.
 *
 * Usage:
 *   dotenvx run -- node scripts/daily-receipt/build-dossier.mjs --vehicle-id <uuid> [--labor-rate 85]
 *   dotenvx run -- node scripts/daily-receipt/build-dossier.mjs --vin 1GTGK24M1DJ514592
 *   npm run dossier:build -- --vehicle-id <uuid>
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) { console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : d; };

const VEHICLE_ID = arg('--vehicle-id');
const VIN = arg('--vin');
const IDENT = VEHICLE_ID || VIN;
const LABOR_RATE = parseFloat(arg('--labor-rate', '85'));
const OUT = arg('--out', join('output', 'dossiers', IDENT || 'unknown'));

if (!IDENT) { console.error('Required: --vehicle-id <uuid>  OR  --vin <vin>'); process.exit(1); }

// ── Fetch the dossier JSON from the canonical endpoint ───────────────────────
const endpoint = `${SUPABASE_URL}/functions/v1/api-v1-vehicle-history/${encodeURIComponent(IDENT)}?view=dossier&labor_rate=${LABOR_RATE}`;
const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } });
if (!res.ok) { console.error(`dossier endpoint → ${res.status} ${await res.text()}`); process.exit(2); }
const d = await res.json();
if (!d || d.schema !== 'nuke.dossier/v1') { console.error('Unexpected response:', JSON.stringify(d).slice(0, 300)); process.exit(3); }

const leadUrl = d.vehicle.lead_image_url;

// ── Render the human-readable HTML (derived from the JSON) ────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.vehicle.name)} — Build Dossier</title>
<style>
  :root { --ink:#16181d; --muted:#6b7280; --line:#e5e7eb; --accent:#b91c1c; --bg:#fbfbfa; }
  * { box-sizing:border-box; }
  body { font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; color:var(--ink); background:var(--bg); margin:0; }
  .wrap { max-width:820px; margin:0 auto; padding:48px 28px 80px; }
  header.id { display:flex; gap:24px; align-items:flex-start; border-bottom:2px solid var(--ink); padding-bottom:20px; }
  header.id .lead { width:240px; height:180px; object-fit:cover; border:1px solid var(--line); background:#eee; flex:none; }
  h1 { font-size:27px; margin:0 0 4px; letter-spacing:-.01em; }
  .vin { font-family:ui-monospace,Menlo,monospace; font-size:13px; color:var(--muted); }
  .est { margin-top:10px; font-size:13px; color:var(--muted); }
  .est b { color:var(--ink); font-size:20px; }
  .band { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line); border:1px solid var(--line); margin:28px 0; }
  .band div { background:#fff; padding:14px 16px; }
  .band .n { font-size:22px; font-weight:650; }
  .band .l { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-top:2px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--accent); border-bottom:1px solid var(--line); padding-bottom:6px; margin:36px 0 14px; }
  table { width:100%; border-collapse:collapse; }
  td,th { text-align:left; padding:9px 8px; border-bottom:1px solid var(--line); vertical-align:top; font-size:13.5px; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  td.date { white-space:nowrap; font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--muted); }
  td.desc { color:var(--ink); }
  td.desc small { color:var(--muted); }
  .kv { display:grid; grid-template-columns:200px 1fr; gap:6px 16px; font-size:13.5px; }
  .kv dt { color:var(--muted); }
  .gap { color:var(--accent); }
  .prov { font-size:11px; color:var(--muted); }
  footer { margin-top:48px; padding-top:18px; border-top:1px solid var(--line); font-size:11.5px; color:var(--muted); }
  .badge { display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.04em; background:#eef2ff; color:#3730a3; padding:1px 6px; border-radius:3px; vertical-align:middle; }
  @media print { body{background:#fff} .wrap{padding:0} }
</style></head>
<body><div class="wrap">

  <header class="id">
    ${leadUrl ? `<img class="lead" src="${esc(leadUrl)}" alt="${esc(d.vehicle.name)}">` : `<div class="lead"></div>`}
    <div>
      <h1>${esc(d.vehicle.name)}</h1>
      <div class="vin">VIN ${esc(d.vehicle.vin || '— not on file —')}</div>
      ${d.valuation ? `<div class="est">Estimated market value &nbsp;<b>${money(d.valuation.amount)}</b><br><span class="prov">${esc(d.valuation.source)}</span></div>` : ''}
    </div>
  </header>

  <div class="band">
    <div><div class="n">${d.build_summary.work_days.amount}</div><div class="l">Days worked</div></div>
    <div><div class="n">${d.build_summary.documented_hours.amount}</div><div class="l">Documented hrs</div></div>
    <div><div class="n">${d.build_summary.publishable_photos.amount}</div><div class="l">Evidence photos</div></div>
    <div><div class="n">${money(d.build_summary.estimated_labor_value_usd.amount)}</div><div class="l">Est. labor <span class="badge">est</span></div></div>
  </div>

  <h2>Proof of Ownership</h2>
  <dl class="kv">
    <dt>VIN</dt><dd>${d.proof_of_ownership.vin.amount ? esc(d.proof_of_ownership.vin.amount) : `<span class="gap">missing — ${esc(d.proof_of_ownership.vin.needs)}</span>`}</dd>
    <dt>Documented photos</dt><dd>${d.proof_of_ownership.photo_attribution.total_publishable_photos} from ${Object.keys(d.proof_of_ownership.photo_attribution.by_source).length} capture sources</dd>
    <dt>Title document</dt><dd><span class="gap">not attached — ${esc(d.proof_of_ownership.title_document.needs)}</span></dd>
  </dl>
  <p class="prov">${esc(d.proof_of_ownership.photo_attribution.note)}</p>

  <h2>Build History &nbsp;<span class="prov" style="text-transform:none;letter-spacing:0">${d.build_summary.span ? esc(d.build_summary.span.first) + ' → ' + esc(d.build_summary.span.last) : ''}</span></h2>
  <table>
    <thead><tr><th>Date</th><th>Work</th><th>Hrs</th><th>Photos</th></tr></thead>
    <tbody>
    ${d.timeline.map(t => `<tr>
      <td class="date">${esc(t.date)}</td>
      <td class="desc">${esc(t.title || t.work_type || 'Shop work')}${t.description ? `<br><small>${esc(t.description)}</small>` : ''}</td>
      <td>${t.hours ?? '—'}</td>
      <td>${t.photos || '—'}</td>
    </tr>`).join('\n')}
    </tbody>
  </table>

  <footer>
    <p>${esc(d.disclosure)}</p>
    <p>Generated ${esc(d.generated_at)} · Nuke dossier ${esc(d.schema)} · vehicle ${esc(d.vehicle.id)}</p>
  </footer>

</div></body></html>`;

// ── Write artifacts ──────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const jsonPath = join(OUT, 'dossier.json');
const htmlPath = join(OUT, 'dossier.html');
writeFileSync(jsonPath, JSON.stringify(d, null, 2));
writeFileSync(htmlPath, html);

// ── Console summary ──────────────────────────────────────────────────────────
const bs = d.build_summary;
console.log(`\n─── DOSSIER: ${d.vehicle.name} ────────────────────────────`);
console.log(`VIN:              ${d.vehicle.vin || '(none on file)'}`);
console.log(`Build window:     ${bs.span ? `${bs.span.first} → ${bs.span.last}` : '(no dated sessions)'}`);
console.log(`Days worked:      ${bs.work_days.amount}`);
console.log(`Documented hours: ${bs.documented_hours.amount}`);
console.log(`Est. labor value: ${money(bs.estimated_labor_value_usd.amount)}  (${bs.estimated_labor_value_usd.source}, NOT invoiced)`);
console.log(`Publishable photos: ${bs.publishable_photos.amount} (gate-approved)`);
console.log(`Market estimate:  ${d.valuation ? money(d.valuation.amount) : '(none)'}`);
console.log('───────────────────────────────────────────────────────');
console.log(`source:  ${endpoint}`);
console.log(`JSON →  ${jsonPath}`);
console.log(`HTML →  ${htmlPath}`);
