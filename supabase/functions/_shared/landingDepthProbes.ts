/**
 * landingDepthProbes — what a retained raw capture holds, and whether the canonical model holds it too.
 *
 * The nightly raw-vs-model test (measure-landing-depth) samples recently landed lots per source, reads the
 * retained listing_page_snapshots capture with `readRaw`, and compares each field it found with `modelHolds`.
 * A field the probe did not find in the capture is not counted: the table only says "the raw capture held it
 * and the model did / did not".
 *
 * The probes are deliberately independent of the extractors (extract-bat-core, extract-mecum, ...): they are the
 * yardstick the extractors and the folds behind them are measured against. A probe is a plain regex over the
 * page, so a drop it reports is a drop in the extractor or the writer, not in the probe.
 */

export type RawRead = { n?: number; sample?: string };
export type RawFields = Record<string, RawRead>;

/** Canonical field names, in the order the report shows them. */
export const DEPTH_FIELDS = [
  "year", "make_model", "vin", "mileage", "transmission", "engine", "exterior_color", "interior_color",
  "description", "location_city", "location_state", "location_zip", "location_point",
  "seller", "price", "end_date", "bid_count", "comment_count", "photo_count",
] as const;
export type DepthField = typeof DEPTH_FIELDS[number];

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

export function textOf(html: string): string {
  return decode(
    html.replace(/<script\b[\s\S]*?<\/script\b[^>]*>|<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

/** Inner html of the first element carrying `cls`, closed by counting nested tags of the same name. */
export function blockByClass(html: string, cls: string): string | null {
  const open = new RegExp(`<(div|section|article|span)\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, "i").exec(html);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = open.index + open[0].length;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open.index + open[0].length, m.index);
  }
  return html.slice(open.index + open[0].length);
}

const present = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v && !/^(n\/a|none|unknown|—|-)$/i.test(v) ? v : null;
};
const num = (s: string | null | undefined) => {
  const n = Number(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function put(out: RawFields, field: DepthField, v: string | number | null | undefined, as: "text" | "n" = "text") {
  if (v === null || v === undefined || v === "") return;
  if (as === "n") {
    const n = typeof v === "number" ? v : num(v);
    if (n !== null) out[field] = { n };
  } else {
    const s = present(String(v));
    if (s) out[field] = { sample: s.slice(0, 80) };
  }
}

const YEAR_RE = /\b(19[0-9]{2}|20[0-4][0-9])\b/;

/** --- Craigslist: attr groups, geo meta tags, postingbody, gallery counter --------------------------------- */
function craigslist(html: string): RawFields {
  const out: RawFields = {};
  const attr = (label: string) => {
    const m = new RegExp(`<span class="labl">\\s*${label}:?\\s*</span>\\s*<span class="valu">([\\s\\S]*?)</span>`, "i").exec(html);
    return m ? present(textOf(m[1])) : null;
  };
  put(out, "year", /<span class="valu year">\s*(\d{4})/.exec(html)?.[1]);
  const mm = /<span class="valu makemodel">([\s\S]*?)<\/span>/.exec(html);
  put(out, "make_model", mm ? textOf(mm[1]) : null);
  put(out, "vin", attr("VIN"));
  put(out, "mileage", attr("odometer"), "n");
  put(out, "transmission", attr("transmission"));
  put(out, "exterior_color", attr("paint color"));
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "";
  const body = blockByClass(html, "userbody") ? /id="postingbody"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "" : "";
  const bodyText = textOf(body.replace(/<div class="print-information[\s\S]*?<\/div>\s*<\/div>/i, "")
    .replace(/QR Code Link to This Post/gi, ""));
  if (bodyText.length >= 20) out.description = { n: bodyText.length };
  void title;
  const region = /<meta name="geo.region" content="US-([A-Z]{2})"/.exec(html)?.[1];
  put(out, "location_state", region);
  put(out, "location_city", /<meta name="geo.placename" content="([^"]+)"/.exec(html)?.[1]);
  const pos = /<meta name="geo.position" content="(-?\d+\.\d+);(-?\d+\.\d+)"/.exec(html);
  if (pos) out.location_point = { sample: `${pos[1]},${pos[2]}` };
  put(out, "price", /<span class="price">\s*\$([\d,]+)/.exec(html)?.[1], "n");
  const imgs = /image \d+ of (\d+)/.exec(html)?.[1];
  put(out, "photo_count", imgs ?? (/property="og:image"/.test(html) ? 1 : null), "n");
  return out;
}

/** --- Bring a Trailer: essentials block, listing details list, post-excerpt, gallery JSON ----------------- */
function bat(html: string): RawFields {
  const out: RawFields = {};
  if (!/\/listing\//.test(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? "/listing/")) return out;
  const h1 = textOf(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "");
  put(out, "year", YEAR_RE.exec(h1)?.[1]);
  if (h1.replace(YEAR_RE, "").trim().length >= 3) put(out, "make_model", h1);
  const ess = blockByClass(html, "essentials") ?? "";
  put(out, "seller", textOf(/<strong>Seller<\/strong>:?\s*([\s\S]*?)(?:<a [^>]*button|<\/div>)/.exec(ess)?.[1] ?? ""));
  const loc = textOf(/<strong>Location<\/strong>:?\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(ess)?.[1] ?? "");
  if (loc) {
    out.location_city = { sample: loc.slice(0, 80) };
    if (/,\s*[A-Za-z .]{2,}(?:\s+\d{5})?$/.test(loc)) out.location_state = { sample: loc.slice(0, 80) };
    const zip = /\b(\d{5})\b/.exec(loc)?.[1];
    if (zip) out.location_zip = { sample: zip };
  }
  put(out, "vin", textOf(/Chassis:\s*(?:<a[^>]*>)?([A-Za-z0-9\-]{5,20})/.exec(ess)?.[1] ?? ""));
  const items = [...ess.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  const mil = items.map((t) => /^(\d[\d,]*k?)\s*(?:Miles|Kilometers|Mile)/i.exec(t)).find(Boolean);
  if (mil) {
    const raw = mil[1].toLowerCase();
    put(out, "mileage", raw.endsWith("k") ? Number(raw.slice(0, -1).replace(/,/g, "")) * 1000 : raw, "n");
  }
  put(out, "transmission", items.find((t) => /transmission|speed|manual|automatic|\bCVT\b|\bPDK\b/i.test(t) && !/Miles/i.test(t)));
  put(out, "engine", items.find((t) => /\b\d\.\d\s*-?\s*(?:L|Liter)|\bV\d{1,2}\b|\bflat-|\binline-|cylinder|\brotary\b/i.test(t) && !/transmission/i.test(t)));
  const desc = blockByClass(html, "post-excerpt");
  if (desc) {
    const t = textOf(desc);
    if (t.length >= 40) out.description = { n: t.length };
  }
  const gallery = /data-gallery-items="([^"]+)"/.exec(html)?.[1];
  if (gallery) {
    try {
      const items = JSON.parse(decode(gallery));
      if (Array.isArray(items) && items.length) out.photo_count = { n: items.length };
    } catch { /* unparseable gallery: leave the field unread */ }
  }
  const cur = /info-label">(?:Current Bid|Sold for|Bid to|Sold After)[^<]*<\/span>\s*<strong[^>]*>[^$<]*\$([\d,]+)/i.exec(html)?.[1];
  const soldFor = /(?:Sold for|Bid to)\s*(?:USD\s*)?\$([\d,]+)/i.exec(textOf(html.slice(0, 400000)))?.[1];
  put(out, "price", cur ?? soldFor, "n");
  put(out, "end_date", /data-until="(\d{9,11})"/.exec(html)?.[1]);
  const bids = /<th>\s*Bids?\s*<\/th>|(\d+)\s+bids?\b/i.exec(textOf(html.slice(0, 400000)));
  if (bids?.[1]) put(out, "bid_count", bids[1], "n");
  const cm = /(\d[\d,]*)\s+Comments?\b/i.exec(textOf(html.slice(0, 300000)))?.[1];
  put(out, "comment_count", cm, "n");
  return out;
}

/** --- Cars & Bids: markdown capture of the lot page (specs line, stats list, highlights, photo tabs) ------ */
function carsandbids(_html: string, md: string): RawFields {
  const out: RawFields = {};
  if (!md) return out;
  const spec = (label: string, next: string) =>
    present(new RegExp(`${label}\\s*(?:\\[)?([^\\]\\n]*?)(?:\\]\\([^)]*\\))?\\s*${next}`).exec(md)?.[1]);
  const title = /^# (.+)$/m.exec(md)?.[1] ?? "";
  put(out, "year", YEAR_RE.exec(title)?.[1]);
  if (title.replace(YEAR_RE, "").trim().length >= 3) put(out, "make_model", title);
  put(out, "mileage", /Mileage\s*([\d,]{2,})/.exec(md)?.[1], "n");
  put(out, "vin", /VIN\s*([A-HJ-NPR-Z0-9]{11,17})/.exec(md)?.[1]);
  put(out, "transmission", spec("Transmission", "VIN"));
  put(out, "engine", /Engine\s*([^\n\[]*?)(?:Model|\[)/.exec(md)?.[1]);
  put(out, "exterior_color", /Exterior Color\s*([^\n\[]*?)Location/.exec(md)?.[1]);
  put(out, "interior_color", /Interior Color\s*([^\n\[]*?)Seller/.exec(md)?.[1]);
  const loc = /Location\s*\[([^\]]+)\]/.exec(md)?.[1];
  if (loc) {
    out.location_city = { sample: loc };
    if (/,\s*[A-Z]{2}\b/.test(loc)) out.location_state = { sample: loc };
  }
  put(out, "seller", /Seller\s*\n+\s*\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)\s*\n+\s*\[([^\]]+)\]/.exec(md)?.[1]);
  const hi = md.indexOf("#### Highlights");
  const end = md.search(/### Comments & Bids|#### Documents|####? Auction Info/);
  if (hi >= 0) {
    const t = textOf(md.slice(hi + 15, end > hi ? end : hi + 20000));
    if (t.length >= 40) out.description = { n: t.length };
  }
  put(out, "price", /(?:High Bid|Sold For|Current Bid|Final Bid)\s*\$?([\d,]+)/i.exec(md)?.[1], "n");
  put(out, "bid_count", /-\s*Bids\s*(\d+)/.exec(md)?.[1], "n");
  put(out, "comment_count", /-\s*Comments\s*(\d+)/.exec(md)?.[1], "n");
  put(out, "photo_count", /All Photos \((\d+)\)/.exec(md)?.[1], "n");
  put(out, "end_date", /Ending ([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)? at [\d:]+ [AP]M)/.exec(md)?.[1]);
  return out;
}

/** --- Mecum: the lot object in the app-router payload (escaped JSON) ------------------------------------- */
function mecum(html: string): RawFields {
  const out: RawFields = {};
  const p = html.replace(/\\"/g, '"');
  const key = (k: string) => present(new RegExp(`"${k}":"([^"]*)"`).exec(p)?.[1]);
  const title = /"@type":\s*"Car"[\s\S]{0,4000}?"name":\s*"([^"]+)"/.exec(p)?.[1] ?? key("title") ?? "";
  put(out, "year", YEAR_RE.exec(title)?.[1] ?? /"lotYears"[\s\S]{0,300}?"name":"(\d{4})"/.exec(p)?.[1]);
  if (title.replace(YEAR_RE, "").trim().length >= 3) put(out, "make_model", title);
  put(out, "vin", key("vinSerial") ?? key("frameNumber"));
  put(out, "mileage", key("odometer"), "n");
  put(out, "transmission", key("transmission"));
  put(out, "exterior_color", key("color"));
  put(out, "interior_color", key("interior"));
  put(out, "price", key("hammerPrice") && key("hammerPrice") !== "0" ? key("hammerPrice") : null, "n");
  const imgBlock = /"images":\[([\s\S]*?)\],"isActualMiles"/.exec(p)?.[1] ?? "";
  const imgs = new Set([...imgBlock.matchAll(/"url":"(https:\/\/res\.cloudinary\.com\/mecum\/[^"]+)"/g)].map((m) => m[1]));
  if (imgs.size) out.photo_count = { n: imgs.size };
  const d = /"@type":\s*"Car"[\s\S]{0,6000}?"description":\s*"([^"]*)"/.exec(p)?.[1];
  if (d && d.length >= 40) out.description = { n: d.length };
  put(out, "end_date", key("auctionDayStart"));
  return out;
}

/** --- Gooding: gatsby page-data payload (contentfulLot) --------------------------------------------------- */
function gooding(html: string): RawFields {
  const out: RawFields = {};
  const m = (re: RegExp) => re.exec(html)?.[1];
  const title = m(/"item":\{[\s\S]{0,400}?"title":"([^"]+)"/) ?? "";
  put(out, "year", m(/"modelYear":(\d{4})/));
  if (m(/"make":\{"name":"([^"]+)"/) && m(/"model":"([^"]+)"/)) out.make_model = { sample: title.slice(0, 80) };
  put(out, "price", m(/"salePrice":(\d+)/), "n");
  const desc = m(/"description":\{"childMarkdownRemark":\{"html":"((?:[^"\\]|\\.)*)"/) ?? m(/"highlights":"((?:[^"\\]|\\.)*)"/);
  if (desc && textOf(desc).length >= 40) out.description = { n: textOf(desc).length };
  const imgs = new Set([...html.matchAll(/"public_id":"([^"]+)"/g)].map((x) => x[1]));
  if (imgs.size) out.photo_count = { n: imgs.size };
  const loc = m(/"location":\{"address":\{[^}]*"city":"([^"]+)"/);
  put(out, "location_city", loc);
  return out;
}

/** --- Generic article pages (Barn Finds, Hemmings, classiccars, hagerty, vanguard, ...): og/meta + body ---- */
function generic(html: string): RawFields {
  const out: RawFields = {};
  const meta = (p: string) => new RegExp(`<meta[^>]+(?:property|name)="${p}"[^>]*content="([^"]*)"`, "i").exec(html)?.[1];
  const title = decode(meta("og:title") ?? /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "");
  put(out, "year", YEAR_RE.exec(title)?.[1]);
  const art = blockByClass(html, "entry-content") ?? blockByClass(html, "post-content") ??
    blockByClass(html, "article-content") ?? blockByClass(html, "description");
  const text = art ? textOf(art) : "";
  if (text.length >= 200) out.description = { n: text.length };
  const imgs = new Set([...(art ?? "").matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]));
  const ogImg = meta("og:image");
  if (imgs.size || ogImg) out.photo_count = { n: Math.max(imgs.size, ogImg ? 1 : 0) };
  const vin = /\bVIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/.exec(text)?.[1];
  put(out, "vin", vin);
  const mi = /\b([\d,]{4,7})\s*(?:miles|mi\b)/i.exec(text)?.[1];
  put(out, "mileage", mi, "n");
  const price = /\$([\d,]{4,9})/.exec(text)?.[1];
  put(out, "price", price, "n");
  const state = /geo\.region" content="US-([A-Z]{2})"/.exec(html)?.[1];
  put(out, "location_state", state);
  return out;
}

const READERS: Record<string, (html: string, md: string) => RawFields> = {
  craigslist: (h) => craigslist(h),
  bat: (h) => bat(h),
  carsandbids: (h, md) => carsandbids(h, md),
  mecum: (h) => mecum(h),
  gooding: (h) => gooding(h),
};

/** A lot page, as opposed to an index or search page; the sampler skips the rest. */
const LOT_URL: Record<string, RegExp> = {
  bat: /bringatrailer\.com\/listing\//,
  craigslist: /craigslist\.org\/(?:view|[a-z]{3}\/d)\//,
  carsandbids: /carsandbids\.com\/auctions\/[^/]+\/[^/]+/,
  mecum: /mecum\.com\/lots\/\d+/,
  gooding: /goodingco\.com\/lot\//,
};
export const isLotUrl = (platform: string, url: string) => (LOT_URL[platform] ?? /./).test(url);

export function readRaw(platform: string, html: string, markdown: string | null): RawFields {
  return (READERS[platform] ?? ((h: string) => generic(h)))(html ?? "", markdown ?? "");
}

/** The sources the nightly test covers, in sampling order. Others fall back to the generic reader on demand. */
export const DEPTH_SOURCES = ["bat", "craigslist", "carsandbids", "mecum", "gooding", "barnfinds", "classiccars", "hagerty", "bonhams"] as const;

/** --- The model side ------------------------------------------------------------------------------------- */
export interface ModelCtx {
  v: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  locObs: Record<string, unknown>[];
  commentCount: number;
  imageCount: number;
  /** longest kind='listing' observation text for the vehicle (the log keeps the full description when the row keeps a teaser) */
  obsDescLen: number;
}
export type Held = { anywhere: boolean; profile: boolean; /** description only: held length / raw length */ profileRatio?: number; modelRatio?: number };

const has = (x: unknown) => x !== null && x !== undefined && String(x).trim() !== "" && String(x).trim() !== "0";
const any = (o: Record<string, unknown> | null, ...cols: string[]) => !!o && cols.some((c) => has(o[c]));
const anyEv = (evs: Record<string, unknown>[], ...cols: string[]) => evs.some((e) => any(e, ...cols));

/** Does the canonical model hold `field`, given that the raw capture held `raw` for it? */
export function modelHolds(field: DepthField, raw: RawRead, c: ModelCtx): Held {
  const v = c.v;
  const profile = (b: boolean): Held => ({ anywhere: b, profile: b });
  switch (field) {
    case "year": return profile(any(v, "year"));
    case "make_model": return profile(any(v, "make") && any(v, "model"));
    case "vin": return profile(any(v, "vin") && String(v!.vin).length >= 5);
    case "mileage": return profile(any(v, "mileage"));
    case "transmission": return profile(any(v, "transmission", "transmission_type"));
    case "engine": return profile(any(v, "engine_size", "engine_type", "engine_displacement", "engine_liters"));
    case "exterior_color": return profile(any(v, "color", "color_primary"));
    case "interior_color": return profile(any(v, "interior_color"));
    case "description": {
      const rawLen = Math.max(raw.n ?? 0, 1);
      const rowLen = String(v?.description ?? "").length;
      const profileRatio = rowLen / rawLen;
      const modelRatio = Math.max(rowLen, c.obsDescLen) / rawLen;
      return { profile: profileRatio >= 0.8, anywhere: modelRatio >= 0.8, profileRatio, modelRatio };
    }
    case "location_city": {
      const p = any(v, "city");
      return { profile: p, anywhere: p || c.locObs.some((o) => has(o.city) || has(o.location_text_clean)) };
    }
    case "location_state": {
      const p = any(v, "state");
      return { profile: p, anywhere: p || c.locObs.some((o) => has(o.region_code)) };
    }
    case "location_zip": {
      const p = any(v, "zip_code");
      return { profile: p, anywhere: p || c.locObs.some((o) => has(o.postal_code)) };
    }
    case "location_point": {
      const p = any(v, "gps_latitude");
      return { profile: p, anywhere: p || c.locObs.some((o) => has(o.latitude)) };
    }
    case "seller": {
      const p = any(v, "seller_name", "bat_seller");
      return { profile: p, anywhere: p || anyEv(c.events, "seller_identifier", "seller_external_identity_id") };
    }
    case "price": {
      const p = any(v, "sale_price", "winning_bid", "high_bid", "asking_price", "price", "bat_sold_price", "sold_price");
      return { profile: p, anywhere: p || anyEv(c.events, "final_price", "current_price", "starting_price") };
    }
    case "end_date": {
      const p = any(v, "sale_date", "bat_sale_date");
      return { profile: p, anywhere: p || anyEv(c.events, "ended_at", "sold_at") };
    }
    case "bid_count": {
      const p = any(v, "bid_count", "bat_bid_count");
      return { profile: p, anywhere: p || anyEv(c.events, "bid_count") };
    }
    case "comment_count": return { profile: false, anywhere: c.commentCount >= 0.5 * (raw.n ?? 1) };
    case "photo_count": return { profile: false, anywhere: c.imageCount >= 0.5 * (raw.n ?? 1) };
  }
}
