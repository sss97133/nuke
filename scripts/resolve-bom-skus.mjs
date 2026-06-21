#!/usr/bin/env node
/**
 * Resolve MASTER_BOM.csv rows against catalog_parts (ProWire scraped catalog).
 * Output:  output/wiring/K5-order-list.csv  with real SKU + product URL columns
 *          and a Match column (exact|wire|fuzzy|unresolved).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const BOM_PATH = '/Users/skylar/nuke/docs/wiring/build-plan/MASTER_BOM.csv';
const OUT_PATH = '/Users/skylar/nuke/output/wiring/K5-order-list.csv';

// CSV parse — handles quoted fields with commas
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') {}
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function csvEscape(s) {
  s = String(s ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Vendor normalization (same as render_bom_csv.py)
const VENDOR_RULES = [
  [/prowire.*/, 'ProWire USA'],
  [/autosport.*/, 'Autosport (via ProWire)'],
  [/dr-25.*|raychem.*/, 'Raychem'],
  [/aem.*aeromotive|aeromotive/, 'Aeromotive'],
  [/^motec$/, 'MoTeC'],
  [/dakota.*/, 'Dakota Digital'],
  [/daniels.*/, 'Daniels Mfg'],
  [/bill\s*hirsch.*/, 'Bill Hirsch'],
  [/e-stopp.*/, 'E-Stopp'],
  [/bluesea/, 'Blue Sea Systems'],
  [/^bosch$/, 'Bosch'],
  [/bussmann/, 'Bussmann'],
  [/littelfuse/, 'Littelfuse'],
  [/^3m$/, '3M'],
  [/adel.*clamps?/, 'Adel Clamps'],
  [/^avs$/, 'AVS'],
  [/diode.*dynamics/, 'Diode Dynamics'],
  [/^dorman$/, 'Dorman'],
  [/gm.*ac.*delco|gm.*delco/, 'GM / ACDelco'],
  [/^kicker$/, 'Kicker'],
  [/^painless$/, 'Painless'],
  [/^panduit$/, 'Panduit'],
  [/^permatex$/, 'Permatex'],
  [/^pollak$/, 'Pollak'],
  [/rbd.*/, 'RBD Mfg'],
  [/^realtruck$/, 'RealTruck'],
  [/^retrosound$/, 'RetroSound'],
  [/^techflex$/, 'Techflex'],
  [/^truck-lite$/, 'Truck-Lite'],
  [/tulay.*/, 'Tulay Wire Werks'],
  [/united.*pacific/, 'United Pacific'],
  [/^vishay.*/, 'Vishay'],
  [/welding.*boss.*/, 'Welding Boss Fab'],
  [/^wilwood$/, 'Wilwood'],
  [/^essex$/, 'Essex'],
  [/harnesstape/, 'Tesa'],
  [/nurelics/, 'Nu-Relics'],
  [/classicperformance/, 'Classic Performance'],
  [/^amp$/, 'AMP/TE'],
  [/desert performance/, 'Desert Performance'],
];

const SKIP_VENDORS = new Set([
  'BOM_TOTAL','TOTAL','labor','generic','Generic','boots','clips','connectors',
  'fuses','grommets','Grommets','heat-shrink','Ring_Terminals','seals','sensors',
  'sheathing','Star_washers','tape','terminals','ties','tools','TOOLS','TOOLS-REQUIRED',
  'Tool_Required','Tools_required','other','Fuses_and_holders','Welding_boss','Dielectric_grease',
]);

function normalizeVendor(v) {
  v = v.trim();
  if (SKIP_VENDORS.has(v)) return null;
  const vl = v.toLowerCase();
  for (const [re, canon] of VENDOR_RULES) {
    if (re.test(vl)) return canon;
  }
  return v;
}

// Color encoding used by ProWire SKUs: 0=Black 1=Brown 2=Red 3=Orange 4=Yellow 5=Green 6=Blue 7=Violet 8=Gray 9=White
const COLOR_CODE = {
  black: '0', brown: '1', red: '2', orange: '3', yellow: '4',
  green: '5', blue: '6', violet: '7', gray: '8', grey: '8', white: '9',
};

const COLOR_ALIAS = {
  blk: 'black', bk: 'black', k: 'black',
  brn: 'brown', br: 'brown', tan: 'brown',
  rd: 'red', r: 'red',
  org: 'orange', or: 'orange',
  yel: 'yellow', yl: 'yellow',
  grn: 'green', gn: 'green',
  blu: 'blue', bl: 'blue',
  vio: 'violet', v: 'violet', pur: 'violet', purple: 'violet',
  gry: 'gray', grey: 'gray',
  wht: 'white', wh: 'white', w: 'white',
};

function normColor(s) {
  s = s.toLowerCase().replace(/[^a-z]/g, '');
  return COLOR_ALIAS[s] || s;
}

// Pick mil-spec: gauges 2/4/6/8 use M22759/16, gauges 10+ use M22759/32
function milSpecForGauge(g) {
  const n = parseInt(g, 10);
  if (n <= 8) return 'M22759/16';
  return 'M22759/32';
}

// Explicit shop-notation → real-SKU overrides (for common multi-word kits)
const SKU_OVERRIDE = {
  'GM-COIL-4P-KIT': '68240',  // GM LS3 D510C coil connector set of 8
};

// Parse BOM SKU/description → array of candidate ProWire SKUs (try in order)
function deriveProWireSku(sku, desc) {
  sku = (sku || '').trim();
  const d = (desc || '').toLowerCase();
  const cands = [];

  if (SKU_OVERRIDE[sku]) cands.push(SKU_OVERRIDE[sku]);

  // TEF-{gauge}-{color}
  let m = sku.match(/^TEF(?:ZEL)?-(\d+)(?:-HF)?-([A-Z]+)/i);
  if (m) {
    const gauge = m[1];
    const color = normColor(m[2]);
    const code = COLOR_CODE[color];
    if (code) cands.push(`${milSpecForGauge(gauge)}-${gauge}-${code}`);
  }

  // AMP-POWER-{gauge}AWG-{color}, AMP-GND-{gauge}AWG-{color}, WIRE-{gauge}-{color}-...
  m = sku.match(/^(?:AMP-POWER|AMP-GND|WIRE)-(\d+(?:\/\d+)?)\s*(?:AWG|GA)?-([A-Z]+)/i);
  if (m) {
    const gauge = m[1];
    const color = normColor(m[2]);
    const code = COLOR_CODE[color];
    if (code) cands.push(`${milSpecForGauge(gauge)}-${gauge}-${code}`);
  }

  // TXL-{gauge}-{color}
  m = sku.match(/^TXL(?:-HF)?-(\d+)-([A-Z\-]+)/i);
  if (m) {
    const gauge = m[1];
    const color = normColor(m[2].split('-')[0]);
    const code = COLOR_CODE[color];
    if (code) cands.push(`TXL-${gauge}-${code}`);
    cands.push(`TXL-${gauge}-0`);
  }

  // Already real
  if (/^M22759\/32-\d+-\d$/.test(sku) || /^TXL-\d+-\d$/.test(sku) || /^DR-25/.test(sku)) {
    cands.push(sku);
  }

  // DR-25 sleeving:
  //   BOM SKU forms: DR25-3/4-BLK, DR-25-3/4-BLK, DR-25-1/2in-10ft, DR25-50, DR25-125, DR25-0.50-BK-SP
  //   Real:          DR-25-3/4-0-UK, DR-25-1/2-0-UK, DR-25-1/8-0-UK ...
  // Size encodings to normalize:
  //   "1/2", "1/4", "3/8", "3/4", "3/16", "1/8", "3/32", "1"
  //   numeric: 125 → 1/8, 25 → 1/4, 50 → 1/2, 75 → 3/4, 38 → 3/8, 16 → 3/16, 100 → 1
  const dr25Sizes = ['3/32', '3/16', '1/8', '1/4', '3/8', '1/2', '3/4', '1', '1-1/2'];
  const dr25NumMap = {
    '125': '1/8', '25': '1/4', '375': '3/8', '50': '1/2', '75': '3/4', '100': '1', '188': '3/16',
    // decimal forms with dot: 0.25, 0.50, 0.75, 1.0
    '0.125': '1/8', '0.25': '1/4', '0.375': '3/8', '0.50': '1/2', '0.5': '1/2',
    '0.75': '3/4', '1.0': '1', '1.00': '1',
  };
  // Look for decimal form first: DR25-0.75, DR25-1.0
  const decMatch = sku.match(/DR[-]?25[-]?(\d+\.\d+|\d+\.\d{1,2})/i);
  if (decMatch && dr25NumMap[decMatch[1]]) {
    const mapped = dr25NumMap[decMatch[1]];
    cands.push(`DR-25-${mapped}-0-UK`);
    cands.push(`DR-25-${mapped}-0-TW`);
  }
  if (/^DR[-]?25/.test(sku) || /dr.25/i.test(sku) || /\bdr.?25\b/i.test(d)) {
    let sizeFound = null;
    // 1. Fraction directly in SKU (DR-25-1/2-..., DR25-3/4-...)
    const fracMatch = sku.match(/DR[-]?25[-]?(\d+\/\d+(?:[-/]\d+)?)/i);
    if (fracMatch && dr25Sizes.includes(fracMatch[1])) sizeFound = fracMatch[1];
    // 2. NumMap (shop notation: DR25-125 = 1/8, DR25-25 = 1/4, etc.)
    if (!sizeFound) {
      const nm = sku.match(/DR[-]?25[-]?(\d{2,3})(?:[-]|$)/);
      if (nm && dr25NumMap[nm[1]]) sizeFound = dr25NumMap[nm[1]];
    }
    // 3. Plain "1" inch — only if SKU ends with "-1" exactly or has "-1in"
    if (!sizeFound && /DR[-]?25[-]?1(?:in|"|-|$)/i.test(sku) && !/DR[-]?25[-]?1\.\d/.test(sku)) {
      sizeFound = '1';
    }
    // 4. Description-based: "3/4 in", "1.0\" ID", "1/8 in"
    if (!sizeFound) {
      const dFrac = d.match(/(\d+\/\d+)\s*(?:in|"|inch)/);
      if (dFrac && dr25Sizes.includes(dFrac[1])) sizeFound = dFrac[1];
    }
    if (!sizeFound) {
      const dDec = d.match(/(\d+\.\d+)\s*(?:in|"|inch)/);
      if (dDec && dr25NumMap[dDec[1]]) sizeFound = dr25NumMap[dDec[1]];
    }
    if (!sizeFound) {
      const d1in = d.match(/\b1\s*(?:in|"|inch)/);
      if (d1in) sizeFound = '1';
    }
    if (sizeFound) {
      cands.push(`DR-25-${sizeFound}-0-UK`);
      cands.push(`DR-25-${sizeFound}-0-TW`);
    }
  }
  // DR-25 from description
  if (d.includes('dr-25') || d.includes('dr25')) {
    const sizeMatch = d.match(/(\d(?:[-\s]\d)?(?:\/\d+)?)\s*(?:in|"|inch)/);
    if (sizeMatch) {
      const s = sizeMatch[1].replace(/\s+/g, '-');
      cands.push(`DR-25-${s}-0-UK`);
      cands.push(`DR-25-${s}-0-TW`);
    }
  }

  // Welding cable: WIRE-{gauge}-{color}-{...} → catalog typically WC-{gauge}-{color} or similar
  // We'll fall through to fuzzy match.

  // Description-based wire fallbacks
  m = d.match(/(\d+)\s*awg\s+.{0,40}?(tefzel|m22759)/);
  if (m) {
    const gauge = m[1];
    const colorMatch = d.match(/(black|brown|red|orange|yellow|green|blue|violet|gray|grey|white)/);
    if (colorMatch) {
      const code = COLOR_CODE[colorMatch[1].toLowerCase()];
      if (code) cands.push(`M22759/32-${gauge}-${code}`);
    }
  }
  m = d.match(/(\d+)\s*awg\s+txl/);
  if (m) {
    const gauge = m[1];
    const colorMatch = d.match(/(black|brown|red|orange|yellow|green|blue|violet|gray|grey|white)/);
    if (colorMatch) {
      const code = COLOR_CODE[colorMatch[1].toLowerCase()];
      if (code) cands.push(`TXL-${gauge}-${code}`);
    } else {
      cands.push(`TXL-${gauge}-0`);
    }
  }

  return cands;
}

async function loadCatalog() {
  const bySku = new Map();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('catalog_parts')
      .select('part_number, name, description, supplier_url, price_current')
      .eq('manufacturer', 'ProWire USA')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) bySku.set(r.part_number, r);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return bySku;
}

function fuzzyMatch(catalog, desc) {
  // Token-overlap scoring across all catalog rows. Pick best > threshold.
  const tokens = (desc || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return null;
  let best = null;
  let bestScore = 0;
  for (const [sku, row] of catalog) {
    const hay = ((row.name || '') + ' ' + (row.description || '')).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  // Require at least 3 token hits AND >= 50% of distinguishing tokens
  if (bestScore >= 3 && bestScore / tokens.length >= 0.5) return best;
  return null;
}

function isSpecificUrl(url) {
  if (!url) return false;
  // ProWire's /p/ paths in MASTER_BOM are speculative — many are 404. Don't trust.
  if (url.includes('prowireusa.com/p/')) return false;
  if (url.includes('/p-')) return true;
  if (url.includes('/products/') || url.includes('/product/')) return true;
  if (/\/\d{4,}/.test(url)) return true;
  return false;
}

function prowireSearchUrl(sku, description) {
  const q = encodeURIComponent((sku || description || '').slice(0, 60));
  return `https://www.prowireusa.com/search?q=${q}`;
}

async function main() {
  console.log('Loading catalog...');
  const catalog = await loadCatalog();
  console.log(`Loaded ${catalog.size} ProWire SKUs from catalog_parts`);

  const text = readFileSync(BOM_PATH, 'utf8');
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  // Group by canonical vendor — drop skip vendors and zero-qty rows
  const byVendor = new Map();
  let grand = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < header.length) continue;
    const qty = parseInt(r[idx.qty], 10);
    if (!qty || qty <= 0) continue;
    const vendor = normalizeVendor(r[idx.vendor]);
    if (!vendor) continue;
    const unit = parseFloat(r[idx.unit_cost]) || 0;
    const total = parseFloat(r[idx.total_cost]) || 0;
    const item = {
      sku_in: r[idx.sku],
      qty,
      description: r[idx.description],
      unit,
      total,
      url_in: r[idx.url],
      subharness: r[idx.subharness_consumers],
      notes: r[idx.notes],
    };

    // Resolution
    let matchKind = 'unresolved';
    let realSku = item.sku_in;
    let realUrl = item.url_in;

    if (vendor === 'ProWire USA' || vendor === 'Autosport (via ProWire)' || vendor === 'Raychem') {
      // 1. Exact match on catalog
      if (catalog.has(item.sku_in)) {
        const hit = catalog.get(item.sku_in);
        matchKind = 'exact';
        realUrl = hit.supplier_url;
      } else {
        // 2. Derive SKU from BOM patterns — try each candidate
        const candidates = deriveProWireSku(item.sku_in, item.description);
        let derivedHit = null;
        for (const c of candidates) {
          if (catalog.has(c)) { derivedHit = { sku: c, ...catalog.get(c) }; break; }
        }
        if (derivedHit) {
          matchKind = 'wire';
          realSku = derivedHit.sku;
          realUrl = derivedHit.supplier_url;
        } else {
          // 3. Fuzzy description match
          const hit = fuzzyMatch(catalog, item.description);
          if (hit) {
            matchKind = 'fuzzy';
            realSku = hit.part_number;
            realUrl = hit.supplier_url;
          } else {
            // 4. Last resort — ProWire on-site search
            realUrl = prowireSearchUrl(item.sku_in, item.description);
          }
        }
      }
    } else {
      // Other vendors: keep the BOM URL if it's specific
      if (isSpecificUrl(item.url_in)) {
        matchKind = 'exact';
      }
    }

    if (!byVendor.has(vendor)) byVendor.set(vendor, []);
    // Dedup within vendor by sku+description
    const list = byVendor.get(vendor);
    const dedupKey = `${realSku}|${item.description}`;
    const existing = list.find((x) => x._key === dedupKey);
    if (existing) {
      existing.qty += qty;
      existing.total += total;
      if (item.subharness && !existing.subharness.includes(item.subharness)) {
        existing.subharness = (existing.subharness + '+' + item.subharness).replace(/^\++/, '');
      }
    } else {
      list.push({
        _key: dedupKey,
        match: matchKind,
        realSku,
        realUrl,
        qty,
        description: item.description,
        unit,
        total,
        subharness: item.subharness || '',
        notes: item.notes || '',
      });
    }
    grand += total;
  }

  // Sort vendors by subtotal desc
  const vendors = [...byVendor.entries()].sort((a, b) => {
    const sa = a[1].reduce((s, r) => s + r.total, 0);
    const sb = b[1].reduce((s, r) => s + r.total, 0);
    return sb - sa;
  });

  // Write CSV
  const out = [];
  out.push(['Ordered?', 'Match', 'Vendor', 'Vendor_Subtotal', 'SKU', 'Qty', 'Description', 'Unit', 'Total', 'URL', 'Sub-harness', 'Notes'].join(','));
  let resolved = 0;
  let unresolved = 0;
  const counts = { exact: 0, wire: 0, fuzzy: 0, unresolved: 0 };
  for (const [vendor, items] of vendors) {
    const subtotal = items.reduce((s, r) => s + r.total, 0);
    items.sort((a, b) => b.total - a.total);
    items.forEach((it, i) => {
      counts[it.match] = (counts[it.match] || 0) + 1;
      out.push([
        '',
        it.match,
        i === 0 ? vendor : '',
        i === 0 ? `$${subtotal.toFixed(2)}` : '',
        it.realSku,
        it.qty,
        it.description,
        it.unit.toFixed(2),
        it.total.toFixed(2),
        it.realUrl,
        it.subharness,
        it.notes,
      ].map(csvEscape).join(','));
    });
    out.push('');  // blank row between vendors
  }
  out.push(['', '', 'GRAND TOTAL', `$${grand.toFixed(2)}`, '', '', '', '', '', '', '', ''].map(csvEscape).join(','));

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, out.join('\n'));

  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Match breakdown: ${JSON.stringify(counts)}`);
  console.log(`Grand total: $${grand.toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
