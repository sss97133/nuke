#!/usr/bin/env node
/**
 * Validate every URL in K5-order-list.csv.
 *  - ProWire `/p-NNNN-...` URLs: confirm presence in catalog_parts.supplier_url (known good).
 *  - ProWire search URLs: leave as-is (always returns a search page).
 *  - All other URLs: HEAD with browser UA; treat any 2xx/3xx as good; flag others.
 * Replaces bad URLs with a per-vendor search fallback. Writes a Url_Status column.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SRC = '/Users/skylar/nuke/output/wiring/K5-order-list.csv';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// CSV parse/escape (same helpers as resolver)
function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
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
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function loadCatalogUrls() {
  const set = new Set();
  let from = 0; const PAGE = 1000;
  while (true) {
    const { data, error } = await sb.from('catalog_parts').select('supplier_url').eq('manufacturer', 'ProWire USA').range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) if (r.supplier_url) set.add(r.supplier_url);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return set;
}

async function headCheck(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    return res.status;
  } catch (e) {
    return 0;
  }
}

function vendorSearchUrl(vendor, sku, desc) {
  const q = encodeURIComponent((sku || desc || '').slice(0, 60));
  const domains = {
    'ProWire USA': 'prowireusa.com',
    'Aeromotive': 'aeromotiveinc.com',
    'Kicker': 'kicker.com',
    'Dakota Digital': 'dakotadigital.com',
    'E-Stopp': 'e-stopp.com',
    'Blue Sea Systems': 'bluesea.com',
    'Bosch': 'boschautoparts.com',
    'Bussmann': 'mouser.com',
    'Littelfuse': 'littelfuse.com',
    'Adel Clamps': 'aircraftspruce.com',
    'AVS': 'shopavs.com',
    'Diode Dynamics': 'diodedynamics.com',
    'Dorman': 'rockauto.com',
    'GM / ACDelco': 'rockauto.com',
    'Painless': 'painlessperformance.com',
    'Panduit': 'panduit.com',
    'Permatex': 'permatex.com',
    'Pollak': 'pollak.com',
    'RBD Mfg': 'rbdmanufacturing.com',
    'RealTruck': 'realtruck.com',
    'RetroSound': 'retromanufacturing.com',
    'Techflex': 'techflex.com',
    'Truck-Lite': 'truck-lite.com',
    'Tulay Wire Werks': 'tulaywirewerks.com',
    'United Pacific': 'uppi.com',
    'Wilwood': 'wilwood.com',
    'Tesa': 'amazon.com',
    'Nu-Relics': 'nu-relics.com',
    'Classic Performance': 'classicperform.com',
  };
  const d = domains[vendor];
  if (d === 'prowireusa.com') return `https://www.prowireusa.com/search?q=${q}`;
  if (d) return `https://www.google.com/search?q=${encodeURIComponent(vendor + ' ' + (sku || desc))}+site%3A${d}`;
  return `https://www.google.com/search?q=${encodeURIComponent(vendor + ' ' + (sku || desc))}`;
}

async function main() {
  console.log('Loading catalog URLs...');
  const catalogUrls = await loadCatalogUrls();
  console.log(`Catalog has ${catalogUrls.size} known-good ProWire URLs`);

  const text = readFileSync(SRC, 'utf8');
  const rows = parseCsv(text);
  const header = rows[0];
  // Insert Url_Status column after URL
  const urlIdx = header.indexOf('URL');
  const newHeader = [...header.slice(0, urlIdx + 1), 'Url_Status', ...header.slice(urlIdx + 1)];

  // Persist vendor context across blank-vendor rows (vendor only printed on first row of group)
  let currentVendor = '';
  const checked = new Map(); // url → status code
  const out = [newHeader.map(csvEscape).join(',')];

  let stats = { catalog_ok: 0, http_ok: 0, fixed: 0, unchecked: 0, search: 0, empty: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 2 || !r[header.indexOf('SKU')]) {
      // Blank or trailing row — just keep
      const padded = [...r.slice(0, urlIdx + 1), '', ...r.slice(urlIdx + 1)];
      out.push(padded.map(csvEscape).join(','));
      continue;
    }
    const vCol = r[header.indexOf('Vendor')] || currentVendor;
    if (r[header.indexOf('Vendor')]) currentVendor = r[header.indexOf('Vendor')];
    const url = r[urlIdx];
    const sku = r[header.indexOf('SKU')];
    const desc = r[header.indexOf('Description')];

    let status = 'unchecked';
    let outUrl = url;

    if (!url) {
      status = 'empty';
      outUrl = vendorSearchUrl(vCol, sku, desc);
      stats.empty++;
    } else if (catalogUrls.has(url)) {
      status = 'ok-catalog';
      stats.catalog_ok++;
    } else if (url.includes('prowireusa.com/search?q=')) {
      status = 'search';
      stats.search++;
    } else if (url.includes('google.com/search')) {
      status = 'search';
      stats.search++;
    } else {
      // Live HEAD check (non-ProWire vendor URL)
      if (!checked.has(url)) checked.set(url, await headCheck(url));
      const code = checked.get(url);
      if (code >= 200 && code < 400) { status = `http-${code}`; stats.http_ok++; }
      else {
        status = `bad-${code}`;
        outUrl = vendorSearchUrl(vCol, sku, desc);
        stats.fixed++;
      }
    }

    const newRow = [...r];
    newRow[urlIdx] = outUrl;
    newRow.splice(urlIdx + 1, 0, status);
    out.push(newRow.map(csvEscape).join(','));
  }

  writeFileSync(SRC, out.join('\n'));
  console.log('Url status counts:', stats);
}

main().catch((e) => { console.error(e); process.exit(1); });
