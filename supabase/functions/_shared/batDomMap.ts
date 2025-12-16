import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { normalizeListingLocation } from './normalizeListingLocation.ts';

export type BatDomFieldKey =
  | 'title'
  | 'identity'
  | 'lot_number'
  | 'location'
  | 'seller'
  | 'buyer'
  | 'auction_dates'
  | 'sale'
  | 'images'
  | 'description'
  | 'comments'
  | 'bids';

export interface BatDomFieldHealth {
  ok: boolean;
  method?: string;
  value_preview?: string | null;
  warnings?: string[];
}

export interface BatDomMapHealth {
  overall_score: number; // 0-100
  fields: Record<BatDomFieldKey, BatDomFieldHealth>;
  counts: {
    images: number;
    comments: number;
    bids: number;
  };
  warnings: string[];
  errors: string[];
}

export interface BatDomExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  lot_number: string | null;
  location_raw: string | null;
  location_clean: string | null;
  seller_username: string | null;
  buyer_username: string | null;
  auction_end_date: string | null; // YYYY-MM-DD
  auction_start_date: string | null; // YYYY-MM-DD (best-effort)
  sale_date: string | null; // YYYY-MM-DD
  sale_price: number | null;
  current_bid: number | null;
  image_urls: string[];
  description_text: string | null;
  comment_count: number;
  bid_count: number;
}

const textContent = (el: any): string =>
  String(el?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

const asInt = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function safeDecodeHtmlAttr(s: string): string {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&');
}

function extractGalleryImagesFromHtml(html: string): { urls: string[]; method: string } {
  const h = String(html || '');

  const normalize = (u: string) =>
    u
      .split('#')[0]
      .split('?')[0]
      .replace(/&#038;/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/-scaled\./g, '.')
      .trim();

  const isOk = (u: string) => {
    const s = u.toLowerCase();
    return (
      u.startsWith('http') &&
      s.includes('bringatrailer.com/wp-content/uploads/') &&
      !s.endsWith('.svg') &&
      !s.endsWith('.pdf')
    );
  };

  // 1) Most reliable: embedded JSON gallery attribute (quote-safe).
  try {
    const m = h.match(/data-gallery-items=(?:"([^"]+)"|'([^']+)')/i);
    const encoded = String((m?.[1] || m?.[2] || '') as string);
    if (encoded) {
      const jsonText = safeDecodeHtmlAttr(encoded);
      const items = JSON.parse(jsonText);
      if (Array.isArray(items)) {
        const urls: string[] = [];
        for (const it of items) {
          const u = it?.large?.url || it?.small?.url;
          if (typeof u !== 'string' || !u.trim()) continue;
          const nu = normalize(u);
          if (isOk(nu)) urls.push(nu);
        }
        const unique = [...new Set(urls)];
        if (unique.length) return { urls: unique, method: 'attr:data-gallery-items' };
      }
    }
  } catch {
    // fall through
  }

  // 2) Regex fallback (still deterministic)
  const abs =
    h.match(/https:\/\/bringatrailer\.com\/wp-content\/uploads\/[^"'\s>]+\.(jpg|jpeg|png)(?:\?[^"'\s>]*)?/gi) || [];
  const protoRel =
    h.match(/\/\/bringatrailer\.com\/wp-content\/uploads\/[^"'\s>]+\.(jpg|jpeg|png)(?:\?[^"'\s>]*)?/gi) || [];
  const rel =
    h.match(/\/wp-content\/uploads\/[^"'\s>]+\.(jpg|jpeg|png)(?:\?[^"'\s>]*)?/gi) || [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...abs, ...protoRel, ...rel]) {
    let u = raw;
    if (u.startsWith('//')) u = 'https:' + u;
    if (u.startsWith('/')) u = 'https://bringatrailer.com' + u;
    const nu = normalize(u);
    if (!isOk(nu)) continue;
    if (seen.has(nu)) continue;
    seen.add(nu);
    out.push(nu);
  }
  return { urls: out, method: out.length ? 'regex:wp-content/uploads' : 'none' };
}

function extractEssentialsKV(doc: any): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const essentials = doc.querySelector('.essentials');
    if (!essentials) return out;
    const lis = essentials.querySelectorAll('li') || [];
    for (const li of lis) {
      const t = textContent(li);
      const m = t.match(/^([A-Za-z][A-Za-z\s\/]+)\s*:\s*(.+)$/);
      if (!m?.[1] || !m?.[2]) continue;
      const k = m[1].trim().toLowerCase();
      const v = m[2].trim();
      if (!k || !v) continue;
      out[k] = v;
    }
  } catch {
    // ignore
  }
  return out;
}

function extractTitle(doc: any): { title: string | null; method: string } {
  const h1 = doc.querySelector('h1.post-title') || doc.querySelector('h1');
  const v = textContent(h1);
  if (v) return { title: v, method: h1?.classList?.contains?.('post-title') ? 'selector:h1.post-title' : 'selector:h1' };
  const titleEl = doc.querySelector('title');
  const t = textContent(titleEl);
  if (t) return { title: t.split('|')[0].trim(), method: 'selector:title' };
  return { title: null, method: 'none' };
}

function parseIdentityFromTitle(title: string | null): { year: number | null; make: string | null; model: string | null } {
  if (!title) return { year: null, make: null, model: null };
  const m = title.match(/\b(19|20)\d{2}\b/);
  if (!m) return { year: null, make: null, model: null };
  const year = Number(m[0]);
  if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) return { year: null, make: null, model: null };
  const afterYear = title.slice(title.indexOf(m[0]) + m[0].length).trim();
  const parts = afterYear.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { year, make: parts[0] || null, model: null };
  const make = parts[0];
  const model = parts.slice(1, 4).join(' '); // keep short; trim can be derived elsewhere
  return { year, make, model };
}

function extractLocation(
  doc: any,
  essentials: Record<string, string>
): { raw: string | null; clean: string | null; method: string; warnings: string[] } {
  const warnings: string[] = [];

  // 1) Badge with title="Listing location"
  try {
    const badge = doc.querySelector('[title="Listing location"]');
    const t = textContent(badge);
    if (t) {
      const cleaned = t
        .replace(/View all listings.*/i, '')
        .replace(/Notify me about new listings.*/i, '')
        .trim();
      const norm = normalizeListingLocation(cleaned);
      return { raw: norm.raw || cleaned, clean: norm.clean, method: 'selector:[title="Listing location"]', warnings };
    }
  } catch {
    // ignore
  }

  // 2) Essentials key
  const raw = essentials['location'] || null;
  if (raw) {
    const norm = normalizeListingLocation(raw);
    return { raw: norm.raw, clean: norm.clean, method: 'essentials:Location', warnings };
  }

  // 3) Fallback: look for "Location:" text nearby
  try {
    const any = doc.querySelector('.essentials') || doc.body;
    const t = textContent(any);
    const m = t.match(/\bLocation\s*:\s*([^|•\n\r]{2,80})/i);
    if (m?.[1]) {
      const norm = normalizeListingLocation(m[1].trim());
      warnings.push('location_fallback_used');
      return { raw: norm.raw, clean: norm.clean, method: 'text:fallback(Location:)', warnings };
    }
  } catch {
    // ignore
  }

  return { raw: null, clean: null, method: 'none', warnings };
}

function extractSellerBuyer(doc: any, essentials: Record<string, string>): { seller: string | null; buyer: string | null; method: string } {
  const bodyText = textContent(doc.body);
  const seller = essentials['seller'] || (bodyText.match(/\bSold by\s+([A-Za-z0-9_]+)\b/i)?.[1] || null);
  const buyer =
    essentials['buyer'] ||
    (bodyText.match(/\bSold to\s+([A-Za-z0-9_]+)\b/i)?.[1] || bodyText.match(/\bto\s+([A-Za-z0-9_]+)\s+for\b/i)?.[1] || null);
  const method = (seller && essentials['seller']) || (buyer && essentials['buyer']) ? 'essentials' : 'text:fallback';
  return { seller, buyer, method };
}

function extractLotNumber(essentials: Record<string, string>, url: string): { lot: string | null; method: string } {
  const fromEssentials = essentials['lot'] || essentials['lot #'] || null;
  if (fromEssentials) {
    const m = fromEssentials.match(/(\d{2,})/);
    return { lot: m?.[1] || fromEssentials, method: 'essentials' };
  }
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/listing\/.*-(\d+)\/?$/i);
    if (m?.[1]) return { lot: m[1], method: 'url' };
  } catch {
    // ignore
  }
  return { lot: null, method: 'none' };
}

function extractAuctionDates(
  doc: any,
  html: string
): { start: string | null; end: string | null; sale: string | null; method: string; warnings: string[] } {
  const warnings: string[] = [];
  const h = String(html || '');

  const ends = h.match(/data-auction-ends=["'](\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})["']/);
  if (ends?.[1]) {
    const parts = ends[1].split('-').map((x) => Number(x));
    if (parts.length === 6 && parts.every((x) => Number.isFinite(x))) {
      const dt = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
      if (Number.isFinite(dt.getTime())) {
        const end = dt.toISOString().split('T')[0];
        const startDt = new Date(dt);
        startDt.setDate(startDt.getDate() - 7);
        const start = startDt.toISOString().split('T')[0];
        return { start, end, sale: null, method: 'attr:data-auction-ends', warnings };
      }
    }
  }

  const body = textContent(doc.body);
  const saleM =
    body.match(/\bSold for\b[\s\S]{0,120}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
    body.match(/\bBid to\b[\s\S]{0,120}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
    null;
  const parse = (d: string): string | null => {
    const dt = new Date(d);
    if (!Number.isFinite(dt.getTime())) return null;
    return dt.toISOString().split('T')[0];
  };
  const sale = saleM?.[1] ? parse(saleM[1]) : null;
  if (sale) {
    const end = sale;
    const sd = new Date(sale);
    sd.setDate(sd.getDate() - 7);
    const start = sd.toISOString().split('T')[0];
    warnings.push('start_date_calculated_minus_7d');
    return { start, end, sale, method: 'text:sold_or_bid_to', warnings };
  }

  return { start: null, end: null, sale: null, method: 'none', warnings };
}

function extractSaleAndCurrentBid(doc: any): { sale_price: number | null; current_bid: number | null; method: string } {
  const body = textContent(doc.body);
  const sold =
    body.match(/\bSold for\b[\s\S]{0,120}?\bUSD\s*\$([\d,]+)/i) || body.match(/\bSold for\b[\s\S]{0,120}?\$([\d,]+)/i);
  if (sold?.[1]) {
    const n = asInt(sold[1]);
    if (n && n >= 1000) return { sale_price: n, current_bid: n, method: 'text:sold_for' };
  }
  const bid =
    body.match(/\bCurrent Bid\b[\s\S]{0,120}?\bUSD\s*\$([\d,]+)/i) || body.match(/\bBid to\b[\s\S]{0,120}?\bUSD\s*\$([\d,]+)/i);
  if (bid?.[1]) {
    const n = asInt(bid[1]);
    if (n && n >= 1000) return { sale_price: null, current_bid: n, method: 'text:current_bid' };
  }
  return { sale_price: null, current_bid: null, method: 'none' };
}

function extractDescription(doc: any): { text: string | null; method: string } {
  const el =
    doc.querySelector('.post-content') ||
    doc.querySelector('#post-content') ||
    doc.querySelector('.post-excerpt') ||
    doc.querySelector('article.post') ||
    doc.querySelector('.card-body') ||
    doc.querySelector('.listing-description') ||
    doc.querySelector('[class*="description"]');

  if (!el) return { text: null, method: 'none' };

  // Prefer paragraph text to reduce UI noise.
  try {
    const ps = el.querySelectorAll?.('p') || [];
    const parr = Array.from(ps as any);
    const paraText = parr
      .map((p: any) => textContent(p))
      .filter((s: string) => s && s.length >= 10)
      .join('\n')
      .trim();

    if (paraText && paraText.length >= 50) {
      const cls = el?.className ? String(el.className).split(' ')[0] : 'description';
      return { text: paraText.slice(0, 4000), method: `selector:${cls}:p` };
    }
  } catch {
    // fall through
  }

  const t = textContent(el);
  if (t && t.length >= 50) {
    const cls = el?.className ? String(el.className).split(' ')[0] : 'description';
    return { text: t.slice(0, 4000), method: `selector:${cls}` };
  }

  return { text: null, method: 'none' };
}

function extractCommentsAndBids(doc: any, html: string): { comments: number; bids: number; method: string } {
  const h = String(html || '');

  try {
    const commentEls = doc.querySelectorAll('.comment') || [];
    const commentArr: any[] = Array.from(commentEls as any);

    let commentCount = Number(commentArr.length || 0);
    let bidCount = 0;

    for (const el of commentArr) {
      const p = el?.querySelector?.('p') || el;
      const t = textContent(p);
      if (!t) continue;
      if (/bid placed by/i.test(t)) bidCount++;
    }

    if (commentCount === 0) {
      const bodyText = textContent(doc.body);
      const cm = bodyText.match(/\b([\d,]+)\s+comments?\b/i);
      commentCount = asInt(cm?.[1]) || 0;
    }

    if (bidCount === 0) {
      const sm =
        h.match(/data-stats-item="bids"[^>]*>\s*([\d,]+)\s*bids?\s*</i) ||
        h.match(/\b([\d,]+)\s*bids?\b/i);
      bidCount = asInt(sm?.[1]) || 0;
    }
    if (bidCount === 0) {
      bidCount = (h.match(/\b(?:USD\s*)?\$[\d,]+\s+bid placed by\b/gi) || []).length;
    }

    return { comments: commentCount || 0, bids: bidCount || 0, method: commentArr.length ? 'dom:.comment' : 'text:headline_fallback' };
  } catch {
    const body = textContent(doc.body);
    const comments = asInt(body.match(/\b([\d,]+)\s+comments?\b/i)?.[1]) || 0;
    const bids = (h.match(/\b(?:USD\s*)?\$[\d,]+\s+bid placed by\b/gi) || []).length;
    return { comments, bids: bids || 0, method: 'text:fallback' };
  }
}

function computeScore(x: Partial<BatDomMapHealth>): number {
  const fields = x.fields || ({} as any);
  const counts = x.counts || { images: 0, comments: 0, bids: 0 };

  let score = 0;
  const add = (ok: boolean, w: number) => {
    if (ok) score += w;
  };

  add(!!fields.title?.ok, 10);
  add(!!fields.identity?.ok, 10);
  add(!!fields.location?.ok, 15);
  add(!!fields.images?.ok, 20);
  add(!!fields.description?.ok, 10);
  add(!!fields.seller?.ok, 5);
  add(!!fields.sale?.ok || !!fields.auction_dates?.ok, 10);
  add(counts.comments > 0, 10);
  add(counts.bids > 0, 10);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function extractBatDomMap(html: string, url: string): { extracted: BatDomExtracted; health: BatDomMapHealth } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  if (!doc) {
    const emptyHealth: BatDomMapHealth = {
      overall_score: 0,
      fields: {
        title: { ok: false, method: 'none' },
        identity: { ok: false, method: 'none' },
        lot_number: { ok: false, method: 'none' },
        location: { ok: false, method: 'none' },
        seller: { ok: false, method: 'none' },
        buyer: { ok: false, method: 'none' },
        auction_dates: { ok: false, method: 'none' },
        sale: { ok: false, method: 'none' },
        images: { ok: false, method: 'none' },
        description: { ok: false, method: 'none' },
        comments: { ok: false, method: 'none' },
        bids: { ok: false, method: 'none' },
      },
      counts: { images: 0, comments: 0, bids: 0 },
      warnings,
      errors: ['DOMParser returned null document'],
    };
    return {
      extracted: {
        url,
        title: null,
        year: null,
        make: null,
        model: null,
        lot_number: null,
        location_raw: null,
        location_clean: null,
        seller_username: null,
        buyer_username: null,
        auction_end_date: null,
        auction_start_date: null,
        sale_date: null,
        sale_price: null,
        current_bid: null,
        image_urls: [],
        description_text: null,
        comment_count: 0,
        bid_count: 0,
      },
      health: emptyHealth,
    };
  }

  const essentials = extractEssentialsKV(doc);

  const { title, method: titleMethod } = extractTitle(doc);
  const identity = parseIdentityFromTitle(title);

  const { lot, method: lotMethod } = extractLotNumber(essentials, url);

  const loc = extractLocation(doc, essentials);
  warnings.push(...(loc.warnings || []));

  const sb = extractSellerBuyer(doc, essentials);

  const dates = extractAuctionDates(doc, html);
  warnings.push(...(dates.warnings || []));

  const sale = extractSaleAndCurrentBid(doc);

  const gallery = extractGalleryImagesFromHtml(html);

  const desc = extractDescription(doc);

  const cb = extractCommentsAndBids(doc, html);

  const extracted: BatDomExtracted = {
    url,
    title: title || null,
    year: identity.year,
    make: identity.make,
    model: identity.model,
    lot_number: lot,
    location_raw: loc.raw,
    location_clean: loc.clean,
    seller_username: sb.seller,
    buyer_username: sb.buyer,
    auction_end_date: dates.end,
    auction_start_date: dates.start,
    sale_date: dates.sale,
    sale_price: sale.sale_price,
    current_bid: sale.current_bid,
    image_urls: gallery.urls,
    description_text: desc.text,
    comment_count: cb.comments,
    bid_count: cb.bids,
  };

  const fields: Record<BatDomFieldKey, BatDomFieldHealth> = {
    title: { ok: !!title, method: titleMethod, value_preview: title ? title.slice(0, 120) : null },
    identity: {
      ok: !!identity.year && !!identity.make && !!identity.model,
      method: 'parse:title',
      value_preview: identity.year ? `${identity.year} ${identity.make || ''} ${identity.model || ''}`.trim().slice(0, 120) : null,
    },
    lot_number: { ok: !!lot, method: lotMethod, value_preview: lot },
    location: { ok: !!loc.clean || !!loc.raw, method: loc.method, value_preview: (loc.clean || loc.raw || null)?.slice(0, 120), warnings: loc.warnings },
    seller: { ok: !!sb.seller, method: sb.method, value_preview: sb.seller },
    buyer: { ok: !!sb.buyer, method: sb.method, value_preview: sb.buyer },
    auction_dates: { ok: !!dates.end || !!dates.sale, method: dates.method, value_preview: dates.end || dates.sale || null, warnings: dates.warnings },
    sale: {
      ok: !!sale.sale_price || !!sale.current_bid,
      method: sale.method,
      value_preview: sale.sale_price ? String(sale.sale_price) : sale.current_bid ? String(sale.current_bid) : null,
    },
    images: { ok: gallery.urls.length > 0, method: gallery.method, value_preview: gallery.urls[0] || null },
    description: { ok: !!desc.text, method: desc.method, value_preview: desc.text ? desc.text.slice(0, 120) : null },
    comments: { ok: cb.comments > 0, method: cb.method, value_preview: cb.comments ? String(cb.comments) : null },
    bids: { ok: cb.bids > 0, method: cb.method, value_preview: cb.bids ? String(cb.bids) : null },
  };

  const health: BatDomMapHealth = {
    overall_score: 0,
    fields,
    counts: { images: gallery.urls.length, comments: cb.comments, bids: cb.bids },
    warnings,
    errors,
  };
  health.overall_score = computeScore(health);

  return { extracted, health };
}


