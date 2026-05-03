// generateK5GapReport.ts — Produce a printable "gap report" for the K5 Blazer
// wiring package, structured to mirror Desert Performance's invoice format so
// Dave can read it without learning a new layout.
//
// For each device in the K5 manifest, we answer three questions:
//   1. Is there pin-level data (a DeviceContract entry)?   →  CONTRACT
//   2. Is there only scaffolded / generic device data?     →  PARTIAL
//   3. Is the device missing from specifications entirely? →  NEED
//
// Output: markdown + HTML (print-ready). Markdown is the source of truth;
// HTML styles it for printing in the Desert Performance invoice idiom.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { MOCK_MANIFEST, MOCK_VEHICLE } from './mockData';
import { DEVICE_CONTRACTS } from './deviceContracts';
import type { ManifestDevice } from './overlayCompute';
import type { DeviceContract } from './deviceContracts';

// ─────────────────────────────────────────────────────────────────────
// 1. Harness Domain Classification (mirrors Dave's invoice structure)
// ─────────────────────────────────────────────────────────────────────

type HarnessDomain =
  | 'engine_management'     // M130 + sensors + injectors + coils
  | 'power_distribution'    // PDM30/15, battery, disconnect, keypad, alternator
  | 'chassis_electrical'    // chassis harness, body grounds, bulkhead, firewall
  | 'lighting'              // head/tail/marker/interior/signals
  | 'body_accessories'      // windows, locks, steps, wipers, mirrors
  | 'safety_cluster'        // iBooster, E-Stopp, gauges, warning
  | 'audio'                 // head unit, amp, speakers
  | 'routing'               // grommets, boots, tape (not electrical)
  | 'unknown';

function classifyDomain(d: ManifestDevice): HarnessDomain {
  const name = (d.device_name || '').toLowerCase();
  const cat = (d.device_category || '').toLowerCase();

  if (cat === 'routing') return 'routing';
  if (/ibooster|brake booster|e-stopp|estopp/.test(name)) return 'safety_cluster';
  if (/dakota|gauge|cluster|vhx|sgi/.test(name)) return 'safety_cluster';
  if (/retrosound|radio|speaker|amplifier|\bamp\b|kicker|subwoofer/.test(name)) return 'audio';
  if (/headlight|taillight|marker|turn signal|interior light|fog|reverse light|dome/.test(name)) return 'lighting';
  if (/power step|window motor|door lock|wiper|mirror|defrost|horn/.test(name)) return 'body_accessories';
  if (/pdm|power distribution|battery|alternator|disconnect|keypad|fuse box/.test(name)) return 'power_distribution';
  if (/bulkhead|firewall|grommet|boot|splice|ground point|star ground|body ground/.test(name)) return 'chassis_electrical';
  if (cat === 'engine_mgmt') return 'engine_management';
  if (/injector|coil|sensor|ecu|m130|m150|o2|lambda|cam sync|crank|knock|throttle/.test(name)) return 'engine_management';
  return 'unknown';
}

const DOMAIN_ORDER: HarnessDomain[] = [
  'engine_management',
  'power_distribution',
  'chassis_electrical',
  'lighting',
  'safety_cluster',
  'body_accessories',
  'audio',
  'routing',
  'unknown',
];

const DOMAIN_LABELS: Record<HarnessDomain, string> = {
  engine_management: 'Engine Management',
  power_distribution: 'Power Distribution',
  chassis_electrical: 'Chassis Electrical',
  lighting: 'Lighting',
  safety_cluster: 'Safety / Instrumentation',
  body_accessories: 'Body / Accessories',
  audio: 'Audio',
  routing: 'Routing (passive)',
  unknown: 'Unclassified',
};

// ─────────────────────────────────────────────────────────────────────
// 2. Contract Match — does a device have pin-level data?
// ─────────────────────────────────────────────────────────────────────

// Explicit K5 manifest-name → contract device_id map. Each row is a deliberate
// decision, not a fuzzy match. When Dave confirms a different exact part,
// update the map; don't broaden the heuristic.
const K5_NAME_TO_CONTRACT: Array<[RegExp, string]> = [
  [/dakota.*(vhx|gauge|cluster|controller)/i,   'dakota_digital_vhx_73c_pu'],
  [/(bosch.*booster|ibooster|electric brake booster)/i, 'bosch_ibooster_gen1'],
  [/aeromotive.*(a1000|pressure regulator)/i,   'aeromotive_a1000'],
  [/(e-stopp|estopp|parking brake actuator)/i,  'estopp_esk001'],
  [/(amp research|power step|powerstep)/i,      'amp_research_powerstep'],
  [/(nu-relics|nu relics|power window)/i,       'nu_relics_nr17380201'],
  [/(dorman|door lock actuator)/i,              'dorman_746_014'],
  [/(retrosound|hermosa|head unit|radio|kenwood)/i, 'retrosound_hermosa'],
  [/(truck-lite|truck lite|27270c|led headlight)/i, 'truck_lite_27270c'],
  [/(united pacific|ctl7387|taillight)/i,       'united_pacific_ctl7387led'],
  // New 2026-04-22 contracts (Wave 3 promotion)
  [/\bm130\b|motec.*m130/i,                     'motec_m130_ecu'],
  [/0280158821|fuel injector/i,                 'bosch_0280158821_injector'],
  [/12611424|d510c|ignition coil/i,             'acdelco_12611424_coil'],
  [/36469|diode dynamics/i,                     'diode_dynamics_36469_led'],
  [/007794301|iso.mini.relay|polarity reversing relay|amplifier relay|fuel pump relay/i, 'bosch_007794301_relay'],
];

function matchContract(d: ManifestDevice): DeviceContract | null {
  const blob = [d.device_name, d.manufacturer, d.part_number, d.model_number]
    .filter(Boolean).join(' ');
  for (const [re, id] of K5_NAME_TO_CONTRACT) {
    if (re.test(blob)) {
      const c = DEVICE_CONTRACTS[id];
      if (c) return c;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// 3. Status Classification
// ─────────────────────────────────────────────────────────────────────

type Status = 'CONTRACT' | 'PARTIAL' | 'SCAFFOLD' | 'NEED';

function classify(d: ManifestDevice, c: DeviceContract | null): Status {
  if (c) return 'CONTRACT';
  // Scaffolded: generated by a mockData helper with no manufacturer and bulk IDs
  const id = d.id || '';
  if (/^dev-(inj|coil|marker|reverse|taillight|headlight|spkr|door)/i.test(id)) {
    return d.manufacturer ? 'PARTIAL' : 'SCAFFOLD';
  }
  if (!d.manufacturer && !d.part_number) return 'NEED';
  return 'PARTIAL';
}

// ─────────────────────────────────────────────────────────────────────
// 4. Report Generation
// ─────────────────────────────────────────────────────────────────────

type Row = {
  device: ManifestDevice;
  contract: DeviceContract | null;
  status: Status;
  domain: HarnessDomain;
};

function buildRows(): Row[] {
  return MOCK_MANIFEST.map(d => {
    const contract = matchContract(d);
    return {
      device: d,
      contract,
      status: classify(d, contract),
      domain: classifyDomain(d),
    };
  });
}

function groupByDomain(rows: Row[]): Record<HarnessDomain, Row[]> {
  const out = {} as Record<HarnessDomain, Row[]>;
  DOMAIN_ORDER.forEach(d => { out[d] = []; });
  rows.forEach(r => out[r.domain].push(r));
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 5. Markdown Emitter
// ─────────────────────────────────────────────────────────────────────

function statusBadge(s: Status): string {
  return { CONTRACT: 'HAVE ✓', PARTIAL: 'PARTIAL', SCAFFOLD: 'SCAFFOLD', NEED: 'NEED' }[s];
}

function emitMarkdown(rows: Row[]): string {
  const grouped = groupByDomain(rows);
  const lines: string[] = [];

  // header
  lines.push(`# K5 Blazer — Wiring Pinout Gap Report`);
  lines.push('');
  lines.push(`**Vehicle:** ${MOCK_VEHICLE.year} ${MOCK_VEHICLE.make} ${MOCK_VEHICLE.model}`);
  lines.push(`**Generated:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Source:** nuke \`vehicle_build_manifest\` snapshot (${rows.length} devices)`);
  lines.push('');
  lines.push(`## Purpose`);
  lines.push('');
  lines.push('This is not the final pinout. It is a *gap report* — for every device in the K5 package, it marks whether we have pin-level data, partial data, or nothing. Rows marked **NEED** are specifically the ones Dave\'s expertise fills in. This document is the interview, not the deliverable.');
  lines.push('');

  // overall summary
  const tally = { CONTRACT: 0, PARTIAL: 0, SCAFFOLD: 0, NEED: 0 };
  rows.forEach(r => { tally[r.status]++; });
  lines.push(`## Coverage Summary`);
  lines.push('');
  lines.push(`| Status | Count | Meaning |`);
  lines.push(`|---|---|---|`);
  lines.push(`| HAVE ✓ | ${tally.CONTRACT} | Pin-level contract on file, every pin function documented |`);
  lines.push(`| PARTIAL | ${tally.PARTIAL} | Manufacturer + part # known, connector type known, no per-pin data |`);
  lines.push(`| SCAFFOLD | ${tally.SCAFFOLD} | Generic placeholder (e.g. "Fuel Injector 1" through 8 all lumped) |`);
  lines.push(`| NEED | ${tally.NEED} | Device exists in manifest but we have essentially nothing |`);
  lines.push('');
  const covered = tally.CONTRACT;
  const pct = ((covered / rows.length) * 100).toFixed(1);
  lines.push(`**Full pin-level coverage: ${covered} of ${rows.length} devices (${pct}%)**`);
  lines.push('');

  // per-domain
  DOMAIN_ORDER.forEach(d => {
    const drows = grouped[d];
    if (drows.length === 0) return;
    const dtally = { CONTRACT: 0, PARTIAL: 0, SCAFFOLD: 0, NEED: 0 };
    drows.forEach(r => { dtally[r.status]++; });

    lines.push(`## ${DOMAIN_LABELS[d]}  (${drows.length} devices)`);
    lines.push('');
    lines.push(`**Coverage:** HAVE ${dtally.CONTRACT} · PARTIAL ${dtally.PARTIAL} · SCAFFOLD ${dtally.SCAFFOLD} · NEED ${dtally.NEED}`);
    lines.push('');
    lines.push(`| Status | Device | Mfr / Part # | Connector | Pins | Draw (A) | Zone | Purchased | Contract |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    drows.forEach(r => {
      const dev = r.device;
      const mfrPart = [dev.manufacturer, dev.part_number].filter(Boolean).join(' / ') || '—';
      const conn = dev.connector_type || '—';
      const pins = dev.pin_count ?? '—';
      const amps = dev.power_draw_amps ?? '—';
      const zone = dev.location_zone || '—';
      const bought = dev.purchased ? 'yes' : 'no';
      const ctr = r.contract ? r.contract.device_id : '—';
      lines.push(`| ${statusBadge(r.status)} | ${dev.device_name} | ${mfrPart} | ${conn} | ${pins} | ${amps} | ${zone} | ${bought} | ${ctr} |`);
    });
    lines.push('');

    // per-domain gap questions
    const needs = drows.filter(r => r.status === 'NEED' || r.status === 'SCAFFOLD');
    if (needs.length > 0) {
      lines.push(`### Questions for Dave — ${DOMAIN_LABELS[d]}`);
      lines.push('');
      needs.forEach((r, i) => {
        lines.push(`${i + 1}. **${r.device.device_name}** — need manufacturer, part number, connector type, pin assignments. Zone: ${r.device.location_zone || 'unknown'}.`);
      });
      lines.push('');
    }
  });

  // cross-domain action items
  lines.push(`## Open Questions — Cross-Domain`);
  lines.push('');
  lines.push(`1. **61-pin engine bulkhead disconnect (D38999)** — which signals cross, which stay on engine side? This is the engine/chassis contract.`);
  lines.push(`2. **PDM30 channel map** — all 30 outputs, each with (circuit, load, protection amp, fuse curve, keypad or CAN trigger, logic expression). Currently scaffolded at 39 pins from manifest.`);
  lines.push(`3. **PDM30 vs PDM15 sizing** — if we can group / merge circuits, does a PDM15 cover the K5? $940 delta and one less unit to mount.`);
  lines.push(`4. **Keypad labels (8-button)** — which button does what, on short vs long press, on primary vs secondary page?`);
  lines.push(`5. **CAN bus layout** — which nodes are on the bus (M130, PDM30, Dakota cluster, iBooster?), bitrate, termination locations.`);
  lines.push(`6. **Battery line routing** — Optima B+ → RBD-190 → master fuse → PDM30 input → downstream. Gauge, length, lug sizes, fuse rating at each hop.`);
  lines.push(`7. **Ground strategy** — star point location, body ground points, engine-to-chassis strap, sensor returns isolated vs shared.`);
  lines.push(`8. **Shielded cable runs** — crank, cam, knock ×2. Shield grounded at ECU end only?`);
  lines.push(`9. **Fuel pump dedicated relay** — A1000 draws 35A peak. Confirm NOT on PDM. Dedicated relay location, trigger source.`);
  lines.push(`10. **iBooster dedicated power** — 40A peak. Confirm NOT on PDM. Fuse, relay, wire gauge.`);
  lines.push('');

  // how to read this
  lines.push(`## How to Read This`);
  lines.push('');
  lines.push(`Every row is one device in the K5 build. The compiler needs every row to be at least PARTIAL to emit a draft M1 package; every row at CONTRACT to emit a production package.`);
  lines.push('');
  lines.push(`The aviation analogue: this is the FAA 8130-3 tag chain, one row per installed part. Today it's maybe 10% populated at full depth. Every Dave conversation should move rows from NEED → PARTIAL → CONTRACT.`);
  lines.push('');
  lines.push(`When every engine_management row is CONTRACT, the engine harness compiler can emit a .m1pkg. When power_distribution is CONTRACT, the PDM package emits. When chassis_electrical is CONTRACT, the chassis harness build sheet emits. The three compile independently — they share only the 61-pin bulkhead contract.`);
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// 6. HTML Emitter (print-ready, Desert Performance invoice idiom)
// ─────────────────────────────────────────────────────────────────────

function emitHTML(markdown: string, rows: Row[]): string {
  const grouped = groupByDomain(rows);
  const tally = { CONTRACT: 0, PARTIAL: 0, SCAFFOLD: 0, NEED: 0 };
  rows.forEach(r => { tally[r.status]++; });

  // Invoice-style HTML — matches Desert Performance's "Invoice #1190" layout.
  const today = new Date().toISOString().split('T')[0];

  let body = '';

  // header row (matches the DP invoice header)
  body += `<table class="header"><tr>
    <td class="logo"><div class="logo-box">NUKE · K5 · PINOUT GAP REPORT</div></td>
    <td class="meta">
      <h1>Gap Report <span class="num">K5-001</span></h1>
      <div><strong>Date</strong> ${today}</div>
      <div><strong>Vehicle</strong> 1977 Chevrolet Blazer (K5)</div>
      <div><strong>Build</strong> LS3 + Motec M130 + PDM30 + iBooster</div>
      <div><strong>Prepared for</strong> Desert Performance</div>
      <div><strong>Source</strong> nuke vehicle_build_manifest</div>
    </td>
  </tr></table>`;

  // coverage banner
  body += `<div class="coverage">
    <span class="chip have">HAVE ${tally.CONTRACT}</span>
    <span class="chip partial">PARTIAL ${tally.PARTIAL}</span>
    <span class="chip scaffold">SCAFFOLD ${tally.SCAFFOLD}</span>
    <span class="chip need">NEED ${tally.NEED}</span>
    <span class="total">of ${rows.length} devices</span>
  </div>`;

  // per-domain tables
  DOMAIN_ORDER.forEach(d => {
    const drows = grouped[d];
    if (drows.length === 0) return;
    body += `<h2>${DOMAIN_LABELS[d]} <span class="count">${drows.length}</span></h2>`;
    body += `<table class="domain"><thead><tr>
      <th class="st">Status</th><th>Device</th><th>Mfr / Part #</th><th>Connector</th>
      <th class="n">Pins</th><th class="n">A</th><th>Zone</th><th class="n">Purchased</th>
    </tr></thead><tbody>`;
    drows.forEach(r => {
      const dev = r.device;
      const cls = r.status.toLowerCase();
      const badge = statusBadge(r.status);
      const mfrPart = [dev.manufacturer, dev.part_number].filter(Boolean).join(' / ') || '—';
      body += `<tr class="${cls}">
        <td class="st"><span class="badge ${cls}">${badge}</span></td>
        <td>${dev.device_name}</td>
        <td>${mfrPart}</td>
        <td>${dev.connector_type || '—'}</td>
        <td class="n">${dev.pin_count ?? '—'}</td>
        <td class="n">${dev.power_draw_amps ?? '—'}</td>
        <td>${dev.location_zone || '—'}</td>
        <td class="n">${dev.purchased ? '✓' : ''}</td>
      </tr>`;
    });
    body += `</tbody></table>`;
  });

  // questions
  body += `<h2>Open Questions — Cross-Domain</h2><ol class="questions">
    <li><strong>61-pin engine bulkhead (D38999)</strong> — which signals cross, which stay engine-side?</li>
    <li><strong>PDM30 channel map</strong> — all 30 outputs: circuit, load, protection amp, trigger, logic.</li>
    <li><strong>PDM30 vs PDM15 sizing</strong> — can we drop to a PDM15? $940 saving if yes.</li>
    <li><strong>8-button keypad labels</strong> — primary/secondary pages, short/long press behavior.</li>
    <li><strong>CAN bus layout</strong> — nodes, bitrate, termination.</li>
    <li><strong>Battery line routing</strong> — Optima → RBD-190 → master fuse → PDM. Gauge/length/lugs/fuses.</li>
    <li><strong>Ground strategy</strong> — star point, body grounds, engine-to-chassis strap, sensor returns.</li>
    <li><strong>Shielded cable runs</strong> — crank, cam, knock ×2. Shield grounded at ECU only?</li>
    <li><strong>Fuel pump dedicated relay</strong> — A1000 NOT on PDM. Relay location and trigger?</li>
    <li><strong>iBooster dedicated power</strong> — 40A peak NOT on PDM. Fuse/relay/gauge?</li>
  </ol>`;

  body += `<div class="footer">
    Gap report generated from nuke wiring data. Every row answered moves a vehicle closer to a compiled M1 package.
  </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>K5 Pinout Gap Report</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { font: 11px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: #1a1a1a; max-width: 7.5in; margin: 0 auto; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  h2 { margin-top: 22px; font-size: 14px; border-bottom: 2px solid #111; padding-bottom: 3px; }
  h2 .count { float: right; font-weight: normal; color: #888; font-size: 11px; }
  table.header { width: 100%; border-bottom: 2px solid #111; margin-bottom: 14px; }
  table.header td { vertical-align: top; padding: 4px 0; }
  table.header .logo-box { border: 2px solid #111; padding: 18px 14px; font-weight: 700; font-size: 11px; text-align: center; width: 180px; letter-spacing: 1px; }
  table.header .meta { padding-left: 14px; font-size: 11px; }
  table.header .meta div { line-height: 1.6; }
  table.header .num { color: #888; font-weight: normal; font-size: 13px; }
  .coverage { margin: 10px 0 4px; font-size: 12px; }
  .chip { display: inline-block; padding: 4px 9px; border-radius: 3px; margin-right: 6px; font-weight: 600; font-size: 11px; }
  .chip.have { background: #d4f4dd; color: #155724; }
  .chip.partial { background: #fff3cd; color: #856404; }
  .chip.scaffold { background: #e0e0e0; color: #555; }
  .chip.need { background: #f8d7da; color: #721c24; }
  .chip.total, .total { color: #666; margin-left: 4px; }
  table.domain { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px; }
  table.domain th, table.domain td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  table.domain th { background: #f5f5f5; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
  table.domain th.n, table.domain td.n { text-align: right; }
  table.domain th.st, table.domain td.st { width: 68px; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 2px; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; }
  .badge.contract { background: #d4f4dd; color: #155724; }
  .badge.partial { background: #fff3cd; color: #856404; }
  .badge.scaffold { background: #e0e0e0; color: #555; }
  .badge.need { background: #f8d7da; color: #721c24; }
  tr.need td { background: #fdf5f5; }
  ol.questions li { padding: 5px 0; line-height: 1.5; }
  .footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ccc; color: #666; font-size: 10px; text-align: center; }
</style>
</head><body>
${body}
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────
// 7. CLI Entry
// ─────────────────────────────────────────────────────────────────────

export function generateReport(): { markdown: string; html: string; rows: Row[] } {
  const rows = buildRows();
  const markdown = emitMarkdown(rows);
  const html = emitHTML(markdown, rows);
  return { markdown, html, rows };
}

// CLI entry — always writes files when this module is executed by tsx/node directly.
// The wrapper script (scripts/generate-k5-gap-report.ts) imports and invokes this.
export function writeReportFiles(outDir: string): void {
  const { markdown, html, rows } = generateReport();
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, 'K5_gap_report.md');
  const htmlPath = path.join(outDir, 'K5_gap_report.html');
  fs.writeFileSync(mdPath, markdown);
  fs.writeFileSync(htmlPath, html);
  const tally = { CONTRACT: 0, PARTIAL: 0, SCAFFOLD: 0, NEED: 0 };
  rows.forEach(r => { tally[r.status]++; });
  // eslint-disable-next-line no-console
  console.log(`K5 gap report generated:`);
  console.log(`  ${mdPath}`);
  console.log(`  ${htmlPath}`);
  console.log(`  ${rows.length} devices — HAVE ${tally.CONTRACT} · PARTIAL ${tally.PARTIAL} · SCAFFOLD ${tally.SCAFFOLD} · NEED ${tally.NEED}`);
}
