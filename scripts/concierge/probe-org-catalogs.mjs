#!/usr/bin/env node
// Census: which L'Officiel concierge orgs have a LIVE MACHINE-READABLE CATALOG?
//
// Doctrine (same as fill-org-profiles.mjs):
//   - Nothing is generated. A catalog is recorded only if we actually fetched it and it
//     actually parsed into products with real prices.
//   - Every finding carries (source endpoint, method, observed_at).
//   - ENTITY GATE: a catalog found on a host shared by many orgs (sibarth.com, an
//     aggregator/booking portal) is NOT that org's own catalog. Those are marked
//     `shared_host` and are NEVER ingestion candidates — matching a domain is not enough.
//
// Probes, in order, per resolved host:
//   1. Shopify        /products.json?limit=1
//   2. WooCommerce    /wp-json/wc/store/products?per_page=1
//   3. platform sniff of the homepage HTML/headers (Shopify, Wix, Squarespace,
//      BigCommerce, PrestaShop, WooCommerce-without-Store-API, Lightspeed, Ecwid)
//
// Usage:
//   node scripts/concierge/probe-org-catalogs.mjs            # probe + write census JSON
//   node scripts/concierge/probe-org-catalogs.mjs --limit 50
//
// Output: scratchpad/catalog-census.json  (read by report + ingest planning)
// This script is READ-ONLY against the network and writes NOTHING to the database.

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OUT = process.env.CENSUS_OUT || '/private/tmp/claude-501/-Users-skylar/afb845d5-f84b-46f5-b0ac-445fe2d76034/scratchpad/catalog-census.json';
const CONC = Number(process.env.CONC || 10);
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const now = () => new Date().toISOString();

async function get(url, { timeout = 15000, json = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    const ct = r.headers.get('content-type') || '';
    const body = await r.text();
    return { ok: r.ok, status: r.status, url: r.url, ct, body, headers: r.headers };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e), body: '', ct: '' };
  } finally { clearTimeout(t); }
}

// A 429 is Shopify throttling US, not an empty catalog. Recording the zero would have
// written "this store has no products" into the census — a clean-looking lie. Back off
// and retry; if it never clears, the caller records `blocked`, never zero.
async function getRetry(url, opts = {}, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await get(url, opts);
    if (last.status !== 429 && last.status !== 430 && last.status !== 503 && last.status !== 0) return last;
    const ra = Number(last.headers?.get?.('retry-after')) || 0;
    const wait = Math.max(ra * 1000, 2000 * Math.pow(2, i));
    await new Promise((s) => setTimeout(s, wait));
  }
  return last;
}

// ---------- host normalisation ----------
function hostOf(website) {
  if (!website) return null;
  let w = website.trim();
  if (!/^https?:\/\//i.test(w)) w = 'https://' + w;
  try {
    const u = new URL(w);
    return u.hostname.toLowerCase().replace(/\.$/, '');
  } catch { return null; }
}

// ---------- probes ----------
async function probeShopify(host) {
  // limit=1 first: cheap liveness check before paginating anything.
  const r = await get(`https://${host}/products.json?limit=1`, { json: true });
  if (!r.ok || !/json/i.test(r.ct)) return null;
  let j;
  try { j = JSON.parse(r.body); } catch { return null; }
  if (!j || !Array.isArray(j.products)) return null;
  return {
    platform: 'shopify',
    endpoint: `https://${host}/products.json`,
    method: 'shopify_products_json',
    live: j.products.length > 0,
    sample: j.products[0] || null,
    resolved_url: r.url,
  };
}

async function probeWoo(host) {
  const r = await get(`https://${host}/wp-json/wc/store/products?per_page=1`, { json: true });
  if (!r.ok || !/json/i.test(r.ct)) return null;
  let j;
  try { j = JSON.parse(r.body); } catch { return null; }
  if (!Array.isArray(j)) return null;
  return {
    platform: 'woocommerce',
    endpoint: `https://${host}/wp-json/wc/store/products`,
    method: 'woocommerce_store_api',
    live: j.length > 0,
    sample: j[0] || null,
    resolved_url: r.url,
  };
}

// Platform sniff — evidence that a storefront EXISTS even when no open endpoint does.
const SNIFF = [
  [/cdn\.shopify\.com|Shopify\.theme|shopify-features|myshopify\.com/i, 'shopify'],
  [/static1\.squarespace\.com|squarespace\.com\/universal|Squarespace\.afterBodyLoad/i, 'squarespace'],
  [/cdn11\.bigcommerce\.com|bigcommerce\.com\/s-/i, 'bigcommerce'],
  [/woocommerce|wc-ajax|wp-content\/plugins\/woocommerce/i, 'woocommerce'],
  [/static\.parastorage\.com|wixstatic\.com|wix-code|Wix\.com Website Builder/i, 'wix'],
  [/prestashop|\/modules\/ps_/i, 'prestashop'],
  [/ecwid|app\.ecwid\.com/i, 'ecwid'],
  [/cdn\.shoplightspeed\.com|lightspeedhq/i, 'lightspeed'],
  [/wp-content|wp-includes/i, 'wordpress'],
];

async function sniff(host) {
  const r = await get(`https://${host}/`);
  if (!r.ok) {
    const r2 = await get(`http://${host}/`);
    if (!r2.ok) return { reachable: false, error: r.error || `HTTP ${r.status}`, status: r.status };
    return sniffBody(r2);
  }
  return sniffBody(r);
}

function sniffBody(r) {
  const hits = [];
  for (const [re, name] of SNIFF) if (re.test(r.body)) hits.push(name);
  // commerce-intent markers in the markup — a store UI even if the platform is unknown
  const cart = /add to cart|ajouter au panier|add to bag|\/cart\b|checkout|boutique en ligne|shop now/i.test(r.body);
  return {
    reachable: true,
    status: r.status,
    resolved_url: r.url,
    platforms: [...new Set(hits)],
    cart_markers: cart,
    title: (r.body.match(/<title[^>]*>([^<]{0,200})<\/title>/i) || [])[1]?.trim() || null,
  };
}

async function probeOrgHost(host) {
  const rec = { host, observed_at: now() };
  const s = await probeShopify(host);
  if (s) { rec.catalog = s; }
  if (!rec.catalog) {
    const w = await probeWoo(host);
    if (w) rec.catalog = w;
  }
  rec.sniff = await sniff(host);
  // A sniff-only shopify (theme present but products.json closed) is still a real
  // storefront — record it as detected-but-not-open rather than pretending it's ingestible.
  return rec;
}

// ---------- stage 2: deep measure of a host that HAS an open endpoint ----------
// Answers the three things that decide ingestibility:
//   how many products are really there · what CURRENCY the store actually prices in
//   · does the store identify the org (entity gate).
// Currency is READ, never assumed. products.json carries no currency field at all —
// assuming EUR because the island is EUR is exactly the bug that shipped before.

async function shopifyCurrency(host) {
  // 1. the storefront's own JS config — authoritative, set by Shopify itself
  const home = await getRetry(`https://${host}/`);
  const m = home.body.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/);
  if (m) return { currency: m[1], method: 'shopify_currency_active', source: `https://${host}/` };
  // 2. cart.js reports the shop's presentment currency
  const cart = await getRetry(`https://${host}/cart.js`, { json: true });
  try {
    const j = JSON.parse(cart.body);
    if (j && typeof j.currency === 'string' && /^[A-Z]{3}$/.test(j.currency)) {
      return { currency: j.currency, method: 'shopify_cart_js', source: `https://${host}/cart.js` };
    }
  } catch { /* not json */ }
  // 3. og:price:currency / JSON-LD priceCurrency on the homepage
  const og = home.body.match(/priceCurrency["']?\s*[:=]\s*["']([A-Z]{3})["']/)
    || home.body.match(/<meta[^>]+og:price:currency[^>]+content=["']([A-Z]{3})["']/i);
  if (og) return { currency: og[1], method: 'markup_price_currency', source: `https://${host}/` };
  return { currency: null, method: 'unresolved', source: `https://${host}/` };
}

async function shopifyCount(host) {
  const all = [];
  for (let page = 1; page <= 60; page++) {
    const r = await getRetry(`https://${host}/products.json?limit=250&page=${page}`, { json: true, timeout: 30000 });
    let j;
    try { j = JSON.parse(r.body); } catch {
      if (page === 1) throw new Error(`products.json unreadable (HTTP ${r.status})`);
      break;
    }
    const ps = j?.products || [];
    if (!ps.length) break;
    all.push(...ps);
    if (ps.length < 250) break;
    await new Promise((s) => setTimeout(s, 900));
  }
  return all;
}

async function wooAll(host) {
  const all = [];
  for (let page = 1; page <= 60; page++) {
    const r = await getRetry(`https://${host}/wp-json/wc/store/products?per_page=100&page=${page}`, { json: true, timeout: 30000 });
    let j;
    try { j = JSON.parse(r.body); } catch {
      if (page === 1) throw new Error(`store API unreadable (HTTP ${r.status})`);
      break;
    }
    if (!Array.isArray(j) || !j.length) break;
    all.push(...j);
    if (j.length < 100) break;
    await new Promise((s) => setTimeout(s, 600));
  }
  return all;
}

async function deepMeasure(rec) {
  const host = rec.host;
  const plat = rec.catalog.platform;
  if (plat === 'shopify') {
    const products = await shopifyCount(host);
    const cur = await shopifyCurrency(host);
    const priced = products.filter((p) => (p.variants || []).some((v) => v.price && Number(v.price) > 0));
    return {
      platform: 'shopify', product_count: products.length, priced_count: priced.length,
      currency: cur.currency, currency_method: cur.method, currency_source: cur.source,
      vendors: [...new Set(products.map((p) => p.vendor).filter(Boolean))].slice(0, 12),
      titles: products.slice(0, 5).map((p) => p.title),
      products,
    };
  }
  const products = await wooAll(host);
  // Woo's Store API states the currency per price object — no guessing needed.
  const curs = [...new Set(products.map((p) => p.prices?.currency_code).filter(Boolean))];
  const priced = products.filter((p) => Number(p.prices?.price || 0) > 0);
  return {
    platform: 'woocommerce', product_count: products.length, priced_count: priced.length,
    currency: curs.length === 1 ? curs[0] : null,
    currency_method: curs.length === 1 ? 'woocommerce_prices_currency_code' : `ambiguous:${curs.join('/')}`,
    currency_source: `https://${host}/wp-json/wc/store/products`,
    titles: products.slice(0, 5).map((p) => p.name),
    products,
  };
}

// ---------- stage 3: ingest ----------
// Row shape mirrors scripts/ingest_shopify_catalog.py (retail path) so the corpus stays
// homogeneous. Three things that ingester could not do, done here:
//   · WooCommerce as well as Shopify (Woo is half the island's open catalogs)
//   · currency taken from the MEASURED store value, never a --currency flag guess
//   · a per-product idempotency key, so a partial run RESUMES instead of duplicating.
//     (the python's --force re-POSTs every row with no on_conflict — a duplicate-maker)

const GENERIC = /^(the|and|les|des|del|saint|st|barth|barths|barthelemy|sbh|sas|sarl|inc|ltd|llc|group|groupe|restaurant|restaurants|bar|cafe|hotel|villa|villas|boutique|shop|store|beach|club|jewelry|jewellery|bijouterie|chef|chefs|prive|events|event|design|studio|rental|rentals|agence|agency|services|service|company|maison|island|caraibes|france|paris|official|site|home|gustavia|gym|water|creation|creations|art|arts)$/;
const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const compact = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s) => fold(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !GENERIC.test(t));

// ENTITY GATE (same standard as fill-org-profiles.mjs `hostAnchored`): a catalog is
// evidence about THIS org only if the org's identity is anchored in the domain itself.
// Matching "there is a store at the URL on the row" is NOT enough — sibarth.com sells
// villas but is not "Villa Seala"'s catalog.
function entityGate(orgName, host) {
  const hostc = compact(host.replace(/^www\./, '').replace(/\.(com|fr|net|org|co|sb|eu|io|shop|store|co\.uk)$/, ''));
  const on = tokens(orgName);
  const namec = compact(orgName);
  const hit = on.find((t) => hostc.includes(compact(t)));
  if (hit) return { pass: true, basis: `org token "${hit}" appears in host "${hostc}"` };
  if (!on.length && namec.length >= 6 && (hostc.includes(namec) || namec.includes(hostc))) {
    return { pass: true, basis: `whole compacted name matches host "${hostc}"` };
  }
  return { pass: false, basis: `no distinctive token of "${orgName}" appears in host "${hostc}"` };
}

const stripHtml = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&#0?39;|&rsquo;|&apos;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim() || null;

function shopifyRow(p, org_id, host, currency, ts, batch, market) {
  const variants = p.variants || [];
  const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  const imgs = (p.images || []).map((i) => i.src).filter(Boolean);
  return {
    org_id, name: p.title, kind: 'retail_item',
    description: stripHtml(p.body_html),
    // No price is recorded as NULL. A product whose store publishes no price is a real
    // product with an unknown price — inventing one would be the sabotage.
    price: prices.length ? Math.min(...prices) : null,
    currency, price_unit: 'each',
    source: host, method: 'shopify_products_json', trust: 'T2',
    observed_at: ts, access_tier: 'public', status: 'live',
    provenance: {
      url: `https://${host}/products/${p.handle}`, handle: p.handle,
      shopify_product_id: p.id, source_endpoint: `${host}/products.json`,
      scraped_at: ts, agent: 'catalogue-probe', batch,
      // Shopify Markets stores serve a DIFFERENT price and currency depending on the
      // request. cultgaia.com returns $478.00 with no Accept-Language and €433.95 with
      // one — the same dress. So the request context is part of the measurement and is
      // recorded here; without it the number is not reproducible and not defensible.
      market_pin: { accept_language: market?.accept_language || null,
                    market_variable: market?.market_variable ?? null },
      currency_basis: `read from the store under the recorded market pin (${market?.currency_method || 'unknown'}); never assumed from the island's currency`,
      listed_price_semantics: `listed web price (${currency}) published by the merchant's own online store on ${ts}`
        + (market?.market_variable ? ', for the EUR market this store serves to a fr-FR request; the same product is priced differently in the store\'s other markets' : '')
        + '. St Barth boutique stock and pricing may differ.',
    },
    structured_data: {
      product_type: p.product_type || null, vendor: p.vendor || null, tags: p.tags || [],
      market_variable: market?.market_variable ?? null,
      available: variants.some((v) => v.available),
      price_min: prices.length ? Math.min(...prices) : null,
      price_max: prices.length ? Math.max(...prices) : null,
      variant_count: variants.length, image_count: imgs.length,
    },
    media: imgs.map((u) => ({ url: u, type: 'image', source: host })),
  };
}

function wooRow(p, org_id, host, currency, ts, batch) {
  const pr = p.prices || {};
  // currency_minor_unit differs per store (0 on some, 2 on others). Dividing by a fixed
  // 100 turns an 8000 into 8000.00 or 80.00 depending on the store — it must be read.
  // Legacy Store API installs (pre currency_minor_unit) omit the key entirely and return
  // `price` ALREADY IN MAJOR UNITS alongside a `decimals` field. Defaulting to 2 there
  // silently divides a real €12.00 down to €0.12 — measured on naturaldelights-stbarth.fr.
  // Absent key => minor unit 0 (no scaling). Never guess 2.
  const hasMinor = pr.currency_minor_unit !== undefined && pr.currency_minor_unit !== null
    && Number.isFinite(Number(pr.currency_minor_unit));
  const minor = hasMinor ? Number(pr.currency_minor_unit) : 0;
  const raw = Number(pr.price);
  const price = Number.isFinite(raw) && raw > 0 ? raw / Math.pow(10, minor) : null;
  const imgs = (p.images || []).map((i) => i.src).filter(Boolean);
  // A rental shop's "45,00 € / day" is NOT a retail price. price_html carries the unit
  // suffix the merchant renders; recording 'each' regardless would invent the semantics.
  const suffix = (stripHtml(p.price_html) || '').replace(/^[^/]*/, '').trim();
  const unit = /^\/\s*\S/.test(suffix) ? suffix.replace(/^\/\s*/, '').toLowerCase() : 'each';
  return {
    org_id, name: stripHtml(p.name), kind: 'retail_item',
    description: stripHtml(p.description) || stripHtml(p.short_description),
    price, currency, price_unit: unit,
    source: host, method: 'woocommerce_store_api', trust: 'T2',
    observed_at: ts, access_tier: 'public', status: 'live',
    provenance: {
      url: p.permalink, woo_product_id: p.id, sku: p.sku || null,
      source_endpoint: `${host}/wp-json/wc/store/products`,
      scraped_at: ts, agent: 'catalogue-probe', batch,
      price_basis: price === null ? 'store publishes no price for this product' :
        `minor_unit=${minor} applied to raw ${pr.price}`,
      price_unit_basis: unit === 'each' ? 'no unit suffix rendered by the merchant'
        : `merchant renders "${suffix}" after the price`,
      listed_price_semantics: `listed web price (${currency}${unit === 'each' ? '' : ' per ' + unit}) from the merchant's own online store as published on ${ts}.`,
    },
    structured_data: {
      product_type: p.type || null, on_sale: p.on_sale ?? null,
      categories: (p.categories || []).map((c) => c.name),
      variant_count: (p.variations || []).length, image_count: imgs.length,
    },
    media: imgs.map((u) => ({ url: u, type: 'image', source: host })),
  };
}

const keyOf = (r) => r.provenance.handle || String(r.provenance.woo_product_id || r.provenance.shopify_product_id || r.name);

async function ingestMain() {
  const APPLY = process.argv.includes('--apply');
  const BATCH = `catalogue-probe-${new Date().toISOString().slice(0, 10)}`;
  const census = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const deep = JSON.parse(fs.readFileSync(OUT.replace('.json', '.deep.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(OUT.replace('.json', '.plan.json'), 'utf8'));
  const byHost = Object.fromEntries(deep.map((d) => [d.host, d]));

  let totalWould = 0, totalWrote = 0;
  const report = [];
  for (const t of plan.ingest) {
    const d = byHost[t.host] || {};
    const currency = t.currency;
    // Shopify prices are only meaningful under the market they were fetched in, so the
    // pinned re-fetch is the authoritative file when one exists.
    const pinnedFile = OUT.replace('catalog-census.json', `pinned.products.${t.host}.json`);
    const file = (t.platform === 'shopify' && fs.existsSync(pinnedFile))
      ? pinnedFile : OUT.replace('.json', `.products.${t.host}.json`);
    if (!fs.existsSync(file)) { report.push({ ...t, status: 'no_product_file' }); continue; }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ts = new Date().toISOString();
    const rows = raw.map((p) => (t.platform === 'shopify'
      ? shopifyRow(p, t.org_id, t.host, currency, ts, BATCH, t.market)
      : wooRow(p, t.org_id, t.host, currency, ts, BATCH)));

    // resume key: what has THIS method already landed for THIS org?
    let have = new Set(), f = 0;
    for (;;) {
      const { data, error } = await db.from('concierge_products')
        .select('name,provenance').eq('org_id', t.org_id).eq('method', t.platform === 'shopify' ? 'shopify_products_json' : 'woocommerce_store_api')
        .order('name').range(f, f + 999);
      if (error) throw error;
      data.forEach((r) => have.add(r.provenance?.handle || String(r.provenance?.woo_product_id || r.provenance?.shopify_product_id || r.name)));
      if (data.length < 1000) break;
      f += 1000;
    }
    const fresh = rows.filter((r) => !have.has(keyOf(r)));
    totalWould += fresh.length;
    const priced = fresh.filter((r) => r.price !== null).length;
    console.log(`${t.host.padEnd(30)} ${t.platform.padEnd(12)} new=${String(fresh.length).padEnd(5)} priced=${String(priced).padEnd(5)} cur=${currency} already=${have.size}`);
    if (!APPLY) { report.push({ ...t, would_write: fresh.length, priced }); continue; }
    let wrote = 0;
    for (let i = 0; i < fresh.length; i += 40) {
      const { error } = await db.from('concierge_products').insert(fresh.slice(i, i + 40));
      if (error) { console.log(`   ! ${t.host} batch@${i} FAILED: ${error.message}`); break; }
      wrote += Math.min(40, fresh.length - i);
    }
    totalWrote += wrote;
    report.push({ ...t, wrote, priced });
    console.log(`   -> wrote ${wrote}`);
  }
  console.log(APPLY ? `\nWROTE ${totalWrote} product rows` : `\nDRY RUN — would write ${totalWould} product rows (re-run with --apply)`);
  fs.writeFileSync(OUT.replace('.json', '.ingest-report.json'), JSON.stringify(report, null, 1));
}

// ---------- runner ----------
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

async function loadOrgs() {
  let auth = [], from = 0;
  for (;;) {
    const { data, error } = await db.from('v_org_authentication')
      .select('org_id,name,relevance_tier,concierge_category,ax_catalogue').order('org_id').range(from, from + 999);
    if (error) throw error;
    auth = auth.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const ids = auth.map((a) => a.org_id);
  let orgs = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('organizations')
      .select('id,name,business_name,website,slug,currency,metadata').in('id', ids.slice(i, i + 200));
    if (error) throw error;
    orgs = orgs.concat(data);
  }
  const byId = Object.fromEntries(orgs.map((o) => [o.id, o]));
  return auth.map((a) => ({ ...a, ...(byId[a.org_id] || {}) }));
}

async function deepMain() {
  const census = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const open = census.filter((c) => c.catalog && c.catalog.live);
  const hosts = [...new Map(open.map((c) => [c.host, c])).values()];
  console.log(`deep-measuring ${hosts.length} hosts with a live open endpoint`);
  const out = [];
  for (const c of hosts) {
    try {
      const d = await deepMeasure(c);
      console.log(`  ${c.host.padEnd(34)} ${d.platform.padEnd(12)} n=${String(d.product_count).padEnd(5)} priced=${String(d.priced_count).padEnd(5)} cur=${d.currency || 'UNRESOLVED'} (${d.currency_method})`);
      const { products, ...meta } = d;
      out.push({ host: c.host, org_id: c.org_id, name: c.name, ...meta, observed_at: now() });
      fs.writeFileSync(OUT.replace('.json', `.products.${c.host}.json`), JSON.stringify(products));
    } catch (e) {
      console.log(`  ${c.host} FAILED: ${e.message}`);
      out.push({ host: c.host, org_id: c.org_id, name: c.name, error: String(e.message) });
    }
  }
  fs.writeFileSync(OUT.replace('.json', '.deep.json'), JSON.stringify(out, null, 1));
  console.log(`\ndeep -> ${OUT.replace('.json', '.deep.json')}`);
}

// Witnesses rejected by hand after inspecting the actual store. Each needs a reason —
// a rejection without one is just an opinion.
const REJECTED = {
  'wildsideofstbarth.com': 'ENTITY GATE: the domain 301-redirects to capuccinocreateur.com and every '
    + 'product permalink in the feed is a capuccinocreateur.com URL. The catalog belongs to Capuccino '
    + 'Createur, a different business — the org\'s stored website is stale. Ingesting would file 13 of '
    + 'another company\'s products under WILD SIDE. Matching the configured domain is not enough; the '
    + 'FINAL resolved host is what identifies the org.',
  'tamarinstbarth.com': 'WooCommerce store is misconfigured: currency_code=GBP with £200.00 for '
    + '"Marinated Oysters" at a St Barth restaurant. The org already carries 72 EUR menu items '
    + 'sourced from the human-readable menu at /food-experience/ (Espresso €4) which are '
    + 'coherent. Ingesting this feed would overwrite a good profile with a broken one.',
};

// Two orgs are the SAME business stored twice, the copies differing only by a mangled
// apostrophe (slug carries the raw `&#039;`). Ingesting both would put the same catalog
// on two profiles. Rows are never deleted — the non-canonical id is skipped here and
// reported as a merge candidate for the owner.
const NON_CANONICAL = new Map([
  ['2d93b3e0-0201-4722-b848-ffbd101025fc', 'duplicate of 2cc0c696 "L\'AGENCE SIAPOC / HILTI" (apostrophe stripped); catalog ingested to the canonical row — MERGE CANDIDATE, owner decision'],
  ['deb332e0-5851-4964-a4b9-e2e29d19cda4', 'duplicate of 9aff9295 "TAWA B\'ART" (apostrophe stripped); catalog ingested to the canonical row — MERGE CANDIDATE, owner decision'],
]);
// Stores measured to serve a different currency/price per request context.
const MARKET_VARIABLE = new Set(['cultgaia.com']);
const PINNED = fs.existsSync(OUT.replace('catalog-census.json', 'pinned-market.json'))
  ? JSON.parse(fs.readFileSync(OUT.replace('catalog-census.json', 'pinned-market.json'), 'utf8')) : {};

async function planMain() {
  const census = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const deep = JSON.parse(fs.readFileSync(OUT.replace('.json', '.deep.json'), 'utf8'));
  const byHost = Object.fromEntries(deep.map((d) => [d.host, d]));
  // orgs already served by a live partner_feed connection — a second copy under a
  // different method is how a corpus grows duplicates. Report, never re-ingest.
  const { data: connRows } = await db.from('concierge_products')
    .select('org_id').eq('method', 'shopify_public_feed').limit(1000);
  const partnerOrgs = new Set((connRows || []).map((r) => r.org_id));

  const ingest = [], skipped = [];
  for (const c of census.filter((x) => x.catalog && x.catalog.live)) {
    const d = byHost[c.host];
    const g = entityGate(c.name, c.host);
    const base = { org_id: c.org_id, name: c.name, host: c.host, tier: c.tier,
      platform: d?.platform, product_count: d?.product_count, priced_count: d?.priced_count,
      currency: d?.currency, currency_method: d?.currency_method, entity_gate: g.basis };
    // Shopify: the pinned re-fetch supersedes the unpinned first read.
    if (base.platform === 'shopify' && PINNED[c.host]) {
      const pm = PINNED[c.host];
      base.currency = pm.currency_pinned;
      base.currency_method = 'shopify_currency_active@accept-language=fr-FR (corroborated homepage+cart.js+pdp)';
      base.product_count = pm.n;
      base.market = { accept_language: pm.accept_language, market_variable: MARKET_VARIABLE.has(c.host),
                      currency_method: base.currency_method };
    }
    if (REJECTED[c.host]) { skipped.push({ ...base, reason: 'witness_rejected', detail: REJECTED[c.host] }); continue; }
    if (NON_CANONICAL.has(c.org_id)) {
      skipped.push({ ...base, reason: 'duplicate_org_row', detail: NON_CANONICAL.get(c.org_id) }); continue;
    }
    if (!g.pass) { skipped.push({ ...base, reason: 'entity_gate_failed', detail: g.basis }); continue; }
    if (c.shared_host && c.host_org_count > 1) { /* duplicate org rows share a host; keep both, they are the same business */ }
    if (partnerOrgs.has(c.org_id)) { skipped.push({ ...base, reason: 'already_served_by_partner_feed' }); continue; }
    if (!d || d.error || !d.product_count) { skipped.push({ ...base, reason: 'no_measurable_catalog', detail: d?.error }); continue; }
    if (!d.currency) { skipped.push({ ...base, reason: 'currency_unresolved' }); continue; }
    ingest.push(base);
  }
  fs.writeFileSync(OUT.replace('.json', '.plan.json'), JSON.stringify({ ingest, skipped }, null, 1));
  console.log('=== INGEST PLAN ===');
  ingest.forEach((t) => console.log(`  ${t.host.padEnd(30)} ${String(t.product_count).padStart(5)} prod  ${t.currency}  t${t.tier}  ${t.name}`));
  console.log(`  total ${ingest.reduce((s, t) => s + t.product_count, 0)} products across ${ingest.length} orgs`);
  console.log('\n=== SKIPPED ===');
  skipped.forEach((t) => console.log(`  ${t.host.padEnd(30)} ${t.reason.padEnd(30)} ${t.name}`));
}

// A witness that disagrees with a stored value is NEVER silently resolved. It is recorded
// in the same `metadata.<axis>.conflict` shape the geo workstream already uses, so the
// disagreement surfaces as a work order instead of one side quietly winning.
const CONFLICTS = [
  { org_id: '98d8d079-831f-4181-bd9f-fe53445e48ff', name: 'CALYPSO', host: 'calypsostbarth.com',
    conflict: {
      source: 'shopify_storefront', field: 'currency',
      stored_value: 'EUR', stored_basis: '353 rows, method=shopify_public_feed, ingested 2026-07-02',
      witness_value: 'USD',
      witness_basis: 'Shopify.currency.active=USD (rate 1.0) corroborated across homepage, /cart.js, PDP and PDP JSON-LD on 4 independent reads',
      effect: 'every stored Calypso price is labelled EUR but the store publishes USD — e.g. "Travel Wrap" stored 365 EUR, store publishes 365 USD',
      resolution: 'NOT overwritten. The partner_feed ingester that wrote these rows hardcodes EUR and must be fixed at the pipeline, then the rows re-derived.',
    } },
  { org_id: 'a5f8caad-d597-40d4-b928-29b52417fd9b', name: 'LE TAMARIN', host: 'tamarinstbarth.com',
    conflict: {
      source: 'woocommerce_store_api', field: 'currency',
      stored_value: 'EUR', stored_basis: '72 rows, method=menu_sweep from the human-readable menu at /food-experience/ (Espresso €4, Cappuccino €6) — coherent',
      witness_value: 'GBP',
      witness_basis: 'wp-json/wc/store/products reports currency_code=GBP, £200.00 for "Marinated Oysters"',
      effect: 'the WooCommerce install is misconfigured; the witness is less reliable than the stored value',
      resolution: 'Witness REJECTED, catalogue not ingested. Stored menu rows stand. Merchant-side misconfiguration worth reporting to the operator.',
    } },
];

async function flagConflictsMain() {
  const APPLY = process.argv.includes('--apply');
  for (const c of CONFLICTS) {
    const { data, error } = await db.from('organizations').select('id,name,metadata').eq('id', c.org_id).single();
    if (error) { console.log(`  ${c.name}: ${error.message}`); continue; }
    const md = data.metadata || {};
    if (md.catalogue?.conflict) { console.log(`  ${c.name}: conflict already recorded — leaving as is`); continue; }
    const next = { ...md, catalogue: { ...(md.catalogue || {}), conflict: { ...c.conflict, flagged_at: new Date().toISOString(), flagged_by: 'catalogue-probe' } } };
    console.log(`  ${c.name} (${c.host}): ${c.conflict.field} stored=${c.conflict.stored_value} witness=${c.conflict.witness_value}`);
    if (!APPLY) continue;
    const { error: e2 } = await db.from('organizations').update({ metadata: next }).eq('id', c.org_id);
    console.log(e2 ? `    ! ${e2.message}` : '    recorded');
  }
  if (!APPLY) console.log('\nDRY RUN — re-run with --apply');
}

async function main() {
  if (process.argv.includes('--flag-conflicts')) return flagConflictsMain();
  if (process.argv.includes('--deep')) return deepMain();
  if (process.argv.includes('--plan')) return planMain();
  if (process.argv.includes('--ingest')) return ingestMain();
  const rows = await loadOrgs();
  const withSite = rows.filter((r) => r.website && hostOf(r.website));
  console.log(`orgs=${rows.length} with_website=${withSite.length}`);

  // Host → orgs. A host claimed by >1 org is an aggregator/portal: entity gate fails.
  const hostOrgs = new Map();
  for (const r of withSite) {
    const h = hostOf(r.website);
    r._host = h;
    if (!hostOrgs.has(h)) hostOrgs.set(h, []);
    hostOrgs.get(h).push(r);
  }
  const hosts = [...hostOrgs.keys()].slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`distinct hosts=${hostOrgs.size} probing=${hosts.length} conc=${CONC}`);

  let done = 0;
  const results = await pool(hosts, CONC, async (h) => {
    const rec = await probeOrgHost(h);
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${hosts.length}`);
    return rec;
  });

  const byHost = Object.fromEntries(results.map((r) => [r.host, r]));
  const census = withSite
    .filter((r) => byHost[r._host])
    .map((r) => {
      const p = byHost[r._host];
      const shared = hostOrgs.get(r._host).length > 1;
      return {
        org_id: r.org_id, name: r.name || r.business_name, slug: r.slug,
        tier: r.relevance_tier, category: r.concierge_category, ax_catalogue: r.ax_catalogue,
        website: r.website, host: r._host,
        shared_host: shared, host_org_count: hostOrgs.get(r._host).length,
        catalog: p.catalog || null,
        sniff: p.sniff,
        observed_at: p.observed_at,
      };
    });

  fs.writeFileSync(OUT, JSON.stringify(census, null, 1));
  const open = census.filter((c) => c.catalog);
  const openLive = open.filter((c) => c.catalog.live);
  console.log(`\nCENSUS -> ${OUT}`);
  console.log(`open machine-readable endpoint: ${open.length} org-rows (${openLive.length} with >=1 product)`);
  const plat = {};
  for (const c of census) for (const p of (c.catalog ? [c.catalog.platform] : c.sniff.platforms || [])) plat[p] = (plat[p] || 0) + 1;
  console.log('platforms:', JSON.stringify(plat));
}

main().catch((e) => { console.error(e); process.exit(1); });
